const { execFile } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

const TIMEOUT_MS  = parseInt(process.env.YTDLP_TIMEOUT_MS      || '30000',     10);
const MAX_BUFFER  = parseInt(process.env.YTDLP_MAX_BUFFER_BYTES || '10485760',  10);

/**
 * Extracts metadata using yt-dlp.
 * Uses execFile (NOT exec) — URL is passed as an array arg, never interpolated into shell.
 */
async function ytdlpExtract(url) {
  const args = [
    '--dump-single-json',
    '--no-download',
    '--no-warnings',
    '--no-playlist',
    '--quiet',
    '--format', 'bestvideo+bestaudio/best',
    url,
  ];

  logger.debug('[yt-dlp] Starting extraction', { url });

  let stdout;
  try {
    ({ stdout } = await execFileAsync('yt-dlp', args, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      shell: false,   // MUST be false — prevents shell injection
    }));
  } catch (err) {
    const msg = err.stderr || err.message || 'yt-dlp failed';
    logger.warn('[yt-dlp] Extraction failed', { url, error: msg });

    if (msg.includes('login') || msg.includes('Sign in')) throw new Error('YTDLP_AUTH_REQUIRED');
    if (msg.includes('not available') || msg.includes('removed'))  throw new Error('YTDLP_CONTENT_UNAVAILABLE');
    if (err.killed) throw new Error('YTDLP_TIMEOUT');
    throw new Error(`YTDLP_ERROR: ${msg.slice(0, 200)}`);
  }

  let raw;
  try { raw = JSON.parse(stdout); }
  catch { throw new Error('YTDLP_INVALID_JSON'); }

  logger.debug('[yt-dlp] Extraction succeeded', { url, id: raw.id });
  return raw;
}

module.exports = { ytdlpExtract };
