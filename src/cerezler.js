'use strict';

/*
 * Çerez kararları.
 *
 * Buradaki her şey saf: ağ, oturum ya da Electron yok. Karar mantığı test
 * edilebilir kalsın diye ayrıldı; bağlama işi main.js ve blocker.js'te.
 *
 * BİLİNEN SINIR: "aynı taraf" kararı kokAlanAdi() ile veriliyor ve o tam bir
 * Public Suffix List kullanmıyor. `github.io` gibi barındırma alanlarında iki
 * FARKLI kullanıcının siteleri aynı taraf sayılır, yani orada üçüncü taraf
 * çerez engellemesi olması gerekenden gevşek davranır. Bunu bilerek yazıyoruz;
 * PSL eklenene kadar geçerli.
 */

/**
 * İstek üçüncü taraf mı?
 *
 * Kararsız kalınan durumlarda FALSE dönüyoruz. Sebebi uyumluluk: üst alan adı
 * bilinmiyorsa (ör. sekmeye bağlanamayan bir istek) çerezi kesmek, oturumu
 * sessizce düşürüp siteyi bozar. Emin olmadığımızda dokunmuyoruz.
 */
function ucuncuTarafMi(istekKoku, ustKok) {
  if (!istekKoku || !ustKok) return false;
  return istekKoku !== ustKok;
}

/**
 * Bu istekte çerez taşınmalı mı?
 *
 * @param {object} p
 * @param {string} p.istekKoku   isteğin kayıtlanabilir alan adı
 * @param {string} p.ustKok      sekmedeki sayfanın kayıtlanabilir alan adı
 * @param {boolean} p.engelleAcik  ayar açık mı
 * @param {boolean} p.istisna    kullanıcı bu site için izin verdi mi
 */
function cerezTasinsinMi({ istekKoku, ustKok, engelleAcik, istisna }) {
  if (!engelleAcik) return true;
  if (istisna) return true;
  return !ucuncuTarafMi(istekKoku, ustKok);
}

/**
 * Kapanışta hangi çerezler silinecek?
 *
 * Korunan alan adları ve onların alt alan adları kalır; gerisi silinir.
 * Çerez alan adları başında nokta taşıyabilir (".ornek.com"), o yüzden
 * karşılaştırmadan önce normalleştiriyoruz.
 *
 * @param {Array<{domain: string, name: string, path: string, secure: boolean}>} cerezler
 * @param {Set<string>|Array<string>} korunanKokler  kayıtlanabilir alan adları
 * @param {(host: string) => string} kokBul          kokAlanAdi işlevi
 */
function silinecekCerezler(cerezler, korunanKokler, kokBul) {
  const korunan = korunanKokler instanceof Set ? korunanKokler : new Set(korunanKokler || []);
  const cikti = [];
  for (const c of cerezler || []) {
    const alan = String((c && c.domain) || '').replace(/^\./, '').toLowerCase();
    if (!alan) continue;
    if (korunan.has(kokBul(alan))) continue;
    cikti.push(c);
  }
  return cikti;
}

/**
 * Bir çerezi silmek için gereken URL. Electron cookies.remove(url, name)
 * istiyor ve URL'in şeması çerezin secure bayrağıyla uyuşmalı; uyuşmazsa
 * silme sessizce hiçbir şey yapmaz.
 */
function cerezSilmeUrl(cerez) {
  const alan = String((cerez && cerez.domain) || '').replace(/^\./, '');
  if (!alan) return null;
  const sema = cerez && cerez.secure ? 'https' : 'http';
  const yol = (cerez && cerez.path) || '/';
  return sema + '://' + alan + yol;
}

module.exports = { ucuncuTarafMi, cerezTasinsinMi, silinecekCerezler, cerezSilmeUrl };
