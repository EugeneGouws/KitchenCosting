import { useState, useMemo } from 'react'
import './modal-base.css'
import './PricePushModal.css'

function formatR(value) {
  return `R${value.toFixed(2)}`
}

function formatPct(pct) {
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

const COPY = {
  routine: {
    heading: 'Updated prices are available',
    body: 'New Checkers prices have been published since you last updated. These are refreshes of prices we sourced — review and apply the ones you want.',
    applyLabel: 'Update selected',
    skipLabel: 'Skip for now',
    defaultChecked: true,
  },
  manual: {
    heading: 'Some prices you entered yourself',
    body: "These were typed in by hand, so they may be from a different supplier — we've left them alone unless you say otherwise.",
    applyLabel: 'Update selected',
    skipLabel: 'Keep my prices',
    defaultChecked: false,
  },
}

export default function PricePushModal({ variant, rows, onApply, onSkip }) {
  const copy = COPY[variant]

  const [checked, setChecked] = useState(() => new Set(copy.defaultChecked ? rows.map(r => r.id) : []))

  const checkedRows = useMemo(() => rows.filter(r => checked.has(r.id)), [rows, checked])

  function toggle(id) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleApply() {
    onApply(checkedRows)
  }

  return (
    <div className="price-push-modal">
      <div className="panel-header">
        <div className="panel-heading-row">
          <p className="panel-heading">{copy.heading}</p>
        </div>
      </div>

      <p className="price-push-body">{copy.body}</p>

      <div className="price-push-list">
        {rows.map(row => (
          <div key={row.id} className="price-push-row">
            <input
              type="checkbox"
              checked={checked.has(row.id)}
              onChange={() => toggle(row.id)}
            />
            <span className="price-push-name">{row.canonicalName}</span>
            {variant === 'manual' && (
              <span className="price-push-product">{row.newMatchedProduct || '—'}</span>
            )}
            <span className="price-push-prices">
              {formatR(row.oldPrice)} → {formatR(row.newPrice)}
            </span>
            <span className={`price-push-pct ${row.pctChange > 0 ? 'up' : 'down'}`}>
              {formatPct(row.pctChange)}
            </span>
          </div>
        ))}
      </div>

      <div className="price-push-footer">
        <button className="ctrl-btn" onClick={onSkip}>{copy.skipLabel}</button>
        <button
          className="ctrl-btn"
          disabled={checkedRows.length === 0}
          style={checkedRows.length > 0 ? { borderColor: 'var(--green-accent)', color: 'var(--green-accent)' } : {}}
          onClick={handleApply}
        >
          {copy.applyLabel}
        </button>
      </div>
    </div>
  )
}
