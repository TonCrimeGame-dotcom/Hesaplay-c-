const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const {
  buildEmptyMarketPayload,
  buildMarketPayloadFromImportedItems,
  mergeMarketPayloads,
  refreshPublicMarketIndex
} = require('./lib/trendyol-market');
const {
  runTrendyolCategoryImport
} = require('./scripts/trendyol-playwright-import');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(ROOT, 'data', 'records.json');
const NOTES_FILE = process.env.NOTES_FILE
  ? path.resolve(process.env.NOTES_FILE)
  : path.join(ROOT, 'data', 'notes.json');
const EXPENSE_DATA_FILE = process.env.EXPENSE_DATA_FILE
  ? path.resolve(process.env.EXPENSE_DATA_FILE)
  : path.join(ROOT, 'data', 'expense-records.json');
const MARKET_INDEX_FILE = process.env.MARKET_INDEX_FILE
  ? path.resolve(process.env.MARKET_INDEX_FILE)
  : path.join(ROOT, 'data', 'trendyol-market-index.json');
const DATA_DIR = path.dirname(DATA_FILE);
const DEFAULT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...DEFAULT_HEADERS,
    ...headers
  });
  res.end(payload);
}

function sendNoContent(res) {
  res.writeHead(204, DEFAULT_HEADERS);
  res.end();
}

function sendFile(res, filePath, contentType) {
  return fs.readFile(filePath)
    .then(content => {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        ...DEFAULT_HEADERS
      });
      res.end(content);
    })
    .catch(() => send(res, 404, 'Dosya bulunamadı.'));
}

function num(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeChoice(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function calculate(rawInputs = {}) {
  const salePrice = num(rawInputs.salePrice);
  const purchasePrice = num(rawInputs.purchasePrice);
  const shippingFee = num(rawInputs.shippingFee);
  const commissionRate = num(rawInputs.commissionRate);
  const withholdingRate = num(rawInputs.withholdingRate);
  const vatRate = num(rawInputs.vatRate);
  const saleMode = normalizeChoice(rawInputs.saleMode, ['includingVat', 'excludingVat'], 'includingVat');
  const commissionBase = normalizeChoice(rawInputs.commissionBase, ['salePrice', 'saleNet'], 'salePrice');

  const saleNet = saleMode === 'includingVat'
    ? salePrice / (1 + vatRate / 100)
    : salePrice;

  const commissionCalculationBase = commissionBase === 'saleNet' ? saleNet : salePrice;
  const commissionFee = commissionCalculationBase * (commissionRate / 100);
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

function calculateExpense(rawInputs = {}) {
  const fuelCost = num(rawInputs.fuelCost);
  const carRentalCost = num(rawInputs.carRentalCost);
  const driverCost = num(rawInputs.driverCost);
  const accommodationCost = num(rawInputs.accommodationCost);
  const foodCost = num(rawInputs.foodCost);
  const flightCost = num(rawInputs.flightCost);
  const productCost = num(rawInputs.productCost);
  const productQuantity = num(rawInputs.productQuantity);

  const operatingCost =
    fuelCost
    + carRentalCost
    + driverCost
    + accommodationCost
    + foodCost
    + flightCost;
  const totalCost = operatingCost + productCost;
  const unitCost = productQuantity > 0 ? totalCost / productQuantity : 0;

  return {
    inputs: {
      fuelCost,
      carRentalCost,
      driverCost,
      accommodationCost,
      foodCost,
      flightCost,
      productCost,
      productQuantity
    },
    results: {
      operatingCost,
      totalCost,
      unitCost
    }
  };
}

function normalizeExpenseExchangeRate(rawExchangeRate = {}) {
  return {
    baseCurrency: cleanText(rawExchangeRate.baseCurrency, 10) || 'EUR',
    quoteCurrency: cleanText(rawExchangeRate.quoteCurrency, 10) || 'TRY',
    rate: num(rawExchangeRate.rate),
    date: cleanText(rawExchangeRate.date, 40),
    source: cleanText(rawExchangeRate.source, 80) || 'Guncel kur'
  };
}

async function readRecords() {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    const records = JSON.parse(content);
    if (!Array.isArray(records)) return [];

    return records.map(record => {
      const createdAt = record.createdAt || record.updatedAt || new Date().toISOString();
      return {
        ...record,
        createdAt,
        updatedAt: record.updatedAt || createdAt
      };
    });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeRecords(records) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(records, null, 2), 'utf8');
}

async function readNotes() {
  try {
    const content = await fs.readFile(NOTES_FILE, 'utf8');
    const notes = JSON.parse(content);
    return Array.isArray(notes) ? notes : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeNotes(notes) {
  await fs.mkdir(path.dirname(NOTES_FILE), { recursive: true });
  await fs.writeFile(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf8');
}

async function readExpenseRecords() {
  try {
    const content = await fs.readFile(EXPENSE_DATA_FILE, 'utf8');
    const records = JSON.parse(content);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeExpenseRecords(records) {
  await fs.mkdir(path.dirname(EXPENSE_DATA_FILE), { recursive: true });
  await fs.writeFile(EXPENSE_DATA_FILE, JSON.stringify(records, null, 2), 'utf8');
}

async function readMarketIndex() {
  try {
    const content = await fs.readFile(MARKET_INDEX_FILE, 'utf8');
    const payload = JSON.parse(content);

    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
      return buildEmptyMarketPayload();
    }

    return payload;
  } catch (error) {
    if (error.code === 'ENOENT') return buildEmptyMarketPayload();
    throw error;
  }
}

async function writeMarketIndex(payload) {
  await fs.mkdir(path.dirname(MARKET_INDEX_FILE), { recursive: true });
  await fs.writeFile(MARKET_INDEX_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('İstek çok büyük.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Geçersiz JSON.'));
      }
    });

    req.on('error', reject);
  });
}

function getTrendyolConfig() {
  const sellerId = process.env.TRENDYOL_SELLER_ID || process.env.TRENDYOL_SUPPLIER_ID;
  const apiKey = process.env.TRENDYOL_API_KEY;
  const apiSecret = process.env.TRENDYOL_API_SECRET;
  const userAgent = process.env.TRENDYOL_USER_AGENT || (sellerId ? `${sellerId} - SelfIntegration` : '');

  if (!sellerId || !apiKey || !apiSecret || !userAgent) {
    return null;
  }

  return { sellerId, apiKey, apiSecret, userAgent };
}

function normalizeTrendyolProduct(item) {
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

function getTrendyolAuth(apiKey, apiSecret) {
  return Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
}

async function getTrendyolStock(url) {
  const config = getTrendyolConfig();

  if (!config) {
    const error = new Error('Trendyol ayarları eksik. TRENDYOL_SELLER_ID, TRENDYOL_API_KEY, TRENDYOL_API_SECRET ve TRENDYOL_USER_AGENT eklenmeli.');
    error.status = 503;
    throw error;
  }

  const page = Math.max(0, Number.parseInt(url.searchParams.get('page') || '0', 10) || 0);
  const size = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('size') || '50', 10) || 50));
  const barcode = String(url.searchParams.get('barcode') || '').trim();
  const stockCode = String(url.searchParams.get('stockCode') || '').trim();
  const trendyolUrl = new URL(`https://apigw.trendyol.com/integration/product/sellers/${encodeURIComponent(config.sellerId)}/products`);

  trendyolUrl.searchParams.set('approved', 'true');
  trendyolUrl.searchParams.set('archived', 'false');
  trendyolUrl.searchParams.set('page', String(page));
  trendyolUrl.searchParams.set('size', String(size));
  if (barcode) trendyolUrl.searchParams.set('barcode', barcode);
  if (stockCode) trendyolUrl.searchParams.set('stockCode', stockCode);

  const response = await fetch(trendyolUrl, {
    headers: {
      Authorization: `Basic ${getTrendyolAuth(config.apiKey, config.apiSecret)}`,
      'User-Agent': config.userAgent,
      Accept: 'application/json'
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.errors?.[0]?.message || payload?.exception || 'Trendyol stok bilgisi alınamadı.');
    error.status = response.status;
    throw error;
  }

  const content = Array.isArray(payload.content) ? payload.content : [];

  return {
    page: payload.page ?? page,
    size: payload.size ?? size,
    totalPages: payload.totalPages ?? 0,
    totalElements: payload.totalElements ?? content.length,
    items: content.map(normalizeTrendyolProduct),
    fetchedAt: new Date().toISOString()
  };
}

async function importTrendyolRecords(url) {
  const size = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('size') || '100', 10) || 100));
  const maxPages = Math.min(25, Math.max(1, Number.parseInt(url.searchParams.get('maxPages') || '1', 10) || 1));
  const startPage = Math.max(0, Number.parseInt(url.searchParams.get('startPage') || '0', 10) || 0);
  const records = await readRecords();
  const byBarcode = new Map();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let totalPages = startPage + 1;
  let processedPages = 0;

  records.forEach(record => {
    const barcode = String(record.barcode || '').trim().toLowerCase();
    if (barcode && !byBarcode.has(barcode)) byBarcode.set(barcode, record);
  });

  for (let page = startPage; page < totalPages && page < startPage + maxPages; page += 1) {
    const pageUrl = new URL('http://localhost/api/trendyol-stock');
    pageUrl.searchParams.set('page', String(page));
    pageUrl.searchParams.set('size', String(size));
    const payload = await getTrendyolStock(pageUrl);
    totalPages = Math.max(1, Number(payload.totalPages || 1));
    processedPages += 1;

    payload.items.forEach(item => {
      const barcode = String(item.barcode || '').trim();

      if (!barcode) {
        skipped += 1;
        return;
      }

      const existing = byBarcode.get(barcode.toLowerCase());
      const calculation = calculate({
        salePrice: item.salePrice || item.listPrice || 0,
        purchasePrice: existing?.inputs?.purchasePrice || 0,
        shippingFee: 100,
        commissionRate: 19,
        withholdingRate: 1,
        vatRate: 1,
        saleMode: 'includingVat',
        commissionBase: 'salePrice'
      });
      const record = {
        id: existing?.id || crypto.randomUUID(),
        name: String(item.title || barcode || 'Trendyol ürünü').slice(0, 180),
        barcode: barcode.slice(0, 80),
        createdAt: existing?.createdAt || new Date().toISOString(),
        ...calculation
      };

      if (existing) {
        const index = records.findIndex(item => item.id === existing.id);
        if (index >= 0) records[index] = record;
        updated += 1;
      } else {
        records.unshift(record);
        byBarcode.set(barcode.toLowerCase(), record);
        created += 1;
      }
    });
  }

  await writeRecords(records);

  return {
    ok: true,
    created,
    updated,
    skipped,
    processedPages,
    totalPages,
    nextPage: startPage + processedPages,
    hasMore: startPage + processedPages < totalPages
  };
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/trendyol-market-index') {
    send(res, 410, { error: 'Trendyol pazar indeksi ozelligi kapatildi.' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/trendyol-market-index') {
    send(res, 410, { error: 'Trendyol pazar indeksi ozelligi kapatildi.' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/trendyol-market-import-run') {
    send(res, 410, { error: 'Trendyol import ozelligi kapatildi.' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/trendyol-stock') {
    send(res, 410, { error: 'Trendyol stok cekme ozelligi kapatildi.' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/import-trendyol-records') {
    send(res, 410, { error: 'Trendyol urunlerini ortak kayitlara aktarma ozelligi kapatildi.' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/trendyol-stock') {
    try {
      send(res, 200, await getTrendyolStock(url));
    } catch (error) {
      send(res, error.status || 500, { error: error.message || 'Trendyol stok bilgisi alınamadı.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/import-trendyol-records') {
    try {
      send(res, 200, await importTrendyolRecords(url));
    } catch (error) {
      send(res, error.status || 500, { error: error.message || 'Trendyol ürünleri ortak kayıtlara aktarılamadı.' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/records') {
    const records = await readRecords();
    send(res, 200, records);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/records') {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 180);
    const barcode = String(body.barcode || '').trim().slice(0, 80);

    if (!name) {
      send(res, 400, { error: 'Kayıt adı gerekli.' });
      return;
    }

    const calculation = calculate(body.inputs);
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      name,
      barcode,
      createdAt: now,
      updatedAt: now,
      ...calculation
    };

    const records = await readRecords();
    const nextRecords = [record, ...records];
    await writeRecords(nextRecords);
    send(res, 201, record);
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/records') {
    const id = String(url.searchParams.get('id') || '').trim();

    if (!id) {
      send(res, 400, { error: 'Geçersiz kayıt id.' });
      return;
    }

    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 180);
    const barcode = String(body.barcode || '').trim().slice(0, 80);

    if (!name) {
      send(res, 400, { error: 'Kayıt adı gerekli.' });
      return;
    }

    const calculation = calculate(body.inputs);
    const records = await readRecords();
    const existingRecord = records.find(record => record.id === id);

    if (!existingRecord) {
      send(res, 404, { error: 'Kayit bulunamadi.' });
      return;
    }

    const nextRecords = records.map(record => {
      if (record.id !== id) return record;

      return {
        id,
        name,
        barcode,
        createdAt: record.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...calculation
      };
    });

    await writeRecords(nextRecords);
    send(res, 200, nextRecords.find(record => record.id === id));
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/records') {
    const id = String(url.searchParams.get('id') || '').trim();

    if (!id) {
      send(res, 400, { error: 'Geçersiz kayıt id.' });
      return;
    }

    const records = await readRecords();
    await writeRecords(records.filter(record => record.id !== id));
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/notes') {
    const notes = await readNotes();
    send(res, 200, notes);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/expense-records') {
    const records = await readExpenseRecords();
    send(res, 200, records);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/expense-records') {
    const body = await readBody(req);
    const calculation = calculateExpense(body.inputs);

    if (calculation.inputs.productQuantity <= 0) {
      send(res, 400, { error: 'Alinan urun adedi 0dan buyuk olmali.' });
      return;
    }

    const createdAt = new Date().toISOString();
    const exchangeRate = normalizeExpenseExchangeRate(body.exchangeRate);

    if (!exchangeRate.date) {
      exchangeRate.date = createdAt.slice(0, 10);
    }

    const record = {
      id: crypto.randomUUID(),
      createdAt,
      exchangeRate,
      ...calculation
    };

    const records = await readExpenseRecords();
    await writeExpenseRecords([record, ...records]);
    send(res, 201, record);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/notes') {
    const body = await readBody(req);
    const note = String(body.note || '').trim().slice(0, 500);

    if (!note) {
      send(res, 400, { error: 'Not metni gerekli.' });
      return;
    }

    const newNote = {
      id: crypto.randomUUID(),
      note,
      createdAt: new Date().toISOString()
    };

    const notes = await readNotes();
    await writeNotes([newNote, ...notes].slice(0, 100));
    send(res, 201, newNote);
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/notes') {
    const id = String(url.searchParams.get('id') || '').trim();

    if (!id) {
      send(res, 400, { error: 'Geçersiz not id.' });
      return;
    }

    const notes = await readNotes();
    await writeNotes(notes.filter(note => note.id !== id));
    send(res, 200, { ok: true });
    return;
  }

  send(res, 404, { error: 'API yolu bulunamadı.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      sendNoContent(res);
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== 'GET') {
      send(res, 405, 'Bu yöntem desteklenmiyor.');
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      await sendFile(res, path.join(ROOT, 'index.html'), 'text/html; charset=utf-8');
      return;
    }

    if (url.pathname === '/market-import.html') {
      send(res, 410, 'Trendyol import sayfasi kapatildi.');
      return;
    }

    if (url.pathname === '/scripts/trendyol-browser-import.js') {
      await sendFile(res, path.join(ROOT, 'scripts', 'trendyol-browser-import.js'), 'application/javascript; charset=utf-8');
      return;
    }

    if (url.pathname === '/favicon.ico') {
      sendNoContent(res);
      return;
    }

    if (url.pathname === '/assets/logo.png' || url.pathname === '/assets/logo-cropped.png') {
      await sendFile(res, path.join(ROOT, url.pathname), 'image/png');
      return;
    }

    send(res, 404, 'Sayfa bulunamadı.');
  } catch (error) {
    send(res, 500, { error: error.message || 'Sunucu hatası.' });
  }
});

server.listen(PORT, () => {
  console.log(`Site hazır: http://localhost:${PORT}`);
});
