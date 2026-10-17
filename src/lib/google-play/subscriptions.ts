import { googlePlayFetch } from './client';
import type {
  ServiceAccountCredentials,
  Subscription,
  BasePlan,
  RegionalBasePlanConfig,
  Money,
  RegionsVersion,
} from './types';
import { GOOGLE_PLAY_REGIONS, moneyToNumber } from './types';
import { calculateBulkPrices, calculateRegionalPrice } from './currency';
import { getExchangeRates } from '../exchange-rates/client';
import { FALLBACK_EXCHANGE_RATES } from '../conversion-indexes/exchange-rates';

interface GoogleApiSubscription extends Subscription {
  regionsVersion?: RegionsVersion;
}

interface SubscriptionListResponse {
  subscriptions?: GoogleApiSubscription[];
  nextPageToken?: string;
}

interface SubscriptionUpdateRequestBody {
  packageName: string;
  productId: string;
  basePlans?: BasePlan[];
}

/**
 * Latest Play regions version known at build time (Format: YYYY/MM). Google
 * adds new versions when it changes billable regions or currencies; 2026/01
 * moved AR, AZ and UZ to local currency (ARS, AZN, UZS) and added ET.
 */
export const KNOWN_LATEST_REGIONS_VERSION = '2026/01';

const REGIONS_VERSION_TTL_MS = 24 * 60 * 60 * 1000;
let cachedRegionsVersion: { version: string; fetchedAt: number } | null = null;

/**
 * Ask Google for the current regions version. `convertRegionPrices` is
 * read-only and returns the version its conversions are based on, so new
 * Google versions are picked up without a code change.
 */
export async function getLatestRegionsVersion(
  credentials: ServiceAccountCredentials,
  packageName: string
): Promise<string> {
  if (
    cachedRegionsVersion &&
    Date.now() - cachedRegionsVersion.fetchedAt < REGIONS_VERSION_TTL_MS
  ) {
    return cachedRegionsVersion.version;
  }
  try {
    const response = await googlePlayFetch<{ regionVersion?: { version?: string } }>(
      credentials,
      `/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/pricing:convertRegionPrices`,
      { method: 'POST', body: { price: { currencyCode: 'USD', units: '1' } } }
    );
    const version = response.regionVersion?.version;
    if (version) {
      cachedRegionsVersion = { version, fetchedAt: Date.now() };
      return version;
    }
  } catch (error) {
    console.warn('[subscriptions] could not fetch latest regions version:', error);
  }
  return KNOWN_LATEST_REGIONS_VERSION;
}

// Older Play regions version. Products created under it can still list regions
// that newer versions no longer bill. One-time products already default to it.
const LEGACY_REGIONS_VERSION = '2022/02';

function isRegionsVersionMismatch(error: unknown): boolean {
  const err = error as { code?: number; message?: string };
  return (
    err?.code === 400 &&
    typeof err.message === 'string' &&
    /regions version/i.test(err.message)
  );
}

const CURRENCY_MISMATCH =
  /Invalid currency for region code ([A-Z]{2}) at the specified regions version [\d/]+\. Expected ([A-Z]{3}) but got ([A-Z]{3})/;

/**
 * Google can change a region's billing currency between regions versions.
 * Existing base plans keep the old currency in GET responses, and sending it
 * back is rejected at the newer version. Convert just that region's price to the currency Google expects,
 * at the current exchange rate, rounded to a .99-style price point.
 */
async function convertRejectedCurrency(
  body: SubscriptionUpdateRequestBody,
  regionCode: string,
  expectedCurrency: string,
  actualCurrency: string
): Promise<boolean> {
  let rates: Record<string, number> = FALLBACK_EXCHANGE_RATES;
  try {
    rates = { ...FALLBACK_EXCHANGE_RATES, ...(await getExchangeRates()).rates };
  } catch {
    // Static snapshot is good enough to produce a valid price point.
  }
  if (!rates[expectedCurrency] || !rates[actualCurrency]) return false;

  let converted = false;
  for (const basePlan of body.basePlans ?? []) {
    for (const config of basePlan.regionalConfigs ?? []) {
      if (
        config.regionCode !== regionCode ||
        config.price?.currencyCode !== actualCurrency
      ) {
        continue;
      }
      const result = calculateRegionalPrice(
        moneyToNumber(config.price),
        regionCode,
        'direct',
        'nearest-99',
        undefined,
        undefined,
        { [regionCode]: expectedCurrency },
        { base: 'USD', rates, fetchedAt: new Date().toISOString() },
        actualCurrency,
        regionCode
      );
      console.warn(
        `[subscriptions] ${regionCode} ${basePlan.basePlanId}: Google requires ${expectedCurrency}; ` +
          `converted ${moneyToNumber(config.price)} ${actualCurrency} -> ${result.rawPrice} ${expectedCurrency}`
      );
      config.price = result.price;
      converted = true;
    }
  }
  return converted;
}

/**
 * PATCH a subscription's base plans.
 *
 * The subscriptions GET response does not include the regions version the
 * prices were authored under, so try the latest version first and fall back
 * to the legacy version when Google rejects regions for that version. Region
 * currencies Google no longer accepts at all are converted and retried. A
 * rejected PATCH writes nothing.
 */
async function patchSubscriptionBasePlans(
  credentials: ServiceAccountCredentials,
  packageName: string,
  productId: string,
  knownVersion: string | undefined,
  body: SubscriptionUpdateRequestBody
): Promise<GoogleApiSubscription> {
  const versions = knownVersion
    ? [knownVersion]
    : [await getLatestRegionsVersion(credentials, packageName), LEGACY_REGIONS_VERSION];
  const MAX_CURRENCY_FIXES = 10;
  let currencyFixes = 0;
  let versionIndex = 0;

  for (;;) {
    const regionsVersion = versions[versionIndex];
    try {
      return await googlePlayFetch<GoogleApiSubscription>(
        credentials,
        `/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/subscriptions/${encodeURIComponent(productId)}`,
        {
          method: 'PATCH',
          query: {
            'regionsVersion.version': regionsVersion,
            updateMask: 'basePlans',
          },
          body,
        }
      );
    } catch (error) {
      if (!isRegionsVersionMismatch(error)) throw error;
      const message = (error as { message?: string }).message ?? '';

      const currency = CURRENCY_MISMATCH.exec(message);
      if (
        currency &&
        currencyFixes < MAX_CURRENCY_FIXES &&
        (await convertRejectedCurrency(body, currency[1], currency[2], currency[3]))
      ) {
        currencyFixes += 1;
        continue;
      }

      if (versionIndex + 1 >= versions.length) throw error;
      console.warn(
        `[subscriptions] regions version ${regionsVersion} rejected, trying next:`,
        message
      );
      versionIndex += 1;
    }
  }
}

export async function listSubscriptions(
  credentials: ServiceAccountCredentials,
  packageName: string
): Promise<Subscription[]> {
  const subscriptions: Subscription[] = [];
  let pageToken: string | undefined;

  do {
    const response = await googlePlayFetch<SubscriptionListResponse>(
      credentials,
      `/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/subscriptions`,
      {
        query: {
          pageSize: 100,
          pageToken,
        },
      }
    );

    if (response.subscriptions) {
      subscriptions.push(...response.subscriptions);
    }

    pageToken = response.nextPageToken ?? undefined;
  } while (pageToken);

  return subscriptions;
}

export async function getSubscription(
  credentials: ServiceAccountCredentials,
  packageName: string,
  productId: string
): Promise<Subscription | null> {
  try {
    const subscription = await googlePlayFetch<GoogleApiSubscription>(
      credentials,
      `/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/subscriptions/${encodeURIComponent(productId)}`
    );

    if (subscription.regionsVersion) {
      console.log(`Subscription ${productId} regionsVersion:`, subscription.regionsVersion);
    } else {
      console.warn(`Subscription ${productId} has no regionsVersion in API response`);
    }

    return subscription;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 404) {
      return null;
    }
    throw error;
  }
}

export async function getBasePlan(
  credentials: ServiceAccountCredentials,
  packageName: string,
  productId: string,
  basePlanId: string
): Promise<BasePlan | null> {
  const subscription = await getSubscription(credentials, packageName, productId);
  if (!subscription) {
    return null;
  }
  return subscription.basePlans?.find(bp => bp.basePlanId === basePlanId) || null;
}

export async function updateBasePlanPrices(
  credentials: ServiceAccountCredentials,
  packageName: string,
  productId: string,
  basePlanId: string,
  regionalConfigs: RegionalBasePlanConfig[]
): Promise<BasePlan> {
  const subscription = await getSubscription(credentials, packageName, productId);
  if (!subscription) {
    throw new Error(`Subscription ${productId} not found`);
  }

  const basePlan = subscription.basePlans?.find(bp => bp.basePlanId === basePlanId);
  if (!basePlan) {
    throw new Error(`Base plan ${basePlanId} not found in subscription ${productId}`);
  }

  const existingConfigs = basePlan.regionalConfigs || [];
  const configMap = new Map<string, RegionalBasePlanConfig>();

  for (const config of existingConfigs) {
    configMap.set(config.regionCode, {
      ...config,
      newSubscriberAvailability: true,
    });
  }

  for (const config of regionalConfigs) {
    configMap.set(config.regionCode, {
      ...config,
      newSubscriberAvailability: true,
    });
  }

  const mergedConfigs = Array.from(configMap.values());
  const usConfig = mergedConfigs.find(c => c.regionCode === 'US');
  if (!usConfig) {
    throw new Error(`US price not found for base plan ${basePlanId}. Cannot calculate regional prices without a base USD price.`);
  }
  const baseUsdPrice = moneyToNumber(usConfig.price);

  const allRegionCodes = GOOGLE_PLAY_REGIONS.map(r => r.code);
  const missingRegions = allRegionCodes.filter(code => !configMap.has(code));

  if (missingRegions.length > 0) {
    const calculatedPrices = calculateBulkPrices(
      baseUsdPrice,
      missingRegions,
      'direct', // Use simple exchange rate for fill-in regions
      'nearest-99',
      undefined,
      undefined,
      undefined,
      undefined,
      'USD',
      'US'
    );
    for (const calculated of calculatedPrices) {
      configMap.set(calculated.regionCode, {
        regionCode: calculated.regionCode,
        price: calculated.price,
        newSubscriberAvailability: true,
      });
    }
  }

  const updatedConfigs = Array.from(configMap.values());

  const updatedBasePlans = subscription.basePlans?.map(bp => {
    if (bp.basePlanId === basePlanId) {
      return {
        ...bp,
        regionalConfigs: updatedConfigs,
      };
    }
    return bp;
  });


  const requestBody: SubscriptionUpdateRequestBody = {
    packageName,
    productId,
    basePlans: updatedBasePlans,
  };

  const response = await patchSubscriptionBasePlans(
    credentials,
    packageName,
    productId,
    subscription.regionsVersion?.version,
    requestBody
  );

  return response.basePlans?.find(bp => bp.basePlanId === basePlanId) || basePlan;
}

export async function deleteBasePlanRegionPrice(
  credentials: ServiceAccountCredentials,
  packageName: string,
  productId: string,
  basePlanId: string,
  regionCode: string
): Promise<BasePlan> {
  const subscription = await getSubscription(credentials, packageName, productId);
  if (!subscription) {
    throw new Error(`Subscription ${productId} not found`);
  }

  const basePlan = subscription.basePlans?.find(bp => bp.basePlanId === basePlanId);
  if (!basePlan) {
    throw new Error(`Base plan ${basePlanId} not found`);
  }

  const filteredConfigs = (basePlan.regionalConfigs || []).filter(
    config => config.regionCode !== regionCode
  );

  const configMap = new Map<string, RegionalBasePlanConfig>();
  for (const config of filteredConfigs) {
    configMap.set(config.regionCode, config);
  }

  const usConfig = filteredConfigs.find(c => c.regionCode === 'US');
  if (!usConfig) {
    throw new Error(`US price not found for base plan ${basePlanId}. Cannot calculate regional prices without a base USD price.`);
  }
  const baseUsdPrice = moneyToNumber(usConfig.price);

  const allRegionCodes = GOOGLE_PLAY_REGIONS.map(r => r.code);
  const missingRegions = allRegionCodes.filter(code => !configMap.has(code));

  if (missingRegions.length > 0) {
    const calculatedPrices = calculateBulkPrices(
      baseUsdPrice,
      missingRegions,
      'direct',
      'nearest-99',
      undefined,
      undefined,
      undefined,
      undefined,
      'USD',
      'US'
    );
    for (const calculated of calculatedPrices) {
      configMap.set(calculated.regionCode, {
        regionCode: calculated.regionCode,
        price: calculated.price,
        newSubscriberAvailability: true,
      });
    }
  }

  const updatedConfigs = Array.from(configMap.values());

  const updatedBasePlans = subscription.basePlans?.map(bp => {
    if (bp.basePlanId === basePlanId) {
      return {
        ...bp,
        regionalConfigs: updatedConfigs,
      };
    }
    return bp;
  });


  const deleteRequestBody: SubscriptionUpdateRequestBody = {
    packageName,
    productId,
    basePlans: updatedBasePlans,
  };

  const response = await patchSubscriptionBasePlans(
    credentials,
    packageName,
    productId,
    subscription.regionsVersion?.version,
    deleteRequestBody
  );

  return response.basePlans?.find(bp => bp.basePlanId === basePlanId) || basePlan;
}

export function calculateNewBasePlanPrice(
  currentConfig: RegionalBasePlanConfig,
  operation: { type: 'fixed' | 'percentage' | 'round'; value?: number; roundTo?: number }
): RegionalBasePlanConfig {
  const parsedUnits = parseFloat(currentConfig.price.units);
  if (isNaN(parsedUnits) || !Number.isFinite(parsedUnits)) {
    throw new Error(`Invalid price units value: "${currentConfig.price.units}"`);
  }
  const currentAmount = parsedUnits +
    (currentConfig.price.nanos ? currentConfig.price.nanos / 1_000_000_000 : 0);

  let newAmount: number;

  switch (operation.type) {
    case 'fixed':
      newAmount = operation.value ?? currentAmount;
      break;
    case 'percentage':
      newAmount = currentAmount * (1 + (operation.value ?? 0) / 100);
      break;
    case 'round':
      const roundTo = operation.roundTo ?? 0.99;
      newAmount = Math.floor(currentAmount) + roundTo;
      break;
    default:
      newAmount = currentAmount;
  }

  newAmount = Math.max(0, newAmount);

  let units = Math.floor(newAmount);
  let nanos = Math.round((newAmount - units) * 1_000_000_000);

  if (nanos > 999_999_999) {
    units += Math.floor(nanos / 1_000_000_000);
    nanos = nanos % 1_000_000_000;
  }

  const newPrice: Money = {
    currencyCode: currentConfig.price.currencyCode,
    units: units.toString(),
    nanos: nanos > 0 ? nanos : undefined,
  };

  return {
    ...currentConfig,
    price: newPrice,
  };
}
