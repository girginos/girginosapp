'use strict';

/*
 * FAVICON KİMLİK KARARI GERÇEK UYGULAMADA DOĞRU MU?
 *
 * 0.4.0 favicon'u çerezsiz indirmeye çevirdi ve Cloudflare-korumalı siteler
 * ("Just a moment" 403) simgesiz kaldı. Düzeltme: kullanıcının açtığı sekmede
 * BİRİNCİ TARAF simge kimlikli iniyor (challenge çerezi yeniden kullanılsın),
 * üçüncü taraf simge ve açılış ön-ısıtması kimliksiz kalıyor.
 *
 * Bu ölçüm challenge'ı yerel taklit ediyor: /favicon.ico yalnızca "gecti"
 * çerezi varsa gerçek simge (200), yoksa 403 döner - tıpkı cf_clearance gibi.
 * Sayfa gezinmesi bir kez document.cookie ile o çerezi bırakır (challenge'ı
 * geçmiş sekme). Sonra favicon'un gelip gelmediği ÖLÇÜLÜR.
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { app, session, BrowserWindow } = require('electron');

const { FaviconDeposu } = require('../src/faviconlar');
const { Blocker } = require('../src/blocker');
const { Store } = require('../src/store');

const PORT = 8821;

// 1x1 PNG (gerçek bir görüntü; turuTespitEt bunu tanımalı).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64');

// Favicon isteğinde Cookie başlığına ne geldiğini kaydediyoruz.
const faviconCerez = {};

const sunucu = http.createServer((istek, yanit) => {
  const u = new URL(istek.url, 'http://127.0.0.1');
  if (u.pathname === '/favicon.ico') {
    const konak = (istek.headers.host || '').split(':')[0];
    faviconCerez[konak] = istek.headers.cookie || '';
    // Challenge taklidi: cerez yoksa 403, varsa gercek simge.
    if (!/gecti=1/.test(istek.headers.cookie || '')) {
      yanit.writeHead(403, { 'Content-Type': 'text/html' });
      return yanit.end('<!doctype html><title>Just a moment...</title>');
    }
    yanit.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    return yanit.end(PNG);
  }
  if (u.pathname === '/sayfa') {
    // Sayfa challenge'i gecmis gibi cerez birakir; sonra kendi <link>'ini verir.
    yanit.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return yanit.end('<!doctype html><meta charset="utf-8"><title>deneme</title>'
      + '<script>document.cookie="gecti=1;path=/";</script>');
  }
  yanit.writeHead(404); yanit.end('');
});

app.on('window-all-closed', () => {});
const bekle = (ms) => new Promise((c) => setTimeout(c, ms));

const sonuc = [];
function bak(ad, bulunan, beklenen) {
  const tamam = bulunan === beklenen;
  sonuc.push((tamam ? '  ok   ' : '  HATA ') + ad +
    (tamam ? '' : '\n         bulunan: ' + JSON.stringify(bulunan) +
                  '\n         beklenen: ' + JSON.stringify(beklenen)));
}

app.whenReady().then(async () => {
  await new Promise((c) => sunucu.listen(PORT, '127.0.0.1', c));

  const dosya = path.join(os.tmpdir(), 'fav-olcum-' + process.pid + '.json');
  const veriDizini = path.join(os.tmpdir(), 'fav-veri-' + process.pid);
  const store = new Store(dosya);
  const ses = session.fromPartition('fav-' + process.pid);

  // Engelleyici gercek yoldan bagli: favicon istegi onun cerez kapisindan gecmeli.
  const blocker = new Blocker(store);
  blocker.bagla(ses, () => {});

  const fav = new FaviconDeposu({ veriDizini, oturum: ses, degisti: () => {} });

  // Kullanicinin sekmesi: challenge'i gecip cerezi birakiyor.
  const pen = new BrowserWindow({ show: false, webPreferences: { session: ses } });
  const wc = pen.webContents;
  wc.on('did-navigate', (_o, url) => blocker.ustAlanAyarla(wc.id, url));

  const konak = '127.0.0.1';   // tek konak; birinci taraf = ayni kok
  await wc.loadURL('http://' + konak + ':' + PORT + '/sayfa');
  await bekle(500);
  const cerezVar = (await ses.cookies.get({ name: 'gecti' })).length > 0;
  bak('hazırlık: sayfa challenge çerezini bıraktı', cerezVar, true);

  /* 1) ZİYARET EDİLEN + BİRİNCİ TARAF: kimlikli inmeli, 200 almalı. */
  faviconCerez[konak] = undefined;
  await fav.kaydet(konak, 'http://' + konak + ':' + PORT + '/favicon.ico', { ziyaretEdildi: true });
  await bekle(300);
  bak('birinci taraf simge çerezle istendi', /gecti=1/.test(faviconCerez[konak] || ''), true);
  bak('birinci taraf simge diske yazıldı', fav.adres(konak) !== '', true);

  /* 2) ÜÇÜNCÜ TARAF simge: kimliksiz kalmalı (cerez GITMEMELI). */
  // Sayfa 127.0.0.1 iken localhost'tan simge = ayri kok = ucuncu taraf.
  faviconCerez['localhost'] = undefined;
  await fav.kaydet('baska-alan.test', 'http://localhost:' + PORT + '/favicon.ico', { ziyaretEdildi: true });
  await bekle(300);
  bak('üçüncü taraf simge çerezsiz istendi', faviconCerez['localhost'], '');

  /* 3) ÖN-ISITMA (ziyaretEdildi yok): birinci taraf olsa da kimliksiz. */
  // Once cerezi temizle ki gecmis istekten kalan etkiyi olcmeyelim.
  faviconCerez[konak] = undefined;
  const fav2 = new FaviconDeposu({ veriDizini: veriDizini + '2', oturum: ses, degisti: () => {} });
  await fav2.kaydet(konak, 'http://' + konak + ':' + PORT + '/favicon.ico');  // ziyaretEdildi yok
  await bekle(300);
  bak('ön-ısıtma çerezsiz istendi (kimliksiz)', faviconCerez[konak], '');

  pen.destroy();
  console.log('\n' + sonuc.join('\n'));
  const hata = sonuc.filter((s) => s.startsWith('  HATA')).length;
  console.log('\n' + (hata ? hata + ' KONTROL BAŞARISIZ' : 'hepsi geçti (' + sonuc.length + ')'));

  sunucu.close();
  try { fs.unlinkSync(dosya); } catch { /* olsun */ }
  try { fs.rmSync(veriDizini, { recursive: true, force: true }); } catch { /* olsun */ }
  try { fs.rmSync(veriDizini + '2', { recursive: true, force: true }); } catch { /* olsun */ }
  app.exit(hata ? 1 : 0);
});
