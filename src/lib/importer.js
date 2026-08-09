// src/lib/importer.js
// High-level recipe import: parse raw text → match ingredients → build recipe object.
// Also owns importFinished — the single write gateway that persists a confirmed recipe.

import { parseRecipeText, parseIngredientLine } from './parser.js';
import { matchIngredient } from './matcher.js';
import { readFileAsText } from './fileUploader.js';
import { savePantryItem } from '../io/pantryStore.js';
import { saveRecipe } from '../io/recipeStore.js';

/**
 * Determines the baseUnit family from a raw unit string.
 * Used when creating a user pantry item for an unmatched ingredient.
 * @param {string} unit
 * @returns {'g'|'ml'|'each'}
 */
function unitToBaseUnit(unit) {
  if (!unit) return 'each';
  const lower = unit.toLowerCase();
  if (['g', 'kg', 'oz', 'lb'].some(u => lower.includes(u))) return 'g';
  if (['ml', 'l', 'cup', 'tbsp', 'tsp'].some(u => lower.includes(u))) return 'ml';
  return 'each';
}

/**
 * Convert a parsed amount+unit to the pantry item's baseUnit using its conversions map.
 * Returns the original unit/amount unchanged if no conversion is available.
 */
export function convertAmount(amount, unit, pantryEntry) {
  if (!pantryEntry) return { convertedUnit: unit, convertedAmount: amount };

  const { baseUnit, conversions } = pantryEntry;

  if (unit === baseUnit) return { convertedUnit: baseUnit, convertedAmount: amount };

  if (conversions && conversions[unit] !== undefined) {
    return {
      convertedUnit: baseUnit,
      convertedAmount: amount * conversions[unit],
    };
  }

  return { convertedUnit: unit, convertedAmount: amount };
}

/**
 * reconvertIngredients(ingredients, pantry) → ingredients[]
 *
 * Re-runs convertAmount on ingredients that are already matched, using the
 * matchedIngredient the user or importer settled on. Never re-matches, so manual
 * ingredient choices are preserved. Idempotent — returns the same object when a
 * row is already correct.
 *
 * Repairs recipes stored with convertedAmount left in the recipe's own unit
 * (e.g. "3 cup carrots" saved as convertedAmount 3 instead of 3 × 128 = 384 g).
 *
 * @param {Array} ingredients — RecipeIngredient[]
 * @param {Array} pantry      — PantryItem[]
 * @returns {Array} RecipeIngredient[]
 */
export function reconvertIngredients(ingredients, pantry) {
  return (ingredients ?? []).map(ing => {
    if (!ing.matchedIngredient) return ing;
    const entry = pantry.find(p => p.id === ing.matchedIngredient);
    if (!entry) return ing;

    const { convertedUnit, convertedAmount } = convertAmount(ing.amount ?? 0, ing.unit ?? '', entry);
    if (convertedUnit === ing.convertedUnit && convertedAmount === ing.convertedAmount) return ing;
    return { ...ing, convertedUnit, convertedAmount };
  });
}

/**
 * resolveIngredients(ingredients, pantry) → ingredients[]
 *
 * Runs matching + conversion on any ingredient that hasn't been through the
 * import pipeline yet (identified by absent convertedAmount). Used to fix up
 * seed recipes whose ingredients only have name/amount/unit.
 *
 * @param {Array} ingredients — RecipeIngredient[] (may be partially resolved)
 * @param {Array} pantry      — PantryItem[]
 * @returns {Array} RecipeIngredient[] with matchedIngredient + convertedAmount set
 */
export function resolveIngredients(ingredients, pantry) {
  return ingredients.map(ing => {
    if (ing.convertedAmount !== undefined) return ing  // already resolved
    const name = ing.name ?? ing.raw ?? ''
    const { match, confident, needsConfirm, candidates } = matchIngredient(name, ing.unit ?? '', pantry)
    const { convertedUnit, convertedAmount } = convertAmount(ing.amount ?? 0, ing.unit ?? '', match)
    return {
      ...ing,
      matchedIngredient: match?.id ?? null,
      confident,
      needsConfirm: needsConfirm ?? false,
      candidates: candidates ?? [],
      convertedUnit,
      convertedAmount,
    }
  })
}

/**
 * resolveIngredientLine(rawLine, pantry) → resolved fields | null
 *
 * Runs a raw ingredient line through the full parse → match → convert pipeline.
 * Used by AIMatchIngredient (AI re-parse) and the UI (manual correction pass).
 * Returns null if the line cannot be parsed.
 *
 * @param {string} rawLine
 * @param {Array}  pantry — PantryItem[]
 * @returns {{ name, amount, unit, matchedIngredient, confident, candidates,
 *             convertedUnit, convertedAmount } | null}
 */
export function resolveIngredientLine(rawLine, pantry) {
  const parsed = parseIngredientLine(rawLine);
  if (!parsed) return null;

  const { name, amount, unit } = parsed;
  const { match, confident, candidates } = matchIngredient(name, unit, pantry);
  const { convertedUnit, convertedAmount } = convertAmount(amount, unit, match);

  return {
    name,
    amount,
    unit,
    matchedIngredient: match?.id ?? null,
    confident,
    candidates,
    convertedUnit,
    convertedAmount,
  };
}

/**
 * importRecipe(rawText, pantry) → recipe object
 *
 * Parses rawText, matches each ingredient against pantry, and returns a structured
 * recipe with title, servings, raw text, and a list of enriched ingredients.
 *
 * Each ingredient carries:
 *   id              — pantry array index (-1 if unmatched)
 *   name            — raw parsed name (lowercase)
 *   amount          — raw parsed amount
 *   unit            — raw parsed unit
 *   raw             — original unparsed line
 *   matchedIngredient — matched pantry entry id string, or null
 *   confident       — true = auto-assigned, false = needs user disambiguation
 *   candidates      — top match options when not confident (empty when confident)
 *   convertedUnit   — baseUnit of matched pantry item (or raw unit if unmatched)
 *   convertedAmount — amount in convertedUnit (or raw amount if unmatched)
 */
export function importRecipe(rawText, pantry) {
  const { title, servings, ingredients } = parseRecipeText(rawText);

  const enriched = ingredients.map(parsed => {
    const { name, amount, unit, raw } = parsed;
    const { match, confident, needsConfirm, candidates } = matchIngredient(name, unit, pantry);

    const pantryIndex = match ? pantry.findIndex(e => e.id === match.id) : -1;
    const { convertedUnit, convertedAmount } = convertAmount(amount, unit, match);

    return {
      id: pantryIndex,
      name,
      amount,
      unit,
      raw,
      matchedIngredient: match?.id ?? null,
      confident,
      needsConfirm: needsConfirm ?? false,
      candidates,
      convertedUnit,
      convertedAmount,
    };
  });

  const recipe = { title, servings, rawText, ingredients: enriched };
  logRecipe(recipe);
  return recipe;
}

function logRecipe(recipe) {
  console.log(`\n=== ${recipe.title || '(no title)'} — serves ${recipe.servings || '?'} ===`);
  for (const ing of recipe.ingredients) {
    if (ing.matchedIngredient) {
      const status = ing.confident ? '✓' : '?';
      console.log(`  ${status} ${ing.matchedIngredient}  ${ing.convertedAmount}${ing.convertedUnit}`);
    } else {
      console.log(`  ✗ [UNMATCHED] ${ing.name}  ${ing.amount}${ing.unit}`);
    }
  }
  console.log('');
}

/**
 * importFromFile(input, pantry) → Promise<recipe object>
 *
 * Accepts a File (docx/pdf/txt) or a raw text string, extracts the text,
 * then runs the full import pipeline.
 */
export async function importFromFile(input, pantry) {
  const rawText = await readFileAsText(input);
  return importRecipe(rawText, pantry);
}

/**
 * importFinished(recipe, opts?) → StoredRecipe[]
 *
 * Called by the UI when the user has signed off on a recipe import
 * (after deterministic matching, optional AI pass, and manual disambiguation).
 *
 * - Queues any still-unmatched ingredients into the user pantry.
 * - Wraps the recipe in a StoredRecipe and persists it via recipeStore.
 *
 * @param {Object} recipe — output of importRecipe / AIMatchIngredient
 * @param {Object} opts   — { collection?: string, favorite?: boolean }
 * @returns {Array} Updated StoredRecipe[]
 */
export function importFinished(recipe, opts = {}) {
  const { collection = '', favorite = false } = opts;

  // Queue still-unmatched ingredients for user pantry / community submission.
  recipe.ingredients.forEach((ing) => {
    if (!ing.matchedIngredient) {
      savePantryItem({
        name:         ing.name,
        baseUnit:     unitToBaseUnit(ing.unit),
        pkgValue:     ing.pkgValue,
        pkgUnit:      ing.pkgUnit,
        pkgPrice:     ing.pkgPrice,
        pkgMatch:     ing.pkgMatch,
        conversions:  ing.conversions,
        aliases:      ing.aliases,
      });
    }
  });

  return saveRecipe({
    id:          crypto.randomUUID(),
    title:       recipe.title,
    servings:    recipe.servings,
    rawText:     recipe.rawText,
    ingredients: recipe.ingredients,
    favorite,
    collection:  recipe.collection ?? collection,
    dateAdded:   new Date().toISOString().split('T')[0],
  });
}
