import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, STATIC_ASSETS, syncAssetCopies } from './scripts/assets.mjs';

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

let html = readFileSync(resolve(REPO_ROOT, 'src/index.html'), 'utf8')
  .replaceAll('{{BUILD_UTC}}', utc)
  .replaceAll('{{BUILD_JST}}', jst)
  .replaceAll('{{BUILD_ISO}}', iso);

const legacyPublic = resolve(REPO_ROOT, 'public');
mkdirSync(legacyPublic, { recursive: true });
writeFileSync(resolve(legacyPublic, 'index.html'), html);

syncAssetCopies(REPO_ROOT, { includeLegacyPublic: true });

console.log(`Built public/index.html and synchronized ${STATIC_ASSETS.length} canonical assets to web/public — ${utc} UTC · ${jst} JST`);
