'use strict';

/*
 * Yayın manifestini üretir ve imzalar.
 *
 *   node scripts/manifest-imzala.js --anahtar <ozel-anahtar.pem> [secenekler]
 *
 * Seçenekler:
 *   --dizin <yol>      electron-builder çıktısı (varsayılan: dagitim)
 *   --indirme <adres>  paketlerin yayınlandığı https kök adresi
 *   --gun <n>          manifestin geçerlilik süresi (varsayılan 30)
 *   --kanal <ad>       kararli | beta (varsayılan kararli)
 *   --en-dusuk <sürüm> bu sürümden düşük kurulumlar önce ara sürüme geçsin
 *
 * Çıktı: <dizin>/pusula-guncelleme.json ve .imza
 * Bu iki dosyayı kurulum paketleriyle aynı yere yükleyin.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function argOku(ad, varsayilan) {
  const i = process.argv.indexOf('--' + ad);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : varsayilan;
}

const anahtarYolu = argOku('anahtar');
const dizin = path.resolve(argOku('dizin', 'dagitim'));
const indirmeKoku = (argOku('indirme', '') || '').replace(/\/+$/, '');
const gun = Number(argOku('gun', '30'));
const kanal = argOku('kanal', 'kararli');
const enDusuk = argOku('en-dusuk', '');

if (!anahtarYolu) {
  console.error('--anahtar <ozel-anahtar.pem> zorunlu. Anahtar yoksa: npm run anahtar-uret');
  process.exit(1);
}
if (!/^https:\/\//i.test(indirmeKoku)) {
  console.error('--indirme https:// ile başlayan bir adres olmalı.');
  process.exit(1);
}
if (!fs.existsSync(dizin)) {
  console.error('Dizin yok: ' + dizin + '  (önce: npm run paket)');
  process.exit(1);
}

const paket = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const surum = paket.version;

// electron-updater sha512'yi base64 olarak tutar; aynı biçimi üretiyoruz.
function sha512(dosya) {
  return crypto.createHash('sha512').update(fs.readFileSync(dosya)).digest('base64');
}

// Kurulum paketi adından platform anahtarı. Sürüm adı içinde geçtiği için
// desenler sürüme değil uzantı ve mimariye bakıyor.
const PLATFORM_DESENLERI = [
  [/\.exe$/i, /arm64/i, 'win32-arm64'],
  [/\.exe$/i, null, 'win32-x64'],
  [/\.dmg$/i, /arm64/i, 'darwin-arm64'],
  [/\.dmg$/i, null, 'darwin-x64'],
  [/\.AppImage$/i, /arm64/i, 'linux-arm64'],
  [/\.AppImage$/i, null, 'linux-x64']
];

function platformAnahtari(ad) {
  for (const [uzanti, mimari, anahtar] of PLATFORM_DESENLERI) {
    if (!uzanti.test(ad)) continue;
    if (mimari && !mimari.test(ad)) continue;
    if (!mimari && /arm64/i.test(ad)) continue;
    return anahtar;
  }
  return null;
}

const dosyalar = {};
for (const ad of fs.readdirSync(dizin)) {
  const anahtar = platformAnahtari(ad);
  if (!anahtar || dosyalar[anahtar]) continue;
  const tam = path.join(dizin, ad);
  if (!fs.statSync(tam).isFile()) continue;
  dosyalar[anahtar] = {
    ad,
    url: indirmeKoku + '/' + encodeURIComponent(ad),
    boyut: fs.statSync(tam).size,
    sha512: sha512(tam)
  };
  console.log('  ' + anahtar.padEnd(14) + ad);
}

if (!Object.keys(dosyalar).length) {
  console.error('Dizinde kurulum paketi bulunamadı: ' + dizin);
  process.exit(1);
}

const simdi = new Date();
const bitis = new Date(simdi.getTime() + gun * 86400000);

const manifest = {
  surum,
  kanal,
  yayinTarihi: simdi.toISOString(),
  // Dondurma saldırısına karşı: istemci süresi geçmiş manifesti kabul etmez.
  // Süre dolmadan yeni bir manifest yayınlamayı unutmayın.
  gecerlilikBitisi: bitis.toISOString(),
  notlar: process.env.PUSULA_NOTLAR || '',
  dosyalar
};
if (enDusuk) manifest.enDusukSurum = enDusuk;

// İmza, dosyanın HAM baytları üzerinde: istemci de aynı baytları doğruluyor.
const ham = JSON.stringify(manifest, null, 2) + '\n';
const ozel = crypto.createPrivateKey(fs.readFileSync(anahtarYolu, 'utf8'));
if (ozel.asymmetricKeyType !== 'ed25519') {
  console.error('Özel anahtar Ed25519 olmalı.');
  process.exit(1);
}
const imza = crypto.sign(null, Buffer.from(ham), ozel).toString('base64');

const manifestYolu = path.join(dizin, 'pusula-guncelleme.json');
fs.writeFileSync(manifestYolu, ham, 'utf8');
fs.writeFileSync(manifestYolu + '.imza', imza + '\n', 'utf8');

console.log('');
console.log('Sürüm      : ' + surum + ' (' + kanal + ')');
console.log('Geçerlilik : ' + bitis.toISOString().slice(0, 10) + ' tarihine kadar');
console.log('Yazıldı    : ' + manifestYolu);
console.log('             ' + manifestYolu + '.imza');
console.log('');
console.log('Bu iki dosyayı paketlerle birlikte şuraya yükleyin: ' + indirmeKoku);
