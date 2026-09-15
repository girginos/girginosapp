'use strict';

/*
 * SIZINTI KAPISI (commit aşaması).
 *
 * Bu depo HERKESE AÇIK. Yayın zincirinin tamamı tek bir Ed25519 özel
 * anahtarına dayanıyor ve sunucu parolaları elle taşınıyor. Bunlardan biri
 * yanlışlıkla commit edilirse geri almak mümkün değildir: git geçmişinden
 * silinse bile push edildiği an kopyalanmış sayılır.
 *
 * Bu yüzden kapı commit'ten ÖNCE: git'in izlediği dosyalarda anahtar/parola
 * kalıbı arar. Yalnızca izlenen dosyalara bakar (dagitim/, node_modules/
 * zaten dışarıda).
 *
 * YANLIŞ POZİTİF politikası: bir kalıp yanlış yere basıyorsa kalıbı gevşetmek
 * yerine dosyayı BEYAZ LİSTEye gerekçesiyle ekleyin. Gevşetilen kalıp sessizce
 * her şeyi kaçırmaya başlar.
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..');

const KALIPLAR = [
  { ad: 'PEM özel anahtar', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/ },
  { ad: 'PuTTY özel anahtar', re: /PuTTY-User-Key-File-\d/ },
  { ad: 'AWS erişim anahtarı', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { ad: 'GitHub belirteci', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { ad: 'Slack belirteci', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  /*
   * "parola = 'xxx'" / "password: "xxx"" gibi gömülü sırlar.
   * Değerde < > $ { } YASAK: bunlar yer tutucu sözdizimidir (`<bitis>.<mac>`,
   * `${PAROLA}`) ve gerçek bir sır olamaz. Bu gevşetme değil hassasiyet artışı;
   * kalıp hâlâ 8+ karakterlik gerçek değerleri yakalıyor (kontrol kolu ile
   * doğrulandı: sahte bir parola eklenince bulgu sayısı arttı).
   */
  {
    ad: 'gömülü parola',
    re: /\b(?:parola|sifre|şifre|password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*["'][^"'\s<>${}]{8,}["']/i,
  },
  // plink/pscp/ssh komut satırında parola.
  { ad: 'komut satırında parola', re: /-pw\s+["']?[^\s"']{6,}/ },
  // 32+ haneli hex: HMAC secret / istatistik anahtarı biçimi.
  { ad: 'uzun hex sır', re: /\b[0-9a-f]{64,}\b/ },
];

/*
 * BEYAZ LİSTE: dosya -> hangi kalıp ve neden.
 * Her satır gerekçeli olmalı.
 */
const BEYAZ_LISTE = [
  {
    dosya: 'scripts/sizinti-tara.js',
    kalip: null,
    sebep: 'Kalıpların kendisi burada tanımlı; kendi kendini bulur.',
  },
  {
    dosya: 'src/guncelleme-anahtar.js',
    kalip: 'uzun hex sır',
    sebep: 'Gömülü AÇIK anahtar (base64/hex). Açık anahtarın sızması diye bir '
      + 'şey yok; zaten her kurulumda dağıtılıyor. Özel anahtar repo DIŞINDA.',
  },
];

function izlenenDosyalar() {
  const cikti = execSync('git ls-files', { cwd: KOK, encoding: 'utf8' });
  return cikti.split('\n').map((s) => s.trim()).filter(Boolean);
}

function ikiliMi(b) {
  // NUL baytı varsa ikili kabul et: ikonlar, fontlar taranmasın.
  return b.includes(0);
}

function beyazMi(dosya, kalipAdi) {
  return BEYAZ_LISTE.some((b) => b.dosya === dosya && (b.kalip === null || b.kalip === kalipAdi));
}

const bulgular = [];
let taranan = 0;

for (const dosya of izlenenDosyalar()) {
  const tam = path.join(KOK, dosya);
  let ham;
  try { ham = fs.readFileSync(tam); } catch { continue; }
  if (ikiliMi(ham)) continue;
  taranan++;
  const metin = ham.toString('utf8');
  const satirlar = metin.split('\n');
  for (const k of KALIPLAR) {
    if (beyazMi(dosya, k.ad)) continue;
    for (let i = 0; i < satirlar.length; i++) {
      if (k.re.test(satirlar[i])) {
        bulgular.push({ dosya, satir: i + 1, kalip: k.ad, ornek: satirlar[i].trim().slice(0, 90) });
      }
    }
  }
}

console.log(taranan + ' izlenen metin dosyası tarandı.');
if (!bulgular.length) {
  console.log('  ok   sır sızıntısı bulunamadı');
  process.exit(0);
}
for (const b of bulgular) {
  console.log('  HATA ' + b.dosya + ':' + b.satir + '  [' + b.kalip + ']');
  console.log('         ' + b.ornek);
}
console.log('\n' + bulgular.length + ' olası sır bulundu. Commit ETMEYİN.');
console.log('Yanlış pozitifse kalıbı gevşetmeyin; BEYAZ_LISTE\'ye gerekçesiyle ekleyin.');
process.exit(1);
