import { useState, useEffect } from 'react'
import { readPantry, readRecipes, saveRecipes, savePantryItem, saveRecipe, toggleRecipeFavourite, deleteRecipe as _deleteRecipe, migratePantryIfNeeded, syncPricesFromServer } from '../io/index.js'
import { importFinished, resolveIngredients } from '../lib/index.js'

export default function useAppState() {
  const [pantry, setPantry] = useState([])
  const [recipes, setRecipes] = useState([])

  useEffect(() => {
    migratePantryIfNeeded()
    const loadedPantry   = readPantry()
    const loadedRecipes  = readRecipes()

    // Defensive: any stored recipes lacking matchedIngredient/convertedAmount get matched once
    // and persisted so this fixup never reruns. Seed data is pre-resolved and won't trigger this.
    const needsFixup = loadedRecipes.some(r =>
      r.ingredients?.some(i => i.convertedAmount === undefined)
    )
    if (needsFixup) {
      const fixed = loadedRecipes.map(r => ({
        ...r,
        ingredients: resolveIngredients(r.ingredients ?? [], loadedPantry),
      }))
      saveRecipes(fixed)
      setPantry(loadedPantry)
      setRecipes(fixed)
    } else {
      setPantry(loadedPantry)
      setRecipes(loadedRecipes)
    }

    syncPricesFromServer(loadedRecipes).then(() => setPantry(readPantry()))
  }, [])

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

  return { pantry, recipes, addRecipeToState, editRecipeInState, updateItemPrice, addIngredient, updateIngredient, toggleFavourite, deleteRecipe }
}
