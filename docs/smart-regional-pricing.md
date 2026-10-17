# Smart regional pricing

`Smart` is PricingKit's recommended default for digital apps. It is not meant
to be a claim that a static formula can discover the mathematically optimal
price. It is a better **prior** than raw PPP, Big Mac, Netflix, or FX-only
pricing until the app has enough first-party data to run market-level tests.

## Objective

For software with near-zero marginal cost per additional customer, optimize
**revenue / LTV per eligible user**, not conversion rate and not cost-plus
margin.

For a market `c` and tested price `p`, the long-run objective is approximately:

`RPU365(c, p) = paid_conversion(c, p) * realized_LTV365(c, p)`

Lower prices are good only when the resulting conversion/retention lift more
than offsets the lower price. There is no arbitrary cost floor in the model.

## Why not raw PPP?

World Bank PPP describes population-wide purchasing power. The people who own
an iPhone and pay for a subscription are usually a richer subset of the local
population, so raw PPP commonly discounts too much.

The `Smart` model compresses raw PPP with exponents below 1, then applies broad
regional floors/caps derived from current mobile-subscription benchmarks.

## Why not Netflix / Big Mac?

- Big Mac pricing reflects food, labor and real-estate costs that do not map to
  a digital app.
- Netflix has local content/licensing/value differences and very different
  retention/plan economics.
- A basket of relevant apps plus first-party experiments is a better signal
  than any single global brand.

## Current priors

The exact code lives in `src/lib/conversion-indexes/smart.ts`.

- Western Europe: heavily compressed PPP, ~0.85-1.08x.
- Developed APAC: ~0.80-0.95x.
- Emerging Asia: iOS floor ~0.45x; Google can go lower.
- Latin America: roughly reproduces the large-app BR/MX benchmark ranges.
- MEA: lower Google floor than App Store.
- Sparse markets: compressed PPP (`sqrt(PPP)` on iOS) with safety floors/caps.

Example iOS outputs from representative raw PPP values:

| Market | Raw PPP | Smart |
|---|---:|---:|
| Spain | 0.65x | ~0.85x |
| Sweden | 0.88x | ~0.95x |
| Norway | 0.99x | ~1.00x |
| Switzerland | 1.14x | ~1.05x |
| Taiwan | 0.60x | ~0.77x |
| India | 0.22x | ~0.45x |
| Brazil | 0.48x | ~0.56x |
| Mexico | 0.57x | ~0.64x |

## How to supersede Smart with real data

Once a country has enough traffic:

1. Randomize eligible users between the current price and +/- 15-25% price
   variants.
2. Do not choose a winner from conversion alone.
3. Compare revenue per eligible user and, for subscriptions, projected or
   realized 365-day LTV including trial activation, renewals, refunds and churn.
4. Keep markets/platforms separate where behavior differs materially.
5. Promote the winning country-specific multiplier to a custom override.

This is especially important for the largest markets because one locally wrong
price matters more than perfect pricing across dozens of low-volume storefronts.

## Research references

- RevenueCat, State of Subscription Apps 2026:
  https://www.revenuecat.com/state-of-subscription-apps
- RevenueCat, Ultimate guide to price localization:
  https://www.revenuecat.com/blog/growth/price-localization-for-apps
- Flo / Dmitry Gurski, regional pricing:
  https://subclub.com/episode/how-to-maximize-revenue-with-regional-pricing-dmitry-gurski-flo
- Jacob Rushfinn, global pricing guidance:
  https://www.retention.blog/p/global-pricing-guidance
- Apple, auto-renewable subscription pricing:
  https://developer.apple.com/app-store/subscriptions/

## Apple storefront baseline (V2)

For Apple, Smart pricing does **not** start from a raw foreign-exchange
conversion. PricingKit resolves the selected base price to an actual App Store
Connect price point and calls Apple's price-point `equalizations` endpoint.

The returned customer prices are Apple's comparable storefront prices and
already reflect Apple's localization machinery: exchange rates, certain taxes,
and local pricing conventions. Smart then applies its app-market multiplier to
that local baseline and snaps the result to a valid Apple price point.

Conceptually:

```text
selected Apple base price point
        ↓
Apple equalized storefront customer price
        ↓
Smart app-market multiplier
        ↓
nearest valid Apple price point
```

That means a displayed `0.95×` in Austria is approximately 5% below Apple's
equalized Austrian baseline; it is no longer 5% below a raw USD→EUR conversion.

If Apple's equalizations cannot be loaded, the Apple Smart preview is paused
rather than silently falling back to the old raw-FX behavior. Google Play keeps
the existing Smart calculation path.

Smart remains a starting prior, not a proof of the revenue-maximizing price.
Country/platform RPU or LTV experiments should supersede the prior once enough
first-party data exists.

## V3 revenue-tuned calibration

V3 keeps the V2 Apple equalized-storefront baseline and changes only the
no-first-party-data prior.

The main calibration changes are:

- Western Europe is kept closer to North American pricing (roughly 0.90–1.00x
  for most markets rather than allowing an 0.85x floor).
- Japan and South Korea move upward into a roughly 0.85–0.95x band.
- Singapore and Hong Kong move upward into a roughly 0.90–1.00x band.
- UAE, Qatar, Kuwait, Bahrain, Saudi Arabia, and Oman are removed from the
  generic MEA curve and receive a dedicated high-income Gulf prior.
- Emerging Asia, Latin America, and genuinely lower-income MEA markets retain
  the V2 behavior.

The purpose is not to maximize conversion rate. The prior is intentionally
biased toward maximizing revenue / payer LTV for digital apps with negligible
marginal cost. It should still be replaced by country/platform RPU or LTV
experiments as soon as first-party data is statistically useful.

## V4 consumer-price equalization guardrail

V4 changes the role of Apple's equalized storefront prices.

V2/V3 treated Apple's equalized customer price as the complete local baseline:

```text
Apple equalized customer price
        ×
Smart willingness-to-pay factor
```

That is useful for keeping developer proceeds comparable, but it can overstate
the price a customer should see when Apple's equalization matrix is materially
above the current FX + tax equivalent.

V4 instead targets the customer-facing price:

```text
US/base customer price
        ↓
current FX conversion
        ↓
Smart app-market willingness-to-pay factor
        ↓
bounded Apple tax/local-convention uplift (max 1.25x)
        ↓
nearest valid Apple price point
```

Apple equalization is therefore still used, but only as a signal for taxes and
local pricing conventions. The uplift is measured as:

```text
Apple equalized local price / raw-FX local price
```

and capped at `1.25x`.

Example with a $4.99 US base and EUR/USD around 0.86:

```text
raw FX:                     about €4.29
Apple equalized baseline:        €5.99
equalization uplift:             ~1.40x
V4 bounded uplift:                1.25x
AT Smart WTP factor:             ~0.96x
consumer target:            ~€5.15
```

The exact final value is then snapped to an available Apple price point.

Why this is closer to the intended objective:

- Apple says its automatic equalization is driven by FX, certain taxes and
  local pricing conventions and is designed to keep global earnings consistent.
- Revenue-oriented app pricing should instead optimize the customer-facing
  price / RPU / LTV.
- Large app publishers do not use one universal rule: observed video-app
  pricing ranges from same-numeric USD/EUR pricing to Apple's higher equalized
  EUR tiers, and companies such as Mojo explicitly A/B test local prices.
- The 1.25x cap is a guardrail, not a claimed universal optimum. It roughly
  accommodates high VAT/GST storefronts while stopping the equalization matrix
  from overwhelming the willingness-to-pay model.

The next upgrade after V4 should be first-party price experimentation. Once a
country/platform has enough volume, measured RPU/LTV should replace the prior.

## V4.1 final revenue prior

V4.1 is the production candidate before first-party price experiments.

Changes from V4:

- Apple customer tax is inferred from App Store Connect price-point proceeds
  (`customerPrice`, `proceeds`, `proceedsYear2`) instead of using the hard
  1.25x equalization cap as the primary path.
- A persistent App Store Small Business Program toggle switches proceeds
  estimation to the 85% developer share from day one.
- Afghanistan and other sparse low-income markets no longer inherit the
  accidental `sqrt(0.50) ~= 0.71` missing-data behavior.
- Taiwan, Macao and Brunei receive a secondary high-income Asia prior below
  Singapore/Hong Kong.
- Central/Eastern Europe and high-income LATAM receive audited iOS priors.
- Pacific island outliers such as Vanuatu, Solomon Islands and Micronesia are
  prevented from inheriting implausibly high app-WTP from local price levels.
- Bulgaria uses EUR for Apple's storefront.
- Open Exchange Rates remains primary when configured; otherwise Frankfurter
  v2 provides no-key live USD exchange rates.

The customer-price path is:

```text
base customer price
  -> live FX
  -> app-market / iOS willingness-to-pay prior
  -> Apple-derived local tax factor
  -> nearest valid Apple price point
```

This is a no-first-party-data prior, not a mathematical proof of the revenue
optimum. Once enough traffic exists, country/platform revenue-per-install and
LTV experiments should replace the prior.

## V5 Android platform-selection model

V5 replaces Google Play's hand-tuned per-region discounts (`apple × 0.82`,
`ppp^0.72`, ...) with one model derived from each market's iOS share.

### Why iOS priors sit above PPP (e.g. Afghanistan)

The iOS priors deliberately price above raw PPP where iPhones are a niche.
In Afghanistan iOS is ~12% of mobile usage, so iPhone owners (and App Store
payers, who additionally need a working foreign card or gift card) are a
small, affluent slice of the population. Raw PPP (~0.20x: World Bank 2024
factor 13.2 AFN per international $ vs ~65 AFN/USD) describes the average
consumer, not that slice. The 0.45x iOS prior is ~2.2x PPP, in line with
India (0.45x vs 0.22x PPP, ~6% iOS share). Note Google Play does not sell
paid content in Afghanistan, so there is no Android price to set there.

### Why Android needs its own adjustment

That wealth premium is iOS-specific. Where Android is the mass platform,
Android payers are close to the average smartphone owner. The premium does
not vanish entirely: Android payers still need a smartphone, a working Play
payment method and willingness to pay, and with heavy-tailed WTP the
revenue-maximizing price sits above the median payer. So Android should be
below iOS, but not at raw PPP.

### Model

Smartphone users are sorted by a latent affluence score ~ N(0, 1), and iOS
users are the top `s` share (StatCounter iOS mobile share, 12-month mean).
The difference between the mean affluence of iOS and Android users is

```text
gap(s) = phi(z) / (s * (1 - s)),   z = PhiInverse(1 - s)
androidFactor = clamp(exp(-0.6 * (gap(s) - gap(s_US))), 0.70, 1.0)
googleMultiplier = iosMultiplier * androidFactor
```

`gap(s)` is flat for 30-60% iOS share (both platforms are mass market, as in
the US where RevenueCat sees identical store pricing) and grows quickly once
iOS becomes a niche. `K = 0.6` puts India (~6% iOS) at ~0.74, matching the
~0.70-0.75 Play/App Store price ratio RevenueCat reports for IN/SEA. The model
reproduces the old hand-tuned India and Brazil values, then goes further where
iOS is especially niche.

| Market | iOS share | Android factor | Old Google | V5 Google |
|---|---:|---:|---:|---:|
| India | 6% | 0.74 | 0.34 | 0.33 |
| Kenya | 6% | 0.74 | 0.45 | 0.37 |
| Nigeria | 15% | 0.88 | 0.34 | 0.35 |
| Brazil | 20% | 0.92 | 0.52 | 0.51 |
| UAE | 20% | 0.92 | 0.91 | 0.86 |
| Mexico | 29% | 0.97 | 0.60 | 0.62 |
| Poland | 32% | 0.98 | 0.68 | 0.74 |
| Vietnam | 41% | 1.00 | 0.39 | 0.45 |
| Germany | 38% | 0.99 | 0.96 | 0.95 |

Guardrails:

- Android is never priced above iOS in the same market (factor <= 1).
- Android is never more than 30% below iOS (factor >= 0.70), to limit
  cross-platform arbitrage when entitlements are shared across stores.
- Markets with iOS share at or above the US level get factor 1, which also
  neutralizes noisy StatCounter values for tiny territories.

The iOS share snapshot lives in `src/lib/conversion-indexes/platform-share.ts`
and should be refreshed roughly yearly. As with every Smart prior, Play
Console price experiments on RPU/LTV should replace it for large markets.
