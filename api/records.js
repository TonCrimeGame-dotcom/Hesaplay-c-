const DEFAULT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return null;
  }

  return {
    url: url.replace(/\/$/, ''),
    key
  };
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

async function getBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body || '{}');
  }

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

async function fetchSupabase(path, options = {}) {
  const config = getSupabaseConfig();

  if (!config) {
    const error = new Error('Supabase ayarları eksik. Vercel Environment Variables içine SUPABASE_URL ve SUPABASE_SECRET_KEY eklemelisin.');
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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, DEFAULT_HEADERS);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const rows = await fetchSupabase('records?select=*&order=profit.desc,created_at.desc&limit=500');
      send(res, 200, rows.map(rowToRecord));
      return;
    }

    if (req.method === 'POST') {
      const body = await getBody(req);
      const name = String(body.name || '').trim().slice(0, 80);
      const barcode = String(body.barcode || '').trim().slice(0, 80);

      if (!name) {
        send(res, 400, { error: 'Kayıt adı gerekli.' });
        return;
      }

      const calculation = calculate(body.inputs);
      const rows = await fetchSupabase('records', {
        method: 'POST',
        body: JSON.stringify(recordToRow(name, barcode, calculation))
      });

      send(res, 201, rowToRecord(rows[0]));
      return;
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      const id = String(url.searchParams.get('id') || '').trim();

      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        send(res, 400, { error: 'Geçersiz kayıt id.' });
        return;
      }

      await fetchSupabase(`records?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' }
      });

      send(res, 200, { ok: true });
      return;
    }

    send(res, 405, { error: 'Bu yöntem desteklenmiyor.' });
  } catch (error) {
    send(res, error.status || 500, {
      error: error.message || 'Sunucu hatası.'
    });
  }
};
