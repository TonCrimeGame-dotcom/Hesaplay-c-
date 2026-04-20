const DEFAULT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password'
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

function getHeader(req, name) {
  return req.headers[name.toLowerCase()] || req.headers[name] || '';
}

function hasAdminAccess(req) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  return Boolean(adminPassword) && getHeader(req, 'x-admin-password') === adminPassword;
}

function rowToNote(row) {
  return {
    id: row.id,
    note: row.note,
    createdAt: row.created_at
  };
}

async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

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
      const rows = await fetchSupabase('notes?select=*&order=created_at.desc&limit=100');
      send(res, 200, rows.map(rowToNote));
      return;
    }

    if (req.method === 'POST') {
      const body = await getBody(req);
      const note = String(body.note || '').trim().slice(0, 500);

      if (!note) {
        send(res, 400, { error: 'Not metni gerekli.' });
        return;
      }

      const rows = await fetchSupabase('notes', {
        method: 'POST',
        body: JSON.stringify({ note })
      });

      send(res, 201, rowToNote(rows[0]));
      return;
    }

    if (req.method === 'DELETE') {
      if (!process.env.ADMIN_PASSWORD) {
        send(res, 503, { error: 'ADMIN_PASSWORD Vercel Environment Variables içine eklenmeli.' });
        return;
      }

      if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        send(res, 503, { error: 'Not silmek için Vercel içine SUPABASE_SECRET_KEY veya SUPABASE_SERVICE_ROLE_KEY eklenmeli.' });
        return;
      }

      if (!hasAdminAccess(req)) {
        send(res, 401, { error: 'Yönetici şifresi hatalı.' });
        return;
      }

      const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      const id = String(url.searchParams.get('id') || '').trim();

      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        send(res, 400, { error: 'Geçersiz not id.' });
        return;
      }

      await fetchSupabase(`notes?id=eq.${encodeURIComponent(id)}`, {
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
