'use strict';

/*
 * Canlı besleme doğrulaması.
 *
 * Uygulamanın güncelleme kapısını, sunucudan GERÇEKTEN indirilen manifest ve
 * imza baytları üzerinde çalıştırır. Yerel dosyalara bakmaz: amaç, yüklerken
 * bir şeyin bozulmadığını ve gömülü anahtarın sunucudaki imzayı tanıdığını
 * kanıtlamak.
 */

const https = require('node:https');
const path = require('node:path');


const { manifestDogrula, SEBEPLER } = require('../src/guncelleme-dogrula');
const anahtarlar = require('../src/guncelleme-anahtar');

const FEED = anahtarlar.FEED_ADRESI;

function cek(url) {
  return new Promise((coz, red) => {
    https.get(url, { headers: { 'User-Agent': 'GirginosBrowser/canli-dogrula' } }, (y) => {
      if (y.statusCode !== 200) { y.resume(); return red(new Error(url + ' -> HTTP ' + y.statusCode)); }
      const parcalar = [];
      y.on('data', (p) => parcalar.push(p));
      y.on('end', () => coz(Buffer.concat(parcalar)));
    }).on('error', red);
  });
}

let gecen = 0;
const hatalar = [];
function esit(ad, a, b) {
  if (Object.is(a, b)) { gecen++; console.log('  ok  ' + ad); return; }
  hatalar.push(ad);
  console.log('  X   ' + ad + ' -> ' + JSON.stringify(a) + ' (beklenen ' + JSON.stringify(b) + ')');
}

(async () => {
  console.log('Besleme: ' + FEED + '\n');
  console.log('0) Gömülü yapılandırma');
  esit('güncelleme sistemi açık', anahtarlar.yapilandirilmisMi(), true);
  esit('feed https', /^https:\/\//.test(FEED), true);

  console.log('\n1) Sunucudan çekiliyor');
  const ham = await cek(FEED + '/pusula-guncelleme.json');
  const imza = (await cek(FEED + '/pusula-guncelleme.json.imza')).toString('utf8').trim();
  console.log('  manifest ' + ham.length + " bayt, imza " + imza.length + ' karakter');

  console.log('\n2) İmza, uygulamanın içindeki anahtarla doğrulanıyor');
  const sonuc = manifestDogrula({
    ham, imza,
    acikAnahtarlar: anahtarlar.ACIK_ANAHTARLAR,
    mevcutSurum: '0.0.9',              // eski kurulum: güncelleme görmeli
    kanal: 'kararli',
    platform: 'win32-x64'
  });
  esit('manifest kabul edildi', sonuc.uygun, true);
  if (!sonuc.uygun) console.log('  sebep: ' + sonuc.sebep);
  esit('bulunan sürüm', sonuc.surum, '0.1.0');

  console.log('\n3) Aynı sürümdeki kurulum güncelleme görmemeli');
  const ayni = manifestDogrula({
    ham, imza,
    acikAnahtarlar: anahtarlar.ACIK_ANAHTARLAR,
    mevcutSurum: '0.1.0', kanal: 'kararli', platform: 'win32-x64'
  });
  esit('güncelleme yok', ayni.uygun, false);
  esit('sebep = güncel', ayni.sebep, SEBEPLER.GUNCEL);

  console.log('\n4) Sunucu ele geçirilmiş gibi: manifest tek bayt değişirse');
  const bozuk = Buffer.from(ham);
  const i = bozuk.indexOf('0.1.0');
  bozuk[i + 4] = '9'.charCodeAt(0);   // sürümü 0.1.9 yap
  const sahte = manifestDogrula({
    ham: bozuk, imza,
    acikAnahtarlar: anahtarlar.ACIK_ANAHTARLAR,
    mevcutSurum: '0.0.9', kanal: 'kararli', platform: 'win32-x64'
  });
  esit('değiştirilmiş manifest reddedildi', sahte.uygun, false);
  esit('sebep = imza', sahte.sebep, SEBEPLER.IMZA);

  console.log('\n5) electron-updater beslemesi aynı paketi mi gösteriyor?');
  const latest = (await cek(FEED + '/latest.yml')).toString('utf8');
  const latestOzet = /^sha512:\s*(\S+)\s*$/m.exec(latest)[1];
  const manifest = JSON.parse(ham.toString('utf8'));
  esit('sha512 latest.yml == manifest', latestOzet, manifest.dosyalar['win32-x64'].sha512);
  esit('sürüm latest.yml == manifest', /^version:\s*(\S+)/m.exec(latest)[1], manifest.surum);

  console.log('\n6) Paketin ilk baytları gerçekten indirilebiliyor mu (Range)');
  const parca = await new Promise((coz, red) => {
    https.get(manifest.dosyalar['win32-x64'].url, { headers: { Range: 'bytes=0-1' } }, (y) => {
      const p = [];
      y.on('data', (d) => p.push(d));
      y.on('end', () => coz({ kod: y.statusCode, veri: Buffer.concat(p) }));
    }).on('error', red);
  });
  esit('kısmi içerik (206)', parca.kod, 206);
  esit('MZ başlığı (Windows çalıştırılabilir)', parca.veri.toString('latin1'), 'MZ');

  console.log('');
  if (hatalar.length) {
    console.log('X ' + hatalar.length + ' kontrol BAŞARISIZ: ' + hatalar.join(', '));
    process.exit(1);
  }
  console.log('\u2713 canlı besleme: ' + gecen + ' kontrolün hepsi geçti.');
})().catch((e) => { console.error('HATA: ' + e.message); process.exit(1); });
