import { describe, it, expect } from 'vitest';
import {
  checkDigit, validGtin, derive, eff, isItem, randomGtin, rollHit, typeMult, applyXp, isRare, STARTERS, mulberry,
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
