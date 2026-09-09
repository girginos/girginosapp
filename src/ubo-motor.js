'use strict';

/*
 * uBlock Origin AĞ FİLTRELEME MOTORU (SNFE) sarmalayıcısı.
 *
 * gorhill'in @gorhill/ubo-core paketi, uBlock Origin'in GERÇEK static network
 * filtering engine'idir (SNFE). Bizim eski ayrıştırıcımız (src/listeler.js)
 * ağ kurallarının yalnızca "çıplak ana makine adına indirgenebilenlerini"
 * tutup gerisini (yol kalıpları, $script/$image gibi kaynak-türü kısıtları,
 * $domain= bağlamı, joker/regex) SESSİZCE atıyordu. SNFE tüm bu söz dizimini
 * uygular -> gerçek uBO kalitesinde ağ engelleme.
 *
 * NEDEN GÜVENLİ (0.4.5 native çökme sınıfı yapısal olarak yok):
 *   - Ana süreçte çalışan saf bir JS kütüphanesi; sayfaya HİÇBİR ŞEY enjekte
 *     etmez, Chrome uzantı API'lerine (declarativeNetRequest, webstorePrivate...)
 *     dokunmaz. Karar webRequest.onBeforeRequest içinde senkron veriliyor.
 *
 * @gorhill/ubo-core bir ES modülü; proje CommonJS olduğu için dinamik import
 * ile yükleniyor (import() CJS'te de çalışır). SNFE tek örnek (singleton).
 */

/*
 * Electron webRequest resourceType -> uBO tip adı.
 *
 * Kaynak türü SNFE için kritik: "$script" kuralı yalnızca script tipini
 * engellemeli, stylesheet'i değil. Bilinmeyen tip 'other'a düşer (uBO'da
 * tür-bağımsız kurallar yine eşleşir, tür-kısıtlı kurallar eşleşmez).
 */
const TIP_ESLEME = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
  other: 'other'
};

let SinifOnbellek = null;

async function motorSinifi() {
  if (!SinifOnbellek) {
    const m = await import('@gorhill/ubo-core');
    SinifOnbellek = m.StaticNetFilteringEngine;
  }
  return SinifOnbellek;
}

class UboMotor {
  constructor() {
    this.snfe = null;
    this.hazir = false;
  }

  /**
   * Ham liste metinlerinden motoru kurar (parse + compile).
   * @param {{name:string, raw:string}[]} listeler
   */
  async listelerdenKur(listeler) {
    const Sinif = await motorSinifi();
    // SNFE süreçte TEK ÖRNEK ("Only a single instance is supported"). Zaten
    // kurulduysa yeni örnek oluşturmuyoruz; aynı motora useLists ile yeni
    // listeleri veriyoruz (useLists mevcut kümeyi değiştirir). Liste/ayar
    // değişiminde de bu yol kullanılıyor.
    if (!this.snfe) this.snfe = await Sinif.create();
    await this.snfe.useLists(listeler.map((l) => ({ name: l.name, raw: l.raw })));
    this.hazir = true;
    return this;
  }

  /**
   * Serileştirilmiş "selfie"den hızlı kurar (parse etmeden). Liste değişince
   * selfie geçersizleşir; yeniden üretilmeli.
   */
  async selfiedenKur(selfie) {
    const Sinif = await motorSinifi();
    const snfe = await Sinif.create();
    await snfe.deserialize(selfie);
    this.snfe = snfe;
    this.hazir = true;
    return this;
  }

  async selfieUret() {
    return this.hazir ? this.snfe.serialize() : '';
  }

  /**
   * Bir isteğin kararı.
   * @returns {0|1|2} 0 = eşleşme yok · 1 = ENGELLE · 2 = istisna (izin)
   */
  eslesme(originURL, url, resourceType) {
    if (!this.hazir) return 0;
    const type = TIP_ESLEME[resourceType] || 'other';
    try {
      return this.snfe.matchRequest({ originURL, url, type });
    } catch (e) {
      return 0;
    }
  }

  // Son eşleşmenin ayrıntısı (hangi kural, hangi liste) - tanı/log için.
  sonKayit() {
    try { return this.hazir ? this.snfe.toLogData() : null; } catch (e) { return null; }
  }
}

module.exports = { UboMotor, TIP_ESLEME, motorSinifi };
