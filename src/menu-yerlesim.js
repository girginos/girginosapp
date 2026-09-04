'use strict';

/*
 * Yerel menünün yatay konumu.
 *
 * Electron menünün genişliğini bildirmiyor. Menüyü düğmenin SOL kenarına
 * hizalarsak dar pencerede sağa taşıyor; genişliği fazla tahmin edersek de
 * gereğinden çok sola kaçıyor. İkisini de yaşadık.
 *
 * Bu yüzden genişliği tahmin etmiyor, ÖLÇÜYORUZ: main süreci etiketleri
 * arayüz penceresinde canvas ile ölçtürüyor (bkz. main.js menuGenisligi).
 * Buradaki sabitler o ölçüme eklenen sütunlar; Windows'ta gerçek menü
 * ölçülerek kalibre edildi:
 *
 *   en geniş etiket 113px + en geniş kısayol 95px + dolgu 47px = 255px
 *   (gözlenen gerçek menü genişliği 256px)
 */

// Kısayol sütunu için ayrılan yer. Kısayol metnini Electron yerelleştirdiği
// için ("Ctrl+ÜstKrktr+Del") uzunluğunu önceden bilemiyoruz; ölçülen en geniş
// hâline biraz pay eklenmiş sabit bir sütun kullanıyoruz.
const KISAYOL_SUTUNU = 98;

// Simge oluğu, sütun arası boşluk, kenarlık ve alt menü oku.
const DOLGU = 47;

// Ölçüm yapılamazsa kullanılacak kaba tahmin. 12px Segoe UI'da karakter
// başına ~5,2px ölçüldü.
const KARAKTER_GENISLIGI = 5.2;
const EN_DAR = 240;
const EN_GENIS = 460;
const KENAR = 4;

function genislikTahmini(ogeler) {
  let enUzun = 0;
  for (const o of ogeler || []) {
    if (o && o.label) enUzun = Math.max(enUzun, String(o.label).length);
  }
  return sinirla(Math.round(enUzun * KARAKTER_GENISLIGI) + KISAYOL_SUTUNU + DOLGU);
}

// Ölçülen en geniş etiketten menü genişliğini kurar.
function olcumdenGenislik(enGenisEtiketPx) {
  if (!Number.isFinite(enGenisEtiketPx) || enGenisEtiketPx <= 0) return null;
  return sinirla(Math.round(enGenisEtiketPx) + KISAYOL_SUTUNU + DOLGU);
}

function sinirla(genislik) {
  return Math.min(EN_GENIS, Math.max(EN_DAR, genislik));
}

/**
 * Menünün sol kenarı. Sağ kenarını düğmenin sağ kenarıyla hizalar, sonra
 * pencere içine sıkıştırır.
 *
 * @param {number} sagKenar         düğmenin sağ kenarı (pencere içi koordinat)
 * @param {number} pencereGenisligi
 * @param {number} menuGenisligi
 */
function xKonumu(sagKenar, pencereGenisligi, menuGenisligi) {
  return sinirlaX(Math.round(sagKenar) - menuGenisligi, pencereGenisligi, menuGenisligi);
}

/*
 * Sol kenara hizalama. Araç çubuğunun solundaki düğmeler (kilit gibi) için;
 * onları sağa hizalamak menüyü pencerenin soluna savurur.
 */
function xKonumuSol(solKenar, pencereGenisligi, menuGenisligi) {
  return sinirlaX(Math.round(solKenar), pencereGenisligi, menuGenisligi);
}

function sinirlaX(x, pencereGenisligi, menuGenisligi) {
  const enSag = Math.max(KENAR, pencereGenisligi - menuGenisligi - KENAR);
  return Math.max(KENAR, Math.min(x, enSag));
}

module.exports = {
  genislikTahmini, olcumdenGenislik, xKonumu, xKonumuSol,
  KISAYOL_SUTUNU, DOLGU, EN_DAR, EN_GENIS, KENAR
};
