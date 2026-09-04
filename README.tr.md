# Girginos Browser

Gizlilik odaklı masaüstü web tarayıcısı. 11 dilde arayüz.

Sayfa oluşturma motoru **Chromium** (Electron üzerinden); tarayıcının kendisi —
sekme yönetimi, adres çubuğu, filtre listesi altyapısı, geçmiş, yer imleri,
indirmeler, izin akışı ve tüm arayüz — bu depodaki kodla yazıldı.

## Çalıştırma

```bash
npm install
npm start
```

Testler (Electron gerektirmez, saniyeler sürer):

```bash
npm test
```

`test/dogrula.js` adres çözümleme ve engelleyici mantığını; `test/guvenlik.js`
saldırgan girdilerle güvenlik regresyonlarını; `test/guncelleme.js`
güncelleme imzası/sürüm/özet doğrulamasını; `test/sozlesme.js` arayüz–ana süreç
IPC/DOM sözleşmesini ve 11 dil dosyasının anahtar bütünlüğünü doğrular.

## Neler var

| Alan | Durum |
| --- | --- |
| Sekmeler | Aç/kapat/geç, orta tıkla kapatma, favicon, yükleme göstergesi |
| Adres çubuğu | Adres/arama ayrımı, geçmişten öneri, klavye ile gezinme |
| Arama motoru | DuckDuckGo (varsayılan), Google, Yandex, Bing, Startpage, Brave |
| Engelleyici | 213 yerleşik alan adı + EasyList & EasyPrivacy (~96.000 alan adı) |
| Filtre listeleri | Otomatik güncelleme, kendi listeni ekleme, çevrimdışı önbellek |
| Gizlilik | DNT + Sec-GPC, izin türü başına genel karar, veri ve izin temizleme |
| Yeni sekme | Arama, sık gidilen siteler, kısayollar, tanıtım alanı |
| Geçmiş | Arama, gün başlıkları, tek tuşla temizleme (kayıt kapatılabilir) |
| Yer imleri | Ctrl+D, yer imleri çubuğu, panel |
| İndirmeler | Araç çubuğunda son 10 indirme menüsü, çalıştırılabilir dosya uyarısı |
| Sayfada bul | Ctrl+F, ileri/geri, eşleşme sayacı |
| Site simgeleri | Bir kez indirilip yerel önbellekten sunulur, uzak istek yok |
| Güncelleme | Ed25519 ile imzalı yayın manifesti, otomatik denetim, kanal seçimi |
| Diller | Türkçe, English, Deutsch, Français, Español, Italiano, Português, Русский, العربية (RTL), 简体中文, 日本語 |

## Kısayollar

`Ctrl+T` yeni sekme · `Ctrl+W` sekmeyi kapat · `Ctrl+Tab` sekme geç · `Ctrl+1..9` sekmeye git
`Ctrl+L` adres çubuğu · `Ctrl+F` sayfada bul · `Ctrl+R` yenile · `Alt+←/→` geri/ileri
`Ctrl+D` yer imi · `Ctrl+H` geçmiş · `Ctrl+J` indirmeler · `Ctrl+Shift+B` yer imleri çubuğu
`Ctrl+,` ayarlar · `Ctrl+ +/-/0` yakınlaştırma · `F11` tam ekran · `Ctrl+Shift+I` geliştirici araçları

## Dosya düzeni

```
main.js              ana süreç: pencere, sekmeler, menü, oturum, IPC
preload.js           arayüz ile ana süreç arasındaki güvenli köprü
src/urls.js          adres çubuğu girdisini adrese/aramaya çevirme
src/store.js         ayarlar, geçmiş, yer imleri, izinler (JSON)
src/blocker.js       istek engelleme kararı ve sayaçlar
src/blocklist.js     yerleşik reklam/izleme alan adları
src/listeler.js      filtre listesi indirme, ayrıştırma, önbellek, zamanlama
src/diller/          11 dilin çeviri tabloları (tr referans)
src/faviconlar.js    site simgesi önbelleği ve pusula-favicon:// şeması
src/guncelleme.js    güncelleme akışı (electron-updater ile)
src/guncelleme-dogrula.js  imza/sürüm/özet doğrulaması (saf, test edilir)
src/guncelleme-anahtar.js  gömülü açık anahtar ve besleme adresi
src/guvenlik.js      kabuğun güvenlik kararları (şema, dosya adı, dahili sayfa)
scripts/             anahtar üretme ve manifest imzalama araçları
ui/index.html        tarayıcı arayüzü (sekme şeridi, araç çubuğu, paneller)
ui/app.js            arayüz mantığı
ui/style.css         açık/koyu tema, RTL
ui/newtab.html|js    yeni sekme / anasayfa
ui/error.html|js     hata sayfası
test/dogrula.js      saf mantık testleri
test/guvenlik.js     saldırı vektörü regresyonları
test/guncelleme.js   güncelleme doğrulaması testleri
test/sozlesme.js     IPC/DOM sözleşmesi + dil anahtarı denetimi
```

## Filtre listeleri

Varsayılan abonelikler **EasyList** (reklam) ve **EasyPrivacy** (izleyici).
Listeler ilk açılıştan ~15 sn sonra, ardından 6 saatte bir kontrol edilir ve
listenin kendi `! Expires` süresine (genellikle 4 gün) göre yenilenir. İndirme
ayrı ve kalıcı olmayan bir oturumdan yapılır: çerez tutmaz. Ayrıştırılmış hâl
`%APPDATA%/Girginos Browser/listeler/*.json` içinde önbelleklenir, ağ yoksa son iyi kopya
kullanılmaya devam eder. Ayarlar'dan kendi listenizi (Adblock Plus, hosts ya da
düz alan adı biçiminde bir https adresi) ekleyebilirsiniz.

**Ayrıştırıcı kasıtlı olarak seçici:** yalnızca anlamı birebir korunabilen
kurallar alınır — `||alan.com^` ve `||alan.com^$third-party`. Yol kalıpları,
kaynak türü kısıtları (`$script` vb.), `$domain=` bağlamı ve kozmetik filtreler
atlanır; çünkü bunları "her şeyi engelle"ye çevirmek sayfaları bozar. Bugünkü
listelerin yaklaşık %85'i bu süzgeçten geçiyor.

## Mimari ve güvenlik notları

- Her sekme ayrı bir `WebContentsView`; sayfa içerikleri `sandbox: true`,
  `contextIsolation: true`, `nodeIntegration: false` ile çalışır ve **preload almaz**.
- Arayüz penceresi de `sandbox: true` ile ve sekmelerle **aynı oturumda** çalışır;
  favicon istekleri de engelleyiciden ve DNT başlıklarından geçer.
- IPC kanalları yalnızca arayüz penceresinin ana çerçevesinden kabul edilir;
  ayar yazma anahtar/tip doğrulamasından geçer.
- İndirmeler kimlikle adreslenir — arayüzden gelen ham bir dosya yolu hiçbir
  zaman açılmaz. Dosya adındaki görünmez yön karakterleri temizlenir,
  çalıştırılabilir uzantılarda açmadan önce uyarı çıkar.
- Sayfa kaynaklı gezinmeler yalnızca `http(s)` ve `view-source:http(s)`;
  `file:`/`chrome:` yalnızca kullanıcı adres çubuğuna kendisi yazarsa açılır.
- Harici uygulamaya devir dar bir şema listesiyle sınırlı (`mailto:`, `tel:`,
  `sms:`, `magnet:`, `ftp(s):`, `webcal:`) ve aynı anda tek onay kutusu açılır.
- İzin istekleri yalnızca aktif sekmeden kabul edilir; `data:`/`about:` gibi opak
  kaynaklar (origin'i `"null"`) her zaman reddedilir. Bildirim, konum, MIDI, pano
  ve boşta kalma izinleri varsayılan olarak sessizce reddedilir — her biri
  Ayarlar'dan "Sor / İzin ver / Reddet" olarak değiştirilebilir.
- Adres çubuğu, yön değiştirme ve kontrol karakterlerini çözmez, URL içindeki
  kullanıcı adı/parola kısmını göstermez.
- Yeni sekme ve hata sayfaları korumalı ve preload'suz çalışır; gösterecekleri
  her şey (çevrilmiş metinler dahil) adres parametreleriyle verilir, sayfa
  dışarıya hiçbir istek atmaz.
- Site simgeleri arayüzde uzak adresten yüklenmiyor: gezinti oturumundan bir kez
  indirilip diske yazılıyor ve `pusula-favicon://` yerel şemasıyla sunuluyor.
  Bu sayede arayüz penceresinin CSP'si `img-src data: pusula-favicon:` kadar dar
  kalıyor — ayrıcalıklı süreçte saldırgan kontrolündeki görsel çözülmüyor.
- Yazım denetimi kapalı: Chromium sözlükleri Google sunucusundan indiriyor.
- Sayfa görünümü, arayüzün üstünde yerel bir katman olarak çizilir. Bu yüzden
  açılır liste, indirilenler menüsü ve bul çubuğu sayfanın üzerine binmez;
  arayüz akışında yer alır ve açıldıklarında sayfa aşağı kayar.
- Veriler `%APPDATA%/Girginos Browser/pusula-veri.json` altında, geçici dosya + yeniden
  adlandırma ile atomik olarak tutulur.

## Yeni sekme tanıtım alanı

Üçüncü taraf bir reklam ağı **kullanılmıyor** — kendi engelleyicimiz zaten
keserdi ve gizlilik vaadiyle çelişirdi. Kartlar `pusula-veri.json` içindeki
`ayarlar.duyurular` dizisinden okunur: `{ etiket, baslik, metin, url }`.
Sayfa bu veriyi yerelden alır, hiçbir yere istek atmaz.

## Güncelleme sistemi

Kurulu sürüm kendini günceller; kullanıcının her seferinde yeni kurulum
indirmesi gerekmez. Tehdit modeli **güncelleme sunucusunun ele geçirilmiş
olabileceğini** varsayar.

electron-updater indirme ve kurulumu yapar, ama önüne imzalı bir kapı konuldu:

1. `pusula-guncelleme.json` ve yanındaki `.imza` dosyası çekilir.
2. İmza, uygulamaya gömülü **Ed25519** açık anahtarıyla, manifestin **ham
   baytları** üzerinde doğrulanır. Geçmezse hiçbir alan okunmaz.
3. Sürüm kontrolleri: geri sürüme düşürme reddedilir, manifestin kendi son
   kullanma tarihi geçmişse reddedilir (eski bir manifesti sonsuza dek servis
   edip güncellemeyi dondurma saldırısına karşı), gerekiyorsa ara sürüm zorunlu
   tutulur, indirme adresi https olmak zorundadır.
4. electron-updater'ın bulduğu sürüm ve paket özeti, imzalı manifesttekiyle
   birebir aynı olmalıdır.
5. İndirme bitince paketin sha512'si imzalı özetle sabit zamanlı karşılaştırılır.
6. Kurulum yalnızca kullanıcı onayıyla başlar.

Herhangi bir adım başarısızsa güncelleme yapılmaz. Özel anahtar hiçbir zaman
sunucuda durmaz; sunucu ele geçse bile saldırgan geçerli bir manifest üretemez.

### Etkinleştirme

```bash
npm run anahtar-uret                 # Ed25519 çifti üretir
# açık anahtarı src/guncelleme-anahtar.js icindeki ACIK_ANAHTARLAR dizisine ekleyin
# FEED_ADRESI'ni ve package.json > build.publish.url'i kendi https adresinizle doldurun
```

Yayın çıkarma:

```bash
npm run paket                        # dagitim/ altına kurulum paketleri
npm run manifest-imzala -- --anahtar ~/pusula-yayin-anahtari.pem   --indirme https://browserapp.girginos.app/pusula
npm run yayin-dogrula -- ~/pusula-yayin-anahtari.pem   # yüklemeden önce son kontrol
```

`yayin-dogrula` üretilen çıktıların üzerinde uygulamanın güncelleme kapısını
baştan sona çalıştırır: paketin diskteki gerçek sha512'si, `latest.yml` ile
imzalı manifestin aynı paketi göstermesi, imzanın tutması, kurcalanmış
manifestin ve değiştirilmiş indirme adresinin reddedilmesi, geri sürüm ve
süresi geçmiş manifest kapıları. Bir yayını sunucuya koymadan önce buradan
geçirin.

Üretilen `dagitim/` içeriğini (kurulum paketleri, `latest.yml`,
`pusula-guncelleme.json`, `pusula-guncelleme.json.imza`) besleme adresine
yükleyin.

Üretilen kurulum paketi **kod imzasızdır**: Windows SmartScreen ilk
çalıştırmada uyarı gösterir. Bu beklenen davranış, sertifika alınana kadar
sürer.

Windows'ta kod imzalama sertifikanız varsa `src/guncelleme-anahtar.js` içindeki
`YAYINCI_ADI` alanını doldurun: electron-updater indirilen kurulum dosyasının
kod imzasını da bu yayıncıya karşı doğrular.

### Anahtar değişimi

`ACIK_ANAHTARLAR` bir dizi. Yeni anahtarı listeye ekleyip **eski anahtarla**
imzalanmış bir sürüm yayınlayın; kullanıcılar o sürüme geçtikten sonra eski
anahtarı listeden çıkarın.

## Güvenlik denetimi

Bir tarayıcının saldırı yüzeyi ikiye ayrılır ve ikisi çok farklı davranır.

**Motor (Chromium/V8/Skia).** 2026'da Chrome'da vahşi doğada sömürülen altı
zero-day dahil onlarca bellek güvenliği açığı kapatıldı. Bunları biz yazmıyoruz
ve düzeltemiyoruz — **tek savunma motoru güncel tutmak.** Bu yüzden şu kural
geçerli: *Girginos Browser asla ömrünü tamamlamış bir Electron sürümüyle yayınlanmaz.*
Electron yalnızca son üç ana sürümü destekler; `package.json` içindeki sürüm
sabiti her yayın öncesi kontrol edilmelidir.

Şu an: **Electron 44.2.0 · Chromium 152.0.7977.76**.

**Kabuk (bu depodaki kod).** Adres çubuğu, izin akışı, indirmeler, şema
geçişleri, dahili sayfalar. Chrome ve Firefox'un 2026'da kapattığı UI
sahteciliği ve indirme koruması açıklarıyla aynı sınıf. `test/guvenlik.js`
bunları saldırgan girdilerle sınıyor:

| Sınıf | Örnek vektör | Karşılık |
| --- | --- | --- |
| Adres çubuğu sahteciliği | RLO/bidi, CR-LF, NUL, boşluk doldurma, `bank.com@evil.com`, IDN homograf | Görünmez karakterler ve boşluk kodlu kalır, kimlik bilgisi gizlenir, punycode gösterilir |
| Alan adı gizleme | `accounts.google.com.giris.evil.com` | Adres çubuğu kayıtlanabilir alanı koyu, gerisini soluk yazar |
| Dahili sayfa taklidi | İndirilen `newtab.html` | Tam adres eşleşmesi; alt dizi araması yok |
| Tam ekran UI sahteciliği | Sayfa tam ekrana geçip sahte araç çubuğu çizer | Sayfa görünümü hiçbir zaman chrome'un üstüne büyütülmez; gerçek adres çubuğu ekranda kalır |
| Şema geçişi | `file:`, `chrome:`, `blob:`, `view-source:file:` | Sayfa kaynaklı gezinmede yalnızca `http(s)` |
| Harici uygulama | `ms-msdt:`, `search-ms:`, `ms-appinstaller:` | Dar allowlist; tek onay kutusu |
| İndirme koruması | `evil.exe ` / `evil.exe.` (Windows sondaki nokta ve boşluğu atar), RLO ile gizlenen uzantı | Uzantı kontrolünden önce normalleştirme; karar diskteki gerçek ada göre |
| Engelleyici atlatma | `izleyici.com.` (sondaki nokta) | Host normalleştirmesi |

Kabuk tarafında **kalan boşluklar**, dürüstlük gereği:

- **Mark-of-the-Web yok.** İndirilen dosyalara `Zone.Identifier` yazılmıyor;
  Windows SmartScreen bu dosyalar için devreye girmiyor. Uyarı kutusu var ama
  işletim sistemi katmanı yok.
- **Kod imzalama sertifikası yok.** Kurulum paketinin kod imzası
  doğrulanamıyor; imzalı manifest bu boşluğu kapatıyor ama sertifika şart.
- **Public Suffix List yok.** `github.io` gibi barındırma alanlarında hem site
  istisnaları hem de adres çubuğu vurgusu olması gerekenden geniş kapsıyor.
- **Sertifika hatası akışı Chromium varsayılanında.** Kullanıcıya özel bir
  "yine de devam et" ekranı yazılmadı; hatalı sertifikada sayfa açılmıyor.

## Bilinen sınırlar

- **Güncelleme varsayılan olarak kapalı.** Mekanizma hazır ama yayın anahtarı ve
  besleme adresi tanımlanana kadar devre dışı (fail-closed). Bkz. "Güncelleme
  sistemi". Ayrıca kod imzalama sertifikası olmadan Windows'ta imza doğrulaması
  yapılamaz; imzalı manifest bu boşluğu kapatır ama sertifika yine de önerilir.
- Tek pencere: sekme durumu tek pencereye bağlı olduğu için "Yeni pencere"
  menüde yok.
- Kök alan adı türetimi tam bir Public Suffix List kullanmıyor; `github.io`,
  `vercel.app` gibi barındırma alanlarında site istisnaları olması gerekenden
  geniş kapsıyor.
- Engelleme yalnızca alan adı düzeyinde: CNAME ile gizlenen izleyiciler ve
  birinci taraf altındaki reklamlar yakalanamaz, kozmetik filtre uygulanmaz.
- Motor güncelliği elle takip ediliyor: Electron sürümü her yayın öncesi
  kontrol edilmeli (bkz. Güvenlik denetimi).
- Tarayıcı eklentisi (WebExtension) desteği yok.
- Sekmeler sürüklenerek yeniden sıralanamıyor, gizli pencere yok.
- Kurulabilir paket üretimi (electron-builder) henüz eklenmedi.

## Lisans

MIT. Ayrıntı için [LICENSE](LICENSE).

Chromium ve Electron kendi lisansları altındadır; kurulum paketindeki
`LICENSES.chromium.html` bu bileşenlerin lisans metinlerini taşır.

## İndirme

Windows için kurulum paketi: <https://girginos.app>

Kurulum paketi henüz kod imzalama sertifikasıyla imzalanmıyor; Windows
SmartScreen ilk çalıştırmada uyarı gösterir. İndirdiğiniz dosyanın
bozulmadığını sitede yayınlanan SHA-256 özetiyle doğrulayabilirsiniz.
