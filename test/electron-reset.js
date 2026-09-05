'use strict';

/*
 * -101 (CONNECTION_RESET) SONRASI TEK SEFERLİK OTOMATİK YENİDEN DENEME.
 *
 * Kullanıcı arama yaparken ERR_CONNECTION_RESET aldı; elle tekrar deyince
 * açıldı (ölçüldü: sebep bizim başlıklarımız/vekilimiz değil, ağ tarafı geçici
 * bir sıfırlama). main.js did-fail-load bunu bir kez kendisi deniyor.
 *
 * Bu davranış main.js'te canlı ve yanlış korumada SONSUZ reload döngüsü
 * tarayıcıyı kilitler - bu yüzden ölçülmeden bırakılamaz. Yerel sunucu ilk
 * bağlantıda soketi düşürüp (-101), sonrakilerde sayfayı veriyor. Ölçülen:
 *   1) reset atan adres kendiliğinden açılıyor mu (retry çalışıyor mu)
 *   2) HER ZAMAN reset atan adres sonsuz döngüye girmeden hata sayfasına
 *      düşüyor mu (guard çalışıyor mu)
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const KOK = path.join(__dirname, '..');
const PORT = 8823;

const istekSayisi = {};   // yol -> kac kez baglanildi

// Gercek TCP RST (-101 CONNECTION_RESET). Duz destroy() FIN gonderip
// -100/-324 gibi baska kodlar uretebiliyor.
function sifirla(soket) {
  if (typeof soket.resetAndDestroy === 'function') soket.resetAndDestroy();
  else soket.destroy();
}

const sunucu = http.createServer((istek, yanit) => {
  const yol = istek.url.split('?')[0];
  istekSayisi[yol] = (istekSayisi[yol] || 0) + 1;

  if (yol === '/bir-kez-reset') {
    // Ilk baglantida soketi dusur (-101), sonrakilerde sayfayi ver.
    if (istekSayisi[yol] === 1) { sifirla(istek.socket); return; }
    yanit.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return yanit.end('<!doctype html><meta charset="utf-8"><title>ACILDI-' + istekSayisi[yol] + '</title>');
  }
  if (yol === '/hep-reset') {
    // Her baglantida reset: retry guard'i sonsuz donguye girmemeli.
    sifirla(istek.socket);
    return;
  }
  yanit.writeHead(404); yanit.end('');
});

const sonuc = [];
function bak(ad, bulunan, beklenen) {
  const tamam = bulunan === beklenen;
  sonuc.push((tamam ? '  ok   ' : '  HATA ') + ad +
    (tamam ? '' : '\n         bulunan: ' + JSON.stringify(bulunan) +
                  '\n         beklenen: ' + JSON.stringify(beklenen)));
}

const bekle = (ms) => new Promise((c) => setTimeout(c, ms));
const HATA_AYIKLAMA_PORTU = 9412;

function raporBekle(kosul, sure) {
  return new Promise((coz) => {
    let sayac = 0;
    const bak2 = async () => {
      const v = await kosul().catch(() => null);
      if (v) return coz(v);
      if (++sayac > sure / 400) return coz(null);
      setTimeout(bak2, 400);
    };
    bak2();
  });
}

async function aktifHedef(port) {
  return raporBekle(async () => {
    const y = await fetch('http://127.0.0.1:' + port + '/json/list');
    const l = await y.json();
    // Aktif (ziyaret edilen) sayfa: 127.0.0.1:PORT olan sekme.
    return l.find((t) => t.type === 'page' && (t.url || '').includes(':' + PORT + '/'))
      || l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  }, 20000);
}


function uygulama(profil, adres) {
  const electron = require('electron');
  return spawn(electron, ['.', adres, '--user-data-dir=' + profil,
    '--remote-debugging-port=' + HATA_AYIKLAMA_PORTU],
    { cwd: KOK, stdio: ['ignore', 'pipe', 'pipe'] });
}

function kapat(cocuk) {
  return new Promise((coz) => {
    let bitti = false;
    cocuk.on('exit', () => { bitti = true; coz(); });
    const ps = 'try { (Get-Process -Id ' + cocuk.pid + ' -ErrorAction Stop).CloseMainWindow() } catch {}';
    try { spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }); } catch {}
    setTimeout(() => { if (!bitti) { try { cocuk.kill('SIGKILL'); } catch {} coz(); } }, 15000);
  });
}

(async () => {
  await new Promise((c) => sunucu.listen(PORT, '127.0.0.1', c));
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-'));
  fs.writeFileSync(path.join(profil, 'pusula-veri.json'), JSON.stringify({
    ayarlar: { dil: 'tr', guncellemeKontrol: false, guncellemeIndir: false, otomatikGuncelle: false }
  }));

  /* 1) Bir kez reset atan adres kendiliğinden açılmalı. */
  const bir = uygulama(profil, 'http://127.0.0.1:' + PORT + '/bir-kez-reset');
  const h1 = await aktifHedef(HATA_AYIKLAMA_PORTU);
  bak('arayüz/sayfa hedefi bulundu', !!h1, true);
  if (h1) {
    // Otomatik retry'in tamamlanmasi icin biraz bekle.
    await bekle(4000);
    bak('bir kez reset atan adres kendiliğinden açıldı', istekSayisi['/bir-kez-reset'] >= 2, true);
  }
  await kapat(bir);
  await bekle(1500);

  /* 2) Hep reset atan adres SONSUZ döngüye girmemeli. */
  Object.keys(istekSayisi).forEach((k) => delete istekSayisi[k]);
  const iki = uygulama(profil, 'http://127.0.0.1:' + PORT + '/hep-reset');
  await aktifHedef(HATA_AYIKLAMA_PORTU);
  await bekle(5000);
  // Tek retry: ilk gezinme + bir retry = 2. Guard yoksa bu sayi hizla buyur.
  const kez = istekSayisi['/hep-reset'] || 0;
  bak('hep reset atan adres sonsuz döngüye girmedi (<=3 deneme)', kez >= 1 && kez <= 3, true);
  await kapat(iki);

  console.log('\nhep-reset deneme sayısı: ' + (istekSayisi['/hep-reset'] || '-'));
  console.log('\n' + sonuc.join('\n'));
  const hata = sonuc.filter((s) => s.startsWith('  HATA')).length;
  console.log('\n' + (hata ? hata + ' KONTROL BAŞARISIZ' : 'hepsi geçti (' + sonuc.length + ')'));

  sunucu.close();
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch {}
  process.exit(hata ? 1 : 0);
})().catch((e) => { console.error('olcum cokti:', e); process.exit(1); });
