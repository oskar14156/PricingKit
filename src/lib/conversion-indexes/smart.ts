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
 * market priors. It is a starting prior for markets without enough first-party
 * experiment data; once an app has sufficient volume, country-level RPU/LTV
 * experiments should supersede this model.
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

export type PricingPlatform = 'apple' | 'google';

const WESTERN_EUROPE = new Set([
  'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'FI', 'BE', 'AT', 'CH',
  'DK', 'IE', 'PT', 'LU', 'LI', 'IS', 'MC', 'MT',
]);

const DEVELOPED_ASIA_PACIFIC = new Set(['JP', 'KR', 'AU', 'NZ']);
const HIGH_INCOME_ASIA = new Set(['SG', 'HK']);

// RevenueCat's IN/SEA cohort plus nearby lower/middle-income Asian markets that
// show similar app-affordability dynamics. Singapore is handled separately.
const EMERGING_ASIA = new Set([
  'IN', 'ID', 'TH', 'PH', 'VN', 'MY', 'LK', 'PK', 'BD', 'NP', 'KH', 'LA', 'MM',
]);

const LATIN_AMERICA = new Set([
  'BR', 'MX', 'AR', 'CL', 'CO', 'PE', 'UY', 'EC', 'BO', 'PY', 'CR', 'PA',
  'DO', 'GT', 'HN', 'SV', 'NI',
]);

const MIDDLE_EAST_AFRICA = new Set([
  'SA', 'ZA', 'AE', 'EG', 'NG', 'KE', 'TR', 'QA', 'KW', 'BH', 'OM', 'JO',
  'MA', 'TN', 'DZ', 'GH', 'TZ', 'UG', 'ET', 'CM', 'SN', 'CI',
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

/**
 * Convert a raw US-relative PPP multiplier into an app-market multiplier.
 *
 * Why exponents < 1? `x^a` for 0 < x < 1 and a < 1 compresses the discount.
 * That models the selection effect that paying smartphone users are more
 * affluent than the population-wide consumer represented by raw PPP.
 *
 * Emerging-market iOS floors are higher than Android floors because observed
 * App Store payer value/pricing diverges materially from Google Play there.
 */
export function getSmartPricingMultiplier(
  regionCode: string,
  rawPppMultiplier: number,
  platform: PricingPlatform = 'apple',
  staticPppMultiplier?: number
): number {
  const code = regionCode.toUpperCase();
  if (code === 'US') return 1;

  const ppp = sanitizePpp(rawPppMultiplier, staticPppMultiplier);
  let multiplier: number;

  // Basket-of-app evidence puts Canada approximately at US parity.
  if (code === 'CA') {
    multiplier = 1;
  } else if (WESTERN_EUROPE.has(code)) {
    // RevenueCat 2026: Western Europe annual median is almost identical to NA.
    // Keep meaningful differences (e.g. ES/PT vs CH/Nordics) but heavily
    // compress population-wide PPP so rich app users are not underpriced.
    multiplier = clamp(
      Math.pow(ppp, 0.375),
      0.85,
      platform === 'apple' ? 1.08 : 1.05
    );
  } else if (DEVELOPED_ASIA_PACIFIC.has(code)) {
    // Large-app basket: AU ~80-90% of US; RevenueCat shows APAC as a high-value
    // region. A narrow 0.80-0.95 band is a safer default than raw PPP.
    multiplier = clamp(Math.pow(ppp, 0.45), 0.80, 0.95);
  } else if (HIGH_INCOME_ASIA.has(code)) {
    multiplier = clamp(Math.pow(ppp, 0.40), 0.85, 1.00);
  } else if (EMERGING_ASIA.has(code)) {
    if (platform === 'apple') {
      // RevenueCat: IN/SEA prices ~46-54% of top markets; iOS payer value is
      // materially stronger than Play. Avoid raw PPP floors around 0.20-0.30.
      multiplier = clamp(Math.pow(ppp, 0.62), 0.45, 0.78);
    } else {
      // IN/SEA Play annual median is materially lower than App Store pricing.
      multiplier = clamp(Math.pow(ppp, 0.72), 0.32, 0.68);
    }
  } else if (LATIN_AMERICA.has(code)) {
    // Basket-of-app guidance: BR roughly 40-55%, MX roughly 60-70% of US.
    // This reproduces that range from PPP without hardcoding every country.
    multiplier = platform === 'apple'
      ? clamp(Math.pow(ppp, 0.80), 0.40, 0.70)
      : clamp(Math.pow(ppp, 0.90), 0.35, 0.66);
  } else if (MIDDLE_EAST_AFRICA.has(code)) {
    // RevenueCat shows a pronounced App Store vs Play price gap in MEA.
    multiplier = platform === 'apple'
      ? clamp(Math.pow(ppp, 0.65), 0.40, 0.85)
      : clamp(Math.pow(ppp, 0.75), 0.34, 0.72);
  } else {
    // Sparse-data fallback: compressed PPP with a floor. Deliberately less
    // aggressive than raw PPP because the paid-app audience is usually richer.
    multiplier = platform === 'apple'
      ? clamp(Math.sqrt(ppp), 0.45, 1.08)
      : clamp(Math.pow(ppp, 0.60), 0.38, 1.03);
  }

  return Math.round(multiplier * 10_000) / 10_000;
}
