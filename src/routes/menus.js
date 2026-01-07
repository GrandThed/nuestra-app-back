const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { success, created, error, forbidden, notFound, serverError, noContent } = require('../lib/response');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

/**
 * Check if user is member of household
 */
const isMember = (user, householdId) => {
  return user.householdMembers.some(m => m.householdId === householdId);
};

/**
 * GET /api/menus
 * List menu plans for a household
 */
router.get('/', async (req, res) => {
  try {
    const { householdId } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const menuPlans = await prisma.menuPlan.findMany({
      where: { householdId },
      include: {
        items: {
          select: { date: true },
          orderBy: { date: 'asc' }
        },
        _count: {
          select: { items: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return success(res, {
      menuPlans: menuPlans.map(plan => {
        const dates = plan.items.map(i => i.date);
        return {
          id: plan.id,
          name: plan.name,
          itemCount: plan._count.items,
          dateRange: dates.length > 0 ? {
            from: dates[0],
            to: dates[dates.length - 1]
          } : null,
          createdAt: plan.createdAt
        };
      })
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/menus
 * Create a new menu plan
 */
router.post('/', async (req, res) => {
  try {
    const { householdId, name } = req.body;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const menuPlan = await prisma.menuPlan.create({
      data: {
        householdId,
        name: name || null
      }
    });

    return created(res, {
      menuPlan: {
        id: menuPlan.id,
        name: menuPlan.name,
        items: [],
        createdAt: menuPlan.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * GET /api/menus/upcoming
 * Get all menu items for a date range (default: next 7 days)
 * NOTE: This route MUST be defined before /:id routes
 */
router.get('/upcoming', async (req, res) => {
  try {
    const { householdId, from, to } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Default: today to 7 days from now
    const fromDate = from ? new Date(from) : new Date();
    fromDate.setHours(0, 0, 0, 0);

    const toDate = to ? new Date(to) : new Date(fromDate);
    if (!to) {
      toDate.setDate(toDate.getDate() + 7);
    }
    toDate.setHours(23, 59, 59, 999);

    const menuItems = await prisma.menuItem.findMany({
      where: {
        menuPlan: { householdId },
        date: {
          gte: fromDate,
          lte: toDate
        }
      },
      include: {
        recipe: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            servings: true,
            ingredients: true
          }
        },
        menuPlan: {
          select: { id: true, name: true }
        }
      },
      orderBy: [{ date: 'asc' }, { mealType: 'asc' }]
    });

    return success(res, {
      from: fromDate,
      to: toDate,
      items: menuItems.map(item => ({
        id: item.id,
        date: item.date,
        mealType: item.mealType,
        substitutions: item.substitutions,
        recipe: item.recipe,
        menuPlan: item.menuPlan,
        createdAt: item.createdAt
      }))
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * GET /api/menus/:id
 * Get menu plan with items
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const menuPlan = await prisma.menuPlan.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            recipe: {
              select: {
                id: true,
                title: true,
                imageUrl: true,
                servings: true,
                ingredients: true
              }
            }
          },
          orderBy: [{ date: 'asc' }, { mealType: 'asc' }]
        }
      }
    });

    if (!menuPlan) {
      return notFound(res, 'Menu plan not found');
    }

    if (!isMember(req.user, menuPlan.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    return success(res, {
      menuPlan: {
        id: menuPlan.id,
        name: menuPlan.name,
        items: menuPlan.items.map(item => ({
          id: item.id,
          date: item.date,
          mealType: item.mealType,
          substitutions: item.substitutions,
          recipe: item.recipe,
          createdAt: item.createdAt
        })),
        createdAt: menuPlan.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/menus/:id
 * Delete a menu plan
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const menuPlan = await prisma.menuPlan.findUnique({
      where: { id }
    });

    if (!menuPlan) {
      return notFound(res, 'Menu plan not found');
    }

    if (!isMember(req.user, menuPlan.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    await prisma.menuPlan.delete({
      where: { id }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/menus/:id/items
 * Add a recipe to the menu plan
 */
router.post('/:id/items', async (req, res) => {
  try {
    const { id } = req.params;
    const { recipeId, date, mealType } = req.body;

    if (!recipeId || !date || !mealType) {
      return error(res, 'recipeId, date, and mealType are required');
    }

    const validMealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
    if (!validMealTypes.includes(mealType)) {
      return error(res, `mealType must be one of: ${validMealTypes.join(', ')}`);
    }

    const menuPlan = await prisma.menuPlan.findUnique({
      where: { id }
    });

    if (!menuPlan) {
      return notFound(res, 'Menu plan not found');
    }

    if (!isMember(req.user, menuPlan.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Verify recipe exists and belongs to household
    const recipe = await prisma.recipe.findUnique({
      where: { id: recipeId }
    });

    if (!recipe) {
      return notFound(res, 'Recipe not found');
    }

    if (recipe.householdId !== menuPlan.householdId) {
      return forbidden(res, 'Recipe does not belong to this household');
    }

    // Get substitutions from request body (optional)
    const { substitutions } = req.body;

    const menuItem = await prisma.menuItem.create({
      data: {
        menuPlanId: id,
        recipeId,
        date: new Date(date),
        mealType,
        substitutions: substitutions || null
      },
      include: {
        recipe: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            servings: true,
            ingredients: true
          }
        }
      }
    });

    return created(res, {
      item: {
        id: menuItem.id,
        date: menuItem.date,
        mealType: menuItem.mealType,
        substitutions: menuItem.substitutions,
        recipe: menuItem.recipe,
        createdAt: menuItem.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * PATCH /api/menus/:id/items/:itemId
 * Update a menu item (move to different date/meal)
 */
router.patch('/:id/items/:itemId', async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { date, mealType, recipeId, substitutions } = req.body;

    const menuPlan = await prisma.menuPlan.findUnique({
      where: { id }
    });

    if (!menuPlan) {
      return notFound(res, 'Menu plan not found');
    }

    if (!isMember(req.user, menuPlan.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const menuItem = await prisma.menuItem.findUnique({
      where: { id: itemId }
    });

    if (!menuItem || menuItem.menuPlanId !== id) {
      return notFound(res, 'Menu item not found');
    }

    const updateData = {};

    if (date !== undefined) {
      updateData.date = new Date(date);
    }

    if (mealType !== undefined) {
      const validMealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
      if (!validMealTypes.includes(mealType)) {
        return error(res, `mealType must be one of: ${validMealTypes.join(', ')}`);
      }
      updateData.mealType = mealType;
    }

    if (recipeId !== undefined) {
      const recipe = await prisma.recipe.findUnique({
        where: { id: recipeId }
      });

      if (!recipe) {
        return notFound(res, 'Recipe not found');
      }

      if (recipe.householdId !== menuPlan.householdId) {
        return forbidden(res, 'Recipe does not belong to this household');
      }

      updateData.recipeId = recipeId;
    }

    // Handle substitutions update (can set to null to clear)
    if (substitutions !== undefined) {
      updateData.substitutions = substitutions;
    }

    const updated = await prisma.menuItem.update({
      where: { id: itemId },
      data: updateData,
      include: {
        recipe: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            servings: true,
            ingredients: true
          }
        }
      }
    });

    return success(res, {
      item: {
        id: updated.id,
        date: updated.date,
        mealType: updated.mealType,
        substitutions: updated.substitutions,
        recipe: updated.recipe,
        createdAt: updated.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/menus/:id/items/:itemId
 * Remove a recipe from the menu plan
 */
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const { id, itemId } = req.params;

    const menuPlan = await prisma.menuPlan.findUnique({
      where: { id }
    });

    if (!menuPlan) {
      return notFound(res, 'Menu plan not found');
    }

    if (!isMember(req.user, menuPlan.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const menuItem = await prisma.menuItem.findUnique({
      where: { id: itemId }
    });

    if (!menuItem || menuItem.menuPlanId !== id) {
      return notFound(res, 'Menu item not found');
    }

    await prisma.menuItem.delete({
      where: { id: itemId }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/menus/:id/generate-shopping
 * Generate shopping list from menu plan and create wishlist items
 * Creates a "Supermarket" category with the menu name and adds all ingredients
 */
router.post('/:id/generate-shopping', async (req, res) => {
  try {
    const { id } = req.params;
    const { servingsMultiplier = 1 } = req.body;

    const menuPlan = await prisma.menuPlan.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            recipe: {
              select: {
                id: true,
                title: true,
                servings: true,
                ingredients: true
              }
            }
          },
          orderBy: { date: 'asc' }
        }
      }
    });

    if (!menuPlan) {
      return notFound(res, 'Menu plan not found');
    }

    if (!isMember(req.user, menuPlan.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Aggregate ingredients from all recipes (with substitutions applied)
    const ingredientMap = new Map();

    for (const item of menuPlan.items) {
      const recipe = item.recipe;
      if (!recipe || !Array.isArray(recipe.ingredients)) continue;

      const subs = item.substitutions || {};

      for (const ing of recipe.ingredients) {
        // Check if this ingredient has been substituted
        let finalIng = ing;
        if (subs[ing.name]) {
          // Use the substituted ingredient
          finalIng = {
            name: subs[ing.name].name || subs[ing.name],
            quantity: subs[ing.name].quantity ?? ing.quantity,
            unit: subs[ing.name].unit ?? ing.unit
          };
        }

        const key = `${finalIng.name?.toLowerCase()}-${finalIng.unit?.toLowerCase() || ''}`;

        if (ingredientMap.has(key)) {
          const existing = ingredientMap.get(key);
          existing.quantity += (finalIng.quantity || 0) * servingsMultiplier;
          existing.recipes.push(recipe.title);
        } else {
          ingredientMap.set(key, {
            name: finalIng.name,
            quantity: (finalIng.quantity || 0) * servingsMultiplier,
            unit: finalIng.unit || '',
            recipes: [recipe.title]
          });
        }
      }
    }

    const shoppingList = Array.from(ingredientMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    // Get date range from items
    const dates = menuPlan.items.map(i => i.date).sort((a, b) => a - b);

    // Create or get "Supermarket" category
    const categoryName = menuPlan.name
      ? `Supermarket - ${menuPlan.name}`
      : 'Supermarket';

    let category = await prisma.wishlistCategory.findUnique({
      where: {
        householdId_name: {
          householdId: menuPlan.householdId,
          name: categoryName
        }
      }
    });

    if (!category) {
      category = await prisma.wishlistCategory.create({
        data: {
          householdId: menuPlan.householdId,
          name: categoryName,
          type: 'system',
          sortOrder: -1 // System categories sort first
        }
      });
    }

    // Create wishlist items for each ingredient
    if (shoppingList.length > 0) {
      await prisma.wishlistItem.createMany({
        data: shoppingList.map(item => ({
          householdId: menuPlan.householdId,
          categoryId: category.id,
          name: item.name,
          quantity: item.quantity || null,
          unit: item.unit || null,
          ownerType: 'shared',
          checked: false
        }))
      });
    }

    return created(res, {
      menuPlanId: menuPlan.id,
      menuName: menuPlan.name,
      dateRange: dates.length > 0 ? {
        from: dates[0],
        to: dates[dates.length - 1]
      } : null,
      servingsMultiplier,
      wishlistCategory: {
        id: category.id,
        name: category.name
      },
      itemsCreated: shoppingList.length,
      shoppingList
    });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
