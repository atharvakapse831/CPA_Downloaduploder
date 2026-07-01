require('dotenv').config();

// ── Instagram cookie auth (decode from env var into a local file) ──────────
const fs = require('fs');
const path = require('path');

if (process.env.IG_COOKIES_B64) {
  const cookiesPath = path.join('/tmp', 'ig_cookies.txt');
  fs.writeFileSync(cookiesPath, Buffer.from(process.env.IG_COOKIES_B64, 'base64').toString('utf-8'));
  process.env.IG_COOKIES_PATH = cookiesPath;
  console.log('Instagram cookies loaded');
}
// ─────────────────────────────────────────────────────────────────────────

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const mediaRouter      = require('./routes/media');
const { serviceKeyAuth } = require('./middleware/serviceKeyAuth');
const { getClient }    = require('./cache/redis');
const logger           = require('./utils/logger');

const app  = express();
app.set('trust proxy', 1); 
const PORT = parseInt(process.env.PORT || '4000', 10);

// ── Security ───────────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                   // server-to-server
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin not allowed — ${origin}`));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-cpa-service-key'],
}));

// ── Body parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '16kb' }));

// ── Rate limiting (Redis-backed) ───────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  max:      parseInt(process.env.RATE_LIMIT_MAX        || '30',    10),
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests. Try again shortly.' }),
}));

// ── Health check (no auth) ─────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  const checks = { server: 'ok', redis: 'unknown', ytdlp: 'unknown' };

  try { await getClient().ping(); checks.redis = 'ok'; }
  catch { checks.redis = 'error'; }

  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const cookieArgs = process.env.IG_COOKIES_PATH ? ['--cookies', process.env.IG_COOKIES_PATH] : [];
    await promisify(execFile)('yt-dlp', [...cookieArgs, '--version'], { timeout: 5000 });
    checks.ytdlp = 'ok';
  } catch { checks.ytdlp = 'error'; }

  const allOk = Object.values(checks).every(v => v === 'ok');
  return res.status(allOk ? 200 : 503).json({ ok: allOk, checks });
});

// ── Media routes (service key required) ───────────────────────────────────
app.use('/api/media', serviceKeyAuth, mediaRouter);

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler ───────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error('[server] Unhandled error', { message: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`[server] cpa-media-service on port ${PORT}`, { env: process.env.NODE_ENV });
});

module.exports = app;