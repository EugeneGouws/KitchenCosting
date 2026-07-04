import { useState, useMemo, useEffect, useRef } from 'react'
import { fetchPriceOptions } from '../../lib/pricer.js'
import './modal-base.css'
import './PriceQueueModal.css'

export default function PriceQueueModal({ sessionIds: initialIds, pantry, onSave, onComplete, onClose }) {
  const [sessionIds]  = useState(initialIds)
  const [cursor,      setCursor]      = useState(0)
  const [results,     setResults]     = useState([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [retryCount,  setRetryCount]  = useState(0)
  const [completions, setCompletions] = useState({}) // { [id]: 'done' | 'skipped' }
  const resultsRef = useRef(null)
  const cacheRef   = useRef({})

  const pantryMap = useMemo(() => {
    const m = new Map()
    if (pantry) pantry.forEach(p => m.set(p.id, p))
    return m
  }, [pantry])

  const currentId   = sessionIds[cursor]
  const allDone     = cursor >= sessionIds.length

  // Fetch prices whenever current item changes; serve from cache if available; prefetch next
  useEffect(() => {
    const item = pantryMap.get(currentId)
    if (!currentId || !item) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    if (retryCount === 0 && cacheRef.current[currentId]) {
      setResults(cacheRef.current[currentId])
      setLoading(false)
      setError(null)
      return
    }

    if (retryCount > 0) delete cacheRef.current[currentId]

    let cancelled = false
    setLoading(true)
    setError(null)
    setResults([])
    fetchPriceOptions(item)
      .then(options => {
        if (cancelled) return
        cacheRef.current[currentId] = options
        setResults(options)
        setLoading(false)
        setTimeout(() => resultsRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 50)

        const nextId   = sessionIds[cursor + 1]
        const nextItem = pantryMap.get(nextId)
        if (nextId && nextItem && !cacheRef.current[nextId]) {
          fetchPriceOptions(nextItem)
            .then(opts => { cacheRef.current[nextId] = opts })
            .catch(() => {})
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message || 'Failed to fetch prices')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [currentId, retryCount]) // eslint-disable-line react-hooks/exhaustive-deps

  function advance(id, status) {
    setCompletions(prev => ({ ...prev, [id]: status }))
    setCursor(c => c + 1)
    setResults([])
    setError(null)
    setRetryCount(0)
    onComplete?.(id)
  }

  function handleSkip() {
    advance(currentId, 'skipped')
  }

  function handleSelect(result) {
    const today    = new Date().toISOString().split('T')[0]
    const priceNum = parseFloat(String(result.product.price ?? '').replace(/[^0-9.]/g, ''))
    onSave?.(currentId, {
      costPerUnit:     result.costPerUnit,
      packageValue:    result.packageValue,
      packageUnit:     result.packageUnit,
      packagePrice:    isNaN(priceNum) ? null : priceNum,
      matchedProduct:  result.product.name ?? result.product.title ?? '',
      dateLastUpdated: today,
      priceSource:     'apify',
    })
    advance(currentId, 'done')
  }

  function rowStatus(id, index) {
    if (index > cursor)  return 'pending'
    if (index === cursor) return loading ? 'searching' : 'active'
    return completions[id] ?? 'done'
  }

  function rowIcon(status) {
    if (status === 'pending')   return '○'
    if (status === 'searching') return '⟳'
    if (status === 'active')    return '●'
    if (status === 'skipped')   return '→'
    return '✓'
  }

  const currentItem = pantryMap.get(currentId)

  return (
    <div className="price-queue-overlay">
      <div className="price-queue-modal">

        {/* LEFT: queue list */}
        <div className="price-queue-left">
          <div className="price-queue-col-head">Queue</div>
          <div className="price-queue-list">
            {sessionIds.map((id, i) => {
              const item   = pantryMap.get(id)
              const status = rowStatus(id, i)
              return (
                <div key={id} className={`price-queue-row pq-${status}`}>
                  <span className="price-queue-icon">{rowIcon(status)}</span>
                  <span className="price-queue-name">{item?.canonicalName ?? id}</span>
                </div>
              )
            })}
            {allDone && <p className="price-queue-all-done">All done!</p>}
          </div>
        </div>

        {/* MIDDLE: results */}
        <div className="price-queue-middle">
          {allDone ? (
            <div className="price-queue-state-msg">All ingredients have been reviewed.</div>
          ) : (
            <>
              <div className="price-queue-col-head">
                {currentItem?.canonicalName ?? currentId}
              </div>
              {loading ? (
                <div className="price-queue-state-msg">
                  <span className="status-dot dot-thinking" />
                  Searching Checkers…
                </div>
              ) : error ? (
                <div className="price-queue-error">
                  <p className="price-queue-error-msg">{error}</p>
                  <button className="ctrl-btn" onClick={() => setRetryCount(c => c + 1)}>Retry</button>
                </div>
              ) : results.length === 0 ? (
                <div className="price-queue-state-msg">No products found</div>
              ) : (
                <div className="price-queue-results" ref={resultsRef}>
                  {results.map((result, i) => {
                    const name     = result.product.name ?? result.product.title ?? '—'
                    const rawPrice = parseFloat(String(result.product.price ?? '').replace(/[^0-9.]/g, ''))
                    const pkg      = result.packageValue != null
                      ? `${result.packageValue}${result.packageUnit} @ R${isNaN(rawPrice) ? '?' : rawPrice.toFixed(2)}`
                      : '—'
                    return (
                      <div key={i} className="price-result-row">
                        <span className="price-result-name">{name}</span>
                        <span className="price-result-pkg">{pkg}</span>
                        <button className="ctrl-btn price-result-select" onClick={() => handleSelect(result)}>
                          Select
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT: controls */}
        <div className="price-queue-right">
          <button className="ctrl-btn modal-close-x" onClick={onClose} aria-label="Close">✕</button>
          {!allDone && (
            <button className="ctrl-btn" onClick={handleSkip}>Skip →</button>
          )}
          {sessionIds.length > 0 && (
            <span className="price-queue-progress">
              {Math.min(cursor + 1, sessionIds.length)} / {sessionIds.length}
            </span>
          )}
        </div>

      </div>
    </div>
  )
}
