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
