'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/*
 * Favicon önbelleği.
 *
 * Site simgeleri doğrudan uzak adresten <img src> ile yüklenmiyor: arayüz
 * penceresi ayrıcalıklı olduğu için orada saldırgan kontrolündeki baytları
 * çözmek istemiyoruz, ayrıca her yeni sekme açılışında sitelere istek gitmesi
 * gizlilik vaadine aykırı. Bunun yerine simge bir kez gezinti oturumundan
 * (engelleyici + DNT geçerli) indirilip diske yazılıyor ve arayüze
 *
 *     pusula-favicon://<alanadi>
 *
 * şemasıyla sunuluyor. Böylece sekme şeridi, yer imleri çubuğu ve yeni sekme
 * sayfası aynı yerel kopyayı kullanıyor.
 */

const SEMA = 'pusula-favicon';
const EN_BUYUK_BAYT = 128 * 1024;
const TAZELEME_MS = 14 * 24 * 60 * 60 * 1000;   // iki haftada bir yeniden çek

// İçerik türü -> uzantı. Listede olmayan tür kaydedilmez.
const TURLER = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/ico': 'ico'
};
const UZANTI_TURU = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon'
};

// Dosya adı olarak kullanılacağı için alan adı sıkı süzülüyor.
const ALAN_BICIMI = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

/*
 * Sunucunun bildirdiği içerik türü çoğu zaman yanlış: payx.gg /favicon.ico
 * adresinden 1024x1024 bir PNG'yi "image/x-icon" diyerek veriyor. Baytlara
 * bakıp gerçek türü belirliyoruz; yoksa önbellekteki dosya yanlış uzantıyla
 * durur ve yanlış content-type ile geri sunulur.
 */
function turuTespitEt(veri) {
  if (veri.length < 12) return '';
  const b = veri;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'ico';
  const bas = b.toString('utf8', 0, 200).trimStart().toLowerCase();
  if (bas.startsWith('<svg') || bas.startsWith('<?xml')) return 'svg';
  return '';
}

function alanTemiz(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
  return ALAN_BICIMI.test(h) && !h.includes('..') ? h : '';
}

class FaviconDeposu {
  /**
   * @param {object} p
   * @param {string} p.veriDizini  app.getPath('userData')
   * @param {object} p.oturum      indirme için Session
   * @param {Function} [p.degisti] yeni simge kaydedilince çağrılır
   */
  constructor({ veriDizini, oturum, degisti }) {
    this.dizin = path.join(veriDizini, 'faviconlar');
    this.oturum = oturum;
    this.degisti = degisti || (() => {});
    this.kayit = new Map();       // alan -> uzantı
    this.deneniyor = new Set();
    this.basarisiz = new Set();   // bu oturumda tekrar denenmeyecek alanlar
    this._yukle();
  }

  _yukle() {
    try {
      for (const ad of fs.readdirSync(this.dizin)) {
        const nokta = ad.lastIndexOf('.');
        if (nokta <= 0) continue;
        const alan = ad.slice(0, nokta);
        const uzanti = ad.slice(nokta + 1);
        if (alanTemiz(alan) && UZANTI_TURU[uzanti]) this.kayit.set(alan, uzanti);
      }
    } catch { /* dizin henüz yok */ }
  }

  _yol(alan, uzanti) {
    return path.join(this.dizin, alan + '.' + uzanti);
  }

  varMi(alan) {
    return this.kayit.has(alanTemiz(alan));
  }

  // Arayüzde <img src> olarak kullanılacak adres.
  adres(host) {
    const alan = alanTemiz(host);
    return alan && this.kayit.has(alan) ? SEMA + '://' + alan : '';
  }

  async oku(alanHam) {
    const alan = alanTemiz(alanHam);
    const uzanti = alan && this.kayit.get(alan);
    if (!uzanti) return null;
    try {
      return { veri: await fsp.readFile(this._yol(alan, uzanti)), tur: UZANTI_TURU[uzanti] };
    } catch {
      this.kayit.delete(alan);
      return null;
    }
  }

  _tazeMi(alan, uzanti) {
    try {
      const s = fs.statSync(this._yol(alan, uzanti));
      return Date.now() - s.mtimeMs < TAZELEME_MS;
    } catch {
      return false;
    }
  }

  /** Sayfanın bildirdiği favicon adresini indirip saklar. */
  async kaydet(host, faviconUrl) {
    const alan = alanTemiz(host);
    if (!alan || !faviconUrl || this.deneniyor.has(alan)) return;

    const mevcut = this.kayit.get(alan);
    if (mevcut && this._tazeMi(alan, mevcut)) return;

    this.deneniyor.add(alan);
    try {
      const { veri, uzanti } = await this._getir(faviconUrl);
      if (!veri || !uzanti) return;
      await fsp.mkdir(this.dizin, { recursive: true });
      // Tür değiştiyse eski dosya kalmasın.
      if (mevcut && mevcut !== uzanti) {
        fs.rm(this._yol(alan, mevcut), { force: true }, () => {});
      }
      const gecici = this._yol(alan, uzanti) + '.tmp';
      await fsp.writeFile(gecici, veri);
      await fsp.rename(gecici, this._yol(alan, uzanti));
      this.kayit.set(alan, uzanti);
      this.degisti();
    } catch {
      // Simge indirilemedi: arayüz harf rozetine düşer, sorun değil.
    } finally {
      this.deneniyor.delete(alan);
    }
  }

  async _getir(faviconUrl) {
    // Sayfalar simgeyi doğrudan gömebiliyor.
    if (/^data:image\//i.test(faviconUrl)) {
      const m = /^data:([^;,]+)(;base64)?,(.*)$/i.exec(faviconUrl);
      if (!m) return {};
      const uzanti = TURLER[m[1].toLowerCase()];
      if (!uzanti) return {};
      const veri = m[2]
        ? Buffer.from(m[3], 'base64')
        : Buffer.from(decodeURIComponent(m[3]), 'utf8');
      if (!veri.length || veri.length > EN_BUYUK_BAYT) return {};
      return { veri, uzanti: turuTespitEt(veri) || uzanti };
    }

    if (!/^https?:\/\//i.test(faviconUrl)) return {};

    const y = await this.oturum.fetch(faviconUrl, { cache: 'no-cache' });
    if (y.status !== 200) return {};

    const tur = String(y.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    let uzanti = TURLER[tur];
    // Bazı sunucular .ico dosyasını octet-stream olarak veriyor.
    if (!uzanti && /\.ico(\?|$)/i.test(faviconUrl) &&
        (tur === 'application/octet-stream' || tur === '')) {
      uzanti = 'ico';
    }
    if (!uzanti) return {};

    const uzunluk = Number(y.headers.get('content-length') || 0);
    if (uzunluk > EN_BUYUK_BAYT) return {};

    const veri = Buffer.from(await y.arrayBuffer());
    if (!veri.length || veri.length > EN_BUYUK_BAYT) return {};

    // Bildirilen türe değil, baytlara güven.
    const gercek = turuTespitEt(veri);
    if (!gercek) return {};
    return { veri, uzanti: gercek };
  }

  /** Oturuma pusula-favicon:// şemasını bağlar. */
  protokoluBagla() {
    this.oturum.protocol.handle(SEMA, async (istek) => {
      let alan = '';
      try { alan = new URL(istek.url).hostname; } catch { /* bozuk adres */ }
      const kayit = await this.oku(alan);
      if (!kayit) return new Response(null, { status: 404 });
      return new Response(kayit.veri, {
        status: 200,
        headers: {
          'content-type': kayit.tur,
          // Simge değişince arayüz eskisini göstermesin.
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"
        }
      });
    });
  }

  /*
   * Geçmişten gelen siteler için simge henüz yok: bu sayfalar bu kurulumda
   * ziyaret edilmediği için page-favicon-updated hiç tetiklenmedi. Yaygın
   * kural gereği /favicon.ico deniyoruz; başarısız olursa harf rozeti kalır.
   */
  async onIsit(hostlar, esZamanli = 3) {
    const sira = [...new Set(hostlar.map(alanTemiz).filter(Boolean))]
      .filter((a) => !this.kayit.has(a) && !this.basarisiz.has(a) && !this.deneniyor.has(a));

    const isci = async () => {
      while (sira.length) {
        const alan = sira.shift();
        await this.varsayilanDene(alan);
      }
    };
    await Promise.all(Array.from({ length: Math.min(esZamanli, sira.length) }, isci));
  }

  async varsayilanDene(host) {
    const alan = alanTemiz(host);
    if (!alan || this.kayit.has(alan) || this.basarisiz.has(alan) || this.deneniyor.has(alan)) return;
    await this.kaydet(alan, 'https://' + alan + '/favicon.ico');
    if (!this.kayit.has(alan)) this.basarisiz.add(alan);
  }

  temizle() {
    this.kayit.clear();
    this.basarisiz.clear();
    fs.rm(this.dizin, { recursive: true, force: true }, () => {});
  }
}

module.exports = { FaviconDeposu, SEMA, alanTemiz };
