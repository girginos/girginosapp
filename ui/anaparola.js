'use strict';

// Metinler ana süreçte çevrilip hazır geliyor; bu sayfa çeviri tablosu taşımıyor.
const el = {
  baslik: document.getElementById('apBaslik'),
  aciklama: document.getElementById('apAciklama'),
  etiket: document.getElementById('apEtiket'),
  parola: document.getElementById('apParola'),
  tekrarAlan: document.getElementById('apTekrarAlan'),
  tekrarEtiket: document.getElementById('apTekrarEtiket'),
  tekrar: document.getElementById('apTekrar'),
  hata: document.getElementById('apHata'),
  atla: document.getElementById('apAtla'),
  tamam: document.getElementById('apTamam'),
  not: document.getElementById('apNot')
};

let kurKipi = false;

window.anaParola.dinle((v) => {
  const m = v.metin || {};
  kurKipi = v.kip === 'kur';
  document.documentElement.lang = v.dil || 'tr';
  document.documentElement.dir = v.yon === 'rtl' ? 'rtl' : 'ltr';
  el.baslik.textContent = m.baslik || 'Ana parola';
  el.aciklama.textContent = m.aciklama || '';
  el.etiket.textContent = m.etiket || 'Parola';
  el.tekrarEtiket.textContent = m.tekrarEtiket || '';
  el.atla.textContent = m.atla || 'Atla';
  el.tamam.textContent = m.tamam || 'Aç';
  el.not.textContent = m.not || '';
  el.tekrarAlan.hidden = !kurKipi;
  el.hata.textContent = v.hata || '';
  if (v.hata) { el.parola.value = ''; el.tekrar.value = ''; }
  el.parola.focus();
});

function gonder() {
  const p = el.parola.value;
  if (!p) { el.hata.textContent = el.hata.dataset.bos || 'Parola boş olamaz'; return; }
  if (kurKipi && p !== el.tekrar.value) {
    el.hata.textContent = el.hata.dataset.eslesmiyor || 'Parolalar eşleşmiyor';
    return;
  }
  el.tamam.disabled = true;
  el.hata.textContent = '';
  window.anaParola.gonder(p);
}

el.tamam.addEventListener('click', gonder);
el.atla.addEventListener('click', () => window.anaParola.atla());
for (const g of [el.parola, el.tekrar]) {
  g.addEventListener('keydown', (e) => { if (e.key === 'Enter') gonder(); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.anaParola.atla(); });

window.anaParola.hazir();
