/**
 * Pure parsing layer, no React, no side effects
 * input text of recipe. output ingredients list in raw text for matching
 * Summary of flow:
 * parseRecipeText -> findIngredients -> parseIngredientLine -> (findAmount, findUnit, findIngredient) -> parseWordNumber -> expandUnicodeFracs.
 */


// Inline word-to-number converter — covers every number word that appears in
// real recipes. Replaces the 'words-to-numbers' npm package which is a CJS
// module incompatible with Vite's browser bundler.
const WORD_NUM_MAP = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  half: 0.5, quarter: 0.25,
}
const WORD_NUM_RE = new RegExp(`\\b(${Object.keys(WORD_NUM_MAP).join('|')})\\b`, 'gi')

function wordsToNumbers(str) {
  const replaced = String(str).replace(WORD_NUM_RE, m => WORD_NUM_MAP[m.toLowerCase()])
  const trimmed = replaced.trim()
  const n = Number(trimmed)
  return trimmed !== '' && !isNaN(n) ? n : replaced
}


// Maps raw unit strings to their canonical form.
// cup/tsp/tbsp returned as-is — volumetric conversion deferred to matcher.
// lb/oz normalised to g via UNIT_MULTIPLIERS below.
// This list grows as new measures are discovered in real recipes.
const UNIT_NORM = {
  // Volume
  cup: 'cup', cups: 'cup',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'ml', liter: 'ml', liters: 'ml', litre: 'ml', litres: 'ml',
  // Weight
  g: 'g', gram: 'g', grams: 'g', kg: 'g',
  kilo: 'g', kilos: 'g', kilogram: 'g', kilograms: 'g',
  lb: 'g', lbs: 'g', pound: 'g', pounds: 'g',
  oz: 'g', ounce: 'g', ounces: 'g',
  // Count — only units that reliably appear BETWEEN amount and ingredient name.
  // Units where the ingredient name often comes before the unit (e.g. "garlic cloves",
  // "salmon fillets") are intentionally omitted to avoid name-stripping bugs.
  each: 'each', whole: 'each', piece: 'each', pieces: 'each',
  slab: 'each', slabs: 'each',
  pack: 'each', packs: 'each', packet: 'each', packets: 'each',
  can: 'each', cans: 'each', tin: 'each', tins: 'each',
  pinch: 'each', pinches: 'each',
  dash: 'each', dashes: 'each',
};

// Units only recognised directly after the amount ("2 cloves garlic"), never by the
// general token scan — the same words trail the name far more often ("garlic cloves",
// "celery stalks") where treating them as units would strip the ingredient.
// The pantry carries matching conversions (garlic → clove, celery → stalk/finger).
const LEADING_ONLY_UNITS = {
  clove: 'clove', cloves: 'clove',
  stalk: 'stalk', stalks: 'stalk',
};

// Multipliers applied after unit normalisation (e.g. kg→g, lb→g, l→ml).
const UNIT_MULTIPLIERS = {
  kg: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000,
  l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000,
  lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
};

// Size and preparation words that precede the real ingredient name.
// Stripped from the front of the name only — "whole" and "piece" still work as units
// because unit extraction happens before findIngredient.
const NAME_PREFIX_NOISE = new Set([
  'large', 'small', 'medium', 'extra', 'jumbo', 'fresh', 'freshly', 'ripe',
  'chopped', 'finely', 'roughly', 'coarsely', 'grated', 'melted', 'softened',
  'sifted', 'crushed', 'minced', 'beaten', 'toasted', 'cold', 'warm',
  'of', 'tin', 'tins', 'can', 'cans', 'jar', 'jars', 'packet', 'packets',
  'pack', 'packs', 'bottle', 'bottles', 'box', 'tub', 'punnet', 'bunch',
]);

// Lines that signal the end of the ingredient section or should be skipped.
// Scale buttons (1x, 2x, 1/2x), form noise, and cooking-method verbs are filtered here.
// Each verb carries a trailing \b so it only matches the whole word. Without it,
// "mix" swallowed "Mixed peel" and "bake" swallowed "Bakers chocolate".
const SKIP_LINE_RE = /^(?:ingredients?:?\b|(?:method|directions|instructions?|preparation|preheat|oven|bake|mix|combine|stir|beat|fold|pour|grease|serves?|makes?|yields?)\b|for\s+the\b|line\s+a\b|top\s+of\s+form\b|bottom\s+of\s+form\b|\d+\/?\d*[xX]$)/i;
const STOP_RE = /^(method|directions|instructions?|steps?|preparation)\b/i;

// Ingredients that are free/always-available and should never be costed.
const FREE_INGREDIENTS = new Set(['water', 'warm water', 'hot water', 'cold water', 'boiling water']);


// --- Dealing with fractions ---

const UNICODE_FRACS = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const FRAC_CHARS = Object.keys(UNICODE_FRACS).join('');

/**
 * Expand Unicode fraction characters in a string to their decimal equivalents.
 * "1½" → "1.5", "¾" → "0.75", "2⅓" → "2.3333..."
 */
function expandUnicodeFracs(str) {
  // Pass 1: integer glued directly to a fraction char, e.g. "1½" → "1.5"
  let result = str.replace(
    new RegExp(`(\\d+)([${FRAC_CHARS}])`, 'g'),
    (_, int, frac) => String(Number(int) + UNICODE_FRACS[frac]),
  );
  // Pass 2: lone fraction chars, e.g. "½" → "0.5"
  result = result.replace(
    new RegExp(`[${FRAC_CHARS}]`, 'g'),
    (frac) => String(UNICODE_FRACS[frac]),
  );
  return result;
}

/**
 * Resolve "and"-connector and fraction-word patterns that wordsToNumbers leaves
 * unhandled. Returns a number if a pattern matched, null otherwise.
 */
function resolveAndConnector(str) {
  let s = str.replace(/\band\s+a\s+(\d)/gi, 'and $1');

  const wtn = wordsToNumbers(s);
  if (typeof wtn === 'number') return null;
  s = String(wtn).trim();

  // "a half" / "a quarter" — fraction word replaced, e.g. "a 0.5"
  const aFrac = s.match(/^a\s+(\d*\.?\d+)\b/i);
  if (aFrac) return Number(aFrac[1]);

  // "N and a half" / "N and a quarter" — e.g. "1 and a 0.5" after substitution
  const andAFrac = s.match(/^(\d*\.?\d+)\s+and\s+a\s+(\d*\.?\d+)\b/i);
  if (andAFrac) return Number(andAFrac[1]) + Number(andAFrac[2]);

  const halfMatch = s.match(/^(\d*\.?\d+)\s+and\s+(\d*\.?\d+)\s+half\b/i);
  if (halfMatch) return Number(halfMatch[1]) + Number(halfMatch[2]) * 0.5;

  const qtrMatch = s.match(/^(\d*\.?\d+)\s+and\s+(\d*\.?\d+)\s+quarter\b/i);
  if (qtrMatch) return Number(qtrMatch[1]) + Number(qtrMatch[2]) * 0.25;

  const loneHalf = s.match(/^(\d*\.?\d+)\s+half\b/i);
  if (loneHalf) return Number(loneHalf[1]) * 0.5;

  const loneQtr = s.match(/^(\d*\.?\d+)\s+quarter\b/i);
  if (loneQtr) return Number(loneQtr[1]) * 0.25;

  const andFrac = s.match(/^(\d+)\s+and\s+(\d+)\/(\d+)/i);
  if (andFrac) return Number(andFrac[1]) + Number(andFrac[2]) / Number(andFrac[3]);

  const andDec = s.match(/^(\d+)\s+and\s+(\d*\.?\d+)/i);
  if (andDec) return Number(andDec[1]) + Number(andDec[2]);

  // "N 0.DDD" — integer + decimal < 1, produced by expanding "1 ¾" → "1 0.75"
  const intDec = s.match(/^(\d+)\s+(0\.\d+)$/);
  if (intDec) return Number(intDec[1]) + Number(intDec[2]);

  return null;
}

// --- Exported functions ---

/**
 * Convert a text string that may contain word numbers or fractions to a float.
 * Returns 0 on failure, never throws.
 */
export function parseWordNumber(str) {
  try {
    let s = expandUnicodeFracs(String(str).trim());

    if (s.toLowerCase() === 'a' || s.toLowerCase() === 'an') return 1;

    const connected = resolveAndConnector(s);
    if (connected !== null) return connected;

    const wtn = wordsToNumbers(s);
    if (typeof wtn === 'number') return wtn;
    s = String(wtn).trim();

    const mixedMatch = s.match(/(\d+)\s+(\d+)\/(\d+)/);
    if (mixedMatch) {
      return Number(mixedMatch[1]) + Number(mixedMatch[2]) / Number(mixedMatch[3]);
    }

    const fracMatch = s.match(/^(\d+)\/(\d+)$/);
    if (fracMatch) {
      return Number(fracMatch[1]) / Number(fracMatch[2]);
    }

    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;

  } catch {
    return 0;
  }
}

export default parseWordNumber;

/**
 * Parse the leading amount portion of an ingredient token string.
 * Input: "1.5", "¾", "1 1/2", "two", "one and a half", "1 ¾" (space-separated unicode frac)
 * Output: number
 */
export function parseAmountStr(str) {
  const s = expandUnicodeFracs(String(str).trim());

  // "1 3/4" mixed fraction
  const mixedMatch = s.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (mixedMatch) {
    return Number(mixedMatch[1]) + Number(mixedMatch[2]) / Number(mixedMatch[3]);
  }

  // "1 0.75" — expanded "1 ¾" after expandUnicodeFracs on token pair
  const intDecMatch = s.match(/^(\d+)\s+(0\.\d+)$/);
  if (intDecMatch) return Number(intDecMatch[1]) + Number(intDecMatch[2]);

  return parseWordNumber(s);
}

// --- Private pipeline helpers ---

/**
 * Normalise a raw ingredient line before amount extraction:
 * - decode residual HTML entities
 * - expand hyphenated mixed fractions: "1-3/4" → "1 3/4"
 * - collapse hyphenated numeric ranges: "1-2" → "1" (take lower bound)
 * - collapse "N to M" ranges: "1/4 to 1/2" → "1/4"
 */
function normaliseLine(raw) {
  let s = String(raw)
    // Residual numeric HTML entities (&#32; &#039; &#8217; etc.)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

  // Multipack: "1 x 400g" → "400g", "2 x 400g" → "800g" (fold the count into the size)
  s = s.replace(
    /\b(\d+)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/g,
    (_, count, size, unit) => `${Number(count) * Number(size)}${unit}`,
  );

  // Hyphenated mixed fraction: "1-3/4" → "1 3/4"
  s = s.replace(/\b(\d+)-(\d+\/\d+)\b/g, '$1 $2');

  // Hyphenated numeric range: "1-2 tsp" → "1 tsp" (take lower bound, no slash = not a fraction)
  s = s.replace(/\b(\d+)-(\d+)\b/g, '$1');

  // "N to M unit" range: "1/4 to 1/2 tsp" → "1/4 tsp"
  s = s.replace(/(\d[\d/.]*)\s+to\s+\d[\d/.]*/gi, '$1');

  return s;
}

/**
 * Parse the amount, raw unit token, and name portion from a cleaned ingredient line.
 * Returns { amount, rawUnit, namePart } or null if no amount can be extracted.
 */
function findAmount(line) {
  const l = normaliseLine(line);

  // Glued unit: "250g", "500ml", "1.5kg", "1l", "8oz", "2lb"
  const gluedMatch = l.match(/^(\d*\.?\d+)(kg|g|ml|l|oz|lbs|lb)\b/i);
  if (gluedMatch) {
    // Strip any "/ altQty altUnit" alternative notation that follows (e.g. "100g / 3.5oz butter")
    const namePart = l.slice(gluedMatch[0].length).trim().replace(/^\/\s*[\d./]+\s*\w+\s*/, '');
    return {
      amount: parseAmountStr(gluedMatch[1]),
      rawUnit: gluedMatch[2].toLowerCase(),
      namePart,
    };
  }

  // Trailing amount: "Milk 250ml", "Cake flour 1kg" — common in costing-sheet exports.
  // Only when the line does not lead with a number, so the leading paths keep priority.
  if (!/^\d/.test(l)) {
    const trailingMatch = l.match(/^(.+?)\s+(\d*\.?\d+)\s*(kg|g|ml|l|oz|lbs|lb)$/i);
    if (trailingMatch) {
      return {
        amount: parseAmountStr(trailingMatch[2]),
        rawUnit: trailingMatch[3].toLowerCase(),
        namePart: trailingMatch[1],
      };
    }
  }

  // Token-split path
  const expanded = String(wordsToNumbers(expandUnicodeFracs(l)) ?? l);
  const tokens = expanded.split(/\s+/);

  // Leading-only units ("2 cloves garlic") — checked here so the general scan below
  // never sees them in trailing position ("garlic cloves").
  const leadingUnit = LEADING_ONLY_UNITS[(tokens[1] ?? '').toLowerCase()];
  if (leadingUnit && parseAmountStr(tokens[0]) !== 0) {
    return {
      amount: parseAmountStr(tokens[0]),
      rawUnit: tokens[1].toLowerCase(),
      namePart: tokens.slice(2).join(' '),
    };
  }

  let unitIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (UNIT_NORM[tokens[i].toLowerCase()]) { unitIdx = i; break; }
  }

  if (unitIdx === -1) {
    // No recognised unit — amount is the first numeric token, rest is name
    const firstNum = parseAmountStr(tokens[0]);
    if (firstNum === 0) return null;
    return { amount: firstNum, rawUnit: '', namePart: tokens.slice(1).join(' ') };
  }

  if (unitIdx === 0) return null; // unit is first token, no amount

  const amountStr = tokens.slice(0, unitIdx).join(' ');
  const amount = parseAmountStr(amountStr);
  if (amount === 0) return null;
  return { amount, rawUnit: tokens[unitIdx].toLowerCase(), namePart: tokens.slice(unitIdx + 1).join(' ') };
}

/**
 * Normalise a raw unit token to its canonical form.
 * Returns 'each' for unrecognised or absent units.
 */
function findUnit(rawUnit) {
  if (!rawUnit) return 'each';
  return UNIT_NORM[rawUnit] ?? LEADING_ONLY_UNITS[rawUnit] ?? 'each';
}

/**
 * Clean the name portion of an ingredient line.
 * Strips parentheticals, alternative-unit annotations, comma-suffixes, and leading "of".
 */
function findIngredient(namePart) {
  const cleaned = namePart
    .replace(/\(.*?\)/g, '')           // strip "(sifted)" etc.
    .replace(/\/\/.*$/, '')            // strip "// or sub coconut aminos..." comments
    .replace(/,.*$/, '')               // strip ", finely chopped" etc.
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // Strip leading size/prep/container words ("3 large eggs" → "eggs",
  // "1 x 400g tin chopped tomatoes" → "tomatoes"). Never strip the last word,
  // so a line that is entirely noise still yields something to match on.
  const words = cleaned.split(' ').filter(Boolean);
  let start = 0;
  while (start < words.length - 1 && NAME_PREFIX_NOISE.has(words[start])) start++;
  return words.slice(start).join(' ');
}

/**
 * Parse a single ingredient line into a structured object.
 * @param {string} raw - One line of recipe text.
 * @returns {{ name, amount, unit, raw }} or null
 */
export function parseIngredientLine(raw) {
  const line = String(raw).trim().replace(/^[-•*·]\s*/, '');
  if (SKIP_LINE_RE.test(line)) return null;

  const parsed = findAmount(line);
  if (!parsed) return null;

  let { amount, rawUnit } = parsed;
  const { namePart } = parsed;

  // Apply unambiguous large-unit multipliers (kg→g, lb→g, oz→g, l→ml)
  if (UNIT_MULTIPLIERS[rawUnit]) {
    amount *= UNIT_MULTIPLIERS[rawUnit];
  }

  const unit = findUnit(rawUnit);
  const name = findIngredient(namePart);

  if (FREE_INGREDIENTS.has(name)) return null;
  if (name.length < 2) return null;
  if (name.split(/\s+/).length > 7) return null;

  return { name, amount, unit, raw };
}

/**
 * Filter recipe candidate lines down to those that look like ingredient lines.
 * For small lists (clean format): returns all candidates up to the first STOP.
 * For large lists (web-scraped page with nav junk): finds the longest contiguous
 * block of lines that successfully parse as valid ingredients, discarding nav noise.
 * @param {string[]} lines
 * @returns {string[]} raw ingredient line texts
 */
function findIngredients(lines) {
  const candidates = [];
  for (const line of lines) {
    if (STOP_RE.test(line)) break;
    if (SKIP_LINE_RE.test(line)) continue;
    candidates.push(line);
  }

  // Small list → likely a clean recipe format, return as-is.
  if (candidates.length <= 25) return candidates;

  // Large list → scraped page with nav/sidebar junk mixed in.
  // Find the longest contiguous block of lines that parse as valid ingredients.
  const parsed = candidates.map(line => ({ line, ok: parseIngredientLine(line) !== null }));

  let bestStart = 0, bestLen = 0, runStart = 0, runLen = 0;
  for (let i = 0; i <= parsed.length; i++) {
    if (i < parsed.length && parsed[i].ok) {
      if (runLen === 0) runStart = i;
      runLen++;
    } else {
      if (runLen > bestLen) { bestLen = runLen; bestStart = runStart; }
      runLen = 0;
    }
  }

  const best = candidates.slice(bestStart, bestStart + bestLen);
  // Fall back to full list if no valid block found (shouldn't happen in practice).
  return best.length >= 2 ? best : candidates;
}

/**
 * Attempt to extract recipe data from embedded JSON-LD (schema.org/Recipe).
 * Returns { items, title, servings } or null if no recipeIngredient found.
 */
function tryExtractJsonLd(text) {
  const ingMatch = text.match(/"recipeIngredient"\s*:\s*\[([^\]]+)\]/s);
  if (!ingMatch) return null;

  const items = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(ingMatch[1])) !== null) {
    const item = m[1]
      .replace(/\\n/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();
    if (item.length > 2) items.push(item);
  }
  if (items.length === 0) return null;

  let title = '';
  let servings = 0;

  // Title: last "name" before "recipeIngredient" that isn't a URL or author "@" handle.
  const ingPos = text.indexOf('"recipeIngredient"');
  if (ingPos > 0) {
    const context = text.slice(0, ingPos);
    const nameMatches = [...context.matchAll(/"name"\s*:\s*"([^"]+)"/g)];
    const candidate = nameMatches.reverse().find(
      n => !n[1].includes('://') && !n[1].includes('@') && n[1].length < 120
    );
    if (candidate) title = candidate[1];
  }

  // Servings from recipeYield
  const yieldMatch = text.match(/"recipeYield"\s*:\s*\[?"(\d+)"/);
  if (yieldMatch) servings = Number(yieldMatch[1]);

  return { items, title, servings };
}

/**
 * Split a multi-line recipe text into a structured result.
 * @param {string} text - Raw recipe text (may include title, servings, method).
 * @returns {{ title: string, servings: number, ingredients: Array }}
 */
export function parseRecipeText(text) {
  const raw = String(text)
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#32;/g, ' ')
    // Decode all remaining numeric HTML entities
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

  // Try JSON-LD extraction first — most reliable for schema.org-annotated pages.
  const jsonLd = tryExtractJsonLd(raw);
  if (jsonLd) {
    const ingredients = jsonLd.items.map(l => parseIngredientLine(l)).filter(Boolean);
    return { title: jsonLd.title.trim(), servings: jsonLd.servings, ingredients };
  }

  const allLines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  let title = '';
  let servings = 0;
  let titleFound = false;
  const candidateLines = [];

  for (const line of allLines) {
    if (STOP_RE.test(line)) break;

    // Detect servings: "Serves 12", "Makes 24", "Yields 6", "Original recipe (1X) yields 10 servings"
    const servMatch = line.match(/(?:serves?|makes?|yields?)\s+(\d+)/i);
    if (servMatch) { servings = Number(servMatch[1]); continue; }

    // Skip bare "ingredients" heading
    if (/^ingredients?:?$/i.test(line)) continue;

    // Title candidate: first short non-numeric line before any ingredient lines appear.
    if (!titleFound && line.length < 80 && !SKIP_LINE_RE.test(line)) {
      if (!/^\d/.test(expandUnicodeFracs(line))) {
        title = line.replace(/^Title:\s+/i, '').trim();
        titleFound = true;
        continue;
      }
    }

    candidateLines.push(line);
    // Once real ingredient-looking lines start, stop title detection.
    // SKIP_LINE_RE lines (form noise, scale buttons) don't count as ingredient start.
    if (!titleFound && !SKIP_LINE_RE.test(line)) titleFound = true;
  }

  const ingredientLines = findIngredients(candidateLines);
  const ingredients = ingredientLines.map(l => parseIngredientLine(l)).filter(Boolean);

  return { title: title.trim(), servings, ingredients };
}
