'use strict';

/*
 * Kullanıcı aracısı ve dil başlıkları.
 *
 * Electron varsayılan UA'ya hem "Electron/x" hem de uygulama adını ekler.
 * Önceki temizlik deseni adı `app.getName()` üzerinden kuruyordu ve SESSİZCE
 * çalışmıyordu: Electron adı UA'ya boşluksuz yazıyor ("Girginos Browser" ->
 * "GirginosBrowser/1.0.0"), desen ise boşluklu adı arıyordu. Ölçtüğümüzde
 * ortaya çıktı — o tarihe kadar hiçbir tarayıcının tanımadığı bir belirteçle
 * geziliyordu ve Cloudflare gibi bot korumaları bunu doğrulama döngüsüyle
 * karşılıyordu.
 *
 * Artık ad tahmin edilmiyor: standart Chrome UA'sında bulunmayan HER
 * "Ad/sürüm" belirteci atılıyor. Uygulama adı değişse de, Electron biçimi
 * değiştirse de çalışır.
 */

const IZINLI_BELIRTEC = /^(?:Mozilla|AppleWebKit|Chrome|Safari)$/;
const BELIRTEC = /([A-Za-z][A-Za-z0-9._-]*)\/([0-9][0-9A-Za-z.+-]*)\s*/g;

function uaTemizle(ua) {
  return String(ua == null ? '' : ua)
    .replace(BELIRTEC, (tam, ad) => (IZINLI_BELIRTEC.test(ad) ? tam : ''))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/*
 * Accept-Language tek bir etiketten ibaret olmamalı ("tr"). Gerçek tarayıcılar
 * bölge kodu ve yedek dillerle gönderir; tek etiket hem sıra dışı duruyor hem
 * de bazı sunucularda içerik pazarlığını bozuyor.
 *
 * Yalnızca dil KODLARI döner, ağırlık (q=) YOK: Chromium ağırlıkları kendisi
 * ekliyor. Ağırlıklı bir dize verilince başlık "tr;q=0.9;q=0.9" gibi iki kez
 * ağırlıklı çıkıyor — bu ölçülerek görüldü, tahmin edilmedi.
 */
function kabulEdilenDiller(dil, yerel) {
  const kok = String(dil || 'en').split('-')[0].toLowerCase();
  const bolge = String(yerel || kok);
  const liste = [bolge];
  if (bolge !== kok) liste.push(kok);
  if (kok !== 'en') liste.push('en-US', 'en');
  return liste.join(',');
}

module.exports = { uaTemizle, kabulEdilenDiller };
