'use strict';

/*
 * SCRIPTLET MOTORU GERÇEK SAYFADA ÇALIŞIYOR MU?
 *
 * blackhatworld gibi anti-adblock duvarları uBO scriptlet'iyle kırılıyor:
 * "##+js(acs, navigator.userAgent, AdBlockOn)" -> UA'yı okuyan ve metninde
 * "AdBlockOn" geçen script'i, o script çalışmadan düşür. Bu test o zinciri
 * BAŞTAN SONA gerçek uygulamada ölçüyor: liste önbelleğine scriptlet kuralları
 * konuyor, uygulama açılıyor, sentetik bir anti-adblock sayfası yükleniyor ve
 * scriptlet'in gerçekten iş gördüğü doğrulanıyor.
 *
 * KANIT (cerrahi olduğunu da gösterir - sayfanın gerisini kırmaz):
 *   acs           UA'yı igneyle okuyan script duvarı KURAMADAN düşer;
 *                 igne taşımayan meşru script UA'yı NORMAL okur.
 *   set-constant  sayfa okumadan önce sabit kurulur, sayfa ezemez.
 *   aopr          korunan özelliğin okunması hata fırlatır.
 *
 * Preload açılışta, listeler yüklenmeden ÖNCE ilk gezinmeye yetişemeyebiliyor;
 * o yüzden yükleme tamamlandıktan sonra sayfa bir kez yeniden yükleniyor
 * (gerçekte de sonraki gezinmeler demeti almış oluyor).
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const KOK = path.join(__dirname, '..');
const PORT = 8840;
const DBG = 9422;

const { BetikDepo, betikCoz } = require('../src/betikler');
const { KozmetikDepo } = require('../src/kozmetik');

// İğne "AdBlockOn" script A'nın metninde; acs onu yakalayıp düşürmeli.
const SAYFA = '<!doctype html><meta charset="utf-8"><title>AA</title>'
  + '<body><div id="content">gercek icerik</div>'
  + '<script>\n'
  + '/* anti-adblock kontrolu: AdBlockOn */\n'
  + 'window.__a1 = "basladi";\n'
  + 'var ua = navigator.userAgent;\n'          // acs burada throw etmeli
  + 'window.__a1 = "gecti";\n'                  // ulasilmamali
  + 'var w = document.createElement("div"); w.id = "wall";\n'
  + 'w.textContent = "reklam engelleyicinizi kapatin";\n'
  + 'document.body.appendChild(w);\n'
  + '</script>\n'
  + '<script>\n'
  + '/* mesru script - igne yok */\n'
  + 'try { window.__b_ua = navigator.userAgent; window.__b = "ok"; }\n'   // gercek UA, throw yok
  + 'catch (e) { window.__b = "throw"; }\n'
  + 'window.__setResult = (window.__pusulaTestSabit === true);\n'
  + 'try { window.__pusulaTestSabit = false; } catch (e) {}\n'
  + 'window.__setResult2 = (window.__pusulaTestSabit === true);\n'
  + 'try { var g = window.__pusulaGizli; window.__aopr = "okundu"; }\n'
  + 'catch (e) { window.__aopr = "throw"; }\n'
  + '</script>';

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
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'betik-'));
  fs.writeFileSync(path.join(profil, 'pusula-veri.json'), JSON.stringify({
    ayarlar: {
      dil: 'tr', engelleyiciAcik: true, filtreListeleriAcik: true,
      otomatikGuncelle: false, guncellemeKontrol: false, guncellemeIndir: false, otomatikGuncelle2: false
    }
  }));

  // Liste önbelleğine scriptlet kuralları koy (127.0.0.1 için). yukle() bunu
  // açılışta okuyacak; degisti preload'ı scriptlet'lerle yeniden üretecek.
  const depo = new BetikDepo();
  [
    '127.0.0.1##+js(acs, navigator.userAgent, AdBlockOn)',
    '127.0.0.1##+js(set-constant, __pusulaTestSabit, true)',
    '127.0.0.1##+js(aopr, __pusulaGizli)'
  ].forEach((s) => depo.ekle(betikCoz(s)));

  fs.mkdirSync(path.join(profil, 'listeler'), { recursive: true });
  fs.writeFileSync(path.join(profil, 'listeler', 'easylist.json'), JSON.stringify({
    bicim: 4,
    url: 'https://easylist.to/easylist/easylist.txt',
    ustBilgi: { baslik: 'test', indirilme: Date.now(), gecerlilikSaat: 100000 },
    alanlar: [], istisnalar: [],
    kozmetik: new KozmetikDepo().disaAktar(),
    betik: depo.disaAktar()
  }));

  const electron = require('electron');
  const cocuk = spawn(electron, ['.', 'http://127.0.0.1:' + PORT + '/',
    '--user-data-dir=' + profil, '--remote-debugging-port=' + DBG],
    { cwd: KOK, stdio: 'ignore' });

  let ws = await sayfaHedef();
  bak('sayfa hedefi bulundu', !!ws, true);
  if (ws) {
    // yukle() + preload yeniden üretimi bitsin, sonra taze preload'la yeniden yükle.
    await bekle(3500);
    await cdp(ws, 'location.reload(), 1').catch(() => {});
    await bekle(2500);
    ws = await sayfaHedef() || ws;   // reload sonrası hedefi tazele

    // acs: UA'yı igneyle okuyan script duvarı kuramadan düştü.
    bak('acs - duvar script i "basladi"da durdu',
      await cdp(ws, 'window.__a1').catch(() => null), 'basladi');
    bak('acs - reklam duvarı OLUŞMADI',
      await cdp(ws, '!document.getElementById("wall")').catch(() => null), true);

    // Cerrahi: igne taşımayan meşru script UA'yı normal okudu, çalıştı.
    bak('mesru script tam çalıştı (UA erişilebilir)',
      await cdp(ws, 'window.__b').catch(() => null), 'ok');
    bak('mesru script gerçek UA aldı',
      await cdp(ws, 'typeof window.__b_ua === "string" && window.__b_ua.length > 0').catch(() => null), true);

    // set-constant: sayfa okumadan önce sabit; sayfa ezemedi.
    bak('set-constant - sayfa okumadan sabit kuruldu',
      await cdp(ws, 'window.__setResult').catch(() => null), true);
    bak('set-constant - sayfa değeri ezemedi',
      await cdp(ws, 'window.__setResult2').catch(() => null), true);

    // aopr: korunan özelliğin okunması hata fırlattı.
    bak('aopr - korunan özellik okununca throw',
      await cdp(ws, 'window.__aopr').catch(() => null), 'throw');
  }

  await kapat(cocuk);
  console.log('\n' + sonuc.join('\n'));
  const hata = sonuc.filter((s) => s.startsWith('  HATA')).length;
  console.log('\n' + (hata ? hata + ' KONTROL BAŞARISIZ' : 'hepsi geçti (' + sonuc.length + ')'));

  sunucu.close();
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* olsun */ }
  process.exit(hata ? 1 : 0);
})().catch((e) => { console.error('ölçüm çöktü:', e); process.exit(1); });
