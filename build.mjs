import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const now = new Date();

/**
 * @param {Date} date
 * @param {string} timeZone
 */
function fmt(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  /** @param {Intl.DateTimeFormatPartTypes} t */
  const get = (t) => {
    const part = parts.find((p) => p.type === t);
    if (!part) throw new Error(`missing formatted ${t} part`);
    return part.value;
  };
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

const utc = fmt(now, 'UTC');
const jst = fmt(now, 'Asia/Tokyo');
const iso = now.toISOString();

let html = readFileSync('src/index.html', 'utf8')
  .replaceAll('{{BUILD_UTC}}', utc)
  .replaceAll('{{BUILD_JST}}', jst)
  .replaceAll('{{BUILD_ISO}}', iso);

mkdirSync('public', { recursive: true });
writeFileSync('public/index.html', html);

const staticAssets = ['favicon.svg', 'favicon.png', 'apple-touch-icon.png', 'og.png'];
for (const file of staticAssets) {
  copyFileSync(`assets/${file}`, `public/${file}`);
}

console.log(`Built public/index.html (+${staticAssets.length} assets) — ${utc} UTC · ${jst} JST`);
