# cpa-media-service

Internal media extraction microservice for Code Plus Academy.

Extracts metadata from Instagram Reels, YouTube Shorts, TikTok, and other platforms using yt-dlp as the primary engine, with a Playwright fallback and Redis caching.

---

## Architecture

```
POST /api/media/info (sync)
POST /api/media/ingest (async)
GET  /api/media/status/:jobId
GET  /api/health

Request
  ↓
Service Key Auth (x-cpa-service-key)
  ↓
Rate Limiter (Redis-backed, 30 req/min)
  ↓
Redis Cache (6h TTL)
  ↓ miss
yt-dlp Extractor
  ↓ completeness < 60
Playwright Fallback (via BullMQ worker)
  ↓
Normalizer → CPA MediaAsset schema
  ↓
Cache write + Response
```

---

## Prerequisites

```bash
# Node.js 18+
node --version

# yt-dlp (required)
pip install yt-dlp
yt-dlp --version

# Playwright (optional — only needed for fallback)
npm install playwright
npx playwright install chromium
```

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill environment variables
cp .env.example .env

# 3. Test yt-dlp extraction before starting the server
node scripts/testExtraction.js

# 4. Start the API server
npm run dev

# 5. Start the BullMQ worker (separate terminal)
npm run worker
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `REDIS_URL` | Yes | Upstash Redis TLS URL (`rediss://`) |
| `CPA_SERVICE_KEY` | Yes (prod) | Shared secret — sent as `x-cpa-service-key` |
| `ALLOWED_ORIGINS` | Yes | Comma-separated CORS origins |
| `PORT` | No | Server port (default: 4000) |
| `YTDLP_TIMEOUT_MS` | No | yt-dlp subprocess timeout (default: 30000) |
| `CACHE_TTL_METADATA` | No | Metadata cache TTL in seconds (default: 21600) |
| `CACHE_TTL_THUMBNAIL` | No | Thumbnail cache TTL in seconds (default: 86400) |
| `RATE_LIMIT_MAX` | No | Max requests per window per IP (default: 30) |

---

## API Reference

### POST /api/media/info

Synchronous extraction. Waits for yt-dlp and returns metadata directly.

```bash
curl -X POST http://localhost:4000/api/media/info \
  -H "Content-Type: application/json" \
  -H "x-cpa-service-key: your-key" \
  -d '{"url": "https://www.instagram.com/reel/DZLCRl4Ns6l/"}'
```

Response:
```json
{
  "ok": true,
  "data": {
    "externalId": "DZLCRl4Ns6l",
    "platform": "instagram",
    "title": "...",
    "description": "...",
    "duration": 24,
    "videoUrl": "https://...",
    "thumbnail": "https://...",
    "creator": {
      "username": "...",
      "displayName": "..."
    },
    "engagement": {
      "views": 12345,
      "likes": 567,
      "comments": null
    },
    "completeness": 80,
    "fromCache": false
  }
}
```

### POST /api/media/ingest

Async extraction. Returns a jobId immediately.

```bash
curl -X POST http://localhost:4000/api/media/ingest \
  -H "Content-Type: application/json" \
  -H "x-cpa-service-key: your-key" \
  -d '{"url": "https://www.instagram.com/reel/DZLCRl4Ns6l/"}'
```

Response:
```json
{
  "ok": true,
  "jobId": "uuid-here",
  "message": "Extraction queued. Poll /api/media/status/:jobId for result."
}
```

### GET /api/media/status/:jobId

Poll for async job result.

```json
{
  "ok": true,
  "status": "complete",
  "jobId": "uuid-here",
  "result": { ... }
}
```

Status values: `pending` | `processing` | `complete` | `failed`

---

## Calling from CPA Backend

```javascript
// src/services/mediaService.js (in cpa-backend)

const MEDIA_SERVICE_URL = process.env.MEDIA_SERVICE_URL; // e.g. https://cpa-media-service.onrender.com
const MEDIA_SERVICE_KEY = process.env.CPA_SERVICE_KEY;

async function getReelMetadata(url) {
  const res = await fetch(`${MEDIA_SERVICE_URL}/api/media/info`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cpa-service-key': MEDIA_SERVICE_KEY,
    },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Media service error');
  }

  const { data } = await res.json();
  return data;
}
```

---

## Deployment (Render)

```bash
# Render reads render.yaml automatically.
# Set these env vars in the Render dashboard (marked sync: false):
#   REDIS_URL
#   CPA_SERVICE_KEY
#   ALLOWED_ORIGINS
```

yt-dlp is installed via `pip install yt-dlp` in the build command.
The worker must be deployed as a separate Render Background Worker
pointing to `npm run worker`.

---

## Adding the Playwright Fallback

When you're ready to enable Playwright:

1. `npm install playwright`
2. `npx playwright install chromium`
3. Uncomment the code in `src/extractors/playwright.js`
4. Add to `render.yaml` build command: `npx playwright install chromium`

The worker already calls `playwrightExtract` when completeness < 60.
No other changes needed.

---

## File Structure

```
cpa-media-service/
├── scripts/
│   └── testExtraction.js     ← run this first before deploying
├── src/
│   ├── cache/
│   │   └── redis.js          ← Upstash Redis client + domain helpers
│   ├── extractors/
│   │   ├── ytdlp.js          ← primary extractor (execFile, no shell)
│   │   └── playwright.js     ← fallback extractor (stub, ready to enable)
│   ├── middleware/
│   │   └── serviceKeyAuth.js ← x-cpa-service-key validation
│   ├── queue/
│   │   ├── mediaQueue.js     ← BullMQ queue definition
│   │   └── worker.js         ← BullMQ worker (run as separate process)
│   ├── routes/
│   │   └── media.js          ← /api/media/* route handlers
│   ├── services/
│   │   └── mediaService.js   ← extraction orchestration layer
│   ├── utils/
│   │   ├── logger.js         ← Winston logger
│   │   ├── normalizer.js     ← yt-dlp → CPA MediaAsset schema
│   │   └── urlValidator.js   ← URL validation + platform detection
│   └── server.js             ← Express app entry point
├── .env.example
├── package.json
└── render.yaml
```
