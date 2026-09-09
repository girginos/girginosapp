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

## Kimlik doğrulama

`Proxy-Authorization: Basic base64(kimlik:token)`. Kullanıcı adı (cihaz
kimliği) yok sayılır; yalnızca **parola alanındaki token** doğrulanır. Token'lar
`/etc/browservpn/tokens` dosyasında satır başına bir tane tutulur (`#` ile
başlayan satırlar yorum). Her token = ayrı bir kullanıcı = ayrı 100 Mbps kovası.

## Derleme

```sh
go mod tidy      # go.sum'ı üretir (x/crypto, x/time)
go build -o browservpn .
sudo install -m 0755 browservpn /usr/local/bin/browservpn
```

## TLS

Let's Encrypt sertifikası `autocert` ile otomatik alınır (TLS-ALPN-01, :443).
`domain` sabiti kaynakta tanımlıdır; DNS A kaydı sunucuya işaret etmeli ve 443
dışarıya açık olmalı. **HTTP/2 kapalıdır** (`NextProtos = http/1.1, acme-tls/1`):
HTTP/2 üzerinde `CONNECT` hijack çalışmaz.

## Token yönetimi

```sh
sudo mkdir -p /etc/browservpn
# yeni kullanıcı token'ı üret ve ekle:
openssl rand -hex 16 | sudo tee -a /etc/browservpn/tokens
# çalışan servise dosyayı yeniden okut (restart gerekmez):
sudo systemctl kill -s HUP browservpn
```

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
- No-log: erişim/bağlantı logu tutulmuyor (yalnızca token yükleme sayısı ve hatalar loglanır).
