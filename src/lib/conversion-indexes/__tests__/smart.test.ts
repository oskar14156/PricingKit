import { describe, expect, it } from 'vitest';
import {
  getAndroidPlatformFactor,
  getSmartPricingBreakdown,
  getSmartPricingMultiplier,
  MIN_ANDROID_PLATFORM_FACTOR,
} from '../smart';
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
    expect(android).toBeCloseTo(0.33, 2);
  });

  it('lands Latin America near large-app benchmark ranges', () => {
    expect(getSmartPricingMultiplier('BR', 0.48, 'apple')).toBeCloseTo(0.56, 2);
    expect(getSmartPricingMultiplier('MX', 0.57, 'apple')).toBeCloseTo(0.64, 2);
  });

  it('uses audited iOS priors for sparse and secondary markets', () => {
    expect(getSmartPricingMultiplier('AF', 0.50, 'apple')).toBeCloseTo(0.45, 2);
    expect(getSmartPricingMultiplier('BN', 0.50, 'apple')).toBeCloseTo(0.84, 2);
    expect(getSmartPricingMultiplier('TW', 0.60, 'apple')).toBeCloseTo(0.84, 2);
    expect(getSmartPricingMultiplier('VU', 0.89, 'apple')).toBeCloseTo(0.55, 2);
    expect(getSmartPricingMultiplier('FM', 0.96, 'apple')).toBeCloseTo(0.72, 2);
  });

  it('uses dedicated CEE and high-income LATAM priors', () => {
    expect(getSmartPricingMultiplier('BG', 0.25, 'apple')).toBeCloseTo(0.68, 2);
    expect(getSmartPricingMultiplier('RO', 0.46, 'apple')).toBeCloseTo(0.70, 2);
    expect(getSmartPricingMultiplier('PL', 0.55, 'apple')).toBeCloseTo(0.75, 2);
    expect(getSmartPricingMultiplier('CZ', 0.63, 'apple')).toBeCloseTo(0.80, 2);
    expect(getSmartPricingMultiplier('CL', 0.52, 'apple')).toBeCloseTo(0.75, 2);
    expect(getSmartPricingMultiplier('PA', 0.45, 'apple')).toBeCloseTo(0.75, 2);
  });

  describe('Android platform factor', () => {
    it('keeps the US and iOS-mainstream markets at platform parity', () => {
      expect(getAndroidPlatformFactor('US')).toBe(1);
      expect(getAndroidPlatformFactor('JP')).toBe(1);
      expect(getAndroidPlatformFactor('GB')).toBe(1);
      expect(getSmartPricingMultiplier('AT', 0.84, 'google')).toBe(
        getSmartPricingMultiplier('AT', 0.84, 'apple')
      );
    });

    it('discounts Android more where iOS is a niche', () => {
      const india = getAndroidPlatformFactor('IN'); // ~6% iOS
      const brazil = getAndroidPlatformFactor('BR'); // ~20% iOS
      const germany = getAndroidPlatformFactor('DE'); // ~38% iOS
      expect(india).toBeLessThan(brazil);
      expect(brazil).toBeLessThan(germany);
      expect(india).toBeCloseTo(0.735, 2);
      expect(brazil).toBeCloseTo(0.92, 2);
      expect(germany).toBeGreaterThan(0.99);
    });

    it('captures the expat Android base in the UAE', () => {
      expect(getAndroidPlatformFactor('AE')).toBeLessThan(0.93);
    });

    it('never goes below the cross-platform arbitrage floor', () => {
      for (const code of ['NE', 'YE', 'TD', 'XX']) {
        expect(getAndroidPlatformFactor(code)).toBeGreaterThanOrEqual(
          MIN_ANDROID_PLATFORM_FACTOR
        );
      }
      expect(getAndroidPlatformFactor('NE')).toBe(MIN_ANDROID_PLATFORM_FACTOR);
    });

    it('builds Google prices from the iOS prior times the platform factor', () => {
      const breakdown = getSmartPricingBreakdown('KE', 0.34, 'google');
      expect(breakdown.androidPlatformFactor).toBeDefined();
      expect(breakdown.multiplier).toBeCloseTo(
        breakdown.appleMultiplier * (breakdown.androidPlatformFactor ?? 1),
        3
      );
      expect(breakdown.multiplier).toBeLessThanOrEqual(breakdown.appleMultiplier);
    });

    it('exposes the Android factor on Google Smart price calculations', () => {
      const google = calculateRegionalPrice(4.99, 'KE', 'smart', 'none');
      expect(google.androidPlatformFactor).toBe(getAndroidPlatformFactor('KE'));
      expect(google.iosShare).toBeCloseTo(0.059, 3);

      const apple = calculateRegionalPrice(
        4.99, 'KE', 'smart', 'none', undefined, undefined, undefined,
        undefined, 'USD', 'US', () => []
      );
      expect(apple.androidPlatformFactor).toBeUndefined();
    });

    it('still prices Android payers above raw PPP in low-income markets', () => {
      expect(getSmartPricingMultiplier('IN', 0.22, 'google')).toBeGreaterThan(0.22);
      expect(getSmartPricingMultiplier('NG', 0.13, 'google')).toBeGreaterThan(0.13);
    });
  });

  it('rejects implausible live-PPP premiums when static PPP says lower-income', () => {
    expect(getSmartPricingMultiplier('AR', 1.8, 'apple', 0.35)).toBeLessThan(0.70);
  });

  it('uses a bounded Apple equalization uplift without changing WTP', () => {
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

    const baselines = {
      US: {
        price: 4.99,
        currency: 'USD',
        proceeds: 3.49,
        proceedsYear2: 4.24,
      },
      AT: {
        price: 5.99,
        currency: 'EUR',
        proceeds: 3.49,
        proceedsYear2: 4.24,
      },
    };

    const standard = calculateRegionalPrice(
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
      () => [],
      baselines,
      false
    );

    const smallBusiness = calculateRegionalPrice(
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
      () => [],
      baselines,
      true
    );

    const multiplier = getSmartPricingMultiplier('AT', 0.84, 'apple');
    const rawFxPrice = 4.99 * 0.85;

    expect(standard.multiplier).toBeCloseTo(multiplier, 4);
    expect(standard.appleTaxFactor).toBeCloseTo(1.25, 4);
    expect(standard.rawPrice).toBeCloseTo(
      rawFxPrice * multiplier * 1.25,
      2
    );

    // Small Business affects developer share, not customer pricing.
    expect(smallBusiness.rawPrice).toBeCloseTo(standard.rawPrice, 4);
    expect(smallBusiness.estimatedAppleProceeds).toBeGreaterThan(
      standard.estimatedAppleProceeds ?? 0
    );

    // Never use the entire €5.99 equalized value as the WTP base.
    expect(standard.rawPrice).toBeLessThan(5.99 * multiplier);
  });
});
