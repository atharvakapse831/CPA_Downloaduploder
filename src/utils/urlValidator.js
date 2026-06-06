const { z } = require('zod');

const SUPPORTED_PATTERNS = [
  { platform: 'instagram', pattern: /^https:\/\/(www\.)?instagram\.com\/(reel|p)\/[\w-]+\/?/ },
  { platform: 'youtube',   pattern: /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/ },
  { platform: 'tiktok',   pattern: /^https:\/\/(www\.)?tiktok\.com\/@[\w.]+\/video\/\d+/ },
  { platform: 'twitter',  pattern: /^https:\/\/(www\.)?(twitter|x)\.com\/\w+\/status\/\d+/ },
  { platform: 'facebook', pattern: /^https:\/\/(www\.)?facebook\.com\/(watch\/\?v=|reel\/)[\w]+/ },
];

const urlSchema = z.string().url().max(2048);

function validateMediaUrl(rawUrl) {
  const parsed = urlSchema.safeParse(rawUrl);
  if (!parsed.success) throw new Error('Invalid URL format');

  const url = parsed.data.trim();
  if (!url.startsWith('https://')) throw new Error('URL must use HTTPS');

  const match = SUPPORTED_PATTERNS.find(({ pattern }) => pattern.test(url));
  if (!match) {
    throw new Error(
      `Unsupported platform. Supported: ${SUPPORTED_PATTERNS.map(p => p.platform).join(', ')}`
    );
  }
  return { url, platform: match.platform };
}

module.exports = { validateMediaUrl };
