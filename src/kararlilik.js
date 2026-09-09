'use strict';

/*
 * KARARLILIK YAMASI: chrome.webstorePrivate KÖRLEME.
 *
 * chromewebstore.google.com (ve bazı Google sayfaları) açılır açılmaz
 * chrome.webstorePrivate.getReferrerChain() çağırıyor. Electron bu özel
 * uzantı-mağazası API'sini uygulamadığı için çağrı tarayıcı (ana) süreçte
 * NATIVE çöküyor (0xC0000005) ve tüm uygulama kapanıyor.
 *
 * KANIT: çöken minidump sembolize edildi ->
 *   extensions::WebstorePrivateGetReferrerChainFunction::Run()
 * (Girginos Browser.exe +0x721c52d, browser süreci). Temiz profilde ve adblock
 * TAMAMEN kapalıyken bile çöküyordu; yani suçlu adblock değil, bu eksik API.
 *
 * ÇÖZÜM: sayfanın kendi script'lerinden ÖNCE ana dünyaya girip
 * chrome.webstorePrivate'in tüm metotlarını zararsız birer noop ile
 * değiştiriyoruz. Bu özel API yalnızca Google'ın kendi mağaza sayfalarınca
 * kullanılıyor; sıradan siteler ona dokunmuyor. Electron mağazadan uzantı
 * kuramadığı için körlemek hiçbir gerçek işlevi kaybettirmiyor - yalnızca
 * çökme engelleniyor. Canlı testte 3/3 doğrulandı.
 *
 * Fonksiyon .toString() ile string'e çevrilip preload'a gömülüyor: preload
 * sandbox'ında yerel modül require edilemiyor. Fonksiyon KENDİ İÇİNDE KAPALI
 * olmalı - preload kapsamındaki hiçbir şeye erişemez.
 */
function webstoreStubKodu() {
  'use strict';
  if (window.__pusulaWebstoreStub) return;

  function noop() {
    var a = arguments;
    var cb = a.length ? a[a.length - 1] : null;
    if (typeof cb === 'function') { try { cb([]); } catch (e) { /* geç */ } }
    return undefined;
  }

  function körle(wp) {
    try {
      for (var k in wp) {
        if (typeof wp[k] === 'function') {
          try {
            Object.defineProperty(wp, k, { value: noop, configurable: true, writable: true });
          } catch (e) {
            try { wp[k] = noop; } catch (_) { /* geç */ }
          }
        }
      }
    } catch (e) { /* geç */ }
    try { wp.getReferrerChain = noop; } catch (e) { /* geç */ }
  }

  try {
    if (window.chrome && window.chrome.webstorePrivate) körle(window.chrome.webstorePrivate);
  } catch (e) { /* geç */ }

  /*
   * chrome bazen sayfa script'ince GEÇ atanıyor; get/set tuzağıyla her erişimde
   * webstorePrivate'ı yeniden körlüyoruz. get/set gerçek nesneyi olduğu gibi
   * geçiriyor - yalnızca körleme kancası ekliyor, davranışı değiştirmiyor.
   */
  try {
    var gerçek = window.chrome;
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      get: function () { if (gerçek && gerçek.webstorePrivate) körle(gerçek.webstorePrivate); return gerçek; },
      set: function (v) { gerçek = v; try { if (v && v.webstorePrivate) körle(v.webstorePrivate); } catch (e) { /* geç */ } }
    });
  } catch (e) { /* geç */ }

  window.__pusulaWebstoreStub = 1;
}

const WEBSTORE_STUB_KODU = '(' + webstoreStubKodu.toString() + ')();';

/*
 * PRELOAD KAYNAĞI ÜRETİLİYOR (require edilmiyor).
 *
 * main.js bu metni diske yazıp session.registerPreloadScript ile ('frame' tipi)
 * oturuma bağlıyor. Preload sandbox'ta çalışır, yalnızca electron'a dayanır;
 * ana dünya kodunu webFrame.executeJavaScript(..., false) ile SAYFA
 * SCRIPT'LERİNDEN ÖNCE ana dünyaya geçirir. Üst ve alt çerçeveler (http/https)
 * için çalışır - mağaza çağrısı bir iframe'den de gelebilir.
 */
function kararlilikPreloadKaynagi() {
  return [
    "'use strict';",
    "const { webFrame } = require('electron');",
    'try {',
    "  if (/^https?:$/.test(location.protocol)) {",
    '    // false = ana dünya (izole dünya değil).',
    '    webFrame.executeJavaScript(' + JSON.stringify(WEBSTORE_STUB_KODU) + ', false);',
    '  }',
    '} catch (e) {',
    "  try { console.debug('kararlilik preload:', e && e.message); } catch (_) { /* geç */ }",
    '}',
    ''
  ].join('\n');
}

module.exports = { webstoreStubKodu, WEBSTORE_STUB_KODU, kararlilikPreloadKaynagi };
