'use strict';

// Electron gerektirmeyen VPN mantık testi: node test/vpn.js
const vpn = require('../src/vpn');

let gecen = 0;
const hatalar = [];
function esit(ad, bulunan, beklenen) {
  if (Object.is(bulunan, beklenen)) { gecen++; return; }
  hatalar.push(ad + '\n    bulunan:  ' + JSON.stringify(bulunan) + '\n    beklenen: ' + JSON.stringify(beklenen));
}

// Katalog
esit('katalog boş değil', vpn.katalog().length >= 1, true);
esit('katalog host/port sızdırmıyor', 'host' in vpn.katalog()[0], false);
esit('katalog limitMbps taşıyor', vpn.katalog()[0].limitMbps, 100);
// Görünen ad DİLE GÖRE main.js'te kurulur; katalog dil-bağımsız parçaları taşır.
esit('katalog sabit ad taşımıyor (dil dinamik)', 'ad' in vpn.katalog()[0], false);
esit('katalog ülke kodu taşıyor', vpn.katalog()[0].ulke, 'DE');
esit('katalog sunucu sırası taşıyor', vpn.katalog()[0].no, 1);

// sunucuBul / lokasyon doğrulama
esit('geçerli lokasyon bulunur', !!vpn.sunucuBul('de-1'), true);
esit('geçersiz lokasyon null', vpn.sunucuBul('yok-boyle'), null);
esit('lokasyonGecerliMi doğru', vpn.lokasyonGecerliMi('de-1'), true);
esit('lokasyonGecerliMi yanlış', vpn.lokasyonGecerliMi('yok'), false);
esit('lokasyonGecerliMi tip', vpn.lokasyonGecerliMi(5), false);

// vekil kuralı
const k = vpn.vpnVekilKurali('de-1');
esit('kural fixed_servers', k && k.mode, 'fixed_servers');
esit('proxyRules şema taşıyor', /^(https|socks5):\/\//.test(k.proxyRules), true);
esit('yerel adresler bypass', k.proxyBypassRules.includes('127.0.0.1') && k.proxyBypassRules.includes('localhost'), true);

// Geçersiz lokasyon -> ilk sunucuya düşer (null değil), fail-closed'u çağıran yapar
const kf = vpn.vpnVekilKurali('yok-boyle');
esit('geçersiz lokasyon ilk sunucuya düşer', !!kf && kf.mode === 'fixed_servers', true);

// Otomatik kayıt URL'i (kullanıcı token girmez; istemci /kayit'tan alır)
const ku = vpn.vpnKayitUrl('de-1', 'c-abc123');
esit('kayıt URL https', /^https:\/\//.test(ku), true);
esit('kayıt URL /kayit yolu', ku.includes('/kayit?cihaz='), true);
esit('kayıt URL cihaz kimliğini taşır', ku.includes('c-abc123'), true);
esit('kayıt URL cihazı encode eder', vpn.vpnKayitUrl('de-1', 'a b&c').includes('a%20b%26c'), true);
esit('geçersiz lokasyon ilk sunucuya düşer (kayıt)', /^https:\/\/[^/]+\/kayit/.test(vpn.vpnKayitUrl('yok', 'c-x')), true);

if (hatalar.length) {
  console.error('\nBAŞARISIZ (' + hatalar.length + '):\n');
  for (const h of hatalar) console.error('  ✗ ' + h + '\n');
  console.error(gecen + ' test geçti, ' + hatalar.length + ' test kaldı.');
  process.exit(1);
}
console.log('✓ ' + gecen + ' testin hepsi geçti.');
