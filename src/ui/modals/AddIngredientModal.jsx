import { useState, useEffect } from 'react'
import './modal-base.css'
import './AddIngredientModal.css'

export default function AddIngredientModal({ isOpen, item, ingredientName, onAdd, onClose }) {
  const [name,        setName]        = useState('')
  const [baseUnit,    setBaseUnit]    = useState('')
  const [pkgValue,    setPkgValue]    = useState('')
  const [pkgUnit,     setPkgUnit]     = useState('g')
  const [pkgPrice,    setPkgPrice]    = useState('')
  const [pkgMatch,    setPkgMatch]    = useState('')
  const [conversions, setConversions] = useState('')
  const [aliases,     setAliases]     = useState('')

  useEffect(() => {
    if (!isOpen) return
    if (item) {
      // Editing an existing pantry item — populate all fields
      setName(item.canonicalName ?? '')
      setBaseUnit(item.baseUnit ?? '')
      setPkgValue(item.packageValue != null ? String(item.packageValue) : '')
      setPkgUnit(item.packageUnit ?? 'g')
      setPkgPrice(item.packagePrice != null ? String(item.packagePrice) : '')
      setPkgMatch(item.matchedProduct ?? '')
      setConversions(
        item.conversions && Object.keys(item.conversions).length
          ? Object.entries(item.conversions).map(([k, v]) => `${k}:${v}`).join(', ')
          : ''
      )
      setAliases(Array.isArray(item.aliases) ? item.aliases.join(', ') : '')
    } else {
      // New ingredient — only name pre-filled
      setName(ingredientName ?? '')
      setBaseUnit('')
      setPkgValue('')
      setPkgUnit('g')
      setPkgPrice('')
      setPkgMatch('')
      setConversions('')
      setAliases('')
    }
  }, [isOpen, item, ingredientName])

  if (!isOpen) return null

  const canAdd = name.trim() !== '' && baseUnit !== ''

  function handleAdd() {
    if (!canAdd) return
    onAdd({ name: name.trim(), baseUnit, pkgValue, pkgUnit, pkgPrice, pkgMatch, conversions, aliases })
  }

  function formatPrice(val) {
    const n = parseFloat(val)
    return isNaN(n) ? '' : n.toFixed(2)
  }

  return (
    <div className="add-ingredient-modal">
      <div className="panel-header">
        <div className="panel-heading-row">
          <p className="panel-heading">Ingredient</p>
          <button className="ctrl-btn modal-close-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="panel-controls">
          <button
            className="ctrl-btn"
            disabled={!canAdd}
            onClick={handleAdd}
          >
            {item ? 'Save Changes' : 'Add Ingredient'}
          </button>
        </div>
      </div>

      <div className="panel-list">

        {/* Mandatory: Name */}
        <div className="field-row">
          <span
            className="field-dot"
            style={{ background: name.trim() === '' ? '#c0392b' : 'transparent' }}
          />
          <span className="field-label">Name</span>
          <div className="field-value">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cake Flour" />
          </div>
        </div>

        {/* Mandatory: Base Unit */}
        <div className="field-row">
          <span
            className="field-dot"
            style={{ background: baseUnit === '' ? '#c0392b' : 'transparent' }}
          />
          <span className="field-label">Base Unit</span>
          <div className="field-value">
            <select value={baseUnit} onChange={e => setBaseUnit(e.target.value)}>
              <option value="">— select —</option>
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="each">each</option>
            </select>
          </div>
        </div>

        {/* Pricing subheading */}
        <p className="field-subheading">Pricing</p>

        {/* Package value + unit + price */}
        <div className="field-row">
          <span className="field-dot" />
          <span className="field-label">Price</span>
          <div className="field-value">
            <div className="field-price-wrap">
              <input
                className="field-price-value"
                type="number"
                min="0"
                step="any"
                value={pkgValue}
                onChange={e => setPkgValue(e.target.value)}
                placeholder="1000"
              />
              <select
                className="field-price-unit"
                value={pkgUnit}
                onChange={e => setPkgUnit(e.target.value)}
              >
                <option value="g">g</option>
                <option value="ml">ml</option>
                <option value="each">each</option>
              </select>
              <span className="field-price-r">R</span>
              <input
                className="field-price-price"
                type="number"
                min="0"
                step="0.01"
                value={pkgPrice}
                onChange={e => setPkgPrice(e.target.value)}
                onBlur={e => setPkgPrice(formatPrice(e.target.value))}
                placeholder="0.00"
              />
            </div>
          </div>
        </div>

        {/* Matched product name */}
        <div className="field-row">
          <span className="field-dot" />
          <span className="field-label">Product</span>
          <div className="field-value">
            <input
              value={pkgMatch}
              onChange={e => setPkgMatch(e.target.value)}
              placeholder="e.g. Sasko Cake Flour 2kg"
            />
          </div>
        </div>

        {/* Metadata subheading */}
        <p className="field-subheading">Metadata</p>

        {/* Conversions */}
        <div className="field-row">
          <span className="field-dot" />
          <span className="field-label">Conversions</span>
          <div className="field-value">
            <input
              value={conversions}
              onChange={e => setConversions(e.target.value)}
              placeholder="e.g. cup:250"
            />
          </div>
        </div>

        {/* Aliases */}
        <div className="field-row">
          <span className="field-dot" />
          <span className="field-label">Aliases</span>
          <div className="field-value">
            <input
              value={aliases}
              onChange={e => setAliases(e.target.value)}
              placeholder="e.g. flour, plain flour"
            />
          </div>
        </div>

      </div>
    </div>
  )
}
