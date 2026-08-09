// src/lib/pricer.js
// Fetches ingredient price candidates from Apify (Checkers scraper),
// scores them against a pantry item, and computes costPerUnit.
// Called by the UI when a user requests a price update for a pantry item.

// The Apify proxy Worker (src/workers/fetch-prices.js). Single source of truth —
// when the Worker moves, this is the only line to change. It has moved once already:
// the account subdomain went egouws-music → egouws, which broke every price search
// silently until someone tried one.
export const PRICE_WORKER_URL = 'https://nkc-fetch-prices-production.egouws.workers.dev';

// ─── Normalisation ────────────────────────────────────────────────────────────

function normalizeStr(str) {
  return (str || '')
    .toLowerCase().trim()
    .replace(/\bkilograms?\b/g, 'kg').replace(/\bgrams?\b/g, 'g')
    .replace(/\blitres?\b|\bliters?\b/g, 'l')
    .replace(/\bmillilitres?\b|\bmilliliters?\b/g, 'ml')
    .replace(/\bcheckers\b|\bspar\b|\bpnp\b|\bpick n pay\b|\bwoolworths\b|\bshoprite\b/g, '')
    .replace(/\bper\s+(?:kg|g|ml|l|unit)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── Package parsing ──────────────────────────────────────────────────────────

/**
 * Extracts package size and unit from a product name string.
 * Handles formats: "1kg", "500g", "2×500ml", "12 eggs", "loose"
 *
 * @param {string} str
 * @returns {{ packageValue: number|null, packageUnit: string|null }}
 */
export function parsePackageInfo(str) {
  const s = str || '';

  const multiM = s.match(/(\d+)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i);
  if (multiM) {
    return {
      packageValue: parseFloat(multiM[1]) * parseFloat(multiM[2]),
      packageUnit: multiM[3].toLowerCase(),
    };
  }

  const countM = s.match(/(\d+)\s*(?:s\b|units?\b|eggs?\b|rolls?\b|slices?\b|pcs?\b|pieces?\b)/i);
  if (countM) {
    return { packageValue: parseFloat(countM[1]), packageUnit: 'each' };
  }

  const stdM = s.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i);
  if (stdM) {
    return { packageValue: parseFloat(stdM[1]), packageUnit: stdM[2].toLowerCase() };
  }

  const looseM = s.match(/\b(loose|each|bunch)\b/i);
  if (looseM) {
    return { packageValue: 1, packageUnit: 'each' };
  }

  return { packageValue: null, packageUnit: null };
}

/**
 * Converts a package quantity to the canonical base unit (g, ml, each).
 *
 * @param {number} packageValue
 * @param {string} packageUnit
 * @returns {{ baseQuantity: number|null, baseUnit: string|null }}
 */
export function convertToBaseUnits(packageValue, packageUnit) {
  if (packageValue == null || packageUnit == null) return { baseQuantity: null, baseUnit: null };
  const u = packageUnit.toLowerCase();
  if (u === 'kg') return { baseQuantity: packageValue * 1000, baseUnit: 'g' };
  if (u === 'g')  return { baseQuantity: packageValue,        baseUnit: 'g' };
  if (u === 'l')  return { baseQuantity: packageValue * 1000, baseUnit: 'ml' };
  if (u === 'ml') return { baseQuantity: packageValue,        baseUnit: 'ml' };
  return { baseQuantity: packageValue, baseUnit: 'each' };
}

/**
 * Computes cost per base unit (R/g, R/ml, R/each).
 * Returns null if the package unit does not match the item's baseUnit.
 *
 * @param {number} packagePrice  — total package price in ZAR
 * @param {number} packageValue  — numeric quantity (e.g. 1000 for 1kg)
 * @param {string} packageUnit   — unit string (e.g. 'g', 'kg', 'ml')
 * @param {string} baseUnit      — pantry item's baseUnit ('g' | 'ml' | 'each')
 * @returns {number|null}
 */
export function computeCostPerUnit(packagePrice, packageValue, packageUnit, baseUnit) {
  const { baseQuantity, baseUnit: convertedUnit } = convertToBaseUnits(packageValue, packageUnit);
  if (!baseQuantity || convertedUnit !== baseUnit) return null;
  return packagePrice / baseQuantity;
}

// ─── Candidate scoring ────────────────────────────────────────────────────────

const IRRELEVANT_KEYWORDS = [
  'yoghurt', 'yogurt', 'muffin', 'chips', 'baby', 'drink', 'juice', 'sauce',
  'spread', 'flavoured', 'flavored', 'ice cream', 'smoothie', 'milkshake',
  'snack', 'candy', 'sweets', 'pudding',
];

// SA brands Checkers stocks. A brand named in an item's searchHints is matched against
// the product name: hit scores 1.0, no brand expected 0.5, mismatch 0.1. This list must
// stay in step with the brands used in pantry.json searchHints — a brand that is not
// listed here simply never scores, so the hint only helps the search query, not ranking.
const KNOWN_BRANDS = [
  // baking
  'snowflake', 'sasko', 'moirs', 'maizena', 'anchor', 'ina paarman',
  // sugar
  'huletts', 'selati',
  // grain, cereal, pasta
  'tastic', 'spekko', 'jungle', 'bokomo', 'iwisa', 'ace', 'white star',
  'fattis and monis', 'fattis',
  // dairy
  'clover', 'lancewood', 'parmalat', 'fairview', 'orley whip', 'danone',
  // fats
  'rama', 'stork', 'flora', 'sunfoil', 'excella', 'olive pride',
  // tinned, sauces, condiments
  'koo', 'rhodes', 'all gold', 'knorr', 'safari', 'nola', 'crosse blackwell',
  // confectionery, hot drinks
  'cadbury', 'nestle', 'beacon', 'nescafe', 'ricoffy', 'five roses', 'freshpak',
  // seasoning
  'robertsons', 'cerebos', 'rajah',
  // frozen
  'today', 'nulaid',
];

function scoreCandidate(pantryItem, product) {
  const ingNorm  = normalizeStr(pantryItem.canonicalName);
  const prodNorm = normalizeStr(product.name || product.title || '');

  // Name similarity (Jaccard token overlap)
  const ingTokens  = ingNorm.split(' ').filter(Boolean);
  const prodTokens = new Set(prodNorm.split(' ').filter(Boolean));
  const overlap    = ingTokens.filter(t => prodTokens.has(t)).length;
  const unionSize  = new Set([...ingTokens, ...prodTokens]).size;
  let nameSim = unionSize > 0 ? overlap / unionSize : 0;
  const prodWords = prodNorm.split(' ');
  if (ingTokens.length > 0 && ingTokens.every((t, i) => prodWords[i] === t)) {
    nameSim = Math.min(1, nameSim + 0.15);
  }

  // Unit family match
  const { packageUnit } = parsePackageInfo(product.name || product.title || '');
  const { baseUnit: prodBaseUnit } = convertToBaseUnits(1, packageUnit);
  const unitScore = prodBaseUnit == null       ? 0.5
                  : prodBaseUnit === pantryItem.baseUnit ? 1.0
                  : 0.0;

  // Category relevance
  const catScore = IRRELEVANT_KEYWORDS.some(kw => prodNorm.includes(kw)) ? 0.0 : 1.0;

  // Brand match — check canonicalName and searchHints for a known brand
  const allIngText = [ingNorm, ...(pantryItem.searchHints || []).map(h => h.toLowerCase())].join(' ');
  const ingBrand  = KNOWN_BRANDS.find(b => allIngText.includes(b));
  const prodBrand = KNOWN_BRANDS.find(b => prodNorm.includes(b));
  const brandScore = !ingBrand      ? 0.5
                   : ingBrand === prodBrand ? 1.0
                   : 0.1;

  return (nameSim * 0.50) + (unitScore * 0.20) + (catScore * 0.15) + (brandScore * 0.15);
}

// ─── Apify fetch ──────────────────────────────────────────────────────────────

/**
 * Fetches price candidates from the Apify Checkers scraper via Netlify proxy.
 * The proxy (netlify/functions/fetch-prices.js) handles the API key and Apify call.
 * This function handles scoring, ranking, and costPerUnit computation.
 *
 * @param {Object} pantryItem — PantryItem (from readPantry)
 * @returns {Promise<Array<{ product, score, packageValue, packageUnit, costPerUnit }>>}
 */
export async function fetchPriceOptions(pantryItem) {
  const hint = pantryItem.searchHints?.[0] ?? '';
  const searchTerm = hint ? `${pantryItem.canonicalName} ${hint}` : pantryItem.canonicalName;

  console.log(`%c[Apify] Searching Checkers for: "${searchTerm}"`, 'color: #3498db; font-weight: bold');
  console.log('[Apify] Item details:', { canonicalName: pantryItem.canonicalName, baseUnit: pantryItem.baseUnit, searchHints: pantryItem.searchHints, priceOptionCount: pantryItem.priceOptionCount });

  const resp = await fetch(PRICE_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pantryItem }),
  });

  console.log(`[Apify] Response status: ${resp.status}`);

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error(`%c[Apify] ERROR ${resp.status}: ${resp.statusText}`, 'color: #e74c3c; font-weight: bold');
    console.error('[Apify] Error body:', errorText);
    let errorMsg = `Checkers API: ${resp.status}`;
    try {
      const errJson = JSON.parse(errorText);
      if (errJson.error === 'usage_exceeded') errorMsg = 'Apify usage limit reached. Try again later.';
      else if (errJson.message) errorMsg = errJson.message;
    } catch {}
    throw new Error(errorMsg);
  }

  let products;
  try {
    products = await resp.json();
  } catch (err) {
    console.error('[Apify] JSON parse failed:', err);
    throw new Error('Could not parse Checkers response');
  }
  console.log(`%c[Apify] ✓ Received ${products.length} products`, 'color: #27ae60');
  console.log('[Apify] First 3 results:', products.slice(0, 3));
  if (!Array.isArray(products)) return [];

  return products
    .map(product => {
      const name = product.name || product.title || '';
      const { packageValue, packageUnit } = parsePackageInfo(name);
      const priceNum = parseFloat(String(product.price ?? '').replace(/[^0-9.]/g, ''))
      const costPerUnit = (packageValue != null && !isNaN(priceNum))
        ? computeCostPerUnit(priceNum, packageValue, packageUnit, pantryItem.baseUnit)
        : null;
      return {
        product,
        score: scoreCandidate(pantryItem, product),
        packageValue,
        packageUnit,
        costPerUnit,
      };
    })
    .sort((a, b) => b.score - a.score);
}
