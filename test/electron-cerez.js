'use strict';

/*
 * Gerçek ölçüm: akıllı çerez sistemi tel üzerinde çalışıyor mu?
 *
 * Tek bir HTTP sunucusu iki farklı ana makine adıyla konuşuluyor:
 *   localhost  -> birinci taraf (sekmedeki sayfa)
 *   127.0.0.1  -> üçüncü taraf (iframe ve img)
 * kokAlanAdi bunlari farkli kok sayar, yani gercek bir siteler arasi durum.
 *
 * CEREZLER SameSite=None; Secure. Aksi halde Chromium varsayilan Lax'i uygular
 * ve cerezi ZATEN gondermez; o zaman "bizim kod kesti" ile "tarayici zaten
 * gondermiyordu" birbirinden ayirt edilemez. http://127.0.0.1 guvenli baglam
 * sayildigi icin Secure cerez burada kabul ediliyor.
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { app, session, BrowserWindow } = require('electron');

const { Store } = require('../src/store');
const { Blocker } = require('../src/blocker');

const PORT = 8801;
const kayit = { pxCerez: null, cerceveCerez: null, ustCerez: null };
let sayac = 0;

const sunucu = http.createServer((istek, yanit) => {
  const yol = istek.url.split('?')[0];
  const cerez = istek.headers.cookie || '';

  if (yol === '/ilk') {
    // Üçüncü taraf alan adına BİRİNCİ taraf olarak çerez ekiyoruz.
    yanit.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'kimlik=abc; Path=/; SameSite=None; Secure' });
    return yanit.end('<h1>ilk</h1>');
  }
  if (yol === '/ana') {
    // Onbellek olcumu bozar: ikinci ziyarette istek hic aga cikmaz ve
    // "cerez gelmedi" ile "istek gelmedi" birbirine karisir.
    const tur = String(++sayac);
    yanit.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    return yanit.end(
      '<h1>ana</h1>' +
      '<img src="http://127.0.0.1:' + PORT + '/px?n=' + tur + '">' +
      '<iframe src="http://127.0.0.1:' + PORT + '/cerceve?n=' + tur + '"></iframe>'
    );
  }
  if (yol === '/px') {
    kayit.pxCerez = cerez;
    yanit.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store', 'Set-Cookie': 'yeni=1; Path=/; SameSite=None; Secure' });
    return yanit.end('');
  }
  if (yol === '/cerceve') {
    kayit.cerceveCerez = cerez;
    yanit.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Set-Cookie': 'cerceve=1; Path=/; SameSite=None; Secure' });
    return yanit.end('<p>cerceve</p>');
  }
  if (yol === '/ust') {
    // Üst seviye gezinme: burada çerez GELMELİ.
    kayit.ustCerez = cerez;
    yanit.writeHead(200, { 'Content-Type': 'text/html' });
    return yanit.end('<h1>ust</h1>');
  }
  yanit.writeHead(404);
  yanit.end('');
});

function bekle(ms) { return new Promise((c) => setTimeout(c, ms)); }

app.whenReady().then(async () => {
  await new Promise((c) => sunucu.listen(PORT, c));

  const dosya = path.join(os.tmpdir(), 'cerez-olcum-' + process.pid + '.json');
  const store = new Store(dosya);
  const ses = session.fromPartition('cerez-olcum-' + process.pid);
  const blocker = new Blocker(store);
  blocker.bagla(ses, () => {});

  const pen = new BrowserWindow({ show: false, webPreferences: { session: ses } });
  const wc = pen.webContents;
  wc.on('did-navigate', (_o, url) => blocker.ustAlanAyarla(wc.id, url));

  const yukle = async (url) => {
    await wc.loadURL(url);
    await bekle(600);
  };

  const sonuc = [];
  const bak = (ad, bulunan, beklenen) => {
    const tamam = bulunan === beklenen;
    sonuc.push((tamam ? '  ok  ' : '  HATA') + ' ' + ad +
      (tamam ? '' : '\n        bulunan: ' + JSON.stringify(bulunan) +
                    '\n        beklenen: ' + JSON.stringify(beklenen)));
    return tamam;
  };

  /* 1) Üçüncü taraf alan adına birinci taraf olarak çerez ek. */
  await yukle('http://127.0.0.1:' + PORT + '/ilk');
  const ekildi = await ses.cookies.get({ name: 'kimlik' });
  bak('hazırlık: çerez ekildi', ekildi.length, 1);

  /* 2) Ayar AÇIK: üçüncü taraf isteklerinde çerez taşınmamalı. */
  kayit.pxCerez = null; kayit.cerceveCerez = null;
  await yukle('http://localhost:' + PORT + '/ana');
  bak('hazırlık: img isteği geldi', kayit.pxCerez !== null, true);
  bak('açıkken img çerezi taşımaz', kayit.pxCerez, '');
  bak('açıkken iframe çerezi taşımaz', kayit.cerceveCerez, '');

  const yeniler = await ses.cookies.get({ name: 'yeni' });
  bak('açıkken üçüncü taraf Set-Cookie yazamaz', yeniler.length, 0);
  const cerceveler = await ses.cookies.get({ name: 'cerceve' });
  bak('açıkken iframe Set-Cookie yazamaz', cerceveler.length, 0);

  /* 3) Üst seviye gezinme muaf: çerez GELMELİ. */
  kayit.ustCerez = null;
  await yukle('http://127.0.0.1:' + PORT + '/ust');
  bak('üst seviye gezinmede çerez taşınır', /kimlik=abc/.test(kayit.ustCerez || ''), true);

  /* 4) Site istisnası: localhost için izin verilince taşınmalı. */
  store.cerezIstisnasiDegistir('localhost');
  kayit.pxCerez = null;
  await yukle('http://localhost:' + PORT + '/ana');
  bak('istisna: img isteği geldi', kayit.pxCerez !== null, true);
  bak('istisna verilen sitede çerez taşınır', /kimlik=abc/.test(kayit.pxCerez || ''), true);
  store.cerezIstisnasiDegistir('localhost');

  /* 5) Ayar KAPALI: eski davranış geri gelmeli. */
  store.ayarla('ucuncuTarafCerez', false);
  kayit.pxCerez = null;
  await yukle('http://localhost:' + PORT + '/ana');
  bak('kapalı: img isteği geldi', kayit.pxCerez !== null, true);
  bak('ayar kapalıyken çerez taşınır', /kimlik=abc/.test(kayit.pxCerez || ''), true);
  const yeni2 = await ses.cookies.get({ name: 'yeni' });
  bak('ayar kapalıyken Set-Cookie geçer', yeni2.length, 1);
  store.ayarla('ucuncuTarafCerez', true);

  /* 6) Kapanışta silme: korunan kök kalır, gerisi gider. */
  const { silinecekCerezler, cerezSilmeUrl } = require('../src/cerezler');
  const { kokAlanAdi } = require('../src/blocker');
  // localhost'a da birinci taraf cerez ek: silinmesi gerekeni olcebilmek icin
  // KORUNMAYAN bir kok lazim. Ayni hosttaki cerezle olcmek, korumanin dogru
  // calistigini degil, testin kendi kendini onayladigini gosterirdi.
  await yukle('http://localhost:' + PORT + '/ilk');
  store.yerImiDegistir('http://127.0.0.1:' + PORT + '/ilk', 'korunan');
  const korunan = store.korunanCerezKokleri(kokAlanAdi);
  const hepsi = await ses.cookies.get({});
  const silinecek = silinecekCerezler(hepsi, korunan, kokAlanAdi);
  await Promise.all(silinecek.map((c) => {
    const adres = cerezSilmeUrl(c);
    return adres ? ses.cookies.remove(adres, c.name).catch(() => {}) : null;
  }));
  const kalanKorunan = await ses.cookies.get({ domain: '127.0.0.1' });
  bak('yer imindeki sitenin çerezi korunur', kalanKorunan.length > 0, true);
  const kalanYerel = await ses.cookies.get({ domain: 'localhost' });
  bak('korunmayan çerez silinir', kalanYerel.length, 0);

  console.log('\n' + sonuc.join('\n'));
  const hata = sonuc.filter((s) => s.startsWith('  HATA')).length;
  console.log('\n' + (hata ? hata + ' KONTROL BAŞARISIZ' : 'hepsi geçti (' + sonuc.length + ')'));

  try { fs.unlinkSync(dosya); } catch { /* olsun */ }
  sunucu.close();
  app.exit(hata ? 1 : 0);
});
