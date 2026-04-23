const {
  DEFAULT_SCOPE,
  buildEmptyMarketPayload,
  refreshPublicMarketIndex
} = require('../lib/trendyol-market');

const DEFAULT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function fetchSupabase(path, options = {}) {
  const config = getSupabaseConfig();

  if (!config) {
    const error = new Error('Supabase ayarlari eksik. SUPABASE_URL ve SUPABASE_SECRET_KEY gerekli.');
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
    const error = new Error(payload?.message || payload?.error || 'Supabase istegi basarisiz oldu.');
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Istek cok buyuk.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Gecersiz JSON.'));
      }
    });

    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, DEFAULT_HEADERS);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const rows = await fetchSupabase(`market_cache?select=scope,payload,updated_at&scope=eq.${encodeURIComponent(DEFAULT_SCOPE)}`);
      const row = Array.isArray(rows) ? rows[0] : null;
      send(res, 200, row?.payload || buildEmptyMarketPayload());
      return;
    }

    if (req.method === 'POST') {
      const body = await getBody(req).catch(() => ({}));
      const payload = await refreshPublicMarketIndex({
        terms: Array.isArray(body.terms) ? body.terms : undefined,
        pageLimit: body.pageLimit,
        detailLimit: body.detailLimit
      });

      const rows = await fetchSupabase('market_cache', {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify({
          scope: DEFAULT_SCOPE,
          payload,
          updated_at: new Date().toISOString()
        })
      });

      send(res, 200, rows?.[0]?.payload || payload);
      return;
    }

    send(res, 405, { error: 'Bu yontem desteklenmiyor.' });
  } catch (error) {
    send(res, error.status || 500, {
      error: error.message || 'Public Trendyol pazari taranamadi.'
    });
  }
};
