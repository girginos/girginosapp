'use strict';

/*
 * HTML TAM EKRAN (video oynatıcının tam ekran düğmesi) ÇALIŞIYOR MU?
 *
 * Sekmeler ayrı WebContentsView; yerlesimGuncelle sayfayı her zaman chrome'un
 * altında konumluyordu, o yüzden requestFullscreen kabul edilse bile video
 * büyümüyor, araç çubuğu üstünde kalıyordu. Düzeltme: aktif sayfa HTML tam
 * ekrandayken tüm pencereyi kaplıyor (y=0) ve pencere OS tam ekrana geçiyor.
 *
 * Gerçek uygulamada, gerçek bir sayfada requestFullscreen çağrılıp ölçülüyor:
 * fullscreenElement dolar mı ve sayfanın viewport'u büyür mü (chrome + OS
 * çerçevesi kalkınca innerHeight artar).
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const KOK = path.join(__dirname, '..');
const PORT = 8838;
const DBG = 9420;

const sunucu = http.createServer((_q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  r.end('<!doctype html><meta charset="utf-8"><title>FS</title>'
    + '<body style="margin:0"><div id="oynatici" style="width:100%;height:400px;background:#000"></div>');
});

const bekle = (ms) => new Promise((c) => setTimeout(c, ms));
const sonuc = [];
function bak(ad, bulunan, beklenen) {
  const tamam = bulunan === beklenen;
  sonuc.push((tamam ? '  ok   ' : '  HATA ') + ad +
    (tamam ? '' : '\n         bulunan: ' + JSON.stringify(bulunan) +
                  '\n         beklenen: ' + JSON.stringify(beklenen)));
}

function cdp(ws, ifade, jest) {
  return new Promise((coz, red) => {
    let s;
    try { s = new WebSocket(ws); } catch (e) { return red(e); }
    const t = setTimeout(() => { try { s.close(); } catch { /* kapali */ } red(new Error('zaman')); }, 10000);
    s.onerror = () => { clearTimeout(t); red(new Error('wserr')); };
    s.onopen = () => s.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: ifade, returnByValue: true, userGesture: !!jest, awaitPromise: true }
    }));
    s.onmessage = (o) => {
      let d; try { d = JSON.parse(o.data); } catch { return; }
      if (d.id !== 1) return;
      clearTimeout(t); try { s.close(); } catch { /* kapali */ }
      if (d.result && d.result.exceptionDetails) return red(new Error('sayfa istisnasi'));
      coz(d.result && d.result.result && d.result.result.value);
    };
  });
}

async function sayfaHedef() {
  for (let i = 0; i < 40; i++) {
    try {
      const y = await fetch('http://127.0.0.1:' + DBG + '/json/list');
      const l = await y.json();
      const h = l.find((t) => t.type === 'page' && (t.url || '').includes(':' + PORT + '/'));
      if (h && h.webSocketDebuggerUrl) return h.webSocketDebuggerUrl;
    } catch { /* dinlemiyor */ }
    await bekle(400);
  }
  return null;
}

function kapat(cocuk) {
  return new Promise((coz) => {
    let bitti = false;
    cocuk.on('exit', () => { bitti = true; coz(); });
    const ps = 'try{(Get-Process -Id ' + cocuk.pid + ' -ErrorAction Stop).CloseMainWindow()}catch{}';
    try { spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }); } catch { /* platform */ }
    setTimeout(() => { if (!bitti) { try { cocuk.kill('SIGKILL'); } catch { /* olmus */ } coz(); } }, 15000);
  });
}

(async () => {
  await new Promise((c) => sunucu.listen(PORT, '127.0.0.1', c));
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
  fs.writeFileSync(path.join(profil, 'pusula-veri.json'), JSON.stringify({
    ayarlar: { dil: 'tr', guncellemeKontrol: false, guncellemeIndir: false, otomatikGuncelle: false }
  }));

  const electron = require('electron');
  const cocuk = spawn(electron, ['.', 'http://127.0.0.1:' + PORT + '/',
    '--user-data-dir=' + profil, '--remote-debugging-port=' + DBG],
    { cwd: KOK, stdio: 'ignore' });

  const ws = await sayfaHedef();
  bak('sayfa hedefi bulundu', !!ws, true);
  if (ws) {
    await bekle(2500);
    const once = await cdp(ws, 'window.innerHeight').catch(() => 0);

    await cdp(ws, 'document.getElementById("oynatici").requestFullscreen()'
      + '.then(()=>"ok").catch((e)=>"hata")', true).catch(() => {});
    await bekle(1500);
    const fsEl = await cdp(ws, '!!document.fullscreenElement').catch(() => null);
    const sonra = await cdp(ws, 'window.innerHeight').catch(() => 0);
    bak('tam ekran öğesi ayarlandı', fsEl, true);
    bak('sayfa tüm pencereyi kapladı (büyüdü)', sonra > once, true);

    await cdp(ws, 'document.exitFullscreen().then(()=>"ok").catch(()=>"h")', true).catch(() => {});
    await bekle(1200);
    bak('çıkışta tam ekran öğesi kalktı', await cdp(ws, '!!document.fullscreenElement').catch(() => null), false);
    bak('çıkışta viewport normale döndü', await cdp(ws, 'window.innerHeight').catch(() => 0), once);
  }

  await kapat(cocuk);
  console.log('\n' + sonuc.join('\n'));
  const hata = sonuc.filter((s) => s.startsWith('  HATA')).length;
  console.log('\n' + (hata ? hata + ' KONTROL BAŞARISIZ' : 'hepsi geçti (' + sonuc.length + ')'));

  sunucu.close();
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* olsun */ }
  process.exit(hata ? 1 : 0);
})().catch((e) => { console.error('ölçüm çöktü:', e); process.exit(1); });
