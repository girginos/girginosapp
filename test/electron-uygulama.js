'use strict';

/*
 * GERÇEK UYGULAMA ÇALIŞIYOR MU?
 *
 * Öteki Electron testleri modülleri tek tek doğruluyor ama main.js'in
 * KABLOLAMASINA hiç dokunmuyor: kozmetigiUygula() gövdesi silinse, vekil
 * hiçbir oturuma uygulanmasa, kapanış temizliği hiç bağlanmasa üçü de yeşil
 * kalıyordu. Yani özellikler tamamen kaldırılıp test takımı geçebiliyordu.
 * Ölçüldü.
 *
 * Bu test uygulamanın kendisini başlatıyor (electron . <adres>) ve sonucu
 * SAYFANIN KENDİSİNE raporlatıyor: gerçek bir sekmede, gerçek ayarlarla,
 * gerçek gezinmeden sonra ne olduğunu.
 *
 * Ayrı bir profil (--user-data-dir) kullanılıyor; kullanıcının kendi
 * tarayıcısı açıksa tek örnek kilidi yüzünden ikinci süreç sessizce kapanır,
 * o yüzden kilit de ayrı profille kırılıyor.
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const KOK = path.join(__dirname, '..');
const SUNUCU_PORT = 8811;
const VEKIL_PORT = 8812;
const KAPANIS_BEKLEME_MS = 25000;

const sonuc = [];
function bak(ad, bulunan, beklenen) {
  const tamam = bulunan === beklenen;
  sonuc.push((tamam ? '  ok   ' : '  HATA ') + ad +
    (tamam ? '' : '\n         bulunan: ' + JSON.stringify(bulunan) +
                  '\n         beklenen: ' + JSON.stringify(beklenen)));
}

const raporlar = [];
const vekileGelen = [];

/*
 * Sayfa kendi durumunu bildiriyor. CDP'ye bağlanmak yerine bu yol seçildi:
 * ölçülen şey tam olarak kullanıcının gördüğü sayfa - hesaplanmış display
 * değeri, sayfanın kendi çerezi, sayfadan çıkan istek.
 */
const SAYFA = `<!doctype html><meta charset="utf-8"><title>bütünleşme</title>
<div id="normal">normal</div>
<div class="butunlesme-reklam">reklam</div>
<iframe src="/cerceve"></iframe>
<iframe src="http://localhost:${SUNUCU_PORT}/uc-taraf"></iframe>
<script>
  // max-age SART: suresiz cerez OTURUM cerezidir ve yeniden baslatmada zaten
  // kaybolur. Onsuz "kapanista silindi" kontrolu hicbir sey olcmuyordu -
  // kontrol kolu eklenince ortaya cikti.
  document.cookie = 'oturum=DENEME-1; path=/; max-age=3600';
  // Yerel olmayan bir adres: vekil açıksa istek vekile uğramalı.
  fetch('http://vekil-denemesi.test/sinama', { mode: 'no-cors' }).catch(() => {});
  setTimeout(() => {
    const g = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : '(yok)'; };
    const p = new URLSearchParams({
      normal: g('#normal'),
      reklam: g('.butunlesme-reklam'),
      cerez: document.cookie
    });
    fetch('/rapor?' + p.toString());
  }, 2500);
</script>`;

/*
 * UCUNCU TARAF CERCEVE. Sayfa 127.0.0.1, cerceve localhost: Chromium bunlari
 * ayri site sayiyor.
 *
 * Bizim baslik katmanimiz burayi GOREMEZ - document.cookie ag istegi degil.
 * Kimligi kesen sey Chromium'un kendi ucuncu taraf cerez engeli; main.js onu
 * acilista komut satiri anahtariyla aciyor. Raporun GELMESI cercevenin
 * calistiginin kaniti, yani "cerez yok" sonucu "cerceve hic yuklenmedi"
 * anlamina gelemez.
 */
const UC_TARAF = `<!doctype html><meta charset="utf-8">
<script>
  document.cookie = 'ucuncu=IZLEYICI-1; path=/; max-age=3600';
  setTimeout(() => {
    fetch('http://127.0.0.1:${SUNUCU_PORT}/rapor-uc-taraf?c=' + encodeURIComponent(document.cookie))
      .catch(() => {});
  }, 2000);
</script>`;

const CERCEVE = `<!doctype html><meta charset="utf-8">
<div class="butunlesme-reklam">cerceve reklami</div>
<script>
  setTimeout(() => {
    const e = document.querySelector('.butunlesme-reklam');
    fetch('/rapor-cerceve?d=' + encodeURIComponent(e ? getComputedStyle(e).display : '(yok)'));
  }, 2600);
</script>`;

// İkinci açılış: kapanışta çerez silindi mi?
const CEREZ_SAYFASI = `<!doctype html><meta charset="utf-8"><title>cerez</title>
<script>
  setTimeout(() => { fetch('/rapor-cerez?c=' + encodeURIComponent(document.cookie)); }, 1500);
</script>`;

const sunucu = http.createServer((istek, yanit) => {
  const u = new URL(istek.url, 'http://127.0.0.1');
  const gonder = (govde, tur) => {
    yanit.writeHead(200, { 'Content-Type': tur, 'Cache-Control': 'no-store' });
    yanit.end(govde);
  };
  if (u.pathname === '/sayfa') return gonder(SAYFA, 'text/html; charset=utf-8');
  if (u.pathname === '/cerceve') return gonder(CERCEVE, 'text/html; charset=utf-8');
  if (u.pathname === '/uc-taraf') return gonder(UC_TARAF, 'text/html; charset=utf-8');
  if (u.pathname === '/cerez') return gonder(CEREZ_SAYFASI, 'text/html; charset=utf-8');
  if (u.pathname.startsWith('/rapor')) {
    raporlar.push({ yol: u.pathname, veri: Object.fromEntries(u.searchParams) });
    yanit.setHeader('Access-Control-Allow-Origin', '*');
    return gonder('ok', 'text/plain');
  }
  yanit.writeHead(404);
  yanit.end('');
});

const vekil = http.createServer((istek, yanit) => {
  vekileGelen.push(istek.url);
  yanit.writeHead(200, { 'Content-Type': 'text/plain' });
  yanit.end('vekilden');
});

const bekle = (ms) => new Promise((c) => setTimeout(c, ms));

function raporBekle(yol, sure) {
  const bitis = Date.now() + sure;
  return new Promise((coz) => {
    const bak2 = () => {
      const r = raporlar.find((x) => x.yol === yol);
      if (r) return coz(r);
      if (Date.now() > bitis) return coz(null);
      setTimeout(bak2, 200);
    };
    bak2();
  });
}

/* Kozmetik kural önbelleği: uygulama açılışta bunu okuyup uyguluyor. */
function listeOnbellegiYaz(dizin) {
  const kurallar = { genel: [], alan: {}, istisna: {}, genelIstisna: [] };
  kurallar.alan['127.0.0.1'] = ['.butunlesme-reklam'];
  // Liste "tanindi" sayilacak kadar kural olsun.
  for (let i = 0; i < 30; i++) kurallar.alan['dolgu' + i + '.test'] = ['.d' + i];

  fs.mkdirSync(dizin, { recursive: true });
  fs.writeFileSync(path.join(dizin, 'easylist.json'), JSON.stringify({
    bicim: 3,
    url: 'https://easylist.to/easylist/easylist.txt',
    ustBilgi: {
      baslik: 'Deneme', surum: '1', gecerlilikSaat: 999,
      etag: '', sonDegisiklik: '', indirilme: Date.now(), hata: ''
    },
    alanlar: ['izleyici-denemesi.test'],
    istisnalar: [],
    kozmetik: kurallar
  }), 'utf8');
}

function ayarYaz(profil, ek) {
  fs.mkdirSync(profil, { recursive: true });
  fs.writeFileSync(path.join(profil, 'pusula-veri.json'), JSON.stringify({
    ayarlar: {
      dil: 'tr',
      engelleyiciAcik: true,
      filtreListeleriAcik: true,
      // Ölçüm sırasında ağa çıkılmasın; liste indirme ve güncelleme kapalı.
      otomatikGuncelle: false,
      guncellemeKontrol: false,
      guncellemeIndir: false,
      ...ek
    },
    gecmis: [],
    yerImleri: [],
    izinler: {},
    siteIzinleri: [],
    cerezIstisnalari: [],
    istatistik: { engellenen: 0 }
  }), 'utf8');
}

function uygulamayiCalistir(profil, adres) {
  const electron = require('electron');
  const cocuk = spawn(electron, ['.', adres, '--user-data-dir=' + profil], {
    cwd: KOK,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '' }
  });
  const cikti = [];
  cocuk.stdout.on('data', (d) => cikti.push(String(d)));
  cocuk.stderr.on('data', (d) => cikti.push(String(d)));
  return { cocuk, cikti };
}

// Pencereyi kapatarak cikis: before-quit yolu gercekten calissin.
function kapat(cocuk) {
  return new Promise((coz) => {
    let bitti = false;
    cocuk.on('exit', () => { bitti = true; coz(true); });
    /*
     * PENCEREYE WM_CLOSE. taskkill (zorlamasiz) GUI penceresine kapanma
     * mesaji gondermiyor; olcum surec olmedigi icin zaman asimina dusuyor ve
     * o zaman surec ZORLA olduruluyor - before-quit hic calismiyor. Cikis
     * yolunu olcen bir testin cikisi zorla yaptirmasi olcumu bosa cikarirdi.
     */
    const ps = 'try { $p = Get-Process -Id ' + cocuk.pid + ' -ErrorAction Stop; '
      + '$null = $p.CloseMainWindow() } catch { }';
    try {
      spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
    } catch { /* platform farkli olabilir */ }
    setTimeout(() => {
      if (bitti) return;
      try { cocuk.kill('SIGKILL'); } catch { /* zaten olmus */ }
      coz(false);
    }, KAPANIS_BEKLEME_MS);
  });
}

(async () => {
  await new Promise((c) => sunucu.listen(SUNUCU_PORT, '127.0.0.1', c));
  await new Promise((c) => vekil.listen(VEKIL_PORT, '127.0.0.1', c));

  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'pusula-butunlesme-'));
  ayarYaz(profil, {
    kapanistaCerezSil: true,
    vekilKip: 'elle',
    vekilAdres: 'http://127.0.0.1:' + VEKIL_PORT,
    vekilAtla: ''
  });
  listeOnbellegiYaz(path.join(profil, 'listeler'));

  /* --- birinci açılış --- */
  const bir = uygulamayiCalistir(profil, 'http://127.0.0.1:' + SUNUCU_PORT + '/sayfa');
  const rapor = await raporBekle('/rapor', 30000);

  if (!rapor) {
    console.error('\n  HATA sayfa hic rapor gondermedi. Uygulama ciktisi:\n' + bir.cikti.join(''));
    bak('sayfa rapor gonderdi', false, true);
  } else {
    bak('komut satirindaki adres acildi', rapor.veri.normal, 'block');
    // kozmetigiUygula() main.js'te bagli mi?
    bak('kozmetik kural gercek uygulamada uygulandi', rapor.veri.reklam, 'none');
    bak('sayfa kendi cerezini yazdi', /oturum=DENEME-1/.test(rapor.veri.cerez || ''), true);
  }

  const cerceveRapor = await raporBekle('/rapor-cerceve', 8000);
  bak('alt cerceveye de uygulandi', cerceveRapor ? cerceveRapor.veri.d : '(rapor yok)', 'none');

  // vekiliUygula() main.js'te bagli mi?
  const ucRapor = await raporBekle('/rapor-uc-taraf', 8000);
  bak('ucuncu taraf cerceve calisti', !!ucRapor, true);
  // Chromium'un ucuncu taraf cerez engeli gercek uygulamada acik mi?
  bak('ucuncu taraf JS cerezi yazamadi',
    /ucuncu=/.test((ucRapor && ucRapor.veri.c) || ''), false);

  bak('vekil gercek uygulamada bagli', vekileGelen.length > 0, true);

  const duzgunKapandi = await kapat(bir.cocuk);
  bak('uygulama duzgun kapandi', duzgunKapandi, true);
  await bekle(1500);

  /* --- ikinci açılış: kapanışta çerez silindi mi? --- */
  const iki = uygulamayiCalistir(profil, 'http://127.0.0.1:' + SUNUCU_PORT + '/cerez');
  const cerezRapor = await raporBekle('/rapor-cerez', 30000);
  if (!cerezRapor) {
    console.error('\n  HATA ikinci acilis rapor gondermedi:\n' + iki.cikti.join(''));
    bak('ikinci acilis rapor gonderdi', false, true);
  } else {
    // before-quit temizligi main.js'te bagli mi?
    bak('kapanista cerez silindi', /oturum=/.test(cerezRapor.veri.c || ''), false);
  }
  await kapat(iki.cocuk);
  await bekle(1500);

  /*
   * --- KONTROL KOLU ---
   *
   * Yukaridaki "silindi" kontrolu, cerez hic KAYDEDILMEMIS olsa da gecerdi;
   * o halde testin olctugu sey silme degil, kendi kurgusu olurdu. Ayni akis
   * ayar KAPALIYKEN tekrarlaniyor: cerez bu sefer durmali.
   */
  ayarYaz(profil, {
    kapanistaCerezSil: false,
    vekilKip: 'elle',
    vekilAdres: 'http://127.0.0.1:' + VEKIL_PORT,
    vekilAtla: ''
  });
  raporlar.length = 0;

  const uc = uygulamayiCalistir(profil, 'http://127.0.0.1:' + SUNUCU_PORT + '/sayfa');
  await raporBekle('/rapor', 30000);
  await kapat(uc.cocuk);
  await bekle(1500);

  const dort = uygulamayiCalistir(profil, 'http://127.0.0.1:' + SUNUCU_PORT + '/cerez');
  const kontrolRapor = await raporBekle('/rapor-cerez', 30000);
  bak('ayar kapaliyken cerez durur',
    /oturum=DENEME-1/.test((kontrolRapor && kontrolRapor.veri.c) || ''), true);
  await kapat(dort.cocuk);

  console.log('\n' + sonuc.join('\n'));
  const hata = sonuc.filter((s) => s.startsWith('  HATA')).length;
  console.log('\n' + (hata ? hata + ' KONTROL BAŞARISIZ' : 'hepsi geçti (' + sonuc.length + ')'));

  sunucu.close();
  vekil.close();
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* olsun */ }
  process.exit(hata ? 1 : 0);
})().catch((e) => {
  console.error('\n  HATA olcum cokti: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
