/**
 * pantryStore.js — unified pantry persistence layer.
 *
 * On first read, seeds pantry.json into localStorage under local_pantry.
 * All subsequent reads and writes go to that key.
 * The seed file (pantry.json) is never mutated.
 */

import seedPantry from '../data/pantry.json';
import { withDerivedConversions } from '../lib/units.js';

const PANTRY_KEY = 'local_pantry';
const PANTRY_VERSION_KEY = 'kitchen_pantry_version';
const CURRENT_PANTRY_VERSION = 'v8';
const PRICE_PROMPT_VERSION_KEY = 'kitchen_price_prompt_version';

const STALE_DAYS = 7;

// ─── Internal read/write ──────────────────────────────────────────────────────

function readAllPantry() {
  try {
    const stored = localStorage.getItem(PANTRY_KEY);
    if (!stored) {
      localStorage.setItem(PANTRY_KEY, JSON.stringify(seedPantry));
      return [...seedPantry];
    }
    return JSON.parse(stored);
  } catch (err) {
    console.error('Failed to read pantry from localStorage:', err);
    return [...seedPantry];
  }
}

function writePantry(items) {
  try {
    localStorage.setItem(PANTRY_KEY, JSON.stringify(items));
  } catch (err) {
    console.error('Failed to write pantry to localStorage:', err);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nameToId(name) {
  return name.toLowerCase().trim().replace(/\s+/g, '-');
}

function nameToCanonical(name) {
  return name
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// "cup:250, tbsp:15" → { cup: 250, tbsp: 15 }
function parseConversionsStr(str) {
  if (!str || typeof str !== 'string' || !str.trim()) return null;
  return Object.fromEntries(
    str.split(',')
      .map(s => s.trim().split(':').map(p => p.trim()))
      .filter(([k, v]) => k && !isNaN(parseFloat(v)))
      .map(([k, v]) => [k, parseFloat(v)])
  );
}

// "flour, plain flour" → ["flour", "plain flour"]
function parseAliasesStr(str) {
  if (!str || typeof str !== 'string' || !str.trim()) return null;
  return str.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// true if dateStr is missing or older than STALE_DAYS
function isStale(dateStr) {
  if (!dateStr) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);
  return new Date(dateStr) < cutoff;
}

// ─── Public reads ─────────────────────────────────────────────────────────────

/**
 * Returns the full pantry array from localStorage (seeds on first call).
 * @returns {Array} PantryItem[]
 */
export function readPantry() {
  // Conversions are materialised here and only here. Write paths use the raw
  // readAllPantry() so derived values never get persisted back as authored ones.
  return readAllPantry().map(withDerivedConversions);
}

// ─── Public writes ───────────────────────────────────────────────────────────

/**
 * Upsert a pantry item.
 *
 * Looks up by data.id, then by nameToId(data.name), then by alias match.
 * - Not found → create new item with defaults, merged with provided data.
 * - Found     → merge provided data into the existing item in-place.
 *
 * Accepts both pkg* (modal) and package* (price update) field names.
 *
 * @param {Object} data
 *   id?, name?, baseUnit?,
 *   pkgValue?/packageValue?, pkgUnit?/packageUnit?, pkgPrice?/packagePrice?,
 *   pkgMatch?/matchedProduct?, costPerUnit?,
 *   conversions? (string "cup:250" or object), aliases? (string or array),
 *   dateLastUpdated?, needsCosting?
 * @returns {Array} Updated PantryItem[]
 */
export function savePantryItem(data) {
  const items = readAllPantry();

  // ── Normalize field names ─────────────────────────────────────────────────
  const pv  = parseFloat(data.pkgValue   ?? data.packageValue)  || null;
  const pu  = data.pkgUnit     ?? data.packageUnit  ?? null;
  const pp  = parseFloat(data.pkgPrice   ?? data.packagePrice)  || null;
  const pm  = data.pkgMatch    ?? data.matchedProduct ?? null;
  const cpu = data.costPerUnit != null ? parseFloat(data.costPerUnit) : null;

  const parsedConversions = data.conversions
    ? (typeof data.conversions === 'string' ? parseConversionsStr(data.conversions) : data.conversions)
    : null;

  const parsedAliases = data.aliases
    ? (typeof data.aliases === 'string' ? parseAliasesStr(data.aliases) : data.aliases)
    : null;

  // ── Lookup ────────────────────────────────────────────────────────────────
  const lookupId = data.id ?? (data.name ? nameToId(data.name) : null);
  let idx = lookupId != null ? items.findIndex(item => item.id === lookupId) : -1;

  // Alias fallback: lookupId might appear in another item's alias list
  if (idx === -1 && lookupId) {
    idx = items.findIndex(item => item.aliases?.includes(lookupId));
    if (idx !== -1 && data.id && items[idx].id !== data.id) {
      // Conflict: name resolves to a different item than the provided id
      window.alert(`This item already exists as "${items[idx].canonicalName}".`);
      return items;
    }
  }

  // ── Compute derived fields ────────────────────────────────────────────────
  const computedCostPerUnit = cpu != null
    ? cpu
    : (pv != null && pp != null && pv > 0 ? pp / pv : null);

  const priceComplete = pv != null && pp != null && pv > 0 && pp > 0;

  // ── Update existing ───────────────────────────────────────────────────────
  if (idx !== -1) {
    const existing = items[idx];
    const updated  = { ...existing };

    if (data.name)                      updated.canonicalName   = nameToCanonical(data.name);
    if (data.baseUnit)                  updated.baseUnit        = data.baseUnit;
    if (parsedAliases?.length)          updated.aliases         = parsedAliases;
    if (parsedConversions)              updated.conversions     = parsedConversions;
    if (pv != null)                     updated.packageValue    = pv;
    if (pu != null)                     updated.packageUnit     = pu;
    if (pp != null)                     updated.packagePrice    = pp;
    if (pm != null)                     updated.matchedProduct  = pm;
    if (computedCostPerUnit != null)    updated.costPerUnit     = computedCostPerUnit;
    if (data.dateLastUpdated !== undefined) updated.dateLastUpdated = data.dateLastUpdated;
    if (data.priceSource !== undefined) updated.priceSource     = data.priceSource;
    if (data.inUse !== undefined)       updated.inUse           = data.inUse;

    // needsCosting: explicit override wins; otherwise false when price complete
    if (data.needsCosting !== undefined) {
      updated.needsCosting = data.needsCosting;
    } else if (priceComplete) {
      updated.needsCosting = false;
    }

    items[idx] = updated;
    writePantry(items);
    return items;
  }

  // ── Create new ───────────────────────────────────────────────────────────
  if (!data.name) {
    console.error('savePantryItem: cannot create item without a name');
    return items;
  }

  const newId = nameToId(data.name);
  const newItem = {
    id:              newId,
    canonicalName:   nameToCanonical(data.name),
    aliases:         parsedAliases?.length ? parsedAliases : [data.name.toLowerCase()],
    baseUnit:        data.baseUnit ?? 'each',
    // User-added items have no density; their authored conversions act as overrides.
    gPerMl:          data.gPerMl ?? null,
    gPerEach:        data.gPerEach ?? null,
    conversions:     parsedConversions ?? {},
    costPerUnit:     computedCostPerUnit ?? 0,
    packageValue:    pv,
    packageUnit:     pu ?? data.baseUnit ?? 'each',
    packagePrice:    pp,
    matchedProduct:  pm,
    dateLastUpdated: data.dateLastUpdated ?? null,
    priceSource:     data.priceSource ?? 'user',
    inUse:           data.inUse ?? true,
    needsCosting:    !priceComplete,
    priceOptionCount: 3,
    searchHints:     [],
    userAdded:       true,
    submittedToSeed: false,
    dateUserAdded:   new Date().toISOString().split('T')[0],
  };

  items.push(newItem);
  writePantry(items);
  return items;
}

/**
 * Marks items as needsCosting:true if their price is older than 7 days.
 * Called once at app launch.
 *
 * @returns {number} Count of items marked stale
 */
export function refreshNeedsCosting() {
  const items = readAllPantry();

  let staleCount = 0;
  const updated = items.map(item => {
    if (!item.dateLastUpdated || item.needsCosting) return item;
    if (isStale(item.dateLastUpdated)) {
      staleCount++;
      return { ...item, needsCosting: true };
    }
    return item;
  });

  if (staleCount > 0) writePantry(updated);
  return staleCount;
}

/**
 * Returns user-added items not yet submitted to the seed pantry.
 * @returns {Array} PantryItem[] where userAdded && !submittedToSeed
 */
export function getPendingSubmissions() {
  return readAllPantry().filter(item => item.userAdded && !item.submittedToSeed);
}

/**
 * One-time pantry migration: aligns user's localStorage pantry with the current seed file
 * while preserving all user pricing data and any custom (user-added) ingredients.
 * Guarded by a version key so it only runs once per version bump.
 */
export function migratePantryIfNeeded() {
  const storedVersion = localStorage.getItem(PANTRY_VERSION_KEY)
  if (storedVersion === CURRENT_PANTRY_VERSION) return

  const stored = readAllPantry()
  const storedById = Object.fromEntries(stored.map(item => [item.id, item]))

  const merged = seedPantry.map(seedItem => {
    const existing = storedById[seedItem.id]
    if (!existing) return seedItem
    // If the seed changed an item's baseUnit, the stored price is denominated in the old
    // unit and carrying it over would be wrong by the conversion factor (banana moved
    // each → g at v6: R3/each would have become R3/gram). Seed pricing wins instead.
    if (existing.baseUnit && existing.baseUnit !== seedItem.baseUnit) return seedItem
    return {
      ...seedItem,
      costPerUnit:      existing.costPerUnit,
      packageValue:     existing.packageValue,
      packageUnit:      existing.packageUnit,
      packagePrice:     existing.packagePrice,
      matchedProduct:   existing.matchedProduct,
      dateLastUpdated:  existing.dateLastUpdated,
      priceSource:      existing.priceSource,
      needsCosting:     existing.needsCosting,
      priceOptionCount: existing.priceOptionCount,
    }
  })

  const seedIds = new Set(seedPantry.map(i => i.id))
  const customItems = stored.filter(item => !seedIds.has(item.id))

  writePantry([...merged, ...customItems])
  localStorage.setItem(PANTRY_VERSION_KEY, CURRENT_PANTRY_VERSION)
}

/**
 * Compares the bundled seed pantry against the stored pantry to find price
 * changes that require user consent before being applied (see PricePushModal).
 * Pure read — never writes. Returns { setA: [], setB: [] } once the current
 * version has already been prompted (see markPricePromptSeen).
 *
 * Set A (routine): priceSource unset or 'apify', incoming seed price differs.
 * Set B (manual conflict): priceSource 'user', incoming seed price differs.
 * Items with priceSource 'server' are out of scope (handled by the separate
 * Asus sync flow). Only items referenced by at least one saved recipe are
 * considered — prices no recipe uses are never prompted.
 *
 * @param {Set<string>|Array<string>} usedIds — pantry ids referenced by the user's recipes
 * @returns {{ setA: Array, setB: Array }}
 */
export function computeStagedPriceChanges(usedIds) {
  const promptedVersion = localStorage.getItem(PRICE_PROMPT_VERSION_KEY)
  if (promptedVersion === CURRENT_PANTRY_VERSION) return { setA: [], setB: [] }

  const used = usedIds instanceof Set ? usedIds : new Set(usedIds ?? [])

  const stored = readAllPantry()
  const storedById = Object.fromEntries(stored.map(item => [item.id, item]))

  const setA = []
  const setB = []

  for (const seedItem of seedPantry) {
    if (!used.has(seedItem.id)) continue
    const existing = storedById[seedItem.id]
    if (!existing) continue
    if (existing.priceSource === 'server') continue
    if (seedItem.packagePrice == null || existing.packagePrice == null) continue
    if (seedItem.packagePrice === existing.packagePrice) continue

    const row = {
      id:               seedItem.id,
      canonicalName:    existing.canonicalName,
      oldPrice:         existing.packagePrice,
      newPrice:         seedItem.packagePrice,
      // null rather than Infinity for free items (water, etc. sit at packagePrice 0)
      pctChange:        existing.packagePrice
        ? ((seedItem.packagePrice - existing.packagePrice) / existing.packagePrice) * 100
        : null,
      newPackageValue:  seedItem.packageValue,
      newPackageUnit:   seedItem.packageUnit,
      newMatchedProduct: seedItem.matchedProduct,
      baseUnit:         existing.baseUnit,
    }

    if (existing.priceSource === 'user') setB.push(row)
    else setA.push(row)
  }

  return { setA, setB }
}

/**
 * Records that the current pantry version's price-push prompt has been shown
 * (actioned or skipped) so it doesn't reappear on reload.
 */
export function markPricePromptSeen() {
  localStorage.setItem(PRICE_PROMPT_VERSION_KEY, CURRENT_PANTRY_VERSION)
}

