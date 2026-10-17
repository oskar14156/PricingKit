/**
 * iOS share of mobile OS usage per storefront (0-1).
 *
 * Source: StatCounter Global Stats, "Mobile Operating System Market Share",
 * 12-month mean of monthly values (2025-10 to 2026-09), fetched 2026-10-17.
 * https://gs.statcounter.com/os-market-share/mobile
 *
 * StatCounter measures share of mobile web page views, not installed base, so
 * treat individual values as a proxy. Small territories (e.g. Bermuda,
 * Bahamas) are noisy; the Smart Android model only uses shares BELOW the US
 * level, which keeps those outliers harmless.
 */

export const IOS_SHARE_SNAPSHOT = {
  source: 'StatCounter Global Stats (mobile OS market share)',
  period: '2025-10..2026-09',
  fetchedAt: '2026-10-17',
} as const;

// Used for storefronts missing from the snapshot. Missing markets are almost
// always small, Android-dominated territories.
export const DEFAULT_IOS_SHARE = 0.15;

export const IOS_MOBILE_SHARE: Record<string, number> = {
  AE: 0.199, AF: 0.125, AG: 0.442, AI: 0.675, AL: 0.571, AM: 0.392, AO: 0.214,
  AR: 0.143, AT: 0.481, AU: 0.613, AW: 0.532, AZ: 0.203, BA: 0.249, BB: 0.348,
  BD: 0.072, BE: 0.468, BF: 0.07, BG: 0.231, BH: 0.496, BJ: 0.174, BM: 0.997,
  BN: 0.375, BO: 0.099, BR: 0.196, BS: 0.884, BT: 0.147, BW: 0.141, BY: 0.4,
  BZ: 0.732, CA: 0.633, CD: 0.149, CF: 0.086, CG: 0.158, CH: 0.559, CI: 0.246,
  CL: 0.193, CM: 0.168, CN: 0.271, CO: 0.25, CR: 0.352, CV: 0.34, CY: 0.341,
  CZ: 0.292, DE: 0.375, DJ: 0.118, DK: 0.626, DM: 0.248, DO: 0.464, DZ: 0.117,
  EC: 0.243, EE: 0.417, EG: 0.128, ER: 0.065, ES: 0.298, FI: 0.357, FJ: 0.179,
  FM: 0.206, FR: 0.34, GA: 0.119, GB: 0.504, GD: 0.367, GE: 0.322, GH: 0.277,
  GI: 0.575, GM: 0.213, GN: 0.157, GR: 0.277, GT: 0.297, GW: 0.093, GY: 0.233,
  HK: 0.478, HN: 0.298, HR: 0.286, HT: 0.17, HU: 0.257, ID: 0.174, IE: 0.49,
  IL: 0.306, IN: 0.058, IQ: 0.178, IS: 0.592, IT: 0.345, JM: 0.37, JO: 0.243,
  JP: 0.613, KE: 0.059, KG: 0.253, KH: 0.479, KM: 0.138, KN: 0.352, KR: 0.306,
  KW: 0.383, KY: 0.612, KZ: 0.437, LA: 0.355, LB: 0.312, LC: 0.381, LI: 0.657,
  LK: 0.188, LR: 0.124, LT: 0.336, LU: 0.455, LV: 0.347, LY: 0.149, MA: 0.244,
  MC: 0.668, MD: 0.325, ME: 0.347, MG: 0.059, MK: 0.352, ML: 0.089, MM: 0.144,
  MN: 0.41, MO: 0.614, MR: 0.309, MS: 0.435, MT: 0.482, MU: 0.186, MV: 0.41,
  MW: 0.048, MX: 0.285, MY: 0.409, MZ: 0.114, NA: 0.201, NE: 0.032, NG: 0.152,
  NI: 0.189, NL: 0.365, NO: 0.556, NP: 0.241, NR: 0.145, NZ: 0.51, OM: 0.227,
  PA: 0.318, PE: 0.174, PG: 0.054, PH: 0.103, PK: 0.075, PL: 0.321, PT: 0.358,
  PW: 0.332, PY: 0.202, QA: 0.209, RO: 0.266, RS: 0.232, RU: 0.329, RW: 0.196,
  SA: 0.317, SB: 0.136, SC: 0.355, SE: 0.553, SG: 0.414, SI: 0.33, SK: 0.283,
  SL: 0.119, SM: 0.277, SN: 0.226, SO: 0.115, SR: 0.27, ST: 0.095, SV: 0.236,
  SZ: 0.115, TC: 0.642, TD: 0.046, TG: 0.129, TH: 0.324, TJ: 0.175, TM: 0.191,
  TN: 0.15, TO: 0.321, TR: 0.244, TT: 0.348, TW: 0.564, TZ: 0.071, UA: 0.358,
  UG: 0.082, US: 0.597, UY: 0.325, UZ: 0.187, VA: 0.362, VC: 0.306, VE: 0.129,
  VG: 0.51, VN: 0.411, VU: 0.177, WS: 0.194, XK: 0.654, YE: 0.034, ZA: 0.213,
  ZM: 0.1, ZW: 0.112,
};

export function getIosMobileShare(regionCode: string): number {
  return IOS_MOBILE_SHARE[regionCode.toUpperCase()] ?? DEFAULT_IOS_SHARE;
}
