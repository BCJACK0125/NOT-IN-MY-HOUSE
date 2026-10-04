// Record media/trailer.webm by playing the game's trailer director in Chrome.
//
//   python -m http.server 8137            (in the project root)
//   node tools/record-trailer.cjs [out.webm] [playwright-module-path]
//
// Needs Playwright (npm i -D playwright) and a local Chrome. The page records
// itself (canvas + WebAudio → MediaRecorder); this script only drives it and
// writes the chunks to disk. Remux afterwards for a seekable file:
//   ffmpeg -i out.webm -c copy media/trailer.webm
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || 'trailer-raw.webm');
const { chromium } = require(process.argv[3] || 'playwright');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.text().startsWith('[autopilot]')) console.log(m.text()); });
  fs.writeFileSync(out, Buffer.alloc(0));
  let bytes = 0;
  await page.exposeFunction('__saveChunk', (b64) => {
    const buf = Buffer.from(b64, 'base64');
    bytes += buf.length;
    fs.appendFileSync(out, buf);
  });
  await page.goto('http://localhost:8137/index.html');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  const t0 = Date.now();
  const mime = await page.evaluate(async () => {
    const { recordTrailer } = await import('/tools/trailer.js');
    return recordTrailer(window.app, (b64) => window.__saveChunk(b64));
  });
  console.log(`recorded ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(bytes / 1048576).toFixed(1)} MB, ${mime} → ${out}`);
  await browser.close();
})();
