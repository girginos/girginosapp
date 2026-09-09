'use strict';

/*
 * ADRES YÜKLEMLERİ — özel/yerel hedef tanıma.
 *
 * BAĞIMSIZ MODÜL: hem favicon iç-ağ koruması hem HTTPS zorlama buna ihtiyaç
 * duyuyor. faviconlar.js içinde bırakılınca
 * faviconlar -> blocker -> https-zorla -> faviconlar döngüsü oluştu ve
 * kokAlanAdi yarı yüklenmiş modülden undefined geldi (ölçüldü: TypeError).
 * Burada hiçbir yerel modüle bağımlılık YOK; döngü bu yüzden kurulamaz.
 */

function ipv4Ozel(ip) {
  const p = ip.split('.');
  if (p.length !== 4) return false;
  const s = p.map(Number);
  if (s.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = s;
  return a === 0 || a === 10 || a === 127                    // bu ağ, özel, loopback
    || (a === 100 && b >= 64 && b <= 127)                    // CGNAT
    || (a === 169 && b === 254)                              // link-local (bulut meta verisi)
    || (a === 172 && b >= 16 && b <= 31)                     // özel
    || (a === 192 && (b === 168 || b === 0))                 // özel / IETF protokol
    || (a === 198 && (b === 18 || b === 19))                 // kıyaslama
    || a >= 224;                                             // çoklu yayın + ayrılmış
}

function ipv6Ozel(ip) {
  const h = ip.replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '::') return true;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (m) return ipv4Ozel(m[1]);                              // IPv4 eşlemeli
  return /^f[cd]/.test(h) || /^fe[89ab]/.test(h);            // benzersiz yerel / link-local
}

function adresOzelMi(ip) {
  const h = String(ip || '').toLowerCase();
  if (!h) return false;
  return h.includes(':') ? ipv6Ozel(h) : ipv4Ozel(h);
}

// Çözümlemeye gerek olmayan yerel adlar (mDNS / intranet son ekleri).
const YEREL_AD = /(^|\.)(localhost|local|internal|intranet|home\.arpa)$/i;

function yerelAdMi(host) {
  const h = String(host || '').toLowerCase().replace(/\.+$/, '');
  return !!h && YEREL_AD.test(h);
}

module.exports = { adresOzelMi, yerelAdMi, ipv4Ozel, ipv6Ozel };
