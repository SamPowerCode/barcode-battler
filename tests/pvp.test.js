import { describe, it, expect } from 'vitest';
import { mulberry, derive } from '../src/game.js';
import {
  randomRoom, parseRoom, ROOM_ALPHABET, fighterFromWire, makePvpState, pvpStep, sanitizeState, isNewerState,
} from '../src/pvp.js';

const VOLT = '4901234567894';
const GRUB = '7312058846210';

describe('room codes', () => {
  it('generates 4 readable characters', () => {
    const r = mulberry(1);
    for (let i = 0; i < 100; i++) {
      const c = randomRoom(r);
      expect(c).toMatch(/^[A-Z0-9]{4}$/);
      expect([...c].every((ch) => ROOM_ALPHABET.includes(ch))).toBe(true);
    }
  });

  it('parses typed codes and join links', () => {
    expect(parseRoom('kz4q')).toBe('KZ4Q');
    expect(parseRoom(' KZ4Q ')).toBe('KZ4Q');
    expect(parseRoom('https://x.github.io/barcode-battler/#join-KZ4Q')).toBe('KZ4Q');
    expect(parseRoom('KZ0Q')).toBe(null); // 0 is not in the alphabet
    expect(parseRoom('KZ4')).toBe(null);
    expect(parseRoom('https://example.com/')).toBe(null);
  });
});

describe('wire fighters', () => {
  it('rebuilds from the barcode and ignores sent stats', () => {
    const f = fighterFromWire({ code: VOLT, lv: 3, name: '<img onerror=x>', hp: 999999 });
    expect(f.name).toBe('VOLTMAW');
    expect(f.hp).toBe(3100);
    expect(f.lv).toBe(3);
  });

  it('clamps the level and rejects bad codes', () => {
    expect(fighterFromWire({ code: VOLT, lv: 5000 }).lv).toBe(99);
    expect(fighterFromWire({ code: VOLT, lv: -2 }).lv).toBe(1);
    expect(fighterFromWire({ code: '12', lv: 1 })).toBe(null);
    expect(fighterFromWire(null)).toBe(null);
  });
});

describe('pvp battle', () => {
  const start = () => makePvpState(derive(VOLT), derive(GRUB), () => 0.1); // host goes first

  it('only lets the player whose turn it is act', () => {
    const s = start();
    expect(s.turn).toBe('host');
    expect(pvpStep(s, 'guest', { a: 'atk' })).toBe(s);
    const s2 = pvpStep(s, 'host', { a: 'atk' }, () => 0.5);
    expect(s2.turn).toBe('guest');
    expect(s2.seq).toBe(1);
    expect(s2.guest.cur).toBeLessThan(s.guest.cur);
    expect(s.guest.cur).toBe(s.guest.max); // original untouched
  });

  it('applies items to the acting player', () => {
    let s = start();
    s.host.cur = 100;
    s = pvpStep(s, 'host', { a: 'item', kind: 'POTION' });
    expect(s.host.cur).toBe(100 + Math.round((s.host.max * 0.4) / 10) * 10);
    expect(s.turn).toBe('guest');
  });

  it('ends when a fighter reaches 0 HP', () => {
    let s = start();
    s.guest.cur = 10;
    s = pvpStep(s, 'host', { a: 'atk' }, () => 0.5);
    expect(s.over).toBe('host');
    expect(pvpStep(s, 'guest', { a: 'atk' })).toBe(s);
  });
});

describe('turn timer', () => {
  const start = () => makePvpState(derive(VOLT), derive(GRUB), () => 0.1); // host first

  it('auto-attacks when the clock runs out and passes the turn', () => {
    const s = pvpStep(start(), 'host', { a: 'timeout' }, () => 0.5);
    expect(s.turn).toBe('guest');
    expect(s.idle.host).toBe(1);
    expect(s.guest.cur).toBeLessThan(s.guest.max);
    expect(s.msg).toMatch(/^VOLTMAW AUTO -\d+$/);
  });

  it('resets the idle count when the player acts', () => {
    let s = pvpStep(start(), 'host', { a: 'timeout' }, () => 0.5);
    s = pvpStep(s, 'guest', { a: 'atk' }, () => 0.5);
    s = pvpStep(s, 'host', { a: 'atk' }, () => 0.5);
    expect(s.idle.host).toBe(0);
  });

  it('forfeits after three timeouts in a row', () => {
    let s = start();
    s.host.cur = s.guest.cur = 1e6; s.host.max = s.guest.max = 1e6; // nobody gets knocked out
    for (let i = 0; i < 2; i++) {
      s = pvpStep(s, 'host', { a: 'timeout' }, () => 0.5);
      s = pvpStep(s, 'guest', { a: 'atk' }, () => 0.5);
    }
    expect(s.idle.host).toBe(2);
    s = pvpStep(s, 'host', { a: 'timeout' }, () => 0.5);
    expect(s.over).toBe('guest');
    expect(s.forfeit).toBe('host');
    expect(s.msg).toBe('VOLTMAW FORFEITS!');
    expect(sanitizeState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('rematch rounds', () => {
  it('carries the round number and keeps it through sanitizing', () => {
    const s = makePvpState(derive(VOLT), derive(GRUB), () => 0.1, 3);
    expect(s.round).toBe(3);
    expect(sanitizeState(JSON.parse(JSON.stringify(s))).round).toBe(3);
  });

  it('accepts a new round even though its seq restarts, and rejects stale states', () => {
    const r0 = { round: 0, seq: 7 };
    expect(isNewerState({ round: 1, seq: 0 }, r0)).toBe(true);
    expect(isNewerState({ round: 0, seq: 8 }, r0)).toBe(true);
    expect(isNewerState({ round: 0, seq: 6 }, r0)).toBe(false);
    expect(isNewerState({ round: 0, seq: 9 }, { round: 1, seq: 0 })).toBe(false);
    expect(isNewerState({ round: 0, seq: 0 }, null)).toBe(true);
  });
});

describe('sanitizeState', () => {
  it('round-trips a real state', () => {
    const s = pvpStep(makePvpState(derive(VOLT), derive(GRUB), () => 0.1), 'host', { a: 'atk' }, () => 0.5);
    expect(sanitizeState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('strips markup and rejects malformed states', () => {
    const s = makePvpState(derive(VOLT), derive(GRUB), () => 0.1);
    const evil = { ...JSON.parse(JSON.stringify(s)), msg: '<script>alert(1)</script>', anim: { target: 'host', text: '<b>', shake: true } };
    evil.host.name = '<img src=x onerror=alert(1)>';
    const clean = sanitizeState(evil);
    expect(clean.msg).toBe('...');
    expect(clean.anim).toBe(null);
    expect(clean.host.name).toBe('VOLTMAW');
    expect(sanitizeState({ ...s, v: 99 })).toBe(null);
    expect(sanitizeState({ ...s, turn: 'nobody' })).toBe(null);
    expect(sanitizeState(null)).toBe(null);
  });
});
