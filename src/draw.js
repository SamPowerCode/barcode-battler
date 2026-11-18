// Canvas helpers for pixel sprites and printed barcodes.

export const LCD_INK = '#1F2A14';
export const LCD_GHOST = 'rgba(31,42,20,0.08)';

export function drawSprite(cv, shape, px, ink = LCD_INK, ghost = LCD_GHOST) {
  if (!cv) return;
  cv.width = 10 * px + 9;
  cv.height = 10 * px + 9;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      ctx.fillStyle = shape[y][x] === 'X' ? ink : ghost;
      ctx.fillRect(x * (px + 1), y * (px + 1), px, px);
    }
  }
}

// A decorative barcode drawn from the digits (not a scannable encoding).
function barWidths(code) {
  const a = [];
  for (const ch of code) {
    const d = +ch;
    a.push([((d % 3) + 1) * 2, 1], [(((d + 1) % 2) + 1) * 2, 0], [((d * 7) % 3) + 1, 1], [2, 0]);
  }
  return a;
}

export function drawBars(cv, code, h, color) {
  if (!cv) return;
  const bars = [[2, 1], [2, 0], [2, 1], [2, 0], ...barWidths(code), [2, 1], [2, 0], [2, 1]];
  cv.width = bars.reduce((s, b) => s + b[0], 0);
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = color;
  let x = 0;
  for (const [w, on] of bars) { if (on) ctx.fillRect(x, 0, w, h); x += w; }
}
