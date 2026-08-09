import { useState, useEffect } from 'react'
import { findCandidates, convertAmount } from '../../lib/index.js'
import AddIngredientModal from './AddIngredientModal.jsx'
import './modal-base.css'
import './ImportRecipeModal.css'

// Compute typeahead suggestions for a search string against the pantry.
// 1-char: nothing. 2-char: startsWith on name/aliases. 3+: findCandidates (alias + Jaccard).
function computeSuggestions(value, pantryList) {
  if (value.length < 2) return []
  if (value.length < 3) {
    const q = value.toLowerCase()
    return pantryList
      .filter(p =>
        p.canonicalName.toLowerCase().startsWith(q) ||
        p.aliases.some(a => a.toLowerCase().startsWith(q))
      )
      .slice(0, 6)
      .map(p => ({ entry: p }))
  }
  return findCandidates(value, pantryList)
}

export default function ImportRecipeModal({ isOpen, mode, recipe, pantry, collections, onImport, onSave, onAddIngredient, onClose }) {
  const isEditRecipe = mode === 'edit'

  const [editRows,      setEditRows]      = useState([])
  const [editTitle,     setEditTitle]     = useState('')
  // '' = not yet supplied. Import is blocked until the user enters a real number —
  // defaulting to 1 silently produced a per-serving cost equal to the whole batch.
  const [editServings,  setEditServings]  = useState('')
  const [editTags,      setEditTags]      = useState([])
  const [tagInput,      setTagInput]      = useState('')
  const [suggestions,   setSuggestions]   = useState({})  // { rowIndex: [{entry}] }
  const [openDropdown,  setOpenDropdown]  = useState(null) // rowIndex | null
  const [addIngOpen,    setAddIngOpen]    = useState(false)
  const [addIngName,    setAddIngName]    = useState('')
  const [addIngRowIndex, setAddIngRowIndex] = useState(null)
  const [pendingFill,   setPendingFill]   = useState(null)

  // After adding a new pantry ingredient, auto-fill the row that triggered it
  useEffect(() => {
    if (!pendingFill) return
    const match = (pantry ?? []).find(p => p.canonicalName.toLowerCase() === pendingFill.name.toLowerCase())
    if (!match) return
    setEditRows(prev => prev.map((r, idx) =>
      idx === pendingFill.rowIndex ? { ...r, nameInput: match.canonicalName, matchedId: match.id } : r
    ))
    setPendingFill(null)
  }, [pantry, pendingFill])

  useEffect(() => {
    if (!isOpen) {
      setEditRows([])
      setEditTitle('')
      setEditServings('')
      setEditTags([])
      setTagInput('')
      setSuggestions({})
      setOpenDropdown(null)
      setAddIngOpen(false)
      setAddIngName('')
    }
    if (isOpen && recipe) {
      setEditRows(buildEditRows(recipe, pantry ?? []))
      setEditTitle(recipe.title ?? '')
      setEditServings(recipe.servings > 0 ? recipe.servings : '')
      setEditTags(recipe.collection ? recipe.collection.split(',').map(t => t.trim()).filter(Boolean) : [])
    }
  }, [isOpen])

  if (!isOpen) return null

  const ingredients = recipe?.ingredients ?? []
  const pantryList  = pantry ?? []

  const pantryByName = new Map(pantryList.map(p => [p.canonicalName.toLowerCase(), p]))

  // ── Edit row helpers ───────────────────────────────────────────────────────

  function buildEditRows(src, pList) {
    return (src?.ingredients ?? []).map(ing => {
      const matched = ing.matchedIngredient
        ? pList.find(p => p.id === ing.matchedIngredient)
        : null
      return {
        nameInput: matched?.canonicalName ?? ing.name ?? ing.raw ?? '',
        matchedId: ing.matchedIngredient ?? null,
        amount:    ing.amount != null ? String(ing.amount) : '',
        unit:      ing.unit ?? '',
      }
    })
  }

  function updateRow(i, changes) {
    setEditRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...changes } : r))
  }

  function handleAddRow() {
    setEditRows(prev => [...prev, { nameInput: '', matchedId: null, amount: '', unit: '' }])
  }

  function handleDeleteRow(i) {
    setEditRows(prev => prev.filter((_, idx) => idx !== i))
  }

  function handleNameChange(i, value) {
    const exact = pantryByName.get(value.toLowerCase())
    updateRow(i, { nameInput: value, matchedId: exact?.id ?? null })
    const suggs = computeSuggestions(value, pantryList)
    setSuggestions(prev => ({ ...prev, [i]: suggs }))
    setOpenDropdown(suggs.length > 0 ? i : null)
  }

  function selectSuggestion(i, entry) {
    updateRow(i, { nameInput: entry.canonicalName, matchedId: entry.id })
    setOpenDropdown(null)
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  function handleImport() {
    if (!recipe) return
    const updatedIngredients = editRows.map((row, i) => {
      const orig   = ingredients[i] ?? {}
      const amount = parseFloat(row.amount) || 0
      const entry  = row.matchedId ? pantryList.find(p => p.id === row.matchedId) : null
      // Convert into the pantry item's baseUnit. Without this a "3 cup" row was stored
      // as convertedAmount 3 and later multiplied by a per-gram cost.
      const { convertedUnit, convertedAmount } = convertAmount(amount, row.unit, entry)
      return {
        ...orig,
        id:                orig.id ?? i,
        name:              row.nameInput,
        matchedIngredient: row.matchedId,
        confident:         !!row.matchedId,
        needsConfirm:      false,
        amount,
        unit:              row.unit,
        convertedAmount,
        convertedUnit,
      }
    })
    const updated = { ...recipe, title: editTitle, servings: parseInt(editServings, 10), collection: editTags.join(','), ingredients: updatedIngredients }
    if (isEditRecipe) {
      onSave?.(updated)
    } else {
      onImport?.(updated)
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const servingsNum   = parseInt(editServings, 10)
  const servingsValid = Number.isInteger(servingsNum) && servingsNum >= 1
  const allMatched    = editRows.every(r => r.matchedId)
  const canImport     = recipe != null && allMatched && servingsValid

  const matchedCount = editRows.filter(r => r.matchedId).length
  const infoText     = !recipe
    ? 'Awaiting import…'
    : !allMatched
      ? `${matchedCount} / ${editRows.length} matched`
      : servingsValid
        ? `${matchedCount} / ${editRows.length} matched`
        : 'Enter servings to continue'

  return (
    <div className="import-recipe-modal">

      {/* LEFT: raw text preview */}
      <div className="import-recipe-left">
        <div className="panel-header">
          <p className="panel-heading">Recipe Text</p>
        </div>
        <div className="panel-list">
          {recipe?.rawText
            ? <pre className="import-raw-text">{recipe.rawText}</pre>
            : <p className="ing-empty">No source text available</p>
          }
        </div>
      </div>

      {/* RIGHT: import controls */}
      <div className="import-recipe-right">
        <div className="panel-header">
          <div className="modal-title-row">
            <p className="panel-heading">{recipe?.title ?? 'Import Recipe'}</p>
            <button className="ctrl-btn modal-close-x" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="panel-controls">
            <button
              className="ctrl-btn"
              disabled={!canImport}
              onClick={handleImport}
            >
              {isEditRecipe ? 'Save Recipe' : 'Import Recipe'}
            </button>
            <span className="modal-info-box">{infoText}</span>
          </div>
        </div>

        <div className="panel-list">
          {!recipe ? (
            <p className="ing-empty">Drop or paste a recipe above to get started</p>
          ) : (
            <>
              <div className="ing-row ing-row--meta">
                <span className="ing-meta-label">Title</span>
                <input
                  className="ing-edit-name"
                  style={{ flex: 1 }}
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  placeholder="Recipe title"
                />
                <span className="ing-meta-label">Servings</span>
                <input
                  className={`ing-edit-qty${servingsValid ? '' : ' input-required'}`}
                  type="number"
                  min="1"
                  value={editServings}
                  placeholder="?"
                  aria-invalid={!servingsValid}
                  onChange={e => {
                    const raw = e.target.value
                    if (raw === '') return setEditServings('')
                    const n = parseInt(raw, 10)
                    setEditServings(Number.isNaN(n) ? '' : Math.max(1, n))
                  }}
                />
              </div>
              <div className="ing-row ing-row--meta">
                <span className="ing-meta-label">Tags</span>
                <div className="tag-input-wrap">
                  {editTags.map(tag => (
                    <span key={tag} className="tag-pill">
                      {tag}
                      <button
                        className="tag-remove"
                        onClick={() => setEditTags(prev => prev.filter(t => t !== tag))}
                        aria-label={`Remove ${tag}`}
                      >✕</button>
                    </span>
                  ))}
                  <input
                    className="tag-input"
                    value={tagInput}
                    onChange={e => {
                      const val = e.target.value
                      const isExactMatch = (collections ?? []).some(c => c === val && !editTags.includes(c))
                      if (isExactMatch) {
                        setEditTags(prev => [...prev, val])
                        setTagInput('')
                      } else {
                        setTagInput(val)
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        const t = tagInput.trim().replace(/,$/, '')
                        if (t && !editTags.includes(t)) setEditTags(prev => [...prev, t])
                        setTagInput('')
                      }
                    }}
                    placeholder={editTags.length ? '' : 'Add tag, press Enter…'}
                    list="tag-suggestions"
                  />
                  <datalist id="tag-suggestions">
                    {(collections ?? []).filter(c => !editTags.includes(c)).map(c => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>
              {editRows.map((row, i) => (
                <div key={i} className="ing-row">
                  <span className={`status-dot ${row.matchedId ? 'green' : 'red'}`} />
                  <button
                    className="ctrl-btn ing-row-delete"
                    onClick={() => handleDeleteRow(i)}
                    aria-label="Remove ingredient"
                    title="Remove"
                  >✕</button>
                  <div className="ing-edit-name-wrap">
                    <input
                      className="ing-edit-name"
                      value={row.nameInput}
                      onChange={e => handleNameChange(i, e.target.value)}
                      onFocus={() => {
                        const suggs = computeSuggestions(row.nameInput, pantryList)
                        if (suggs.length > 0) { setSuggestions(prev => ({ ...prev, [i]: suggs })); setOpenDropdown(i) }
                      }}
                      onBlur={() => setTimeout(() => setOpenDropdown(null), 250)}
                      placeholder="Search pantry…"
                    />
                    {openDropdown === i && (suggestions[i]?.length > 0 || row.nameInput.length >= 2) && (
                      <div className="ing-dropdown">
                        {(suggestions[i] ?? []).map(({ entry }) => (
                          <div
                            key={entry.id}
                            className="ing-dropdown-item"
                            onMouseDown={e => { e.preventDefault(); selectSuggestion(i, entry) }}
                          >
                            {entry.canonicalName}
                          </div>
                        ))}
                        <div
                          className="ing-dropdown-item ing-dropdown-add"
                          onMouseDown={e => {
                            e.preventDefault()
                            setAddIngName(row.nameInput)
                            setAddIngRowIndex(i)
                            setAddIngOpen(true)
                            setOpenDropdown(null)
                          }}
                        >
                          + Add new ingredient
                        </div>
                      </div>
                    )}
                  </div>
                  <input
                    className="ing-edit-qty"
                    type="number"
                    min="0"
                    step="any"
                    value={row.amount}
                    onChange={e => updateRow(i, { amount: e.target.value })}
                    placeholder="qty"
                  />
                  <input
                    className="ing-edit-unit"
                    value={row.unit}
                    onChange={e => updateRow(i, { unit: e.target.value })}
                    placeholder="unit"
                  />
                </div>
              ))}
              <div className="ing-row ing-row--add">
                <button className="ctrl-btn" onClick={handleAddRow}>+ Add ingredient</button>
              </div>
            </>
          )}
        </div>

        {addIngOpen && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
            <AddIngredientModal
              isOpen
              ingredientName={addIngName}
              onAdd={(data) => {
                onAddIngredient?.(
                  { name: data.name, pkgValue: data.pkgValue, pkgUnit: data.pkgUnit,
                    pkgPrice: data.pkgPrice, pkgMatch: data.pkgMatch,
                    conversions: data.conversions, aliases: data.aliases },
                  data.baseUnit
                )
                setPendingFill({ rowIndex: addIngRowIndex, name: data.name.trim() })
                setAddIngOpen(false)
              }}
              onClose={() => setAddIngOpen(false)}
            />
          </div>
        )}
      </div>

    </div>
  )
}
