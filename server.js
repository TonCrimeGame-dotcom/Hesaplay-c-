const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(ROOT, 'data', 'records.json');
const DATA_DIR = path.dirname(DATA_FILE);

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(payload);
}

function sendFile(res, filePath, contentType) {
  return fs.readFile(filePath)
    .then(content => {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
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

async function handleApi(req, res, url) {
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

  send(res, 404, { error: 'API yolu bulunamadı.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

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

    send(res, 404, 'Sayfa bulunamadı.');
  } catch (error) {
    send(res, 500, { error: error.message || 'Sunucu hatası.' });
  }
});

server.listen(PORT, () => {
  console.log(`Site hazır: http://localhost:${PORT}`);
});
