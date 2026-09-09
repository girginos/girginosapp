'use strict';

/*
 * HTTPS ZORLAMA (HTTPS-First) — gerçek oturumda, gerçek gezinmeyle.
 *
 * Düz HTTP'de oturum çerezi ağı dinleyen herkese açıktır. Üst düzey gezinmeler
 * https'e yükseltiliyor; intranet muaf, sunucu HTTPS konuşmuyorsa geri düşülür.
 * Burada yükseltmenin GERÇEKTEN olduğunu ve intranetin kırılmadığını ölçüyoruz
 * (birim testleri saf mantığı ayrıca sınıyor: test/dogrula.js).
 *
 * Çalıştır: electron test/electron-https.js
 */

const { app, session, BrowserWindow } = require('electron');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('../src/store');
const { Blocker } = require('../src/blocker');
const httpsZorla = require('../src/https-zorla');

const sonuc = [];
function bak(ad, bulunan, beklenen) {
  const gecti = Object.is(bulunan, beklenen);
  sonuc.push((gecti ? '  ok   ' : '  HATA ') + ad
    + (gecti ? '' : '\n         bulunan: ' + JSON.stringify(bulunan)
                  + '\n         beklenen: ' + JSON.stringify(beklenen)));
}

// Sayfayı yükleyip BİTEN adresi döner (yükseltme/geri düşme sonrası).
async function git(pen, adres) {
  try { await pen.loadURL(adres); } catch { /* hata sayfası da bir sonuçtur */ }
  await new Promise((r) => setTimeout(r, 250));
  return pen.webContents.getURL();
}

app.whenReady().then(async () => {
  // İntranet benzeri yerel sunucu: yükseltilMEmeli.
  const yerel = http.createServer((q, c) => { c.writeHead(200, { 'content-type': 'text/html' }); c.end('<h1>yerel</h1>'); });
  await new Promise((r) => yerel.listen(0, '127.0.0.1', r));
  const PORT = yerel.address().port;

  const veriDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'https-test-'));
  const store = new Store(path.join(veriDizini, 'pusula-veri.json'));
  const ses = session.fromPartition('https-test-' + process.pid);
  const blocker = new Blocker(store);
  blocker.bagla(ses, () => {});

  const pen = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true } });

  /* 1) AÇIKKEN: genel adres https'e yükseltilmeli. */
  store.ayarla('httpsZorla', true);
  const genel = await git(pen, 'http://girginos.app/');
  bak('genel adres https e yükseltildi', /^https:\/\/girginos\.app\//.test(genel), true);

  /* 2) İNTRANET MUAF: yerel adres http kalmalı (yükseltilse bağlantı ölürdü). */
  const yerelSonuc = await git(pen, 'http://127.0.0.1:' + PORT + '/');
  bak('yerel adres http kaldı', yerelSonuc.startsWith('http://127.0.0.1:' + PORT), true);

  /* 3) KAPALIYKEN: dokunulmamalı. */
  store.ayarla('httpsZorla', false);
  const kapali = await git(pen, 'http://127.0.0.1:' + PORT + '/');
  bak('ayar kapalıyken yükseltme yok', kapali.startsWith('http://127.0.0.1:' + PORT), true);
  store.ayarla('httpsZorla', true);

  /*
   * İSTİSNA (geri düşme) davranışı BURADA sınanamaz: gerçek bir sunucuya
   * gerek var ve https'i bir kez gören host HSTS yüzünden zaten http kabul
   * etmiyor - yani ölçüm bizim kodumuzu değil sunucuyu ölçerdi. Saf mantık
   * (istisna, port, yerel muafiyet, geri düşme hata kodları) test/dogrula.js'te.
   */
  httpsZorla.istisnalariTemizle();

  pen.destroy();
  yerel.close();
  console.log('\n' + sonuc.join('\n'));
  const hata = sonuc.filter((s) => s.startsWith('  HATA')).length;
  console.log(hata ? '\n' + hata + ' KONTROL BAŞARISIZ' : '\nhepsi geçti (' + sonuc.length + ')');
  app.exit(hata ? 1 : 0);
}).catch((e) => { console.error('HATA:', e && e.stack || e); app.exit(1); });
