/**
 * Smart regional pricing for digital apps.
 *
 * This is intentionally NOT a cost-based index. For software with near-zero
 * marginal cost, the useful objective is revenue / LTV per eligible user, not
 * gross margin per transaction. Raw country PPP is still useful, but it tends
 * to over-discount because paid app users (especially on iOS) are a wealthier
 * subset of the population than the average consumer measured by PPP.
 *
 * The model therefore compresses World Bank PPP and applies broad mobile-app
 * market priors. V3 is intentionally revenue-tuned: mature Western markets,
 * developed East Asia, high-income Asian storefronts, and wealthy Gulf states
 * are kept closer to top-market pricing. It remains a starting prior for
 * markets without enough first-party experiment data; once an app has
 * sufficient volume, country-level RPU/LTV experiments should supersede it.
 *
 * V5: Google Play no longer uses hand-tuned per-region discounts. It takes
 * the iOS prior and removes the iOS-only payer-selection premium using each
 * market's iOS share (see `getAndroidPlatformFactor`).
 *
 * Calibration references (reviewed 2026-09):
 * - RevenueCat, State of Subscription Apps 2026
 *   https://www.revenuecat.com/state-of-subscription-apps
 * - RevenueCat, Ultimate guide to price localization (2025)
 *   https://www.revenuecat.com/blog/growth/price-localization-for-apps
 * - Flo / Dmitry Gurski on regional pricing and optimizing RPU rather than CR
 *   https://subclub.com/episode/how-to-maximize-revenue-with-regional-pricing-dmitry-gurski-flo
 * - Jacob Rushfinn's basket of large apps (Calm, Strava, Duolingo, etc.)
 *   https://www.retention.blog/p/global-pricing-guidance
 */

import { getIosMobileShare } from './platform-share';

export type PricingPlatform = 'apple' | 'google';

const WESTERN_EUROPE = new Set([
  'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'FI', 'BE', 'AT', 'CH',
  'DK', 'IE', 'PT', 'LU', 'LI', 'IS', 'MC', 'MT',
]);

const DEVELOPED_EAST_ASIA = new Set(['JP', 'KR']);
const OCEANIA = new Set(['AU', 'NZ']);
const HIGH_INCOME_ASIA = new Set(['SG', 'HK']);

// High-income Asian storefronts that empirically belong below SG/HK but well
// above broad emerging-Asia pricing.
const SECONDARY_HIGH_INCOME_ASIA: Record<string, number> = {
  TW: 0.84,
  MO: 0.83,
  BN: 0.84,
};

// Central/Eastern Europe benefits from an explicit iOS prior rather than
// falling through generic PPP. These values intentionally sit between
// Western-Europe parity and emerging-market pricing.
const CEE_APPLE_PRIORS: Record<string, number> = {
  BG: 0.68,
  RO: 0.70,
  PL: 0.75,
  HU: 0.76,
  HR: 0.76,
  SK: 0.78,
  CZ: 0.80,
  LV: 0.78,
  LT: 0.78,
  EE: 0.84,
  SI: 0.82,
  GR: 0.79,
  CY: 0.83,
};

// High-income Latin American markets should not inherit the broad LATAM curve.
const HIGH_INCOME_LATAM_APPLE_PRIORS: Record<string, number> = {
  CL: 0.75,
  CR: 0.75,
  PA: 0.75,
  UY: 0.78,
  GY: 0.75,
  TT: 0.80,
};

// Sparse-market corrections discovered in the full 175-territory audit.
// These are deliberately iOS-oriented: paid iPhone users are wealthier than
// population averages, so very poor markets still keep a meaningful floor.
const SPARSE_APPLE_PRIORS: Record<string, number> = {
  AF: 0.45,
  BF: 0.45,
  TD: 0.45,
  CD: 0.45,
  GM: 0.45,
  GW: 0.45,
  MG: 0.45,
  MW: 0.45,
  ML: 0.45,
  MZ: 0.45,
  NE: 0.45,
  RW: 0.45,
  UG: 0.45,
  YE: 0.45,
  SO: 0.45,

  AO: 0.55,
  BJ: 0.55,
  BT: 0.55,
  CG: 0.55,
  SZ: 0.55,
  LB: 0.55,
  MR: 0.55,
  NA: 0.55,
  PG: 0.55,
  SB: 0.55,
  ST: 0.55,
  VU: 0.55,
  ZM: 0.55,

  FM: 0.72,
  TO: 0.72,
  NR: 0.80,
  PW: 0.80,
  SC: 0.80,
};

// Wealthy Gulf storefronts should not inherit the same deep-discount curve as
// lower-income MEA markets. Their paying iOS audience is much closer to
// top-market willingness-to-pay.
const HIGH_INCOME_GULF = new Set(['AE', 'QA', 'KW', 'BH', 'SA', 'OM']);

// RevenueCat's IN/SEA cohort plus nearby lower/middle-income Asian markets that
// show similar app-affordability dynamics. Singapore is handled separately.
const EMERGING_ASIA = new Set([
  'IN', 'ID', 'TH', 'PH', 'VN', 'MY', 'LK', 'PK', 'BD', 'NP', 'KH', 'LA', 'MM',
]);

const LATIN_AMERICA = new Set([
  'BR', 'MX', 'AR', 'CO', 'PE', 'EC', 'BO', 'PY',
  'DO', 'GT', 'HN', 'SV', 'NI',
]);

const MIDDLE_EAST_AFRICA = new Set([
  'ZA', 'EG', 'NG', 'KE', 'TR', 'JO', 'MA', 'TN', 'DZ', 'GH', 'TZ', 'UG',
  'ET', 'CM', 'SN', 'CI',
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizePpp(
  livePppMultiplier: number,
  staticPppMultiplier?: number
): number {
  let ppp = Number.isFinite(livePppMultiplier) && livePppMultiplier > 0
    ? livePppMultiplier
    : staticPppMultiplier ?? 0.5;

  // Official/parallel FX dislocations in high-inflation markets can temporarily
  // make live PPP imply that a clearly lower-income market is MORE expensive
  // than the US. When the long-run static snapshot strongly disagrees, prefer
  // the conservative snapshot rather than generating a premium price by error.
  if (
    ppp > 1.15 &&
    staticPppMultiplier !== undefined &&
    staticPppMultiplier > 0 &&
    staticPppMultiplier < 0.75
  ) {
    ppp = staticPppMultiplier;
  }

  return clamp(ppp, 0.1, 1.6);
}

// --- Android platform-selection model (V5) ---------------------------------
//
// The iOS priors above bake in a payer-selection premium: where iPhones are a
// niche, the people who own them (and pay through the App Store) are a much
// richer slice of the population than raw PPP describes. Afghanistan is the
// extreme case: ~12% iOS share means iPhone owners are a small urban elite.
//
// That premium does not carry over to Google Play. Where Android is the mass
// platform, Android payers are much closer to the average smartphone owner.
// It does NOT disappear completely either: Android payers still need a
// smartphone, a working Play payment method and willingness to pay, so raw
// PPP would still over-discount. And because WTP is heavy-tailed, the
// revenue-maximizing price sits above the median payer's WTP.
//
// Model: smartphone users are sorted by a latent affluence score ~ N(0, 1);
// iOS users are the top `s` share (s = iOS mobile share). The gap between the
// mean affluence of iOS users and Android users is
//
//   gap(s) = phi(z) / (s * (1 - s)),  z = PhiInverse(1 - s)
//
// (difference of the two truncated-normal means). The gap is flat for
// mid-range shares (30-60% iOS: both platforms are mass market) and grows
// quickly when iOS becomes a niche. Smart multipliers are relative to the US
// on the same platform, so only the gap in excess of the US gap matters:
//
//   androidFactor = exp(-K * (gap(s_country) - gap(s_US)))
//
// K is calibrated so India (~6% iOS) lands near the ~0.70-0.75 Play/App
// Store price ratio RevenueCat reports for IN/SEA (Play annual median
// ~$14.64 vs a blended $18.32; Play monthly ~$3.12 vs blended $3.75), while
// North America stays at parity, as observed. It also reproduces the previous
// hand-tuned Brazil gap (~0.92).

export const ANDROID_SELECTION_STRENGTH = 0.6;

// Guardrail: never price Android more than 30% below iOS in the same market.
// Larger gaps invite cross-platform arbitrage (subscribe on the cheaper
// platform, use everywhere) and go beyond the observed store benchmarks.
export const MIN_ANDROID_PLATFORM_FACTOR = 0.70;

const US_IOS_SHARE = 0.597;

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Acklam's rational approximation of the inverse standard normal CDF
// (relative error < 1.2e-9), sufficient for a pricing prior.
function normalInverseCdf(p: number): number {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pLow) {
    return -normalInverseCdf(1 - p);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function platformAffluenceGap(iosShare: number): number {
  const s = clamp(iosShare, 0.02, 0.98);
  const z = normalInverseCdf(1 - s);
  return normalPdf(z) / (s * (1 - s));
}

const US_AFFLUENCE_GAP = platformAffluenceGap(US_IOS_SHARE);

/**
 * Android payer WTP relative to iOS payer WTP in the same market, normalized
 * so the US is 1.0. Returns a value in [MIN_ANDROID_PLATFORM_FACTOR, 1].
 */
export function getAndroidPlatformFactor(regionCode: string): number {
  const code = regionCode.toUpperCase();
  const iosShare = getIosMobileShare(code);

  // Where iOS is at least as mainstream as in the US, the two platforms'
  // payer bases differ no more than they do in the US.
  if (code === 'US' || iosShare >= US_IOS_SHARE) return 1;

  const excessGap = platformAffluenceGap(iosShare) - US_AFFLUENCE_GAP;
  const factor = Math.exp(-ANDROID_SELECTION_STRENGTH * excessGap);
  return Math.round(clamp(factor, MIN_ANDROID_PLATFORM_FACTOR, 1) * 10_000) / 10_000;
}

/**
 * iOS app-market multiplier relative to the US.
 *
 * Why exponents < 1? `x^a` for 0 < x < 1 and a < 1 compresses the discount.
 * That models the selection effect that paying smartphone users are more
 * affluent than the population-wide consumer represented by raw PPP.
 */
function getAppleSmartMultiplier(code: string, ppp: number): number {
  // Basket-of-app evidence puts Canada approximately at US parity.
  if (code === 'CA') return 1;
  if (CEE_APPLE_PRIORS[code] !== undefined) return CEE_APPLE_PRIORS[code];
  if (SECONDARY_HIGH_INCOME_ASIA[code] !== undefined) {
    return SECONDARY_HIGH_INCOME_ASIA[code];
  }
  if (HIGH_INCOME_LATAM_APPLE_PRIORS[code] !== undefined) {
    return HIGH_INCOME_LATAM_APPLE_PRIORS[code];
  }
  if (SPARSE_APPLE_PRIORS[code] !== undefined) return SPARSE_APPLE_PRIORS[code];

  if (WESTERN_EUROPE.has(code)) {
    // RevenueCat 2026: Western Europe subscription pricing is near NA. V3
    // therefore compresses PPP more aggressively and raises the floor so
    // countries such as ES/PT are not discounted like emerging markets.
    return clamp(Math.pow(ppp, 0.25), 0.90, 1.08);
  }
  if (DEVELOPED_EAST_ASIA.has(code)) {
    // Japan and Korea have high-value paid-app audiences. V3 moves them closer
    // to top-market pricing while retaining a modest regional discount.
    return clamp(Math.pow(ppp, 0.30), 0.85, 0.95);
  }
  if (OCEANIA.has(code)) {
    // Australia / New Zealand were already close to the desired revenue prior.
    return clamp(Math.pow(ppp, 0.45), 0.80, 0.95);
  }
  if (HIGH_INCOME_ASIA.has(code)) {
    // Singapore / Hong Kong should sit materially above broad SEA pricing.
    return clamp(Math.pow(ppp, 0.25), 0.90, 1.00);
  }
  if (HIGH_INCOME_GULF.has(code)) {
    // Wealthy Gulf states get their own curve instead of the deep-discount MEA
    // bucket because the iOS payer mix is especially affluent.
    return clamp(Math.pow(ppp, 0.15), 0.88, 1.00);
  }
  if (EMERGING_ASIA.has(code)) {
    // RevenueCat: IN/SEA prices ~46-54% of top markets; iOS payer value is
    // materially stronger than Play. Avoid raw PPP floors around 0.20-0.30.
    return clamp(Math.pow(ppp, 0.62), 0.45, 0.78);
  }
  if (LATIN_AMERICA.has(code)) {
    // Basket-of-app guidance: BR roughly 40-55%, MX roughly 60-70% of US.
    return clamp(Math.pow(ppp, 0.80), 0.40, 0.70);
  }
  if (MIDDLE_EAST_AFRICA.has(code)) {
    return clamp(Math.pow(ppp, 0.65), 0.40, 0.85);
  }
  // Sparse-data fallback: compressed PPP with a floor. Deliberately less
  // aggressive than raw PPP because the paid-app audience is usually richer.
  return clamp(Math.sqrt(ppp), 0.45, 1.08);
}

export interface SmartPricingBreakdown {
  multiplier: number;
  /** iOS app-market multiplier for the same storefront. */
  appleMultiplier: number;
  /** Android/iOS payer factor (Google only). */
  androidPlatformFactor?: number;
  /** iOS mobile share used for the Android factor (Google only). */
  iosShare?: number;
}

export function getSmartPricingBreakdown(
  regionCode: string,
  rawPppMultiplier: number,
  platform: PricingPlatform = 'apple',
  staticPppMultiplier?: number
): SmartPricingBreakdown {
  const code = regionCode.toUpperCase();
  if (code === 'US') {
    return platform === 'apple'
      ? { multiplier: 1, appleMultiplier: 1 }
      : { multiplier: 1, appleMultiplier: 1, androidPlatformFactor: 1, iosShare: US_IOS_SHARE };
  }

  const ppp = sanitizePpp(rawPppMultiplier, staticPppMultiplier);
  const appleMultiplier = getAppleSmartMultiplier(code, ppp);
  const round = (value: number) => Math.round(value * 10_000) / 10_000;

  if (platform === 'apple') {
    return { multiplier: round(appleMultiplier), appleMultiplier: round(appleMultiplier) };
  }

  // Google Play: same app-market level, minus the iOS-only selection premium.
  const androidPlatformFactor = getAndroidPlatformFactor(code);
  return {
    multiplier: round(appleMultiplier * androidPlatformFactor),
    appleMultiplier: round(appleMultiplier),
    androidPlatformFactor,
    iosShare: getIosMobileShare(code),
  };
}

/**
 * Convert a raw US-relative PPP multiplier into an app-market multiplier for
 * the given store. Google Play = iOS prior x Android platform factor.
 */
export function getSmartPricingMultiplier(
  regionCode: string,
  rawPppMultiplier: number,
  platform: PricingPlatform = 'apple',
  staticPppMultiplier?: number
): number {
  return getSmartPricingBreakdown(
    regionCode,
    rawPppMultiplier,
    platform,
    staticPppMultiplier
  ).multiplier;
}
