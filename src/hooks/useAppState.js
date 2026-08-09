import { useState, useEffect } from 'react'
import { readPantry, readRecipes, saveRecipes, savePantryItem, saveRecipe, toggleRecipeFavourite, deleteRecipe as _deleteRecipe, migratePantryIfNeeded, computeStagedPriceChanges, markPricePromptSeen } from '../io/index.js'
import { importFinished, resolveIngredients, reconvertIngredients } from '../lib/index.js'
import { computeCostPerUnit } from '../lib/pricer.js'

export default function useAppState() {
  const [pantry, setPantry] = useState([])
  const [recipes, setRecipes] = useState([])
  const [pricePushSets, setPricePushSets] = useState({ setA: [], setB: [] })

  useEffect(() => {
    migratePantryIfNeeded()
    const loadedPantry   = readPantry()
    const loadedRecipes  = readRecipes()

    // Two defensive passes, both idempotent:
    //   resolveIngredients  — matches ingredients that were never run through the pipeline
    //   reconvertIngredients — re-applies unit conversion to already-matched rows, repairing
    //                          recipes stored before the importer converted (a "3 cup" row
    //                          saved as convertedAmount 3 against a per-gram price)
    // Only persisted when something actually changed, so this settles after one load.
    const fixed = loadedRecipes.map(r => ({
      ...r,
      ingredients: reconvertIngredients(
        resolveIngredients(r.ingredients ?? [], loadedPantry),
        loadedPantry,
      ),
    }))
    const changed = JSON.stringify(fixed) !== JSON.stringify(loadedRecipes)
    if (changed) saveRecipes(fixed)

    setPantry(loadedPantry)
    setRecipes(fixed)

    const usedIds = new Set(
      fixed.flatMap(r => (r.ingredients ?? []).map(i => i.matchedIngredient).filter(Boolean))
    )
    setPricePushSets(computeStagedPriceChanges(usedIds))
  }, [])

  function applyPricePush(rows) {
    const today = new Date().toISOString().split('T')[0]
    for (const row of rows) {
      savePantryItem({
        id:              row.id,
        packagePrice:    row.newPrice,
        packageValue:    row.newPackageValue,
        packageUnit:     row.newPackageUnit,
        matchedProduct:  row.newMatchedProduct,
        dateLastUpdated: today,
        priceSource:     'apify',
        costPerUnit:     computeCostPerUnit(row.newPrice, row.newPackageValue, row.newPackageUnit, row.baseUnit),
      })
    }
    setPantry(readPantry())
  }

  function finishPricePush() {
    markPricePromptSeen()
    setPricePushSets({ setA: [], setB: [] })
  }

  function addRecipeToState(recipe, opts) {
    importFinished(recipe, opts)
    setRecipes(readRecipes())
    setPantry(readPantry())
  }

  function updateItemPrice(itemId, data) {
    savePantryItem({ id: itemId, ...data })
    setPantry(readPantry())
  }

  function addIngredient(ingredient, baseUnit) {
    savePantryItem({ name: ingredient.name, baseUnit, ...ingredient })
    setPantry(readPantry())
  }

  function updateIngredient(itemId, data) {
    savePantryItem({ id: itemId, ...data })
    setPantry(readPantry())
  }

  function toggleFavourite(id) {
    toggleRecipeFavourite(id)
    setRecipes(readRecipes())
  }

  function editRecipeInState(id, updatedRecipe) {
    saveRecipe({ id, ...updatedRecipe })
    setRecipes(readRecipes())
  }

  function deleteRecipe(id) {
    _deleteRecipe(id)
    setRecipes(readRecipes())
  }

  return { pantry, recipes, pricePushSets, applyPricePush, finishPricePush, addRecipeToState, editRecipeInState, updateItemPrice, addIngredient, updateIngredient, toggleFavourite, deleteRecipe }
}
