#!/usr/bin/env node
// scripts/price-refresh.js
//
// Local CLI that batches Apify price checks against the Asus price server.
// Runs on this machine (not on Asus) — calls Apify through the existing
// Cloudflare Worker (src/workers/fetch-prices.js), reads the "in use"
// candidate list from src/data/pantry.json, and treats the Asus Postgres
// DB as the source of truth for pricing state.
//
// Usage:
//   node scripts/price-refresh.js refresh
//   node scripts/price-refresh.js add <id>

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fetchPriceOptions } from '../src/lib/pricer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const STALE_DAYS = 7
const MATCH_SCORE_THRESHOLD = 0.85 // same auto-accept convention as matcher.js's matchIngredient()
const BATCH_SIZE = 5

// ─── Tiny .env loader (no dependency — see MISTAKES.md re: not adding
// packages for something this small) ────────────────────────────────────
function loadEnv() {
  const envPath = path.join(ROOT, '.env')
  let text
  try {
    text = readFileSync(envPath, 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

function requirePriceServerUrl() {
  const url = process.env.PRICE_SERVER_URL
  if (!url) {
    console.error('PRICE_SERVER_URL is not set. Add it to .env, e.g.:\n  PRICE_SERVER_URL=https://nkcprices.egouws.com')
    process.exit(1)
  }
  return url.replace(/\/$/, '')
}

// Writes require a bearer token (Asus API_TOKEN, from /home/eugene/server/.env).
// Reads stay public and need no header.
function authHeaders() {
  const token = process.env.API_TOKEN
  if (!token) {
    console.error('API_TOKEN is not set. Add it to .env, e.g.:\n  API_TOKEN=<value from /home/eugene/server/.env on Asus>')
    process.exit(1)
  }
  return { Authorization: `Bearer ${token}` }
}

function readPantry() {
  const pantryPath = path.join(ROOT, 'src/data/pantry.json')
  return JSON.parse(readFileSync(pantryPath, 'utf8'))
}

function isStale(dateStr) {
  if (!dateStr) return true
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - STALE_DAYS)
  return new Date(dateStr) < cutoff
}

// ─── refresh ──────────────────────────────────────────────────────────────

async function refresh() {
  const baseUrl = requirePriceServerUrl()
  const pantry = readPantry()
  const inUseItems = pantry.filter(item => item.inUse)

  if (inUseItems.length === 0) {
    console.log('No in-use ingredients found in pantry.json. Nothing to do.')
    return
  }

  const ids = inUseItems.map(item => item.id)
  let serverRows = []
  try {
    const resp = await fetch(`${baseUrl}/api/prices?ids=${encodeURIComponent(ids.join(','))}`)
    if (!resp.ok) throw new Error(`GET /api/prices returned ${resp.status}`)
    serverRows = await resp.json()
  } catch (err) {
    console.error('Failed to fetch current prices from Asus server:', err.message)
    process.exit(1)
  }

  const serverById = Object.fromEntries(serverRows.map(row => [row.id, row]))

  const staleCandidates = inUseItems
    .map(item => ({ item, row: serverById[item.id] ?? null }))
    .filter(({ row }) => row?.source !== 'manual') // never touch a manually-set price
    .filter(({ row }) => !row || row.package_price == null || isStale(row.last_updated))
    .sort((a, b) => {
      const aDate = a.row?.last_updated ? new Date(a.row.last_updated).getTime() : 0
      const bDate = b.row?.last_updated ? new Date(b.row.last_updated).getTime() : 0
      return aDate - bDate
    })
    .slice(0, BATCH_SIZE)

  if (staleCandidates.length === 0) {
    console.log(`All ${inUseItems.length} in-use ingredients are already priced within ${STALE_DAYS} days.`)
    return
  }

  console.log(`Checking ${staleCandidates.length} ingredient(s)...\n`)

  let updated = 0
  let skipped = 0

  for (const { item } of staleCandidates) {
    let options
    try {
      options = await fetchPriceOptions(item)
    } catch (err) {
      console.log(`✗ ${item.canonicalName}: Apify fetch failed — ${err.message}`)
      skipped++
      continue
    }

    const top = options[0]
    if (!top || top.costPerUnit == null || top.score < MATCH_SCORE_THRESHOLD) {
      const reason = !top ? 'no results' : top.costPerUnit == null ? 'unit mismatch' : `low match score (${top.score.toFixed(2)})`
      console.log(`✗ ${item.canonicalName}: skipped — ${reason}`)
      skipped++
      continue
    }

    const priceNum = parseFloat(String(top.product.price ?? '').replace(/[^0-9.]/g, ''))
    if (isNaN(priceNum)) {
      console.log(`✗ ${item.canonicalName}: skipped — could not parse product price`)
      skipped++
      continue
    }

    try {
      const resp = await fetch(`${baseUrl}/api/prices/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          package_price: priceNum,
          package_value: top.packageValue,
          package_unit: top.packageUnit,
          matched_product: top.product.name ?? top.product.title ?? '',
          source: 'apify',
          last_updated: new Date().toISOString(),
        }),
      })
      if (!resp.ok) throw new Error(`PATCH returned ${resp.status}`)
      console.log(`✓ ${item.canonicalName}: updated (score ${top.score.toFixed(2)}, R${priceNum.toFixed(2)})`)
      updated++
    } catch (err) {
      console.log(`✗ ${item.canonicalName}: matched but write failed — ${err.message}`)
      skipped++
    }
  }

  console.log(`\n${staleCandidates.length} checked, ${updated} updated, ${skipped} skipped.`)
}

// ─── add ──────────────────────────────────────────────────────────────────

async function add(id) {
  if (!id) {
    console.error('Usage: node scripts/price-refresh.js add <id>')
    process.exit(1)
  }

  const baseUrl = requirePriceServerUrl()
  const pantry = readPantry()
  const item = pantry.find(p => p.id === id)
  if (!item) {
    console.error(`No pantry.json entry with id "${id}". Add it there first.`)
    process.exit(1)
  }

  try {
    const resp = await fetch(`${baseUrl}/api/prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        id: item.id,
        canonical_name: item.canonicalName,
      }),
    })
    if (resp.status === 409) {
      console.log(`${item.canonicalName} (${item.id}) is already registered with the price server.`)
      return
    }
    if (!resp.ok) throw new Error(`POST /api/prices returned ${resp.status}`)
    console.log(`✓ ${item.canonicalName} (${item.id}) registered with the price server.`)
  } catch (err) {
    console.error(`Failed to register ${item.id}:`, err.message)
    process.exit(1)
  }
}

// ─── entry point ────────────────────────────────────────────────────────

async function main() {
  loadEnv()
  const [, , command, arg] = process.argv

  if (command === 'refresh') return refresh()
  if (command === 'add') return add(arg)

  console.error('Usage:\n  node scripts/price-refresh.js refresh\n  node scripts/price-refresh.js add <id>')
  process.exit(1)
}

main()
