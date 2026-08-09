# 🍞 KitchenCostings

> Recipe costing made simple for South African home bakers and small kitchens.

**KitchenCostings** is a free, privacy-first web app that helps bakers calculate the true cost of every recipe — ingredient by ingredient, in South African Rand. No subscriptions, no cloud sync, no data leaving your device.

\---

## ✨ Features

### Recipe Import

* Paste plain text, or drag-and-drop a `.txt`, `.pdf`, or `.docx` recipe file
* Automatic ingredient parsing: extracts names, amounts, and units from natural-language recipe text
* Supports common baking shorthand and Afrikaans ingredient names
* Import modal lets you review and correct matches before saving

### Pantry

* Pre-seeded pantry of South African baking staples with sensible defaults
* Each ingredient stores package size, price, and a `costPerUnit` in grams or ml
* Expandable rows show the matched retailer product and cost-per-unit
* Add, edit, or delete your own ingredients at any time
* AI Check button (uses Gemini Nano in Chrome, or local Ollama) to auto-fill base unit, aliases, and volume conversions for new ingredients

### Recipe Costing

* Real-time cost breakdown per ingredient, per serving, and for the full batch
* Adjustable serving count and markup percentage
* Packaging cost line item (separate, adjustable)
* Selling price calculated automatically from markup
* Traffic-light status (🟢 / 🟡 / 🔴) per recipe based on price completeness

### Price Updates

* Update ingredient prices directly from the Pantry or Costing modal
* Apify/Checkers integration fetches live price candidates (free tier)
* Prices flagged as stale after 7 days

### My Recipes

* Favourites toggle and collection filter
* Search recipes by title
* Edit or delete saved recipes
* Responsive book-style layout: side-by-side panels on desktop, stacked layout on mobile

\---

## 🏗 Architecture

```
src/
├── data/
│   ├── pantry.json        # Seed pantry — never mutated at runtime
│   └── recipes.json       # Seed recipes
├── io/
│   ├── pantryStore.js     # localStorage read/write for kitchen\_pantry (+ versioned migration)
│   └── recipeStore.js     # localStorage read/write for kitchen\_recipes
├── lib/
│   ├── parser.js          # Pure text parser (parseIngredientLine, parseRecipeText)
│   ├── matcher.js         # Fuzzy pantry matching
│   ├── importer.js        # Parse → match → convert pipeline
│   ├── aiMatcher.js       # Gemini Nano / Ollama AI integration
│   └── pricer.js          # Apify price fetch + scoring
├── hooks/
│   └── useAppState.js     # Single state hook; all reads/writes go through here
├── ui/
│   ├── ImportBar.jsx      # Paste / file drop entry point
│   ├── MyPantry.jsx       # Pantry panel
│   ├── MyRecipes.jsx      # Recipes panel
│   └── modals/            # AddIngredient, UpdatePrice, ImportRecipe, Costing
├── workers/
│   └── fetch-prices.js    # Cloudflare Worker — Apify Checkers proxy
└── App.jsx                # Shell, layout mode, modal router
```

**Key principles:**

* **Pantry-first:** `kitchen\_pantry` in localStorage is the single source of truth. `MyPantry` is a computed view filtered to the selected recipe.
* **Computed values are never stored.** Costs, totals, and enriched ingredient data are always recalculated at render time.
* **AI is non-blocking.** The AI layer only processes unmatched ingredients and never blocks the UI.
* **Three-ring architecture:** pure lib → hooks/components → App shell/network. No network calls inside pure logic.
* **localStorage key prefix:** `kitchen\_` (keeps KitchenCostings data separate from other apps in the same browser).

\---

## 🤖 AI Integration

KitchenCostings uses AI to assist with two tasks — both are optional and gracefully degrade if unavailable:

|Task|What it does|
|-|-|
|**Ingredient matching**|Re-parses unmatched ingredient lines and suggests pantry matches|
|**Pantry fill**|Suggests base unit, aliases, and volume conversions for new ingredients|

**Backends (auto-detected, in priority order):**

1. **Gemini Nano** — Chrome's built-in on-device model (Chrome 129+). No API key needed, fully private.
2. **Ollama** (`qwen2.5:1.5b`) — Local model for development. Requires Ollama running on `localhost:11434`.

Prompts are kept under 400 characters with strict output schemas to ensure reliable responses from small models.

\---

## 💸 Price Fetching

Live price data is fetched from **Checkers** via an Apify scraper proxied through a Cloudflare Worker (`src/workers/fetch-prices.js`). The API key is stored as a Wrangler secret (`APIFY_KEY`) and never appears in the client bundle.

* Uses the free Apify tier — no cost for typical personal use.
* Results are scored and ranked by name similarity, unit match, category, and brand.
* Falls back gracefully if Apify is unavailable.

\---

## 🛠 Tech Stack

|Layer|Technology|
|-|-|
|Framework|React 19 + Vite|
|Deployment|Cloudflare Pages (frontend) + Cloudflare Workers (price proxy)|
|Storage|`localStorage` (no backend database)|
|Testing|Vitest|
|File parsing|`mammoth.js` (`.docx`), `pdf.js` (PDF)|
|AI (on-device)|Chrome Gemini Nano (LanguageModel API)|
|AI (dev)|Ollama `qwen2.5:1.5b`|
|Price scraping|Apify + Checkers (via Cloudflare Worker)|

\---

## 🚀 Getting Started

### Prerequisites

* Node.js 18+
* A modern browser (Chrome 129+ recommended for on-device AI features)

### Install \& Run

```bash
git clone https://github.com/EugeneGouws/nkc.git
cd nkc
npm install
npm run dev
```

The app runs at `http://localhost:5173`.

### Run Tests

```bash
npm run test
```

All 124 parser tests should pass.

### Deploy

The frontend deploys to **Cloudflare Pages** (auto-deploy on `git push` to `main`). The Apify proxy is a separate **Cloudflare Worker**.

**Frontend (Cloudflare Pages):**
Connect the repo in the Cloudflare dashboard → Pages. Build command: `npm run build`. Build output: `dist`.

**Worker (Apify proxy):**

```bash
# 1. Install Wrangler
npm install -g wrangler

# 2. Set the Apify API key as a secure secret
wrangler secret put APIFY_KEY --env production

# 3. Deploy the Worker
wrangler deploy --env production
```

Worker config lives in `wrangler.toml`. Live URL: `https://nkc-fetch-prices-production.egouws.workers.dev`, exported as `PRICE_WORKER_URL` from `src/lib/pricer.js` — the single place to change it if the Worker moves again.

\---

## 🔒 Privacy

All recipe and pantry data is stored **locally in your browser** using `localStorage`. Nothing is sent to any server except:

* Ingredient lines sent to Gemini Nano (on-device in Chrome) or Ollama (local) when using the AI import feature.
* Ingredient names sent to Apify/Checkers via a Cloudflare Worker proxy when fetching price options.

Both are opt-in actions triggered explicitly by the user.

\---

## 🗺 Roadmap

* \[ ] POPIA/GDPR consent notice
* \[ ] Recipe URL import (via `recipe-scraper`)
* \[ ] Community price updates
* \[ ] Export recipe costing as PDF or Xlsx
* \[ ] Import Xlsx for multiple recipe import from existing costing spreadsheets.

\---

## 🙏 Acknowledgements

Named in honour of Drienie — a baker who proved that knowing your costs is part of the craft.

\---

## 📄 Licence

MIT — free to use, modify, and distribute. See [LICENSE](LICENSE) for the full text.

> The MIT Licence is one of the most permissive open-source licences. It lets anyone use, copy, modify, and distribute this software — including for commercial purposes — as long as the original copyright notice is included. There is no warranty.

