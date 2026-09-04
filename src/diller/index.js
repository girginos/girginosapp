'use strict';

const tr = require('./tr');

// Sıra, ayarlardaki listenin sırasıdır.
const DILLER = {
  tr,
  en: require('./en'),
  de: require('./de'),
  fr: require('./fr'),
  es: require('./es'),
  it: require('./it'),
  pt: require('./pt'),
  ru: require('./ru'),
  ar: require('./ar'),
  zh: require('./zh'),
  ja: require('./ja')
};

// Sistem yereli "de-AT", "pt-BR", "zh-Hans-CN" gibi gelebiliyor.
function dilCoz(ayar, sistemYereli) {
  if (ayar && ayar !== 'sistem' && DILLER[ayar]) return ayar;
  const ham = String(sistemYereli || '').toLowerCase();
  const kok = ham.split(/[-_]/)[0];
  if (DILLER[kok]) return kok;
  return 'en';
}

// Eksik anahtarlarda Türkçeye değil İngilizceye düşmek daha az şaşırtıcı;
// tr yalnızca en'de de yoksa devreye girer.
function ceviri(dilKodu) {
  const d = DILLER[dilKodu] || DILLER.en;
  return {
    dil: dilKodu,
    ad: d.ad,
    yon: d.yon || 'ltr',
    yerel: d.yerel || 'en-US',
    metin: { ...tr.metin, ...DILLER.en.metin, ...d.metin }
  };
}

// {n}, {origin} gibi yer tutucuları doldurur.
function bicimle(kalip, degerler) {
  if (!degerler) return kalip;
  return String(kalip).replace(/\{(\w+)\}/g, (t, k) =>
    (Object.hasOwn(degerler, k) ? String(degerler[k]) : t));
}

// Ayarlar ekranındaki dil listesi.
function dilListesi() {
  return Object.entries(DILLER).map(([kod, d]) => ({ kod, ad: d.ad }));
}

module.exports = { DILLER, dilCoz, ceviri, bicimle, dilListesi };
