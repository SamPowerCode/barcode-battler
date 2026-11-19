import { describe, it, expect } from 'vitest';
import {
  checkDigit, validGtin, derive, eff, isItem, randomGtin, rollHit, typeMult, applyXp, isRare, STARTERS, mulberry,
  applyItem, expectedHit, cpuBag, cpuChoice,
} from '../src/game.js';

describe('barcodes', () => {
  it('computes GS1 check digits', () => {
    expect(checkDigit('400638133393')).toBe(1);
    expect(validGtin('4006381333931')).toBe(true);
    expect(validGtin('4006381333932')).toBe(false);
    expect(validGtin('036000291452')).toBe(true); // UPC-A
    expect(validGtin('96385074')).toBe(true); // EAN-8
  });

  it('generates valid random EAN-13 codes', () => {
    const r = mulberry(42);
    for (let i = 0; i < 50; i++) {
      const c = randomGtin(r);
      expect(c).toHaveLength(13);
      expect(validGtin(c)).toBe(true);
    }
  });

  it('flags rare codes', () => {
    expect(isRare('5000012345678')).toBe(true);
    expect(isRare('1234554321')).toBe(true);
    expect(isRare('4006381333931')).toBe(false);
  });
});

describe('fighters', () => {
  it('is deterministic', () => {
    expect(derive('4006381333931')).toEqual(derive('4006381333931'));
    expect(derive('4006381333931').name).not.toBe(derive('4006381333948').name + 'x');
  });

  it('keeps starter cards fixed and never items', () => {
    for (const code of Object.keys(STARTERS)) {
      const f = derive(code);
      expect(f.name).toBe(STARTERS[code].name);
      expect(f.hp).toBe(STARTERS[code].hp);
      expect(isItem(code)).toBe(false);
    }
  });

  it('produces stats in range and a 10x10 symmetric sprite', () => {
    const r = mulberry(7);
    for (let i = 0; i < 200; i++) {
      const f = derive(randomGtin(r));
      expect(f.hp).toBeGreaterThanOrEqual(1500);
      expect(f.hp).toBeLessThanOrEqual(5200);
      expect(f.name.length).toBeLessThanOrEqual(9);
      expect(f.shape).toHaveLength(10);
      for (const row of f.shape) {
        expect(row).toHaveLength(10);
        expect(row).toBe([...row].reverse().join(''));
      }
    }
  });

  it('scales stats with level', () => {
    const f = { ...derive('4901234567894'), lv: 6 };
    expect(eff(f).hp).toBe(Math.round((3100 * 1.3) / 10) * 10);
  });
});

describe('battle', () => {
  it('applies the type triangle', () => {
    expect(typeMult('STORM', 'SWAMP')).toBe(1.5);
    expect(typeMult('SWAMP', 'STORM')).toBe(0.75);
    expect(typeMult('FLAME', 'FLAME')).toBe(1);
  });

  it('never deals less than 40 damage on a hit', () => {
    const seq = [0.5, 0, 0.9];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    const hit = rollHit({ type: 'FLAME', st: 100, df: 0 }, { type: 'SWAMP', st: 0, df: 2000 }, rand);
    expect(hit.miss).toBe(false);
    expect(hit.dmg).toBe(40);
  });

  it('levels up with carried-over XP', () => {
    const f = { lv: 1, xp: 90 };
    expect(applyXp(f, 150)).toEqual({ from: 1, to: 2 });
    expect(f.xp).toBe(140);
  });
});

describe('items', () => {
  it('heals 40% capped at max and boosts stats 30%', () => {
    const side = { max: 1000, cur: 900, st: 500, df: 300 };
    expect(applyItem(side, 'POTION')).toEqual({ msg: 'POTION! +400 HP', heal: 400 });
    expect(side.cur).toBe(1000);
    expect(applyItem(side, 'POWER').heal).toBe(0);
    expect(side.st).toBe(650);
    applyItem(side, 'GUARD');
    expect(side.df).toBe(390);
  });
});

describe('cpu', () => {
  const always = () => 0; // rand() < p is always true
  const never = () => 0.99;
  const side = (o) => ({ type: 'STORM', max: 2000, cur: 2000, st: 600, df: 400, used: [], ...o });

  it('gives bigger bags at higher levels, capped at 3', () => {
    expect(cpuBag(1, never)).toHaveLength(0);
    expect(cpuBag(1, always)).toHaveLength(1);
    expect(cpuBag(6, never)).toHaveLength(2);
    expect(cpuBag(20, always)).toHaveLength(3);
    for (const k of cpuBag(9, Math.random)) expect(['POTION', 'POWER', 'GUARD']).toContain(k);
  });

  it('estimates hits with type advantage and a 40 floor', () => {
    expect(expectedHit({ type: 'STORM', st: 600 }, { type: 'SWAMP', df: 400 })).toBe(720);
    expect(expectedHit({ type: 'STORM', st: 100 }, { type: 'FLAME', df: 900 })).toBe(40);
  });

  it('attacks when the bag is empty or a hit would knock out', () => {
    expect(cpuChoice(side({ cur: 100 }), side(), [], always)).toBe(null);
    expect(cpuChoice(side({ cur: 100 }), side({ cur: 200 }), ['POTION'], always)).toBe(null);
  });

  it('drinks a potion when in danger', () => {
    expect(cpuChoice(side({ cur: 500 }), side(), ['POWER', 'POTION'], always)).toBe('POTION');
    expect(cpuChoice(side({ cur: 1900 }), side(), ['POTION'], always)).toBe(null);
  });

  it('guards against heavy hitters and powers up for long fights, once each', () => {
    const brute = side({ st: 1200 });
    expect(cpuChoice(side(), brute, ['GUARD'], always)).toBe('GUARD');
    expect(cpuChoice(side({ used: ['GUARD'] }), brute, ['GUARD'], always)).toBe(null);
    expect(cpuChoice(side(), side(), ['POWER'], always)).toBe('POWER');
    expect(cpuChoice(side({ used: ['POWER'] }), side(), ['POWER'], always)).toBe(null);
    expect(cpuChoice(side(), side(), ['POWER'], never)).toBe(null);
  });
});
