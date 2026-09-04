'use strict';

// Bu sayfa korumalı çalışır ve ana süreçle konuşamaz: başlık, açıklama ve
// öneriler zaten çevrilmiş hâlde adres parametreleriyle gelir.

const par = new URLSearchParams(location.search);
const kod = par.get('kod') || '';
const aciklama = par.get('aciklama') || '';
const adres = par.get('adres') || '';

document.documentElement.lang = par.get('dil') || 'tr';
document.documentElement.dir = par.get('yon') === 'rtl' ? 'rtl' : 'ltr';

let metin = {};
try { metin = JSON.parse(par.get('metin') || '{}'); } catch { /* varsayılanlar */ }

const baslik = metin.baslik || 'Bu sayfa açılamadı';
const govde = metin.aciklama || aciklama || '';
const oneriler = Array.isArray(metin.oneriler) ? metin.oneriler : [];

document.title = baslik;
document.getElementById('baslik').textContent = baslik;
document.getElementById('aciklama').textContent = govde;
document.getElementById('adres').textContent = adres;

const liste = document.getElementById('oneriler');
for (const o of oneriler) {
  const li = document.createElement('li');
  li.textContent = o;
  liste.appendChild(li);
}

// Chromium'un kendi hata sabiti (ERR_NAME_NOT_RESOLVED gibi) teknik ipucu olarak durur.
document.getElementById('kod').textContent = aciklama ? aciklama + ' (' + kod + ')' : String(kod);

// "adres" başarısız gezinmeden geliyor, yani içeriği saldırgan etkisinde.
// Yalnızca gerçek bir web adresiyse tekrar denenebilir.
const tekrar = document.getElementById('tekrar');
tekrar.textContent = metin.tekrar || 'Tekrar dene';

let hedef = null;
try {
  const u = new URL(adres);
  if (u.protocol === 'https:' || u.protocol === 'http:') hedef = u.href;
} catch { /* geçersiz adres */ }

if (hedef) {
  tekrar.addEventListener('click', () => { location.href = hedef; });
} else {
  tekrar.hidden = true;
}
