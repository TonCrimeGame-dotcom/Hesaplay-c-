const fs = require('fs');
const path = require('path');
const {
  DEFAULT_SCOPE,
  refreshPublicMarketIndex
} = require('../lib/trendyol-market');
const {
  upsertMarketCache
} = require('../lib/market-cache-store');

function readDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');

  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (!key || process.env[key]) return;

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  });
}

function loadLocalEnv() {
  const root = path.resolve(__dirname, '..');
  readDotEnvFile(path.join(root, '.env.local'));
  readDotEnvFile(path.join(root, '.env'));
}

function parseTerms() {
  const raw = String(process.env.MARKET_TERMS || '').trim();
  if (!raw) return undefined;

  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

async function main() {
  loadLocalEnv();

  const pageLimit = process.env.MARKET_PAGE_LIMIT;
  const detailLimit = process.env.MARKET_DETAIL_LIMIT;
  const terms = parseTerms();

  console.log('Public Trendyol pazar taramasi basliyor...');

  const payload = await refreshPublicMarketIndex({
    terms,
    pageLimit,
    detailLimit
  });

  const saved = await upsertMarketCache(DEFAULT_SCOPE, payload);

  console.log(`Kaydedildi. Toplam urun: ${saved.meta?.totalItems || payload.items.length}`);
  console.log(`Son tarama: ${saved.meta?.indexedAt || payload.meta?.indexedAt || '-'}`);
}

main().catch(error => {
  console.error('Pazar cache yenileme basarisiz oldu.');
  console.error(error.message || error);
  if (error.cause?.message) {
    console.error(`Neden: ${error.cause.message}`);
  }
  if (error.stack) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
