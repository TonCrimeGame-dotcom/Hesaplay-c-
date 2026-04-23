const {
  buildEmptyMarketPayload
} = require('./trendyol-market');

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

async function readMarketCache(scope) {
  const rows = await fetchSupabase(`market_cache?select=scope,payload,updated_at&scope=eq.${encodeURIComponent(scope)}`);
  const row = Array.isArray(rows) ? rows[0] : null;
  return row?.payload || buildEmptyMarketPayload();
}

async function upsertMarketCache(scope, payload) {
  const rows = await fetchSupabase('market_cache', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify({
      scope,
      payload,
      updated_at: new Date().toISOString()
    })
  });

  return rows?.[0]?.payload || payload;
}

module.exports = {
  fetchSupabase,
  getSupabaseConfig,
  readMarketCache,
  upsertMarketCache
};
