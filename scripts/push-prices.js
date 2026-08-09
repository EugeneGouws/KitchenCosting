#!/usr/bin/env node
// scripts/push-prices.js
//
// Local CLI, run by Eugene, not bundled with the app or Worker. Writes refreshed
// prices into src/data/pantry.json and bumps CURRENT_PANTRY_VERSION so existing
// users get the consent prompt (PricePushModal) on next load — see
// computeStagedPriceChanges() in src/io/pantryStore.js.
//
// Usage:
//   node scripts/push-prices.js            (dry run — prints a table, writes nothing)
//   node scripts/push-prices.js --confirm  (writes pantry.json + bumps the version)
//
// Input: scripts/new-prices.json — array of:
//   { "id": "cake-flour", "packagePrice": 31.99, "packageValue": 1000, "packageUnit": "g", "matchedProduct": "Snowflake Cake Flour 1kg" }

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { computeCostPerUnit } from '../src/lib/pricer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PANTRY_PATH = path.join(ROOT, 'src/data/pantry.json')
const PANTRY_STORE_PATH = path.join(ROOT, 'src/io/pantryStore.js')
const NEW_PRICES_PATH = path.join(ROOT, 'scripts/new-prices.json')

const LARGE_CHANGE_PCT = 20

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function main() {
  const confirm = process.argv.includes('--confirm')

  let newPrices
  try {
    newPrices = readJson(NEW_PRICES_PATH)
  } catch (err) {
    console.error(`Could not read ${NEW_PRICES_PATH}: ${err.message}`)
    process.exit(1)
  }
  const pantry = readJson(PANTRY_PATH)
  const pantryById = new Map(pantry.map(item => [item.id, item]))

  const unknownIds = newPrices.filter(entry => !pantryById.has(entry.id)).map(entry => entry.id)
  if (unknownIds.length > 0) {
    console.error(`Unknown pantry id(s), not in pantry.json — no write performed:\n  ${unknownIds.join('\n  ')}`)
    process.exit(1)
  }

  const rows = newPrices.map(entry => {
    const item = pantryById.get(entry.id)
    const oldPrice = item.packagePrice
    const newPrice = entry.packagePrice
    const costPerUnit = computeCostPerUnit(entry.packagePrice, entry.packageValue, entry.packageUnit, item.baseUnit)
    // Pack price alone is misleading whenever the pack size changes: cocoa moving
    // R45/1kg → R99.99/250g reads as +122% but is +789% per gram. Recipe costs are
    // driven by costPerUnit, so that is what gets flagged.
    const pctChange = (item.costPerUnit && costPerUnit != null)
      ? ((costPerUnit - item.costPerUnit) / item.costPerUnit) * 100
      : null
    const sizeChanged = entry.packageValue !== item.packageValue || entry.packageUnit !== item.packageUnit
    return { entry, item, oldPrice, newPrice, pctChange, costPerUnit, sizeChanged }
  })

  const unit = r => r.item.baseUnit === 'each' ? '/ea' : `/${r.item.baseUnit}`
  console.log('id'.padEnd(22), 'pack'.padEnd(26), 'cost per unit'.padEnd(26), 'change')
  console.log('-'.repeat(96))
  for (const r of rows) {
    const { entry, item, oldPrice, newPrice, pctChange, costPerUnit, sizeChanged } = r
    const pack = `R${(oldPrice ?? 0).toFixed(2)}/${item.packageValue}${item.packageUnit} → R${newPrice.toFixed(2)}/${entry.packageValue}${entry.packageUnit}`
    const cpu = costPerUnit == null
      ? '— cannot convert'
      : `R${(item.costPerUnit ?? 0).toFixed(4)} → R${costPerUnit.toFixed(4)}${unit(r)}`
    const pctStr = pctChange == null ? 'n/a' : `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`
    const flags = [
      pctChange != null && Math.abs(pctChange) > LARGE_CHANGE_PCT ? '⚠ LARGE' : '',
      sizeChanged ? '↕ pack size changed' : '',
    ].filter(Boolean).join('  ')
    console.log(entry.id.padEnd(22), pack.padEnd(26), cpu.padEnd(26), (pctStr + '  ' + flags).trim())
  }

  if (!confirm) {
    console.log('\nDry run — no files written. Re-run with --confirm to apply.')
    return
  }

  const today = new Date().toISOString().split('T')[0]
  const uncosted = []

  for (const { entry, item, costPerUnit } of rows) {
    item.packagePrice = entry.packagePrice
    item.packageValue = entry.packageValue
    item.packageUnit = entry.packageUnit
    item.matchedProduct = entry.matchedProduct ?? item.matchedProduct
    if (costPerUnit != null) {
      item.costPerUnit = Math.round(costPerUnit * 1e6) / 1e6
    } else {
      // packageUnit does not convert into baseUnit — the price moved but costPerUnit
      // did not, so the item is now internally inconsistent. Never fail silently here.
      uncosted.push(`${entry.id} (${entry.packageValue}${entry.packageUnit} → baseUnit ${item.baseUnit})`)
    }
    item.priceSource = 'apify'
    item.dateLastUpdated = today
    item.needsCosting = false
  }
  writeFileSync(PANTRY_PATH, JSON.stringify(pantry, null, 2) + '\n')

  const storeSrc = readFileSync(PANTRY_STORE_PATH, 'utf8')
  const versionMatch = storeSrc.match(/const CURRENT_PANTRY_VERSION = 'v(\d+)'/)
  if (!versionMatch) {
    console.error(`Could not find CURRENT_PANTRY_VERSION in ${PANTRY_STORE_PATH} — pantry.json was written, but the version was NOT bumped. Bump it manually.`)
    process.exit(1)
  }
  const nextVersion = `v${parseInt(versionMatch[1], 10) + 1}`
  const nextStoreSrc = storeSrc.replace(/const CURRENT_PANTRY_VERSION = 'v\d+'/, `const CURRENT_PANTRY_VERSION = '${nextVersion}'`)
  writeFileSync(PANTRY_STORE_PATH, nextStoreSrc)

  console.log(`\n✓ Wrote ${rows.length} price(s) to pantry.json`)
  console.log(`✓ Bumped CURRENT_PANTRY_VERSION to ${nextVersion}`)
  if (uncosted.length > 0) {
    console.warn(`\n⚠ ${uncosted.length} item(s) kept a STALE costPerUnit — packageUnit does not convert into baseUnit:`)
    uncosted.forEach(line => console.warn(`    ${line}`))
    console.warn('  Fix the packageUnit (or the item\'s baseUnit) in pantry.json and re-run.')
  }
  console.log('\nRun `npm run build` before deploying.')
}

main()
