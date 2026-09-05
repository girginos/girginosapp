'use strict';

/*
 * ÖNERİ LİSTESİ SAYFAYI İTMİYOR MU?
 *
 * Öneri listesi arayüz penceresinde; sayfa görünümü onun üstünde render
 * edildiği için liste sayfanın üstüne binemiyor, chrome büyüyünce sayfa aşağı
 * itiliyordu. Çözüm: öneri açılınca sayfanın anlık görüntüsü alınıp
 * #sayfaGoruntu'ya konuyor ve sayfa görünümü gizleniyor - liste sabit
 * görüntünün üstüne biniyor, sayfa yerinde kalıyor.
 *
 * Bu, main.js'in oneri:durum + capturePage + sayfa-goruntu kablolamasını
 * GERÇEK uygulamada, dolu bir sayfa üzerinde doğrular (capturePage boş sayfada
 * boş döner; bilerek dolu bir sayfa kullanılıyor).
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const KOK = path.join(__dirname, '..');
const PORT = 8836;
const DBG = 9418;

const SAYFA = '<!doctype html><meta charset="utf-8"><title>SITE</title>'
  + '<body style="margin:0;font:20px sans-serif">'
  + '<div style="height:2000px;background:linear-gradient(160deg,#0a4,#08c);color:#fff;padding:40px">dolu sayfa</div>';

const sunucu = http.createServer((_q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  r.end(SAYFA);
});

const bekle = (ms) => new Promise((c) => setTimeout(c, ms));
const sonuc = [];
function bak(ad, bulunan, beklenen) {
  const tamam = bulunan === beklenen;
  sonuc.push((tamam ? '  ok   ' : '  HATA ') + ad +
    (tamam ? '' : '\n         bulunan: ' + JSON.stringify(bulunan) +
                  '\n         beklenen: ' + JSON.stringify(beklenen)));
}

function cdp(ws, ifade) {
  return new Promise((coz, red) => {
    let s;
    try { s = new WebSocket(ws); } catch (e) { return red(e); }
    const t = setTimeout(() => { try { s.close(); } catch { /* kapali */ } red(new Error('zaman')); }, 12000);
    s.onerror = () => { clearTimeout(t); red(new Error('wserr')); };
    s.onopen = () => s.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: ifade, returnByValue: true, awaitPromise: true }
    }));
    s.onmessage = (o) => {
      let d; try { d = JSON.parse(o.data); } catch { return; }
      if (d.id !== 1) return;
      clearTimeout(t); try { s.close(); } catch { /* kapali */ }
      if (d.result && d.result.exceptionDetails) return red(new Error(JSON.stringify(d.result.exceptionDetails.text)));
      coz(d.result && d.result.result && d.result.result.value);
    };
  });
}

async function uiHedef() {
  for (let i = 0; i < 40; i++) {
    try {
      const y = await fetch('http://127.0.0.1:' + DBG + '/json/list');
      const l = await y.json();
      const h = l.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
      if (h && h.webSocketDebuggerUrl) return h.webSocketDebuggerUrl;
    } catch { /* surec henuz dinlemiyor */ }
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
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'oneri-'));
  fs.writeFileSync(path.join(profil, 'pusula-veri.json'), JSON.stringify({
    ayarlar: { dil: 'tr', guncellemeKontrol: false, guncellemeIndir: false, otomatikGuncelle: false },
    gecmis: [
      { url: 'https://ornek.com/haber', baslik: 'Ornek Haber', zaman: 2 },
      { url: 'https://ornektest.com/blog', baslik: 'Ornek Blog', zaman: 1 }
    ]
  }));

  const electron = require('electron');
  const cocuk = spawn(electron, ['.', 'http://127.0.0.1:' + PORT + '/',
    '--user-data-dir=' + profil, '--remote-debugging-port=' + DBG],
    { cwd: KOK, stdio: 'ignore' });

  const ws = await uiHedef();
  bak('arayüz hedefi bulundu', !!ws, true);
  if (ws) {
    await bekle(2500);
    bak('başlangıçta sayfa görüntüsü gizli',
      await cdp(ws, 'document.getElementById("sayfaGoruntu").hidden').catch(() => null), true);

    // Adres çubuğuna yaz -> öneri açılsın.
    await cdp(ws, '(()=>{const a=document.getElementById("adres");a.focus();a.value="ornek";'
      + 'a.dispatchEvent(new Event("input",{bubbles:true}));return 1;})()');
    await bekle(2500);

    bak('öneri açık', await cdp(ws, '!document.getElementById("oneriler").hidden').catch(() => null), true);
    bak('öneri satırları var', await cdp(ws, 'document.getElementById("oneriler").children.length > 0').catch(() => null), true);
    // capturePage görüntüsü kondu = main sayfayı gizledi (sayfa itilmiyor).
    bak('sayfa görüntüsü kondu',
      await cdp(ws, '(()=>{const g=document.getElementById("sayfaGoruntu");'
        + 'return !!g && !g.hidden && (g.style.backgroundImage||"").indexOf("data:image")>=0;})()').catch(() => null), true);
    // Öneri (chrome, z-index 10) sayfa görüntüsünün (z-index 1) üstünde olmalı.
    bak('öneri sayfa görüntüsünün üstünde',
      await cdp(ws, '(()=>{const g=getComputedStyle(document.getElementById("sayfaGoruntu")).zIndex;'
        + 'const c=getComputedStyle(document.getElementById("chrome")).zIndex;'
        + 'return Number(c) > Number(g);})()').catch(() => null), true);

    // Öneri kapanınca sayfa görüntüsü kalkmalı (canlı sayfa geri gelir).
    await cdp(ws, 'document.getElementById("adres").blur(), 1');
    await bekle(800);
    bak('öneri kapanınca görüntü kalktı',
      await cdp(ws, 'document.getElementById("sayfaGoruntu").hidden').catch(() => null), true);
  }

  await kapat(cocuk);
  console.log('\n' + sonuc.join('\n'));
  const hata = sonuc.filter((s) => s.startsWith('  HATA')).length;
  console.log('\n' + (hata ? hata + ' KONTROL BAŞARISIZ' : 'hepsi geçti (' + sonuc.length + ')'));

  sunucu.close();
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* olsun */ }
  process.exit(hata ? 1 : 0);
})().catch((e) => { console.error('ölçüm çöktü:', e); process.exit(1); });
