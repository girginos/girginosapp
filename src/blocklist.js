'use strict';

// Yaygın reklam / izleme / parmak izi alan adları.
// Alt alan adları otomatik kapsanır (örn. "a.doubleclick.net" -> "doubleclick.net").
const LISTE = [
  // Google reklam & ölçümleme
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'adservice.google.com', 'pagead2.googlesyndication.com', 'analytics.google.com',
  '2mdn.net', 'admob.com', 'app-measurement.com', 'crashlytics.com',
  // Meta / Facebook
  'connect.facebook.net', 'graph.facebook.com', 'facebook.net',
  'atdmt.com', 'fbcdn-photos-a.akamaihd.net',
  // Amazon reklam
  'amazon-adsystem.com', 'assoc-amazon.com', 'adsystem.amazon.com',
  // Microsoft / Bing
  'bat.bing.com', 'clarity.ms', 'ads.microsoft.com', 'adnxs.com', 'adnxs-simple.com',
  // Yandex
  'mc.yandex.ru', 'an.yandex.ru', 'yandexadexchange.net', 'metrika.yandex.ru',
  // TikTok / Snap / Twitter / LinkedIn / Pinterest
  'analytics.tiktok.com', 'ads-api.tiktok.com', 'business-api.tiktok.com',
  'sc-static.net', 'tr.snapchat.com', 'ads.linkedin.com', 'px.ads.linkedin.com',
  'analytics.twitter.com', 'ads-twitter.com', 't.co', 'static.ads-twitter.com',
  'ct.pinterest.com',
  // Genel analitik
  'hotjar.com', 'hotjar.io', 'mixpanel.com', 'segment.com', 'segment.io',
  'amplitude.com', 'fullstory.com', 'logrocket.com', 'logrocket.io',
  'heap.io', 'heapanalytics.com', 'quantserve.com', 'quantcast.com',
  'scorecardresearch.com', 'comscore.com', 'chartbeat.com', 'chartbeat.net',
  'parsely.com', 'newrelic.com', 'nr-data.net', 'bugsnag.com',
  'mouseflow.com', 'inspectlet.com', 'crazyegg.com', 'luckyorange.com',
  'statcounter.com', 'histats.com', 'clicky.com', 'getclicky.com',
  'matomo.cloud', 'kissmetrics.com', 'kissmetrics.io', 'woopra.com',
  'sentry-cdn.com', 'branch.io', 'appsflyer.com', 'adjust.com', 'kochava.com',
  'braze.com', 'appboy.com', 'iterable.com', 'customer.io',
  // Reklam ağları / RTB
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'zemanta.com',
  'pubmatic.com', 'rubiconproject.com', 'openx.net', 'openx.com',
  'casalemedia.com', 'indexww.com', 'smartadserver.com', 'sharethrough.com',
  'adform.net', 'adroll.com', 'bidswitch.net', 'lijit.com', 'sovrn.com',
  'triplelift.com', 'districtm.io', 'gumgum.com', 'media.net', 'mgid.com',
  'revcontent.com', 'contentabc.com', 'propellerads.com', 'popads.net',
  'popcash.net', 'adcash.com', 'exoclick.com', 'juicyads.com', 'trafficjunky.com',
  'servedbyadbutler.com', 'adsrvr.org', 'ad-delivery.net', 'adsafeprotected.com',
  'moatads.com', 'doubleverify.com', 'teads.tv', 'spotxchange.com', 'spotx.tv',
  'yieldmo.com', 'nativo.com', 'connatix.com', 'playwire.com', 'adthrive.com',
  'mediavine.com', 'ezoic.net', 'ezodn.com', 'monetizer101.com',
  'improvedigital.com', 'onetag-sys.com', 'yieldlab.net', 'emxdgt.com',
  'rlcdn.com', 'crwdcntrl.net', 'bluekai.com', 'demdex.net', 'everesttech.net',
  'omtrdc.net', 'adobedtm.com', 'krxd.net', 'agkn.com', 'exelator.com',
  'tapad.com', 'eyeota.net', 'liadm.com', 'id5-sync.com', 'pubcid.org',
  'mathtag.com', 'simpli.fi', 'turn.com', 'zeotap.com', 'permutive.com',
  // Push / bildirim spam'i
  'onesignal.com', 'pushwoosh.com', 'pushengage.com', 'sendpulse.com',
  'subscribers.com', 'pushnami.com', 'webpushs.com',
  // Sohbet / widget izleyicileri
  'intercom.io', 'drift.com', 'driftt.com', 'tawk.to', 'livechatinc.com',
  'zopim.com', 'olark.com', 'freshrelevance.com',
  // Parmak izi & bot algılama izleyicileri
  'fingerprintjs.com', 'fpjs.io', 'perimeterx.net', 'px-cloud.net',
  // Türkiye'de yaygın reklam/ölçüm
  'gemius.pl', 'hit.gemius.pl', 'reklamstore.com', 'admatic.com.tr',
  'admost.com', 'netmera.com', 'insider.com.tr', 'useinsider.com',
  'relateddigital.com', 'visilabs.net', 'euromsg.net', 'segmentify.com',
  // Diğer
  'addthis.com', 'sharethis.com',
  'sitescout.com', 'bounceexchange.com', 'wunderkind.co', 'attn.tv',
  'yotpo.com', 'vwo.com', 'optimizely.com',
  'dynamicyield.com', 'monetate.net', 'qualtrics.com', 'foresee.com',
  'usabilla.com', 'medallia.com', 'decibelinsight.com', 'contentsquare.net',
  'quantummetric.com', 'cxense.com', 'lytics.io', 'tealiumiq.com',
  'ensighten.com', 'signal.co', 'blueconic.net'
];

module.exports = { LISTE };
