const DEFAULT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...DEFAULT_HEADERS
  });
  res.end(JSON.stringify(body));
}

function getConfig() {
  const sellerId = process.env.TRENDYOL_SELLER_ID || process.env.TRENDYOL_SUPPLIER_ID;
  const apiKey = process.env.TRENDYOL_API_KEY;
  const apiSecret = process.env.TRENDYOL_API_SECRET;
  const userAgent = process.env.TRENDYOL_USER_AGENT || (sellerId ? `${sellerId} - SelfIntegration` : '');

  if (!sellerId || !apiKey || !apiSecret || !userAgent) {
    return null;
  }

  return {
    sellerId,
    apiKey,
    apiSecret,
    userAgent
  };
}

function normalizeProduct(item) {
  return {
    title: item.title || '',
    barcode: item.barcode || '',
    stockCode: item.stockCode || '',
    quantity: Number(item.quantity || 0),
    salePrice: Number(item.salePrice || 0),
    listPrice: Number(item.listPrice || 0),
    brand: item.brand || '',
    categoryName: item.categoryName || '',
    approved: Boolean(item.approved),
    archived: Boolean(item.archived),
    onSale: item.onSale ?? null,
    lastUpdateDate: item.lastUpdateDate || item.lastModifiedDate || null
  };
}

function getBasicAuth(apiKey, apiSecret) {
  return Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, DEFAULT_HEADERS);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    send(res, 405, { error: 'Bu endpoint sadece stok bilgisini okur.' });
    return;
  }

  const config = getConfig();

  if (!config) {
    send(res, 503, {
      error: 'Trendyol ayarları eksik. Vercel Environment Variables içine TRENDYOL_SELLER_ID, TRENDYOL_API_KEY, TRENDYOL_API_SECRET ve TRENDYOL_USER_AGENT eklemelisin.'
    });
    return;
  }

  try {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const page = Math.max(0, Number.parseInt(requestUrl.searchParams.get('page') || '0', 10) || 0);
    const size = Math.min(100, Math.max(1, Number.parseInt(requestUrl.searchParams.get('size') || '50', 10) || 50));
    const barcode = String(requestUrl.searchParams.get('barcode') || '').trim();
    const stockCode = String(requestUrl.searchParams.get('stockCode') || '').trim();

    const trendyolUrl = new URL(`https://apigw.trendyol.com/integration/product/sellers/${encodeURIComponent(config.sellerId)}/products`);
    trendyolUrl.searchParams.set('approved', 'true');
    trendyolUrl.searchParams.set('archived', 'false');
    trendyolUrl.searchParams.set('page', String(page));
    trendyolUrl.searchParams.set('size', String(size));

    if (barcode) trendyolUrl.searchParams.set('barcode', barcode);
    if (stockCode) trendyolUrl.searchParams.set('stockCode', stockCode);

    const response = await fetch(trendyolUrl, {
      headers: {
        Authorization: `Basic ${getBasicAuth(config.apiKey, config.apiSecret)}`,
        'User-Agent': config.userAgent,
        Accept: 'application/json'
      }
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok) {
      send(res, response.status, {
        error: payload?.message || payload?.errors?.[0]?.message || payload?.exception || 'Trendyol stok bilgisi alınamadı.'
      });
      return;
    }

    const content = Array.isArray(payload.content) ? payload.content : [];

    send(res, 200, {
      page: payload.page ?? page,
      size: payload.size ?? size,
      totalPages: payload.totalPages ?? 0,
      totalElements: payload.totalElements ?? content.length,
      items: content.map(normalizeProduct),
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    send(res, 500, {
      error: error.message || 'Trendyol stok bilgisi alınamadı.'
    });
  }
};
