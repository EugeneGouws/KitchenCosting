import { useState, useMemo } from 'react'
import './modal-base.css'
import './CostingModal.css'

function formatR(value) {
  return `R${value.toFixed(2)}`
}

function formatCostPerUnit(item) {
  if (!item || !item.costPerUnit) return '—'
  if (item.baseUnit === 'each') return `R${item.costPerUnit.toFixed(2)}/each`
  if (item.baseUnit === 'ml')   return `R${(item.costPerUnit * 100).toFixed(2)}/100ml`
  return `R${(item.costPerUnit * 100).toFixed(2)}/100g`
}

// Trim trailing zeros so 384 stays 384 and 226.796 becomes 226.8
function formatQty(n) {
  if (n == null || Number.isNaN(n)) return '—'
  return Number(n.toFixed(2)).toString()
}

// "1.5 cup" — the amount exactly as the recipe stated it
function formatRecipeQty(ing) {
  if (ing.amount == null) return '—'
  return `${formatQty(ing.amount)} ${ing.unit ?? ''}`.trim()
}

function dotClass(pantryItem) {
  if (!pantryItem || pantryItem.costPerUnit === 0) return 'red'
  if (pantryItem.needsCosting) return 'amber'
  return 'green'
}

export default function CostingModal({ recipe, pantry, layoutMode = 'wide', onSearchPrices, onClose }) {
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [servings,    setServings]    = useState(recipe?.servings ?? 1)
  const [markupPct,   setMarkupPct]   = useState(150)
  const [packaging,   setPackaging]   = useState(0)

  const pantryMap = useMemo(() => {
    const m = new Map()
    if (pantry) pantry.forEach(p => m.set(p.id, p))
    return m
  }, [pantry])

  const ingredients = recipe?.ingredients ?? []

  const ingredientRows = useMemo(() =>
    ingredients.map((ing, i) => {
      const pantryItem = pantryMap.get(ing.matchedIngredient)
      const amt = ing.convertedAmount ?? 0
      const cpu = pantryItem?.costPerUnit ?? 0
      // Only cost a row whose amount actually reached the pantry item's baseUnit.
      // "3 cup" against a R/g price would otherwise read as 3 grams.
      const converted = !pantryItem || ing.convertedUnit === pantryItem.baseUnit
      const cost = converted && amt > 0 && cpu > 0 ? amt * cpu : null
      return { ing, pantryItem, cost, converted, key: ing.matchedIngredient ?? ing.id ?? i }
    }),
    [ingredients, pantryMap]
  )

  const ingredientTotal = ingredientRows.reduce((sum, r) => sum + (r.cost ?? 0), 0)
  const supplies        = ingredientTotal * 0.05
  const operating       = ingredientTotal * 0.05
  const equipment       = ingredientTotal * 0.05
  const totalCost       = ingredientTotal + supplies + operating + equipment + packaging
  const svgs            = Math.max(1, servings)
  const costPerServing  = totalCost / svgs
  const sellingTotal    = totalCost * (1 + markupPct / 100)
  const sellingPerSvg   = sellingTotal / svgs

  function toggleSelect(id) {
    if (!id) return
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleUpdatePrices() {
    onSearchPrices?.([...selectedIds])
    setSelectedIds(new Set())
  }

  const selectableIds = ingredientRows.map(r => r.ing.matchedIngredient).filter(Boolean)
  const hasSelection  = selectedIds.size > 0
  const allSelected   = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id))

  function handleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds))
  }

  return (
    <div className={`costing-modal${layoutMode === 'narrow' ? ' narrow' : ''}`}>

      {/* LEFT HALF */}
      <div className="costing-half left">
        <div className="panel-header">
          <div className="panel-heading-row">
            <p className="panel-heading">{recipe?.title ?? 'No recipe selected'}</p>
            <button className="ctrl-btn modal-close-x" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="panel-controls">
            {selectableIds.length > 0 && (
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = hasSelection && !allSelected }}
                onChange={handleSelectAll}
                style={{ accentColor: 'var(--green-accent)', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }}
              />
            )}
            <button
              className="ctrl-btn"
              disabled={!hasSelection}
              style={hasSelection ? { borderColor: 'var(--green-accent)', color: 'var(--green-accent)' } : {}}
              onClick={handleUpdatePrices}
            >
              Search Checkers Sixty60
            </button>
          </div>
        </div>

        <div className="costing-ing-head">
          <span />
          <span />
          <span>Ingredient</span>
          <span>Recipe</span>
          <span>Converted</span>
          <span>Unit price</span>
          <span>Cost</span>
        </div>

        <div className="panel-list">
          {ingredientRows.map(({ ing, pantryItem, cost, converted, key }) => (
            <div key={key} className="costing-ing-row">
              <input
                type="checkbox"
                checked={selectedIds.has(ing.matchedIngredient)}
                disabled={!ing.matchedIngredient}
                onChange={() => toggleSelect(ing.matchedIngredient)}
                onClick={e => e.stopPropagation()}
              />
              <span className={`status-dot ${dotClass(pantryItem)}`} />
              <span className="costing-ing-name">
                {pantryItem?.canonicalName ?? ing.name ?? ing.raw}
              </span>
              <span className="costing-ing-qty">
                {formatRecipeQty(ing)}
              </span>
              <span className={`costing-ing-conv${converted ? '' : ' unconverted'}`}>
                {converted
                  ? `${formatQty(ing.convertedAmount)} ${ing.convertedUnit ?? ''}`.trim()
                  : 'no conversion'}
              </span>
              <span className="costing-ing-cpu">
                {formatCostPerUnit(pantryItem)}
              </span>
              <span className="costing-ing-total">
                {cost !== null ? formatR(cost) : '—'}
              </span>
            </div>
          ))}
        </div>

      </div>

      {/* RIGHT HALF */}
      <div className="costing-half right">
        <div className="panel-header">
          <div className="panel-heading-row">
            <p className="panel-heading">Cost Breakdown</p>
            <button className="ctrl-btn modal-close-x" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="panel-controls costing-right-controls">
            <label className="costing-ctrl-label">Servings</label>
            <input
              type="number"
              className="costing-ctrl-input"
              min="1"
              value={servings}
              onChange={e => setServings(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <label className="costing-ctrl-label">Markup</label>
            <input
              type="number"
              className="costing-ctrl-input costing-ctrl-input--wide"
              min="0"
              value={markupPct}
              onChange={e => setMarkupPct(Math.max(0, parseInt(e.target.value) || 0))}
            />
            <span className="costing-pct">%</span>
          </div>
        </div>

        <div className="panel-list">
          <div className="costing-breakdown-row">
            <span>Ingredient cost</span>
            <span>{formatR(ingredientTotal)}</span>
          </div>
          <div className="costing-breakdown-row">
            <span>Supplies (5%)</span>
            <span>{formatR(supplies)}</span>
          </div>
          <div className="costing-breakdown-row">
            <span>Operating costs (5%)</span>
            <span>{formatR(operating)}</span>
          </div>
          <div className="costing-breakdown-row">
            <span>Equipment (5%)</span>
            <span>{formatR(equipment)}</span>
          </div>
          <div className="costing-breakdown-row">
            <span>Packaging</span>
            <span className="costing-pkg-wrap">
              <span className="costing-r-prefix">R</span>
              <input
                type="number"
                className="costing-pkg-input"
                min="0"
                step="0.01"
                value={packaging}
                onChange={e => setPackaging(Math.max(0, parseFloat(e.target.value) || 0))}
              />
            </span>
          </div>

          <div className="costing-divider" />

          <div className="costing-summary-header">
            <span />
            <span>Per serving</span>
            <span>Recipe total</span>
          </div>
          <div className="costing-summary-row bold">
            <span>Total Cost</span>
            <span>{formatR(costPerServing)}</span>
            <span>{formatR(totalCost)}</span>
          </div>
          <div className="costing-summary-row bold">
            <span>Selling price ({markupPct}%)</span>
            <span>{formatR(sellingPerSvg)}</span>
            <span>{formatR(sellingTotal)}</span>
          </div>
        </div>

      </div>

    </div>
  )
}
