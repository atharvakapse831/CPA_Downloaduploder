const { ytdlpExtract }      = require('../extractors/ytdlp');
const { normalizeYtdlp }    = require('../utils/normalizer');
const { getMetadata, setMetadata } = require('../cache/redis');
const { enqueueExtraction } = require('../queue/mediaQueue');
const logger                = require('../utils/logger');
const { v4: uuidv4 }        = require('uuid');

const COMPLETENESS_THRESHOLD = 60;

/**
 * Synchronous metadata extraction (used by /info).
 * Flow: Redis cache → yt-dlp → (async Playwright enrichment if low completeness)
 */
async function extractMetadata(url, platform) {
  const urlKey = `url:${Buffer.from(url).toString('base64').slice(0, 64)}`;
  const cached = await getMetadata(platform, urlKey);
  if (cached) {
    logger.debug('[service] Cache hit', { urlKey });
    return { ...cached, fromCache: true };
  }

  const rawData    = await ytdlpExtract(url);
  const normalized = normalizeYtdlp(rawData);
  const externalId = normalized.externalId || urlKey;

  await setMetadata(platform, urlKey,     normalized);
  await setMetadata(platform, externalId, normalized);

  if (normalized.completeness < COMPLETENESS_THRESHOLD) {
    const jobId = uuidv4();
    logger.info('[service] Low completeness — queuing enrichment', {
      score: normalized.completeness, jobId,
    });
    enqueueExtraction({ url, platform, jobId }).catch(err =>
      logger.warn('[service] Failed to enqueue fallback', { error: err.message })
    );
    normalized._enrichmentJobId = jobId;
  }

  return { ...normalized, fromCache: false };
}

/**
 * ✅ NEW: Async download + S3 upload job.
 *
 * Used by POST /api/media/ingest.
 * Enqueues a full download job (yt-dlp download → S3 upload → callbackUrl).
 * jobId and callbackUrl are provided by the caller (CPA backend via CF Worker).
 */
async function enqueueDownload({ url, platform, jobId, callbackUrl }) {
  await enqueueExtraction({ url, platform, jobId, callbackUrl });
  logger.info('[service] Download job enqueued', { jobId, url });
  return { jobId };
}

module.exports = { extractMetadata, enqueueDownload };
