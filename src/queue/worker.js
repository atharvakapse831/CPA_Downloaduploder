require('dotenv').config();

// ── Instagram cookie auth (decode from env var into a local file) ──────────
const fsCookie = require('fs');
const pathCookie = require('path');

if (process.env.IG_COOKIES_B64) {
  const cookiesPath = pathCookie.join('/tmp', 'ig_cookies.txt');
  fsCookie.writeFileSync(cookiesPath, Buffer.from(process.env.IG_COOKIES_B64, 'base64').toString('utf-8'));
  process.env.IG_COOKIES_PATH = cookiesPath;
  console.log('Instagram cookies loaded (worker)');
}
// ─────────────────────────────────────────────────────────────────────────

const { Worker }            = require('bullmq');
const Redis                 = require('ioredis');
const { execFile }          = require('child_process');
const { promisify }         = require('util');
const fs                    = require('fs');
const path                  = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const { setJobStatus } = require('../cache/redis');
const logger           = require('../utils/logger');
const { QUEUE_NAME }   = require('./mediaQueue');

const execFileAsync = promisify(execFile);

const TMP = process.env.TMP_DIR || '/tmp';

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET || 'cpacontentstream';

// BullMQ needs its own Redis connection with maxRetriesPerRequest: null
const connection = new Redis(process.env.REDIS_URL, {
  tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
  maxRetriesPerRequest: null,
  connectTimeout: 5000,
});

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Downloads video to a temp file using yt-dlp.
 * Returns the local file path.
 */
async function downloadVideo(url, jobId) {
  const outputPath = path.join(TMP, `${jobId}_raw.mp4`);

  const cookieArgs = process.env.IG_COOKIES_PATH
    ? ['--cookies', process.env.IG_COOKIES_PATH]
    : [];

  const args = [
    ...cookieArgs,
    '--no-playlist',
    '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '--output', outputPath,
    '--no-warnings',
    '--quiet',
    url,
  ];

  logger.info('[worker] Downloading video', { jobId, url, usingCookies: cookieArgs.length > 0 });

  try {
    await execFileAsync('yt-dlp', args, {
      timeout: parseInt(process.env.YTDLP_DOWNLOAD_TIMEOUT_MS || '120000', 10),
      shell: false,
    });
  } catch (err) {
    const msg = err.stderr || err.message || 'yt-dlp download failed';
    if (msg.includes('login') || msg.includes('Sign in')) throw new Error('YTDLP_AUTH_REQUIRED');
    if (msg.includes('not available') || msg.includes('removed')) throw new Error('YTDLP_CONTENT_UNAVAILABLE');
    if (err.killed) throw new Error('YTDLP_TIMEOUT');
    throw new Error(`YTDLP_DOWNLOAD_ERROR: ${msg.slice(0, 200)}`);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('YTDLP_NO_OUTPUT: file not written after download');
  }

  logger.info('[worker] Download complete', { jobId, path: outputPath });
  return outputPath;
}

/**
 * Uploads a local file to S3.
 * Returns the S3 key.
 */
async function uploadToS3(localPath, jobId) {
  const s3Key = `raw/${jobId}/video.mp4`;
  const body  = fs.readFileSync(localPath);

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         s3Key,
    Body:        body,
    ContentType: 'video/mp4',
    Metadata:    { job_id: jobId },
  }));

  logger.info('[worker] Uploaded to S3', { jobId, s3Key, bucket: BUCKET });
  return s3Key;
}

/**
 * ✅ THE MISSING PIECE: fires the callbackUrl so the CPA backend
 * knows the download succeeded and can invoke Lambda.
 */
async function fireCallback(callbackUrl, payload) {
  logger.info('[worker] Firing callback', { callbackUrl, jobId: payload.jobId });

  const response = await fetch(callbackUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Callback returned ${response.status}: ${text.slice(0, 100)}`);
  }

  logger.info('[worker] Callback accepted', { callbackUrl, status: response.status });
}

function cleanup(...paths) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {}
  }
}

// ── BullMQ Worker ─────────────────────────────────────────────────────────

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { url, jobId, callbackUrl } = job.data;

    logger.info('[worker] Job started', { jobId, url, hasCallback: !!callbackUrl });
    await setJobStatus(jobId, { status: 'processing', jobId, url });

    let localPath = null;

    try {
      // ── Step 1: Download video to /tmp ──────────────────────────────────
      // Metadata already fetched by meta-fetch service before publish — skip here
      localPath = await downloadVideo(url, jobId);

      // ── Step 2: Upload to S3 ────────────────────────────────────────────
      const s3Key = await uploadToS3(localPath, jobId);

      // ── Step 3: Mark complete in Redis ──────────────────────────────────
      const result = { s3Key, bucket: BUCKET, jobId };
      await setJobStatus(jobId, { status: 'complete', jobId, result });

      // ── Step 5: Fire callback → CPA backend instagramWebhook ────────────
      if (callbackUrl) {
        await fireCallback(callbackUrl, {
          jobId,
          status: 'SUCCESS',
          s3Key,
          bucket: BUCKET,
          videoUrl: null, // Lambda will produce the final CDN URL
        });
      } else {
        logger.warn('[worker] No callbackUrl — job complete but nothing notified', { jobId });
      }

      logger.info('[worker] Job finished', { jobId, s3Key });
      return result;

    } catch (err) {
      logger.error('[worker] Job failed', { jobId, error: err.message });
      await setJobStatus(jobId, { status: 'failed', jobId, error: err.message });

      // Best-effort: notify backend of failure so job doesn't hang forever
      if (callbackUrl) {
        await fireCallback(callbackUrl, {
          jobId,
          status: 'FAILED',
          error: err.message,
        }).catch(cbErr => logger.warn('[worker] Failure callback also failed', { error: cbErr.message }));
      }

      throw err; // Let BullMQ retry
    } finally {
      if (localPath) cleanup(localPath);
    }
  },
  { connection, concurrency: 3 }
);

worker.on('completed', job       => logger.info('[worker] Succeeded', { jobId: job.id }));
worker.on('failed',   (job, err) => logger.error('[worker] Failed',   { jobId: job?.id, error: err.message }));
worker.on('error',     err       => logger.error('[worker] Error',    { error: err.message }));

logger.info('[worker] Media download worker started', { queue: QUEUE_NAME });
module.exports = { worker };