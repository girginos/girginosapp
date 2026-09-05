'use strict';

// Güncelleme manifesti doğrulamasının testleri: node test/guncelleme.js
const crypto = require('node:crypto');
const {
  SEBEPLER, surumKarsilastir, imzaDogru, manifestDogrula, ozetEslesiyor
} = require('../src/guncelleme-dogrula');

let gecen = 0;
const hatalar = [];

function esit(ad, bulunan, beklenen) {
  if (Object.is(bulunan, beklenen)) { gecen++; return; }
  hatalar.push(ad + '\n    bulunan:  ' + JSON.stringify(bulunan) + '\n    beklenen: ' + JSON.stringify(beklenen));
}

/* ---- yardımcılar ---- */

function anahtarCifti() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    acik: publicKey.export({ type: 'spki', format: 'pem' }),
    ozel: privateKey
  };
}

function imzala(ham, ozel) {
  return crypto.sign(null, Buffer.from(ham), ozel).toString('base64');
}

const SAHTE_OZET = Buffer.alloc(64, 7).toString('base64');
const SIMDI = Date.parse('2026-09-04T12:00:00Z');

function manifestKur(degisiklik = {}) {
  return JSON.stringify({
    surum: '0.2.0',
    kanal: 'kararli',
    yayinTarihi: '2026-09-01T00:00:00Z',
    gecerlilikBitisi: '2026-10-01T00:00:00Z',
    notlar: 'Güvenlik düzeltmeleri.',
    dosyalar: {
      'win32-x64': {
        url: 'https://ornek.test/Pusula-Setup-0.2.0.exe',
        boyut: 80000000,
        sha512: SAHTE_OZET
      }
    },
    ...degisiklik
  });
}

function dogrula(ham, imza, anahtar, ek = {}) {
  return manifestDogrula({
    ham,
    imza,
    acikAnahtar: anahtar,
    mevcutSurum: '0.1.0',
    platform: 'win32-x64',
    simdi: SIMDI,
    ...ek
  });
}

/* ---- sürüm karşılaştırma ---- */

const surumTestleri = [
  ['0.2.0', '0.1.0', 1],
  ['0.1.0', '0.2.0', -1],
  ['1.0.0', '1.0.0', 0],
  ['1.10.0', '1.9.0', 1],
  ['1.0.10', '1.0.9', 1],
  ['2.0.0', '1.99.99', 1],
  ['1.0.0', '1.0.0-beta', 1],
  ['1.0.0-beta', '1.0.0', -1],
  ['1.0.0-beta.2', '1.0.0-beta.1', 1],
  ['1.0.0-alpha', '1.0.0-beta', -1],
  ['1.0.0-alpha.1', '1.0.0-alpha', 1],
  ['1.0.0-1', '1.0.0-alpha', -1],
  ['bozuk', '1.0.0', null],
  ['1.0', '1.0.0', null]
];
for (const [a, b, beklenen] of surumTestleri) {
  esit('surumKarsilastir(' + a + ', ' + b + ')', surumKarsilastir(a, b), beklenen);
}

/* ---- imza ---- */

{
  const k = anahtarCifti();
  const baska = anahtarCifti();
  const ham = manifestKur();
  const imza = imzala(ham, k.ozel);

  esit('geçerli imza kabul edilir', imzaDogru(ham, imza, k.acik), true);
  esit('başka anahtarın imzası reddedilir', imzaDogru(ham, imza, baska.acik), false);
  esit('değiştirilmiş içerik reddedilir', imzaDogru(ham + ' ', imza, k.acik), false);
  esit('bozuk base64 imza reddedilir', imzaDogru(ham, 'değil!!', k.acik), false);
  esit('kısa imza reddedilir', imzaDogru(ham, Buffer.alloc(32).toString('base64'), k.acik), false);
  esit('boş imza reddedilir', imzaDogru(ham, '', k.acik), false);

  // Ed25519 dışında bir anahtar türü kabul edilmemeli.
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  esit('RSA anahtarı reddedilir',
    imzaDogru(ham, imza, rsa.publicKey.export({ type: 'spki', format: 'pem' })), false);
}

/* ---- manifest doğrulama ---- */

{
  const k = anahtarCifti();
  const baska = anahtarCifti();

  const ham = manifestKur();
  const imza = imzala(ham, k.ozel);
  const iyi = dogrula(ham, imza, k.acik);
  esit('geçerli manifest kabul edilir', iyi.uygun, true);
  esit('sürüm okunur', iyi.surum, '0.2.0');
  esit('özet aktarılır', iyi.dosya.sha512, SAHTE_OZET);

  // İmza kapısı: içerik değişirse hiçbir alan okunmaz.
  const bozuk = manifestKur({ surum: '9.9.9' });
  esit('içerik değiştirilirse imzadan geçmez', dogrula(bozuk, imza, k.acik).sebep, SEBEPLER.IMZA);
  esit('yanlış anahtar reddedilir', dogrula(ham, imza, baska.acik).sebep, SEBEPLER.IMZA);
  esit('anahtar yoksa reddedilir',
    manifestDogrula({ ham, imza, mevcutSurum: '0.1.0', platform: 'win32-x64', simdi: SIMDI }).sebep,
    SEBEPLER.IMZA);

  // Anahtar değişimi: eski anahtarla imzalı manifest, liste ikisini de içerirken geçer.
  esit('anahtar değişiminde eski imza kabul edilir',
    manifestDogrula({
      ham, imza, acikAnahtarlar: [baska.acik, k.acik],
      mevcutSurum: '0.1.0', platform: 'win32-x64', simdi: SIMDI
    }).uygun, true);

  const yeniden = (degisiklik, ek) => {
    const h = manifestKur(degisiklik);
    return dogrula(h, imzala(h, k.ozel), k.acik, ek);
  };

  esit('aynı sürüm güncel sayılır', yeniden({ surum: '0.1.0' }).sebep, SEBEPLER.GUNCEL);
  esit('geri sürüm reddedilir', yeniden({ surum: '0.0.9' }).sebep, SEBEPLER.GERI_SURUM);
  esit('süresi geçmiş manifest reddedilir',
    yeniden({ gecerlilikBitisi: '2026-08-01T00:00:00Z' }).sebep, SEBEPLER.SURESI_GECMIS);
  esit('son kullanma tarihi yoksa reddedilir',
    yeniden({ gecerlilikBitisi: undefined }).sebep, SEBEPLER.BICIM);
  esit('bozuk sürüm alanı reddedilir', yeniden({ surum: 'x' }).sebep, SEBEPLER.BICIM);
  esit('ara sürüm gerekiyorsa atlanmaz',
    yeniden({ enDusukSurum: '0.1.5' }).sebep, SEBEPLER.ARA_SURUM);
  esit('ara sürüm koşulu sağlanıyorsa geçer',
    yeniden({ enDusukSurum: '0.1.0' }).uygun, true);
  esit('platform yoksa reddedilir',
    yeniden({ dosyalar: { 'darwin-arm64': { url: 'https://a.test/x', sha512: SAHTE_OZET } } }).sebep,
    SEBEPLER.PLATFORM_YOK);
  esit('http adres reddedilir',
    yeniden({ dosyalar: { 'win32-x64': { url: 'http://ornek.test/x.exe', sha512: SAHTE_OZET } } }).sebep,
    SEBEPLER.GUVENSIZ_ADRES);
  esit('özet yoksa reddedilir',
    yeniden({ dosyalar: { 'win32-x64': { url: 'https://ornek.test/x.exe' } } }).sebep,
    SEBEPLER.OZET_YOK);
  esit('kısa özet reddedilir',
    yeniden({ dosyalar: { 'win32-x64': { url: 'https://ornek.test/x.exe', sha512: 'AAAA' } } }).sebep,
    SEBEPLER.OZET_YOK);
  esit('farklı kanal atlanır', yeniden({ kanal: 'beta' }).sebep, SEBEPLER.GUNCEL);
  esit('beta kanalında beta manifesti geçer',
    yeniden({ kanal: 'beta' }, { kanal: 'beta' }).uygun, true);
  esit('JSON olmayan içerik reddedilir', (() => {
    const h = 'bu json değil';
    return dogrula(h, imzala(h, k.ozel), k.acik).sebep;
  })(), SEBEPLER.BICIM);
}

/* ---- indirilen paketin özeti ---- */

{
  const a = Buffer.alloc(64, 1).toString('base64');
  const b = Buffer.alloc(64, 2).toString('base64');
  esit('aynı özet eşleşir', ozetEslesiyor(a, a), true);
  esit('farklı özet eşleşmez', ozetEslesiyor(a, b), false);
  esit('boş özet eşleşmez', ozetEslesiyor(a, ''), false);
  esit('kısa özet eşleşmez', ozetEslesiyor(a, Buffer.alloc(32).toString('base64')), false);
}

/* ---- sonuç ---- */

/* ---- kurulum sessiz mi ---- */
/*
 * Sessiz kurulum bir tercih değil, davranışın kendisi: kullanıcı uygulama
 * içinde onay verdikten sonra ayrıca NSIS sihirbazıyla karşılaşmamalı.
 * Bu yüzden çağrının biçimi teste bağlanıyor; birisi isSilent'i geri
 * çevirirse burası düşer.
 */
{
  const { GuncellemeYoneticisi } = require('../src/guncelleme');
  const cagrilar = [];
  const y = new GuncellemeYoneticisi({
    app: { getVersion: () => '0.2.0', isPackaged: true, getLocale: () => 'tr' },
    oturum: {},
    degisti: () => {},
    ayarOku: () => ({})
  });
  y.autoUpdater = { quitAndInstall: (sessiz, sonraCalistir) => cagrilar.push([sessiz, sonraCalistir]) };

  y.durum = 'bosta';
  esit('hazır değilken kurmaz', y.kurVeYenidenBaslat(), false);
  esit('hazır değilken çağrı yok', cagrilar.length, 0);

  y.durum = 'hazir';
  esit('hazırken kurar', y.kurVeYenidenBaslat(), true);
  esit('sessiz kurulum', cagrilar[0][0], true);
  esit('kurulumdan sonra yeniden açılır', cagrilar[0][1], true);
}

if (hatalar.length) {
  console.error('\nBAŞARISIZ (' + hatalar.length + '):\n');
  for (const h of hatalar) console.error('  ✗ ' + h + '\n');
  process.exit(1);
}
console.log('✓ güncelleme doğrulaması: ' + gecen + ' testin hepsi geçti.');
