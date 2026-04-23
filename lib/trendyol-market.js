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

const DEFAULT_SCOPE = 'trendyol-public-market';
const SEARCH_PAGE_SIZE = 24;

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
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

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error(`Public page fetch failed with status ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSearchPage(term, page) {
  const url = new URL('https://www.trendyol.com/sr');
  url.searchParams.set('q', term);
  url.searchParams.set('pi', String(page));
  url.searchParams.set('sst', 'MOST_FAVOURITE');
  url.searchParams.set('os', '1');

  const html = await fetchText(url.toString());
  return {
    url: url.toString(),
    html,
    links: extractLinksFromSearchHtml(html)
  };
}

function mergeSignals(baseSignals = {}, nextSignals = {}) {
  return {
    popularityLabel: baseSignals.popularityLabel || nextSignals.popularityLabel || '',
    popularityRank: baseSignals.popularityRank || nextSignals.popularityRank || 0
  };
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

async function refreshPublicMarketIndex(options = {}) {
  const terms = Array.isArray(options.terms) && options.terms.length
    ? options.terms.map(term => normalizeWhitespace(term)).filter(Boolean)
    : [...DEFAULT_DISCOVERY_TERMS];
  const pageLimit = Math.min(4, Math.max(1, Number.parseInt(options.pageLimit || '2', 10) || 2));
  const detailLimit = Math.min(120, Math.max(12, Number.parseInt(options.detailLimit || '60', 10) || 60));
  const discovered = new Map();
  const termHits = new Map();

  for (const term of terms) {
    for (let page = 1; page <= pageLimit; page += 1) {
      const searchPage = await fetchSearchPage(term, page);
      const links = searchPage.links.slice(0, SEARCH_PAGE_SIZE);

      links.forEach(link => {
        const current = discovered.get(link.url);
        const nextSignals = link.signals || {};
        discovered.set(link.url, current
          ? { url: link.url, signals: mergeSignals(current.signals, nextSignals) }
          : { url: link.url, signals: nextSignals });

        const hitTerms = termHits.get(link.url) || new Set();
        hitTerms.add(term);
        termHits.set(link.url, hitTerms);
      });
    }
  }

  const urls = Array.from(discovered.keys()).slice(0, detailLimit);
  const items = [];

  for (const url of urls) {
    const html = await fetchText(url);
    const item = parseProductDetail(
      html,
      url,
      discovered.get(url)?.signals || {},
      Array.from(termHits.get(url) || [])
    );

    if (item.title) items.push(item);
  }

  const byId = new Map();

  items.forEach(item => {
    const key = item.productId || item.url;
    const existing = byId.get(key);
    byId.set(key, existing ? mergeMarketItems(existing, item) : item);
  });

  const mergedItems = sortMarketItems(Array.from(byId.values()));

  return {
    meta: {
      scope: DEFAULT_SCOPE,
      source: 'public-trendyol-pages',
      totalItems: mergedItems.length,
      indexedAt: new Date().toISOString(),
      note: 'This cache is built from public Trendyol pages. Popularity is heuristic, not official sales data.',
      searchTerms: terms,
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
  refreshPublicMarketIndex
};
