const {
  DEFAULT_SCOPE,
  buildEmptyMarketPayload,
  buildMarketPayloadFromImportedItems,
  mergeMarketPayloads,
  refreshPublicMarketIndex
} = require('../lib/trendyol-market');
const {
  readMarketCache,
  upsertMarketCache
} = require('../lib/market-cache-store');

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
      send(res, 200, await readMarketCache(DEFAULT_SCOPE));
      return;
    }

    if (req.method === 'POST') {
      const body = await getBody(req).catch(() => ({}));

      if (body.mode === 'import' || Array.isArray(body.items)) {
        const current = await readMarketCache(DEFAULT_SCOPE);
        const imported = buildMarketPayloadFromImportedItems(body.items, {
          terms: Array.isArray(body.terms) ? body.terms : undefined,
          importSource: body.importSource || 'browser-session',
          source: 'browser-session-import'
        });
        const merged = mergeMarketPayloads(current, imported, {
          source: 'browser-session-import'
        });
        send(res, 200, await upsertMarketCache(DEFAULT_SCOPE, merged));
        return;
      }

      const payload = await refreshPublicMarketIndex({
        terms: Array.isArray(body.terms) ? body.terms : undefined,
        pageLimit: body.pageLimit,
        detailLimit: body.detailLimit
      });
      send(res, 200, await upsertMarketCache(DEFAULT_SCOPE, payload));
      return;
    }

    send(res, 405, { error: 'Bu yontem desteklenmiyor.' });
  } catch (error) {
    send(res, error.status || 500, {
      error: error.message || 'Public Trendyol pazari taranamadi.'
    });
  }
};
