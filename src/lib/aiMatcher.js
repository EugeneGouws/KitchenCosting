// ─── AI PROMPT ─────────────────────────────────────────────────────────────────
// Edit this prompt to tune AI behaviour for ingredient parsing.
// Used by Gemini Nano (Chrome) or Ollama (local) to normalise ingredient names.
const PROMPT = (rawLine) =>
  `You are a recipe parsing assistant. Rewrite the following ingredient line \
using standard English names and common baking units (g, ml, cup, tsp, tbsp, kg, l). \
Return ONLY the reformatted ingredient line — no explanation, no punctuation. \
Don't halucinate numbers or units. keep to the origional units


Ingredient: ${rawLine}`;

// Prompt used by AIFillIngredient — fills pantry metadata for a new ingredient.
const FILL_PROMPT = (name) =>
  `You are a baking ingredient database assistant. Given the ingredient name below, return metadata for a South African home baker's pantry.

Rules:
- BASE_UNIT must be exactly one of: g  ml  each
  Use g for dry ingredients (flour, sugar, butter, cocoa, etc.)
  Use ml for liquids (milk, oil, water, vanilla, etc.)
  Use each for countable items (eggs, apples, bananas, etc.)
- ALIASES: comma-separated common alternative names (lowercase). Include abbreviations and Afrikaans names where relevant.
- CONVERSIONS: volume-to-mass conversions as key:value pairs (e.g. cup:120, tbsp:8, tsp:2.5). Only include if the ingredient is measured by volume in recipes. Use "none" if not applicable.

Return EXACTLY three lines, no extra text:
BASE_UNIT: <g|ml|each>
ALIASES: <comma-separated names>
CONVERSIONS: <key:value pairs or none>

Ingredient: ${name}`;

// Meta-suggestion prompt: pick a collection (prefer existing) and a servings count.
// Returns strict 2-line format so we can parse without an LLM JSON gamble.
const META_PROMPT = (title, ingredientLines, knownCollections) =>
  `You are a baking recipe classifier. Given a recipe, return:
1. A collection name (one or two words, e.g. "Cakes", "Cupcakes", "Pies", "Breads", "Cookies", "Tarts", "Frostings"). \
${knownCollections.length > 0 ? `Prefer one of these existing collections if it fits: ${knownCollections.join(', ')}.` : ''}
2. The number of servings the recipe makes (a single integer). If unclear, give your best estimate based on ingredient quantities.

Return EXACTLY two lines, no extra text:
COLLECTION: <name>
SERVINGS: <integer>

Recipe title: ${title || '(untitled)'}
Ingredients:
${ingredientLines.join('\n')}`;
// ────────────────────────────────────────────────────────────────────────────────

// src/lib/aiMatcher.js
// AI-assisted ingredient matching — second pass for !confident ingredients only.
// Called after importRecipe(). Promotes unconfident ingredients to confident where possible.

import { resolveIngredientLine } from './importer.js';

// Master kill switch. The local Ollama backend is shelved (connection refused), and
// probing it logs an unsuppressable ERR_CONNECTION_REFUSED on every mount and every
// "AI Check" click — the browser emits that before our try/catch can run.
// Flip to true to re-enable both backends; every public function already handles a
// null backend, so nothing else needs to change.
const AI_ENABLED = false;

const OLLAMA_URL        = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL      = 'qwen2.5:1.5b';
const AI_TIMEOUT_MS     = 20000; // per-prompt timeout (ms) — cold first prompt may need extra time
const WARMUP_TIMEOUT_MS = 45000; // warmup timeout (ms) — first model load can be slow

// ─── WARMUP CONTEXT ────────────────────────────────────────────────────────────
// Sent once on first AI use to prime Gemini Nano with task context.
const WARMUP_PROMPT = `You are a recipe ingredient parser. Your task is to normalize and standardize ingredient lines from recipes.

Rules:
- Convert ingredient lines to standard format: [quantity] [unit] [ingredient name]
- Standardize units to: g, kg, ml, l, cup, tbsp, tsp, each (no abbreviations)
- Convert word numbers (one, two, half, quarter) to numerals and decimals
- Normalize ingredient names to common baking terms (e.g., "SR flour" → "self-rising flour")
- Return ONLY the normalized line, no explanation or punctuation

Examples:
- Input: "1 cup flour" → Output: "250ml flour"
- Input: "one and a half tsp baking powder" → Output: "7.5ml baking powder"
- Input: "2 x 500g butter" → Output: "1000g butter"
- Input: "3 eggs" → Output: "3 each eggs"
- Input: "200gm SR flour" → Output: "200g self-rising flour"`;

let aiWarmupDone    = false;
let warmupPromise   = null; // singleton — prevents concurrent warmup calls

// ─── INTERNAL HELPER ───────────────────────────────────────────────────────────
// Returns the LanguageModel API object from whichever Chrome namespace is active.
// Chrome 129+: window.LanguageModel (top-level)
// Chrome <129:  window.ai.languageModel (old API, being phased out)
function getLangModelAPI() {
  if (typeof window !== 'undefined' && window.LanguageModel) return window.LanguageModel;
  const aiObj = window?.ai ?? self?.ai ?? null;
  return aiObj?.languageModel ?? null;
}

/**
 * Detects which AI backend is available.
 * Strongly prefers Gemini Nano (Chrome native) over local Ollama.
 * @returns {Promise<'gemini-nano'|'ollama'|null>}
 */
export async function detectAIBackend() {
  if (!AI_ENABLED) return null;

  console.log('[AI] ═══ Backend detection start ═══');
  console.log('[AI] window.LanguageModel:', window?.LanguageModel ?? 'undefined');
  console.log('[AI] window.ai:', window?.ai ?? 'undefined');

  // Gemini Nano — Chrome built-in Prompt API.
  // Requires: chrome://flags/#prompt-api-for-gemini-nano → Enabled
  // AND:      chrome://flags/#optimization-guide-on-device-model → Enabled BypassPerfRequirement
  // AND:      chrome://components → "Optimization Guide On Device Model" → Check for update

  // Try new API: window.LanguageModel (Chrome 129+)
  if (typeof window !== 'undefined' && window.LanguageModel) {
    try {
      const available = await window.LanguageModel.availability();
      console.log('[AI] window.LanguageModel.availability():', available);
      if (available === 'readily' || available === 'available' ||
          available === 'after-download' || available === 'downloadable') {
        console.log('[AI] ✓✓ Using Gemini Nano (window.LanguageModel)');
        return 'gemini-nano';
      }
      console.log('[AI] ✗ LanguageModel not available:', available);
    } catch (err) {
      console.log('[AI] ✗ window.LanguageModel.availability() failed:', err.message);
    }
  }

  // Try old API: window.ai.languageModel (Chrome <129, being phased out)
  const aiObj = window?.ai ?? self?.ai ?? null;
  if (aiObj?.languageModel) {
    try {
      const cap = await aiObj.languageModel.capabilities();
      console.log('[AI] window.ai.languageModel capabilities:', cap);
      if (cap.available === 'readily' || cap.available === 'after-download') {
        console.log('[AI] ✓✓ Using Gemini Nano (window.ai.languageModel)');
        return 'gemini-nano';
      }
      console.log('[AI] ✗ window.ai.languageModel not available:', cap.available);
    } catch (err) {
      console.log('[AI] ✗ window.ai.languageModel capabilities() failed:', err.message);
    }
  }

  if (!window?.LanguageModel && !aiObj?.languageModel) {
    console.warn('%c[AI] Gemini Nano not found — steps to enable:', 'color:#e74c3c;font-weight:bold');
    console.warn('[AI]  STEP 1 → chrome://flags/#prompt-api-for-gemini-nano  →  Enabled');
    console.warn('[AI]  STEP 2 → chrome://flags/#optimization-guide-on-device-model  →  Enabled BypassPerfRequirement');
    console.warn('[AI]  STEP 3 → Click the blue RELAUNCH button');
    console.warn('[AI]  STEP 4 → chrome://components → "Optimization Guide On Device Model" → Check for update (~1.7 GB)');
    console.warn('[AI]  STEP 5 → Hard-refresh this page (Ctrl+Shift+R)');
  }

  // Ollama local server — fallback only
  console.log('[AI] Checking Ollama (localhost:11434)…');
  try {
    const signal = AbortSignal.timeout(1000);
    const res = await fetch('http://localhost:11434/api/tags', { signal });
    if (res.ok) {
      console.log('[AI] ✓✓ Using Ollama (local)');
      return 'ollama';
    }
    console.log('[AI] ✗ Ollama returned:', res.status);
  } catch (err) {
    console.log('[AI] ✗ Ollama not available:', err.message);
  }

  console.log('[AI] ═══ No AI backend available ═══');
  return null;
}

/**
 * Sends context/warmup prompt to Gemini Nano once per session.
 * Singleton — if called concurrently (e.g. from Promise.all), all callers await the same promise.
 * @param {'gemini-nano'|'ollama'} backend
 * @returns {Promise<void>}
 */
async function warmupAI(backend) {
  if (aiWarmupDone) return;
  if (backend !== 'gemini-nano') return;

  // Return the in-progress warmup if already running (prevents duplicate concurrent warmups)
  if (warmupPromise) {
    console.log('[AI] Warmup already in progress — awaiting…');
    return warmupPromise;
  }

  warmupPromise = (async () => {
    try {
      console.log('%c[AI] 🔥 WARMUP: Priming Gemini Nano…', 'color: #f39c12; font-weight: bold');
      console.log('[AI] WARMUP prompt sent:\n', WARMUP_PROMPT);
      const langModel = getLangModelAPI();
      const session = await langModel.create();
      let warmupResponse;
      await Promise.race([
        session.prompt(WARMUP_PROMPT).then(r => { warmupResponse = r }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), WARMUP_TIMEOUT_MS)),
      ]);
      session.destroy();
      aiWarmupDone = true;
      console.log('%c[AI] 🔥 WARMUP: Complete!', 'color: #27ae60; font-weight: bold');
      console.log('[AI] WARMUP response received:\n', warmupResponse?.trim() ?? '(empty)');
    } catch (err) {
      console.warn('%c[AI] 🔥 WARMUP: Failed, but continuing…', 'color: #e74c3c', err.message);
      aiWarmupDone = true; // don't retry even if failed
    }
  })();

  return warmupPromise;
}

/**
 * Run backend detection and warmup on app startup.
 * Detects which AI backend is available and primes Gemini Nano so it's ready when the user clicks AI Check.
 * Call once from App.jsx on mount.
 */
export async function initAI() {
  const backend = await detectAIBackend();
  console.log(`[AI] Startup check complete. Backend: ${backend ?? 'none'}`);
  if (backend === 'gemini-nano') {
    warmupAI(backend); // fire-and-forget — don't block app startup
  }
  return backend;
}

/**
 * Sends a raw ingredient line to the active AI backend for normalisation.
 * Returns the original line unchanged if AI is unavailable or fails.
 * @param {string} rawLine
 * @param {'gemini-nano'|'ollama'} backend
 * @returns {Promise<string>}
 */
async function promptIngredient(rawLine, backend) {
  // Ensure warmup is complete before sending ingredient prompts.
  // warmupAI() is a singleton — concurrent calls all await the same promise.
  if (backend === 'gemini-nano' && !aiWarmupDone) {
    await warmupAI(backend);
  }
  const promptText = PROMPT(rawLine);

  try {
    if (backend === 'gemini-nano') {
      console.log(`[AI] Gemini Nano — prompt: "${rawLine}"`);
      const langModel = getLangModelAPI();
      const session = await langModel.create();
      const result = await Promise.race([
        session.prompt(promptText),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), AI_TIMEOUT_MS)),
      ]);
      session.destroy();
      const trimmed = result.trim();
      console.log(`[AI] Gemini Nano — response: "${trimmed}"`);
      return trimmed;
    }

    if (backend === 'ollama') {
      console.log(`[AI] Ollama — prompt: "${rawLine}"`);
      const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt: promptText, stream: false }),
        signal,
      });
      const json = await res.json();
      const response = json.response.trim();
      console.log(`[AI] Ollama — response: "${response}"`);
      return response;
    }
  } catch (err) {
    console.error(`[AI] ${backend} failed:`, err.message);
  }

  console.log(`[AI] No backend available or failed — returning original: "${rawLine}"`);
  return rawLine;
}

/**
 * AI second pass — upgrades unconfident ingredients using AI normalisation.
 * Only ingredients with confident === false are sent to AI.
 * Fires all prompts concurrently (Promise.all).
 *
 * Outcomes per ingredient:
 *   aiResolved: true  — AI produced a confident match; ingredient updated
 *   needsManual: true — AI tried and failed; UI must ask the user to correct it
 *
 * @param {Object} recipe — output of importRecipe()
 * @param {Array}  pantry — PantryItem[]
 * @returns {Promise<Object>} recipe with ingredients updated in-place by index
 */
export async function AIMatchIngredient(recipe, pantry) {
  // Track unconfident ingredients with their original array indices
  const unconfidentWithIdx = recipe.ingredients
    .map((ing, i) => ({ ing, i }))
    .filter(({ ing }) => !ing.confident);

  if (unconfidentWithIdx.length === 0) return recipe;

  const backend = await detectAIBackend();
  if (!backend) return recipe;

  const resolved = await Promise.all(
    unconfidentWithIdx.map(async ({ ing, i }) => {
      const aiText = await promptIngredient(ing.raw, backend);
      const result = resolveIngredientLine(aiText, pantry);

      if (!result || !result.confident) {
        // AI could not produce a confident match — flag for manual correction
        return { i, updated: { ...ing, needsManual: true } };
      }

      const pantryIdx = pantry.findIndex(e => e.id === result.matchedIngredient);
      return {
        i,
        updated: {
          ...ing,                              // preserve raw and original name/amount/unit
          id: pantryIdx,
          matchedIngredient: result.matchedIngredient,
          confident: true,
          candidates: [],
          convertedUnit: result.convertedUnit,
          convertedAmount: result.convertedAmount,
          aiResolved: true,
        },
      };
    })
  );

  // Merge back by original array index — safe even when multiple unmatched ingredients share the same name
  const mergedIngredients = [...recipe.ingredients];
  resolved.forEach(({ i, updated }) => { mergedIngredients[i] = updated; });

  return { ...recipe, ingredients: mergedIngredients };
}

/**
 * Asks the AI to suggest pantry metadata for a new ingredient (AddIngredientModal AI Check).
 * Returns baseUnit, aliases (comma string), conversions (comma string) for the modal fields.
 *
 * @param {string} name — ingredient canonical name as typed by user
 * @returns {Promise<{ baseUnit: string, aliases: string, conversions: string }>}
 */
export async function AIFillIngredient(name) {
  const empty = { baseUnit: '', aliases: '', conversions: '' };
  if (!name?.trim()) return empty;

  const backend = await detectAIBackend();
  if (!backend) return empty;

  if (backend === 'gemini-nano' && !aiWarmupDone) {
    await warmupAI(backend);
  }

  const promptText = FILL_PROMPT(name.trim());
  let raw;

  try {
    if (backend === 'gemini-nano') {
      console.log(`[AI] AIFillIngredient — prompt for: "${name}"`);
      const langModel = getLangModelAPI();
      const session = await langModel.create();
      raw = await Promise.race([
        session.prompt(promptText),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), AI_TIMEOUT_MS)),
      ]);
      session.destroy();
    } else if (backend === 'ollama') {
      console.log(`[AI] AIFillIngredient (Ollama) — prompt for: "${name}"`);
      const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt: promptText, stream: false }),
        signal,
      });
      const json = await res.json();
      raw = json.response;
    }
  } catch (err) {
    console.error('[AI] AIFillIngredient failed:', err.message);
    return empty;
  }

  const text = (raw || '').trim();
  console.log('[AI] AIFillIngredient — response:', text);

  const unitMatch  = text.match(/BASE_UNIT:\s*(g|ml|each)/i);
  const aliasMatch = text.match(/ALIASES:\s*(.+?)(?:\n|$)/i);
  const convMatch  = text.match(/CONVERSIONS:\s*(.+?)(?:\n|$)/i);

  const baseUnit   = unitMatch?.[1]?.toLowerCase().trim() ?? '';
  const aliases    = aliasMatch?.[1]?.trim() ?? '';
  const rawConv    = convMatch?.[1]?.trim() ?? '';
  const conversions = rawConv.toLowerCase() === 'none' ? '' : rawConv;

  return { baseUnit, aliases, conversions };
}

/**
 * Asks the AI to suggest a collection name and servings count for a recipe.
 * Non-blocking — caller decides whether to apply (e.g. only fill empty fields).
 *
 * @param {Object} recipe — { title, ingredients: [{ raw, name, amount, unit }] }
 * @param {string[]} knownCollections — existing collection names; AI prefers reusing one
 * @returns {Promise<{ collection: string|null, servings: number|null }>}
 */
export async function AISuggestRecipeMeta(recipe, knownCollections = []) {
  const backend = await detectAIBackend();
  if (!backend) return { collection: null, servings: null };

  if (backend === 'gemini-nano' && !aiWarmupDone) {
    await warmupAI(backend);
  }

  const ingredientLines = (recipe?.ingredients ?? [])
    .map(ing => ing.raw || `${ing.amount ?? ''} ${ing.unit ?? ''} ${ing.name ?? ''}`.trim())
    .filter(Boolean);

  const promptText = META_PROMPT(recipe?.title ?? '', ingredientLines, knownCollections);

  let raw;
  try {
    if (backend === 'gemini-nano') {
      console.log('[AI] Meta — requesting collection + servings');
      const langModel = getLangModelAPI();
      const session = await langModel.create();
      raw = await Promise.race([
        session.prompt(promptText),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), AI_TIMEOUT_MS)),
      ]);
      session.destroy();
    } else if (backend === 'ollama') {
      console.log('[AI] Meta — requesting collection + servings (Ollama)');
      const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt: promptText, stream: false }),
        signal,
      });
      const json = await res.json();
      raw = json.response;
    }
  } catch (err) {
    console.error('[AI] Meta suggestion failed:', err.message);
    return { collection: null, servings: null };
  }

  const text = (raw || '').trim();
  console.log('[AI] Meta — response:', text);

  const collMatch = text.match(/COLLECTION:\s*(.+?)\s*$/im);
  const servMatch = text.match(/SERVINGS:\s*(\d+)/i);

  let collection = collMatch?.[1]?.trim() || null;
  const servings = servMatch ? parseInt(servMatch[1], 10) : null;

  // If AI's suggested collection matches an existing one (case-insensitive), reuse the existing capitalization
  if (collection && knownCollections.length > 0) {
    const existing = knownCollections.find(c => c.toLowerCase() === collection.toLowerCase());
    if (existing) collection = existing;
  }

  return { collection, servings: Number.isFinite(servings) && servings > 0 ? servings : null };
}
