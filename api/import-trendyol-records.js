const DEFAULT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const IMPORT_DEFAULTS = {
  purchasePrice: 0,
  shippingFee: 100,
  commissionRate: 19,
  withholdingRate: 1,
  vatRate: 1,
  saleMode: 'includingVat',
  commissionBase: 'salePrice'
};

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...DEFAULT_HEADERS
  });
  res.end(JSON.stringify(body));
}

function num(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function calculate(inputs = {}) {
  const salePrice = num(inputs.salePrice);
  const purchasePrice = num(inputs.purchasePrice);
  const shippingFee = num(inputs.shippingFee);
  const commissionRate = num(inputs.commissionRate);
  const withholdingRate = num(inputs.withholdingRate);
  const vatRate = num(inputs.vatRate);
  const saleMode = 'includingVat';
  const commissionBase = 'salePrice';
  const saleNet = salePrice / (1 + vatRate / 100);
  const commissionFee = salePrice * (commissionRate / 100);
  const withholdingFee = saleNet * (withholdingRate / 100);
  const profit = salePrice - purchasePrice - shippingFee - commissionFee - withholdingFee;

  return {
    inputs: {
      salePrice,
      purchasePrice,
      shippingFee,
      commissionRate,
      withholdingRate,
      vatRate,
      saleMode,
      commissionBase
    },
    results: {
      saleNet,
      commissionFee,
      withholdingFee,
      profit
    }
  };
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;

  return {
    url: url.replace(/\/$/, ''),
    key
  };
}

function getTrendyolConfig() {
  const sellerId = process.env.TRENDYOL_SELLER_ID || process.env.TRENDYOL_SUPPLIER_ID;
  const apiKey = process.env.TRENDYOL_API_KEY;
  const apiSecret = process.env.TRENDYOL_API_SECRET;
  const userAgent = process.env.TRENDYOL_USER_AGENT || (sellerId ? `${sellerId} - SelfIntegration` : '');

  if (!sellerId || !apiKey || !apiSecret || !userAgent) return null;

  return { sellerId, apiKey, apiSecret, userAgent };
}

function supabaseHeaders(key) {
  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };

  if (!key.startsWith('sb_')) {
    headers.Authorization = `Bearer ${key}`;
  }

  return headers;
}

function basicAuth(apiKey, apiSecret) {
  return Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
}

function normalizeBarcode(value) {
  return String(value || '').trim().toLowerCase();
}

function rowToRecord(row) {
  return {
    id: row.id,
    name: row.name,
    barcode: row.barcode || '',
    createdAt: row.created_at,
    inputs: {
      salePrice: Number(row.sale_price),
      purchasePrice: Number(row.purchase_price),
      shippingFee: Number(row.shipping_fee),
      commissionRate: Number(row.commission_rate),
      withholdingRate: Number(row.withholding_rate),
      vatRate: Number(row.vat_rate),
      saleMode: row.sale_mode,
      commissionBase: row.commission_base
    },
    results: {
      saleNet: Number(row.sale_net),
      commissionFee: Number(row.commission_fee),
      withholdingFee: Number(row.withholding_fee),
      profit: Number(row.profit)
    }
  };
}

function recordToRow(name, barcode, calculation) {
  return {
    name,
    barcode,
    sale_price: calculation.inputs.salePrice,
    purchase_price: calculation.inputs.purchasePrice,
    shipping_fee: calculation.inputs.shippingFee,
    commission_rate: calculation.inputs.commissionRate,
    withholding_rate: calculation.inputs.withholdingRate,
    vat_rate: calculation.inputs.vatRate,
    sale_mode: calculation.inputs.saleMode,
    commission_base: calculation.inputs.commissionBase,
    sale_net: calculation.results.saleNet,
    commission_fee: calculation.results.commissionFee,
    withholding_fee: calculation.results.withholdingFee,
    profit: calculation.results.profit
  };
}

async function fetchSupabase(path, options = {}) {
  const config = getSupabaseConfig();

  if (!config) {
    const error = new Error('Supabase ayarları eksik.');
    error.status = 503;
    throw error;
  }

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(config.key),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || 'Supabase isteği başarısız oldu.');
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function fetchAllSupabaseRows(path, pageSize = 1000, maxRows = 20000) {
  const rows = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const batch = await fetchSupabase(path, {
      headers: { Range: `${offset}-${offset + pageSize - 1}` }
    });

    if (!Array.isArray(batch)) return batch;

    rows.push(...batch);

    if (batch.length < pageSize) break;
  }

  return rows;
}

async function fetchTrendyolPage(page, size) {
  const config = getTrendyolConfig();

  if (!config) {
    const error = new Error('Trendyol ayarları eksik.');
    error.status = 503;
    throw error;
  }

  const url = new URL(`https://apigw.trendyol.com/integration/product/sellers/${encodeURIComponent(config.sellerId)}/products`);
  url.searchParams.set('approved', 'true');
  url.searchParams.set('archived', 'false');
  url.searchParams.set('page', String(page));
  url.searchParams.set('size', String(size));

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${basicAuth(config.apiKey, config.apiSecret)}`,
      'User-Agent': config.userAgent,
      Accept: 'application/json'
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.errors?.[0]?.message || payload?.exception || 'Trendyol ürünleri alınamadı.');
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function getExistingRecordsByBarcode() {
  const rows = await fetchAllSupabaseRows('records?select=*');
  const map = new Map();

  rows.forEach(row => {
    const barcode = normalizeBarcode(row.barcode);
    if (barcode && !map.has(barcode)) {
      map.set(barcode, row);
    }
  });

  return map;
}

async function saveRecordFromProduct(product, existingRow) {
  const barcode = String(product.barcode || '').trim().slice(0, 80);
  const name = String(product.title || barcode || 'Trendyol ürünü').trim().slice(0, 180);
  const salePrice = num(product.salePrice || product.listPrice);
  const purchasePrice = existingRow ? num(existingRow.purchase_price) : IMPORT_DEFAULTS.purchasePrice;
  const calculation = calculate({
    salePrice,
    purchasePrice,
    shippingFee: IMPORT_DEFAULTS.shippingFee,
    commissionRate: IMPORT_DEFAULTS.commissionRate,
    withholdingRate: IMPORT_DEFAULTS.withholdingRate,
    vatRate: IMPORT_DEFAULTS.vatRate
  });
  const row = recordToRow(name, barcode, calculation);

  if (existingRow) {
    const rows = await fetchSupabase(`records?id=eq.${encodeURIComponent(existingRow.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(row)
    });
    return { type: 'updated', record: rowToRecord(rows[0]) };
  }

  const rows = await fetchSupabase('records', {
    method: 'POST',
    body: JSON.stringify(row)
  });
  return { type: 'created', record: rowToRecord(rows[0]) };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, DEFAULT_HEADERS);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    send(res, 405, { error: 'Bu endpoint sadece Trendyol ürünlerini ortak kayıtlara aktarır.' });
    return;
  }

  try {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const size = Math.min(100, Math.max(1, Number.parseInt(requestUrl.searchParams.get('size') || '100', 10) || 100));
    const maxPages = Math.min(25, Math.max(1, Number.parseInt(requestUrl.searchParams.get('maxPages') || '1', 10) || 1));
    const startPage = Math.max(0, Number.parseInt(requestUrl.searchParams.get('startPage') || '0', 10) || 0);
    const existingByBarcode = await getExistingRecordsByBarcode();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let totalPages = startPage + 1;
    let processedPages = 0;

    for (let page = startPage; page < totalPages && page < startPage + maxPages; page += 1) {
      const payload = await fetchTrendyolPage(page, size);
      const products = Array.isArray(payload.content) ? payload.content : [];
      totalPages = Math.max(1, Number(payload.totalPages || 1));
      processedPages += 1;

      for (const product of products) {
        const barcode = normalizeBarcode(product.barcode);
        if (!barcode) {
          skipped += 1;
          continue;
        }

        const existingRow = existingByBarcode.get(barcode);
        const saved = await saveRecordFromProduct(product, existingRow);

        if (saved.type === 'updated') {
          updated += 1;
        } else {
          created += 1;
          existingByBarcode.set(barcode, {
            id: saved.record.id,
            barcode: saved.record.barcode,
            purchase_price: saved.record.inputs.purchasePrice
          });
        }
      }
    }

    send(res, 200, {
      ok: true,
      created,
      updated,
      skipped,
      processedPages,
      totalPages,
      nextPage: startPage + processedPages,
      hasMore: startPage + processedPages < totalPages
    });
  } catch (error) {
    send(res, error.status || 500, {
      error: error.message || 'Trendyol ürünleri ortak kayıtlara aktarılamadı.'
    });
  }
};
