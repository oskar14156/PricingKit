import { describe, expect, it } from 'vitest';
import { getSmartPricingMultiplier } from '../smart';
import { calculateRegionalPrice } from '../../google-play/currency';

describe('getSmartPricingMultiplier', () => {
  it('keeps the US as the 1.0 anchor', () => {
    expect(getSmartPricingMultiplier('US', 1, 'apple')).toBe(1);
  });

  it('keeps Canada at approximate US parity', () => {
    expect(getSmartPricingMultiplier('CA', 0.85, 'apple')).toBe(1);
  });

  it('keeps Western Europe close to top-market pricing', () => {
    expect(getSmartPricingMultiplier('ES', 0.65, 'apple')).toBeCloseTo(0.90, 2);
    expect(getSmartPricingMultiplier('SE', 0.88, 'apple')).toBeCloseTo(0.97, 2);
    expect(getSmartPricingMultiplier('NO', 0.99, 'apple')).toBeCloseTo(1.00, 2);
    expect(getSmartPricingMultiplier('CH', 1.14, 'apple')).toBeCloseTo(1.03, 2);
  });

  it('raises developed East Asia for a revenue-oriented prior', () => {
    expect(getSmartPricingMultiplier('JP', 0.63, 'apple')).toBeCloseTo(0.87, 2);
    expect(getSmartPricingMultiplier('KR', 0.61, 'apple')).toBeCloseTo(0.86, 2);
    expect(getSmartPricingMultiplier('AU', 0.96, 'apple')).toBeCloseTo(0.95, 2);
  });

  it('keeps Singapore and Hong Kong above broad emerging-Asia pricing', () => {
    expect(getSmartPricingMultiplier('SG', 0.67, 'apple')).toBeCloseTo(0.90, 2);
    expect(getSmartPricingMultiplier('HK', 0.71, 'apple')).toBeCloseTo(0.92, 2);
  });

  it('gives wealthy Gulf storefronts their own high-income curve', () => {
    expect(getSmartPricingMultiplier('AE', 0.63, 'apple')).toBeCloseTo(0.93, 2);
    expect(getSmartPricingMultiplier('QA', 0.55, 'apple')).toBeCloseTo(0.91, 2);
    expect(getSmartPricingMultiplier('KW', 0.57, 'apple')).toBeCloseTo(0.92, 2);
    expect(getSmartPricingMultiplier('BH', 0.42, 'apple')).toBeCloseTo(0.88, 2);
    expect(getSmartPricingMultiplier('SA', 0.47, 'apple')).toBeCloseTo(0.89, 2);
    expect(getSmartPricingMultiplier('OM', 0.47, 'apple')).toBeCloseTo(0.89, 2);

    // Google remains somewhat cheaper, but no longer gets the generic MEA curve.
    expect(getSmartPricingMultiplier('AE', 0.63, 'google')).toBeGreaterThan(0.85);
    expect(getSmartPricingMultiplier('SA', 0.47, 'google')).toBeGreaterThan(0.82);
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

  it('uses Apple equalized storefront price as the Smart baseline instead of raw FX', () => {
    const dynamicPPP = {
      AT: {
        pppMultiplier: 0.84,
        minPrice: 0,
        suggestedRounding: 0.01,
        source: 'world-bank' as const,
      },
      US: {
        pppMultiplier: 1,
        minPrice: 0,
        suggestedRounding: 0.01,
        source: 'world-bank' as const,
      },
    };

    const result = calculateRegionalPrice(
      4.99,
      'AT',
      'smart',
      'none',
      undefined,
      dynamicPPP,
      { AT: 'EUR' },
      {
        base: 'USD',
        rates: { USD: 1, EUR: 0.85 },
        fetchedAt: 'test',
      },
      'USD',
      'US',
      () => [], // Presence of Apple tiers marks this as Apple pricing.
      {
        US: { price: 4.99, currency: 'USD' },
        AT: { price: 5.99, currency: 'EUR' },
      }
    );

    const expectedMultiplier = getSmartPricingMultiplier('AT', 0.84, 'apple');
    expect(result.multiplier).toBeCloseTo(expectedMultiplier, 4);
    expect(result.rawPrice).toBeCloseTo(5.99 * expectedMultiplier, 2);

    // The old V1 raw-FX path was around EUR 3.97 for the same inputs.
    expect(result.rawPrice).toBeGreaterThan(5.4);
  });
});
