(() => {
  const DEFAULT_ENDPOINT = 'https://hesaplay-c.vercel.app/api/trendyol-market-index';
  const SEARCH_PAGE_SIZE = 24;
  const ORIGINS = ['https://public.trendyol.com', 'https://apigw.trendyol.com'];

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizePublicProductUrl(value, productId) {
    const source = String(value || '').trim();

    if (!source && productId) {
      return `https://www.trendyol.com/p-${productId}`;
    }

    if (/^https?:\/\//i.test(source)) {
      return source;
    }

    if (source.startsWith('/')) {
      return `https://www.trendyol.com${source}`;
    }

    return source ? `https://www.trendyol.com/${source}` : '';
  }

  function parseInteger(value) {
    const parsed = Number.parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function toNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    const parsed = Number.parseFloat(String(value || '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function pickFirstValue(source, paths, fallback = undefined) {
    for (const path of paths) {
      const value = String(path)
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean)
        .reduce((acc, key) => (acc == null ? undefined : acc[key]), source);

      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }

    return fallback;
  }

  function extractPopularityLabel(raw) {
    const text = JSON.stringify(raw || {}).toLocaleLowerCase('tr-TR');

    if (text.includes('en cok satan') || text.includes('best seller') || text.includes('cok satici')) {
      return 'En Cok Satan';
    }

    if (text.includes('cok degerlendirilen') || text.includes('top rated')) {
      return 'En Cok Degerlendirilen';
    }

    if (text.includes('favori') || text.includes('most favourite')) {
      return 'Cok Favorilenen';
    }

    return '';
  }

  function normalizeProduct(product, contextLabel) {
    const productId = normalizeWhitespace(String(
      pickFirstValue(product, ['id', 'productId', 'product.id'], '')
    ));
    const url = normalizePublicProductUrl(
      pickFirstValue(product, ['url', 'link', 'productUrl'], ''),
      productId
    );
    const title = normalizeWhitespace(String(pickFirstValue(product, ['name', 'title', 'productName'], '')));

    return {
      id: productId || url,
      productId,
      url,
      title,
      brand: normalizeWhitespace(String(pickFirstValue(product, ['brand', 'brandName', 'brand.name'], ''))),
      seller: normalizeWhitespace(String(pickFirstValue(product, ['merchantName', 'sellerName', 'merchant.name'], ''))),
      imageUrl: normalizeWhitespace(String(pickFirstValue(product, ['images[0].url', 'images[0]', 'imageUrl', 'image'], ''))),
      price: toNumber(pickFirstValue(product, [
        'price.sellingPrice.value',
        'price.sellingPrice',
        'price.discountedPrice',
        'sellingPrice.value',
        'sellingPrice',
        'price'
      ], 0)),
      rating: toNumber(pickFirstValue(product, [
        'ratingScore.averageRating',
        'ratingScore',
        'ratingAverage',
        'averageRating'
      ], 0)),
      reviewCount: parseInteger(pickFirstValue(product, [
        'ratingCount',
        'reviewCount',
        'totalRatingCount',
        'ratingScore.totalCount'
      ], 0)),
      questionCount: parseInteger(pickFirstValue(product, ['questionAnswerCount', 'questionCount'], 0)),
      favoriteCount: parseInteger(pickFirstValue(product, ['favoriteCount', 'favouriteCount'], 0)),
      popularityLabel: extractPopularityLabel(product),
      searchTerms: [contextLabel]
    };
  }

  function extractProductsFromPayload(payload) {
    const candidates = [
      payload?.result?.products,
      payload?.result?.data?.products,
      payload?.result?.searchResult?.products,
      payload?.data?.products,
      payload?.products
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }

    return [];
  }

  function buildSearchUrl(origin, query, page) {
    const url = new URL('/discovery-web-searchgw-service/v2/api/infinite-scroll/sr', origin);
    url.searchParams.set('q', query);
    url.searchParams.set('pi', String(page));
    url.searchParams.set('sst', 'MOST_FAVOURITE');
    url.searchParams.set('culture', 'tr-TR');
    url.searchParams.set('userGenderId', '1');
    url.searchParams.set('storefrontId', '1');
    url.searchParams.set('pId', '0');
    url.searchParams.set('scoringAlgorithmId', '2');
    url.searchParams.set('categoryRelevancyEnabled', 'false');
    url.searchParams.set('isLegalRequirementConfirmed', 'false');
    url.searchParams.set('searchStrategyType', 'DEFAULT');
    url.searchParams.set('productStampType', 'A');
    url.searchParams.set('fixSlotProductAdsIncluded', 'false');
    url.searchParams.set('searchAbDeciderValues', '');
    url.searchParams.set('offset', String((page - 1) * SEARCH_PAGE_SIZE));
    return url.toString();
  }

  function buildCategoryUrl(origin, slug, page) {
    const url = new URL(`/discovery-web-searchgw-service/v2/api/infinite-scroll/${slug}`, origin);
    url.searchParams.set('pi', String(page));
    url.searchParams.set('offset', String((page - 1) * 16));
    url.searchParams.set('culture', 'tr-TR');
    url.searchParams.set('userGenderId', '1');
    url.searchParams.set('storefrontId', '1');
    url.searchParams.set('pId', '0');
    url.searchParams.set('scoringAlgorithmId', '2');
    url.searchParams.set('categoryRelevancyEnabled', 'false');
    url.searchParams.set('isLegalRequirementConfirmed', 'false');
    url.searchParams.set('searchStrategyType', 'DEFAULT');
    url.searchParams.set('productStampType', 'A');
    url.searchParams.set('fixSlotProductAdsIncluded', 'false');
    url.searchParams.set('searchAbDeciderValues', '');
    return url.toString();
  }

  async function fetchProductsFromInternalApi(pageLimit) {
    const currentUrl = new URL(window.location.href);
    const query = normalizeWhitespace(currentUrl.searchParams.get('q') || '');
    const slug = query ? '' : normalizeWhitespace(currentUrl.pathname.split('/').filter(Boolean).pop() || '');
    const contextLabel = query || slug || 'browser-page';

    if (!query && !slug) {
      return [];
    }

    const allProducts = [];

    for (const origin of ORIGINS) {
      try {
        for (let page = 1; page <= pageLimit; page += 1) {
          const url = query ? buildSearchUrl(origin, query, page) : buildCategoryUrl(origin, slug, page);
          const response = await fetch(url, {
            credentials: 'include',
            headers: {
              Accept: 'application/json, text/plain, */*'
            }
          });

          if (!response.ok) {
            throw new Error(`Internal api status ${response.status}`);
          }

          const payload = await response.json();
          const products = extractProductsFromPayload(payload);
          products.forEach(product => allProducts.push(normalizeProduct(product, contextLabel)));

          if (!products.length) {
            break;
          }
        }

        if (allProducts.length) {
          return allProducts;
        }
      } catch (error) {
        console.warn('[market-import] internal api failed', origin, error);
      }
    }

    return [];
  }

  function extractProductsFromDom() {
    const seen = new Set();
    const items = [];
    const links = Array.from(document.querySelectorAll('a[href*="-p-"]'));

    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      const url = normalizePublicProductUrl(href);
      if (!url || seen.has(url)) return;

      const container = link.closest('article, [class*="product"], [class*="prdct"], [class*="p-card"], li, div') || link;
      const text = normalizeWhitespace(container.innerText || link.innerText || '');
      const priceMatch = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*TL/i);
      const image = container.querySelector('img');
      const title = normalizeWhitespace(
        link.getAttribute('title')
        || image?.getAttribute('alt')
        || text.split('\n')[0]
        || ''
      );

      if (!title) return;

      items.push({
        url,
        title,
        imageUrl: image?.getAttribute('src') || image?.getAttribute('data-src') || '',
        price: priceMatch ? priceMatch[1] : 0,
        popularityLabel: /en cok satan|cok satan|best seller/i.test(text) ? 'En Cok Satan' : '',
        searchTerms: [normalizeWhitespace(new URL(window.location.href).searchParams.get('q') || window.location.pathname)]
      });
      seen.add(url);
    });

    return items;
  }

  async function postImport(endpoint, items, importSource) {
    const response = await fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mode: 'import',
        importSource,
        items
      })
    });

    if (!response.ok) {
      throw new Error(`Import endpoint status ${response.status}`);
    }

    return response.json();
  }

  async function main() {
    const endpoint = window.prompt('Import endpoint', DEFAULT_ENDPOINT) || DEFAULT_ENDPOINT;
    const pageLimit = Math.max(1, Math.min(5, Number.parseInt(window.prompt('Kac sayfa taransin?', '1') || '1', 10) || 1));
    const importSource = `browser:${window.location.pathname}${window.location.search}`;

    let items = await fetchProductsFromInternalApi(pageLimit);

    if (!items.length) {
      console.warn('[market-import] internal api bos dondu, DOM fallback deneniyor');
      items = extractProductsFromDom();
    }

    if (!items.length) {
      throw new Error('Bu sayfadan urun cikaramadim. Arama veya kategori listesindeyken tekrar dene.');
    }

    const result = await postImport(endpoint, items, importSource);
    console.log('[market-import] imported items', items.length);
    console.log('[market-import] cache total', result?.meta?.totalItems || 0);
    window.alert(`Import tamamlandi. Bu partide ${items.length} urun gonderildi. Cache toplam: ${result?.meta?.totalItems || 0}`);
  }

  main().catch(error => {
    console.error('[market-import] failed', error);
    window.alert(`Import basarisiz: ${error.message || error}`);
  });
})();
