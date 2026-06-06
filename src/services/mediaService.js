const { ytdlpExtract }      = require('../extractors/ytdlp');
const { normalizeYtdlp }    = require('../utils/normalizer');
const { getMetadata, setMetadata } = require('../cache/redis');
const { enqueueExtraction } = require('../queue/mediaQueue');
const logger                = require('../utils/logger');
const { v4: uuidv4 }        = require('uuid');

const COMPLETENESS_THRESHOLD = 60;

/**
 * Synchronous extraction.
 * Flow: Redis → yt-dlp → (async Playwright job if low completeness)
 */
async function extractMetadata(url, platform) {
  // URL-based cache key for first lookup (before we know externalId)
  const urlKey = `url:${Buffer.from(url).toString('base64').slice(0, 64)}`;
  const cached = await getMetadata(platform, urlKey);
  if (cached) {
    logger.debug('[service] Cache hit', { urlKey });
    return { ...cached, fromCache: true };
  }

  const rawData   = await ytdlpExtract(url); // throws on failure
  const normalized = normalizeYtdlp(rawData);
  const externalId = normalized.externalId || urlKey;

  // Cache by both keys for future lookups
  await setMetadata(platform, urlKey,     normalized);
  await setMetadata(platform, externalId, normalized);

  // Enqueue Playwright enrichment if completeness is low
  if (normalized.completeness < COMPLETENESS_THRESHOLD) {
    const jobId = uuidv4();
    logger.info('[service] Low completeness — queuing enrichment', { score: normalized.completeness, jobId });
    enqueueExtraction({ url, platform, jobId }).catch(err =>
      logger.warn('[service] Failed to enqueue fallback', { error: err.message })
    );
    normalized._enrichmentJobId = jobId;
  }

  return { ...normalized, fromCache: false };
}

/**
 * Async-only extraction — enqueues job, returns jobId immediately.
 */
async function enqueueMetadataExtraction(url, platform) {
  const jobId = uuidv4();
  await enqueueExtraction({ url, platform, jobId });
  return { jobId };
}

module.exports = { extractMetadata, enqueueMetadataExtraction };
