import { describe, expect, it } from 'vitest';
import { getSmartPricingMultiplier } from '../smart';

describe('getSmartPricingMultiplier', () => {
  it('keeps the US as the 1.0 anchor', () => {
    expect(getSmartPricingMultiplier('US', 1, 'apple')).toBe(1);
  });

  it('keeps Canada at approximate US parity', () => {
    expect(getSmartPricingMultiplier('CA', 0.85, 'apple')).toBe(1);
  });

  it('compresses Western European PPP instead of applying raw PPP', () => {
    expect(getSmartPricingMultiplier('ES', 0.65, 'apple')).toBeCloseTo(0.85, 2);
    expect(getSmartPricingMultiplier('SE', 0.88, 'apple')).toBeCloseTo(0.95, 2);
    expect(getSmartPricingMultiplier('NO', 0.99, 'apple')).toBeCloseTo(1.00, 2);
    expect(getSmartPricingMultiplier('CH', 1.14, 'apple')).toBeCloseTo(1.05, 2);
  });

  it('uses an iOS floor for emerging Asia rather than raw 0.2x PPP', () => {
    expect(getSmartPricingMultiplier('IN', 0.22, 'apple')).toBe(0.45);
    expect(getSmartPricingMultiplier('LK', 0.26, 'apple')).toBe(0.45);
  });

  it('allows stronger emerging-market discounts on Google Play', () => {
    const ios = getSmartPricingMultiplier('IN', 0.22, 'apple');
    const android = getSmartPricingMultiplier('IN', 0.22, 'google');
    expect(android).toBeLessThan(ios);
    expect(android).toBeCloseTo(0.34, 2);
  });

  it('lands Latin America near large-app benchmark ranges', () => {
    expect(getSmartPricingMultiplier('BR', 0.48, 'apple')).toBeCloseTo(0.56, 2);
    expect(getSmartPricingMultiplier('MX', 0.57, 'apple')).toBeCloseTo(0.64, 2);
  });

  it('uses compressed PPP for sparse markets', () => {
    expect(getSmartPricingMultiplier('TW', 0.60, 'apple')).toBeCloseTo(0.77, 2);
    expect(getSmartPricingMultiplier('SR', 0.31, 'apple')).toBeCloseTo(0.56, 2);
  });

  it('rejects implausible live-PPP premiums when static PPP says lower-income', () => {
    expect(getSmartPricingMultiplier('AR', 1.8, 'apple', 0.35)).toBeLessThan(0.70);
  });
});
