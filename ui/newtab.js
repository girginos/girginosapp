'use strict';

// Bu sayfa korumalı (sandbox) ve preload'suz çalışır: ana süreçle konuşamaz,
// dışarıya hiçbir istek atmaz. Göstereceği her şey adres parametrelerinden
// gelir; kullanıcının eklediği kısayollar localStorage'da durur.

const MOTORLAR = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  yandex: 'https://yandex.com.tr/search/?text=',
  bing: 'https://www.bing.com/search?q=',
  startpage: 'https://www.startpage.com/sp/search?query=',
  brave: 'https://search.brave.com/search?q='
};

const par = new URLSearchParams(location.search);
const motor = MOTORLAR[par.get('motor')] || MOTORLAR.duckduckgo;

document.documentElement.lang = par.get('dil') || 'tr';
document.documentElement.dir = par.get('yon') === 'rtl' ? 'rtl' : 'ltr';

function jsonPar(ad) {
  try {
    const d = JSON.parse(par.get(ad) || '[]');
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}
const sonlar = jsonPar('sonlar');
const duyurular = jsonPar('duyurular');

// Metinler ana süreçte çevrilip buraya hazır geliyor.
let M = {};
try { M = JSON.parse(par.get('metin') || '{}'); } catch { /* varsayılanlar */ }
const m = (anahtar, varsayilan) => (typeof M[anahtar] === 'string' && M[anahtar]) || varsayilan;

document.querySelector('.marka span').textContent = m('slogan', 'gizlilik odaklı tarayıcı');
// Yalnızca metin span'ine yaz: butonun içindeki büyüteç SVG'si korunsun.
document.querySelector('#aramaFormu button[type="submit"] span').textContent = m('ara', 'Ara');
document.getElementById('sorgu').placeholder = m('araIpucu', 'Ara ya da adres yaz');
document.querySelector('#sikBolum h2').textContent = m('sik', 'Sık gidilenler');
document.querySelector('#duyuruBolum h2').textContent = m('oneCikan', 'Öne çıkan');

/* ---- arama ---- */

const ADRES_GIBI = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i;

document.getElementById('aramaFormu').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('sorgu').value.trim();
  if (!q) return;
  // Adres gibi görünüyorsa doğrudan git; ana süreçteki çözümleyiciyle aynı sezgi.
  location.href = /^https?:\/\//i.test(q) ? q
    : (ADRES_GIBI.test(q) && !/\s/.test(q) ? 'https://' + q : motor + encodeURIComponent(q));
});

/* ---- ortak ---- */

const ROZET_RENKLERI = ['#2867ff', '#0f766e', '#2563eb', '#b45309', '#7c3aed', '#be185d', '#15803d', '#0891b2'];

function alanAdi(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function rozetYap(host) {
  const d = document.createElement('span');
  d.className = 'rozet';
  d.textContent = (host[0] || '?').toLocaleUpperCase('tr');
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  d.style.background = ROZET_RENKLERI[h % ROZET_RENKLERI.length];
  return d;
}

// Uzun sayfa başlığı yerine kısa ve tanınır bir ad.
function kisaAd(baslik, host) {
  const b = String(baslik || '').trim();
  if (!b) return host;
  const ilk = b.split(/\s+[|–—-]\s+/)[0].trim();
  const aday = ilk.length >= 3 ? ilk : b;
  return aday.length > 20 ? host : aday;
}

/* ---- kısayollar (kullanıcı) ---- */

function kisayollariOku() {
  try { return JSON.parse(localStorage.getItem('pusula-kisayollar') || '[]'); } catch { return []; }
}
function kisayollariYaz(liste) {
  try { localStorage.setItem('pusula-kisayollar', JSON.stringify(liste)); } catch { /* özel mod */ }
}
function adresNormalize(girdi) {
  const s = String(girdi || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (ADRES_GIBI.test(s)) return 'https://' + s;
  return null;
}

/* ---- sık gidilenler ---- */

const kap = document.getElementById('kutucuklar');

// Sitenin gerçek simgesi yerel önbellekte varsa onu, yoksa harf rozetini
// gösteriyoruz. İstek dışarı çıkmaz: pusula-favicon:// yerel bir şema.
function simgeYap(host, favicon) {
  if (!favicon) return rozetYap(host);
  const i = document.createElement('img');
  i.className = 'rozet-img';
  i.src = favicon;
  i.alt = '';
  // Sayfa açılırken simge henüz indirilmemiş olabilir; bir kez daha deneyip
  // ancak ondan sonra harf rozetine düşüyoruz.
  let denendi = false;
  i.addEventListener('error', () => {
    if (denendi) { i.replaceWith(rozetYap(host)); return; }
    denendi = true;
    setTimeout(() => { i.src = favicon + '?y=' + Date.now(); }, 1800);
  });
  return i;
}

function kutucukYap({ url, ad, alt, favicon, silGeriCagirim }) {
  const a = document.createElement('a');
  a.className = 'kutucuk';
  a.href = url;
  a.title = url;

  const host = alanAdi(url) || url;
  a.appendChild(simgeYap(host, favicon));

  const m = document.createElement('div');
  m.className = 'kutucuk-metin';
  const b1 = document.createElement('div');
  b1.className = 'kutucuk-ad';
  b1.textContent = ad;
  const b2 = document.createElement('div');
  b2.className = 'kutucuk-alt';
  b2.textContent = alt;
  m.append(b1, b2);
  a.appendChild(m);

  if (silGeriCagirim) {
    const s = document.createElement('button');
    s.className = 'sil';
    s.type = 'button';
    s.textContent = '×';
    s.title = m('kaldir', 'Kaldır');
    s.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); silGeriCagirim(); });
    a.appendChild(s);
  }
  return a;
}

function ciz() {
  kap.replaceChildren();
  const kisayollar = kisayollariOku();
  const gorulen = new Set();

  for (const k of kisayollar) {
    const host = alanAdi(k.url) || k.url;
    gorulen.add(host);
    kap.appendChild(kutucukYap({
      url: k.url,
      ad: k.ad || host,
      alt: m('kisayol', 'Kısayol'),
      // Önbellekte yoksa 404 döner ve harf rozetine düşeriz.
      favicon: 'pusula-favicon://' + host,
      silGeriCagirim: () => { kisayollariYaz(kisayollariOku().filter(x => x.url !== k.url)); ciz(); }
    }));
  }

  for (const s of sonlar) {
    if (gorulen.has(s.host)) continue;
    gorulen.add(s.host);
    kap.appendChild(kutucukYap({
      url: s.url,
      ad: kisaAd(s.baslik, s.host),
      alt: s.host,
      favicon: s.favicon || ''
    }));
  }

  const ekle = document.createElement('button');
  ekle.className = 'ekle';
  ekle.type = 'button';
  ekle.textContent = m('kisayolEkle', '+ Kısayol ekle');
  ekle.addEventListener('click', () => ekleFormu(ekle));
  kap.appendChild(ekle);

  if (!kisayollar.length && !sonlar.length) {
    const not = document.createElement('p');
    not.className = 'bos-not';
    not.textContent = m('bosNot', '');
    document.getElementById('sikBolum').appendChild(not);
  }
}

function ekleFormu(dugme) {
  const girdi = document.createElement('input');
  girdi.type = 'text';
  girdi.id = 'kisayolGirdi';
  girdi.placeholder = m('kisayolIpucu', 'ornek.com');

  girdi.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const url = adresNormalize(girdi.value);
      if (!url) { girdi.value = ''; girdi.placeholder = m('gecersiz', 'Geçerli bir adres yazın'); return; }
      const liste = kisayollariOku();
      if (!liste.some(x => x.url === url)) liste.push({ url, ad: alanAdi(url) || url });
      kisayollariYaz(liste);
      ciz();
    } else if (e.key === 'Escape') {
      ciz();
    }
  });
  girdi.addEventListener('blur', () => { if (!girdi.value.trim()) ciz(); });

  dugme.replaceWith(girdi);
  girdi.focus();
}

/* ---- tanıtım alanı ---- */

function duyurulariCiz() {
  if (!duyurular.length) return;
  const bolum = document.getElementById('duyuruBolum');
  const kutu = document.getElementById('duyurular');
  bolum.hidden = false;

  for (const d of duyurular.slice(0, 4)) {
    // Yalnızca gerçek web adresi tıklanabilir olsun.
    const gecerli = typeof d.url === 'string' && /^https?:\/\//i.test(d.url);
    const kart = document.createElement(gecerli ? 'a' : 'div');
    kart.className = 'duyuru';
    if (gecerli) { kart.href = d.url; kart.title = d.url; }

    if (d.etiket) {
      const e = document.createElement('span');
      e.className = 'duyuru-etiket';
      e.textContent = String(d.etiket);
      kart.appendChild(e);
    }
    const b = document.createElement('div');
    b.className = 'duyuru-baslik';
    b.textContent = String(d.baslik || '');
    const m = document.createElement('div');
    m.className = 'duyuru-metin';
    m.textContent = String(d.metin || '');
    kart.append(b, m);
    kutu.appendChild(kart);
  }
}

/* ---- alt bilgi ---- */

document.getElementById('alt').textContent = m('alt', '');

ciz();
duyurulariCiz();
