'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { kokAlanAdi, hostAl } = require('./blocker');

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

/*
 * Simge adresi sayfayla AYNI kayıtlanabilir alan adında mı? Kimlik yalnızca
 * birinci taraf simgeye gönderiliyor; kokAlanAdi engelleyicinin PSL'siyle
 * aynı, yani "google.com" ile "google.com.izleyici.net" birbirine karışmıyor.
 */
function faviconBirinciTarafMi(sayfaHost, faviconUrl) {
  const sayfaKok = kokAlanAdi(String(sayfaHost || '').toLowerCase().replace(/\.+$/, ''));
  const simgeKok = kokAlanAdi(hostAl(faviconUrl));
  return !!sayfaKok && sayfaKok === simgeKok;
}

/*
 * Govdeyi SINIRA KADAR okur, sonra baglantiyi keser.
 *
 * Once arrayBuffer() ile tamami belege aliniyor, boyut ONDAN SONRA
 * denetleniyordu. content-length yoksa (chunked yanit) on denetim de sifir
 * goruyor ve gecip gidiyordu. Olculdu: 600 MB akitan bir sunucu ANA sureci
 * 118 MB'tan 1973 MB'a cikardi - simge adresini sayfa sectigi icin bunu
 * herhangi bir web sayfasi tetikleyebiliyordu ve cokme sandbox'li bir
 * olusturucuyu degil butun tarayiciyi goturuyordu.
 */
async function govdeyiOku(yanit) {
  if (!yanit.body) {
    const b = Buffer.from(await yanit.arrayBuffer());
    return b.length > EN_BUYUK_BAYT ? null : b;
  }
  const okuyucu = yanit.body.getReader();
  const parcalar = [];
  let toplam = 0;
  try {
    for (;;) {
      const { done, value } = await okuyucu.read();
      if (done) break;
      toplam += value.length;
      if (toplam > EN_BUYUK_BAYT) {
        await okuyucu.cancel().catch(() => {});
        return null;
      }
      parcalar.push(Buffer.from(value));
    }
  } catch {
    return null;
  }
  return Buffer.concat(parcalar);
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

  /**
   * Sayfanın bildirdiği favicon adresini indirip saklar.
   * @param {object} [secenek]
   * @param {boolean} [secenek.ziyaretEdildi] Kullanıcı bu sekmeyi gerçekten
   *   açtı mı? Yalnızca o zaman kimlikli istek düşünülür (bkz. _getir).
   */
  async kaydet(host, faviconUrl, secenek = {}) {
    const alan = alanTemiz(host);
    if (!alan || !faviconUrl || this.deneniyor.has(alan)) return;

    const mevcut = this.kayit.get(alan);
    if (mevcut && this._tazeMi(alan, mevcut)) return;

    /*
     * KİMLİKLİ İSTEK YALNIZCA ZİYARET EDİLEN SEKMEDE VE BİRİNCİ TARAF SİMGEDE.
     *
     * Simge ayrı bir session.fetch ile iniyor; 0.4.0'da güvenlik için bu istek
     * çerezsiz yapıldı ama Cloudflare-korumalı siteler (blackhatworld) çerezsiz
     * favicon isteğine 403 "Just a moment" dönüyor: sekme challenge'ı geçip
     * cf_clearance çerezini alıyor, ayrı favicon isteği o çerezi göndermediği
     * için düşüyor ve harf rozetine kalıyordu. Ölçüldü.
     *
     * Çözüm çerezi geri açmak DEĞİL, dar bir istisna: kullanıcının AÇTIĞI
     * sekmede, simge adresi sayfayla AYNI kayıtlanabilir alan adındaysa kimlik
     * gönderiliyor - o siteye zaten kimlikli gidiyoruz, ek maruziyet yok.
     * Üçüncü taraf simge adresi ("<link rel=icon href=izleyici...>") ve açılış
     * ön-ısıtması kimliksiz kalıyor; güvenlik düzeltmesinin amacı korunuyor.
     */
    const birinciTaraf = !!secenek.ziyaretEdildi
      && faviconBirinciTarafMi(host, faviconUrl);

    this.deneniyor.add(alan);
    try {
      const { veri, uzanti } = await this._getir(faviconUrl, birinciTaraf);
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

  async _getir(faviconUrl, kimlikli = false) {
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

    /*
     * VARSAYILAN CEREZSIZ. Simge adresini SAYFA seciyor: tek bir <link
     * rel="icon"> ile herhangi bir siteye kimlikli istek attirilabiliyor ve
     * yanitla yeni cerez yazdirilabiliyordu. Kimlik yalnizca kaydet()'in
     * onayladigi dar durumda gonderiliyor (ziyaret edilen sekme + birinci
     * taraf simge); gerekce orada yazili.
     */
    const y = await this.oturum.fetch(faviconUrl, {
      cache: 'no-cache',
      credentials: kimlikli ? 'include' : 'omit'
    });
    if (y.status !== 200) {
      // Sessiz basarisizligi izlenebilir kil: 403 cogunlukla bot korumasi
      // (Cloudflare "Just a moment") ve harf rozetine dusmenin nedeni bu.
      if (y.status === 403) console.debug('favicon ' + faviconUrl + ': HTTP 403 (bot korumasi olabilir)');
      return {};
    }

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

    const veri = await govdeyiOku(y);
    if (!veri || !veri.length) return {};

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

module.exports = { FaviconDeposu, SEMA, alanTemiz, faviconBirinciTarafMi };
