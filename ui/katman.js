'use strict';

/*
 * Katman içeriğini çizer. İki tür var: indirilenler kutusu ve izin isteği.
 * Metinlerin tamamı ana süreçten çevrilmiş olarak geliyor; bu sayfa kendi
 * çeviri tablosunu taşımıyor.
 */

const ortu = document.getElementById('ortu');
const kutu = document.getElementById('kutu');

const SIMGE = {
  klasor: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.6h4.2L7.4 6.2H14v7.2H2z"/></svg>',
  kapat: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  uyari: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.6l5.9 10.8H2.1z"/>'
    + '<path d="M8 6.4v3.1"/><path d="M8 11.4v.3"/></svg>',
  indir: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.8v7.1"/>'
    + '<path d="M5.2 7.2 8 10l2.8-2.8"/><path d="M3.4 13h9.2"/></svg>',
  soru: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/>'
    + '<path d="M6.4 6.2a1.6 1.6 0 1 1 1.9 1.9v1"/><path d="M8.3 11.2v.3"/></svg>'
};

function bos() {
  kutu.replaceChildren();
  kutu.className = '';
}

/* ---------------- indirilenler ---------------- */

function indirmeleriCiz(v) {
  const baslik = document.createElement('div');
  baslik.className = 'menu-baslik';
  baslik.textContent = v.baslik;

  const kapat = document.createElement('button');
  kapat.className = 'ikon kucuk';
  kapat.innerHTML = SIMGE.kapat;
  kapat.title = v.kapatMetni || '';
  kapat.addEventListener('click', () => window.katman.kapat());
  baslik.appendChild(kapat);
  kutu.appendChild(baslik);

  if (!v.ogeler.length) {
    const bosluk = document.createElement('div');
    bosluk.className = 'menu-bos';
    bosluk.textContent = v.bosMetni;
    kutu.appendChild(bosluk);
    return;
  }

  for (const o of v.ogeler) {
    const satir = document.createElement('div');
    satir.className = 'menu-satir' + (o.riskli ? ' riskli' : '');
    satir.title = o.ad;

    const simge = document.createElement('span');
    simge.className = 'menu-ikon';
    simge.innerHTML = o.riskli ? SIMGE.uyari : SIMGE.indir;
    satir.appendChild(simge);

    const metin = document.createElement('div');
    metin.className = 'menu-metin';
    const ad = document.createElement('div');
    ad.className = 'menu-ad';
    ad.textContent = o.ad;
    const alt = document.createElement('div');
    alt.className = 'menu-alt';
    alt.textContent = o.alt;
    metin.append(ad, alt);
    satir.appendChild(metin);

    // İlerleme çizgisi yalnızca sürmekte olan ve boyutu bilinen indirmelerde.
    if (o.yuzde !== null && o.yuzde !== undefined) {
      const cubuk = document.createElement('div');
      cubuk.className = 'ilerleme';
      const ic = document.createElement('div');
      ic.style.width = o.yuzde + '%';
      cubuk.appendChild(ic);
      metin.appendChild(cubuk);
    }

    if (o.acilabilir) {
      satir.addEventListener('click', () => window.katman.indirmeAc(o.id));
      const klasor = document.createElement('button');
      klasor.className = 'ikon kucuk';
      klasor.innerHTML = SIMGE.klasor;
      klasor.title = v.klasorMetni || '';
      klasor.addEventListener('click', (e) => {
        e.stopPropagation();
        window.katman.indirmeKlasor(o.id);
      });
      satir.appendChild(klasor);
    }

    kutu.appendChild(satir);
  }

  const tumu = document.createElement('button');
  tumu.className = 'menu-alt-dugme';
  tumu.textContent = v.tumunuMetni;
  tumu.addEventListener('click', () => window.katman.tumunuGoster());
  kutu.appendChild(tumu);
}

/* ---------------- izin isteği ---------------- */

function izinCiz(v) {
  const baslik = document.createElement('div');
  baslik.className = 'izin-baslik';
  baslik.innerHTML = SIMGE.soru;
  const b = document.createElement('span');
  b.textContent = v.baslik;
  baslik.appendChild(b);
  kutu.appendChild(baslik);

  const kaynak = document.createElement('div');
  kaynak.className = 'izin-kaynak';
  const kb = document.createElement('b');
  kb.textContent = v.kaynak;
  kaynak.append(kb, document.createTextNode(' ' + v.istiyor));
  kutu.appendChild(kaynak);

  const ne = document.createElement('div');
  ne.className = 'izin-ne';
  ne.textContent = v.ne;
  kutu.appendChild(ne);

  const etiket = document.createElement('label');
  etiket.className = 'izin-hatirla';
  const kutucuk = document.createElement('input');
  kutucuk.type = 'checkbox';
  etiket.append(kutucuk, document.createTextNode(v.hatirlaMetni));
  kutu.appendChild(etiket);

  const dugmeler = document.createElement('div');
  dugmeler.className = 'izin-dugmeler';

  const reddet = document.createElement('button');
  reddet.textContent = v.reddetMetni;
  reddet.addEventListener('click', () => window.katman.izinKarar(false, kutucuk.checked));

  const izinVer = document.createElement('button');
  izinVer.className = 'birincil';
  izinVer.textContent = v.izinMetni;
  izinVer.addEventListener('click', () => window.katman.izinKarar(true, kutucuk.checked));

  dugmeler.append(reddet, izinVer);
  kutu.appendChild(dugmeler);

  // Odak reddetmede başlasın: kazara Enter izin vermesin.
  requestAnimationFrame(() => reddet.focus());
}

/* ---------------- yönlendirme ---------------- */

window.katman.dinle((v) => {
  bos();
  kutu.classList.add(v.yon === 'sol' ? 'sol' : 'sag');
  kutu.style.setProperty('--kutu-ust', v.ust + 'px');
  kutu.style.setProperty('--kutu-kenar', v.kenar + 'px');
  if (v.genislik) kutu.style.setProperty('--kutu-genislik', v.genislik + 'px');

  if (v.tur === 'indirmeler') indirmeleriCiz(v);
  else if (v.tur === 'izin') izinCiz(v);
});

// Dışarı tıklama ve Escape kutuyu kapatır. İzin kutusunda bu "reddet"
// anlamına gelir; kararı ana süreç veriyor, biz yalnızca kapanışı bildiriyoruz.
ortu.addEventListener('mousedown', () => window.katman.kapat());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.katman.kapat();
});

window.katman.hazir();
