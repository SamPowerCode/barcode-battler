// Generates the app icons (PNG) without any image library.
// Run: npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { SHAPES } from '../src/game.js';

const SHELL = [0x2a, 0x3a, 0x9e];
const BEZEL = [0x12, 0x16, 0x3a];
const LCD = [0xa3, 0xae, 0x80];
const INK = [0x1f, 0x2a, 0x14];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 3 + 1) + 1 + x * 3;
      const [r, g, b] = px(x, y);
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function inRoundRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// `inset` = fraction of the icon the LCD occupies (smaller for maskable safe zone).
function icon(size, inset) {
  const bez = Math.round(size * inset);
  const bez0 = Math.round((size - bez) / 2);
  const lcdW = Math.round(bez * 0.86);
  const lcd0 = Math.round((size - lcdW) / 2);
  const cell = Math.floor((lcdW * 0.72) / 10);
  const spr0 = Math.round((size - cell * 10) / 2);
  const shape = SHAPES.voltmaw;
  return encodePng(size, (x, y) => {
    if (!inRoundRect(x, y, bez0, bez0, bez, bez, bez * 0.14)) return SHELL;
    if (!inRoundRect(x, y, lcd0, lcd0, lcdW, lcdW, lcdW * 0.06)) return BEZEL;
    const cx = Math.floor((x - spr0) / cell);
    const cy = Math.floor((y - spr0) / cell);
    const gap = (x - spr0) % cell >= cell - Math.max(1, Math.round(cell / 8)) || (y - spr0) % cell >= cell - Math.max(1, Math.round(cell / 8));
    if (cx >= 0 && cx < 10 && cy >= 0 && cy < 10 && !gap && shape[cy][cx] === 'X') return INK;
    return LCD;
  });
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', icon(192, 0.78));
writeFileSync('public/icons/icon-512.png', icon(512, 0.78));
writeFileSync('public/icons/maskable-512.png', icon(512, 0.6));
writeFileSync('public/icons/apple-touch-icon.png', icon(180, 0.74));

// SVG favicon from the same sprite.
let rects = '';
SHAPES.voltmaw.forEach((row, y) => [...row].forEach((c, x) => {
  if (c === 'X') rects += `<rect x="${10 + x * 4.4}" y="${10 + y * 4.4}" width="4" height="4"/>`;
}));
writeFileSync('public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2A3A9E"/><rect x="6" y="6" width="52" height="52" rx="6" fill="#A3AE80"/><g fill="#1F2A14">${rects}</g></svg>\n`);
console.log('icons written');
