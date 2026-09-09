'use strict';

/*
 * PROXY KİMLİKLİ İSTEK (net.request üstünde fetch benzeri).
 *
 * Neden: session.fetch, proxy 407 döndüğünde ne app 'login' olayını ne de
 * başka bir kimlik yolunu tetikliyor; VPN (kimlikli proxy) açıkken güncelleme
 * manifesti, filtre listeleri ve favicon'lar sessizce "HTTP 407" ile
 * düşüyordu. Chromium'un ClientRequest'i ise proxy kimliğini kendi 'login'
 * olayıyla soruyor. Bu yardımcı o olayı bağlar ve fetch'e benzer küçük bir
 * yanıt nesnesi döner; çağıran taraf kodu neredeyse aynı kalır.
 *
 * kimlikVer(authInfo) -> [kullanici, parola] | null. null dönerse kimlik
 * verilmez (istek 407 ile biter) — sitelerin kendi HTTP-auth'una ASLA
 * karışmayız: yalnızca authInfo.isProxy için çağrılır.
 */

const { net } = require('electron');

const VARSAYILAN_ZAMAN_ASIMI = 30000;

/**
 * @param {Electron.Session} oturum
 * @param {string} url
 * @param {{headers?:object, method?:string, zamanAsimi?:number, cache?:string}} [secenekler]
 * @param {(authInfo:object)=>(string[]|null)} [kimlikVer]
 * @returns {Promise<{ok:boolean,status:number,headers:object,text:()=>Promise<string>,json:()=>Promise<any>,arrayBuffer:()=>Promise<ArrayBuffer>}>}
 */
function vekilliFetch(oturum, url, secenekler = {}, kimlikVer = null) {
  return new Promise((coz, reddet) => {
    let bitti = false;
    const bitir = (fn, v) => { if (!bitti) { bitti = true; clearTimeout(sayac); fn(v); } };
    const sayac = setTimeout(() => bitir(reddet, new Error('zaman aşımı (' + url + ')')), secenekler.zamanAsimi || VARSAYILAN_ZAMAN_ASIMI);

    let req;
    try {
      req = net.request({ url, method: secenekler.method || 'GET', session: oturum, useSessionCookies: false });
    } catch (e) { return bitir(reddet, e); }

    for (const [k, v] of Object.entries(secenekler.headers || {})) req.setHeader(k, String(v));
    if (secenekler.cache === 'no-store' || secenekler.cache === 'no-cache') req.setHeader('Cache-Control', 'no-cache');

    req.on('login', (authInfo, cb) => {
      const k = authInfo && authInfo.isProxy && kimlikVer ? kimlikVer(authInfo) : null;
      if (Array.isArray(k) && k.length === 2) cb(String(k[0]), String(k[1]));
      else cb();   // kimlik yok: Chromium isteği 407 ile sonlandırır
    });
    req.on('error', (e) => bitir(reddet, e));
    req.on('response', (res) => {
      const parcalar = [];
      res.on('data', (d) => parcalar.push(Buffer.from(d)));
      res.on('error', (e) => bitir(reddet, e));
      res.on('end', () => {
        const govde = Buffer.concat(parcalar);
        const status = res.statusCode;
        bitir(coz, {
          ok: status >= 200 && status < 300,
          status,
          headers: res.headers || {},
          text: async () => govde.toString('utf8'),
          json: async () => JSON.parse(govde.toString('utf8')),
          arrayBuffer: async () => govde.buffer.slice(govde.byteOffset, govde.byteOffset + govde.byteLength)
        });
      });
    });
    req.end();
  });
}

module.exports = { vekilliFetch };
