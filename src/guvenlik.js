'use strict';

/*
 * Tarayıcı kabuğunun güvenlik kararları.
 *
 * Electron'a bağımlı olmayan saf fonksiyonlar; hepsi test/guvenlik.js içinde
 * saldırgan girdilerle sınanıyor. Bu kararlar main.js'in içine gömülü kalsaydı
 * yalnızca gözle denetlenebilirdi.
 */

// Görünmez yön/kontrol karakterleri: metni ters okutmaya ve uzantı gizlemeye yarar.
const GORUNMEZ_KARAKTER = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/g;

const CALISTIRILABILIR =
  /\.(exe|scr|com|pif|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|reg|lnk|url|cpl|jar|inf|sct|dll|appx|appxbundle|msix)$/i;

// Harici uygulamaya devredilebilecek şemalar. Windows'ta search-ms:, ms-msdt:
// gibi şemalar tek tıkla kod çalıştırma zincirine kapı açtığı için liste dar.
const IZINLI_DIS_SEMA = new Set([
  'mailto:', 'tel:', 'sms:', 'magnet:', 'ftp:', 'ftps:', 'webcal:'
]);

/*
 * Sayfadan gelen gezinme (bağlantı, window.open, bağlam menüsü) yalnızca web
 * şemalarına gidebilir. file: ve chrome: yalnızca kullanıcı adres çubuğuna
 * kendisi yazarsa açılır — sayfanın yerel dosya açtırması engellenir.
 */
function sayfadanGezilebilir(url) {
  return /^https?:\/\//i.test(url) || /^view-source:https?:\/\//i.test(url);
}

function disSemaIzinli(url) {
  try {
    return IZINLI_DIS_SEMA.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/*
 * İndirilen dosya adının normalleştirilmesi. İki tuzak:
 *  - Windows yol çözümlemesinde SONDAKİ nokta ve boşluklar atılır: "evil.exe "
 *    ve "evil.exe." diskte .exe olarak çalışır ama naif bir uzantı kontrolünü
 *    atlatır.
 *  - Görünmez yön karakterleri uzantıyı ters gösterir: "fatura<RLO>gnp.exe"
 *    arayüzde "faturaexe.png" diye okunur.
 */
function indirmeAdiNormalle(ham) {
  const ad = String(ham || '')
    .replace(GORUNMEZ_KARAKTER, '')
    .replace(/[\\/]+/g, '_')
    .replace(/[. \t]+$/, '')
    .trim();
  return ad || 'dosya';
}

function calistirilabilirMi(adVeyaYol) {
  return CALISTIRILABILIR.test(indirmeAdiNormalle(adVeyaYol));
}

/*
 * Dahili sayfa mı? Alt dizi araması yapılırsa indirilen bir "newtab.html" de
 * dahili sayılır ve saldırganın sayfası boş adres çubuğuyla gösterilir.
 * Tam eşleşme şart.
 */
function icSayfaDenetleyici(icSayfaAdresleri) {
  const kume = new Set(icSayfaAdresleri);
  return function icSayfaMi(url) {
    if (!url) return true;
    try {
      const u = new URL(url);
      u.search = '';
      u.hash = '';
      return kume.has(u.href);
    } catch {
      return false;
    }
  };
}

module.exports = {
  GORUNMEZ_KARAKTER,
  CALISTIRILABILIR,
  IZINLI_DIS_SEMA,
  sayfadanGezilebilir,
  disSemaIzinli,
  indirmeAdiNormalle,
  calistirilabilirMi,
  icSayfaDenetleyici
};
