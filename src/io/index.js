/**
 * io/ module — public exports for recipe and pantry persistence.
 *
 * Recipe management:
 *   - readRecipes() — get all stored recipes
 *   - saveRecipe(data) — upsert a recipe by id (creates if not found, merges if found)
 *   - saveRecipes(recipes) — bulk replace (migration only)
 *
 * Pantry management:
 *   - readPantry() — get the full pantry
 *   - savePantryItem(data) — upsert a pantry item by id/name (creates if not found, merges if found)
 *
 * (writeRecipes and writePantry are intentionally not exported — internal details.)
 */

export { readRecipes, saveRecipe, saveRecipes, toggleRecipeFavourite, deleteRecipe } from './recipeStore.js';
export { readPantry, savePantryItem, getPendingSubmissions, refreshNeedsCosting, migratePantryIfNeeded, syncPricesFromServer } from './pantryStore.js';
