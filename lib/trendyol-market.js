const { spawnSync } = require('child_process');

const DEFAULT_DISCOVERY_TERMS = [
  'mensei almanya',
  'almanya',
  'alman mensei',
  'germany',
  'supermarket',
  'kozmetik',
  'elektronik',
  'ev yasam',
  'anne cocuk',
  'erkek',
  'kadin',
  'spor outdoor',
  'ayakkabi',
  'saat aksesuar',
  'vitamin',
  'cikolata'
];
const DEFAULT_DISCOVERY_CATEGORY_SLUGS = [
  'camasir-deterjani-x-c108713',
  'yumusaticilar-x-c103814',
  'camasir-suyu-x-c103812',
  'erkek-t-shirt-x-g2-c73',
  'erkek-gomlek-x-g2-c75',
  'erkek-sort-x-g2-c119'
];

const DEFAULT_SCOPE = 'trendyol-public-market';
const SEARCH_PAGE_SIZE = 24;
const DEFAULT_STOREFRONT = {
  storefrontId: '1',
  countryCode: 'TR',
  language: 'tr',
  culture: 'tr-TR'
};
const BASE_PUBLIC_API_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  Authorization: 'Bearer',
  Origin: 'https://www.trendyol.com',
  Referer: 'https://www.trendyol.com/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
};

function isEnabledEnv(name) {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').toLowerCase());
}

function debugLog(message) {
  if (isEnabledEnv('MARKET_DEBUG')) {
    console.log(`[market-debug] ${message}`);
  }
}

function getStorefrontConfig() {
  return {
    storefrontId: normalizeWhitespace(process.env.TRENDYOL_STOREFRONT_ID || DEFAULT_STOREFRONT.storefrontId) || DEFAULT_STOREFRONT.storefrontId,
    countryCode: normalizeWhitespace(process.env.TRENDYOL_COUNTRY_CODE || DEFAULT_STOREFRONT.countryCode) || DEFAULT_STOREFRONT.countryCode,
    language: normalizeWhitespace(process.env.TRENDYOL_LANGUAGE || DEFAULT_STOREFRONT.language) || DEFAULT_STOREFRONT.language,
    culture: normalizeWhitespace(process.env.TRENDYOL_CULTURE || DEFAULT_STOREFRONT.culture) || DEFAULT_STOREFRONT.culture
  };
}

function getPublicApiOrigins() {
  const raw = String(process.env.TRENDYOL_PUBLIC_API_ORIGINS || '').trim();
  const configured = raw
    ? raw.split(',').map(item => normalizeWhitespace(item)).filter(Boolean)
    : [];

  return configured.length
    ? configured
    : ['https://public.trendyol.com', 'https://apigw.trendyol.com'];
}

function getPublicCookieHeader() {
  const storefront = getStorefrontConfig();

  return [
    ['storefrontId', storefront.storefrontId],
    ['countryCode', storefront.countryCode],
    ['language', storefront.language],
    ['originalSelectedCountry', storefront.countryCode],
    ['selectedCountry', storefront.countryCode]
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function buildPublicApiHeaders(extraHeaders = {}) {
  const storefront = getStorefrontConfig();

  return {
    ...BASE_PUBLIC_API_HEADERS,
    'Accept-Language': `${storefront.culture},tr;q=0.9,en-US;q=0.8,en;q=0.7`,
    Cookie: getPublicCookieHeader(),
    storefrontId: storefront.storefrontId,
    'X-Storefront-Id': storefront.storefrontId,
    'X-Country-Code': storefront.countryCode,
    'X-Language': storefront.language,
    ...extraHeaders
  };
}

function buildPublicPageHeaders(options = {}) {
  const storefront = getStorefrontConfig();

  return {
    'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'Accept-Language': `${storefront.culture},tr;q=0.9,en;q=0.8`,
    Accept: 'text/html,application/xhtml+xml',
    Referer: 'https://www.trendyol.com/',
    Origin: 'https://www.trendyol.com',
    Cookie: getPublicCookieHeader(),
    ...(options.headers || {})
  };
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePowerShellString(value) {
  return String(value || '').replace(/'/g, "''");
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' '))
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[ç]/g, 'c')
    .replace(/[ğ]/g, 'g')
    .replace(/[ı]/g, 'i')
    .replace(/[ö]/g, 'o')
    .replace(/[ş]/g, 's')
    .replace(/[ü]/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function safeNumber(value) {
  const parsed = Number.parseFloat(String(value || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return safeNumber(value);
}

function getPathValue(source, path) {
  if (!source || !path) return undefined;

  return String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function pickFirstValue(source, paths, fallback = undefined) {
  for (const path of paths) {
    const value = getPathValue(source, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }

  return fallback;
}

function normalizePublicProductUrl(value, productId) {
  const source = String(value || '').trim();

  if (!source && productId) {
    return `https://www.trendyol.com/p-${productId}`;
  }

  if (/^https?:\/\//i.test(source)) {
    return canonicalizeProductUrl(source) || source;
  }

  if (source.startsWith('/')) {
    return canonicalizeProductUrl(`https://www.trendyol.com${source}`) || `https://www.trendyol.com${source}`;
  }

  return canonicalizeProductUrl(`https://www.trendyol.com/${source}`) || `https://www.trendyol.com/${source}`;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slugToTitle(value) {
  return String(value || '')
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildEmptyMarketPayload(overrides = {}) {
  const terms = Array.isArray(overrides.terms) && overrides.terms.length
    ? overrides.terms
    : [...DEFAULT_DISCOVERY_TERMS];

  return {
    meta: {
      scope: DEFAULT_SCOPE,
      source: 'public-trendyol-pages',
      totalItems: 0,
      indexedAt: null,
      note: 'This cache is built from public Trendyol pages. Popularity is heuristic, not official sales data.',
      searchTerms: terms,
      pageLimit: Number(overrides.pageLimit || 0),
      detailLimit: Number(overrides.detailLimit || 0)
    },
    items: []
  };
}

function canonicalizeProductUrl(href) {
  if (!href) return null;

  const source = String(href).trim();
  const match = source.match(/(?:https?:\/\/www\.trendyol\.com)?(\/(?:pd\/)?[^"'?#\s]+-p-\d+)/i);
  if (!match) return null;

  const path = match[1].startsWith('/pd/') ? match[1] : `/pd${match[1]}`;
  return `https://www.trendyol.com${path}`;
}

function extractMetaTag(html, key, attrName = 'property') {
  const pattern = new RegExp(`<meta[^>]+${attrName}=["']${escapeRegExp(key)}["'][^>]+content=["']([^"']+)["']`, 'i');
  const match = html.match(pattern);
  return match ? decodeHtmlEntities(match[1]) : '';
}

function extractTitleFromHtml(html, url) {
  const ogTitle = extractMetaTag(html, 'og:title');
  if (ogTitle) {
    return normalizeWhitespace(
      ogTitle
        .replace(/\s*-\s*Fiyati,?\s*Yorumlari.*$/i, '')
        .replace(/\s*-\s*Fiyat[iI],?\s*Yorumlar[iI].*$/i, '')
    );
  }

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    return normalizeWhitespace(
      decodeHtmlEntities(titleMatch[1])
        .replace(/\s*-\s*Fiyati,?\s*Yorumlari.*$/i, '')
        .replace(/\s*-\s*Fiyat[iI],?\s*Yorumlar[iI].*$/i, '')
    );
  }

  const slugMatch = String(url || '').match(/\/pd\/([^/]+)\/([^/]+)-p-\d+/i);
  if (!slugMatch) return '';

  return normalizeWhitespace(slugToTitle(slugMatch[2]));
}

function extractBrandFromUrl(url) {
  const match = String(url || '').match(/\/pd\/([^/]+)\//i);
  return match ? slugToTitle(match[1]) : '';
}

function parseOrigin(rawText, fallbackText = '') {
  const text = normalizeWhitespace(`${rawText || ''} ${fallbackText || ''}`);
  const normalized = normalizeSearchText(text);
  const originMatch = normalized.match(/mensei\s*[:\-]?\s*([a-z]{2,3}|[a-z\s]{2,30}?)(?:\s{2,}|$)/i);
  const normalizedOrigin = originMatch ? normalizeWhitespace(originMatch[1]) : '';
  const upperOrigin = normalizedOrigin.toUpperCase();

  if (
    upperOrigin === 'DE'
    || normalizedOrigin === 'almanya'
    || normalizedOrigin === 'germany'
    || normalizedOrigin === 'deutschland'
    || normalized.includes('mensei almanya')
    || normalized.includes('alman mensei')
    || normalized.includes('germany origin')
    || normalized.includes('almanya uretimi')
    || normalized.includes('alman uretimi')
  ) {
    return {
      originCode: 'DE',
      originLabel: 'Almanya',
      isGermanyOrigin: true
    };
  }

  if (upperOrigin === 'CN') {
    return { originCode: 'CN', originLabel: 'CN', isGermanyOrigin: false };
  }

  if (upperOrigin === 'FR') {
    return { originCode: 'FR', originLabel: 'FR', isGermanyOrigin: false };
  }

  if (normalizedOrigin) {
    return {
      originCode: upperOrigin.slice(0, 8),
      originLabel: normalizedOrigin,
      isGermanyOrigin: false
    };
  }

  return {
    originCode: '',
    originLabel: '',
    isGermanyOrigin: false
  };
}

function parsePopularitySignals(htmlWindow) {
  const normalized = normalizeSearchText(decodeHtmlEntities(htmlWindow));
  const rankMatch = normalized.match(/en cok (satan|degerlendirilen|favorilenen|ziyaret edilen) (\d+) urun/i);

  if (!rankMatch) return null;

  const label = `En Cok ${rankMatch[1]}`;
  const rank = Number.parseInt(rankMatch[2], 10) || 0;
  return {
    popularityLabel: label,
    popularityRank: rank
  };
}

function extractLinksFromSearchHtml(html) {
  const items = [];
  const seen = new Set();
  const hrefRegex = /href=["']([^"']+-p-\d+[^"']*)["']/gi;
  let match = hrefRegex.exec(html);

  while (match) {
    const url = canonicalizeProductUrl(match[1]);
    if (url && !seen.has(url)) {
      const start = Math.max(0, match.index - 500);
      const end = Math.min(html.length, match.index + 900);
      const signals = parsePopularitySignals(html.slice(start, end));
      items.push({ url, signals });
      seen.add(url);
    }
    match = hrefRegex.exec(html);
  }

  return items;
}

function parseReviewSignals(rawText) {
  const normalized = String(rawText || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[ç]/g, 'c')
    .replace(/[ğ]/g, 'g')
    .replace(/[ı]/g, 'i')
    .replace(/[ö]/g, 'o')
    .replace(/[ş]/g, 's')
    .replace(/[ü]/g, 'u')
    .replace(/(\d),(\d)/g, '$1.$2');
  const ratingReviewMatch = normalized.match(/(\d(?:\.\d)?)\s+(\d[\d.,]*)\s+degerlendirme/i);

  const rating = ratingReviewMatch ? safeNumber(ratingReviewMatch[1]) : 0;
  const reviewCount = ratingReviewMatch ? parseInteger(ratingReviewMatch[2]) : 0;
  const questionMatch = normalized.match(/(\d[\d.,]*)\s+soru-?\s*cevap/i);
  const questionCount = questionMatch ? parseInteger(questionMatch[1]) : 0;

  return { rating, reviewCount, questionCount };
}

function parsePriceSignals(rawText) {
  const priceMatch = rawText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*TL\b/);
  const price = priceMatch ? safeNumber(priceMatch[1]) : 0;
  return { price };
}

function parseSeller(rawText) {
  const normalized = normalizeSearchText(rawText);
  const sellerMatch = normalized.match(/bu urun (.+?) tarafindan gonderilecektir/i);
  return sellerMatch ? normalizeWhitespace(sellerMatch[1]) : '';
}

function parseAvailability(rawText) {
  const normalized = normalizeSearchText(rawText);
  return {
    isFastDelivery: normalized.includes('hizli teslimat') || normalized.includes('yarin kargoda'),
    isOutOfStock: normalized.includes('stoklar tukendi') || normalized.includes('tukendi')
  };
}

function computePopularityScore(item) {
  let score = 0;
  score += Math.min(item.reviewCount || 0, 100000) * 4;
  score += Math.round((item.rating || 0) * 100);
  score += Math.min(item.questionCount || 0, 5000) * 2;

  if (item.popularityLabel) {
    if (/satan/i.test(item.popularityLabel)) score += 1200;
    if (/degerlendirilen/i.test(normalizeSearchText(item.popularityLabel))) score += 900;
    if (/favorilenen/i.test(normalizeSearchText(item.popularityLabel))) score += 700;
    if (/ziyaret edilen/i.test(normalizeSearchText(item.popularityLabel))) score += 500;
  }

  if (item.popularityRank) {
    score += Math.max(0, 1000 - item.popularityRank * 35);
  }

  if (item.isFastDelivery) score += 50;
  if (!item.isOutOfStock) score += 20;
  if (item.isGermanyOrigin) score += 10;

  return Math.round(score);
}

function extractProductId(url) {
  const match = String(url || '').match(/-p-(\d+)/i);
  return match ? match[1] : '';
}

function fetchViaPowerShell(url, options = {}) {
  if (process.platform !== 'win32') {
    const error = new Error('PowerShell fallback is only available on Windows.');
    error.status = 0;
    throw error;
  }

  const headers = buildPublicApiHeaders(options.headers || {});
  const headerLines = Object.entries(headers).map(([key, value]) => `$headers['${escapePowerShellString(key)}'] = '${escapePowerShellString(value)}'`);
  const timeoutSec = Math.max(15, Math.min(120, Math.ceil((options.timeoutMs || 15000) / 1000)));
  const script = [
    '$ProgressPreference = "SilentlyContinue"',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
    '$headers = @{}',
    ...headerLines,
    `$response = Invoke-WebRequest -Uri '${escapePowerShellString(url)}' -Method Get -Headers $headers -TimeoutSec ${timeoutSec} -UseBasicParsing`,
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '[Console]::Out.Write($response.Content)'
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded
  ], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });

  if (result.status !== 0) {
    const error = new Error((result.stderr || result.stdout || 'PowerShell request failed').trim());
    error.status = 0;
    throw error;
  }

  return result.stdout;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

  try {
    const response = await fetch(url, {
      headers: buildPublicApiHeaders(options.headers || {}),
      signal: controller.signal
    });

    if (!response.ok) {
      if (response.status === 403 && process.platform === 'win32') {
        const fallbackText = fetchViaPowerShell(url, options);
        return fallbackText ? JSON.parse(fallbackText) : {};
      }

      const error = new Error(`Public api fetch failed with status ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  } catch (error) {
    if (process.platform === 'win32' && !error.status) {
      const fallbackText = fetchViaPowerShell(url, options);
      return fallbackText ? JSON.parse(fallbackText) : {};
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

  try {
    const response = await fetch(url, {
      headers: buildPublicPageHeaders(options),
      signal: controller.signal
    });

    if (!response.ok) {
      if (response.status === 403 && process.platform === 'win32') {
        return fetchViaPowerShell(url, options);
      }

      const error = new Error(`Public page fetch failed with status ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.text();
  } catch (error) {
    if (process.platform === 'win32' && !error.status) {
      return fetchViaPowerShell(url, options);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSearchApiUrl(term, page, origin = getPublicApiOrigins()[0]) {
  const storefront = getStorefrontConfig();
  const url = new URL('/discovery-web-searchgw-service/v2/api/infinite-scroll/sr', origin);
  url.searchParams.set('q', term);
  url.searchParams.set('pi', String(page));
  url.searchParams.set('sst', 'MOST_FAVOURITE');
  url.searchParams.set('culture', storefront.culture);
  url.searchParams.set('userGenderId', '1');
  url.searchParams.set('storefrontId', storefront.storefrontId);
  url.searchParams.set('pId', '0');
  url.searchParams.set('scoringAlgorithmId', '2');
  url.searchParams.set('categoryRelevancyEnabled', 'false');
  url.searchParams.set('isLegalRequirementConfirmed', 'false');
  url.searchParams.set('searchStrategyType', 'DEFAULT');
  url.searchParams.set('productStampType', 'A');
  url.searchParams.set('fixSlotProductAdsIncluded', 'false');
  url.searchParams.set('searchAbDeciderValues', '');
  url.searchParams.set('offset', String((page - 1) * SEARCH_PAGE_SIZE));
  return url;
}

function buildCategoryApiUrl(categorySlug, page, origin = getPublicApiOrigins()[0]) {
  const storefront = getStorefrontConfig();
  const url = new URL(`/discovery-web-searchgw-service/v2/api/infinite-scroll/${categorySlug}`, origin);
  url.searchParams.set('pi', String(page));
  url.searchParams.set('offset', String((page - 1) * 16));
  url.searchParams.set('culture', storefront.culture);
  url.searchParams.set('userGenderId', '1');
  url.searchParams.set('storefrontId', storefront.storefrontId);
  url.searchParams.set('pId', '0');
  url.searchParams.set('scoringAlgorithmId', '2');
  url.searchParams.set('categoryRelevancyEnabled', 'false');
  url.searchParams.set('isLegalRequirementConfirmed', 'false');
  url.searchParams.set('searchStrategyType', 'DEFAULT');
  url.searchParams.set('productStampType', 'A');
  url.searchParams.set('fixSlotProductAdsIncluded', 'false');
  url.searchParams.set('searchAbDeciderValues', '');
  return url;
}

function extractProductsFromPayload(payload) {
  const candidates = [
    payload?.result?.products,
    payload?.result?.data?.products,
    payload?.result?.searchResult?.products,
    payload?.result?.listing?.products,
    payload?.data?.products,
    payload?.products,
    payload?.searchResult?.products,
    payload?.listing?.products
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function extractTotalCountFromPayload(payload, fallback = 0) {
  return Number(pickFirstValue(payload, [
    'result.totalCount',
    'result.totalProductCount',
    'result.searchSummary.totalCount',
    'result.data.totalCount',
    'result.searchResult.totalCount',
    'data.totalCount',
    'totalCount',
    'pagination.totalCount'
  ], fallback));
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return `payloadType=${typeof payload}`;
  }

  const topKeys = Object.keys(payload).slice(0, 10).join('|') || '-';
  const resultKeys = payload.result && typeof payload.result === 'object'
    ? Object.keys(payload.result).slice(0, 10).join('|') || '-'
    : '-';
  const dataKeys = payload.data && typeof payload.data === 'object'
    ? Object.keys(payload.data).slice(0, 10).join('|') || '-'
    : '-';
  const message = normalizeWhitespace(String(pickFirstValue(payload, [
    'message',
    'error',
    'errorMessage',
    'result.message',
    'result.error',
    'data.message'
  ], ''))).slice(0, 160) || '-';

  return `topKeys=${topKeys} resultKeys=${resultKeys} dataKeys=${dataKeys} message=${message}`;
}

function extractPopularityFromSearchProduct(product) {
  const raw = JSON.stringify(product || {});
  const normalized = normalizeSearchText(raw);
  const labelParts = [];

  if (normalized.includes('cok satici') || normalized.includes('best seller') || normalized.includes('en cok satan')) {
    labelParts.push('En Cok Satan');
  }

  if (normalized.includes('top rated') || normalized.includes('en cok degerlendirilen') || normalized.includes('cok degerlendirilen')) {
    labelParts.push('En Cok Degerlendirilen');
  }

  if (normalized.includes('favori') || normalized.includes('most favourite')) {
    labelParts.push('Cok Favorilenen');
  }

  return labelParts[0] || '';
}

function normalizeSearchProduct(product, term) {
  const productId = String(
    pickFirstValue(product, ['id', 'productId', 'product.id'], '')
  ).trim();
  const title = normalizeWhitespace(String(pickFirstValue(product, ['name', 'title', 'productName'], '')));
  const brand = normalizeWhitespace(String(pickFirstValue(product, ['brand', 'brandName', 'brand.name'], '')));
  const seller = normalizeWhitespace(String(pickFirstValue(product, ['merchantName', 'sellerName', 'merchant.name'], '')));
  const price = toNumber(pickFirstValue(product, [
    'price.sellingPrice.value',
    'price.sellingPrice',
    'price.discountedPrice',
    'sellingPrice.value',
    'sellingPrice',
    'price'
  ], 0));
  const rating = toNumber(pickFirstValue(product, [
    'ratingScore.averageRating',
    'ratingScore',
    'ratingAverage',
    'averageRating'
  ], 0));
  const reviewCount = parseInteger(pickFirstValue(product, [
    'ratingCount',
    'reviewCount',
    'totalRatingCount',
    'ratingScore.totalCount'
  ], 0));
  const questionCount = parseInteger(pickFirstValue(product, [
    'questionAnswerCount',
    'questionCount'
  ], 0));
  const favoriteCount = parseInteger(pickFirstValue(product, [
    'favoriteCount',
    'favouriteCount'
  ], 0));
  const popularityLabel = extractPopularityFromSearchProduct(product);
  const url = normalizePublicProductUrl(pickFirstValue(product, ['url', 'link', 'productUrl'], ''), productId);
  const imageUrl = pickFirstValue(product, [
    'images[0].url',
    'images[0]',
    'imageUrl',
    'image'
  ], '');
  const origin = parseOrigin(`${title} ${brand}`, title);
  const item = {
    id: productId || url,
    productId,
    url,
    title,
    brand,
    seller,
    imageUrl,
    price,
    rating,
    reviewCount,
    questionCount,
    favoriteCount,
    popularityLabel,
    popularityRank: 0,
    originCode: origin.originCode,
    originLabel: origin.originLabel,
    isGermanyOrigin: origin.isGermanyOrigin,
    isFastDelivery: normalizeSearchText(JSON.stringify(product)).includes('hizli teslimat'),
    isOutOfStock: normalizeSearchText(JSON.stringify(product)).includes('tukendi'),
    searchTerms: [term],
    discoveredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };

  item.popularityScore = computePopularityScore(item) + Math.min(favoriteCount, 100000);
  return item;
}

async function fetchSearchPage(term, page) {
  let lastError = null;
  let emptyResult = null;

  for (const origin of getPublicApiOrigins()) {
    const url = buildSearchApiUrl(term, page, origin);

    try {
      const payload = await fetchJson(url.toString());
      const products = extractProductsFromPayload(payload);
      const totalCount = extractTotalCountFromPayload(payload, products.length);

      debugLog(`search term="${term}" page=${page} rawProducts=${products.length} totalCount=${totalCount} origin=${origin} url=${url.toString()}`);

      if (!products.length && !totalCount) {
        debugLog(`search term="${term}" page=${page} emptyPayload ${summarizePayload(payload)}`);
      }

      const currentResult = {
        url: url.toString(),
        items: products.map(product => normalizeSearchProduct(product, term))
      };

      if (products.length || totalCount) {
        return currentResult;
      }

      if (!emptyResult) {
        emptyResult = currentResult;
      }
    } catch (error) {
      lastError = error;
      debugLog(`search term="${term}" page=${page} origin=${origin} failed status=${error.status || 0} message=${normalizeWhitespace(error.message || String(error))}`);
    }
  }

  if (emptyResult) {
    return emptyResult;
  }

  if (lastError) {
    throw lastError;
  }

  return { url: '', items: [] };
}

async function fetchCategoryPage(categorySlug, page) {
  let lastError = null;
  let emptyResult = null;

  for (const origin of getPublicApiOrigins()) {
    const url = buildCategoryApiUrl(categorySlug, page, origin);

    try {
      const payload = await fetchJson(url.toString());
      const products = extractProductsFromPayload(payload);
      const totalCount = extractTotalCountFromPayload(payload, products.length);

      debugLog(`category slug="${categorySlug}" page=${page} rawProducts=${products.length} totalCount=${totalCount} origin=${origin} url=${url.toString()}`);

      if (!products.length && !totalCount) {
        debugLog(`category slug="${categorySlug}" page=${page} emptyPayload ${summarizePayload(payload)}`);
      }

      const currentResult = {
        url: url.toString(),
        items: products.map(product => normalizeSearchProduct(product, categorySlug))
      };

      if (products.length || totalCount) {
        return currentResult;
      }

      if (!emptyResult) {
        emptyResult = currentResult;
      }
    } catch (error) {
      lastError = error;
      debugLog(`category slug="${categorySlug}" page=${page} origin=${origin} failed status=${error.status || 0} message=${normalizeWhitespace(error.message || String(error))}`);
    }
  }

  if (emptyResult) {
    return emptyResult;
  }

  if (lastError) {
    throw lastError;
  }

  return { url: '', items: [] };
}

function mergeSignals(baseSignals = {}, nextSignals = {}) {
  return {
    popularityLabel: baseSignals.popularityLabel || nextSignals.popularityLabel || '',
    popularityRank: baseSignals.popularityRank || nextSignals.popularityRank || 0
  };
}

async function fetchProductDetail(productId) {
  if (!productId) return null;

  const storefront = getStorefrontConfig();
  let lastError = null;

  for (const origin of getPublicApiOrigins()) {
    const url = new URL(`/discovery-web-productgw-service/api/productDetail/${encodeURIComponent(productId)}`, origin);
    url.searchParams.set('culture', storefront.culture);
    url.searchParams.set('storefrontId', storefront.storefrontId);

    try {
      const payload = await fetchJson(url.toString());
      debugLog(`detail productId=${productId} ok=${Boolean(payload)} origin=${origin}`);
      return payload?.result || payload || null;
    } catch (error) {
      lastError = error;

      if (error.status === 403 || error.status === 404) {
        debugLog(`detail productId=${productId} skipped status=${error.status} origin=${origin}`);
        continue;
      }

      throw error;
    }
  }

  if (lastError && (lastError.status === 403 || lastError.status === 404)) {
    return null;
  }

  throw lastError || new Error(`Product detail fetch failed for ${productId}`);
}

function enrichItemFromDetail(baseItem, detail) {
  if (!detail) return baseItem;

  const detailText = JSON.stringify(detail);
  const origin = parseOrigin(detailText, `${baseItem.title || ''} ${baseItem.brand || ''}`);
  const brand = normalizeWhitespace(String(pickFirstValue(detail, [
    'brand.name',
    'brand',
    'brandName'
  ], baseItem.brand || '')));
  const seller = normalizeWhitespace(String(pickFirstValue(detail, [
    'seller.name',
    'merchant.name',
    'merchantName',
    'sellerName'
  ], baseItem.seller || '')));
  const rating = toNumber(pickFirstValue(detail, [
    'ratingScore.averageRating',
    'ratingScore',
    'averageRating'
  ], baseItem.rating || 0));
  const reviewCount = parseInteger(pickFirstValue(detail, [
    'ratingCount',
    'reviewCount',
    'totalRatingCount',
    'ratingScore.totalCount'
  ], baseItem.reviewCount || 0));
  const questionCount = parseInteger(pickFirstValue(detail, [
    'questionAnswerCount',
    'questionCount'
  ], baseItem.questionCount || 0));
  const price = toNumber(pickFirstValue(detail, [
    'price.sellingPrice.value',
    'price.sellingPrice',
    'sellingPrice.value',
    'sellingPrice'
  ], baseItem.price || 0));
  const imageUrl = pickFirstValue(detail, [
    'images[0].url',
    'images[0]',
    'imageUrl'
  ], baseItem.imageUrl || '');
  const popularityLabel = baseItem.popularityLabel || extractPopularityFromSearchProduct(detail);
  const nextItem = {
    ...baseItem,
    brand: brand || baseItem.brand,
    seller: seller || baseItem.seller,
    imageUrl: imageUrl || baseItem.imageUrl,
    price: price || baseItem.price,
    rating: rating || baseItem.rating,
    reviewCount: reviewCount || baseItem.reviewCount,
    questionCount: questionCount || baseItem.questionCount,
    popularityLabel,
    originCode: origin.originCode || baseItem.originCode,
    originLabel: origin.originLabel || baseItem.originLabel,
    isGermanyOrigin: Boolean(origin.isGermanyOrigin || baseItem.isGermanyOrigin),
    isFastDelivery: Boolean(baseItem.isFastDelivery || normalizeSearchText(detailText).includes('hizli teslimat')),
    isOutOfStock: Boolean(baseItem.isOutOfStock || normalizeSearchText(detailText).includes('tukendi')),
    lastSeenAt: new Date().toISOString()
  };

  nextItem.popularityScore = computePopularityScore(nextItem) + Math.min(nextItem.favoriteCount || 0, 100000);
  return nextItem;
}

function parseProductDetail(html, url, linkSignals, terms) {
  const rawText = normalizeWhitespace(stripTags(html));
  const title = extractTitleFromHtml(html, url);
  const brand = extractBrandFromUrl(url);
  const origin = parseOrigin(rawText, title);
  const reviewSignals = parseReviewSignals(rawText);
  const priceSignals = parsePriceSignals(rawText);
  const seller = parseSeller(rawText);
  const availability = parseAvailability(rawText);
  const imageUrl = extractMetaTag(html, 'og:image');
  const mergedSignals = mergeSignals(linkSignals, parsePopularitySignals(rawText));

  const item = {
    id: extractProductId(url) || url,
    productId: extractProductId(url),
    url,
    title,
    brand,
    seller,
    imageUrl,
    price: priceSignals.price,
    rating: reviewSignals.rating,
    reviewCount: reviewSignals.reviewCount,
    questionCount: reviewSignals.questionCount,
    popularityLabel: mergedSignals.popularityLabel || '',
    popularityRank: mergedSignals.popularityRank || 0,
    originCode: origin.originCode,
    originLabel: origin.originLabel,
    isGermanyOrigin: origin.isGermanyOrigin,
    isFastDelivery: availability.isFastDelivery,
    isOutOfStock: availability.isOutOfStock,
    searchTerms: Array.from(new Set((terms || []).filter(Boolean))),
    discoveredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };

  item.popularityScore = computePopularityScore(item);
  return item;
}

function mergeMarketItems(currentItem, nextItem) {
  const searchTerms = Array.from(new Set([...(currentItem.searchTerms || []), ...(nextItem.searchTerms || [])]));
  const popularityLabel = currentItem.popularityLabel || nextItem.popularityLabel;
  const popularityRank = currentItem.popularityRank || nextItem.popularityRank;
  const item = {
    ...currentItem,
    ...nextItem,
    title: currentItem.title || nextItem.title,
    brand: currentItem.brand || nextItem.brand,
    seller: currentItem.seller || nextItem.seller,
    imageUrl: currentItem.imageUrl || nextItem.imageUrl,
    price: currentItem.price || nextItem.price,
    rating: currentItem.rating || nextItem.rating,
    reviewCount: currentItem.reviewCount || nextItem.reviewCount,
    questionCount: currentItem.questionCount || nextItem.questionCount,
    popularityLabel,
    popularityRank,
    originCode: currentItem.originCode || nextItem.originCode,
    originLabel: currentItem.originLabel || nextItem.originLabel,
    isGermanyOrigin: Boolean(currentItem.isGermanyOrigin || nextItem.isGermanyOrigin),
    isFastDelivery: Boolean(currentItem.isFastDelivery || nextItem.isFastDelivery),
    isOutOfStock: Boolean(currentItem.isOutOfStock && nextItem.isOutOfStock),
    searchTerms,
    discoveredAt: currentItem.discoveredAt || nextItem.discoveredAt,
    lastSeenAt: nextItem.lastSeenAt || currentItem.lastSeenAt
  };

  item.popularityScore = computePopularityScore(item);
  return item;
}

function sortMarketItems(items) {
  return [...items].sort((a, b) => {
    if (b.popularityScore !== a.popularityScore) return b.popularityScore - a.popularityScore;
    if (b.reviewCount !== a.reviewCount) return b.reviewCount - a.reviewCount;
    if (b.rating !== a.rating) return b.rating - a.rating;
    return String(a.title || '').localeCompare(String(b.title || ''), 'tr');
  });
}

function normalizeImportedItem(item, fallbackTerm = 'browser-import') {
  const productId = normalizeWhitespace(String(
    item?.productId
    || extractProductId(item?.url || item?.link || item?.productUrl || '')
    || item?.id
    || ''
  ));
  const url = normalizePublicProductUrl(item?.url || item?.link || item?.productUrl || '', productId);
  const title = normalizeWhitespace(String(item?.title || item?.name || ''));
  const brand = normalizeWhitespace(String(item?.brand || item?.brandName || ''));
  const seller = normalizeWhitespace(String(item?.seller || item?.merchantName || item?.sellerName || ''));
  const imageUrl = normalizeWhitespace(String(item?.imageUrl || item?.image || ''));
  const favoriteCount = parseInteger(item?.favoriteCount || item?.favouriteCount || 0);
  const popularityLabel = normalizeWhitespace(String(item?.popularityLabel || item?.badge || ''));
  const popularityRank = parseInteger(item?.popularityRank || item?.rank || 0);
  const originGuess = parseOrigin(
    `${item?.originLabel || ''} ${item?.originCode || ''} ${title} ${brand} ${seller} ${popularityLabel}`,
    `${title} ${brand}`
  );
  const searchTerms = Array.isArray(item?.searchTerms) && item.searchTerms.length
    ? item.searchTerms.map(term => normalizeWhitespace(term)).filter(Boolean)
    : [fallbackTerm];
  const normalized = {
    id: productId || url || `import-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    productId,
    url,
    title,
    brand,
    seller,
    imageUrl,
    price: toNumber(item?.price),
    rating: toNumber(item?.rating),
    reviewCount: parseInteger(item?.reviewCount || item?.ratingCount || 0),
    questionCount: parseInteger(item?.questionCount || item?.questionAnswerCount || 0),
    favoriteCount,
    popularityLabel,
    popularityRank,
    originCode: normalizeWhitespace(String(item?.originCode || originGuess.originCode || '')).toUpperCase(),
    originLabel: normalizeWhitespace(String(item?.originLabel || originGuess.originLabel || '')),
    isGermanyOrigin: Boolean(item?.isGermanyOrigin || originGuess.isGermanyOrigin),
    isFastDelivery: Boolean(item?.isFastDelivery),
    isOutOfStock: Boolean(item?.isOutOfStock),
    searchTerms,
    discoveredAt: item?.discoveredAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };

  normalized.popularityScore = Math.max(
    parseInteger(item?.popularityScore || 0),
    computePopularityScore(normalized) + Math.min(favoriteCount, 100000)
  );

  return normalized;
}

function buildMarketPayloadFromImportedItems(importedItems, options = {}) {
  const items = Array.isArray(importedItems) ? importedItems : [];
  const map = new Map();
  const fallbackTerm = normalizeWhitespace(options.fallbackTerm || options.importSource || 'browser-import') || 'browser-import';

  items.forEach(rawItem => {
    const item = normalizeImportedItem(rawItem, fallbackTerm);
    const key = item.productId || item.url;
    if (!key || !item.title) return;

    const existing = map.get(key);
    map.set(key, existing ? mergeMarketItems(existing, item) : item);
  });

  const mergedItems = sortMarketItems(Array.from(map.values()));
  const searchTerms = Array.from(new Set([
    ...(Array.isArray(options.terms) ? options.terms.map(term => normalizeWhitespace(term)).filter(Boolean) : []),
    ...mergedItems.flatMap(item => Array.isArray(item.searchTerms) ? item.searchTerms : [])
  ]));

  return {
    meta: {
      scope: DEFAULT_SCOPE,
      source: options.source || 'browser-session-import',
      totalItems: mergedItems.length,
      indexedAt: new Date().toISOString(),
      note: options.note || 'This cache can also be imported from a real browser session when Trendyol blocks server-side fetching.',
      searchTerms,
      importSource: normalizeWhitespace(options.importSource || 'browser-session')
    },
    items: mergedItems
  };
}

function mergeMarketPayloads(currentPayload, nextPayload, options = {}) {
  const currentItems = Array.isArray(currentPayload?.items) ? currentPayload.items : [];
  const nextItems = Array.isArray(nextPayload?.items) ? nextPayload.items : [];
  const map = new Map();

  [...currentItems, ...nextItems].forEach(rawItem => {
    const item = normalizeImportedItem(rawItem, options.fallbackTerm || 'merged-import');
    const key = item.productId || item.url;
    if (!key || !item.title) return;

    const existing = map.get(key);
    map.set(key, existing ? mergeMarketItems(existing, item) : item);
  });

  const mergedItems = sortMarketItems(Array.from(map.values()));
  const searchTerms = Array.from(new Set([
    ...(Array.isArray(currentPayload?.meta?.searchTerms) ? currentPayload.meta.searchTerms : []),
    ...(Array.isArray(nextPayload?.meta?.searchTerms) ? nextPayload.meta.searchTerms : []),
    ...mergedItems.flatMap(item => Array.isArray(item.searchTerms) ? item.searchTerms : [])
  ]));

  return {
    meta: {
      ...(currentPayload?.meta || {}),
      ...(nextPayload?.meta || {}),
      scope: DEFAULT_SCOPE,
      source: options.source || nextPayload?.meta?.source || currentPayload?.meta?.source || 'merged-market-cache',
      totalItems: mergedItems.length,
      indexedAt: new Date().toISOString(),
      searchTerms
    },
    items: mergedItems
  };
}

async function refreshPublicMarketIndex(options = {}) {
  const terms = Array.isArray(options.terms) && options.terms.length
    ? options.terms.map(term => normalizeWhitespace(term)).filter(Boolean)
    : [...DEFAULT_DISCOVERY_TERMS];
  const categorySlugs = Array.isArray(options.categorySlugs) && options.categorySlugs.length
    ? options.categorySlugs.map(item => normalizeWhitespace(item)).filter(Boolean)
    : [...DEFAULT_DISCOVERY_CATEGORY_SLUGS];
  const pageLimit = Math.min(4, Math.max(1, Number.parseInt(options.pageLimit || '2', 10) || 2));
  const detailLimit = Math.min(120, Math.max(12, Number.parseInt(options.detailLimit || '60', 10) || 60));
  const discovered = new Map();

  debugLog(`refresh start pageLimit=${pageLimit} detailLimit=${detailLimit} terms=${terms.join(', ')} categories=${categorySlugs.join(', ')}`);

  for (const categorySlug of categorySlugs) {
    for (let page = 1; page <= pageLimit; page += 1) {
      const categoryPage = await fetchCategoryPage(categorySlug, page);
      const items = categoryPage.items.slice(0, SEARCH_PAGE_SIZE);
      debugLog(`category normalized slug="${categorySlug}" page=${page} usableItems=${items.length}`);

      items.forEach(item => {
        const key = item.productId || item.url;
        const current = discovered.get(key);
        discovered.set(key, current ? mergeMarketItems(current, item) : item);
      });
    }
  }

  if (!discovered.size) {
    debugLog('category seed returned 0 items, falling back to q-based search terms');

    for (const term of terms) {
      for (let page = 1; page <= pageLimit; page += 1) {
        const searchPage = await fetchSearchPage(term, page);
        const items = searchPage.items.slice(0, SEARCH_PAGE_SIZE);
        debugLog(`search normalized term="${term}" page=${page} usableItems=${items.length}`);

        items.forEach(item => {
          const key = item.productId || item.url;
          const current = discovered.get(key);
          discovered.set(key, current ? mergeMarketItems(current, item) : item);
        });
      }
    }
  }

  const keys = Array.from(discovered.keys()).slice(0, detailLimit);
  const items = [];
  debugLog(`discovered unique items=${discovered.size} detailQueue=${keys.length}`);

  for (const key of keys) {
    const current = discovered.get(key);
    if (!current) continue;

    let nextItem = current;
    const detail = await fetchProductDetail(current.productId);
    if (detail) {
      nextItem = enrichItemFromDetail(current, detail);
    }

    if (nextItem.title) items.push(nextItem);
  }

  debugLog(`items after detail enrichment=${items.length}`);

  const byId = new Map();

  items.forEach(item => {
    const key = item.productId || item.url;
    const existing = byId.get(key);
    byId.set(key, existing ? mergeMarketItems(existing, item) : item);
  });

  const mergedItems = sortMarketItems(Array.from(byId.values()));
  debugLog(`merged final items=${mergedItems.length}`);

  return {
    meta: {
      scope: DEFAULT_SCOPE,
      source: 'public-trendyol-pages',
      totalItems: mergedItems.length,
      indexedAt: new Date().toISOString(),
      note: 'This cache is built from public Trendyol pages. Popularity is heuristic, not official sales data.',
      searchTerms: terms,
      categorySlugs,
      pageLimit,
      detailLimit
    },
    items: mergedItems
  };
}

module.exports = {
  DEFAULT_DISCOVERY_TERMS,
  DEFAULT_SCOPE,
  buildEmptyMarketPayload,
  buildMarketPayloadFromImportedItems,
  mergeMarketPayloads,
  refreshPublicMarketIndex
};
