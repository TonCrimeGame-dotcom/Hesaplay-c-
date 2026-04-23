# Hesaplay C

## Public pazar cache yenileme

Vercel uzerindeki function, Trendyol public sayfalarini tararken 403 alabiliyor. Bu durumda cache'i yerelde yenile:

```powershell
cd C:\Users\user\Desktop\code
npm run refresh:market-cache
```

Alternatif:

```powershell
node scripts/refresh-trendyol-market-cache.js
```

Gerekli ortam degiskenleri:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` veya `SUPABASE_SERVICE_ROLE_KEY`

Istersen bunlari `.env.local` dosyasina da koyabilirsin.

Istege bagli ayarlar:

- `MARKET_PAGE_LIMIT`
- `MARKET_DETAIL_LIMIT`
- `MARKET_TERMS`
- `MARKET_CATEGORY_SLUGS`
- `MARKET_DEBUG=1`

## Tarayicidan import fallback

Trendyol bazen Node/PowerShell uzerinden gelen istekleri bos donduruyor veya blokluyor. Bu durumda kendi tarayici oturumundan urunleri cache'e basabilirsin.

1. Trendyol'da bir arama ya da kategori sayfasi ac.
2. Tarayicida `F12` ile console'u ac.
3. [scripts/trendyol-browser-import.js](C:\Users\user\Desktop\code\scripts\trendyol-browser-import.js) dosyasinin tam icerigini console'a yapistir.
4. Endpoint sorarsa `https://hesaplay-c.vercel.app/api/trendyol-market-index` kullan.
5. Kac sayfa taransin sorusuna `1` ile basla.

Script, once Trendyol'un browser-icinden cagrilabilen internal JSON endpoint'lerini dener. Oradan veri alamazsa mevcut sayfadaki urun kartlarini DOM'dan toplar ve market cache'e yollar.
