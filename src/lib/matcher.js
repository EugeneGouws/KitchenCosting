// src/lib/matcher.js
// Two-phase fuzzy matcher: resolves parsed ingredient names to pantry entries.

// --- Helpers ---

function trigrams(str) {
  const s = ` ${str.toLowerCase()} `;
  const result = new Set();
  for (let i = 0; i < s.length - 2; i++) {
    result.add(s.slice(i, i + 3));
  }
  return result;
}

function jaccardSim(a, b) {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Every string an entry can be matched on: its canonical name plus its aliases.
// canonicalName is included because 138 seed entries carry only a single alias —
// without it their match surface is one string.
function matchTargets(entry) {
  return [entry.canonicalName, ...(entry.aliases ?? [])].filter(Boolean);
}

function bestAliasScore(query, targets) {
  let best = 0;
  for (const target of targets) {
    const s = jaccardSim(query, target);
    if (s > best) best = s;
  }
  return best;
}

function unitFamily(unit) {
  if (['g', 'kg'].includes(unit)) return 'mass';
  if (['ml', 'l', 'cup', 'tbsp', 'tsp'].includes(unit)) return 'volume';
  if (['each', 'piece'].includes(unit)) return 'count';
  return 'other';
}

/**
 * Break a tie between candidates sharing the top score.
 * Ranks on inUse, then an explicit conversion for the requested unit, then unit-family
 * agreement, then the shorter canonicalName. Returns the winner with `decisive: true`
 * when it outranks the rest — a tie that no rule separates stays indecisive so the
 * caller falls back to the manual picker.
 */
function pickFromTie(tied, unit) {
  const rank = ({ entry }) =>
    (entry.inUse ? 8 : 0) +
    (entry.conversions?.[unit] !== undefined ? 4 : 0) +
    (unitFamily(unit) === unitFamily(entry.baseUnit) ? 2 : 0);

  const scored = tied
    .map(c => ({ ...c, rank: rank(c) }))
    .sort((a, b) =>
      b.rank - a.rank || a.entry.canonicalName.length - b.entry.canonicalName.length);

  const [best, next] = scored;
  return { ...best, decisive: best.rank > next.rank };
}

// --- Exports ---

/**
 * findCandidates(name, pantry) → [{ entry, score }]
 *
 * Phase 1: exact alias match → score 1.0
 * Phase 2: Jaccard trigram similarity for all remaining entries
 * Returns up to 5 candidates sorted by score descending.
 */
export function findCandidates(name, pantry) {
  const query = name.toLowerCase().trim();
  const exactIds = new Set();
  const results = [];

  // Phase 1 — exact match on canonicalName or any alias
  for (const entry of pantry) {
    if (matchTargets(entry).some(t => t.toLowerCase() === query)) {
      results.push({ entry, score: 1.0 });
      exactIds.add(entry.id);
    }
  }

  // Phase 2 — fuzzy for entries not already scored 1.0
  for (const entry of pantry) {
    if (exactIds.has(entry.id)) continue;
    const score = bestAliasScore(query, matchTargets(entry));
    if (score > 0) results.push({ entry, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 5);
}

/**
 * matchIngredient(name, unit, pantry) → { match, confident, candidates }
 *
 * match      — best PantryItem, or null if no plausible match (all scores < 0.2)
 * confident  — true = unambiguous, UI can auto-assign
 * candidates — empty when confident; top-5 list when not confident (for picker UI)
 */
export function matchIngredient(name, unit, pantry) {
  const candidates = findCandidates(name, pantry);

  if (candidates.length === 0 || candidates[0].score < 0.2) {
    return { match: null, confident: false, candidates: [] };
  }

  // Ties at the top score produce gap === 0, which would block confidence outright.
  // Resolve them on merit instead: an entry the seed recipes actually use, then one
  // that can convert the requested unit, then the more specific (shorter) name.
  const topScore = candidates[0].score;
  const tied = candidates.filter(c => c.score === topScore);
  const top = tied.length > 1 ? pickFromTie(tied, unit) : candidates[0];

  const runnerUp = candidates.find(c => c.score < topScore)?.score ?? 0;
  const gap = tied.length > 1 && top.decisive
    ? topScore - runnerUp          // tie broken decisively — score against the next distinct score
    : topScore - (candidates[1]?.score ?? 0);

  // Confidence is about dominance, not absolute score. Trigram Jaccard drops sharply
  // when a recipe adds a qualifier the alias lacks ("pure vanilla extract" → 0.75,
  // "golden caster sugar" → 0.63), yet the runner-up is far behind. Requiring 0.85
  // alone rejected those: on queries with one modifier word prepended, it went
  // confident 4 times out of 455. A clear winner is trusted on the margin instead.
  let confident = (topScore >= 0.85 && gap > 0.15)
               || (topScore >= 0.5  && gap >= 0.25);

  // Unit family penalty: cross-family mismatch breaks confidence,
  // unless the pantry entry has an explicit conversion for this unit (e.g. cup of flour → g).
  if (confident && unitFamily(unit) !== 'other') {
    const hasConversion = top.entry.conversions?.[unit] !== undefined;
    if (!hasConversion && unitFamily(unit) !== unitFamily(top.entry.baseUnit)) {
      confident = false;
    }
  }

  if (confident) {
    return { match: top.entry, confident: true, needsConfirm: false, candidates: [] };
  }

  // Mid-confidence band: show best guess inline for user confirmation
  const needsConfirm = top.score >= 0.5;
  return { match: top.entry, confident: false, needsConfirm, candidates };
}
