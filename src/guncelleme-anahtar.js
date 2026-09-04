'use strict';

/*
 * Güncelleme yayın anahtarı ve besleme adresi.
 *
 * ACIK_ANAHTAR boşken güncelleme sistemi KAPALIDIR. Bu bilinçli: anahtarsız
 * bir güncelleyici, sunucuya güvenmek zorunda kalır. Kendi anahtarınızı
 * üretmek için:
 *
 *     npm run anahtar-uret
 *
 * Komut açık anahtarı ekrana basar (buraya yapıştırın) ve özel anahtarı
 * seçtiğiniz dosyaya yazar. ÖZEL ANAHTAR DEPOYA GİRMEMELİ; yayın imzalamak
 * için çevrimdışı bir makinede ya da CI gizli değişkeninde durmalı.
 *
 * Anahtar değişimi (rotation): yeni anahtarı buraya ekleyip ESKİ anahtarla
 * imzalanmış bir sürüm yayınlayın; kullanıcılar o sürüme geçtikten sonra eski
 * anahtarı listeden çıkarın.
 */

// Birden fazla anahtar kabul edilir: geçiş dönemlerinde eskisi de listede kalır.
const ACIK_ANAHTARLAR = [
  // 2026-09 yayın anahtarı. Özel eşi çevrimdışı: pusula-yayin-anahtari.pem
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAnofV5S2o30UALXtJp24thzdi9226XBOlkfgV2kbOTxE=\n-----END PUBLIC KEY-----\n'
];

// Manifest ve imza dosyasının bulunduğu dizin. Yalnızca https kabul edilir.
//   <FEED_ADRESI>/pusula-guncelleme.json
//   <FEED_ADRESI>/pusula-guncelleme.json.imza
const FEED_ADRESI = 'https://browserapp.girginos.app/pusula';

// Windows'ta kurulum dosyasının kod imzasındaki yayıncı adı. Sertifika
// aldığınızda buraya yazın; electron-updater imzayı buna karşı doğrular.
const YAYINCI_ADI = '';

function yapilandirilmisMi() {
  return ACIK_ANAHTARLAR.length > 0 && /^https:\/\//i.test(FEED_ADRESI);
}

module.exports = { ACIK_ANAHTARLAR, FEED_ADRESI, YAYINCI_ADI, yapilandirilmisMi };
