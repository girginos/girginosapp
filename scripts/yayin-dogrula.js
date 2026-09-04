'use strict';

/*
 * Gerçek yayın çıktıları üzerinde uçtan uca doğrulama.
 * Ağ katmanı hariç, uygulamanın güncelleme kapısındaki her adımı
 * dagitim/ altındaki asıl dosyalarla çalıştırır.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { manifestDogrula, ozetEslesiyor, SEBEPLER } = require('../src/guncelleme-dogrula');

const DIZIN = path.join(__dirname, '..', 'dagitim');
const ham = fs.readFileSync(path.join(DIZIN, 'pusula-guncelleme.json'), 'utf8');
const imza = fs.readFileSync(path.join(DIZIN, 'pusula-guncelleme.json.imza'), 'utf8').trim();
const ozelPem = fs.readFileSync(process.argv[2], 'utf8');
const acik = crypto.createPublicKey(ozelPem).export({ type: 'spki', format: 'pem' });

const manifest = JSON.parse(ham);
const dosya = manifest.dosyalar['win32-x64'];
const paketYolu = path.join(DIZIN, dosya.ad);

let gecen = 0;
const hatalar = [];
const esit = (ad, a, b) => {
  if (Object.is(a, b)) { gecen++; console.log('  ok  ' + ad); return; }
  hatalar.push(ad + ' -> ' + JSON.stringify(a) + ' (beklenen ' + JSON.stringify(b) + ')');
  console.log('  X   ' + ad);
};

console.log('1) Paketin diskteki gerçek özeti manifestle uyuşuyor mu?');
const gercekOzet = crypto.createHash('sha512').update(fs.readFileSync(paketYolu)).digest('base64');
esit('sha512 paket == manifest', gercekOzet === dosya.sha512, true);

console.log('2) electron-builder beslemesi ile imzalı manifest aynı paketi mi gösteriyor?');
const latest = fs.readFileSync(path.join(DIZIN, 'latest.yml'), 'utf8');
const latestOzet = /^sha512:\s*(\S+)\s*$/m.exec(latest)[1];
esit('sha512 latest.yml == manifest', ozetEslesiyor(dosya.sha512, latestOzet), true);
esit('sürüm latest.yml == manifest', /^version:\s*(\S+)/m.exec(latest)[1], manifest.surum);

console.log('3) İmza doğrulaması (gerçek baytlar)');
const eski = { ham, imza, acikAnahtar: acik, mevcutSurum: '0.0.9', platform: 'win32-x64' };
esit('geçerli imza + eski kurulum -> güncelleme uygun', manifestDogrula(eski).uygun, true);
esit('bulunan sürüm doğru', manifestDogrula(eski).surum, manifest.surum);

console.log('4) Sunucu ele geçirilmiş senaryoları');
// Tek bayt değişimi: boyut alanındaki rakamı büyüt.
const kurcalanmis = ham.replace('"boyut": ' + dosya.boyut, '"boyut": ' + (dosya.boyut + 1));
esit('içerik değişince imza tutmaz',
  manifestDogrula({ ...eski, ham: kurcalanmis }).sebep, SEBEPLER.IMZA);

const baskaAnahtar = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
esit('başka anahtarla imza kabul edilmez',
  manifestDogrula({ ...eski, acikAnahtar: baskaAnahtar }).sebep, SEBEPLER.IMZA);

// Saldırgan indirme adresini kendi sunucusuna çevirirse imza bozulur.
const adresDegisik = ham.replace(dosya.url, 'https://saldirgan.test/kotu.exe');
esit('indirme adresi değiştirilirse reddedilir',
  manifestDogrula({ ...eski, ham: adresDegisik }).sebep, SEBEPLER.IMZA);

console.log('5) Sürüm ve tarih kapıları');
esit('aynı sürümde güncelleme yok',
  manifestDogrula({ ...eski, mevcutSurum: manifest.surum }).sebep, SEBEPLER.GUNCEL);
esit('daha yeni kurulum geri sürüme düşürülmez',
  manifestDogrula({ ...eski, mevcutSurum: '9.9.9' }).sebep, SEBEPLER.GERI_SURUM);
const sonra = Date.parse(manifest.gecerlilikBitisi) + 86400000;
esit('süresi geçmiş manifest reddedilir (dondurma saldırısı)',
  manifestDogrula({ ...eski, simdi: sonra }).sebep, SEBEPLER.SURESI_GECMIS);

console.log('6) İndirilen paketin son kapısı');
esit('doğru özet geçer', ozetEslesiyor(dosya.sha512, gercekOzet), true);
esit('değiştirilmiş paket geçmez',
  ozetEslesiyor(dosya.sha512, crypto.createHash('sha512').update('kotu').digest('base64')), false);

console.log('');
if (hatalar.length) {
  console.error('BAŞARISIZ (' + hatalar.length + '):');
  for (const h of hatalar) console.error('  ' + h);
  process.exit(1);
}
console.log('✓ yayın zinciri: ' + gecen + ' kontrolün hepsi gerçek çıktılarla geçti.');
console.log('  paket : ' + path.basename(paketYolu) + ' (' + (fs.statSync(paketYolu).size / 1048576).toFixed(1) + ' MB)');
