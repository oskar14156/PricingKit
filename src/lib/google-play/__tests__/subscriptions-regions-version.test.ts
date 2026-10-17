import { beforeEach, describe, expect, it, vi } from 'vitest';

const googlePlayFetch = vi.fn();
vi.mock('../client', () => ({ googlePlayFetch: (...args: unknown[]) => googlePlayFetch(...args) }));
vi.mock('../../exchange-rates/client', () => ({
  getExchangeRates: async () => ({ base: 'USD', rates: { USD: 1, AZN: 1.7 } }),
}));

import { updateBasePlanPrices } from '../subscriptions';
import type { ServiceAccountCredentials } from '../types';

const credentials = {} as ServiceAccountCredentials;

// AZ still carries the USD price it had before regions version 2026/01 moved
// Azerbaijan to AZN.
const subscription = {
  productId: 'rise_weekly',
  basePlans: [
    {
      basePlanId: 'weekly',
      regionalConfigs: [
        { regionCode: 'US', price: { currencyCode: 'USD', units: '4', nanos: 990000000 } },
        { regionCode: 'AR', price: { currencyCode: 'ARS', units: '4999' } },
        { regionCode: 'AZ', price: { currencyCode: 'USD', units: '2', nanos: 990000000 } },
      ],
    },
  ],
};

type FetchOptions = {
  method?: string;
  query?: Record<string, string>;
  body?: { basePlans: Array<{ regionalConfigs: Array<{ regionCode: string; price: { currencyCode: string } }> }> };
};

function mockGoogle(
  latestVersion: string | undefined,
  onPatch: (options: FetchOptions) => unknown
) {
  googlePlayFetch.mockImplementation(async (_creds, path: string, options?: FetchOptions) => {
    if (path.endsWith('pricing:convertRegionPrices')) {
      return latestVersion ? { regionVersion: { version: latestVersion } } : {};
    }
    if (options?.method !== 'PATCH') return structuredClone(subscription);
    return onPatch(options);
  });
}

function patchedVersions(): string[] {
  return googlePlayFetch.mock.calls
    .filter(([, , options]) => options?.method === 'PATCH')
    .map(([, , options]) => options.query['regionsVersion.version']);
}

const usPrice = [
  { regionCode: 'US', price: { currencyCode: 'USD', units: '5', nanos: 990000000 } },
];

describe('updateBasePlanPrices regions version', () => {
  beforeEach(() => {
    googlePlayFetch.mockReset();
  });

  it('uses the regions version Google reports as current', async () => {
    mockGoogle('2026/01', (options) => options.body);

    await updateBasePlanPrices(credentials, 'com.example', 'rise_weekly', 'weekly', [
      ...usPrice,
      { regionCode: 'AZ', price: { currencyCode: 'AZN', units: '4', nanos: 990000000 } },
    ]);

    expect(patchedVersions()).toEqual(['2026/01']);
  });

  it('converts a stored currency the current version rejects and retries', async () => {
    let sentAzPrice: unknown;
    mockGoogle('2026/01', (options) => {
      const az = options.body!.basePlans[0].regionalConfigs.find((c) => c.regionCode === 'AZ')!;
      if (az.price.currencyCode !== 'AZN') {
        throw {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message:
            'Invalid currency for region code AZ at the specified regions version 2026/01. Expected AZN but got USD.',
        };
      }
      sentAzPrice = az.price;
      return options.body;
    });

    await updateBasePlanPrices(credentials, 'com.example', 'rise_weekly', 'weekly', usPrice);

    // $2.99 at 1.7 AZN/USD = 5.08 AZN -> nearest .99 = 4.99 AZN.
    expect(sentAzPrice).toMatchObject({ currencyCode: 'AZN', units: '4' });
    expect(patchedVersions()).toEqual(['2026/01', '2026/01']);
  });

  it('falls back to the legacy version for regions the current one no longer bills', async () => {
    mockGoogle(undefined, (options) => {
      if (options.query!['regionsVersion.version'] !== '2022/02') {
        throw {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message: 'Region code XK is not billable at the specified regions version 2026/01.',
        };
      }
      return options.body;
    });

    await updateBasePlanPrices(credentials, 'com.example', 'rise_weekly', 'weekly', usPrice);

    expect(patchedVersions()).toEqual(['2026/01', '2022/02']);
  });

  it('does not retry unrelated errors', async () => {
    mockGoogle('2026/01', () => {
      throw { code: 403, message: 'The caller does not have permission' };
    });

    await expect(
      updateBasePlanPrices(credentials, 'com.example', 'rise_weekly', 'weekly', [])
    ).rejects.toMatchObject({ code: 403 });
    expect(patchedVersions()).toEqual(['2026/01']);
  });
});
