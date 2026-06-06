const { Router } = require('express');
const { z }      = require('zod');
const { validateMediaUrl }                            = require('../utils/urlValidator');
const { extractMetadata, enqueueMetadataExtraction }  = require('../services/mediaService');
const { getJobStatus }                                = require('../cache/redis');
const logger                                          = require('../utils/logger');

const router     = Router();
const bodySchema = z.object({ url: z.string().min(1).max(2048) });

// ── POST /api/media/info — synchronous extraction ─────────────────────────
router.post('/info', async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });

  let validated;
  try { validated = validateMediaUrl(parsed.data.url); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  try {
    const metadata = await extractMetadata(validated.url, validated.platform);
    return res.json({ ok: true, data: metadata });
  } catch (err) {
    logger.error('[route] /info failed', { url: validated.url, error: err.message });
    const statusMap = { YTDLP_AUTH_REQUIRED: 403, YTDLP_CONTENT_UNAVAILABLE: 404, YTDLP_TIMEOUT: 408 };
    const match = Object.entries(statusMap).find(([k]) => err.message.startsWith(k));
    return res.status(match ? match[1] : 502).json({ error: err.message });
  }
});

// ── POST /api/media/ingest — async, returns jobId immediately ─────────────
router.post('/ingest', async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });

  let validated;
  try { validated = validateMediaUrl(parsed.data.url); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  try {
    const { jobId } = await enqueueMetadataExtraction(validated.url, validated.platform);
    return res.status(202).json({
      ok: true, jobId,
      message: 'Queued. Poll /api/media/status/:jobId for result.',
    });
  } catch (err) {
    logger.error('[route] /ingest failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to enqueue extraction' });
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
