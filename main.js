'use strict';

const {
  app, BrowserWindow, WebContentsView, ipcMain, shell, session,
  dialog, Menu, clipboard, nativeTheme, protocol
} = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { Store } = require('./src/store');
const { Blocker, kokAlanAdi, hostAl } = require('./src/blocker');
const { ListeYoneticisi } = require('./src/listeler');
const { dilCoz, ceviri, bicimle, dilListesi } = require('./src/diller');
const { FaviconDeposu, SEMA: FAVICON_SEMASI } = require('./src/faviconlar');
const { GuncellemeYoneticisi } = require('./src/guncelleme');
const {
  sayfadanGezilebilir, disSemaIzinli, indirmeAdiNormalle,
  calistirilabilirMi, icSayfaDenetleyici
} = require('./src/guvenlik');
const { SEARCH_ENGINES, resolveInput, prettyURL } = require('./src/urls');
const {
  genislikTahmini, olcumdenGenislik, xKonumu, xKonumuSol
} = require('./src/menu-yerlesim');
const { SertifikaDeposu } = require('./src/sertifikalar');

// Şema ayrıcalıkları uygulama hazır olmadan bildirilmeli.
protocol.registerSchemesAsPrivileged([{
  scheme: FAVICON_SEMASI,
  privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false }
}]);

const UI_DIR = path.join(__dirname, 'ui');
const OTURUM = 'persist:pusula';
const VARSAYILAN_CHROME_YUKSEKLIK = 84;

let win = null;
let store = null;
let blocker = null;
let ses = null;
let listeler = null;
let faviconlar = null;
let guncelleme = null;
let ceviriler = ceviri('en');
const sertifikalar = new SertifikaDeposu();

// Çeviri kısayolu: cev('menu.dosya'), cev('menu.nSekme', { n: 3 })
function cev(anahtar, degerler) {
  return bicimle(ceviriler.metin[anahtar] || anahtar, degerler);
}

function diliUygula() {
  ceviriler = ceviri(dilCoz(store.ayarlar.dil, app.getLocale()));
}

let chromeYukseklik = VARSAYILAN_CHROME_YUKSEKLIK;
let katmanAcik = false;           // arayüzde tam ekran panel açık mı
const sekmeler = new Map();       // id -> sekme
let aktifId = null;
let sonrakiId = 1;
const indirmeler = [];

/* ---------------------------------------------------------------- */
/* Yardımcılar                                                       */
/* ---------------------------------------------------------------- */

// Yeni sekme sayfası korumalı (sandbox) ve preload'suz çalışıyor, yani ana
// süreçle konuşamıyor. Göstereceği her şey adres parametreleriyle veriliyor.
function yeniSekmeAdresi() {
  const engellenen = store.veri.istatistik.engellenen;
  const url = pathToFileURL(path.join(UI_DIR, 'newtab.html'));
  url.searchParams.set('motor', store.ayarlar.aramaMotoru);
  url.searchParams.set('dil', ceviriler.dil);
  url.searchParams.set('yon', ceviriler.yon);
  // Adresi koşulsuz veriyoruz: sayfa açıldığında simge henüz inmemiş olabilir,
  // pusula-favicon:// yerel şeması o an yoksa 404 döner ve sayfa kısa bir
  // gecikmeyle bir kez daha dener.
  const sonlar = store.sikGidilenler(8)
    .map((s) => ({ ...s, favicon: 'pusula-favicon://' + s.host }));
  url.searchParams.set('sonlar', JSON.stringify(sonlar));
  url.searchParams.set('duyurular', JSON.stringify(store.ayarlar.duyurular || []));
  // Sayfa çeviri tablosuna erişemediği için metinler burada çözülüp gönderilir.
  url.searchParams.set('metin', JSON.stringify({
    slogan: cev('hakkinda.detay'),
    ara: cev('yenisekme.ara'),
    araIpucu: cev('arac.adresIpucu'),
    sik: cev('yenisekme.sik'),
    oneCikan: cev('yenisekme.oneCikan'),
    kisayolEkle: cev('yenisekme.kisayolEkle'),
    kisayolIpucu: cev('yenisekme.kisayolIpucu'),
    gecersiz: cev('yenisekme.gecersizAdres'),
    kisayol: cev('yenisekme.kisayol'),
    kaldir: cev('panel.kaldir'),
    bosNot: cev('yenisekme.bosNot'),
    alt: engellenen > 0
      ? cev('yenisekme.engellendi', { n: engellenen.toLocaleString(ceviriler.yerel) })
      : cev('yenisekme.engelleyiciAcik')
  }));
  return url.href;
}

// Chromium hata kodlarını, kullanıcıya anlatılabilir gruplara indiriyoruz.
const HATA_GRUPLARI = {
  '-105': 'dns',
  '-106': 'cevrimdisi',
  '-102': 'baglanti', '-101': 'baglanti', '-324': 'baglanti',
  '-7': 'zamanAsimi', '-118': 'zamanAsimi',
  '-200': 'sertifikaAd',
  '-201': 'sertifikaSure',
  '-202': 'sertifikaMakam', '-501': 'sertifikaMakam',
  COKME: 'cokme'
};

const HATA_ONERILERI = {
  dns: ['sayfa.oneriAdres', 'sayfa.oneriBaglanti', 'sayfa.oneriYenile'],
  cevrimdisi: ['sayfa.oneriBaglanti', 'sayfa.oneriYenile'],
  baglanti: ['sayfa.oneriYenile', 'sayfa.oneriBaglanti'],
  zamanAsimi: ['sayfa.oneriYenile', 'sayfa.oneriBaglanti'],
  sertifikaAd: ['sayfa.oneriAdres', 'sayfa.oneriBilgiGirme'],
  sertifikaSure: ['sayfa.oneriBilgiGirme', 'sayfa.oneriYenile'],
  sertifikaMakam: ['sayfa.oneriBilgiGirme'],
  cokme: ['sayfa.oneriYenile'],
  bilinmeyen: ['sayfa.oneriYenile', 'sayfa.oneriAdres']
};

function hataAdresi(kod, aciklama, hedef) {
  const grup = HATA_GRUPLARI[String(kod)] || 'bilinmeyen';
  const url = pathToFileURL(path.join(UI_DIR, 'error.html'));
  url.searchParams.set('kod', String(kod));
  url.searchParams.set('aciklama', aciklama || '');
  url.searchParams.set('adres', hedef || '');
  url.searchParams.set('dil', ceviriler.dil);
  url.searchParams.set('yon', ceviriler.yon);
  url.searchParams.set('metin', JSON.stringify({
    baslik: cev('hata.' + grup + '.baslik'),
    aciklama: cev('hata.' + grup + '.metin'),
    oneriler: HATA_ONERILERI[grup].map((k) => cev(k)),
    tekrar: cev('sayfa.tekrarDene')
  }));
  return url.href;
}

const IC_SAYFALAR = new Set([
  pathToFileURL(path.join(UI_DIR, 'newtab.html')).href,
  pathToFileURL(path.join(UI_DIR, 'error.html')).href
]);

const icSayfaMi = icSayfaDenetleyici(IC_SAYFALAR);

function aktifSekme() {
  return aktifId != null ? sekmeler.get(aktifId) : null;
}

function sekmeSerilestir(t) {
  const wc = t.view.webContents;
  const yuklenen = t.url || '';
  const ic = icSayfaMi(yuklenen);
  // Hata sayfasındayken adres çubuğu boşalmasın: denenen adresi gösteriyoruz,
  // yoksa kullanıcı Ctrl+L ile adresi düzeltemez.
  const url = ic ? (t.hataAdresi || '') : yuklenen;
  const alan = kokAlanAdi(hostAl(url));
  return {
    id: t.id,
    baslik: t.baslik,
    url,
    gorunenUrl: url ? prettyURL(url) : '',
    // Uzak adres değil, yerel önbellek: ayrıcalıklı arayüz penceresi
    // saldırgan kontrolündeki görsel baytlarını çözmüyor.
    favicon: faviconlar ? faviconlar.adres(hostAl(url)) : '',
    yukleniyor: t.yukleniyor,
    geriGidebilir: t.geriGidebilir,
    ileriGidebilir: t.ileriGidebilir,
    guvenli: url.startsWith('https://') && !t.hataAdresi,
    hatali: !!t.hataAdresi,
    engellenen: wc.isDestroyed() ? 0 : blocker.sayac(wc.id),
    yerImi: !!url && store.yerImiVarMi(url),
    alanAdi: alan,
    siteIzinli: store.siteIzinliMi(alan),
    tamEkran: !!t.tamEkran,
    yakinlastirma: t.zoom
  };
}

function durumGonder() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('durum', {
    sekmeler: [...sekmeler.values()].map(sekmeSerilestir),
    aktifId,
    ayarlar: store.ayarlar,
    motorlar: SEARCH_ENGINES,
    izinTurleri: IZIN_TURLERI,
    listeler: listeler ? listeler.durum() : [],
    ceviri: ceviriler,
    diller: dilListesi(),
    yerImleri: store.veri.yerImleri.slice(0, 100).map((y) => ({
      ...y,
      favicon: faviconlar ? faviconlar.adres(hostAl(y.url)) : ''
    })),
    toplamEngellenen: store.veri.istatistik.engellenen,
    indirmeler: indirmeler.slice(0, 30),
    guncelleme: guncelleme ? guncelleme.bilgi() : null
  });
}

/*
 * Arayüze olay gönderir. Odağı önce arayüze almak şart: arayüz ile sayfa ayrı
 * webContents'lerde olduğu için, odak sayfadayken gönderilen "adres çubuğuna
 * git" gibi komutlardan sonra tuşlar sayfaya gitmeye devam ediyordu.
 */
function uiyeGonder(kanal, veri) {
  if (!win || win.isDestroyed()) return;
  win.webContents.focus();
  win.webContents.send(kanal, veri);
}

function yerlesimGuncelle() {
  if (!win || win.isDestroyed()) return;
  const { width, height } = win.getContentBounds();
  const y = katmanAcik ? height : chromeYukseklik;
  for (const t of sekmeler.values()) {
    if (t.view.webContents.isDestroyed()) continue;
    t.view.setBounds({ x: 0, y, width, height: Math.max(0, height - y) });
  }
}

/* ---------------------------------------------------------------- */
/* Sekme yaşam döngüsü                                               */
/* ---------------------------------------------------------------- */

function sekmeOlustur({ url, arkaPlan = false, kaynak = 'kullanici' } = {}) {
  if (kaynak === 'sayfa' && url && !sayfadanGezilebilir(url)) return null;
  // macOS'ta son pencere kapandıktan sonra menü canlı kalır; Cmd+T ile
  // buraya penceresiz düşülebiliyor.
  if (!win || win.isDestroyed()) {
    pencereOlustur();
    return null;
  }

  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // Chromium yazım denetimi sözlüklerini Google sunucusundan indirir;
      // gizlilik odaklı bir tarayıcıda beyan edilmemiş bağlantı olmasın.
      spellcheck: false,
      safeDialogs: true
    }
  });
  view.setBackgroundColor('#ffffff');

  const t = {
    id: sonrakiId++,
    view,
    baslik: cev('arac.yeniSekmeBaslik'),
    url: '',
    favicon: null,
    yukleniyor: false,
    geriGidebilir: false,
    ileriGidebilir: false,
    zoom: 0
  };
  sekmeler.set(t.id, t);
  win.contentView.addChildView(view);
  view.setVisible(false);

  olaylariBagla(t);
  view.webContents.loadURL(url || yeniSekmeAdresi());

  if (!arkaPlan) {
    sekmeSec(t.id);
  } else {
    yerlesimGuncelle();
    durumGonder();
  }
  return t;
}

function sekmeSec(id) {
  const t = sekmeler.get(id);
  if (!t) return;
  for (const [tid, tab] of sekmeler) {
    if (!tab.view.webContents.isDestroyed()) tab.view.setVisible(tid === id && !katmanAcik);
  }
  aktifId = id;
  yerlesimGuncelle();
  // Panel açıkken odağı görünmez sayfaya vermek panelde yazmayı öldürüyordu.
  if (!katmanAcik && !t.view.webContents.isDestroyed()) t.view.webContents.focus();
  durumGonder();
}

function sekmeKapat(id) {
  const t = sekmeler.get(id);
  if (!t) return;
  const sira = [...sekmeler.keys()];
  const konum = sira.indexOf(id);

  sekmeler.delete(id);
  try {
    win.contentView.removeChildView(t.view);
    blocker.unut(t.view.webContents.id);
    t.view.webContents.close();
  } catch { /* zaten kapanmış olabilir */ }

  if (sekmeler.size === 0) {
    aktifId = null;
    sekmeOlustur({});
    return;
  }
  if (aktifId === id) {
    const kalan = [...sekmeler.keys()];
    sekmeSec(kalan[Math.min(konum, kalan.length - 1)]);
  } else {
    durumGonder();
  }
}

function olaylariBagla(t) {
  const wc = t.view.webContents;
  const wcId = wc.id;   // 'destroyed' tetiklendiğinde wc.id artık okunamaz

  const tazele = () => {
    if (wc.isDestroyed()) return;
    t.geriGidebilir = wc.navigationHistory.canGoBack();
    t.ileriGidebilir = wc.navigationHistory.canGoForward();
    durumGonder();
  };

  wc.on('page-title-updated', (_e, baslik) => {
    const yeni = baslik || cev('arac.adsiz');
    // Başlığını sayaçla güncelleyen siteler saniyede birkaç kez diske yazma
    // ve arayüz yeniden çizimi tetikliyordu.
    if (yeni === t.baslik) return;
    t.baslik = yeni;
    store.gecmiseEkle(t.url, t.baslik);
    durumGonder();
  });

  wc.on('page-favicon-updated', (_e, favicons) => {
    const yeni = favicons && favicons[0] ? favicons[0] : null;
    if (yeni === t.favicon) return;
    t.favicon = yeni;
    // Simgeyi bir kez indirip yerel önbelleğe alıyoruz; arayüz oradan okuyor.
    if (yeni && faviconlar) faviconlar.kaydet(hostAl(t.url), yeni);
    durumGonder();
  });

  wc.on('did-start-loading', () => { t.yukleniyor = true; durumGonder(); });
  wc.on('did-stop-loading', () => { t.yukleniyor = false; tazele(); });

  wc.on('did-start-navigation', (e) => {
    // Aynı belge içindeki (SPA rota) gezinmelerde engelleyici sayacını sıfırlama.
    if (e.isMainFrame && !e.isSameDocument) blocker.ustAlanAyarla(wcId, e.url);
  });

  wc.on('did-navigate', (_e, url) => {
    t.url = url;
    t.favicon = null;
    if (!icSayfaMi(url)) t.hataAdresi = null;
    blocker.ustAlanAyarla(wcId, url);
    store.gecmiseEkle(url, t.baslik);
    tazele();
  });

  wc.on('did-navigate-in-page', (_e, url, anaCerceve) => {
    if (!anaCerceve) return;
    t.url = url;
    tazele();
  });

  wc.on('did-fail-load', (_e, kod, aciklama, adres, anaCerceve) => {
    // -3 = ABORTED: kullanıcı gezinmeyi iptal etti, hata sayfası gösterme.
    if (wc.isDestroyed() || !anaCerceve || kod === -3) return;
    t.hataAdresi = adres || t.url || '';
    wc.loadURL(hataAdresi(kod, aciklama, adres));
  });

  wc.on('render-process-gone', (_e, ayrinti) => {
    if (wc.isDestroyed()) return;
    t.hataAdresi = t.url || '';
    wc.loadURL(hataAdresi('COKME', 'Sayfa beklenmedik şekilde kapandı (' + ayrinti.reason + ').', t.url));
  });

  wc.setWindowOpenHandler(({ url, disposition }) => {
    sekmeOlustur({ url, arkaPlan: disposition === 'background-tab', kaynak: 'sayfa' });
    return { action: 'deny' };
  });

  wc.on('will-navigate', (e, url) => {
    if (sayfadanGezilebilir(url) || /^about:/i.test(url)) return;
    e.preventDefault();
    disHarici(url);
  });

  wc.on('found-in-page', (_e, sonuc) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('bulma-sonucu', {
      etkin: sonuc.activeMatchOrdinal, toplam: sonuc.matches
    });
  });

  /*
   * Sayfa HTML tam ekrana geçtiğinde görünümü pencerenin tamamına BÜYÜTMÜYORUZ.
   * 2026'da Chrome'da art arda kapatılan tam ekran sahteciliği açıkları
   * (CVE-2026-5882, -13988, -11666, -84356) tam olarak bunu kullanıyordu:
   * sayfa tam ekrana geçip üstüne sahte bir adres çubuğu çiziyordu. Gerçek
   * adres çubuğu her zaman ekranda kaldığı sürece bu numara tutmaz.
   */
  wc.on('enter-html-full-screen', () => {
    t.tamEkran = true;
    yerlesimGuncelle();     // sınırları yeniden dayat
    durumGonder();
  });
  wc.on('leave-html-full-screen', () => {
    t.tamEkran = false;
    yerlesimGuncelle();
    durumGonder();
  });

  wc.on('context-menu', (_e, params) => baglamMenusu(t, params));
  wc.on('destroyed', () => blocker.unut(wcId));
}

// Harici uygulamaya devredilebilecek şemalar. Windows'ta search-ms:, ms-msdt:
// gibi şemalar tek tıkla kod çalıştırma zincirine kapı açtığı için liste dar.
let disOnayAcik = false;

async function disHarici(url) {
  // Aynı anda tek onay kutusu: sayfa döngüyle çağırıp pencereyi kilitleyemesin.
  if (disOnayAcik || !win || win.isDestroyed()) return;

  let u;
  try { u = new URL(url); } catch { return; }
  if (!disSemaIzinli(url)) return;

  disOnayAcik = true;
  try {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [cev('dialog.iptal'), cev('dialog.ac')],
      defaultId: 0,
      cancelId: 0,
      title: cev('dialog.disBaslik'),
      message: cev('dialog.disMesaj', { sema: u.protocol.slice(0, -1) }),
      detail: String(url).slice(0, 400)
    });
    if (response === 1) shell.openExternal(url);
  } finally {
    disOnayAcik = false;
  }
}

/* ---------------------------------------------------------------- */
/* Bağlam menüsü                                                     */
/* ---------------------------------------------------------------- */

function baglamMenusu(t, p) {
  const wc = t.view.webContents;
  const ogeler = [];

  if (p.linkURL) {
    ogeler.push(
      {
        label: cev('baglam.baglantiYeniSekme'),
        enabled: sayfadanGezilebilir(p.linkURL),
        click: () => sekmeOlustur({ url: p.linkURL, arkaPlan: true, kaynak: 'sayfa' })
      },
      { label: cev('baglam.baglantiKopyala'), click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' }
    );
  }
  if (p.mediaType === 'image' && p.srcURL) {
    ogeler.push(
      {
        label: cev('baglam.gorselYeniSekme'),
        enabled: sayfadanGezilebilir(p.srcURL),
        click: () => sekmeOlustur({ url: p.srcURL, arkaPlan: true, kaynak: 'sayfa' })
      },
      { label: cev('baglam.gorselKopyala'), click: () => clipboard.writeText(p.srcURL) },
      { label: cev('baglam.gorselKaydet'), click: () => wc.downloadURL(p.srcURL) },
      { type: 'separator' }
    );
  }
  if (p.isEditable) {
    ogeler.push(
      { role: 'undo', label: cev('menu.geriAl') },
      { role: 'redo', label: cev('menu.yinele') },
      { type: 'separator' },
      { role: 'cut', label: cev('menu.kes') },
      { role: 'copy', label: cev('menu.kopyala') },
      { role: 'paste', label: cev('menu.yapistir') },
      { role: 'selectAll', label: cev('menu.tumunuSec') },
      { type: 'separator' }
    );
  } else if (p.selectionText) {
    const secim = p.selectionText.trim().slice(0, 40);
    ogeler.push(
      { role: 'copy', label: cev('menu.kopyala') },
      {
        label: cev('baglam.ara', { q: secim }),
        click: () => sekmeOlustur({ url: resolveInput(p.selectionText, store.ayarlar.aramaMotoru) })
      },
      { type: 'separator' }
    );
  }

  ogeler.push(
    { label: cev('menu.geri'), enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: cev('menu.ileri'), enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: cev('menu.yenile'), click: () => wc.reload() },
    { type: 'separator' },
    {
      label: cev('baglam.kaynak'),
      enabled: /^https?:/i.test(t.url || ''),
      click: () => sekmeOlustur({ url: 'view-source:' + t.url, kaynak: 'sayfa' })
    },
    { label: cev('baglam.incele'), click: () => wc.inspectElement(p.x, p.y) }
  );

  Menu.buildFromTemplate(ogeler).popup({ window: win });
}

function yakinlastir(yon, sifirla = false) {
  const t = aktifSekme();
  if (!t || t.view.webContents.isDestroyed()) return;
  t.zoom = sifirla ? 0 : Math.max(-4, Math.min(6, t.zoom + yon * 0.5));
  t.view.webContents.setZoomLevel(t.zoom);
  durumGonder();
}

function sekmeAtla(yon) {
  const k = [...sekmeler.keys()];
  if (k.length < 2) return;
  const i = k.indexOf(aktifId);
  sekmeSec(k[(i + yon + k.length) % k.length]);
}

/* ---------------------------------------------------------------- */
/* Uygulama menüsü — kısayollar sayfa odaktayken de çalışsın diye     */
/* ---------------------------------------------------------------- */

/* ---------------------------------------------------------------- */
/* Araç çubuğundaki ana menü                                         */
/* ---------------------------------------------------------------- */

// Electron yakınlaştırmayı seviye olarak tutuyor; kullanıcı yüzde bekliyor.
function yakinlastirmaYuzdesi(seviye) {
  return Math.round(Math.pow(1.2, seviye || 0) * 100);
}

async function sayfayiKaydet() {
  const s = aktifSekme();
  if (!s || s.view.webContents.isDestroyed() || icSayfaMi(s.url)) return;
  const ad = (s.baslik || 'sayfa').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + '.html';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('downloads'), ad)
  });
  if (canceled || !filePath) return;
  try {
    await s.view.webContents.savePage(filePath, 'HTMLComplete');
  } catch (e) {
    console.error('Sayfa kaydedilemedi:', e.message);
  }
}

async function anaMenuGoster(konum) {
  if (!win || win.isDestroyed()) return;
  const s = aktifSekme();
  const wc = s && !s.view.webContents.isDestroyed() ? s.view.webContents : null;
  const gercekSayfa = !!(s && !icSayfaMi(s.url));

  // Alt menülerde son gezilen sayfalar ve yer imleri doğrudan açılabilsin.
  const sonGecmis = store.gecmisAra('', 8).map((k) => ({
    label: (k.baslik || k.url).slice(0, 60),
    click: () => sekmeOlustur({ url: k.url })
  }));
  const yerImleri = store.veri.yerImleri.slice(0, 12).map((y) => ({
    label: (y.baslik || y.url).slice(0, 60),
    click: () => sekmeOlustur({ url: y.url })
  }));

  const sablon = [
    { label: cev('menu.yeniSekme'), accelerator: 'CmdOrCtrl+T', click: () => sekmeOlustur({}) },
    { label: cev('menu.sekmeyiKapat'), accelerator: 'CmdOrCtrl+W', enabled: !!aktifId, click: () => aktifId && sekmeKapat(aktifId) },
    { type: 'separator' },
    {
      label: cev('menu.gecmis'),
      submenu: [
        { label: cev('menu.gecmisiGoster'), accelerator: 'CmdOrCtrl+H', click: () => uiyeGonder('panel-ac', 'gecmis') },
        ...(sonGecmis.length ? [{ type: 'separator' }, ...sonGecmis] : [])
      ]
    },
    { label: cev('menu.indirilenler'), accelerator: 'CmdOrCtrl+J', click: () => uiyeGonder('panel-ac', 'indirmeler') },
    {
      label: cev('menu.yerImleri'),
      submenu: [
        {
          label: cev('menu.yerImiEkle'),
          accelerator: 'CmdOrCtrl+D',
          enabled: gercekSayfa,
          click: () => { if (s) { store.yerImiDegistir(s.url, s.baslik); durumGonder(); } }
        },
        { label: cev('menu.yerImleriniGoster'), accelerator: 'CmdOrCtrl+Shift+O', click: () => uiyeGonder('panel-ac', 'yerImleri') },
        {
          label: cev('menu.yerImleriCubugu'),
          type: 'checkbox',
          checked: !!store.ayarlar.yerImleriCubugu,
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => { store.ayarla('yerImleriCubugu', !store.ayarlar.yerImleriCubugu); durumGonder(); }
        },
        ...(yerImleri.length ? [{ type: 'separator' }, ...yerImleri] : [])
      ]
    },
    { type: 'separator' },
    {
      label: cev('menu.yakinlastirma') + '  ' + yakinlastirmaYuzdesi(s && s.zoom) + '%',
      submenu: [
        { label: cev('menu.yakinlastir'), accelerator: 'CmdOrCtrl+Plus', enabled: !!wc, click: () => yakinlastir(1) },
        { label: cev('menu.uzaklastir'), accelerator: 'CmdOrCtrl+-', enabled: !!wc, click: () => yakinlastir(-1) },
        { label: cev('menu.normalBoyut'), accelerator: 'CmdOrCtrl+0', enabled: !!wc, click: () => yakinlastir(0, true) },
        { type: 'separator' },
        { label: cev('menu.tamEkran'), accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) }
      ]
    },
    {
      label: cev('ayar.tema'),
      submenu: [
        ['sistem', 'ayar.temaSistem'], ['acik', 'ayar.temaAcik'], ['koyu', 'ayar.temaKoyu']
      ].map(([deger, anahtar]) => ({
        label: cev(anahtar),
        type: 'radio',
        checked: (store.ayarlar.tema || 'sistem') === deger,
        click: () => { store.ayarla('tema', deger); temayiUygula(); durumGonder(); }
      }))
    },
    { type: 'separator' },
    { label: cev('menu.yazdir'), accelerator: 'CmdOrCtrl+P', enabled: gercekSayfa, click: () => wc && wc.print() },
    { label: cev('menu.sayfayiKaydet'), accelerator: 'CmdOrCtrl+S', enabled: gercekSayfa, click: () => sayfayiKaydet() },
    { label: cev('menu.sayfadaBul'), accelerator: 'CmdOrCtrl+F', enabled: !!wc, click: () => uiyeGonder('bulma-ac') },
    {
      label: cev('menu.digerAraclar'),
      submenu: [
        { label: cev('baglam.kaynak'), enabled: gercekSayfa, click: () => sekmeOlustur({ url: 'view-source:' + s.url, kaynak: 'sayfa' }) },
        { label: cev('menu.gelistirici'), accelerator: 'CmdOrCtrl+Shift+I', enabled: !!wc, click: () => wc.toggleDevTools() },
        { label: cev('menu.arayuzGelistirici'), accelerator: 'CmdOrCtrl+Shift+U', click: () => win.webContents.toggleDevTools() }
      ]
    },
    { type: 'separator' },
    { label: cev('menu.veriSil'), accelerator: 'CmdOrCtrl+Shift+Delete', click: () => uiyeGonder('panel-ac', 'ayarlar') },
    { label: cev('menu.ayarlar'), accelerator: 'CmdOrCtrl+,', click: () => uiyeGonder('panel-ac', 'ayarlar') },
    { label: cev('menu.hakkinda'), click: () => hakkindaGoster() },
    { type: 'separator' },
    { label: cev('menu.cikis'), accelerator: 'CmdOrCtrl+Q', role: 'quit' }
  ];

  const menu = Menu.buildFromTemplate(sablon);
  const genislik = await menuGenisligi(sablon);
  menu.popup({ window: win, ...menuKonumu(genislik, konum) });
}

/*
 * Menü genişliği tahmin edilmiyor, ölçülüyor: etiketleri arayüz penceresinde
 * canvas ile ölçtürüyoruz. Etiketler kendi çeviri tablomuzdan geliyor, yani
 * enjekte edilen metin bize ait. Ölçüm başarısız olursa kaba tahmine düşüyoruz.
 */
async function menuGenisligi(sablon) {
  const etiketler = sablon.filter((o) => o.label).map((o) => String(o.label));
  if (!etiketler.length || !win || win.isDestroyed()) return genislikTahmini(sablon);
  try {
    const kod = `(() => {
      const c = document.createElement('canvas').getContext('2d');
      c.font = '12px "Segoe UI", system-ui, sans-serif';
      return ${JSON.stringify(etiketler)}.reduce((m, s) => Math.max(m, c.measureText(s).width), 0);
    })()`;
    return olcumdenGenislik(await win.webContents.executeJavaScript(kod, false))
      || genislikTahmini(sablon);
  } catch {
    return genislikTahmini(sablon);
  }
}

function menuKonumu(genislik, konum) {
  if (!konum || !Number.isFinite(konum.y)) return {};
  const pencere = win.getContentBounds().width;
  // Sağdaki düğmeler sağ kenara, soldakiler sol kenara hizalanır.
  if (Number.isFinite(konum.sol)) {
    return { x: xKonumuSol(konum.sol, pencere, genislik), y: Math.round(konum.y) };
  }
  if (Number.isFinite(konum.sag)) {
    return { x: xKonumu(konum.sag, pencere, genislik), y: Math.round(konum.y) };
  }
  return {};
}

/* ---------------------------------------------------------------- */
/* Adres çubuğundaki site bilgisi menüsü                             */
/* ---------------------------------------------------------------- */

async function siteVerisiSil(origin, host) {
  try {
    await ses.clearStorageData({ origin });
    // clearStorageData çerezleri origin'e göre silmiyor; tek tek kaldırıyoruz.
    const cerezler = await ses.cookies.get({ domain: host });
    for (const c of cerezler) {
      const adres = (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + c.path;
      await ses.cookies.remove(adres, c.name).catch(() => {});
    }
  } catch (e) {
    console.error('Site verisi silinemedi:', e.message);
  }
  const s = aktifSekme();
  if (s && !s.view.webContents.isDestroyed()) s.view.webContents.reload();
  durumGonder();
}

async function siteMenusuGoster(konum) {
  const s = aktifSekme();
  if (!s || !s.url || icSayfaMi(s.url)) return;

  let u;
  try { u = new URL(s.url); } catch { return; }
  const host = u.hostname;
  const kok = kokAlanAdi(hostAl(s.url));
  const guvenli = u.protocol === 'https:';

  let cerezSayisi = 0;
  try { cerezSayisi = (await ses.cookies.get({ domain: host })).length; } catch { /* yoksay */ }

  const sertifika = sertifikalar.ozetAl(host, ceviriler.yerel);
  const baglantiAlt = !guvenli
    ? [{ label: cev('site.guvensizUyari'), enabled: false }]
    : (sertifika
      ? [
        { label: cev('site.sertifikaVeren', { ad: sertifika.veren || '—' }), enabled: false },
        { label: cev('site.sertifikaSahip', { ad: sertifika.sahip || host }), enabled: false },
        { label: cev('site.sertifikaGecerlilik', { bas: sertifika.baslangic, bit: sertifika.bitis }), enabled: false },
        { type: 'separator' },
        {
          label: cev('site.parmakIzi'),
          enabled: !!sertifika.parmakIzi,
          click: () => clipboard.writeText(sertifika.parmakIzi)
        }
      ]
      : [{ label: cev('site.sertifikaYok'), enabled: false }]);

  const engelleyiciAcik = !!store.ayarlar.engelleyiciAcik && !store.siteIzinliMi(kok);

  const sablon = [
    { label: host, enabled: false },
    { type: 'separator' },
    { label: cev(guvenli ? 'site.baglantiGuvenli' : 'site.baglantiGuvensiz'), submenu: baglantiAlt },
    {
      label: cev('site.cerezler'),
      submenu: [
        { label: cev('site.cerezSayisi', { n: cerezSayisi }), enabled: false },
        { type: 'separator' },
        { label: cev('site.veriSil'), click: () => siteVerisiSil(u.origin, host) }
      ]
    },
    {
      label: cev('site.engelleyici'),
      type: 'checkbox',
      checked: engelleyiciAcik,
      enabled: !!kok && !!store.ayarlar.engelleyiciAcik,
      click: () => {
        if (!kok) return;
        store.siteIzniDegistir(kok);
        const a = aktifSekme();
        if (a && !a.view.webContents.isDestroyed()) a.view.webContents.reload();
        durumGonder();
      }
    },
    { type: 'separator' },
    {
      label: cev('site.izinSifirla'),
      click: () => { store.izinSil(u.origin); durumGonder(); }
    },
    { label: cev('site.ayarlar'), click: () => uiyeGonder('panel-ac', 'ayarlar') }
  ];

  const menu = Menu.buildFromTemplate(sablon);
  const genislik = await menuGenisligi(sablon);
  menu.popup({ window: win, ...menuKonumu(genislik, konum) });
}

function hakkindaGoster() {
  dialog.showMessageBox(win, {
    type: 'info',
    title: cev('menu.hakkinda'),
    message: app.getName() + ' ' + app.getVersion(),
    detail: cev('hakkinda.detay') +
      '\n\nChromium ' + process.versions.chrome +
      '\nElectron ' + process.versions.electron +
      '\nNode ' + process.versions.node
  });
}

function menuKur() {
  const aktifWc = () => {
    const t = aktifSekme();
    return t && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
  };
  const uiye = uiyeGonder;
  const wcIle = (fn) => () => { const c = aktifWc(); if (c) fn(c); };

  const sablon = [
    {
      label: cev('menu.dosya'),
      submenu: [
        // Not: Sekme durumu (sekmeler, aktifId, chromeYukseklik) tek pencereye
        // bağlı olduğu için ikinci pencere ilkini bozardı; çoklu pencere
        // desteklenene kadar menüde yer almıyor.
        { label: cev('menu.yeniSekme'), accelerator: 'CmdOrCtrl+T', click: () => sekmeOlustur({}) },
        { label: cev('menu.sekmeyiKapat'), accelerator: 'CmdOrCtrl+W', click: () => aktifId && sekmeKapat(aktifId) },
        { type: 'separator' },
        { label: cev('menu.adresCubugu'), accelerator: 'CmdOrCtrl+L', click: () => uiye('adres-odak') },
        { label: cev('menu.sayfadaBul'), accelerator: 'CmdOrCtrl+F', click: () => uiye('bulma-ac') },
        { type: 'separator' },
        {
          label: cev('menu.yazdir'), accelerator: 'CmdOrCtrl+P',
          click: wcIle((c) => c.print())
        },
        { label: cev('menu.sayfayiKaydet'), accelerator: 'CmdOrCtrl+S', click: () => sayfayiKaydet() },
        {
          label: cev('menu.veriSil'), accelerator: 'CmdOrCtrl+Shift+Delete',
          click: () => uiye('panel-ac', 'ayarlar')
        },
        { type: 'separator' },
        { label: cev('menu.cikis'), accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: cev('menu.duzen'),
      submenu: [
        { role: 'undo', label: cev('menu.geriAl') },
        { role: 'redo', label: cev('menu.yinele') },
        { type: 'separator' },
        { role: 'cut', label: cev('menu.kes') },
        { role: 'copy', label: cev('menu.kopyala') },
        { role: 'paste', label: cev('menu.yapistir') },
        { role: 'selectAll', label: cev('menu.tumunuSec') }
      ]
    },
    {
      label: cev('menu.gorunum'),
      submenu: [
        { label: cev('menu.yenile'), accelerator: 'CmdOrCtrl+R', click: wcIle(c => c.reload()) },
        { label: cev('menu.onbelleksizYenile'), accelerator: 'CmdOrCtrl+Shift+R', click: wcIle(c => c.reloadIgnoringCache()) },
        { label: cev('menu.yenile'), accelerator: 'F5', visible: false, click: wcIle(c => c.reload()) },
        { type: 'separator' },
        { label: cev('menu.yakinlastir'), accelerator: 'CmdOrCtrl+Plus', click: () => yakinlastir(1) },
        { label: cev('menu.yakinlastir'), accelerator: 'CmdOrCtrl+=', visible: false, click: () => yakinlastir(1) },
        { label: cev('menu.uzaklastir'), accelerator: 'CmdOrCtrl+-', click: () => yakinlastir(-1) },
        { label: cev('menu.normalBoyut'), accelerator: 'CmdOrCtrl+0', click: () => yakinlastir(0, true) },
        { type: 'separator' },
        { label: cev('menu.tamEkran'), accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
        { type: 'separator' },
        { label: cev('menu.gelistirici'), accelerator: 'CmdOrCtrl+Shift+I', click: wcIle(c => c.toggleDevTools()) },
        { label: cev('menu.arayuzGelistirici'), accelerator: 'CmdOrCtrl+Shift+U', click: () => win && win.webContents.toggleDevTools() }
      ]
    }
  ];

  sablon.push(
    {
      label: cev('menu.gecmis'),
      submenu: [
        { label: cev('menu.geri'), accelerator: 'Alt+Left', click: wcIle(c => c.navigationHistory.goBack()) },
        { label: cev('menu.ileri'), accelerator: 'Alt+Right', click: wcIle(c => c.navigationHistory.goForward()) },
        { type: 'separator' },
        { label: cev('menu.gecmisiGoster'), accelerator: 'CmdOrCtrl+H', click: () => uiye('panel-ac', 'gecmis') },
        { label: cev('menu.indirilenler'), accelerator: 'CmdOrCtrl+J', click: () => uiye('panel-ac', 'indirmeler') }
      ]
    },
    {
      label: cev('menu.yerImleri'),
      submenu: [
        { label: cev('menu.yerImiEkle'), accelerator: 'CmdOrCtrl+D', click: () => uiye('yer-imi-degistir') },
        { label: cev('menu.yerImleriniGoster'), accelerator: 'CmdOrCtrl+Shift+O', click: () => uiye('panel-ac', 'yerImleri') },
        { type: 'separator' },
        {
          label: cev('menu.yerImleriCubugu'), accelerator: 'CmdOrCtrl+Shift+B',
          click: () => { store.ayarla('yerImleriCubugu', !store.ayarlar.yerImleriCubugu); durumGonder(); }
        }
      ]
    },
    {
      label: cev('menu.sekmeler'),
      submenu: [
        { label: cev('menu.sonrakiSekme'), accelerator: 'Ctrl+Tab', click: () => sekmeAtla(1) },
        { label: cev('menu.oncekiSekme'), accelerator: 'Ctrl+Shift+Tab', click: () => sekmeAtla(-1) },
        { type: 'separator' },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
          label: cev('menu.nSekme', { n }), accelerator: 'CmdOrCtrl+' + n, visible: false,
          click: () => { const k = [...sekmeler.keys()]; if (k[n - 1]) sekmeSec(k[n - 1]); }
        })),
        {
          label: cev('menu.sonSekme'), accelerator: 'CmdOrCtrl+9', visible: false,
          click: () => { const k = [...sekmeler.keys()]; if (k.length) sekmeSec(k[k.length - 1]); }
        }
      ]
    },
    {
      label: cev('menu.yardim'),
      submenu: [
        { label: cev('menu.ayarlar'), accelerator: 'CmdOrCtrl+,', click: () => uiye('panel-ac', 'ayarlar') },
        { label: cev('menu.guncellemeDenetle'), click: () => uiye('panel-ac', 'ayarlar') },
        { label: cev('menu.hakkinda'), click: () => hakkindaGoster() }
      ]
    }
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(sablon));
}

/* ---------------------------------------------------------------- */
/* Oturum: engelleyici, izinler, indirmeler                          */
/* ---------------------------------------------------------------- */

// Adları src/diller altındaki 'izin.*' anahtarlarından geliyor.
const IZIN_TURLERI = [
  'notifications', 'geolocation', 'media', 'midi', 'midiSysex',
  'clipboard-read', 'display-capture', 'openExternal', 'idle-detection',
  'pointerLock', 'fullscreen'
];

// Görünmez yön/kontrol karakterleri dosya adında uzantıyı ters çevirebiliyor:
// "fatura‮gnp.exe" arayüzde "faturaexe.png" diye okunur.

let izinOnayAcik = false;

function oturumKur() {
  ses = session.fromPartition(OTURUM);
  // Electron varsayılan UA'sı hem "Electron/x" hem uygulama adı belirteci taşır;
  // ikisi de güçlü bir parmak izi ve saldırgana sürüm bilgisi verir.
  // Desen uygulama adından kuruluyor: ad değişince burası sessizce bozulmasın.
  const adDeseni = app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const belirtec = new RegExp('(?:Electron|' + adDeseni + ')/[0-9.]+\\s*', 'g');
  ses.setUserAgent(ses.getUserAgent().replace(belirtec, ''));

  /*
   * Sertifikayı yalnızca İZLİYORUZ: -3 "Chromium'un kendi doğrulama sonucunu
   * kullan" demek. 0 dönmek doğrulamayı atlamak olurdu.
   */
  ses.setCertificateVerifyProc((istek, geriCagir) => {
    sertifikalar.kaydet(istek.hostname, istek.certificate);
    geriCagir(-3);
  });

  blocker = new Blocker(store);
  blocker.bagla(ses, durumGonder);

  // Liste indirmeleri ayrı ve kalıcı olmayan bir oturumdan çıkar: çerez
  // saklamaz, gezinti oturumunun başlıklarını ve önbelleğini kirletmez.
  const indirmeOturumu = session.fromPartition('liste-indirme');
  listeler = new ListeYoneticisi({
    store,
    veriDizini: app.getPath('userData'),
    getir: async (url, basliklar) => {
      const y = await indirmeOturumu.fetch(url, {
        cache: 'no-cache',
        headers: { 'User-Agent': 'GirginosBrowser/' + app.getVersion(), ...basliklar }
      });
      return {
        durum: y.status,
        metin: y.status === 200 ? await y.text() : '',
        etag: y.headers.get('etag') || '',
        sonDegisiklik: y.headers.get('last-modified') || ''
      };
    },
    degisti: durumGonder
  });
  blocker.listeleriBagla(listeler);

  faviconlar = new FaviconDeposu({
    veriDizini: app.getPath('userData'),
    oturum: ses,
    degisti: durumGonder
  });
  faviconlar.protokoluBagla();

  guncelleme = new GuncellemeYoneticisi({
    app,
    oturum: indirmeOturumu,
    degisti: durumGonder,
    ayarOku: () => ({
      otomatikKontrol: store.ayarlar.guncellemeKontrol,
      otomatikIndir: store.ayarlar.guncellemeIndir,
      kanal: store.ayarlar.guncellemeKanali
    })
  });

  ses.setPermissionRequestHandler(async (wc, izin, callback, ayrinti) => {
    // Yalnızca kullanıcının o an baktığı sekme izin isteyebilir; arka plandaki
    // bir sekme, öndeki siteye aitmiş gibi görünen bir kutu açamasın.
    const s = aktifSekme();
    if (!s || s.view.webContents.isDestroyed() || s.view.webContents.id !== wc.id) return callback(false);

    let u;
    try { u = new URL((ayrinti && ayrinti.requestingUrl) || wc.getURL()); } catch { return callback(false); }
    // data:, blob:, about: gibi opak kaynaklar origin olarak "null" döndürür;
    // kaydedilirse tüm siteler için ortak bir izin kovası oluşurdu.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return callback(false);
    const origin = u.origin;

    // 1) Bu site için daha önce verilmiş karar
    const kayitli = store.izinOku(origin, izin);
    if (kayitli) return callback(kayitli === 'izin');

    // 2) Ayarlar'daki genel varsayılan; 'sor' değilse kutu hiç açılmaz.
    const varsayilan = (store.ayarlar.izinVarsayilan || {})[izin] || 'sor';
    if (varsayilan !== 'sor') return callback(varsayilan === 'izin');

    // 3) Kullanıcıya sor
    if (izinOnayAcik) return callback(false);
    izinOnayAcik = true;
    try {
      const { response, checkboxChecked } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: [cev('dialog.reddet'), cev('dialog.izinVer')],
        defaultId: 0,
        cancelId: 0,
        title: cev('dialog.izinBaslik'),
        message: cev('dialog.izinMesaj', { origin }),
        detail: cev('izin.' + izin),
        checkboxLabel: cev('dialog.izinHatirla')
      });
      if (checkboxChecked) store.izinKaydet(origin, izin, response === 1 ? 'izin' : 'ret');
      callback(response === 1);
    } finally {
      izinOnayAcik = false;
    }
  });

  ses.on('will-download', (_e, item) => {
    const ad = indirmeAdiNormalle(item.getFilename());
    const kayit = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      ad,
      calistirilabilir: calistirilabilirMi(ad),
      url: item.getURL(),
      toplam: item.getTotalBytes(),
      alinan: 0,
      durum: 'devam',
      yol: ''
    };
    indirmeler.unshift(kayit);
    durumGonder();

    item.on('updated', (_ev, durum) => {
      kayit.alinan = item.getReceivedBytes();
      kayit.durum = durum === 'interrupted' ? 'kesildi' : 'devam';
      durumGonder();
    });
    item.once('done', (_ev, durum) => {
      kayit.durum = durum === 'completed' ? 'tamam' : (durum === 'cancelled' ? 'iptal' : 'hata');
      kayit.yol = item.getSavePath();
      // Kullanıcı kaydetme kutusunda adı değiştirmiş olabilir; kararı diskteki
      // gerçek ada göre yeniden veriyoruz.
      if (kayit.yol) kayit.calistirilabilir = calistirilabilirMi(path.basename(kayit.yol));
      durumGonder();
    });
  });
}

/* ---------------------------------------------------------------- */
/* Pencere                                                           */
/* ---------------------------------------------------------------- */

/*
 * Tema ayari nativeTheme.themeSource'a aktariliyor. Bunun bir yan etkisi var
 * ve tam da istedigimiz sey: Chromium butun renderer'larda prefers-color-scheme
 * degerini buna gore bildiriyor. Yani arayuz, yeni sekme/gecmis gibi ic
 * sayfalar ve yerel menuler tek yerden donuyor; ayri bir CSS anahtari
 * tasimamiza gerek kalmiyor.
 */
function temayiUygula() {
  const t = store.ayarlar.tema;
  nativeTheme.themeSource = t === 'acik' ? 'light' : t === 'koyu' ? 'dark' : 'system';
}

function baslikCubuguRengi() {
  const koyu = nativeTheme.shouldUseDarkColors;
  return {
    color: koyu ? '#16181d' : '#eef0f4',
    symbolColor: koyu ? '#e8eaee' : '#3a3f4b',
    height: 40
  };
}

function pencereOlustur() {
  const koyu = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 560,
    minHeight: 380,
    backgroundColor: koyu ? '#16181d' : '#eef0f4',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : baslikCubuguRengi(),
    trafficLightPosition: { x: 12, y: 13 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Preload yalnızca contextBridge/ipcRenderer kullanıyor, sandbox'la
      // çalışır. Ayrıcalıklı olan tek pencere bu olduğu için önemli:
      // favicon'lar burada çözülüyor.
      sandbox: true,
      // Favicon istekleri de engelleyiciden ve DNT başlıklarından geçsin,
      // çerezleri sekmelerle aynı kavanoza yazılsın.
      session: ses
    }
  });

  win.loadFile(path.join(UI_DIR, 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('resize', yerlesimGuncelle);
  win.on('enter-full-screen', yerlesimGuncelle);
  win.on('leave-full-screen', yerlesimGuncelle);
  win.on('closed', () => {
    // Sekmeler pencereyle birlikte yok edilmezse renderer süreçleri ayakta kalır.
    for (const t of sekmeler.values()) {
      try { if (!t.view.webContents.isDestroyed()) t.view.webContents.close(); } catch { /* zaten kapanmış */ }
    }
    win = null;
    sekmeler.clear();
    aktifId = null;
  });

  win.webContents.on('did-finish-load', () => {
    if (sekmeler.size === 0) sekmeOlustur({});
    else { yerlesimGuncelle(); durumGonder(); }
  });

  // Arayüz penceresinin kendisi hiçbir yere gezinmesin.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) sekmeOlustur({ url });
    return { action: 'deny' };
  });

  return win;
}

/* ---------------------------------------------------------------- */
/* IPC                                                               */
/* ---------------------------------------------------------------- */

// Ayar anahtarları ve kabul edilen değer tipleri. Doğrulamasız yazmak
// "__proto__" gibi anahtarların ayar nesnesine geçmesine izin verirdi.
const GECERLI_DILLER = new Set(['sistem', ...dilListesi().map(d => d.kod)]);

const AYAR_DOGRULAMA = {
  dil: (v) => typeof v === 'string' && GECERLI_DILLER.has(v),
  tema: (v) => v === 'sistem' || v === 'acik' || v === 'koyu',
  aramaMotoru: (v) => typeof v === 'string' && Object.hasOwn(SEARCH_ENGINES, v),
  anasayfa: (v) => typeof v === 'string' && v.length <= 2048,
  engelleyiciAcik: (v) => typeof v === 'boolean',
  dntGonder: (v) => typeof v === 'boolean',
  gecmisiKaydet: (v) => typeof v === 'boolean',
  yerImleriCubugu: (v) => typeof v === 'boolean',
  filtreListeleriAcik: (v) => typeof v === 'boolean',
  otomatikGuncelle: (v) => typeof v === 'boolean',
  guncellemeKontrol: (v) => typeof v === 'boolean',
  guncellemeIndir: (v) => typeof v === 'boolean',
  guncellemeKanali: (v) => v === 'kararli' || v === 'beta'
};

const DIS_SEMA_GIRDISI = /^(mailto|tel|sms|magnet|ftp|ftps|webcal):/i;
const TEMIZLENECEK = ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'];

function ipcKur() {
  const wcAl = () => {
    const s = aktifSekme();
    return s && !s.view.webContents.isDestroyed() ? s.view.webContents : null;
  };

  // Bugün preload yalnızca arayüz penceresine bağlı; yine de her kanalın
  // yalnızca oradan çağrılabildiğini burada sabitliyoruz.
  const arayuzden = (e) =>
    !!win && !win.isDestroyed() && !!e.senderFrame && e.senderFrame === win.webContents.mainFrame;
  const on = (kanal, fn) => ipcMain.on(kanal, (e, ...a) => { if (arayuzden(e)) fn(e, ...a); });
  const handle = (kanal, fn) => ipcMain.handle(kanal, (e, ...a) => (arayuzden(e) ? fn(e, ...a) : null));

  on('ui:hazir', () => durumGonder());

  on('ui:yukseklik', (_e, px) => {
    if (!Number.isFinite(px)) return;
    const yeni = Math.max(40, Math.min(2000, Math.round(px)));
    if (yeni !== chromeYukseklik) { chromeYukseklik = yeni; yerlesimGuncelle(); }
  });

  on('ui:katman', (_e, acik) => {
    katmanAcik = !!acik;
    const s = aktifSekme();
    if (s && !s.view.webContents.isDestroyed()) s.view.setVisible(!katmanAcik);
    // Panel açılırken odak arayüzde kalmalı, yoksa panelde yazılamaz.
    if (katmanAcik && win && !win.isDestroyed()) win.webContents.focus();
    yerlesimGuncelle();
  });

  on('sekme:yeni', (_e, url) => sekmeOlustur({ url: url || undefined }));
  on('sekme:kapat', (_e, id) => sekmeKapat(id));
  on('sekme:sec', (_e, id) => sekmeSec(id));

  on('gez:git', (_e, girdi) => {
    const hedef = resolveInput(girdi, store.ayarlar.aramaMotoru);
    if (!hedef) return;
    // mailto: gibi girdiler sekmede yüklenemez; harici uygulama akışına gitsin.
    if (DIS_SEMA_GIRDISI.test(hedef)) return disHarici(hedef);
    const c = wcAl();
    if (c) c.loadURL(hedef); else sekmeOlustur({ url: hedef });
  });
  on('gez:geri', () => { const c = wcAl(); if (c) c.navigationHistory.goBack(); });
  on('gez:ileri', () => { const c = wcAl(); if (c) c.navigationHistory.goForward(); });
  on('gez:yenile', () => { const c = wcAl(); if (c) c.reload(); });
  on('gez:dur', () => { const c = wcAl(); if (c) c.stop(); });
  on('gez:anasayfa', () => {
    const c = wcAl();
    if (!c) return;
    const a = store.ayarlar.anasayfa;
    c.loadURL(a ? resolveInput(a, store.ayarlar.aramaMotoru) : yeniSekmeAdresi());
  });

  on('bul:ara', (_e, { metin, ileri = true, sonraki = false } = {}) => {
    const c = wcAl();
    if (!c) return;
    if (!metin) return c.stopFindInPage('clearSelection');
    c.findInPage(String(metin), { forward: !!ileri, findNext: !!sonraki });
  });
  on('bul:kapat', () => { const c = wcAl(); if (c) c.stopFindInPage('clearSelection'); });

  on('yakinlastir', (_e, yon) => yakinlastir(yon, yon === 0));

  // İndirmeler kimlikle adreslenir: arayüzden gelen ham bir dosya yolu
  // hiçbir zaman açılmaz.
  const indirmeBul = (id) => indirmeler.find(k => k.id === id && k.durum === 'tamam' && k.yol);

  on('indirme:klasor', (_e, id) => {
    const k = indirmeBul(id);
    if (k) shell.showItemInFolder(k.yol);
  });

  on('indirme:ac', async (_e, id) => {
    const k = indirmeBul(id);
    if (!k) return;
    if (k.calistirilabilir) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: [cev('dialog.iptal'), cev('dialog.calistirDevam')],
        defaultId: 0,
        cancelId: 0,
        title: cev('dialog.calistirBaslik'),
        message: cev('dialog.calistirMesaj'),
        detail: k.ad + '\n\n' + cev('dialog.kaynak') + ': ' + String(k.url).slice(0, 300)
      });
      if (response !== 1) return;
    }
    shell.openPath(k.yol);
  });

  on('dis:ac', (_e, url) => disHarici(url));

  handle('gecmis:listele', (_e, sorgu) => store.gecmisAra(sorgu));
  handle('gecmis:temizle', () => { store.gecmisiTemizle(); return true; });

  handle('veri:temizle', async () => {
    // Varsayılan oturum da temizlenmeli; aksi halde oraya düşmüş çerezler
    // "temizlendi" denmesine rağmen kalıcı olur.
    for (const s of [ses, session.defaultSession]) {
      await s.clearStorageData({ storages: TEMIZLENECEK });
      await s.clearCache();
    }
    if (faviconlar) faviconlar.temizle();   // site simgeleri de site verisi
    durumGonder();
    return true;
  });

  handle('izin:varsayilan', (_e, p) => {
    const gecerli = ['sor', 'izin', 'ret'];
    if (!p || !IZIN_TURLERI.includes(p.izin) || !gecerli.includes(p.karar)) {
      return store.ayarlar.izinVarsayilan;
    }
    const v = store.izinVarsayilanAyarla(p.izin, p.karar);
    durumGonder();
    return v;
  });

  handle('guncelleme:kontrol', async () => {
    if (!guncelleme) return null;
    const b = await guncelleme.kontrolEt(true);
    durumGonder();
    return b;
  });
  handle('guncelleme:indir', async () => {
    if (!guncelleme) return null;
    const b = await guncelleme.indir();
    durumGonder();
    return b;
  });
  handle('guncelleme:kur', () => !!guncelleme && guncelleme.kurVeYenidenBaslat());

  handle('izin:temizle', () => {
    store.izinleriTemizle();
    durumGonder();
    return true;
  });

  handle('yerimi:degistir', () => {
    const s = aktifSekme();
    if (!s || icSayfaMi(s.url)) return false;
    const eklendi = store.yerImiDegistir(s.url, s.baslik);
    durumGonder();
    return eklendi;
  });
  handle('yerimi:sil', (_e, url) => { store.yerImiSil(url); durumGonder(); return true; });

  handle('yerimi:guncelle', (_e, p) => {
    const oldu = !!p && store.yerImiGuncelle(p.eskiUrl, { ad: p.ad, url: p.url });
    durumGonder();
    return oldu;
  });

  handle('yerimi:sirala', (_e, sirali) => {
    const oldu = store.yerImiSirala(sirali);
    durumGonder();
    return oldu;
  });

  // Yer imleri çubuğunun sağ tık menüsü. Sayfa görünümü arayüzün üstünde
  // yerel bir katman olduğu için açılır menüyü HTML ile çizemiyoruz; işletim
  // sisteminin kendi menüsünü kullanıyoruz.
  // Araç çubuğundaki ≡ düğmesi. Konum, düğmenin arayüzdeki dikdörtgeninden
  // geliyor; arayüz penceresinin sol üstünde olduğu için doğrudan pencere
  // içeriği koordinatı sayılır.
  on('menu:ana', (_e, konum) => { anaMenuGoster(konum).catch(() => {}); });
  on('site:menu', (_e, konum) => { siteMenusuGoster(konum).catch(() => {}); });

  on('yerimi:menu', (_e, url) => {
    const secili = url ? store.veri.yerImleri.find(y => y.url === url) : null;
    const ogeler = [];

    if (secili) {
      ogeler.push(
        { label: cev('yerimi.ac'), click: () => { const c = wcAl(); if (c) c.loadURL(secili.url); } },
        { label: cev('yerimi.yeniSekmedeAc'), click: () => sekmeOlustur({ url: secili.url }) },
        { label: cev('yerimi.adresiKopyala'), click: () => clipboard.writeText(secili.url) },
        { type: 'separator' },
        { label: cev('yerimi.duzenle'), click: () => uiyeGonder('yerimi-duzenle', secili.url) },
        {
          label: cev('panel.kaldir'),
          click: () => { store.yerImiSil(secili.url); durumGonder(); }
        },
        { type: 'separator' }
      );
    }

    const s = aktifSekme();
    ogeler.push(
      {
        label: cev('menu.yerImiEkle'),
        enabled: !!(s && !icSayfaMi(s.url)),
        click: () => { if (s) { store.yerImiDegistir(s.url, s.baslik); durumGonder(); } }
      },
      { label: cev('menu.yerImleriniGoster'), click: () => uiyeGonder('panel-ac', 'yerImleri') },
      {
        label: cev('yerimi.cubuguGizle'),
        click: () => { store.ayarla('yerImleriCubugu', false); durumGonder(); }
      }
    );

    Menu.buildFromTemplate(ogeler).popup({ window: win });
  });

  handle('ayar:degistir', (_e, p) => {
    if (!p || !Object.hasOwn(AYAR_DOGRULAMA, p.anahtar) || !AYAR_DOGRULAMA[p.anahtar](p.deger)) {
      return store.ayarlar;
    }
    const a = store.ayarla(p.anahtar, p.deger);
    if (p.anahtar === 'filtreListeleriAcik' && listeler) listeler.tazele();
    if (p.anahtar === 'tema') temayiUygula();
    if (p.anahtar === 'dil') {
      // Dil anında uygulanır: menü yeniden kurulur, arayüz yeni tabloyu alır.
      diliUygula();
      menuKur();
    }
    durumGonder();
    return a;
  });

  handle('liste:guncelle', async () => {
    if (!listeler) return false;
    await listeler.guncelle({ zorla: true });
    durumGonder();
    return true;
  });

  handle('liste:ekle', async (_e, url) => {
    if (!listeler) return { hata: 'Liste yöneticisi hazır değil.' };
    const sonuc = listeler.listeEkle(url);
    if (sonuc.hata) return sonuc;
    await listeler.guncelle({ zorla: true });
    durumGonder();
    return sonuc;
  });

  handle('liste:sil', (_e, id) => {
    const oldu = !!listeler && listeler.listeSil(id);
    durumGonder();
    return oldu;
  });

  handle('site:engelleyici', () => {
    const s = aktifSekme();
    if (!s) return false;
    const alan = kokAlanAdi(hostAl(s.url));
    if (!alan) return false;
    store.siteIzniDegistir(alan);
    if (!s.view.webContents.isDestroyed()) s.view.webContents.reload();
    durumGonder();
    return true;
  });
}

/* ---------------------------------------------------------------- */
/* Başlangıç                                                         */
/* ---------------------------------------------------------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const url = argv.find(a => /^https?:\/\//i.test(a));
    if (url) sekmeOlustur({ url });
  });

  app.whenReady().then(() => {
    store = new Store(path.join(app.getPath('userData'), 'pusula-veri.json'));
    diliUygula();
    // Pencere olusmadan once: arka plan rengi ve baslik cubugu dogru temayla acilsin.
    temayiUygula();
    oturumKur();
    ipcKur();
    menuKur();
    pencereOlustur();

    // Önbellekteki listeleri yükler, ardından bayat olanları arka planda çeker.
    listeler.baslat().catch(e => console.error('Filtre listeleri başlatılamadı:', e.message));
    guncelleme.baslat();

    // Geçmişteki ve yer imlerindeki siteler için simgeleri arka planda topla:
    // yeni sekme sayfası ilk açılışta harf rozetiyle kalmasın.
    setTimeout(() => {
      const hostlar = [
        ...store.sikGidilenler(12).map((s) => s.host),
        ...store.veri.yerImleri.slice(0, 20).map((y) => hostAl(y.url))
      ];
      faviconlar.onIsit(hostlar).catch(() => {});
    }, 4000).unref?.();

    nativeTheme.on('updated', () => {
      if (!win || win.isDestroyed() || process.platform === 'darwin') return;
      try { win.setTitleBarOverlay(baslikCubuguRengi()); } catch { /* platform desteklemeyebilir */ }
      durumGonder();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) pencereOlustur();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (listeler) listeler.dur();
    if (guncelleme) guncelleme.dur();
    if (store) store.hemenKaydet();
  });
}
