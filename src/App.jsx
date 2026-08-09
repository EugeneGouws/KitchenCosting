import { useState, useEffect, useRef, useMemo } from 'react'
import { refreshNeedsCosting } from './io/index.js'
import useAppState from './hooks/useAppState.js'
import ImportBar from './ui/ImportBar.jsx'
import MyPantry from './ui/MyPantry.jsx'
import MyRecipes from './ui/MyRecipes.jsx'
import WelcomeModal from './ui/modals/WelcomeModal.jsx'
import AddIngredientModal from './ui/modals/AddIngredientModal.jsx'
import PriceQueueModal from './ui/modals/PriceQueueModal.jsx'
import ImportRecipeModal from './ui/modals/ImportRecipeModal.jsx'
import CostingModal from './ui/modals/CostingModal.jsx'
import PricePushModal from './ui/modals/PricePushModal.jsx'
import XlsxImportQueue from './ui/XlsxImportQueue.jsx'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app-shell.css'
import './styles/book-layout.css'
import './styles/panel-shared.css'

export default function App() {
  const { pantry, recipes, pricePushSets, applyPricePush, finishPricePush, addRecipeToState, editRecipeInState, updateItemPrice, addIngredient, updateIngredient, toggleFavourite, deleteRecipe } = useAppState()

  const [pricingIds, setPricingIds]             = useState([])
  const [favFilterOn, setFavFilterOn]           = useState(false)
  const [collectionFilters, setCollectionFilters] = useState([])
  const [selectedRecipeId, setSelectedRecipeId] = useState(null)
  const [layoutMode, setLayoutMode]             = useState('wide')
  const [modalState, setModalState]             = useState({ open: false, type: null, context: null })
  const [showWelcome, setShowWelcome]           = useState(() => !localStorage.getItem('kitchen_welcomed'))
  const [pricePushStage,etPricePushStage]     = useState(null) // null | 'A' | 'B'

  const appRef = useRef(null)

  useEffect(() => { refreshNeedsCosting() }, [])

  useEffect(() => {
    if (pricePushStage !== null) return
    if (pricePushSets.setA.length) setPricePushStage('A')
    else if (pricePushSets.setB.length) setPricePushStage('B')
  }, [pricePushSets, pricePushStage])

  function advancePricePush() {
    if (pricePushStage === 'A' && pricePushSets.setB.length) {
      setPricePushStage('B')
    } else {
      finishPricePush()
      setPricePushStage(null)
    }
  }

  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => {
      setLayoutMode(entry.contentRect.width >= 660 ? 'wide' : 'narrow')
    })
    ro.observe(appRef.current)
    return () => ro.disconnect()
  }, [])

  const processingIds = new Set(pricingIds)

  function openPricingSession(newIds) {
    setPricingIds(prev => {
      if (prev.length === 0) return newIds
      const existing = new Set(prev)
      return [...prev, ...newIds.filter(id => !existing.has(id))]
    })
  }

  function closePricingSession() {
    setPricingIds([])
  }

  function dismissWelcome() {
    localStorage.setItem('kitchen_welcomed', '1')
    setShowWelcome(false)
  }

  const visibleRecipes = useMemo(() =>
    recipes.filter(r => {
      if (favFilterOn && !r.favorite) return false
      if (!collectionFilters.length) return true
      const tags = r.collection ? r.collection.split(',').map(t => t.trim()).filter(Boolean) : []
      return collectionFilters.some(f => tags.includes(f))
    }),
    [recipes, favFilterOn, collectionFilters]
  )

  const visiblePantryItems = useMemo(() => {
    const selected = selectedRecipeId ? recipes.find(r => r.id === selectedRecipeId) : null
    if (!selected) return []
    const ids = new Set(selected.ingredients.map(i => i.matchedIngredient).filter(Boolean))
    return pantry
      .filter(p => ids.has(p.id))
      .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
  }, [pantry, recipes, selectedRecipeId])

  const collections = useMemo(() =>
    [...new Set(
      recipes.flatMap(r => r.collection ? r.collection.split(',').map(t => t.trim()).filter(Boolean) : [])
    )].sort(),
    [recipes]
  )

  function openModal(type, context = null) {
    setModalState({ open: true, type, context })
  }

  function closeModal() {
    setModalState({ open: false, type: null, context: null })
  }

  function renderXlsxQueue() {
    if (!modalState.open || modalState.type !== 'xlsxQueue') return null
    return (
      <XlsxImportQueue
        sheets={modalState.context.sheets}
        filename={modalState.context.filename}
        pantry={pantry}
        collections={collections}
        onImport={recipe => addRecipeToState(recipe, {})}
        onAddIngredient={(ingredient, baseUnit) => addIngredient(ingredient, baseUnit)}
        onClose={closeModal}
      />
    )
  }

  function renderPopout() {
    if (!modalState.open) return null

    let sizeKey = null
    let content = null

    if (modalState.type === 'editIngredient') {
      sizeKey = 'ingredient'
      content = (
        <AddIngredientModal
          isOpen
          item={modalState.context}
          onAdd={({ name, baseUnit, pkgValue, pkgUnit, pkgPrice, pkgMatch, conversions, aliases }) => {
            if (modalState.context?.id) {
              updateIngredient(modalState.context.id, { name, baseUnit, pkgValue, pkgUnit, pkgPrice, pkgMatch, conversions, aliases, priceSource: 'user' })
            } else {
              addIngredient({ name, pkgValue, pkgUnit, pkgPrice, pkgMatch, conversions, aliases, priceSource: 'user' }, baseUnit)
            }
            closeModal()
          }}
          onClose={closeModal}
        />
      )
    } else if (modalState.type === 'import') {
      sizeKey = 'recipe'
      content = (
        <ImportRecipeModal
          isOpen
          recipe={modalState.context}
          pantry={pantry}
          collections={collections}
          onImport={recipe => { addRecipeToState(recipe, {}); closeModal() }}
          onAddIngredient={(ingredient, baseUnit) => addIngredient(ingredient, baseUnit)}
          onClose={closeModal}
        />
      )
    } else if (modalState.type === 'editRecipe') {
      sizeKey = 'recipe'
      content = (
        <ImportRecipeModal
          isOpen
          mode="edit"
          recipe={modalState.context}
          pantry={pantry}
          collections={collections}
          onSave={recipe => { editRecipeInState(recipe.id, recipe); closeModal() }}
          onAddIngredient={(ingredient, baseUnit) => addIngredient(ingredient, baseUnit)}
          onClose={closeModal}
        />
      )
    } else if (modalState.type === 'openCosting') {
      sizeKey = 'costing'
      content = (
        <CostingModal
          recipe={modalState.context}
          pantry={pantry}
          layoutMode={layoutMode}
          onSearchPrices={openPricingSession}
          onClose={closeModal}
        />
      )
    }

    if (!content) return null

    return (
      <div className="modal-popout-overlay">
        <div className={`modal-popout-box size-${sizeKey}${layoutMode === 'narrow' ? ' narrow' : ''}`}>
          {content}
        </div>
      </div>
    )
  }

  const pantryPanel = (
    <MyPantry
      items={visiblePantryItems}
      processingIds={processingIds}
      onEditIngredient={item => openModal('editIngredient', item)}
      onSearchPrices={openPricingSession}
    />
  )

  const recipesPanel = (
    <MyRecipes
      recipes={visibleRecipes}
      collections={collections}
      pantry={pantry}
      expandedId={selectedRecipeId}
      onExpandRecipe={setSelectedRecipeId}
      onToggleFavourite={toggleFavourite}
      onOpenCosting={recipe => openModal('openCosting', recipe)}
      onEditRecipe={recipe => openModal('editRecipe', recipe)}
      onDeleteRecipe={deleteRecipe}
      onSaveRecipeTags={(id, tags) => editRecipeInState(id, { collection: tags.join(',') })}
      onFavFilterChange={setFavFilterOn}
      onCollectionChange={setCollectionFilters}
    />
  )

  return (
    <div className={`nkc-app${layoutMode === 'narrow' ? ' narrow' : ''}`} ref={appRef}>

      <header className="app-header nkc-card">
        <span className="app-title">Kitchen Costings</span>
        <button className="ctrl-btn" onClick={() => setShowWelcome(true)}>Info</button>
      </header>

      {layoutMode === 'wide' ? (
        <div className="book-wrap">
          <div className="nkc-panels">
            {recipesPanel}
            <div className="book-spine" aria-hidden="true" />
            {pantryPanel}
            {renderXlsxQueue()}
            <svg
              aria-hidden="true"
              style={{ position:'absolute', top:0, left:'50%', transform:'translateX(-50%)', pointerEvents:'none', zIndex:51 }}
              width="25" height="5" viewBox="0 0 25 5"
            >
              <path d="M0,0 C4,0 9,3.5 12.5,5 C16,3.5 21,0 25,0 Z" fill="#7B5C3A" />
            </svg>
            <svg
              aria-hidden="true"
              style={{ position:'absolute', bottom:0, left:'50%', transform:'translateX(-50%)', pointerEvents:'none', zIndex:51 }}
              width="25" height="5" viewBox="0 0 25 5"
            >
              <defs>
                <linearGradient id="spine-bottom-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(0,0,0,0.01)" />
                  <stop offset="100%" stopColor="rgba(0,0,0,0.14)" />
                </linearGradient>
              </defs>
              <path d="M0,0 C4,0 9,3.5 12.5,5 C16,3.5 21,0 25,0 Z" fill="url(#spine-bottom-grad)" />
            </svg>
          </div>
          <div className="book-page-stack" aria-hidden="true">
            <svg
              aria-hidden="true"
              style={{ position:'absolute', top:0, left:'50%', transform:'translateX(-50%)', pointerEvents:'none', zIndex:3 }}
              width="25" height="10" viewBox="0 0 25 10"
            >
              <path d="M0,0 L25,0 L25,2 C19,2 15,4 12.5,4 C10,4 6,2 0,2 Z" fill="#f8f4ed"/>
              <path d="M0,2 C6,2 10,4 12.5,4 C15,4 19,2 25,2 L25,3 C19,3 15,4.8 12.5,4.8 C10,4.8 6,3 0,3 Z" fill="#cfc8b8"/>
              <path d="M0,3 C6,3 10,4.8 12.5,4.8 C15,4.8 19,3 25,3 L25,5 C19,5 15,6.3 12.5,6.3 C10,6.3 6,5 0,5 Z" fill="#f0ebe0"/>
              <path d="M0,5 C6,5 10,6.3 12.5,6.3 C15,6.3 19,5 25,5 L25,6 C19,6 15,7 12.5,7 C10,7 6,6 0,6 Z" fill="#c8c0ae"/>
              <path d="M0,6 C6,6 10,7 12.5,7 C15,7 19,6 25,6 L25,8 C19,8 15,8.5 12.5,8.5 C10,8.5 6,8 0,8 Z" fill="#e8e2d5"/>
              <path d="M0,8 C6,8 10,8.5 12.5,8.5 C15,8.5 19,8 25,8 L25,9 C19,9 15,9.2 12.5,9.2 C10,9.2 6,9 0,9 Z" fill="#c0b8a6"/>
              <path d="M0,9 L25,9 L25,10 L0,10 Z" fill="#e0dace"/>
            </svg>
          </div>
        </div>
      ) : (
        <div className="book-wrap">
          <div className="narrow-stack">
            {recipesPanel}
            {pantryPanel}
            {renderXlsxQueue()}
          </div>
        </div>
      )}

      {/* Rendered at the app root, not inside .book-wrap — as a child of the book it
          inherited the panel height and its content had to scroll. */}
      {showWelcome && <WelcomeModal onClose={dismissWelcome} />}

      {renderPopout()}

      {pricingIds.length > 0 && (
        <PriceQueueModal
          sessionIds={pricingIds}
          pantry={pantry}
          onSave={(id, data) => updateItemPrice(id, data)}
          onComplete={id => setPricingIds(prev => prev.filter(x => x !== id))}
          onClose={closePricingSession}
        />
      )}

      {pricePushStage && (
        <div className="modal-popout-overlay">
          <div className={`modal-popout-box size-pricePush${layoutMode === 'narrow' ? ' narrow' : ''}`}>
            <PricePushModal
              variant={pricePushStage === 'A' ? 'routine' : 'manual'}
              rows={pricePushStage === 'A' ? pricePushSets.setA : pricePushSets.setB}
              onApply={rows => { applyPricePush(rows); advancePricePush() }}
              onSkip={advancePricePush}
            />
          </div>
        </div>
      )}

      <ImportBar
        pantry={pantry}
        onImport={recipe => openModal('import', recipe)}
        onXlsxSheets={(sheets, filename) => openModal('xlsxQueue', { sheets, filename })}
      />

    </div>
  )
}
