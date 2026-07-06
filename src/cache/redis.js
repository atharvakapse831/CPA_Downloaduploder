const Redis  = require('ioredis');
const logger = require('../utils/logger');

let _client = null;

function getClient() {
  if (_client) return _client;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');

  _client = new Redis(url, {
    tls: url.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
    lazyConnect: true,
  });

  _client.on('error', err => logger.error('[cache] Redis error', { message: err.message }));
  _client.on('ready', ()  => logger.info('[cache] Redis connected'));
  return _client;
}

function getBullMQClient() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  return new Redis(url, {
    tls: url.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
  });
}

const NS = {
  // ── Removed job namespace — job status now tracked in Supabase only
  metadata: (platform, id) => `cpa:meta:${platform}:${id}`,
};

const TTL = {
  // ── Reduced metadata TTL from 6h to 2h to free up storage faster
  metadata: parseInt(process.env.CACHE_TTL_METADATA || '7200', 10),
};

async function cacheGet(key) {
  try {
    const raw = await getClient().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn('[cache] GET failed', { key, error: err.message });
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds) {
  try {
    await getClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn('[cache] SET failed', { key, error: err.message });
  }
}

async function cacheDel(key) {
  try { await getClient().del(key); }
  catch (err) { logger.warn('[cache] DEL failed', { key, error: err.message }); }
}

const getMetadata = (platform, id)    => cacheGet(NS.metadata(platform, id));
const setMetadata = (platform, id, d) => cacheSet(NS.metadata(platform, id), d, TTL.metadata);

// ── Kept as no-ops for backward compat — actual status in Supabase
const getJobStatus = async () => null;
const setJobStatus = async () => null;

module.exports = {
  getClient, getBullMQClient,
  cacheGet, cacheSet, cacheDel,
  getMetadata, setMetadata,
  getJobStatus, setJobStatus,
  NS, TTL,
};
