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

/* ---------------- VPN ---------------- */

// Ülke kodundan bayrak emojisi (bölgesel gösterge harfleri). Windows'ta bayrak
// yazıtipi yoksa iki harfli kod görünür — kabul edilebilir.
function bayrakEmoji(ulke) {
  if (!ulke || ulke.length !== 2) return '🌐';
  return [...ulke.toUpperCase()].map((c) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}

const VPN_GUC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M12 2.5v9"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/></svg>';

/*
 * VPN açılır kutusu (VeePN tarzı): büyük güç düğmesi + bağlantı durumu +
 * bayraklı konum kartı + çıkış IP + cihaz token'ı. Aç/kapa ve lokasyon
 * değişince kutu yerinde yeniden çizilir (iyimser); asıl durumu ana süreç
 * saklar. Bant limiti (100 Mbps/kullanıcı) SUNUCUDA uygulanır.
 */
function vpnCiz(v) {
  kutu.replaceChildren();          // yeniden çizimde eski içerik gitsin; konum sınıfları/var'ları kalır
  const m = v.metin;
  const bagli = !!v.acik;

  // Başlık + kapat
  const baslik = document.createElement('div');
  baslik.className = 'menu-baslik';
  baslik.textContent = m.baslik;
  const kapat = document.createElement('button');
  kapat.className = 'ikon kucuk';
  kapat.innerHTML = SIMGE.kapat;
  kapat.title = m.kapat || '';
  kapat.addEventListener('click', () => window.katman.kapat());
  baslik.appendChild(kapat);
  kutu.appendChild(baslik);

  const ekran = document.createElement('div');
  ekran.className = 'vpn-ekran';

  // Token kartı (güç düğmesi buna bakıyor; önce kur)
  const tokKart = document.createElement('div');
  tokKart.className = 'vpn-kart vpn-token-kart' + (v.tokenVar ? '' : ' gerekli');
  const tokBaslik = document.createElement('div');
  tokBaslik.className = 'vpn-token-baslik';
  tokBaslik.textContent = m.token;
  const tok = document.createElement('input');
  tok.type = 'password'; tok.value = v.token || ''; tok.placeholder = m.tokenYer;
  tok.autocomplete = 'off'; tok.spellcheck = false; tok.className = 'vpn-token-girdi';
  const tokUyari = document.createElement('div');
  tokUyari.className = 'vpn-uyari';
  tok.addEventListener('change', () => {
    const t = tok.value.trim();
    v.tokenVar = !!t;
    tokKart.classList.toggle('gerekli', !t);
    tokUyari.textContent = '';
    window.katman.vpnToken(t);
  });
  tokKart.append(tokBaslik, tok, tokUyari);

  // Güç düğmesi
  const guc = document.createElement('button');
  guc.className = 'vpn-guc ' + (bagli ? 'acik' : 'kapali');
  guc.setAttribute('aria-pressed', bagli ? 'true' : 'false');
  guc.setAttribute('aria-label', m.ac);
  guc.innerHTML = VPN_GUC_SVG;
  guc.addEventListener('click', () => {
    if (!bagli && !v.tokenVar) { tokUyari.textContent = m.tokenGerek; tok.focus(); return; }
    v.acik = !bagli;
    window.katman.vpnAcKapa(v.acik);
    vpnCiz(v);                     // iyimser yeniden çizim
  });

  const durumMetin = document.createElement('div');
  durumMetin.className = 'vpn-durum-metin';
  durumMetin.textContent = bagli ? m.baglantiAcik : m.baglantiKapali;
  ekran.append(guc, durumMetin);

  // Konum kartı (bayrak + ad; tıkla → gizli seçici)
  const sec = document.createElement('select');
  sec.className = 'vpn-gizli-sec';
  sec.setAttribute('aria-label', m.lokasyon);
  for (const x of v.katalog) {
    const o = document.createElement('option');
    o.value = x.id; o.textContent = x.ad + ' (' + x.ulke + ')';
    if (x.id === v.lokasyon.id) o.selected = true;
    sec.appendChild(o);
  }
  sec.addEventListener('change', () => {
    v.lokasyon = v.katalog.find((x) => x.id === sec.value) || v.lokasyon;
    window.katman.vpnLokasyon(sec.value);
    vpnCiz(v);
  });
  const lokKart = document.createElement('button');
  lokKart.className = 'vpn-kart vpn-lokasyon-kart';
  const bayrak = document.createElement('span');
  bayrak.className = 'vpn-bayrak';
  bayrak.textContent = bayrakEmoji(v.lokasyon.ulke);
  const lokAd = document.createElement('span');
  lokAd.className = 'vpn-lok-ad';
  const lokB = document.createElement('b'); lokB.textContent = v.lokasyon.ad || '';
  const lokS = document.createElement('small'); lokS.textContent = v.lokasyon.ulke || '';
  lokAd.append(lokB, lokS);
  const ok = document.createElement('span'); ok.className = 'vpn-ok'; ok.textContent = '›';
  lokKart.append(bayrak, lokAd, ok);
  lokKart.addEventListener('click', () => {
    if (v.katalog.length > 1) { if (sec.showPicker) sec.showPicker(); else sec.click(); }
  });
  ekran.append(lokKart, sec);

  // Çıkış IP kartı
  const ipKart = document.createElement('div');
  ipKart.className = 'vpn-kart vpn-ip-kart';
  const ipMetin = document.createElement('span');
  const ipDeger = document.createElement('b');
  ipDeger.className = 'vpn-ip-deger'; ipDeger.textContent = '—';
  ipMetin.append(document.createTextNode(m.ipBaslik + ': '), ipDeger);
  const ipBtn = document.createElement('button');
  ipBtn.className = 'dugme'; ipBtn.textContent = m.ipGoster;
  ipBtn.addEventListener('click', async () => {
    ipBtn.disabled = true; ipDeger.textContent = '…';
    const ip = await window.katman.vpnCikisIp();
    ipDeger.textContent = ip || m.ipHata; ipBtn.disabled = false;
  });
  ipKart.append(ipMetin, ipBtn);
  ekran.appendChild(ipKart);

  // Token kartı + limit açıklaması
  ekran.appendChild(tokKart);
  const limit = document.createElement('div');
  limit.className = 'vpn-limit';
  limit.textContent = m.limit;
  ekran.appendChild(limit);

  kutu.appendChild(ekran);
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
  else if (v.tur === 'vpn') vpnCiz(v);
});

// Dışarı tıklama ve Escape kutuyu kapatır. İzin kutusunda bu "reddet"
// anlamına gelir; kararı ana süreç veriyor, biz yalnızca kapanışı bildiriyoruz.
ortu.addEventListener('mousedown', () => window.katman.kapat());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.katman.kapat();
});

window.katman.hazir();
