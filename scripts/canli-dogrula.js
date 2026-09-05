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

  // Sürümler manifestin kendisinden türetiliyor. Sabit yazılınca bu betik
  // yalnızca o gün yayında olan sürümde doğru çalışıyor, bir sonraki yayında
  // gerçek bir sorun yokken üç kontrolü birden düşürüyordu.
  const yayindaki = JSON.parse(ham.toString('utf8')).surum;
  // Yamayı körlemesine bir azaltmak yetmiyor: 0.2.0'da yama zaten 0 olduğu
  // için "eski kurulum" yayındakiyle aynı çıkıyor ve test kendi kendini
  // çürütüyordu. Sağdan ilk sıfır olmayan bileşeni düşürüyoruz.
  const birOncekiSurum = (s) => {
    const p = s.split('.').map(Number);
    for (let i = p.length - 1; i >= 0; i--) {
      if (p[i] > 0) {
        p[i] -= 1;
        for (let j = i + 1; j < p.length; j++) p[j] = 9;
        return p.join('.');
      }
    }
    return null;
  };
  const eskiSurum = birOncekiSurum(yayindaki);
  if (!eskiSurum) throw new Error('Yayındaki sürümden daha eskisi türetilemedi: ' + yayindaki);
  console.log('  yayındaki sürüm = ' + yayindaki + ' · eski kurulum varsayımı = ' + eskiSurum);

  console.log('\n2) İmza, uygulamanın içindeki anahtarla doğrulanıyor');
  const sonuc = manifestDogrula({
    ham, imza,
    acikAnahtarlar: anahtarlar.ACIK_ANAHTARLAR,
    mevcutSurum: eskiSurum,            // eski kurulum: güncelleme görmeli
    kanal: 'kararli',
    platform: 'win32-x64'
  });
  esit('manifest kabul edildi', sonuc.uygun, true);
  if (!sonuc.uygun) console.log('  sebep: ' + sonuc.sebep);
  esit('bulunan sürüm', sonuc.surum, yayindaki);

  console.log('\n3) Aynı sürümdeki kurulum güncelleme görmemeli');
  const ayni = manifestDogrula({
    ham, imza,
    acikAnahtarlar: anahtarlar.ACIK_ANAHTARLAR,
    mevcutSurum: yayindaki, kanal: 'kararli', platform: 'win32-x64'
  });
  esit('güncelleme yok', ayni.uygun, false);
  esit('sebep = güncel', ayni.sebep, SEBEPLER.GUNCEL);

  console.log('\n4) Sunucu ele geçirilmiş gibi: manifest tek bayt değişirse');
  const bozuk = Buffer.from(ham);
  const i = bozuk.indexOf(yayindaki);
  bozuk[i + 4] = '9'.charCodeAt(0);   // sürümü 0.1.9 yap
  const sahte = manifestDogrula({
    ham: bozuk, imza,
    acikAnahtarlar: anahtarlar.ACIK_ANAHTARLAR,
    mevcutSurum: eskiSurum, kanal: 'kararli', platform: 'win32-x64'
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
