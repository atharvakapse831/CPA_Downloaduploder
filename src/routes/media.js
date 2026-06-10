const { Router } = require('express');
const { z }      = require('zod');
const { validateMediaUrl }           = require('../utils/urlValidator');
const { extractMetadata,
        enqueueDownload }            = require('../services/mediaService');
const { getJobStatus }               = require('../cache/redis');
const logger                         = require('../utils/logger');

const router = Router();

// ✅ FIX: body now accepts jobId + callbackUrl alongside url
const ingestSchema = z.object({
  url:         z.string().min(1).max(2048),
  jobId:       z.string().min(1).max(64),
  callbackUrl: z.string().url(),
});

const infoSchema = z.object({ url: z.string().min(1).max(2048) });

// ── POST /api/media/info — synchronous metadata only ─────────────────────
router.post('/info', async (req, res) => {
  const parsed = infoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });

  let validated;
  try { validated = validateMediaUrl(parsed.data.url); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  try {
    const metadata = await extractMetadata(validated.url, validated.platform);
    return res.json({ ok: true, data: metadata });
  } catch (err) {
    logger.error('[route] /info failed', { url: validated.url, error: err.message });
    const statusMap = {
      YTDLP_AUTH_REQUIRED:      403,
      YTDLP_CONTENT_UNAVAILABLE: 404,
      YTDLP_TIMEOUT:            408,
    };
    const match = Object.entries(statusMap).find(([k]) => err.message.startsWith(k));
    return res.status(match ? match[1] : 502).json({ error: err.message });
  }
});

// ── POST /api/media/ingest — async download + S3 upload + callback ────────
router.post('/ingest', async (req, res) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn('[route] /ingest bad body', { issues: parsed.error.issues });
    return res.status(400).json({ error: 'url, jobId, and callbackUrl are all required' });
  }

  let validated;
  try { validated = validateMediaUrl(parsed.data.url); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const { jobId, callbackUrl } = parsed.data;

  try {
    // Enqueue the download job — returns immediately
    await enqueueDownload({
      url:         validated.url,
      platform:    validated.platform,
      jobId,
      callbackUrl,
    });

    return res.status(202).json({
      ok: true,
      jobId,
      message: 'Download queued. Callback will fire when complete.',
    });
  } catch (err) {
    logger.error('[route] /ingest enqueue failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to enqueue download' });
  }
});

// ── GET /api/media/status/:jobId — poll async job ─────────────────────────
router.get('/status/:jobId', async (req, res) => {
  const { jobId } = req.params;
  if (!jobId || jobId.length > 64) return res.status(400).json({ error: 'Invalid jobId' });

  const status = await getJobStatus(jobId);
  if (!status) return res.status(404).json({ error: 'Job not found or expired' });
  return res.json({ ok: true, ...status });
});

module.exports = router;
