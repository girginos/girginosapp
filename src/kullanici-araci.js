'use strict';

/*
 * Kullanıcı aracısı dizesi.
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
 * ACCEPT-LANGUAGE'A NEDEN DOKUNMUYORUZ
 *
 * Başlık tek bir etiketten ibaret ("tr"); gerçek tarayıcılar bölge kodu ve
 * yedek dillerle gönderdiği için burayı "düzeltmek" cazip görünüyor. Denendi
 * ve ölçüldü — sonuç daha kötü:
 *
 *   setUserAgent'a dil listesi VERİLMEDİĞİNDE
 *     Accept-Language     : tr
 *     navigator.languages : ["tr"]          -> tutarlı
 *
 *   dil listesi VERİLDİĞİNDE
 *     Accept-Language     : tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7
 *     navigator.languages : ["tr"]          -> TUTARSIZ
 *
 * Electron başlığı değiştiriyor ama navigator.languages'i değiştirmiyor.
 * Gerçek bir tarayıcıda bu ikisi her zaman aynıdır; ayrışması, sahte başlık
 * kullanan otomasyonun klasik imzasıdır. Yani "tipik görünmek" için yapılan
 * değişiklik, tek etiketli bir başlıktan çok daha güçlü bir bot sinyali
 * üretiyor. Tutarlılık, tipiklikten önce gelir.
 *
 * Bunu değiştirmek isteyen: önce ikisini AYNI anda ayarlamanın bir yolunu
 * bulun (Chromium'un --accept-lang anahtarı denendi, etkisi olmadı).
 */

module.exports = { uaTemizle };
