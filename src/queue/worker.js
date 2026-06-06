require('dotenv').config();
const { Worker }            = require('bullmq');
const { getClient }         = require('../cache/redis');
const { ytdlpExtract }      = require('../extractors/ytdlp');
const { playwrightExtract } = require('../extractors/playwright');
const { normalizeYtdlp }    = require('../utils/normalizer');
const { setMetadata, setJobStatus } = require('../cache/redis');
const logger                = require('../utils/logger');
const { QUEUE_NAME }        = require('./mediaQueue');

const COMPLETENESS_THRESHOLD = 60;

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { url, platform, jobId } = job.data;
    logger.info('[worker] Processing job', { jobId, url });
    await setJobStatus(jobId, { status: 'processing', jobId, url });

    // ── Step 1: yt-dlp ────────────────────────────────────────────────────
    let rawData = null;
    let source  = 'ytdlp';
    try {
      rawData = await ytdlpExtract(url);
    } catch (err) {
      logger.warn('[worker] yt-dlp failed', { jobId, error: err.message });
      const fatal = ['YTDLP_CONTENT_UNAVAILABLE', 'YTDLP_AUTH_REQUIRED'];
      if (fatal.some(e => err.message.startsWith(e))) {
        await setJobStatus(jobId, { status: 'failed', jobId, error: err.message });
        throw err;
      }
    }

    // ── Step 2: Normalise ─────────────────────────────────────────────────
    let normalized = rawData ? normalizeYtdlp(rawData) : null;

    // ── Step 3: Playwright fallback ───────────────────────────────────────
    if (!normalized || normalized.completeness < COMPLETENESS_THRESHOLD) {
      logger.info('[worker] Playwright fallback', { jobId, score: normalized?.completeness ?? 0 });
      try {
        const pw = await playwrightExtract(url);
        normalized = { ...(pw || {}), ...(normalized || {}), completeness: 100 };
        source = 'playwright';
      } catch (err) {
        logger.warn('[worker] Playwright also failed', { jobId, error: err.message });
      }
    }

    if (!normalized) {
      await setJobStatus(jobId, { status: 'failed', jobId, error: 'All extractors failed' });
      throw new Error('All extractors failed: ' + url);
    }

    // ── Step 4: Cache ─────────────────────────────────────────────────────
    const externalId = normalized.externalId || jobId;
    await setMetadata(platform, externalId, normalized);

    const result = { ...normalized, source, jobId };
    await setJobStatus(jobId, { status: 'complete', jobId, result });
    logger.info('[worker] Job complete', { jobId, completeness: normalized.completeness, source });
    return result;
  },
  { connection: getClient(), concurrency: 5 }
);

worker.on('completed', job  => logger.info('[worker] Succeeded',  { jobId: job.id }));
worker.on('failed',    (job, err) => logger.error('[worker] Failed', { jobId: job?.id, error: err.message }));
worker.on('error',     err  => logger.error('[worker] Error',     { error: err.message }));

logger.info('[worker] Media ingest worker started');
module.exports = { worker };
