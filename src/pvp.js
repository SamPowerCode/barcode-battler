// Two-player battle rules. Pure: no DOM, no networking.
// The host phone owns the battle state and runs pvpStep for both players;
// the guest only sends actions and renders the states it receives.

import { TYPES, ITEMS, derive, eff, rollHit, applyItem, digitsOnly, isValidLength } from './game.js';

export const PROTOCOL = 2;
export const TURN_MS = 15000; // time each player has to act
export const MAX_IDLE = 3; // timeouts in a row before a player forfeits
export const SIDES = ['host', 'guest'];
export const other = (side) => (side === 'host' ? 'guest' : 'host');

// No 0/O, 1/I/L, so codes are easy to read aloud and type.
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomRoom(rand = Math.random) {
  let c = '';
  for (let i = 0; i < 4; i++) c += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length)];
  return c;
}
/** Accepts "KZ4Q", "kz4q", or a join link ending in #join-KZ4Q. */
export function parseRoom(text) {
  const s = String(text ?? '').trim().toUpperCase();
  const m = s.match(/#JOIN-([A-Z0-9]{4})$/) || s.match(/^([A-Z0-9]{4})$/);
  if (!m) return null;
  return [...m[1]].every((ch) => ROOM_ALPHABET.includes(ch)) ? m[1] : null;
}

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

/**
 * Rebuild a fighter from what the other phone sent. Only the barcode and the
 * level are taken from the wire; name, type, sprite and stats come from derive().
 */
export function fighterFromWire(msg) {
  const code = digitsOnly(msg?.code);
  if (!isValidLength(code)) return null;
  const f = derive(code);
  f.lv = clampInt(msg.lv, 1, 99);
  return f;
}

function side(f) {
  const e = eff(f);
  return { code: f.code, lv: f.lv, name: f.name, type: f.type, shape: f.shape, max: e.hp, cur: e.hp, st: e.st, df: e.df };
}

/** `round` counts rematches on the same link, so stale messages from an earlier round are ignored. */
export function makePvpState(hostFighter, guestFighter, rand = Math.random, round = 0) {
  return {
    v: PROTOCOL,
    round,
    seq: 0,
    host: side(hostFighter),
    guest: side(guestFighter),
    turn: rand() < 0.5 ? 'host' : 'guest',
    turnMs: TURN_MS,
    idle: { host: 0, guest: 0 },
    msg: 'FIGHT!',
    anim: null,
    over: null,
    forfeit: null,
  };
}

/**
 * Apply one action by `who`: { a: 'atk' }, { a: 'item', kind }, or { a: 'timeout' }
 * (the turn clock ran out: an automatic attack, and MAX_IDLE in a row forfeits).
 * Returns a new state, or the same one if the move is not allowed.
 */
export function pvpStep(state, who, action, rand = Math.random) {
  if (state.over || state.turn !== who || !SIDES.includes(who)) return state;
  const s = structuredClone(state);
  const me = s[who];
  const opp = s[other(who)];
  const timedOut = action?.a === 'timeout';
  s.seq++;
  s.anim = null;
  s.idle = { host: 0, guest: 0, ...s.idle };
  s.idle[who] = timedOut ? s.idle[who] + 1 : 0;

  if (timedOut && s.idle[who] >= MAX_IDLE) {
    s.over = other(who);
    s.forfeit = who;
    s.msg = `${me.name} FORFEITS!`;
    return s;
  }

  if (!timedOut && action?.a === 'item' && ITEMS[action.kind]) {
    const { msg, heal } = applyItem(me, action.kind);
    s.msg = msg;
    if (heal) s.anim = { target: who, text: `+${heal}`, shake: false };
  } else {
    const h = rollHit({ type: me.type, st: me.st }, { type: opp.type, df: opp.df }, rand);
    if (h.miss) {
      s.msg = `${me.name} MISSED!`;
      s.anim = { target: other(who), text: 'MISS', shake: false };
    } else {
      opp.cur = Math.max(0, opp.cur - h.dmg);
      const tag = h.crit ? ' CRIT!' : h.mult > 1 ? ' SUPER!' : h.mult < 1 ? ' WEAK' : '';
      s.msg = timedOut ? `${me.name} AUTO -${h.dmg}` : `${me.name} -${h.dmg}${tag}`;
      s.anim = { target: other(who), text: `-${h.dmg}`, shake: true, crit: h.crit };
    }
  }

  if (opp.cur <= 0) s.over = who;
  else s.turn = other(who);
  return s;
}

const MSG_OK = /^[A-Z0-9 !+\-.]{1,24}$/;

/** Guest side: accept a state from the host only in a safe, well-formed shape. */
export function sanitizeState(raw) {
  if (!raw || raw.v !== PROTOCOL) return null;
  const out = { v: PROTOCOL, round: clampInt(raw.round, 0, 1e6), seq: clampInt(raw.seq, 0, 1e6) };
  for (const k of SIDES) {
    const f = fighterFromWire(raw[k]);
    if (!f) return null;
    const base = side(f);
    const p = raw[k];
    base.max = clampInt(p.max, 1, 1e6);
    base.cur = clampInt(p.cur, 0, base.max);
    base.st = clampInt(p.st, 0, 1e6);
    base.df = clampInt(p.df, 0, 1e6);
    out[k] = base;
  }
  if (!SIDES.includes(raw.turn)) return null;
  out.turn = raw.turn;
  out.turnMs = clampInt(raw.turnMs, 3000, 60000);
  out.idle = { host: clampInt(raw.idle?.host, 0, MAX_IDLE), guest: clampInt(raw.idle?.guest, 0, MAX_IDLE) };
  out.over = SIDES.includes(raw.over) ? raw.over : null;
  out.forfeit = out.over && SIDES.includes(raw.forfeit) ? raw.forfeit : null;
  out.msg = typeof raw.msg === 'string' && MSG_OK.test(raw.msg) ? raw.msg : '...';
  const a = raw.anim;
  out.anim = a && SIDES.includes(a.target) && typeof a.text === 'string' && /^[A-Z0-9+\-]{1,6}$/.test(a.text)
    ? { target: a.target, text: a.text, shake: !!a.shake, crit: !!a.crit }
    : null;
  return out;
}

/** Guest side: should this incoming state replace the current one? */
export function isNewerState(s, cur) {
  if (!cur) return true;
  if (s.round !== cur.round) return s.round > cur.round;
  return s.seq >= cur.seq;
}

export { TYPES };
