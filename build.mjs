import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const now = new Date();

function fmt(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
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

console.log(`Built public/index.html — ${utc} UTC · ${jst} JST`);
