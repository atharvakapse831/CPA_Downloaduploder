const logger = require('../utils/logger');

/**
 * Playwright fallback extractor — intercepts Instagram GraphQL/API responses.
 *
 * DISABLED by default. Enable when ready:
 *   npm install playwright
 *   npx playwright install chromium
 *   Uncomment code below.
 *
 * The worker already calls this when yt-dlp completeness < 60.
 * No other changes needed to activate it.
 */
async function playwrightExtract(url) {
  logger.info('[playwright] Fallback extractor activated', { url });

  // --- Uncomment below when Playwright is installed ---
  //
  // const { chromium } = require('playwright');
  // const browser = await chromium.launch({ headless: true });
  // const context = await browser.newContext({
  //   userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  //              'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  // });
  // const page = await context.newPage();
  // const captured = [];
  //
  // page.on('response', async (response) => {
  //   const responseUrl = response.url();
  //   if (responseUrl.includes('/graphql/query') || responseUrl.includes('/api/v1/')) {
  //     try { captured.push(await response.json()); } catch {}
  //   }
  // });
  //
  // try {
  //   await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  // } finally {
  //   await browser.close();
  // }
  //
  // return normalizePlaywrightCaptures(captured);

  throw new Error('PLAYWRIGHT_NOT_INSTALLED');
}

module.exports = { playwrightExtract };
