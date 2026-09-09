# browservpn — Girginos Browser VPN arka ucu

Girginos Browser'ın "VPN" özelliğinin sunucu tarafı: **TLS'li HTTP forward
proxy**. Tarayıcı bunu bir `https` proxy olarak kullanır; tarayıcı ↔ sunucu
trafiği TLS ile şifrelenir. Sistem geneli bir TUN tüneli değildir — yalnızca
tarayıcının gezinme oturumu bu proxy'den geçer (WebRTC sızıntısı istemci
tarafında ayrıca kapatılır).

## Neden limit sunucuda?

İstemci açık kaynak; oraya konan bir hız limiti sökülebilir. Bu yüzden
**kullanıcı başına 100 Mbps** üst sınırı burada, sunucuda uygulanır. Her
token'ın *tüm* bağlantıları tek bir `rate.Limiter` paylaşır (12.5 MB/s),
yani "ne olursa olsun aşamasın" gereği sağlanır.

## Kimlik doğrulama — otomatik, kullanıcı girişsiz

Kullanıcı **hiçbir şey yazmaz**. İstemci, cihazın opak kimliğini `/kayit` uç
noktasına gönderir; sunucu gizli anahtarla token üretip döner:

```
token = base64url(HMAC-SHA256(secret, cihaz))
GET https://<domain>/kayit?cihaz=<cihaz>   ->   {"token":"..."}
```

Proxy kimlik doğrulaması `Proxy-Authorization: Basic base64(cihaz:token)`.
Sunucu HMAC'i yeniden hesaplayıp sabit-zaman karşılaştırır — **durumsuz**, token
dosyası yok. Her cihaz = ayrı token = ayrı 100 Mbps kovası. Kayıt açıktır
(kimliksiz); kötüye kullanım denetimi ileride eklenebilir (limit yine her token'ı
100 Mbps'te tutar). `secret` sabittir; değiştirilirse tüm token'lar değişir
(istemci VPN'i her açışında yeniden kaydolur, kendini onarır).

## Derleme

```sh
go mod tidy      # go.sum'ı üretir (x/crypto, x/time)
go build -o browservpn .
sudo install -m 0755 browservpn /usr/local/bin/browservpn
```

## Gizli anahtar (bir kez)

Sunucu `/etc/browservpn/secret` olmadan başlamaz (anahtarsız çalışmak tüm
token'ları geçersiz kılar — sessizce açık proxy olmaktansa hata verir):

```sh
sudo mkdir -p /etc/browservpn
openssl rand -hex 32 | sudo tee /etc/browservpn/secret >/dev/null
sudo chmod 600 /etc/browservpn/secret
```

Anahtar **sabit** tutulmalı; değişirse tüm cihazların token'ı değişir (istemci
otomatik yeniden kaydolur). Döndürürseniz `systemctl kill -s HUP browservpn`.

## TLS

Let's Encrypt sertifikası `autocert` ile otomatik alınır (TLS-ALPN-01, :443).
`domain` sabiti kaynakta tanımlıdır; DNS A kaydı sunucuya işaret etmeli ve 443
dışarıya açık olmalı. **HTTP/2 kapalıdır** (`NextProtos = http/1.1, acme-tls/1`):
HTTP/2 üzerinde `CONNECT` hijack çalışmaz.

## systemd

`/etc/systemd/system/browservpn.service`:

```ini
[Unit]
Description=Girginos Browser VPN proxy
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/browservpn
Restart=always
RestartSec=2
# İleride: root yerine ayrı kullanıcı + AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now browservpn
sudo journalctl -u browservpn -f
```

## Notlar / yol haritası

- Şu an `root` altında çalışıyor; ayrı kullanıcı + `CAP_NET_BIND_SERVICE` daha güvenli.
- Çok lokasyon: her lokasyon ayrı bir sunucu + kendi `domain`'i; istemci kataloğu (`src/vpn.js`) host'u seçer.
- No-log: erişim/bağlantı logu tutulmuyor (yalnızca anahtar yükleme ve hatalar loglanır).
