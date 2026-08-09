#!/usr/bin/env node
// scripts/fetch-new-prices.js
//
// Local CLI, run by Eugene. Produces the input that scripts/push-prices.js consumes —
// the one missing link in the price pipeline. Fetches Checkers candidates via the
// Cloudflare Worker (Apify), scores them with the same code the UI uses, and writes the
// confident ones to scripts/new-prices.json.
//
// Writes nothing to pantry.json. Review, then run push-prices.js.
//
// Usage:
//   node scripts/fetch-new-prices.js              core set (inUse) that is stale
//   node scripts/fetch-new-prices.js --all        every eligible item — full sweep
//   node scripts/fetch-new-prices.js --limit 5    cap the run (cost check)
//   node scripts/fetch-new-prices.js --ids a,b    specific ids, ignores staleness
//   node scripts/fetch-new-prices.js --resume     skip ids already in new-prices.json
//
// Each item is one Apify actor run. At 4096MB/20s that is roughly $0.006 a run.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fetchPriceOptions, convertToBaseUnits } from '../src/lib/pricer.js'
import { deriveConversions } from '../src/lib/units.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PANTRY_PATH = path.join(ROOT, 'src/data/pantry.json')
const OUT_PATH = path.join(ROOT, 'scripts/new-prices.json')
const REVIEW_PATH = path.join(ROOT, 'scripts/new-prices-review.md')

const STALE_DAYS = 7
const BATCH_SIZE = 40
const DELAY_MS = 400

// scoreCandidate() in pricer.js weights nameSim at 0.50 and gives 0.5 brandScore when the
// pantry item carries no brand hint, so a no-brand item tops out at nameSim*0.5 + 0.425.
// Real product names always add a brand and a pack size the ingredient name lacks, which
// holds Jaccard nameSim around 0.5-0.7 — so 0.85 was unreachable and rejected everything,
// including "Huletts Castor Sugar 500g" for castor-sugar at 0.61.
// Observed correct matches land 0.50-0.70; what actually separates right from wrong is the
// margin over the next *different* product, not the absolute number.
const MATCH_SCORE_THRESHOLD = 0.5
const MIN_GAP = 0.08
// Scores within this of the top are treated as a tie and resolved on pack size.
const TIE_BAND = 0.02
// Below this, two tied names are different products and a human should choose.
const SAME_PRODUCT_SIM = 0.6

function arg(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : process.argv[i + 1]
}
const hasFlag = name => process.argv.includes(name)

function isStale(dateStr) {
  if (!dateStr) return true
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - STALE_DAYS)
  return new Date(dateStr) < cutoff
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

const productName = o => o.product?.name ?? o.product?.title ?? ''

// Product name with brandless size/packaging noise removed, for comparing two candidates
// against each other rather than against the ingredient.
function nameTokens(str) {
  return new Set(
    String(str).toLowerCase()
      .replace(/\d+(\.\d+)?\s*(kg|g|ml|l|s)\b/g, ' ')
      .replace(/[^a-z ]/g, ' ')
      .split(/\s+/).filter(Boolean)
  )
}

function tokenSim(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b)
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const t of ta) if (tb.has(t)) hit++
  return hit / (ta.size + tb.size - hit)
}

/**
 * Pick the candidate to accept, and say whether it is safe to accept without review.
 *
 * Candidates within TIE_BAND of the top score are treated as tied. If they are the same
 * product in different pack sizes ("Snowflake Cake Wheat Flour" 1kg vs 5kg) the one
 * nearest the pack size the pantry already records wins. If they are genuinely different
 * products (Maizena corn flour vs ButtaNutt oat flour, both 0.67 for gluten-free-flour)
 * no pack-size rule can help and a human should choose.
 */
function chooseCandidate(item, options) {
  const top = options[0]
  const tied = options.filter(o => top.score - o.score <= TIE_BAND)

  if (tied.length > 1) {
    const sim = tokenSim(productName(tied[0]), productName(tied[1]))
    if (sim < SAME_PRODUCT_SIM) {
      return { pick: top, reason: `ambiguous — ${tied.length} products tied at ~${top.score.toFixed(2)}`, ok: false }
    }
    const current = convertToBaseUnits(item.packageValue, item.packageUnit).baseQuantity
    if (current) {
      const dist = o => {
        const q = convertToBaseUnits(o.packageValue, o.packageUnit).baseQuantity
        return q == null ? Infinity : Math.abs(q - current)
      }
      tied.sort((a, b) => dist(a) - dist(b))
    }
  }

  const pick = tied[0]
  if (pick.score < MATCH_SCORE_THRESHOLD) {
    return { pick, reason: `top score ${pick.score.toFixed(2)} < ${MATCH_SCORE_THRESHOLD}`, ok: false }
  }

  // Margin measured against the best candidate that is a different product
  const rival = options.find(o => tokenSim(productName(pick), productName(o)) < SAME_PRODUCT_SIM)
  const gap = rival ? pick.score - rival.score : pick.score
  if (gap < MIN_GAP) {
    return { pick, reason: `margin ${gap.toFixed(2)} over "${productName(rival)}" < ${MIN_GAP}`, ok: false }
  }

  return { pick, reason: null, ok: true }
}

function selectCandidates(pantry) {
  const idsArg = arg('--ids')
  if (idsArg) {
    const wanted = new Set(idsArg.split(',').map(s => s.trim()).filter(Boolean))
    const found = pantry.filter(i => wanted.has(i.id))
    const unknown = [...wanted].filter(id => !found.some(i => i.id === id))
    if (unknown.length) {
      console.error(`Unknown pantry id(s): ${unknown.join(', ')}`)
      process.exit(1)
    }
    return found
  }

  let list = pantry
    // Checkers does not stock these — never pay to miss them again
    .filter(i => !i.skipAutoPrice)
    // never clobber a price the user set by hand
    .filter(i => i.priceSource !== 'user')

  if (!hasFlag('--all')) {
    list = list.filter(i => i.inUse && isStale(i.dateLastUpdated))
  }

  // oldest first, so a capped run always moves the stalest prices
  list.sort((a, b) => (a.dateLastUpdated ?? '').localeCompare(b.dateLastUpdated ?? ''))

  const limit = arg('--limit')
  if (limit) return list.slice(0, Number(limit))
  return hasFlag('--all') ? list : list.slice(0, BATCH_SIZE)
}

async function main() {
  const pantry = JSON.parse(readFileSync(PANTRY_PATH, 'utf8'))
    // pricer.js scores against conversions, which are derived at read time in the app
    .map(i => ({ ...i, conversions: deriveConversions(i) }))

  let candidates = selectCandidates(pantry)

  // Resume a sweep that died partway without repaying for what already succeeded
  const accepted = []
  if (hasFlag('--resume') && existsSync(OUT_PATH)) {
    const prior = JSON.parse(readFileSync(OUT_PATH, 'utf8'))
    accepted.push(...prior)
    const done = new Set(prior.map(e => e.id))
    const before = candidates.length
    candidates = candidates.filter(i => !done.has(i.id))
    console.log(`Resuming — ${prior.length} already fetched, ${before - candidates.length} skipped.\n`)
  }

  if (candidates.length === 0) {
    console.log('Nothing to fetch. All eligible items are fresh.')
    return
  }

  console.log(`Fetching ${candidates.length} item(s) — roughly $${(candidates.length * 0.006).toFixed(2)} of Apify credit.\n`)

  const rejected = []
  const noResults = []

  for (const [n, item] of candidates.entries()) {
    const label = `[${n + 1}/${candidates.length}] ${item.id}`
    let options
    try {
      options = await fetchPriceOptions(item)
    } catch (err) {
      console.error(`${label} — FETCH FAILED: ${err.message}`)
      rejected.push({ item, reason: `fetch failed: ${err.message}`, options: [] })
      await sleep(DELAY_MS)
      continue
    }

    if (!options.length) {
      console.log(`${label} — no results`)
      noResults.push(item)
      await sleep(DELAY_MS)
      continue
    }

    const { pick, reason, ok } = chooseCandidate(item, options)
    const price = parseFloat(String(pick.product?.price ?? '').replace(/[^0-9.]/g, ''))
    const name = productName(pick)

    if (!ok) {
      console.log(`${label} — ${reason}`)
      rejected.push({ item, reason, options })
    } else if (pick.costPerUnit == null) {
      console.log(`${label} — unit mismatch (${pick.packageValue}${pick.packageUnit} vs baseUnit ${item.baseUnit})`)
      rejected.push({ item, reason: `package unit ${pick.packageUnit} does not convert into ${item.baseUnit}`, options })
    } else if (!Number.isFinite(price)) {
      console.log(`${label} — unparseable price ${JSON.stringify(pick.product?.price)}`)
      rejected.push({ item, reason: `unparseable price ${JSON.stringify(pick.product?.price)}`, options })
    } else {
      console.log(`${label} — R${price.toFixed(2)} ${pick.packageValue}${pick.packageUnit} (${pick.score.toFixed(2)}) ${name}`)
      accepted.push({
        id: item.id,
        packagePrice: price,
        packageValue: pick.packageValue,
        packageUnit: pick.packageUnit,
        matchedProduct: name,
      })
    }

    // Write incrementally so a long sweep is resumable
    writeFileSync(OUT_PATH, JSON.stringify(accepted, null, 2) + '\n')
    await sleep(DELAY_MS)
  }

  writeFileSync(OUT_PATH, JSON.stringify(accepted, null, 2) + '\n')
  writeReview(rejected, noResults)

  console.log(`\n✓ ${accepted.length} accepted → scripts/new-prices.json`)
  console.log(`  ${rejected.length} need review, ${noResults.length} returned nothing`)
  if (noResults.length) {
    console.log(`  Consider setting skipAutoPrice on the zero-result items — see the review file.`)
  }
  console.log('\nNext: node scripts/push-prices.js   (dry run)')
}

function writeReview(rejected, noResults) {
  const lines = [
    '# Price refresh — needs review',
    '',
    `Generated ${new Date().toISOString().split('T')[0]}.`,
    '',
    '## Rejected',
    '',
  ]

  if (!rejected.length) lines.push('_None._', '')
  for (const { item, reason, options } of rejected) {
    lines.push(`### ${item.id} — ${item.canonicalName}`)
    lines.push(`Current: R${item.packagePrice ?? '—'} / ${item.packageValue ?? '—'}${item.packageUnit ?? ''} · baseUnit \`${item.baseUnit}\``)
    lines.push(`Reason: ${reason}`)
    lines.push('')
    for (const o of options.slice(0, 3)) {
      const nm = o.product?.name ?? o.product?.title ?? ''
      lines.push(`- \`${o.score.toFixed(2)}\` ${nm} — ${o.product?.price ?? '?'} (${o.packageValue ?? '?'}${o.packageUnit ?? ''})`)
    }
    lines.push('')
  }

  lines.push('## Zero results — skipAutoPrice candidates', '')
  lines.push(noResults.length
    ? noResults.map(i => `- \`${i.id}\` — ${i.canonicalName}`).join('\n')
    : '_None._')
  lines.push('')

  writeFileSync(REVIEW_PATH, lines.join('\n'))
}

main()
