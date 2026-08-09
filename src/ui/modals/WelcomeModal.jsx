import './modal-base.css'
import './WelcomeModal.css'

export default function WelcomeModal({ onClose }) {
  return (
    <div className="welcome-overlay">
      <div className="welcome-book">
        <div className="welcome-panels">

          {/* LEFT PAGE — What it is */}
          <div className="welcome-page left">
            <div className="panel-header">
              <p className="panel-heading">Welcome</p>
            </div>
            <div className="welcome-body">
              <div className="welcome-storage-warn">
                <span className="welcome-storage-icon" aria-hidden="true">⚠</span>
                <p className="welcome-storage-text">
                  <strong>Your data is saved in this browser only</strong>
                  Recipes and prices live on this device. They are not backed up anywhere, and they do not follow you to another browser, phone, or computer. Clearing your browsing data — or using private/incognito mode — will delete them permanently.
                </p>
              </div>
              <p style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 600, color: 'var(--tx-primary)', margin: '0 0 4px' }}>
                Kitchen Costings
              </p>
              <p style={{ fontSize: 12, color: 'var(--tx-muted)', fontStyle: 'italic', margin: '0 0 12px' }}>
                Know what your baking really costs.
              </p>
              <p style={{ fontSize: 12, color: 'var(--tx-secondary)', lineHeight: 1.65, margin: '0 0 14px' }}>
                Kitchen Costings is a free tool for home bakers and small kitchens that want to understand the true cost of every recipe — ingredient by ingredient, in Rand. Everything stays on your device. No accounts, no subscriptions.
              </p>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0 0 14px' }} />
              <div className="welcome-feat-grid">
                <div className="welcome-feat">
                  <span className="welcome-feat-label">My Recipes</span>
                  <p className="welcome-feat-desc">Import, organise, and cost your recipes.</p>
                </div>
                <div className="welcome-feat">
                  <span className="welcome-feat-label">My Pantry</span>
                  <p className="welcome-feat-desc">Your ingredient prices, updated from Checkers.</p>
                </div>
                <div className="welcome-feat">
                  <span className="welcome-feat-label">Costing</span>
                  <p className="welcome-feat-desc">Cost per serving, selling price, markup — all live.</p>
                </div>
                <div className="welcome-feat">
                  <span className="welcome-feat-label">Smart Matching</span>
                  <p className="welcome-feat-desc">Recognises ingredient names for you, no typing needed.</p>
                </div>
              </div>
            </div>
          </div>

          {/* SPINE */}
          <div className="welcome-spine" aria-hidden="true" />

          {/* RIGHT PAGE — How it works */}
          <div className="welcome-page right">
            <div className="panel-header">
              <div className="panel-heading-row">
                <p className="panel-heading">How it works</p>
                <button className="ctrl-btn modal-close-x" onClick={onClose} aria-label="Close welcome">✕</button>
              </div>
            </div>
            <div className="welcome-body">
              <p className="welcome-section-title">Getting started</p>

              <div className="welcome-step">
                <span className="welcome-step-num">1</span>
                <p className="welcome-step-text">
                  <strong>Import a recipe</strong> — paste text or drop a file (PDF, Word, or plain text) into the import bar. The app parses it automatically.
                </p>
              </div>

              <div className="welcome-step">
                <span className="welcome-step-num">2</span>
                <p className="welcome-step-text">
                  <strong>Review the matches</strong> — ingredients are matched against your pantry. Fix any that didn't match by typing a name or adding a new ingredient.
                </p>
              </div>

              <div className="welcome-step">
                <span className="welcome-step-num">3</span>
                <p className="welcome-step-text">
                  <strong>Update prices</strong> — select ingredients in My Pantry and search Checkers Sixty60 for current prices. Prices older than 7 days are flagged.
                </p>
              </div>

              <div className="welcome-step">
                <span className="welcome-step-num">4</span>
                <p className="welcome-step-text">
                  <strong>Open Costing</strong> — adjust servings and markup to see your cost per serving and suggested selling price.
                </p>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />

              <p className="welcome-section-title">Ingredient status dots</p>

              <div className="welcome-legend-box">
                <div className="welcome-legend-row">
                  <span className="status-dot green" />
                  <span className="welcome-legend-text">
                    <strong>Green</strong> — price is set and up to date. Ready to cost.
                  </span>
                </div>
                <div className="welcome-legend-row">
                  <span className="status-dot amber" />
                  <span className="welcome-legend-text">
                    <strong>Amber</strong> — price exists but may be outdated or needs review. Costing is estimated.
                  </span>
                </div>
                <div className="welcome-legend-row">
                  <span className="status-dot red" />
                  <span className="welcome-legend-text">
                    <strong>Red</strong> — no price information. This ingredient cannot be costed until a price is added.
                  </span>
                </div>
              </div>

              <p className="welcome-note">
                Recipe totals reflect the current dot status — amber and red ingredients will show a partial or missing cost until prices are set.
              </p>
            </div>
          </div>

        </div>
        <div className="welcome-page-stack" aria-hidden="true" />
      </div>
    </div>
  )
}
