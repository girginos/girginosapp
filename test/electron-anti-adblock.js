'use strict';

/*
 * ANTI-ADBLOCK KARŞI-ÖNLEMİ: KULLANICI ÖRTÜYÜ GÖRÜYOR MU?
 *
 * "İkisi birden" hedefi: proaktif katman yem ölçümünü kandırıp örtünün hiç
 * çıkmamasını dener; kaçırırsa yedek katman çıkan örtüyü görünmeden kaldırır.
 * Bu yüzden ölçü, sayfanın yazdığı bir başlık DEĞİL - örtünün gerçek
 * görünürlüğü: DOM'da var mı ve display:none değil mi.
 *
 * blackhatworld'ün ölçülen tekniğini taklit eden sentetik sayfalar; kozmetik
 * CSS yem sınıflarını gizliyor (gerçek senaryo).
 *
 *   A) karşı-önlem YOK  -> örtü GÖRÜNÜR (mekanizma gerçekten tetikleniyor)
 *   B) karşı-önlem VAR  -> örtü GÖRÜNMEZ (proaktif engeller ya da yedek kaldırır)
 *   C) doğrudan örtü    -> proaktifin göremediği örtü de GÖRÜNMEZ (yedek)
 *   D) false-positive   -> "Çerez" metinli meşru modal GÖRÜNÜR kalır
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { app, session, BrowserWindow } = require('electron');

const { preloadKaynagi } = require('../src/anti-adblock');

const PORT = 8825;

// Kozmetik CSS'imizin gizlediği yem sınıfları (blackhatworld'ünkiler). Sayfaya
// gömülü: gerçekte de kozmetik uygulanıyor, testte insertCSS yarışını eler.
const YEM_CSS = '.topRightAd,.adbox2,.cpmstarHeadline,.ads336_280,.ad-120-60,.adsbox'
  + '{display:none!important}';

// blackhatworld tekniğini taklit eden tespit sayfası: yem gizliyse örtü ekler.
const TESPIT = `<!doctype html><meta charset="utf-8"><title>tespit</title>
<style>${YEM_CSS}</style>
<div id="icerik">gerçek içerik</div>
<script>
  var yem = document.createElement('div');
  yem.className = 'topRightAd adbox2 cpmstarHeadline ads336_280 ad-120-60 adsbox';
  yem.innerHTML = '&nbsp;';
  yem.style.cssText = 'width:300px;height:250px;position:absolute;left:-999px';
  document.body.appendChild(yem);
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    var gizli = getComputedStyle(yem).display === 'none' || yem.offsetHeight === 0
      || yem.getBoundingClientRect().height === 0;
    if (gizli) {
      var o = document.createElement('div');
      o.setAttribute('data-ortu', '1');
      o.textContent = 'AdBlock Detected — please disable your ad blocker';
      o.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#c00;color:#fff';
      document.body.appendChild(o);
    }
  }); });
</script>`;

// Proaktifin kandıramayacağı örtü: doğrudan JS ile, yem ölçümü olmadan.
const DOGRUDAN = `<!doctype html><meta charset="utf-8"><title>dogrudan</title>
<div id="icerik">içerik</div>
<script>
  var o = document.createElement('div');
  o.setAttribute('data-ortu', '1');
  o.textContent = 'AdBlock Detected. Turn off your ad blocker to continue.';
  o.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000;color:#fff';
  document.documentElement.style.overflow = 'hidden';
  document.body.appendChild(o);
</script>`;

// Meşru tam-ekran modal: adblock DEĞİL. GÖRÜNÜR kalmalı.
const MODAL = `<!doctype html><meta charset="utf-8"><title>modal</title>
<div id="icerik">içerik</div>
<script>
  var o = document.createElement('div');
  o.setAttribute('data-modal', '1');
  o.textContent = 'Çerez tercihleri — sitemiz çerez kullanır. Kabul ediyor musunuz?';
  o.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;color:#000';
  document.body.appendChild(o);
</script>`;

const sunucu = http.createServer((istek, yanit) => {
  const yol = istek.url.split('?')[0];
  const gonder = (govde) => {
    yanit.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    yanit.end(govde);
  };
  if (yol === '/tespit') return gonder(TESPIT);
  if (yol === '/dogrudan') return gonder(DOGRUDAN);
  if (yol === '/modal') return gonder(MODAL);
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

// İşaretli ögenin GÖRÜNÜR olup olmadığı: yok ya da display:none -> görünmez.
function gorunurKod(secici) {
  return '(() => { var e = document.querySelector(' + JSON.stringify('[' + secici + ']') + ');'
    + ' if (!e) return { durum: "yok", gorunur: false };'
    + ' var d = getComputedStyle(e).display;'
    + ' return { durum: d, gorunur: d !== "none" }; })()';
}

async function ac(ses, url, kozmetikMi, secici) {
  const pen = new BrowserWindow({ show: true, width: 900, height: 700, webPreferences: { session: ses } });
  const wc = pen.webContents;
  if (kozmetikMi) wc.on('did-navigate', () => { wc.insertCSS(YEM_CSS, { cssOrigin: 'user' }).catch(() => {}); });
  await wc.loadURL(url).catch(() => {});
  // Örtü window load + gecikmeli tarama sonrası kesinleşsin diye bekle.
  await bekle(3000);
  const g = await wc.executeJavaScript(gorunurKod(secici), false)
    .catch((e) => ({ durum: 'HATA:' + e.message, gorunur: null }));
  const yem = await wc.executeJavaScript('window.__pusulaAA ? window.__pusulaAA.yem : -1', false).catch(() => -2);
  pen.destroy();
  return { g, yem };
}

app.whenReady().then(async () => {
  await new Promise((c) => sunucu.listen(PORT, '127.0.0.1', c));
  const preloadYol = path.join(os.tmpdir(), 'aa-preload-' + process.pid + '.js');
  fs.writeFileSync(preloadYol, preloadKaynagi(), 'utf8');
  const kok = 'http://127.0.0.1:' + PORT;

  /* A) Karşı-önlem YOK: kozmetik yem'i gizler, örtü görünür kalmalı (kontrol). */
  const sesA = session.fromPartition('aa-A-' + process.pid);
  const rA = await ac(sesA, kok + '/tespit', true, 'data-ortu');
  bak('kontrol: karşı-önlem yokken örtü görünür', rA.g.gorunur, true);

  /* B) Karşı-önlem VAR: örtü görünmez (proaktif engeller ya da yedek kaldırır). */
  const sesB = session.fromPartition('aa-B-' + process.pid);
  sesB.registerPreloadScript({ type: 'frame', id: 'anti-adblock', filePath: preloadYol });
  const rB = await ac(sesB, kok + '/tespit', true, 'data-ortu');
  bak('karşı-önlemle örtü görünmez', rB.g.gorunur, false);
  console.log('  [bilgi] B örtü durumu=' + rB.g.durum + ' proaktifYemSayac=' + rB.yem);

  /* C) Doğrudan örtü: proaktifin göremediği örtü de görünmez (yedek). */
  const sesC = session.fromPartition('aa-C-' + process.pid);
  sesC.registerPreloadScript({ type: 'frame', id: 'anti-adblock', filePath: preloadYol });
  const rC = await ac(sesC, kok + '/dogrudan', false, 'data-ortu');
  bak('yedek: doğrudan örtü görünmez', rC.g.gorunur, false);

  /* D) False-positive: meşru çerez modalı GÖRÜNÜR kalmalı. */
  const sesD = session.fromPartition('aa-D-' + process.pid);
  sesD.registerPreloadScript({ type: 'frame', id: 'anti-adblock', filePath: preloadYol });
  const rD = await ac(sesD, kok + '/modal', false, 'data-modal');
  bak('false-positive: çerez modalı korundu', rD.g.gorunur, true);

  console.log('\n' + sonuc.join('\n'));
  const hata = sonuc.filter((s) => s.startsWith('  HATA')).length;
  console.log('\n' + (hata ? hata + ' KONTROL BAŞARISIZ' : 'hepsi geçti (' + sonuc.length + ')'));

  sunucu.close();
  try { fs.unlinkSync(preloadYol); } catch { /* olsun */ }
  app.exit(hata ? 1 : 0);
});
