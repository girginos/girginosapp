#!/usr/bin/env python3
"""
Uygulama simgesini ve site favicon'larını marka logosundan üretir.

    python scripts/simge-uret.py [kaynak.png]

Varsayılan kaynak: yapi-kaynaklari/logo.png (saydam zeminli kare PNG)

Üretilenler:
    yapi-kaynaklari/icon.ico      electron-builder buradan alır (exe + kurulum)
    yapi-kaynaklari/site/         site için favicon dosyaları

Neden bu kadar uğraş: logoyu doğrudan 16 piksele küçültmek okunmaz bir leke
bırakıyor. İki şey yapıyoruz — (1) saydam kenar boşluğunu kırpıp işareti
kareye oturtuyoruz, (2) küçük boyutlarda dış parıltıdan pay vermeyip işaretin
çerçeveyi doldurmasını sağlıyoruz.
"""

import os
import sys
from PIL import Image

# (boyut, kenar_payi) — pay, kırpılmış kareye eklenen boşluk oranı.
# Küçük boyutlarda pay sıfır: işaret çerçeveyi tamamen doldursun.
BOYUTLAR = [
    (256, 0.02), (128, 0.02), (64, 0.015), (48, 0.01),
    (32, 0.0), (24, 0.0), (16, 0.0),
]

SITE_PNG = [512, 192, 180, 32, 16]      # PWA, apple-touch, klasik
SITE_ICO = [48, 32, 16]


def kirp(im):
    """Saydam kenar boşluğunu atar, sonucu kareye tamamlar."""
    kutu = im.getbbox()
    if kutu:
        im = im.crop(kutu)
    en, boy = im.size
    kenar = max(en, boy)
    kare = Image.new('RGBA', (kenar, kenar), (0, 0, 0, 0))
    kare.paste(im, ((kenar - en) // 2, (kenar - boy) // 2))
    return kare


def olcekle(kare, boyut, pay):
    """Payı ekleyip istenen boyuta indirger."""
    kenar = kare.size[0]
    dolgu = int(kenar * pay)
    if dolgu:
        tuval = Image.new('RGBA', (kenar + dolgu * 2,) * 2, (0, 0, 0, 0))
        tuval.paste(kare, (dolgu, dolgu))
    else:
        tuval = kare
    return tuval.resize((boyut, boyut), Image.LANCZOS)


def main():
    kok = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    kaynak = sys.argv[1] if len(sys.argv) > 1 else os.path.join(kok, 'yapi-kaynaklari', 'logo.png')
    if not os.path.exists(kaynak):
        sys.exit('Kaynak bulunamadi: ' + kaynak)

    ham = Image.open(kaynak).convert('RGBA')
    kare = kirp(ham)
    print('kaynak %s -> kirpilmis %s' % (ham.size, kare.size))

    hedef = os.path.join(kok, 'yapi-kaynaklari')
    os.makedirs(hedef, exist_ok=True)

    kareler = [olcekle(kare, b, p) for b, p in BOYUTLAR]
    ico = os.path.join(hedef, 'icon.ico')
    kareler[0].save(ico, format='ICO',
                    sizes=[(b, b) for b, _ in BOYUTLAR],
                    append_images=kareler[1:])
    print('yazildi:', ico, '(%d bayt)' % os.path.getsize(ico))

    # --- site varlıkları ---
    site = os.path.join(hedef, 'site')
    os.makedirs(site, exist_ok=True)
    for b in SITE_PNG:
        yol = os.path.join(site, 'favicon-%d.png' % b)
        olcekle(kare, b, 0.02 if b >= 180 else 0.0).save(yol)
        print('  ', yol)

    site_kareler = [olcekle(kare, b, 0.0) for b in SITE_ICO]
    site_ico = os.path.join(site, 'favicon.ico')
    site_kareler[0].save(site_ico, format='ICO',
                         sizes=[(b, b) for b in SITE_ICO],
                         append_images=site_kareler[1:])
    print('  ', site_ico)

    onizleme = os.environ.get('SIMGE_ONIZLEME')
    if onizleme:
        os.makedirs(onizleme, exist_ok=True)
        for k, (b, _) in zip(kareler, BOYUTLAR):
            k.save(os.path.join(onizleme, 'simge-%d.png' % b))
        print('onizleme:', onizleme)


if __name__ == '__main__':
    main()
