'use strict';

/*
 * Vekil GERÇEKTEN bütün oturumları kapsıyor mu?
 *
 * Yerel bir HTTP vekili açılıyor ve uygulamanın kullandığı her oturumdan istek
 * atılıyor. Ölçülen şey "setProxy hata vermedi" değil - VEKİLE İSTEK ULAŞTI MI.
 * Bir oturum listeden unutulursa burada görünür: istek vekile hiç uğramaz,
 * doğrudan hedef sunucuya gider.
 *
 * Oturum adları test/sozlesme.js'teki denetimle aynı kaynaktan (main.js) değil,
 * BİLEREK elle yazıldı: iki taraf da aynı listeden okusaydı, liste eksik olduğu
 * hâlde ikisi de "tutarlı" derdi.
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { app, session } = require('electron');

const { Store } = require('../src/store');
const { vekilKurallari } = require('../src/vekil');

const VEKIL_PORT = 8805;
const HEDEF_PORT = 8806;

const OTURUMLAR = ['persist:pusula', 'liste-indirme', 'electron-updater'];

const vekileGelen = [];
const dogrudanGelen = [];

// Vekilin kendisi: mutlak URL ile gelen istekleri karşılar (http vekil protokolü).
const vekil = http.createServer((istek, yanit) => {
  vekileGelen.push(istek.url);
  yanit.writeHead(200, { 'Content-Type': 'text/plain' });
  yanit.end('vekilden');
});

// Hedef sunucu: buraya DOĞRUDAN gelen istek, vekilden kaçmış demektir.
const hedef = http.createServer((istek, yanit) => {
  dogrudanGelen.push(istek.url);
  yanit.writeHead(200, { 'Content-Type': 'text/plain' });
  yanit.end('dogrudan');
});

app.on('window-all-closed', () => {});

const sonuc = [];
function bak(ad, bulunan, beklenen) {
  const tamam = bulunan === beklenen;
  sonuc.push((tamam ? '  ok   ' : '  HATA ') + ad +
    (tamam ? '' : '\n         bulunan: ' + JSON.stringify(bulunan) +
                  '\n         beklenen: ' + JSON.stringify(beklenen)));
}

/*
 * Firlatan bir regresyon testi ASMASIN.
 *
 * Olculdu: main sureçteki bir istisna yalnizca bir uyari basiyor; ozet hic
 * yazilmiyor, app.exit() hic cagrilmiyor ve surec sonsuza kadar bekliyor.
 * Yanlis deger donduren regresyon basarisiz oluyordu, FIRLATAN regresyon ise
 * CI'i durduruyordu.
 */
function olumcul(neden, hata) {
  console.error('\n  HATA ' + neden + ': ' + ((hata && hata.stack) || hata));
  app.exit(1);
}
process.on('unhandledRejection', (h) => olumcul('yakalanmamis reddetme', h));
process.on('uncaughtException', (h) => olumcul('yakalanmamis istisna', h));

// Sessizce asilma ihtimaline karsi ust sinir.
const OLCUM_SINIRI_MS = Number(process.env.OLCUM_SINIRI_MS || 120000);
setTimeout(() => olumcul('sure asimi (' + OLCUM_SINIRI_MS + ' ms)', new Error('test bitmedi')),
  OLCUM_SINIRI_MS).unref();

app.whenReady().then(async () => {
  await new Promise((c) => vekil.listen(VEKIL_PORT, '127.0.0.1', c));
  await new Promise((c) => hedef.listen(HEDEF_PORT, '127.0.0.1', c));

  const dosya = path.join(os.tmpdir(), 'vekil-olcum-' + process.pid + '.json');
  const store = new Store(dosya);

  const oturumlar = () => [
    session.defaultSession,
    ...OTURUMLAR.map((ad) => session.fromPartition(ad, { cache: ad !== 'electron-updater' }))
  ];

  const uygula = async () => {
    const k = vekilKurallari(store.ayarlar);
    const ayar = { mode: k.mode };
    if (k.proxyRules) {
      ayar.proxyRules = k.proxyRules;
      ayar.proxyBypassRules = k.proxyBypassRules;
    }
    for (const o of oturumlar()) await o.setProxy(ayar);
  };

  /*
   * Hedef 127.0.0.1 ama atlama listesi yerel adresleri vekilin dışında tutuyor;
   * ölçüm için ana makine adı olarak "deneme.test" kullanılıyor ve o ad
   * çözülmediği için istek zaten yalnızca vekil üzerinden gidebilir. Doğrudan
   * bağlantıyı ölçmek için de gerçek 127.0.0.1 adresi kullanılıyor.
   */
  const cek = async (oturum, url) => {
    try {
      const y = await oturum.fetch(url, { cache: 'no-store' });
      return await y.text();
    } catch (e) {
      return 'hata: ' + e.message;
    }
  };

  /* 1) Vekil kapalıyken: istek doğrudan hedefe ulaşmalı. */
  store.ayarla('vekilKip', 'kapali');
  await uygula();
  dogrudanGelen.length = 0;
  const kapaliYanit = await cek(session.defaultSession, 'http://127.0.0.1:' + HEDEF_PORT + '/kapali');
  bak('vekil kapaliyken dogrudan baglanir', kapaliYanit, 'dogrudan');

  /* 2) Vekil açık: HER oturumdan çıkan istek vekile uğramalı. */
  store.ayarla('vekilKip', 'elle');
  store.ayarla('vekilAdres', 'http://127.0.0.1:' + VEKIL_PORT);
  // Yerel atlama kuralı ölçümü bozmasın diye hedef bir ana makine adıyla anılıyor.
  store.ayarla('vekilAtla', '');
  await uygula();

  for (const ad of OTURUMLAR) {
    vekileGelen.length = 0;
    dogrudanGelen.length = 0;
    const o = session.fromPartition(ad, { cache: ad !== 'electron-updater' });
    await cek(o, 'http://deneme.test/' + ad);
    bak(ad + ' vekile ugradi', vekileGelen.length, 1);
    bak(ad + ' dogrudan gitmedi', dogrudanGelen.length, 0);
  }

  vekileGelen.length = 0;
  await cek(session.defaultSession, 'http://deneme.test/varsayilan');
  bak('varsayilan oturum vekile ugradi', vekileGelen.length, 1);

  /* 3) Atlama listesi: yazılan alan adı vekile uğramadan gitmeli. */
  store.ayarla('vekilAtla', 'atla.test');
  await uygula();
  vekileGelen.length = 0;
  const atlananYanit = await cek(session.defaultSession, 'http://atla.test/x');
  bak('atlanan alan vekile ugramaz', vekileGelen.length, 0);
  // Ad çözülemediği için bağlantı başarısız olmalı; önemli olan vekile GİTMEMESİ.
  bak('atlanan alan dogrudan denendi', atlananYanit.startsWith('hata:'), true);

  /*
   * 4) Bozuk adres DOĞRUDAN bağlanmaya düşmemeli.
   *
   * Bu, isteği göndererek ölçülemiyor: yerel adresler atlama listesinde
   * olduğu için 127.0.0.1'e giden istek zaten vekile uğramaz ve ölçüm
   * ürünün değil, testin kurgusunu doğrulardı. Onun yerine Chromium'un
   * kararı doğrudan okunuyor.
   */
  store.ayarla('vekilAtla', '');
  store.ayarla('vekilAdres', '');
  await uygula();
  const bozukKarar = await session.defaultSession.resolveProxy('http://ornek.test/');
  bak('bozuk adres DIRECT vermez', /DIRECT/.test(bozukKarar), false);
  bak('bozuk adres erisilemez vekile gider', /0\.0\.0\.0:1/.test(bozukKarar), true);

  /* 5) Kararlar doğru yere gidiyor mu? */
  store.ayarla('vekilAdres', 'http://127.0.0.1:' + VEKIL_PORT);
  store.ayarla('vekilAtla', 'atla.test');
  await uygula();
  const uzakKarar = await session.defaultSession.resolveProxy('http://ornek.test/');
  bak('uzak adres vekile gider', uzakKarar.includes('127.0.0.1:' + VEKIL_PORT), true);
  const yerelKarar = await session.defaultSession.resolveProxy('http://127.0.0.1:1/');
  bak('yerel adres dogrudan gider', /DIRECT/.test(yerelKarar), true);
  const atlananKarar = await session.defaultSession.resolveProxy('http://atla.test/');
  bak('atlanan alan dogrudan gider', /DIRECT/.test(atlananKarar), true);

  store.ayarla('vekilKip', 'kapali');
  await uygula();
  const kapaliKarar = await session.defaultSession.resolveProxy('http://ornek.test/');
  bak('vekil kapaliyken her sey dogrudan', /DIRECT/.test(kapaliKarar), true);

  console.log('\n' + sonuc.join('\n'));
  const hata = sonuc.filter((s) => s.startsWith('  HATA')).length;
  console.log('\n' + (hata ? hata + ' KONTROL BAŞARISIZ' : 'hepsi geçti (' + sonuc.length + ')'));

  vekil.close();
  hedef.close();
  try { fs.unlinkSync(dosya); } catch { /* olsun */ }
  app.exit(hata ? 1 : 0);
});
