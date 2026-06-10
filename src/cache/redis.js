const Redis = require('ioredis');
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

const NS = {
  metadata: (platform, id) => `cpa:media:meta:${platform}:${id}`,
  job:      (jobId)         => `cpa:media:job:${jobId}`,
};

const TTL = {
  metadata:  parseInt(process.env.CACHE_TTL_METADATA  || '21600', 10),
  thumbnail: parseInt(process.env.CACHE_TTL_THUMBNAIL || '86400', 10),
  job: 3600,
};

async function cacheGet(key) {
  try {
    const raw = await getClient().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn('[cache] GET failed — falling through', { key, error: err.message });
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

const getMetadata  = (platform, id)   => cacheGet(NS.metadata(platform, id));
const setMetadata  = (platform, id, d) => cacheSet(NS.metadata(platform, id), d, TTL.metadata);
const getJobStatus = (jobId)           => cacheGet(NS.job(jobId));
const setJobStatus = (jobId, status)   => cacheSet(NS.job(jobId), status, TTL.job);

// Add this new function alongside getClient()
function getBullMQClient() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');

  return new Redis(url, {
    tls: url.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ
    connectTimeout: 5000,
  });
}

module.exports = { getClient, getBullMQClient, cacheGet, cacheSet, cacheDel, getMetadata, setMetadata, getJobStatus, setJobStatus, NS, TTL };
