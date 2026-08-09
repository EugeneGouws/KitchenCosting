// src/lib/units.js
// Derives a pantry item's unit-conversion map from a single density.
//
// cup / tbsp / tsp are all volume, so three hand-authored numbers per item had to agree
// with one ratio — and they didn't: 49 items carried a US 240ml cup value alongside an
// SA 15ml tbsp, understating volume-measured ingredients by ~9%. Storing one density and
// deriving the rest makes that disagreement impossible to express.
//
// Pure module, no imports. See docs/MISTAKES.md [2026-08-09].

// South African standard measures, in millilitres.
export const ML_PER_CUP  = 250;
export const ML_PER_TBSP = 15;
export const ML_PER_TSP  = 5;

// Significant figures, not decimal places. Derived values span four orders of magnitude —
// a cup of flour is ~133 while the g→each factor for an 800 g cabbage is 0.00125 — so
// fixed decimals would leave float noise on the large ones or destroy the small ones.
// 9 digits keeps enough precision that whole-number multiples stay clean: a 133.333333 g
// cup times 3 rounds back to exactly 400 g rather than 399.999.
function round(n) {
  if (!Number.isFinite(n) || n === 0) return n;
  return Number(n.toPrecision(9));
}

/**
 * Build the unit → baseUnit conversion map for a pantry item.
 *
 * Derived from `gPerMl` (mass of 1 ml) and `gPerEach` (mass of one unit). Any key the
 * item authors explicitly in `conversions` wins, so bespoke units survive untouched —
 * garlic's `clove`, celery's `stalk`/`finger`, and anything a user types into
 * AddIngredientModal.
 *
 * @param {Object} item — PantryItem with baseUnit, gPerMl?, gPerEach?, conversions?
 * @returns {Object} conversion map, e.g. { cup: 133.33, tbsp: 8, tsp: 2.67 }
 */
export function deriveConversions(item) {
  if (!item) return {};

  const { baseUnit, gPerMl, gPerEach } = item;
  const authored = item.conversions ?? {};
  const derived = {};

  if (baseUnit === 'g') {
    // Volume measures resolve to grams via density.
    if (gPerMl != null) {
      derived.cup  = round(ML_PER_CUP  * gPerMl);
      derived.tbsp = round(ML_PER_TBSP * gPerMl);
      derived.tsp  = round(ML_PER_TSP  * gPerMl);
    }
    // "2 onions" → grams.
    if (gPerEach != null) derived.each = round(gPerEach);

  } else if (baseUnit === 'ml') {
    // Volume → volume is an identity, no density needed.
    derived.cup  = ML_PER_CUP;
    derived.tbsp = ML_PER_TBSP;
    derived.tsp  = ML_PER_TSP;
    // "500 g milk" → millilitres.
    if (gPerMl) derived.g = round(1 / gPerMl);
    if (gPerEach != null) derived.each = round(gPerEach);

  } else if (baseUnit === 'each') {
    // "500 g cabbage" → a count.
    if (gPerEach) derived.g = round(1 / gPerEach);
  }

  return { ...derived, ...authored };
}

/**
 * Returns a copy of the item with its conversions map materialised.
 * Applied on read so every consumer sees the shape it already expects.
 *
 * @param {Object} item — PantryItem
 * @returns {Object} PantryItem with conversions filled in
 */
export function withDerivedConversions(item) {
  if (!item) return item;
  return { ...item, conversions: deriveConversions(item) };
}
