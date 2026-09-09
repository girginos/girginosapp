'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

/*
 * ÇEREZ KASASI — kalıcı çerezleri diskte ŞİFRELİ tutar.
 *
 * NEDEN: Electron, Chromium'un çerez şifrelemesini devreye almıyor. ÖLÇÜLDÜ:
 * ayırt edici bir çerez yazılıp uygulama kapatıldıktan sonra Cookies
 * veritabanı dışarıdan okundu; değer DÜZ METİN çıktı ve Chromium'un şifreli
 * değer öneki (v10/v11) hiç yoktu. Hem varsayılan oturumda hem persist:
 * bölümünde aynı. Yani kullanıcı hesabıyla çalışan bir bilgi hırsızı dosyayı
 * kopyalayıp bütün oturumları alabiliyordu — bu, Chrome'un DPAPI ile
 * koruduğu durumdan daha zayıftı.
 *
 * ÇÖZÜM: kapanışta kalıcı çerezleri safeStorage (Windows'ta DPAPI) ile
 * şifreleyip kendi dosyamıza yazıyoruz, sonra çerez deposunu boşaltıyoruz;
 * açılışta geri yüklüyoruz. Uygulama KAPALIYKEN diskte düz metin oturum
 * kalmıyor.
 *
 * FAIL-SAFE (sırayla): kasa yaz -> geri okuyup DOĞRULA -> ancak ondan sonra
 * çerezleri sil. Şifreleme kullanılamıyorsa hiçbir şey silinmez: kullanıcıyı
 * oturumlarından etmektense şifresiz bırakmak yeğdir (durum loglanır).
 *
 * KAPSAM: yalnız KALICI çerezler. Oturum çerezleri (session=true) kapanışta
 * zaten ölmeli, onları kasaya almıyoruz.
 */

const KASA_ADI = 'cerez-kasasi.bin';
const BICIM = 1;          // yalnız DPAPI (safeStorage)
const BICIM_PAROLA = 2;   // DPAPI + ana parola (AES-256-GCM)

/*
 * İKİNCİ KATMAN: ANA PAROLA.
 *
 * DPAPI anahtarı MAKİNEDE durur; kullanıcı hesabıyla çalışan bir zararlı onu
 * da kullanabilir. Ana parola ise hiçbir yere yazılmaz - anahtar yalnızca
 * kullanıcının kafasında. Zararlı kasayı kopyalasa elinde çözülemez bayt
 * kalır. İç katman AES-256-GCM: kimlik doğrulamalı, yani kurcalanmış kasa
 * sessizce yanlış veri vermek yerine AÇILMAZ (yanlış parola da böyle anlaşılır,
 * ayrı bir "doğrulayıcı" alanı tutmaya gerek yok).
 *
 * Kendi şifreleme algoritmamızı YAZMIYORUZ: Node'un yerleşik scrypt + AES-GCM
 * ilkeleri standart biçimde birleştiriliyor. Kripto yazmak, kripto kullanmaktan
 * çok daha kolay yanlış yapılır.
 */
const KDF = { ad: 'scrypt', N: 1 << 17, r: 8, p: 1, uzunluk: 32 };   // ~280 ms (ölçüldü)
const TUZ_BAYT = 16;
const IV_BAYT = 12;   // GCM için standart

function kasaYolu(veriDizini) {
  return path.join(veriDizini, KASA_ADI);
}

/** Ana paroladan anahtar türetir. Tuz kasada saklanır (gizli değil, tekil olmalı). */
function anahtarUret(parola, tuzB64, kdf = KDF) {
  const tuz = Buffer.from(String(tuzB64 || ''), 'base64');
  if (!tuz.length) throw new Error('tuz yok');
  return crypto.scryptSync(String(parola), tuz, kdf.uzunluk || 32, {
    N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 512 * 1024 * 1024
  });
}

// İç katman: AES-256-GCM ile şifreler; zarf nesnesi döner.
function icKatmanSifrele(duzMetin, anahtar, tuzB64) {
  const iv = crypto.randomBytes(IV_BAYT);
  const s = crypto.createCipheriv('aes-256-gcm', anahtar, iv);
  const govde = Buffer.concat([s.update(duzMetin, 'utf8'), s.final()]);
  return {
    kdf: { ad: KDF.ad, N: KDF.N, r: KDF.r, p: KDF.p, uzunluk: KDF.uzunluk, tuz: tuzB64 },
    iv: iv.toString('base64'),
    etiket: s.getAuthTag().toString('base64'),
    govde: govde.toString('base64')
  };
}

// İç katmanı çözer. Yanlış parolada/kurcalanmışsa FIRLATIR (GCM doğrulaması).
function icKatmanCoz(zarf, anahtar) {
  const c = crypto.createDecipheriv('aes-256-gcm', anahtar, Buffer.from(zarf.iv, 'base64'));
  c.setAuthTag(Buffer.from(zarf.etiket, 'base64'));
  return Buffer.concat([c.update(Buffer.from(zarf.govde, 'base64')), c.final()]).toString('utf8');
}

/*
 * Chromium'un verdiği çerezi saklanabilir kayda indirger. hostOnly bilgisi
 * KRİTİK: geri yüklerken domain alanını göndermek çerezi "alan çerezi" yapar,
 * göndermemek "yalnız bu host" yapar; ikisi farklı çerezlerdir.
 */
function kayitYap(c) {
  return {
    ad: c.name,
    deger: c.value,
    alan: c.domain || '',
    hostOnly: !!c.hostOnly,
    yol: c.path || '/',
    guvenli: !!c.secure,
    httpOnly: !!c.httpOnly,
    bitis: c.expirationDate,
    ayniSite: c.sameSite
  };
}

// Kayıttan session.cookies.set() argümanı üretir; geçersizse null.
function setArgumani(k, simdiSaniye) {
  if (!k || !k.ad || !k.alan) return null;
  if (typeof k.bitis !== 'number' || k.bitis <= simdiSaniye) return null;   // süresi geçmiş
  const alan = String(k.alan).replace(/^\./, '');
  if (!alan) return null;
  const arg = {
    url: (k.guvenli ? 'https://' : 'http://') + alan + (k.yol || '/'),
    name: k.ad,
    value: k.deger,
    path: k.yol || '/',
    secure: !!k.guvenli,
    httpOnly: !!k.httpOnly,
    expirationDate: k.bitis
  };
  // Alan çerezi ise domain gönderilir; host-only çerezde GÖNDERİLMEZ.
  if (!k.hostOnly) arg.domain = k.alan;
  if (k.ayniSite && k.ayniSite !== 'unspecified') arg.sameSite = k.ayniSite;
  return arg;
}

/**
 * Kalıcı çerezleri şifreleyip kasaya yazar, sonra çerez deposunu boşaltır.
 * @returns {Promise<{yazilan:number, silindi:boolean, sebep?:string}>}
 */
async function disariAktar({ oturum, safeStorage, veriDizini, anahtar = null, tuz = null, gunluk = console }) {
  const yol = kasaYolu(veriDizini);
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    gunluk.error('Çerez kasası: şifreleme kullanılamıyor; çerezler ŞİFRESİZ bırakıldı.');
    return { yazilan: 0, silindi: false, sebep: 'sifreleme-yok' };
  }

  const hepsi = await oturum.cookies.get({});
  const kalici = hepsi.filter((c) => !c.session && typeof c.expirationDate === 'number');
  const kayitlar = kalici.map(kayitYap);

  /*
   * İki katman: anahtar varsa çerezler önce AES-256-GCM ile (ana parola),
   * sonra her hâlükârda safeStorage/DPAPI ile sarılır. Okumak için hem Windows
   * hesabı hem parola gerekir.
   */
  let govde;
  if (anahtar) {
    /*
     * TUZ ANAHTARLA BİRLİKTE GELMELİ. Burada yeni bir tuz üretmek, kasaya
     * anahtarın türetilmediği bir tuzu yazmak olurdu: doğru parola bile kasayı
     * açamazdı (ölçüldü - test tam bunu yakaladı). Tuz gizli değil ama
     * anahtarla eşleşmek zorunda.
     */
    if (!tuz) {
      gunluk.error('Çerez kasası: anahtar var ama tuz yok; çerezler SİLİNMEDİ.');
      return { yazilan: 0, silindi: false, sebep: 'tuz-yok' };
    }
    const zarf = icKatmanSifrele(JSON.stringify({ cerezler: kayitlar }), anahtar, tuz);
    govde = JSON.stringify({ bicim: BICIM_PAROLA, ...zarf });
  } else {
    govde = JSON.stringify({ bicim: BICIM, cerezler: kayitlar });
  }
  const sifreli = safeStorage.encryptString(govde);

  // Atomik yaz: yarım kalmış kasa, sağlam kasanın üstüne geçmesin.
  const gecici = yol + '.tmp';
  await fsp.writeFile(gecici, sifreli);
  await fsp.rename(gecici, yol);

  /*
   * DOĞRULA. Silmeden önce kasanın gerçekten geri okunabildiğini görmeliyiz;
   * yoksa "şifreledim" sanıp kullanıcının bütün oturumlarını silebilirdik.
   */
  let dogrulandi = false;
  try {
    const geri = JSON.parse(safeStorage.decryptString(await fsp.readFile(yol)));
    if (geri && geri.bicim === BICIM_PAROLA) {
      // İç katman da GERÇEKTEN çözülebiliyor mu? Yalnız dış katmanı doğrulamak,
      // parola katmanı bozuksa çerezleri geri getirilemez hâlde silmek olurdu.
      const ic = JSON.parse(icKatmanCoz(geri, anahtar));
      dogrulandi = Array.isArray(ic.cerezler) && ic.cerezler.length === kayitlar.length;
    } else {
      dogrulandi = geri && geri.bicim === BICIM && Array.isArray(geri.cerezler)
        && geri.cerezler.length === kayitlar.length;
    }
  } catch (e) {
    dogrulandi = false;
  }
  if (!dogrulandi) {
    gunluk.error('Çerez kasası doğrulanamadı; çerezler SİLİNMEDİ (veri kaybı olmasın).');
    return { yazilan: kayitlar.length, silindi: false, sebep: 'dogrulanamadi' };
  }

  // Artık güvenle boşaltabiliriz: kalıcı kopya şifreli olarak duruyor.
  await oturum.clearStorageData({ storages: ['cookies'] });
  try { await oturum.cookies.flushStore(); } catch { /* depo zaten kapanıyor olabilir */ }
  return { yazilan: kayitlar.length, silindi: true };
}

/**
 * Kasadaki çerezleri oturuma geri yükler. Kasa yalnızca başarılı geri
 * yüklemeden sonra silinir (yarıda kalırsa bir dahaki açılışta yine denenir).
 * @returns {Promise<{yuklenen:number, atlanan:number, vardi:boolean}>}
 */
async function iceAktar({ oturum, safeStorage, veriDizini, anahtarSagla = null, gunluk = console }) {
  const yol = kasaYolu(veriDizini);
  if (!fs.existsSync(yol)) return { yuklenen: 0, atlanan: 0, vardi: false };
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    gunluk.error('Çerez kasası var ama şifre çözülemiyor; kasa korunuyor.');
    return { yuklenen: 0, atlanan: 0, vardi: true };
  }

  let kayitlar = [];
  try {
    const veri = JSON.parse(safeStorage.decryptString(await fsp.readFile(yol)));
    if (veri && veri.bicim === BICIM_PAROLA) {
      /*
       * Ana parola katmanı. anahtarSagla(kdf) kullanıcıya soracak; iptal
       * ederse (null) kasa OLDUĞU GİBİ bırakılır - silmek, kullanıcının bütün
       * oturumlarını geri getirilemez biçimde yok etmek olurdu.
       */
      if (!anahtarSagla) return { yuklenen: 0, atlanan: 0, vardi: true, parolaGerekli: true };
      const anahtar = await anahtarSagla(veri.kdf, (a) => {
        // Deneme: doğru parola mı? Yanlışsa GCM doğrulaması fırlatır.
        try { JSON.parse(icKatmanCoz(veri, a)); return true; } catch { return false; }
      });
      if (!anahtar) return { yuklenen: 0, atlanan: 0, vardi: true, parolaGerekli: true, atlandi: true };
      kayitlar = JSON.parse(icKatmanCoz(veri, anahtar)).cerezler;
    } else {
      if (!veri || veri.bicim !== BICIM || !Array.isArray(veri.cerezler)) throw new Error('biçim');
      kayitlar = veri.cerezler;
    }
    if (!Array.isArray(kayitlar)) throw new Error('çerez listesi yok');
  } catch (e) {
    gunluk.error('Çerez kasası okunamadı (' + e.message + '); dosya bırakılıyor.');
    return { yuklenen: 0, atlanan: 0, vardi: true };
  }

  const simdi = Math.floor(Date.now() / 1000);
  let yuklenen = 0, atlanan = 0;
  for (const k of kayitlar) {
    const arg = setArgumani(k, simdi);
    if (!arg) { atlanan++; continue; }
    try { await oturum.cookies.set(arg); yuklenen++; } catch { atlanan++; }
  }
  await fsp.rm(yol, { force: true });
  return { yuklenen, atlanan, vardi: true };
}

module.exports = {
  kasaYolu, kayitYap, setArgumani, disariAktar, iceAktar,
  anahtarUret, icKatmanSifrele, icKatmanCoz,
  KASA_ADI, BICIM, BICIM_PAROLA, KDF
};
