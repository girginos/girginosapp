'use strict';

/*
 * Kozmetik filtreler gerçekten uygulanıyor mu, ve maliyeti ne?
 *
 * Yerel bir sayfa açılıyor; kurallar GERÇEK ayrıştırıcıdan (ayristir) geçiyor,
 * uygulama da gerçek yoldan (listeler.kozmetikCss + insertCSS) enjekte ediyor.
 * Ölçülen şey elementin hesaplanmış display değeri - "CSS eklendi" değil,
 * "kutu gizlendi".
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { app, session, BrowserWindow } = require('electron');

const { Store } = require('../src/store');
const { ListeYoneticisi, ayristir } = require('../src/listeler');
const { KozmetikDepo } = require('../src/kozmetik');

const PORT = 8804;

const SAYFA = `<!doctype html><meta charset="utf-8"><title>deneme</title>
<div id="icerik">içerik</div>
<div class="reklam-kutusu">reklam</div>
<div class="yan-reklam">yan</div>
<div id="sadece-haber">habere özel</div>
<div class="istisnali">istisna</div>`;

const LISTE_METNI = [
  '! Title: Deneme',
  '##.reklam-kutusu',
  '##.istisnali',
  'haber.test##.yan-reklam',
  'haber.test###sadece-haber',
  'haber.test#@#.istisnali',
  '||izleyici.test^',
  // Liste "tanindi" sayilacak kadar kural olsun; gercek listeler zaten buyuk.
  ...Array.from({ length: 20 }, (_, i) => 'dolgu' + i + '.test##.dolgu-' + i)
].join('\n');

app.on('window-all-closed', () => {});
const bekle = (ms) => new Promise((c) => setTimeout(c, ms));

const sunucu = http.createServer((istek, yanit) => {
  yanit.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  yanit.end(SAYFA);
});

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
  await new Promise((c) => sunucu.listen(PORT, '127.0.0.1', c));

  const dosya = path.join(os.tmpdir(), 'kozmetik-olcum-' + process.pid + '.json');
  const store = new Store(dosya);
  const veriDizini = path.join(os.tmpdir(), 'kozmetik-veri-' + process.pid);

  // Gerçek yönetici, sahte indirme: liste metni yukarıdaki sabitten geliyor.
  const listeler = new ListeYoneticisi({
    store,
    veriDizini,
    getir: async () => ({ durum: 200, metin: LISTE_METNI, etag: '', sonDegisiklik: '' })
  });
  await listeler.guncelle({ zorla: true });

  const ses = session.fromPartition('kozmetik-' + process.pid);
  const pen = new BrowserWindow({ show: false, webPreferences: { session: ses } });
  const wc = pen.webContents;

  const uygula = (host) => {
    const css = listeler.kozmetikCss(host);
    return css ? wc.insertCSS(css, { cssOrigin: 'user' }) : Promise.resolve(null);
  };

  const gorunum = () => wc.executeJavaScript(`(() => {
    const d = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : '(yok)'; };
    return { icerik: d('#icerik'), reklam: d('.reklam-kutusu'), yan: d('.yan-reklam'),
             haber: d('#sadece-haber'), istisna: d('.istisnali') };
  })()`, false);

  /* 1) haber.test gibi davran: hem genel hem alana özel kurallar uygulanmalı. */
  wc.on('did-navigate', () => { uygula('haber.test'); });
  await wc.loadURL('http://127.0.0.1:' + PORT + '/');
  await bekle(400);
  let g = await gorunum();
  bak('sayfanın kendi içeriği durur', g.icerik, 'block');
  bak('genel kural gizler', g.reklam, 'none');
  bak('alana özel sınıf gizlenir', g.yan, 'none');
  bak('alana özel kimlik gizlenir', g.haber, 'none');
  bak('istisna genel kuralı iptal eder', g.istisna, 'block');

  /* 2) Başka bir sitede alana özel kurallar UYGULANMAMALI. */
  wc.removeAllListeners('did-navigate');
  wc.on('did-navigate', () => { uygula('baska.test'); });
  await wc.loadURL('http://127.0.0.1:' + PORT + '/?ikinci');
  await bekle(400);
  g = await gorunum();
  bak('başka sitede genel kural yine gizler', g.reklam, 'none');
  bak('başka sitede alana özel uygulanmaz', g.yan, 'block');
  bak('başka sitede istisna yok, gizlenir', g.istisna, 'none');

  /* 3) Ölçek: gerçek listelerdeki hacimle maliyet ne? */
  const buyuk = new KozmetikDepo();
  for (let i = 0; i < 13634; i++) buyuk.ekle({ tip: 'gizle', alanlar: [], eksiler: [], secici: '.olcek-' + i });
  buyuk.ekle({ tip: 'gizle', alanlar: [], eksiler: [], secici: '.reklam-kutusu' });
  const buyukCss = buyuk.css('haber.test');

  wc.removeAllListeners('did-navigate');
  await wc.loadURL('http://127.0.0.1:' + PORT + '/?ucuncu');
  const t0 = Date.now();
  await wc.insertCSS(buyukCss, { cssOrigin: 'user' });
  const sure = Date.now() - t0;
  await bekle(200);
  g = await gorunum();
  bak('13 binlik kümede de gizler', g.reklam, 'none');
  console.log('\n  ölçek: ' + (buyukCss.length / 1024).toFixed(0) + ' KB CSS, insertCSS ' + sure + ' ms');

  /* 4) Bozuk seçici: hasar demetle sınırlı mı? */
  const bozuk = new KozmetikDepo();
  bozuk.ekle({ tip: 'gizle', alanlar: [], eksiler: [], secici: '.reklam-kutusu' });
  // Aynı demete girmesin diye araya dolgu koyuyoruz.
  for (let i = 0; i < 25; i++) bozuk.ekle({ tip: 'gizle', alanlar: [], eksiler: [], secici: '.dolgu-' + i });
  bozuk.ekle({ tip: 'gizle', alanlar: [], eksiler: [], secici: '.yan-reklam:bozuk-sozde-sinif(' });

  wc.removeAllListeners('did-navigate');
  await wc.loadURL('http://127.0.0.1:' + PORT + '/?dorduncu');
  await wc.insertCSS(bozuk.css('haber.test'), { cssOrigin: 'user' }).catch(() => {});
  await bekle(200);
  g = await gorunum();
  bak('bozuk seçici öteki demeti düşürmez', g.reklam, 'none');

  console.log('\n' + sonuc.join('\n'));
  const hata = sonuc.filter((s) => s.startsWith('  HATA')).length;
  console.log('\n' + (hata ? hata + ' KONTROL BAŞARISIZ' : 'hepsi geçti (' + sonuc.length + ')'));

  sunucu.close();
  try { fs.unlinkSync(dosya); } catch { /* olsun */ }
  try { fs.rmSync(veriDizini, { recursive: true, force: true }); } catch { /* olsun */ }
  app.exit(hata ? 1 : 0);
});
