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

/*
 * Ülke bayrağı — HatScripts/circle-flags setinden gömülü (MIT lisansı),
 * kendinden dairesel maskeli profesyonel SVG'ler. Emoji bayrak yazıtipi
 * Windows'ta yok; bu yüzden gerçek çizim. mask id'leri ülkeye özel: aynı
 * belgede iki bayrak olursa çakışmasın. Bilinmeyen ülke için küre.
 */
function bayrakSvg(ulke) {
  const S = (id, ic) => '<svg viewBox="0 0 512 512" aria-hidden="true"><mask id="bm-' + id + '">'
    + '<circle cx="256" cy="256" r="256" fill="#fff"/></mask><g mask="url(#bm-' + id + ')">' + ic + '</g></svg>';
  const B = {
    DE: S('de', '<path fill="#ffda44" d="m0 345 256.7-25.5L512 345v167H0z"/><path fill="#d80027" d="m0 167 255-23 257 23v178H0z"/><path fill="#333" d="M0 0h512v167H0z"/>'),
    NL: S('nl', '<path fill="#eee" d="m0 167 253.8-19.3L512 167v178l-254.9 32.3L0 345z"/><path fill="#a2001d" d="M0 0h512v167H0z"/><path fill="#0052b4" d="M0 345h512v167H0z"/>'),
    FR: S('fr', '<path fill="#eee" d="M167 0h178l25.9 252.3L345 512H167l-29.8-253.4z"/><path fill="#0052b4" d="M0 0h167v512H0z"/><path fill="#d80027" d="M345 0h167v512H345z"/>'),
    TR: S('tr', '<path fill="#d80027" d="M0 0h512v512H0z"/><path fill="#eee" d="M208 115a141 141 0 1 0 106 242q-25 13-54 13a114 114 0 1 1 54-215 141 141 0 0 0-106-40m142 67v56l-54 18 54 17v57l33-46 54 18-33-46 33-46-54 18z"/>'),
    US: S('us', '<path fill="#eee" d="M256 0h256v64l-32 32 32 32v64l-32 32 32 32v64l-32 32 32 32v64l-256 32L0 448v-64l32-32-32-32v-64z"/><path fill="#d80027" d="M224 64h288v64H224Zm0 128h288v64H256ZM0 320h512v64H0Zm0 128h512v64H0Z"/><path fill="#0052b4" d="M0 0h256v256H0Z"/><path fill="#eee" d="m187 243 57-41h-70l57 41-22-67zm-81 0 57-41H93l57 41-22-67zm-81 0 57-41H12l57 41-22-67zm162-81 57-41h-70l57 41-22-67zm-81 0 57-41H93l57 41-22-67zm-81 0 57-41H12l57 41-22-67Zm162-82 57-41h-70l57 41-22-67Zm-81 0 57-41H93l57 41-22-67zm-81 0 57-41H12l57 41-22-67Z"/>'),
    GB: S('gb', '<path fill="#eee" d="m0 0 8 22-8 23v23l32 54-32 54v32l32 48-32 48v32l32 54-32 54v68l22-8 23 8h23l54-32 54 32h32l48-32 48 32h32l54-32 54 32h68l-8-22 8-23v-23l-32-54 32-54v-32l-32-48 32-48v-32l-32-54 32-54V0l-22 8-23-8h-23l-54 32-54-32h-32l-48 32-48-32h-32l-54 32L68 0H0z"/><path fill="#0052b4" d="M336 0v108L444 0Zm176 68L404 176h108zM0 176h108L0 68ZM68 0l108 108V0Zm108 512V404L68 512ZM0 444l108-108H0Zm512-108H404l108 108Zm-68 176L336 404v108z"/><path fill="#d80027" d="M0 0v45l131 131h45L0 0zm208 0v208H0v96h208v208h96V304h208v-96H304V0h-96zm259 0L336 131v45L512 0h-45zM176 336 0 512h45l131-131v-45zm160 0 176 176v-45L381 336h-45z"/>')
  };
  const svg = B[(ulke || '').toUpperCase()];
  if (svg) return svg;
  return '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.3"/>'
    + '<path d="M2 10h16M10 2v16M4.4 5c3.2 2.6 8 2.6 11.2 0M4.4 15c3.2-2.6 8-2.6 11.2 0" fill="none" stroke="currentColor" stroke-width="1.05"/></svg>';
}

const VPN_GUC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M12 2.5v9"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/></svg>';

// Başlıktaki kalkan (onaylı) ikonu — pencereye VPN kimliği katar.
const VPN_KALKAN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6l7-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'
  + '<path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/*
 * VPN açılır kutusu (VeePN tarzı): büyük güç düğmesi + bağlantı durumu +
 * bayraklı konum kartı + çıkış IP. KİMLİK DOĞRULAMA OTOMATİK: kullanıcı token
 * girmez; güç düğmesine basınca ana süreç cihaz token'ını sunucudan alır
 * (vpnAcKapa invoke -> {acik,hata}). Bant limiti (100 Mbps/kullanıcı) SUNUCUDA.
 * Aç/kapa ve lokasyon değişince kutu yerinde yeniden çizilir; durum v üstünde.
 */
function vpnCiz(v) {
  kutu.replaceChildren();          // yeniden çizimde eski içerik gitsin; konum sınıfları/var'ları kalır
  const m = v.metin;
  const bagli = !!v.acik;

  // Başlık: kalkan ikonu + "VPN" + kapat
  const baslik = document.createElement('div');
  baslik.className = 'menu-baslik vpn-baslik';
  const kalkan = document.createElement('span');
  kalkan.className = 'vpn-baslik-ikon';
  kalkan.innerHTML = VPN_KALKAN_SVG;
  const baslikAd = document.createElement('span');
  baslikAd.textContent = m.baslik;
  const kapat = document.createElement('button');
  kapat.className = 'ikon kucuk';
  kapat.innerHTML = SIMGE.kapat;
  kapat.title = m.kapat || '';
  kapat.addEventListener('click', () => window.katman.kapat());
  baslik.append(kalkan, baslikAd, kapat);
  kutu.appendChild(baslik);

  const ekran = document.createElement('div');
  ekran.className = 'vpn-ekran ' + (bagli ? 'acik' : 'kapali');

  // Güç düğmesi (halo + halkalarla) — otomatik kayıt: sonucu bekler,
  // bu sırada "Bağlanıyor…" gösterir.
  const gucAlan = document.createElement('div');
  gucAlan.className = 'vpn-guc-alan';
  const halo = document.createElement('div');
  halo.className = 'vpn-halo';
  const guc = document.createElement('button');
  guc.className = 'vpn-guc ' + (bagli ? 'acik' : 'kapali');
  guc.setAttribute('aria-pressed', bagli ? 'true' : 'false');
  guc.setAttribute('aria-label', m.ac);
  guc.innerHTML = VPN_GUC_SVG;
  gucAlan.append(halo, guc);

  const durumMetin = document.createElement('div');
  durumMetin.className = 'vpn-durum-metin';
  durumMetin.textContent = bagli ? m.baglantiAcik : m.baglantiKapali;

  const hata = document.createElement('div');
  hata.className = 'vpn-uyari';
  if (v.hata) hata.textContent = v.hata;

  guc.addEventListener('click', async () => {
    const hedef = !bagli;
    guc.disabled = true;
    guc.classList.add('mesgul');
    durumMetin.textContent = m.baglaniyor;
    hata.textContent = '';
    let sonuc = null;
    try { sonuc = await window.katman.vpnAcKapa(hedef); } catch (e) { /* sonuc null */ }
    if (!hedef) { v.acik = false; v.hata = ''; }                 // kapatma her zaman başarılı
    else if (sonuc && sonuc.acik && !sonuc.hata) { v.acik = true; v.hata = ''; }
    else { v.acik = false; v.hata = m.hataKayit; }               // kayıt/bağlantı olamadı
    vpnCiz(v);
  });
  ekran.append(gucAlan, durumMetin, hata);

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
  bayrak.innerHTML = bayrakSvg(v.lokasyon.ulke);
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

  // Otomatik-bağlantı notu (kullanıcı giriş yapmaz) + limit açıklaması
  const oto = document.createElement('div');
  oto.className = 'vpn-oto';
  oto.textContent = m.otomatik;
  const limit = document.createElement('div');
  limit.className = 'vpn-limit';
  limit.textContent = m.limit;
  ekran.append(oto, limit);

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
