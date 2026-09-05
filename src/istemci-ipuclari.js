'use strict';

/*
 * Sec-CH-UA (User-Agent Client Hints) başlıkları.
 *
 * NEDEN GEREKLİ
 * Electron, güvenli bağlamda bile bu başlıkları göndermiyor. Ölçüldü:
 * https üzerinden yapılan bir gezinmede User-Agent "Chrome/152.0.7977.76"
 * diyor ama Sec-CH-UA, Sec-CH-UA-Mobile ve Sec-CH-UA-Platform başlıklarının
 * HİÇBİRİ yok. Gerçek Chrome bunları her güvenli istekte gönderir.
 *
 * "Chrome'um" deyip Client Hints göndermemek, bot korumalarının baktığı en net
 * tutarsızlıklardan biri; Cloudflare doğrulama döngüsünün sebebi bu.
 *
 * NE YAPMIYORUZ
 * Kimlik uydurmuyoruz. Başlıklar, sayfanın kendi `navigator.userAgentData`
 * değerlerinden üretiliyor - yani tel üzerindeki bilgi, JavaScript API'sinin
 * zaten söylediğiyle AYNI. Amaç yeni bir iddia eklemek değil, iki kanalın
 * birbirini yalanlamasını bitirmek. Markalarda "Google Chrome" YOK, çünkü
 * userAgentData'da da yok.
 */

/*
 * Yapılandırılmış alan (structured field) dizesi. Tırnak ve ters bölü
 * kaçırılmalı; marka adları GREASE gereği ?, _, ; gibi karakterler taşıyor.
 */
function dizeAlan(deger) {
  return '"' + String(deger).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * @param {Array<{brand: string, version: string}>} markalar navigator.userAgentData.brands
 * @param {boolean} mobil    navigator.userAgentData.mobile
 * @param {string}  platform navigator.userAgentData.platform
 * @returns {object|null} eklenecek başlıklar, üretilemiyorsa null
 */
function ipucuBasliklari(markalar, mobil, platform) {
  if (!Array.isArray(markalar) || !markalar.length) return null;

  const parcalar = [];
  for (const m of markalar) {
    if (!m || !m.brand) continue;
    parcalar.push(dizeAlan(m.brand) + ';v=' + dizeAlan(m.version == null ? '' : m.version));
  }
  if (!parcalar.length) return null;

  const basliklar = {
    'Sec-CH-UA': parcalar.join(', '),
    'Sec-CH-UA-Mobile': mobil ? '?1' : '?0'
  };
  if (platform) basliklar['Sec-CH-UA-Platform'] = dizeAlan(platform);
  return basliklar;
}

module.exports = { ipucuBasliklari };
