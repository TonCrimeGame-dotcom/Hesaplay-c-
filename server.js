const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(ROOT, 'data', 'records.json');
const NOTES_FILE = process.env.NOTES_FILE
  ? path.resolve(process.env.NOTES_FILE)
  : path.join(ROOT, 'data', 'notes.json');
const DATA_DIR = path.dirname(DATA_FILE);
const DEFAULT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

async function readRecords() {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    const records = JSON.parse(content);
    return Array.isArray(records) ? records : [];
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

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/trendyol-stock') {
    try {
      send(res, 200, await getTrendyolStock(url));
    } catch (error) {
      send(res, error.status || 500, { error: error.message || 'Trendyol stok bilgisi alınamadı.' });
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
    const name = String(body.name || '').trim().slice(0, 80);

    if (!name) {
      send(res, 400, { error: 'Kayıt adı gerekli.' });
      return;
    }

    const calculation = calculate(body.inputs);
    const record = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      ...calculation
    };

    const records = await readRecords();
    const nextRecords = [record, ...records].slice(0, 500);
    await writeRecords(nextRecords);
    send(res, 201, record);
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
