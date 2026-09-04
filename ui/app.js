'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  chrome: $('chrome'),
  sekmeler: $('sekmeler'),
  yeniSekme: $('yeniSekme'),
  arac: $('arac'),
  geri: $('btnGeri'), ileri: $('btnIleri'), yenile: $('btnYenile'), anasayfa: $('btnAnasayfa'),
  adresKutu: $('adresKutu'), adres: $('adres'), adresGoster: $('adresGoster'), kilit: $('kilit'),
  kalkan: $('btnKalkan'), engelSayi: $('engelSayi'), yerImi: $('btnYerImi'),
  gecmis: $('btnGecmis'), indirmeler: $('btnIndirmeler'), ayarlar: $('btnAyarlar'),
  yerImleriCubugu: $('yerImleriCubugu'),
  oneriler: $('oneriler'),
  indirmeMenu: $('indirmeMenu'),
  bulCubugu: $('bulCubugu'), bulGirdi: $('bulGirdi'), bulSayac: $('bulSayac'),
  bulOnceki: $('bulOnceki'), bulSonraki: $('bulSonraki'), bulKapat: $('bulKapat'),
  panel: $('panel'), panelAd: $('panelAd'), panelArac: $('panelArac'),
  panelIcerik: $('panelIcerik'), panelKapat: $('panelKapat')
};

let durum = {
  sekmeler: [], aktifId: null, ayarlar: {}, motorlar: {}, yerImleri: [],
  indirmeler: [], listeler: [], diller: [], izinTurleri: [], toplamEngellenen: 0
};

// Çeviri tablosu ana süreçten 'durum' ile geliyor.
let ceviri = { dil: 'tr', yon: 'ltr', yerel: 'tr-TR', metin: {} };

function cev(anahtar, degerler) {
  const kalip = ceviri.metin[anahtar] || anahtar;
  if (!degerler) return kalip;
  return String(kalip).replace(/\{(\w+)\}/g, (t, k) =>
    (Object.hasOwn(degerler, k) ? String(degerler[k]) : t));
}

// Sabit HTML'deki ipucu ve yer tutucu metinleri dil değişince yenilenmeli.
function statikMetinler() {
  document.documentElement.lang = ceviri.dil;
  document.documentElement.dir = ceviri.yon;
  el.geri.title = cev('arac.geri');
  el.ileri.title = cev('arac.ileri');
  el.anasayfa.title = cev('arac.anasayfa');
  el.yeniSekme.title = cev('arac.yeniSekme');
  el.gecmis.title = cev('arac.gecmis');
  el.indirmeler.title = cev('arac.indirilenler');
  el.ayarlar.title = cev('arac.menu');
  el.adres.placeholder = cev('arac.adresIpucu');
  el.bulGirdi.placeholder = cev('bul.ipucu');
  el.bulOnceki.title = cev('bul.onceki');
  el.bulSonraki.title = cev('bul.sonraki');
  el.bulKapat.title = cev('bul.kapat');
  el.panelKapat.title = cev('panel.kapat');
}
let adresDuzenleniyor = false;
let oneriListesi = [];
let oneriSecim = -1;
let oneriIstek = 0;
let acikPanel = null;
let panelArama = null;

/* ---------------- yardımcılar ---------------- */

function kacir(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Yön değiştirme ve kontrol karakterleri XSS değil ama sekme başlığında,
// öneri listesinde ve indirme adında metni ters okutmaya yarıyor.
const GORUNMEZ = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function temizMetin(s) {
  return String(s == null ? '' : s).replace(GORUNMEZ, '');
}

function aktif() {
  return durum.sekmeler.find(t => t.id === durum.aktifId) || null;
}

function boyutMetni(bayt) {
  if (!bayt || bayt < 0) return '';
  const birim = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bayt;
  while (n >= 1024 && i < birim.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + birim[i];
}

function saatMetni(zaman) {
  return new Date(zaman).toLocaleTimeString(ceviri.yerel, { hour: '2-digit', minute: '2-digit' });
}

function gunMetni(zaman) {
  const d = new Date(zaman);
  const bugun = new Date();
  const dun = new Date(Date.now() - 86400000);
  const ayniGun = (a, b) => a.toDateString() === b.toDateString();
  if (ayniGun(d, bugun)) return cev('gecmis.bugun');
  if (ayniGun(d, dun)) return cev('gecmis.dun');
  return d.toLocaleDateString(ceviri.yerel, { day: 'numeric', month: 'long', year: 'numeric' });
}

function kisaUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname);
  } catch { return url; }
}

function alanAdi(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Favicon'a güvenmek yerine alan adından tutarlı bir harf/renk üretiyoruz:
// listeler favicon indirilmesini beklemeden dolu görünüyor.
const ROZET_RENKLERI = ['#c62d42', '#0f766e', '#2563eb', '#b45309', '#7c3aed', '#be185d', '#15803d', '#0891b2'];

function rozetYap(url) {
  const host = alanAdi(url);
  const d = document.createElement('span');
  d.className = 'rozet-alan';
  d.textContent = (host[0] || '?').toLocaleUpperCase('tr');
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  d.style.background = ROZET_RENKLERI[h % ROZET_RENKLERI.length];
  return d;
}

// Sitenin gerçek simgesi yerel önbellekte varsa onu göster, yoksa harf rozeti.
// Kaynak her zaman pusula-favicon:// — uzak adresten görsel çekilmiyor.
function simgeYap(url, favicon) {
  if (!favicon) return rozetYap(url);
  const i = document.createElement('img');
  i.className = 'rozet-img';
  i.src = favicon;
  i.alt = '';
  // Simge henüz indirilmemişse bir kez daha dene, sonra harf rozetine düş.
  let denendi = false;
  i.addEventListener('error', () => {
    if (denendi) { i.replaceWith(rozetYap(url)); return; }
    denendi = true;
    setTimeout(() => { i.src = favicon + '?y=' + Date.now(); }, 1800);
  });
  return i;
}

/*
 * Arayüz simgeleri gerçek SVG. Emoji ya da "»" gibi karakterler yazı tipine
 * göre değişiyor, tema rengini almıyor ve boyutları oynuyordu.
 */
const SIMGE = {
  kilit: '<svg viewBox="0 0 16 16"><path d="M4.6 7.2V5.1a3.4 3.4 0 0 1 6.8 0v2.1"/>'
    + '<rect x="3" y="7.2" width="10" height="6.3" rx="1.6"/></svg>',
  uyari: '<svg viewBox="0 0 16 16"><path d="M8 2.6l5.9 10.8H2.1z"/>'
    + '<path d="M8 6.4v3.1"/><path d="M8 11.4v.3"/></svg>',
  indir: '<svg viewBox="0 0 16 16"><path d="M8 2.8v7.1"/><path d="M5.2 7.2 8 10l2.8-2.8"/>'
    + '<path d="M3.4 13h9.2"/></svg>',
  tasma: '<svg viewBox="0 0 16 16"><path d="M4 4l4 4-4 4"/><path d="M9 4l4 4-4 4"/></svg>',
  kapat: '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  klasor: '<svg viewBox="0 0 16 16"><path d="M2 4.6h4.2L7.4 6.2H14v7.2H2z"/></svg>',
  ara: '<svg viewBox="0 0 16 16"><circle cx="7.1" cy="7.1" r="4.3"/>'
    + '<path d="M10.3 10.3 13.5 13.5"/></svg>',
  dunya: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6"/><path d="M2.4 8h11.2"/>'
    + '<path d="M8 2.4c1.5 1.7 2.3 3.5 2.3 5.6S9.5 11.9 8 13.6C6.5 11.9 5.7 10.1 5.7 8S6.5 4.1 8 2.4z"/></svg>'
};

// Panel içeriklerini ortalanmış bir kart içine alır.
function kartYap() {
  const d = document.createElement('div');
  d.className = 'liste-kart';
  return d;
}

// Pencere denetimleri Windows/Linux'ta sağ üstte, macOS'ta sol üstte duruyor;
// panel başlığı onların altında kalmasın diye CSS'e platformu bildiriyoruz.
document.documentElement.dataset.platform = window.pusula.platform;

/* Chrome yüksekliği değişince ana sürece bildir; sayfa görünümü ona göre konumlanır. */
const yukseklikGozcusu = new ResizeObserver(() => {
  window.pusula.yukseklikBildir(el.chrome.getBoundingClientRect().height);
});
yukseklikGozcusu.observe(el.chrome);

// Adres kutusu genişleyip daralınca öneri listesi hizasını kaybetmesin.
new ResizeObserver(() => { if (!el.oneriler.hidden) oneriHizala(); }).observe(el.adresKutu);

/* ---------------- çizim ---------------- */

function sekmeleriCiz() {
  el.sekmeler.replaceChildren();
  for (const t of durum.sekmeler) {
    const d = document.createElement('div');
    d.className = 'sekme' + (t.id === durum.aktifId ? ' aktif' : '');
    d.setAttribute('role', 'tab');
    d.title = temizMetin(t.baslik) + (t.gorunenUrl ? '\n' + t.gorunenUrl : '');

    if (t.yukleniyor) {
      const s = document.createElement('div');
      s.className = 'donuyor';
      d.appendChild(s);
    } else if (t.favicon) {
      const i = document.createElement('img');
      i.className = 'favikon';
      i.src = t.favicon;
      i.alt = '';
      i.addEventListener('error', () => { i.replaceWith(yerTutucu()); });
      d.appendChild(i);
    } else {
      d.appendChild(yerTutucu());
    }

    const ad = document.createElement('span');
    ad.className = 'ad';
    ad.textContent = temizMetin(t.baslik) || cev('arac.yeniSekmeBaslik');
    d.appendChild(ad);

    const kapat = document.createElement('button');
    kapat.className = 'kapat';
    kapat.title = cev('arac.sekmeyiKapat');
    kapat.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
    kapat.addEventListener('click', (e) => { e.stopPropagation(); window.pusula.sekmeKapat(t.id); });
    d.appendChild(kapat);

    d.addEventListener('click', () => window.pusula.sekmeSec(t.id));
    d.addEventListener('auxclick', (e) => { if (e.button === 1) window.pusula.sekmeKapat(t.id); });
    el.sekmeler.appendChild(d);
  }
}

function yerTutucu() {
  const p = document.createElement('div');
  p.className = 'yer-tutucu';
  return p;
}

function aracCiz() {
  const t = aktif();
  el.geri.disabled = !t || !t.geriGidebilir;
  el.ileri.disabled = !t || !t.ileriGidebilir;
  el.arac.classList.toggle('yukleniyor', !!(t && t.yukleniyor));

  if (t && !adresDuzenleniyor && document.activeElement !== el.adres) {
    el.adres.value = t.gorunenUrl || '';
  }

  const engelleyiciAcik = !!durum.ayarlar.engelleyiciAcik && !(t && t.siteIzinli);
  el.kalkan.classList.toggle('acik', engelleyiciAcik);
  el.kalkan.classList.toggle('kapali', !engelleyiciAcik);
  el.engelSayi.textContent = t ? String(t.engellenen) : '0';
  el.kalkan.title = engelleyiciAcik
    ? cev('arac.kalkanAcik', { n: t ? t.engellenen : 0 })
    : cev('arac.kalkanKapali');

  el.kilit.className = 'rozet';
  el.kilit.hidden = !(t && t.url);
  if (t && t.url) {
    el.kilit.classList.add(t.guvenli ? 'guvenli' : 'guvensiz');
    el.kilit.innerHTML = t.guvenli ? SIMGE.kilit : SIMGE.uyari;
    el.kilit.title = cev(t.guvenli ? 'arac.guvenli' : 'arac.guvensiz');
  }

  el.yerImi.classList.toggle('dolu', !!(t && t.yerImi));
  el.yerImi.title = cev(t && t.yerImi ? 'arac.yerImiCikar' : 'arac.yerImiEkle');
  el.adresKutu.classList.toggle('tam-ekran', !!(t && t.tamEkran));
  adresGosterCiz(t);
}

/*
 * Adres çubuğu, odakta değilken düz metin yerine vurgulu bir katman gösterir:
 * kayıtlanabilir alan adı koyu, şema ve alt alan adı ile yol soluk. Amaç
 * "accounts.google.com.giris.evil.com" gibi alt alan adı doldurmasında gerçek
 * sahibin gözden kaçmaması — 2026'da Chrome'un omnibox sahteciliği
 * düzeltmelerinin (CVE-2026-11666, -13988) hedeflediği sınıf.
 */
function adresGosterCiz(t) {
  const goster = t && t.gorunenUrl && document.activeElement !== el.adres && !adresDuzenleniyor;
  el.adresGoster.hidden = !goster;
  if (!goster) return;

  el.adresGoster.replaceChildren();
  const parca = (sinif, metin) => {
    if (!metin) return;
    const s = document.createElement('span');
    s.className = sinif;
    s.textContent = metin;
    el.adresGoster.appendChild(s);
  };

  const metin = t.gorunenUrl;
  const host = alanAdi(t.url) || '';
  const kok = t.alanAdi || host;
  const i = host ? metin.indexOf(host) : -1;

  if (i < 0 || !kok || !host.endsWith(kok)) {
    parca('a-sonuk', metin);        // ayrıştıramadıysak hepsini soluk göster
    return;
  }
  parca('a-sonuk', metin.slice(0, i) + host.slice(0, host.length - kok.length));
  parca('a-alan', kok);
  parca('a-sonuk', metin.slice(i + host.length));
}

let suruklenenYerImi = null;
let duzenlenenYerImi = null;

// Sürüklenen yer imini hedefin önüne taşır ve yeni sırayı ana sürece bildirir.
function yerImiTasi(kaynakUrl, hedefUrl) {
  if (!kaynakUrl || kaynakUrl === hedefUrl) return;
  const sira = durum.yerImleri.map((y) => y.url);
  const i = sira.indexOf(kaynakUrl);
  if (i < 0) return;
  sira.splice(i, 1);
  const j = sira.indexOf(hedefUrl);
  sira.splice(j < 0 ? sira.length : j, 0, kaynakUrl);
  window.pusula.yerImiSirala(sira);
}

// Yer imi adını çubuğun içinde yerinde düzenlemek için küçük bir girdi.
function yerImiDuzenleKutusu(y) {
  const g = document.createElement('input');
  g.type = 'text';
  g.className = 'yerimi-duzenle';
  g.value = temizMetin(y.baslik || '') || alanAdi(y.url);
  g.spellcheck = false;

  const bitir = (kaydet) => {
    if (duzenlenenYerImi !== y.url) return;
    duzenlenenYerImi = null;
    if (kaydet) window.pusula.yerImiGuncelle(y.url, g.value, undefined);
    else yerImleriCiz();
  };

  g.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); bitir(true); }
    else if (e.key === 'Escape') { e.preventDefault(); bitir(false); }
  });
  g.addEventListener('blur', () => bitir(true));
  setTimeout(() => { g.focus(); g.select(); }, 0);
  return g;
}

// Yer imi etiketi: uzun sayfa başlığı yerine kısa ve tanınır bir ad.
function yerImiEtiketi(y) {
  const host = alanAdi(y.url);
  const baslik = temizMetin(y.baslik || '').trim();
  if (!baslik) return host || y.url;
  // "PayX.gg - Sanal Kartlar ve Gider Yönetimi" -> "PayX.gg"
  const ilkParca = baslik.split(/\s+[|–—-]\s+/)[0].trim();
  const aday = ilkParca.length >= 3 ? ilkParca : baslik;
  return aday.length > 22 ? (host || aday.slice(0, 22)) : aday;
}

function yerImleriCiz() {
  const goster = !!durum.ayarlar.yerImleriCubugu;
  el.yerImleriCubugu.hidden = !goster;
  if (!goster) return;

  // Ad düzenlenirken çubuğu yeniden çizmek girdiyi ve yazılanı siler;
  // durum yayını saniyede birkaç kez geliyor.
  if (duzenlenenYerImi && el.yerImleriCubugu.querySelector('.yerimi-duzenle')) return;

  el.yerImleriCubugu.replaceChildren();
  if (!durum.yerImleri.length) {
    const b = document.createElement('span');
    b.className = 'bos';
    b.textContent = cev('yerimi.cubukBos');
    el.yerImleriCubugu.appendChild(b);
    return;
  }

  for (const y of durum.yerImleri.slice(0, 40)) {
    if (y.url === duzenlenenYerImi) {
      el.yerImleriCubugu.appendChild(yerImiDuzenleKutusu(y));
      continue;
    }

    const b = document.createElement('button');
    b.className = 'yerimi';
    b.title = temizMetin(y.baslik || '') + '\n' + y.url;
    b.draggable = true;
    b.appendChild(simgeYap(y.url, y.favicon));
    const ad = document.createElement('span');
    ad.className = 'yerimi-ad';
    ad.textContent = yerImiEtiketi(y);
    b.appendChild(ad);

    b.addEventListener('click', () => window.pusula.git(y.url));
    b.addEventListener('auxclick', (e) => { if (e.button === 1) window.pusula.yeniSekme(y.url); });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.pusula.yerImiMenu(y.url);
    });

    // Sürükleyip sıralama
    b.addEventListener('dragstart', (e) => {
      suruklenenYerImi = y.url;
      e.dataTransfer.effectAllowed = 'move';
      // Firefox uyumu için bir veri koymak gerekiyor.
      e.dataTransfer.setData('text/plain', y.url);
    });
    b.addEventListener('dragend', () => {
      suruklenenYerImi = null;
      for (const e2 of el.yerImleriCubugu.children) e2.classList.remove('surukle-hedef');
    });
    b.addEventListener('dragover', (e) => {
      if (!suruklenenYerImi || suruklenenYerImi === y.url) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      b.classList.add('surukle-hedef');
    });
    b.addEventListener('dragleave', () => b.classList.remove('surukle-hedef'));
    b.addEventListener('drop', (e) => {
      e.preventDefault();
      b.classList.remove('surukle-hedef');
      yerImiTasi(suruklenenYerImi, y.url);
    });

    el.yerImleriCubugu.appendChild(b);
  }

  const tumu = document.createElement('button');
  tumu.className = 'yerimi yerimi-tumu';
  tumu.title = cev('yerimi.tumu');
  tumu.innerHTML = SIMGE.tasma;
  tumu.addEventListener('click', () => panelAc('yerImleri'));
  el.yerImleriCubugu.appendChild(tumu);
}

// Çubuğun boş alanına sağ tık: ekleme, yönetme, gizleme.
el.yerImleriCubugu.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pusula.yerImiMenu(null);
});

window.pusula.yerImiDuzenleDinle((url) => {
  duzenlenenYerImi = url;
  yerImleriCiz();
});

function ciz() {
  sekmeleriCiz();
  aracCiz();
  yerImleriCiz();
  // Geçmiş ve Ayarlar panellerinde girdi alanları var; durum yayını saniyede
  // birkaç kez geldiği için bunları yeniden çizmek kullanıcının yazdığını siler.
  if (acikPanel === 'indirmeler' || acikPanel === 'yerImleri') panelCiz();
  indirmeMenusuCiz();   // indirme ilerlemesi canlı görünsün
}

/* ---------------- adres çubuğu ve öneriler ---------------- */

function motorAdi() {
  const m = durum.motorlar[durum.ayarlar.aramaMotoru];
  return m ? m.ad : cev('ayar.aramaMotoru');
}

function adresGibiMi(s) {
  return /^[a-z][a-z0-9+.-]*:/i.test(s) || /^[^\s]+\.[^\s]{2,}/.test(s) || /^localhost(:\d+)?/.test(s);
}

async function onerileriTazele() {
  const q = el.adres.value.trim();
  const benim = ++oneriIstek;
  if (!q) return onerileriKapat();

  const gecmis = await window.pusula.gecmisListele(q);
  // IPC gidiş-dönüşü sırasında kullanıcı Escape'e basmış ya da başka bir
  // sorgu yazmış olabilir; eski sonuç listeyi geri açmasın.
  if (benim !== oneriIstek || !adresDuzenleniyor || document.activeElement !== el.adres) return;

  const liste = [];

  if (adresGibiMi(q)) liste.push({ tur: 'adres', baslik: q, url: q, etiket: cev('oneri.adreseGit') });
  liste.push({ tur: 'arama', baslik: q, url: q, etiket: cev('oneri.ara', { motor: motorAdi() }) });

  const gorulen = new Set();
  for (const g of gecmis) {
    if (gorulen.has(g.url)) continue;
    gorulen.add(g.url);
    // Başlık yoksa kısa adres başlığa çıkıyor; aynı metni iki kez yazmayalım.
    const baslik = temizMetin(g.baslik);
    liste.push({
      tur: 'gecmis',
      baslik: baslik || kisaUrl(g.url),
      url: g.url,
      etiket: baslik ? kisaUrl(g.url) : ''
    });
    if (liste.length >= 8) break;
  }

  oneriListesi = liste;
  oneriSecim = 0;
  onerileriCiz();
}

/*
 * Liste chrome akışında duruyor (sayfa görünümü yerel bir katman olduğu için
 * üstüne binemiyoruz), ama pencere genişliğinde bir bant gibi durmasın diye
 * adres kutusuyla aynı hizaya ve genişliğe oturtuyoruz.
 */
function oneriHizala() {
  const k = el.adresKutu.getBoundingClientRect();
  if (!k.width) return;
  const sag = Math.max(0, document.documentElement.clientWidth - k.right);
  el.oneriler.style.setProperty('--oneri-sol', Math.round(k.left) + 'px');
  el.oneriler.style.setProperty('--oneri-sag', Math.round(sag) + 'px');
}

function onerileriCiz() {
  el.oneriler.replaceChildren();
  oneriHizala();
  oneriListesi.forEach((o, i) => {
    const d = document.createElement('div');
    d.className = 'oneri';
    d.setAttribute('role', 'option');
    d.title = o.tur === 'gecmis' ? o.url : o.baslik;

    const simge = document.createElement('span');
    simge.className = 'o-simge';
    // Geçmiş satırlarında sitenin kendi simgesi, aksi hâlde eylem simgesi.
    if (o.tur === 'gecmis') simge.appendChild(simgeYap(o.url, 'pusula-favicon://' + alanAdi(o.url)));
    else simge.innerHTML = o.tur === 'arama' ? SIMGE.ara : SIMGE.dunya;
    d.appendChild(simge);

    const b = document.createElement('span');
    b.className = 'o-baslik';
    b.textContent = temizMetin(o.baslik);
    d.appendChild(b);

    if (o.etiket) {
      const ek = document.createElement('span');
      ek.className = 'o-ek';
      ek.textContent = o.etiket;
      d.appendChild(ek);
    }

    d.addEventListener('mousedown', (e) => { e.preventDefault(); oneriUygula(i); });
    el.oneriler.appendChild(d);
  });
  el.oneriler.hidden = oneriListesi.length === 0;
  oneriSecimiCiz();
}

// Ok tuşlarında bütün listeyi yeniden kurmuyoruz: satırlar yeniden kurulunca
// simge <img>'leri de sıfırlanır ve favicon yeniden istenirdi.
function oneriSecimiCiz() {
  const satirlar = el.oneriler.children;
  for (let i = 0; i < satirlar.length; i++) {
    const secili = i === oneriSecim;
    satirlar[i].classList.toggle('secili', secili);
    satirlar[i].setAttribute('aria-selected', secili ? 'true' : 'false');
    if (secili) satirlar[i].scrollIntoView({ block: 'nearest' });
  }
}

function onerileriKapat() {
  oneriIstek++;            // bekleyen sorgular listeyi geri açmasın
  oneriListesi = [];
  oneriSecim = -1;
  el.oneriler.hidden = true;
  el.oneriler.replaceChildren();
}

function oneriUygula(i) {
  const o = oneriListesi[i];
  if (!o) return;
  adresDuzenleniyor = false;
  onerileriKapat();
  el.adres.blur();
  window.pusula.git(o.tur === 'gecmis' || o.tur === 'adres' ? o.url : o.baslik);
}

el.adres.addEventListener('focus', () => {
  adresDuzenleniyor = true;
  el.adresGoster.hidden = true;   // düzenlerken gerçek metin görünsün
  indirmeMenusuKapat();           // açık menü adres çubuğunun altında kalmasın
  el.adres.select();
});
el.adresGoster.addEventListener('mousedown', (e) => { e.preventDefault(); el.adres.focus(); });
el.adres.addEventListener('input', () => { adresDuzenleniyor = true; onerileriTazele(); });
el.adres.addEventListener('blur', () => {
  adresDuzenleniyor = false;
  setTimeout(onerileriKapat, 0);
  aracCiz();
});

el.adres.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!oneriListesi.length) return;
    e.preventDefault();
    oneriSecim = (oneriSecim + (e.key === 'ArrowDown' ? 1 : -1) + oneriListesi.length) % oneriListesi.length;
    oneriSecimiCiz();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (oneriSecim >= 0 && oneriListesi.length) return oneriUygula(oneriSecim);
    const v = el.adres.value.trim();
    if (!v) return;
    adresDuzenleniyor = false;
    onerileriKapat();
    el.adres.blur();
    window.pusula.git(v);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    onerileriKapat();
    adresDuzenleniyor = false;
    el.adres.blur();
    aracCiz();
  }
});

/* ---------------- araç çubuğu düğmeleri ---------------- */

el.yeniSekme.addEventListener('click', () => window.pusula.yeniSekme());
el.geri.addEventListener('click', () => window.pusula.geri());
el.ileri.addEventListener('click', () => window.pusula.ileri());
el.anasayfa.addEventListener('click', () => window.pusula.anasayfa());
el.yenile.addEventListener('click', () => {
  const t = aktif();
  if (t && t.yukleniyor) window.pusula.dur(); else window.pusula.yenile();
});
el.yerImi.addEventListener('click', () => window.pusula.yerImiDegistir());
el.kalkan.addEventListener('click', () => {
  const t = aktif();
  if (t && t.alanAdi) window.pusula.siteEngelleyici();
  else panelAc('ayarlar');
});
// Kilit simgesi Chrome'daki gibi site bilgisi menüsünü açar.
el.kilit.addEventListener('click', () => {
  const r = el.kilit.getBoundingClientRect();
  indirmeMenusuKapat();
  onerileriKapat();
  window.pusula.siteMenu({ sol: r.left, y: r.bottom + 6 });
});

el.gecmis.addEventListener('click', () => panelAc('gecmis'));
el.indirmeler.addEventListener('click', () => indirmeMenusuDegistir());
// ≡ düğmesi ana menüyü açar. Menü yerel (native) çiziliyor: sayfa görünümü
// arayüzün üstünde bir katman olduğu için HTML açılır menü altında kalırdı.
el.ayarlar.addEventListener('click', () => {
  const r = el.ayarlar.getBoundingClientRect();
  indirmeMenusuKapat();
  onerileriKapat();
  // Sağ kenar hizalaması için düğmenin sağ kenarını gönderiyoruz.
  window.pusula.anaMenu({ sag: r.right, y: r.bottom + 2 });
});

/* ---------------- indirilenler açılır menüsü ---------------- */

const indirmeDurumu = (d) => cev('indirme.' + d);

function indirmeMenusuDegistir() {
  if (el.indirmeMenu.hidden) indirmeMenusuAc(); else indirmeMenusuKapat();
}

function indirmeMenusuKapat() {
  el.indirmeMenu.hidden = true;
  el.indirmeMenu.replaceChildren();
  el.indirmeler.classList.remove('etkin');
}

function indirmeMenusuAc() {
  onerileriKapat();
  el.indirmeMenu.hidden = false;
  el.indirmeler.classList.add('etkin');
  indirmeMenusuCiz();
}

function indirmeMenusuCiz() {
  if (el.indirmeMenu.hidden) return;
  el.indirmeMenu.replaceChildren();

  // Satır chrome akışında olduğu için tüm genişliği kaplıyor; görünen panel
  // düğmenin altına yaslanan sabit genişlikte bir kart.
  const kart = document.createElement('div');
  kart.className = 'menu-kart';
  el.indirmeMenu.appendChild(kart);

  const baslik = document.createElement('div');
  baslik.className = 'menu-baslik';
  baslik.textContent = cev('panel.indirilenler');
  const kapat = document.createElement('button');
  kapat.className = 'ikon kucuk';
  kapat.title = cev('bul.kapat');
  kapat.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
  kapat.addEventListener('click', indirmeMenusuKapat);
  baslik.appendChild(kapat);
  kart.appendChild(baslik);

  const son = (durum.indirmeler || []).slice(0, 10);
  if (!son.length) {
    const b = document.createElement('div');
    b.className = 'menu-bos';
    b.textContent = cev('indirme.bos');
    kart.appendChild(b);
    return;
  }

  for (const i of son) {
    const s = document.createElement('div');
    s.className = 'menu-satir' + (i.calistirilabilir ? ' riskli' : '');
    s.title = i.url;

    const ikon = document.createElement('span');
    ikon.className = 'menu-ikon';
    ikon.innerHTML = i.calistirilabilir ? SIMGE.uyari : SIMGE.indir;

    const metin = document.createElement('div');
    metin.className = 'menu-metin';
    const ad = document.createElement('div');
    ad.className = 'menu-ad';
    ad.textContent = temizMetin(i.ad);
    const alt = document.createElement('div');
    alt.className = 'menu-alt';
    alt.textContent = indirmeDurumu(i.durum) +
      (i.toplam > 0 ? ' · ' + boyutMetni(i.alinan) + ' / ' + boyutMetni(i.toplam) : '');
    metin.append(ad, alt);

    if (i.durum === 'devam' && i.toplam > 0) {
      const p = document.createElement('div');
      p.className = 'ilerleme';
      const ic = document.createElement('div');
      ic.style.width = Math.round((i.alinan / i.toplam) * 100) + '%';
      p.appendChild(ic);
      metin.appendChild(p);
    }

    s.append(ikon, metin);

    if (i.durum === 'tamam') {
      const klasor = document.createElement('button');
      klasor.className = 'ikon kucuk';
      klasor.title = cev('indirme.klasor');
      klasor.innerHTML = SIMGE.klasor;
      klasor.addEventListener('click', (e) => { e.stopPropagation(); window.pusula.indirmeKlasor(i.id); });
      s.appendChild(klasor);
      s.addEventListener('click', () => window.pusula.indirmeAc(i.id));
    }
    kart.appendChild(s);
  }

  const tumu = document.createElement('button');
  tumu.className = 'menu-alt-dugme';
  tumu.textContent = cev('indirme.tumunuGoster');
  tumu.addEventListener('click', () => { indirmeMenusuKapat(); panelAc('indirmeler'); });
  kart.appendChild(tumu);
}

/* ---------------- sayfada bul ---------------- */

function bulmaAc() {
  el.bulCubugu.hidden = false;
  el.bulGirdi.focus();
  el.bulGirdi.select();
}

function bulmaKapat() {
  el.bulCubugu.hidden = true;
  el.bulGirdi.value = '';
  el.bulSayac.textContent = '0/0';
  window.pusula.bulmaKapat();
}

el.bulGirdi.addEventListener('input', () => window.pusula.bul(el.bulGirdi.value, true, false));
el.bulGirdi.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    window.pusula.bul(el.bulGirdi.value, !e.shiftKey, true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    bulmaKapat();
  }
});
el.bulOnceki.addEventListener('click', () => window.pusula.bul(el.bulGirdi.value, false, true));
el.bulSonraki.addEventListener('click', () => window.pusula.bul(el.bulGirdi.value, true, true));
el.bulKapat.addEventListener('click', bulmaKapat);

/* ---------------- panel ---------------- */

function panelAc(ad) {
  indirmeMenusuKapat();
  acikPanel = ad;
  el.panel.hidden = false;
  window.pusula.katmanBildir(true);
  panelCiz();
}

function panelKapat() {
  acikPanel = null;
  clearTimeout(panelArama);
  el.panel.hidden = true;
  el.panelArac.replaceChildren();
  el.panelIcerik.replaceChildren();
  window.pusula.katmanBildir(false);
}

el.panelKapat.addEventListener('click', panelKapat);

// Panel kimliği -> çeviri anahtarı
const PANEL_ANAHTARI = {
  gecmis: 'panel.gecmis',
  yerImleri: 'panel.yerImleri',
  indirmeler: 'panel.indirilenler',
  ayarlar: 'panel.ayarlar'
};

function panelCiz() {
  el.panelAd.textContent = acikPanel ? cev(PANEL_ANAHTARI[acikPanel]) : '';
  el.panelArac.replaceChildren();
  el.panelIcerik.replaceChildren();
  if (acikPanel === 'gecmis') gecmisPaneli();
  else if (acikPanel === 'yerImleri') yerImleriPaneli();
  else if (acikPanel === 'indirmeler') indirmelerPaneli();
  else if (acikPanel === 'ayarlar') ayarlarPaneli();
}

function satirYap({ baslik, url, zaman, silGeriCagirim }) {
  const d = document.createElement('div');
  d.className = 'satir';
  d.title = url;

  d.appendChild(simgeYap(url, 'pusula-favicon://' + alanAdi(url)));

  const metin = document.createElement('div');
  metin.className = 'satir-metin';
  const b = document.createElement('div');
  b.className = 's-baslik';
  b.textContent = temizMetin(baslik) || kisaUrl(url);
  const u = document.createElement('div');
  u.className = 's-url';
  u.textContent = kisaUrl(url);
  metin.append(b, u);
  d.appendChild(metin);

  if (zaman) {
    const z = document.createElement('span');
    z.className = 's-zaman';
    z.textContent = saatMetni(zaman);
    d.appendChild(z);
  }
  if (silGeriCagirim) {
    const s = document.createElement('button');
    s.className = 'ikon kucuk s-sil';
    s.title = cev('panel.kaldir');
    s.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
    s.addEventListener('click', (e) => { e.stopPropagation(); silGeriCagirim(); });
    d.appendChild(s);
  }

  d.addEventListener('click', () => { panelKapat(); window.pusula.git(url); });
  d.addEventListener('auxclick', (e) => { if (e.button === 1) window.pusula.yeniSekme(url); });
  return d;
}

function bosDurum(metin) {
  const p = document.createElement('p');
  p.className = 'bos-durum';
  p.textContent = metin;
  return p;
}

async function gecmisPaneli(sorgu = '') {
  const ara = document.createElement('input');
  ara.type = 'search';
  ara.placeholder = cev('gecmis.ara');
  ara.value = sorgu;
  ara.addEventListener('input', () => {
    clearTimeout(panelArama);
    panelArama = setTimeout(() => gecmisListesiCiz(ara.value), 150);
  });

  const temizle = document.createElement('button');
  temizle.className = 'dugme';
  temizle.textContent = cev('gecmis.temizle');
  temizle.addEventListener('click', async () => {
    await window.pusula.gecmisTemizle();
    gecmisListesiCiz('');
  });

  el.panelArac.replaceChildren(ara, temizle);
  gecmisListesiCiz(sorgu);
  ara.focus();
}

async function gecmisListesiCiz(sorgu) {
  const kayitlar = await window.pusula.gecmisListele(sorgu);
  // Bekleyen sorgu dönerken kullanıcı başka panele geçmiş olabilir.
  if (acikPanel !== 'gecmis') return;
  el.panelIcerik.replaceChildren();
  if (!kayitlar.length) {
    el.panelIcerik.appendChild(bosDurum(cev(sorgu ? 'gecmis.eslesmeYok' : 'gecmis.bos')));
    return;
  }
  let sonGun = null;
  let kart = null;
  for (const k of kayitlar) {
    const gun = gunMetni(k.zaman);
    if (gun !== sonGun) {
      sonGun = gun;
      const h = document.createElement('div');
      h.className = 'gun-basligi';
      h.textContent = gun;
      el.panelIcerik.appendChild(h);
      kart = kartYap();
      el.panelIcerik.appendChild(kart);
    }
    kart.appendChild(satirYap({ baslik: k.baslik, url: k.url, zaman: k.zaman }));
  }
}

function yerImleriPaneli() {
  if (!durum.yerImleri.length) {
    el.panelIcerik.appendChild(bosDurum(cev('yerimi.bos')));
    return;
  }
  const kart = kartYap();
  for (const y of durum.yerImleri) {
    kart.appendChild(satirYap({
      baslik: y.baslik,
      url: y.url,
      zaman: y.zaman,
      silGeriCagirim: () => window.pusula.yerImiSil(y.url)
    }));
  }
  el.panelIcerik.appendChild(kart);
}

function indirmelerPaneli() {
  if (!durum.indirmeler.length) {
    el.panelIcerik.appendChild(bosDurum(cev('indirme.bos')));
    return;
  }
  const kart = kartYap();
  el.panelIcerik.appendChild(kart);

  for (const i of durum.indirmeler) {
    const d = document.createElement('div');
    d.className = 'satir';
    d.title = i.url;

    const ikon = document.createElement('span');
    ikon.className = 'rozet-alan' + (i.calistirilabilir ? ' riskli' : '');
    ikon.innerHTML = i.calistirilabilir ? SIMGE.uyari : SIMGE.indir;
    if (!i.calistirilabilir) ikon.style.background = '#5b6472';
    d.appendChild(ikon);

    const sol = document.createElement('div');
    sol.className = 'satir-metin';

    const ad = document.createElement('div');
    ad.className = 's-baslik';
    ad.textContent = temizMetin(i.ad);

    const alt = document.createElement('div');
    alt.className = 's-url';
    alt.textContent = INDIRME_DURUMU[i.durum] + (i.toplam > 0 ? ' · ' + boyutMetni(i.alinan) + ' / ' + boyutMetni(i.toplam) : '');
    sol.append(ad, alt);

    if (i.durum === 'devam' && i.toplam > 0) {
      const p = document.createElement('div');
      p.className = 'ilerleme';
      const ic = document.createElement('div');
      ic.style.width = Math.round((i.alinan / i.toplam) * 100) + '%';
      p.appendChild(ic);
      sol.appendChild(p);
    }
    d.appendChild(sol);

    if (i.durum === 'tamam') {
      const ac = document.createElement('button');
      ac.className = 'dugme';
      ac.textContent = cev('indirme.ac');
      ac.addEventListener('click', () => window.pusula.indirmeAc(i.id));
      const klasor = document.createElement('button');
      klasor.className = 'dugme';
      klasor.textContent = cev('indirme.klasor');
      klasor.addEventListener('click', () => window.pusula.indirmeKlasor(i.id));
      d.append(ac, klasor);
    }
    kart.appendChild(d);
  }
}

function ayarSatiri(ad, aciklama, kontrol) {
  const d = document.createElement('div');
  d.className = 'ayar';
  const m = document.createElement('div');
  m.className = 'a-metin';
  const a1 = document.createElement('div');
  a1.className = 'a-ad';
  a1.textContent = ad;
  const a2 = document.createElement('div');
  a2.className = 'a-aciklama';
  a2.textContent = aciklama;
  m.append(a1, a2);
  d.append(m, kontrol);
  return d;
}

function anahtar(deger, degisti) {
  const k = document.createElement('input');
  k.type = 'checkbox';
  k.checked = !!deger;
  k.addEventListener('change', () => degisti(k.checked));
  return k;
}

function listeSatiri(l) {
  let durumMetni;
  if (l.hata) {
    durumMetni = cev('ayar.listeHata', { hata: l.hata });
  } else if (!l.indirilme) {
    durumMetni = cev('ayar.listeIndirilmedi');
  } else {
    const gun = Math.floor((Date.now() - l.indirilme) / 86400000);
    const ne = gun === 0 ? cev('ayar.bugun') : (gun === 1 ? cev('ayar.dun') : cev('ayar.gunOnce', { n: gun }));
    durumMetni = cev('ayar.listeDurum', { n: l.kural.toLocaleString(ceviri.yerel), ne });
  }

  let kontrol;
  if (l.ozel) {
    kontrol = document.createElement('button');
    kontrol.className = 'dugme';
    kontrol.textContent = cev('ayar.listeKaldir');
    kontrol.addEventListener('click', async () => {
      kontrol.disabled = true;
      await window.pusula.listeSil(l.id);
      if (acikPanel === 'ayarlar') panelCiz();
    });
  } else {
    kontrol = document.createElement('span');
    kontrol.className = 'a-aciklama';
    // Varsayılan listelerin açıklaması çeviri tablosundan gelir.
    kontrol.textContent = cev('liste.' + l.id);
  }

  const satir = ayarSatiri(l.ad, durumMetni, kontrol);
  satir.title = l.url;
  return satir;
}

// Metni geciken bir geri bildirimle değiştirir, sonra eski hâline döner.
function dugmeDurum(dugme, gecici, eski, sure = 1500) {
  dugme.textContent = gecici;
  setTimeout(() => { dugme.disabled = false; dugme.textContent = eski; }, sure);
}

function ayarlarPaneli() {
  const g = document.createElement('div');
  g.className = 'ayar-grup';
  const a = durum.ayarlar;
  const say = (n) => Number(n || 0).toLocaleString(ceviri.yerel);

  /* ---- istatistik ---- */
  const kuralToplam = (durum.listeler || []).reduce((t, l) => t + l.kural, 0);
  const ist = document.createElement('div');
  ist.className = 'istatistik';
  for (const [sayi, etiket] of [
    [say(durum.toplamEngellenen), cev('ayar.engellenenSayi')],
    [say(kuralToplam), cev('ayar.yukluAlan')],
    [say(durum.yerImleri.length), cev('ayar.yerImiSayi')]
  ]) {
    const kutu = document.createElement('div');
    kutu.className = 'kutu';
    const s = document.createElement('div');
    s.className = 'sayi';
    s.textContent = sayi;
    const e = document.createElement('div');
    e.className = 'etiket';
    e.textContent = etiket;
    kutu.append(s, e);
    ist.appendChild(kutu);
  }
  g.appendChild(ist);

  const baslik = (anahtarAdi) => {
    const h = document.createElement('h2');
    h.textContent = cev(anahtarAdi);
    g.appendChild(h);
  };

  /* ---- arama ve başlangıç ---- */
  baslik('ayar.bolumArama');

  const dilSec = document.createElement('select');
  const sistemSecenek = document.createElement('option');
  sistemSecenek.value = 'sistem';
  sistemSecenek.textContent = cev('ayar.dilSistem');
  if ((a.dil || 'sistem') === 'sistem') sistemSecenek.selected = true;
  dilSec.appendChild(sistemSecenek);
  for (const d of (durum.diller || [])) {
    const o = document.createElement('option');
    o.value = d.kod;
    o.textContent = d.ad;
    if (a.dil === d.kod) o.selected = true;
    dilSec.appendChild(o);
  }
  dilSec.addEventListener('change', () => window.pusula.ayarDegistir('dil', dilSec.value));
  g.appendChild(ayarSatiri(cev('ayar.dil'), cev('ayar.dilAciklama'), dilSec));

  const temaSec = document.createElement('select');
  for (const [deger, anahtar] of [
    ['sistem', 'ayar.temaSistem'], ['acik', 'ayar.temaAcik'], ['koyu', 'ayar.temaKoyu']
  ]) {
    const o = document.createElement('option');
    o.value = deger;
    o.textContent = cev(anahtar);
    if ((a.tema || 'sistem') === deger) o.selected = true;
    temaSec.appendChild(o);
  }
  temaSec.addEventListener('change', () => window.pusula.ayarDegistir('tema', temaSec.value));
  g.appendChild(ayarSatiri(cev('ayar.tema'), cev('ayar.temaAciklama'), temaSec));

  const motor = document.createElement('select');
  for (const [k, v] of Object.entries(durum.motorlar)) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = v.ad;
    if (k === a.aramaMotoru) o.selected = true;
    motor.appendChild(o);
  }
  motor.addEventListener('change', () => window.pusula.ayarDegistir('aramaMotoru', motor.value));
  g.appendChild(ayarSatiri(cev('ayar.aramaMotoru'), cev('ayar.aramaMotoruAciklama'), motor));

  const ana = document.createElement('input');
  ana.type = 'text';
  ana.value = a.anasayfa || '';
  ana.placeholder = cev('ayar.anasayfaIpucu');
  ana.addEventListener('change', () => window.pusula.ayarDegistir('anasayfa', ana.value.trim()));
  g.appendChild(ayarSatiri(cev('ayar.anasayfa'), cev('ayar.anasayfaAciklama'), ana));

  /* ---- gizlilik ---- */
  baslik('ayar.bolumGizlilik');

  g.appendChild(ayarSatiri(cev('ayar.engelleyici'), cev('ayar.engelleyiciAciklama'),
    anahtar(a.engelleyiciAcik, (v) => window.pusula.ayarDegistir('engelleyiciAcik', v))));
  g.appendChild(ayarSatiri(cev('ayar.dnt'), cev('ayar.dntAciklama'),
    anahtar(a.dntGonder, (v) => window.pusula.ayarDegistir('dntGonder', v))));
  g.appendChild(ayarSatiri(cev('ayar.gecmisiKaydet'), cev('ayar.gecmisiKaydetAciklama'),
    anahtar(a.gecmisiKaydet, (v) => window.pusula.ayarDegistir('gecmisiKaydet', v))));

  const temizle = document.createElement('button');
  temizle.className = 'dugme';
  temizle.textContent = cev('ayar.veriTemizle');
  temizle.addEventListener('click', async () => {
    temizle.disabled = true;
    temizle.textContent = cev('ayar.temizleniyor');
    await window.pusula.veriTemizle();
    dugmeDurum(temizle, cev('ayar.temizlendi'), cev('ayar.veriTemizle'));
  });
  g.appendChild(ayarSatiri(cev('ayar.cerezler'), cev('ayar.cerezlerAciklama'), temizle));

  const izinSifirla = document.createElement('button');
  izinSifirla.className = 'dugme';
  izinSifirla.textContent = cev('ayar.izinSifirla');
  izinSifirla.addEventListener('click', async () => {
    izinSifirla.disabled = true;
    await window.pusula.izinTemizle();
    dugmeDurum(izinSifirla, cev('ayar.sifirlandi'), cev('ayar.izinSifirla'));
  });
  g.appendChild(ayarSatiri(cev('ayar.siteIzinleri'), cev('ayar.siteIzinleriAciklama'), izinSifirla));

  /* ---- filtre listeleri ---- */
  baslik('ayar.bolumListeler');

  g.appendChild(ayarSatiri(cev('ayar.listeKullan'), cev('ayar.listeKullanAciklama'),
    anahtar(a.filtreListeleriAcik !== false, (v) => window.pusula.ayarDegistir('filtreListeleriAcik', v))));
  g.appendChild(ayarSatiri(cev('ayar.otomatikGuncelle'), cev('ayar.otomatikGuncelleAciklama'),
    anahtar(a.otomatikGuncelle !== false, (v) => window.pusula.ayarDegistir('otomatikGuncelle', v))));

  const yenile = document.createElement('button');
  yenile.className = 'dugme';
  yenile.textContent = cev('ayar.simdiGuncelle');
  yenile.addEventListener('click', async () => {
    yenile.disabled = true;
    yenile.textContent = cev('ayar.guncelleniyor');
    await window.pusula.listeGuncelle();
    if (acikPanel === 'ayarlar') panelCiz();
  });
  g.appendChild(ayarSatiri(cev('ayar.listeYenile'), cev('ayar.listeYenileAciklama'), yenile));

  for (const l of (durum.listeler || [])) g.appendChild(listeSatiri(l));

  const ekleKutu = document.createElement('input');
  ekleKutu.type = 'text';
  ekleKutu.placeholder = cev('ayar.listeEkleIpucu');
  const ekleDugme = document.createElement('button');
  ekleDugme.className = 'dugme';
  ekleDugme.textContent = cev('ayar.ekle');
  const ekle = async () => {
    const url = ekleKutu.value.trim();
    if (!url) return;
    ekleDugme.disabled = true;
    ekleDugme.textContent = cev('ayar.ekleniyor');
    const sonuc = await window.pusula.listeEkle(url);
    if (sonuc && sonuc.hata) {
      ekleDugme.disabled = false;
      ekleDugme.textContent = cev('ayar.ekle');
      ekleKutu.value = '';
      ekleKutu.placeholder = sonuc.hata;
      return;
    }
    if (acikPanel === 'ayarlar') panelCiz();
  };
  ekleDugme.addEventListener('click', ekle);
  ekleKutu.addEventListener('keydown', (e) => { if (e.key === 'Enter') ekle(); });

  const ekleSaran = document.createElement('div');
  ekleSaran.style.cssText = 'display:flex;gap:8px;align-items:center';
  ekleSaran.append(ekleKutu, ekleDugme);
  g.appendChild(ayarSatiri(cev('ayar.listeEkle'), cev('ayar.listeEkleAciklama'), ekleSaran));

  /* ---- izin istekleri ---- */
  baslik('ayar.bolumIzinler');

  const KARARLAR = [['sor', 'ayar.izinSor'], ['izin', 'ayar.izinVer'], ['ret', 'ayar.izinRet']];
  const izinVarsayilan = a.izinVarsayilan || {};

  for (const izin of (durum.izinTurleri || [])) {
    const izinAdi = cev('izin.' + izin);
    const sec = document.createElement('select');
    for (const [deger, etiketAnahtari] of KARARLAR) {
      const o = document.createElement('option');
      o.value = deger;
      o.textContent = cev(etiketAnahtari);
      if ((izinVarsayilan[izin] || 'sor') === deger) o.selected = true;
      sec.appendChild(o);
    }
    sec.addEventListener('change', () => window.pusula.izinVarsayilanAyarla(izin, sec.value));
    g.appendChild(ayarSatiri(
      izinAdi.charAt(0).toLocaleUpperCase(ceviri.yerel) + izinAdi.slice(1),
      cev('ayar.izinSatir', { izin: izinAdi }),
      sec
    ));
  }

  /* ---- güncelleme ---- */
  baslik('ayar.bolumGuncelleme');

  const gu = durum.guncelleme || { durum: 'kapali', surum: '', ilerleme: 0 };
  let gDurum;
  if (gu.durum === 'bulundu') gDurum = cev('guncelleme.bulundu', { surum: gu.bulunanSurum });
  else if (gu.durum === 'iniyor') gDurum = cev('guncelleme.iniyor', { n: gu.ilerleme });
  else if (gu.durum === 'hazir') gDurum = cev('guncelleme.hazir', { surum: gu.bulunanSurum });
  else if (gu.durum === 'hata') gDurum = cev('guncelleme.hata', { sebep: gu.sebep || '?' });
  else gDurum = cev('guncelleme.' + gu.durum);

  const gDugme = document.createElement('button');
  gDugme.className = 'dugme';
  gDugme.disabled = !gu.etkin || gu.durum === 'kontrol' || gu.durum === 'iniyor';

  if (gu.durum === 'hazir') {
    gDugme.textContent = cev('ayar.guncellemeKur');
    gDugme.addEventListener('click', () => window.pusula.guncellemeKur());
  } else if (gu.durum === 'bulundu') {
    gDugme.textContent = cev('ayar.guncellemeIndirDugme');
    gDugme.addEventListener('click', async () => {
      gDugme.disabled = true;
      await window.pusula.guncellemeIndir();
    });
  } else {
    gDugme.textContent = cev('ayar.guncellemeKontrolEt');
    gDugme.addEventListener('click', async () => {
      gDugme.disabled = true;
      await window.pusula.guncellemeKontrol();
      if (acikPanel === 'ayarlar') panelCiz();
    });
  }

  g.appendChild(ayarSatiri(cev('ayar.surum') + ' ' + (gu.surum || ''), gDurum, gDugme));

  g.appendChild(ayarSatiri(cev('ayar.guncellemeOtoKontrol'), cev('ayar.guncellemeOtoKontrolAciklama'),
    anahtar(a.guncellemeKontrol !== false, (v) => window.pusula.ayarDegistir('guncellemeKontrol', v))));
  g.appendChild(ayarSatiri(cev('ayar.guncellemeOtoIndir'), cev('ayar.guncellemeOtoIndirAciklama'),
    anahtar(a.guncellemeIndir !== false, (v) => window.pusula.ayarDegistir('guncellemeIndir', v))));

  const kanal = document.createElement('select');
  for (const [deger, etiketAnahtari] of [['kararli', 'ayar.kanalKararli'], ['beta', 'ayar.kanalBeta']]) {
    const o = document.createElement('option');
    o.value = deger;
    o.textContent = cev(etiketAnahtari);
    if ((a.guncellemeKanali || 'kararli') === deger) o.selected = true;
    kanal.appendChild(o);
  }
  kanal.addEventListener('change', () => window.pusula.ayarDegistir('guncellemeKanali', kanal.value));
  g.appendChild(ayarSatiri(cev('ayar.guncellemeKanal'), cev('ayar.guncellemeKanalAciklama'), kanal));

  /* ---- görünüm ---- */
  baslik('ayar.bolumGorunum');

  g.appendChild(ayarSatiri(cev('ayar.yerImleriCubugu'), cev('ayar.yerImleriCubuguAciklama'),
    anahtar(a.yerImleriCubugu, (v) => window.pusula.ayarDegistir('yerImleriCubugu', v))));

  el.panelIcerik.appendChild(g);
}

/* ---------------- ana süreçle bağlantı ---------------- */

let ilkDurumGeldi = false;

window.pusula.durumDinle((d) => {
  durum = d;
  if (d.ceviri) {
    const dilDegisti = d.ceviri.dil !== ceviri.dil;
    ceviri = d.ceviri;
    // İlk durumda da çalışmalı: sabit metinler ve yön henüz hiç yazılmadı.
    if (dilDegisti || !ilkDurumGeldi) {
      statikMetinler();
      if (ilkDurumGeldi && acikPanel) panelCiz();   // açık panel yeni dile geçsin
    }
    ilkDurumGeldi = true;
  }
  ciz();
});

window.pusula.bulmaSonucuDinle(({ etkin, toplam }) => {
  el.bulSayac.textContent = (toplam ? etkin : 0) + '/' + toplam;
});

window.pusula.adresOdakDinle(() => {
  if (acikPanel) panelKapat();
  el.adres.focus();
  el.adres.select();
});

window.pusula.bulmaAcDinle(() => { if (!acikPanel) bulmaAc(); });
window.pusula.yerImiKisayolDinle(() => window.pusula.yerImiDegistir());
window.pusula.panelAcDinle((ad) => {
  if (acikPanel === ad) panelKapat(); else panelAc(ad);
});

/* ---------------- klavye ---------------- */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!el.indirmeMenu.hidden) { indirmeMenusuKapat(); return; }
    if (acikPanel) { panelKapat(); return; }
    if (!el.bulCubugu.hidden && document.activeElement !== el.bulGirdi) { bulmaKapat(); return; }
  }
});

/* Orta tıkla sekme kapatma sırasında sayfanın kaydırma imleci açılmasın. */
document.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

window.pusula.hazir();
