import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

// Renders the M3E OG card + favicons from their HTML sources via headless
// Chrome. PNG products are committed to assets/; re-run only when og.html /
// icon.html change. CHROME_PATH overrides auto-detection.
const CHROME =
  process.env.CHROME_PATH ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].find(existsSync);

if (!CHROME) {
  console.error('Chrome not found — set CHROME_PATH to chrome.exe');
  process.exit(1);
}

const targets = [
  { src: 'assets/og.html', out: 'assets/og.png', w: 1200, h: 630 },
  { src: 'assets/icon.html', out: 'assets/favicon.png', w: 64, h: 64 },
  { src: 'assets/icon.html', out: 'assets/apple-touch-icon.png', w: 180, h: 180 },
];

for (const t of targets) {
  const url = pathToFileURL(resolve(t.src)).href;
  // Fresh profile per render so back-to-back invocations don't attach to a
  // running Chrome instance and inherit a stale window size.
  const profile = mkdtempSync(join(tmpdir(), 'gsc-render-'));
  try {
    execFileSync(
      CHROME,
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000', // transparent for icon corners
        `--user-data-dir=${profile}`,
        `--window-size=${t.w},${t.h}`,
        '--virtual-time-budget=5000', // let Google Fonts load before capture
        `--screenshot=${resolve(t.out)}`,
        url,
      ],
      { stdio: 'inherit' },
    );
    console.log(`Rendered ${t.out} (${t.w}x${t.h})`);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
