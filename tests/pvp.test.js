import { describe, it, expect } from 'vitest';
import { mulberry, derive } from '../src/game.js';
import {
  randomRoom, parseRoom, ROOM_ALPHABET, fighterFromWire, makePvpState, pvpStep, sanitizeState,
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
