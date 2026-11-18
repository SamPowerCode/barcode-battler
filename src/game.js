// Pure game rules: barcode -> fighter, items, stats, damage, levelling.
// No DOM access here so it can be unit tested.

export const TYPES = ['STORM', 'SWAMP', 'FLAME'];
export const BEATS = { STORM: 'SWAMP', SWAMP: 'FLAME', FLAME: 'STORM' };
export const ITEMS = { POTION: 'HEALS 40% HP', POWER: 'ST UP 30%', GUARD: 'DF UP 30%' };
export const ITEM_KINDS = ['POTION', 'POWER', 'GUARD'];
export const BAG_MAX = 5;

export const SHAPES = {
  voltmaw: ['..XX..XX..', '.XXXXXXXX.', 'XX.XXXX.XX', 'XXXXXXXXXX', '.XX....XX.', '.XXXXXXXX.', '..XXXXXX..', '.XX.XX.XX.', 'XX..XX..XX', 'X........X'],
  grublin: ['...XXXX...', '..XXXXXX..', '.X.XXXX.X.', 'XXXXXXXXXX', 'X.XXXXXX.X', '..XXXXXX..', '..X.XX.X..', '.XX....XX.', 'XX......XX', '..........'],
  emberkin: ['....XX....', '...XXXX...', '..XX..XX..', '.XXXXXXXX.', 'XX.XXXX.XX', 'XXXXXXXXXX', '.XXX..XXX.', '..XXXXXX..', '.XX.XX.XX.', 'XX......XX'],
};

export const STARTERS = {
  '4901234567894': { name: 'VOLTMAW', type: 'STORM', hp: 3100, st: 820, df: 540, shape: SHAPES.voltmaw },
  '7312058846210': { name: 'GRUBLIN', type: 'SWAMP', hp: 2400, st: 610, df: 900, shape: SHAPES.grublin },
  '5099876543217': { name: 'EMBERKIN', type: 'FLAME', hp: 1900, st: 1040, df: 380, shape: SHAPES.emberkin },
};

const PRE = ['VOLT', 'GRUB', 'EMBER', 'KRAG', 'ZOR', 'MIRE', 'BLAZ', 'SKREE', 'THUN', 'NOX', 'GLOM', 'FANG', 'RUST', 'QUIL', 'BRUX', 'SNARL', 'DREG', 'FLUX', 'MOSS', 'CINDR'];
const SUF = ['MAW', 'LIN', 'KIN', 'OX', 'TUSK', 'ROK', 'ZEL', 'BEAK', 'CLAW', 'GORE', 'NUB', 'FIN', 'SPIK', 'DRAK', 'ITE', 'ON'];

export function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const r10 = (n) => Math.round(n / 10) * 10;
export const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '');
export const isValidLength = (c) => c.length >= 6 && c.length <= 14;

function digitSum(c) { let s = 0; for (const ch of c) s += +ch; return s; }

/** GS1 check digit for the body (all digits except the check digit). */
export function checkDigit(body) {
  let s = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) s += +body[i] * w;
  return (10 - (s % 10)) % 10;
}

/** True for EAN-8, UPC-A, EAN-13 or GTIN-14 with a correct check digit. */
export function validGtin(c) {
  return [8, 12, 13, 14].includes(c.length) && checkDigit(c.slice(0, -1)) === +c[c.length - 1];
}

export function isRare(c) {
  return /(\d)\1{3}/.test(c) || c === [...c].reverse().join('');
}

export function isItem(c) {
  return !STARTERS[c] && digitSum(c) % 9 === 0;
}

export function itemKind(c) {
  return ITEM_KINDS[fnv(c) % ITEM_KINDS.length];
}

export function randomGtin(rand = Math.random) {
  let b = '';
  for (let i = 0; i < 12; i++) b += Math.floor(rand() * 10);
  return b + checkDigit(b);
}

function genShape(r) {
  const P = [0.3, 0.42, 0.55, 0.68, 0.8];
  const rows = [];
  for (let y = 0; y < 10; y++) {
    const left = [];
    for (let x = 0; x < 5; x++) {
      let p = P[x];
      if (y === 0 || y === 9) p *= 0.55;
      if (y >= 7 && x >= 3) p *= 0.6;
      left.push(r() < p ? 'X' : '.');
    }
    rows.push(left);
  }
  // Eyes and a solid head/torso so every monster reads as a creature.
  rows[1][2] = rows[1][3] = 'X';
  rows[2][1] = 'X'; rows[2][2] = '.'; rows[2][3] = 'X'; rows[2][4] = 'X';
  rows[3][1] = rows[3][2] = rows[3][3] = rows[3][4] = 'X';
  for (let y = 4; y < 7; y++) { rows[y][3] = 'X'; rows[y][4] = 'X'; }
  return rows.map((l) => l.join('') + [...l].reverse().join(''));
}

/** Turn a barcode into a level-1 fighter. Same code, same fighter, every time. */
export function derive(code) {
  const base = { code, lv: 1, xp: 0, wins: 0, real: validGtin(code), rare: isRare(code) };
  const s = STARTERS[code];
  if (s) return { ...base, name: s.name, type: s.type, hp: s.hp, st: s.st, df: s.df, shape: s.shape };
  const r = mulberry(fnv(code));
  const m = 1 + (base.real ? 0.1 : 0) + (base.rare ? 0.3 : 0);
  return {
    ...base,
    hp: r10((1500 + r() * 2500) * m),
    st: r10((300 + r() * 800) * m),
    df: r10((200 + r() * 700) * m),
    name: (PRE[Math.floor(r() * PRE.length)] + SUF[Math.floor(r() * SUF.length)]).slice(0, 9),
    type: TYPES[Math.floor(r() * TYPES.length)],
    shape: genShape(r),
  };
}

/** Stats after level scaling (+6% per level). */
export function eff(f) {
  const m = 1 + 0.06 * (f.lv - 1);
  return { hp: r10(f.hp * m), st: r10(f.st * m), df: r10(f.df * m) };
}

export function typeMult(attType, defType) {
  if (BEATS[attType] === defType) return 1.5;
  if (BEATS[defType] === attType) return 0.75;
  return 1;
}

/** One attack. att/def: { type, st, df }. Returns { miss, dmg, crit, mult }. */
export function rollHit(att, def, rand = Math.random) {
  if (rand() < 0.05) return { miss: true, dmg: 0, crit: false, mult: 1 };
  const mult = typeMult(att.type, def.type);
  let d = att.st * (0.85 + rand() * 0.3) * mult - def.df * 0.45;
  const crit = rand() < 0.08;
  if (crit) d *= 1.5;
  return { miss: false, dmg: Math.max(40, r10(d)), crit, mult };
}

export const xpForWin = (foeLv) => 50 + foeLv * 25;
export const XP_FOR_LOSS = 15;

/** Add XP to a fighter (mutates it). Returns { from, to } levels. */
export function applyXp(f, gain) {
  const from = f.lv;
  f.xp += gain;
  while (f.xp >= f.lv * 100) { f.xp -= f.lv * 100; f.lv++; }
  return { from, to: f.lv };
}
