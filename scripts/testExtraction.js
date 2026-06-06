/**
 * Manual extraction test — run before deploying.
 * Does NOT require Redis or BullMQ. Requires yt-dlp: pip install yt-dlp
 *
 * Usage: node scripts/testExtraction.js
 */
require('dotenv').config();
const { validateMediaUrl } = require('../src/utils/urlValidator');
const { ytdlpExtract }     = require('../src/extractors/ytdlp');
const { normalizeYtdlp }   = require('../src/utils/normalizer');

const TEST_URLS = [
  'https://www.instagram.com/reel/DZLCRl4Ns6l/',
  // Add more URLs here to test coverage
];

async function run() {
  console.log('\n══════════════════════════════════════');
  console.log('  CPA Media Service — Extraction Test');
  console.log('══════════════════════════════════════\n');

  for (const url of TEST_URLS) {
    console.log(`\n─── ${url}`);

    let validated;
    try {
      validated = validateMediaUrl(url);
      console.log(`  ✅ Valid — platform: ${validated.platform}`);
    } catch (err) {
      console.error(`  ❌ URL rejected: ${err.message}`); continue;
    }

    let raw;
    try {
      console.log('  ⏳ Running yt-dlp...');
      raw = await ytdlpExtract(validated.url);
      console.log(`  ✅ yt-dlp OK — raw fields: ${Object.keys(raw).length}`);
    } catch (err) {
      console.error(`  ❌ yt-dlp failed: ${err.message}`); continue;
    }

    const n = normalizeYtdlp(raw);
    console.log('\n  ── Normalized ──');
    console.log(`  platform:     ${n.platform}`);
    console.log(`  externalId:   ${n.externalId}`);
    console.log(`  title:        ${n.title?.slice(0, 60) || '(null)'}`);
    console.log(`  duration:     ${n.duration}s`);
    console.log(`  videoUrl:     ${n.videoUrl    ? '✅' : '❌ MISSING'}`);
    console.log(`  thumbnail:    ${n.thumbnail   ? '✅' : '❌ MISSING'}`);
    console.log(`  creator:      ${n.creator.username || '(null)'}`);
    console.log(`  views:        ${n.engagement.views    ?? '(null)'}`);
    console.log(`  likes:        ${n.engagement.likes    ?? '(null)'}`);
    console.log(`  comments:     ${n.engagement.comments ?? '(null)'}`);
    console.log(`  completeness: ${n.completeness}/100`);

    if (n.completeness < 60) {
      console.log('\n  ⚠️  Below 60 — Playwright fallback would trigger in production');
    } else {
      console.log('\n  ✅ yt-dlp alone is sufficient for this URL');
    }

    const missingRaw = ['view_count','like_count','comment_count'].filter(f => raw[f] == null);
    if (missingRaw.length) {
      console.log(`\n  ℹ️  Missing raw fields: ${missingRaw.join(', ')} (optional — CPA renders null gracefully)`);
    }
  }

  console.log('\n══════════════════════════════════════\n');
}

run().catch(console.error);
