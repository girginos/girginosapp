'use strict';

const { LISTE } = require('./blocklist');

// "co.uk", "com.tr" gibi iki seviyeli son ekler; kayıtlanabilir alan adını
// doğru bulmak için gerekli. Tam bir public-suffix listesi değil, yaygın olanlar.
const IKI_SEVIYELI = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr', 'bel.tr', 'k12.tr', 'av.tr',
  'com.au', 'net.au', 'org.au', 'com.br', 'com.cn', 'com.mx', 'com.ar',
  'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.in', 'co.za', 'co.nz', 'com.sg',
  'com.hk', 'com.tw', 'com.my', 'com.ua', 'com.pl', 'com.ru', 'com.es'
]);

// IP ile erişilen adreslerde "kayıtlanabilir alan adı" diye bir şey yoktur;
// son iki okteti kesmek 142.250.185.14 ile 10.0.185.14'ü aynı kovaya atardı.
function ipMi(host) {
  return /^\[[0-9a-f:.]+\]$/i.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function kokAlanAdi(host) {
  if (!host) return '';
  const h = host.toLowerCase().replace(/\.+$/, '');
  if (ipMi(h)) return h;
  const p = h.split('.');
  if (p.length <= 2) return h;
  const son2 = p.slice(-2).join('.');
  if (IKI_SEVIYELI.has(son2) && p.length >= 3) return p.slice(-3).join('.');
  return son2;
}

// Sondaki nokta atılmazsa "izleyici.com." listedeki "izleyici.com" ile
// eşleşmez ve engelleyici tek karakterle atlatılır.
function hostAl(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/\.+$/, ''); } catch { return ''; }
}

class Blocker {
  constructor(store) {
    this.store = store;
    this.liste = new Set(LISTE);
    this.listeler = null;        // indirilen filtre listeleri (ListeYoneticisi)
    this.sayaclar = new Map();   // webContentsId -> engellenen istek sayısı
    this.ustAlan = new Map();    // webContentsId -> sekmedeki üst seviye kök alan adı
    this.birikenToplam = 0;
    this._yazZamanlayici = null;
  }

  get acik() { return this.store.ayarlar.engelleyiciAcik; }

  ustAlanAyarla(wcId, url) {
    const kok = kokAlanAdi(hostAl(url));
    this.ustAlan.set(wcId, kok);
    this.sayaclar.set(wcId, 0);
  }

  sayac(wcId) { return this.sayaclar.get(wcId) || 0; }

  unut(wcId) {
    this.sayaclar.delete(wcId);
    this.ustAlan.delete(wcId);
  }

  // Alan adı ya da üst alan adlarından biri listede mi?
  listede(host) {
    if (this.liste.has(host)) return true;
    let i = host.indexOf('.');
    while (i !== -1) {
      const ust = host.slice(i + 1);
      if (this.liste.has(ust)) return true;
      i = host.indexOf('.', i + 1);
    }
    return false;
  }

  engellensinMi(details) {
    if (!this.acik) return false;
    if (details.resourceType === 'mainFrame') return false;

    const host = hostAl(details.url);
    if (!host) return false;

    const kok = kokAlanAdi(host);
    const wcId = details.webContentsId;
    const ust = wcId != null ? this.ustAlan.get(wcId) : undefined;

    // Birinci taraf istekleri hiç engellenmez: sitenin kendi alan adı çalışsın.
    if (ust && kok === ust) return false;
    // Kullanıcı bu site için engelleyiciyi kapattıysa dokunma.
    if (ust && this.store.siteIzinliMi(ust)) return false;

    // Yerleşik liste her zaman kazanır: indirilen listelerdeki bir istisna
    // kuralı bizim elle seçtiğimiz izleyicileri serbest bırakamasın.
    if (this.listede(host)) return true;
    return this.listeler ? this.listeler.engelleniyorMu(host) : false;
  }

  listeleriBagla(yonetici) {
    this.listeler = yonetici;
  }

  bagla(ses, degisimBildir) {
    ses.webRequest.onBeforeRequest((details, callback) => {
      if (this.engellensinMi(details)) {
        const wcId = details.webContentsId;
        if (wcId != null) this.sayaclar.set(wcId, (this.sayaclar.get(wcId) || 0) + 1);
        this.birikenToplam++;
        this._toplamiYaz(degisimBildir);
        return callback({ cancel: true });
      }
      callback({});
    });

    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      if (this.store.ayarlar.dntGonder) {
        headers['DNT'] = '1';
        headers['Sec-GPC'] = '1';
      }
      callback({ requestHeaders: headers });
    });
  }

  // Sayaç her istekte diske yazılmasın diye biriktir.
  _toplamiYaz(degisimBildir) {
    if (this._yazZamanlayici) return;
    this._yazZamanlayici = setTimeout(() => {
      this._yazZamanlayici = null;
      if (this.birikenToplam > 0) {
        this.store.engellendiSay(this.birikenToplam);
        this.birikenToplam = 0;
      }
      if (degisimBildir) degisimBildir();
    }, 700);
  }
}

module.exports = { Blocker, kokAlanAdi, hostAl, IKI_SEVIYELI };
