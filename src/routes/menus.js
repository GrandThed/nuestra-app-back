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
 * Get start of week (Monday) for a given date
 */
const getWeekStart = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * GET /api/menus
 * List menu plans for a household
 */
router.get('/', async (req, res) => {
  try {
    const { householdId, from, to } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const where = { householdId };

    // Optional date range filter
    if (from || to) {
      where.weekStartDate = {};
      if (from) where.weekStartDate.gte = new Date(from);
      if (to) where.weekStartDate.lte = new Date(to);
    }

    const menuPlans = await prisma.menuPlan.findMany({
      where,
      include: {
        _count: {
          select: { items: true }
        }
      },
      orderBy: { weekStartDate: 'desc' }
    });

    return success(res, {
      menuPlans: menuPlans.map(plan => ({
        id: plan.id,
        weekStartDate: plan.weekStartDate,
        itemCount: plan._count.items,
        createdAt: plan.createdAt
      }))
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/menus
 * Create a new menu plan for a week
 */
router.post('/', async (req, res) => {
  try {
    const { householdId, weekStartDate } = req.body;

    if (!householdId || !weekStartDate) {
      return error(res, 'householdId and weekStartDate are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Normalize to Monday of the week
    const normalizedWeekStart = getWeekStart(weekStartDate);

    // Check if plan already exists for this week
    const existing = await prisma.menuPlan.findFirst({
      where: {
        householdId,
        weekStartDate: normalizedWeekStart
      }
    });

    if (existing) {
      return error(res, 'A menu plan already exists for this week');
    }

    const menuPlan = await prisma.menuPlan.create({
      data: {
        householdId,
        weekStartDate: normalizedWeekStart
      }
    });

    return created(res, {
      menuPlan: {
        id: menuPlan.id,
        weekStartDate: menuPlan.weekStartDate,
        items: [],
        createdAt: menuPlan.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * GET /api/menus/current
 * Get or create the current week's menu plan
 * NOTE: This route MUST be defined before /:id routes
 */
router.get('/current', async (req, res) => {
  try {
    const { householdId } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const currentWeekStart = getWeekStart(new Date());

    let menuPlan = await prisma.menuPlan.findFirst({
      where: {
        householdId,
        weekStartDate: currentWeekStart
      },
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
          orderBy: [{ dayOfWeek: 'asc' }, { mealType: 'asc' }]
        }
      }
    });

    // Create if doesn't exist
    if (!menuPlan) {
      menuPlan = await prisma.menuPlan.create({
        data: {
          householdId,
          weekStartDate: currentWeekStart
        },
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
            }
          }
        }
      });
    }

    return success(res, {
      menuPlan: {
        id: menuPlan.id,
        weekStartDate: menuPlan.weekStartDate,
        items: menuPlan.items.map(item => ({
          id: item.id,
          dayOfWeek: item.dayOfWeek,
          mealType: item.mealType,
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
          orderBy: [{ dayOfWeek: 'asc' }, { mealType: 'asc' }]
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
        weekStartDate: menuPlan.weekStartDate,
        items: menuPlan.items.map(item => ({
          id: item.id,
          dayOfWeek: item.dayOfWeek,
          mealType: item.mealType,
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
    const { recipeId, dayOfWeek, mealType } = req.body;

    if (!recipeId || dayOfWeek === undefined || !mealType) {
      return error(res, 'recipeId, dayOfWeek, and mealType are required');
    }

    if (dayOfWeek < 0 || dayOfWeek > 6) {
      return error(res, 'dayOfWeek must be between 0 (Sunday) and 6 (Saturday)');
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

    const menuItem = await prisma.menuItem.create({
      data: {
        menuPlanId: id,
        recipeId,
        dayOfWeek,
        mealType
      },
      include: {
        recipe: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            servings: true
          }
        }
      }
    });

    return created(res, {
      item: {
        id: menuItem.id,
        dayOfWeek: menuItem.dayOfWeek,
        mealType: menuItem.mealType,
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
 * Update a menu item (move to different day/meal)
 */
router.patch('/:id/items/:itemId', async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { dayOfWeek, mealType, recipeId } = req.body;

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

    if (dayOfWeek !== undefined) {
      if (dayOfWeek < 0 || dayOfWeek > 6) {
        return error(res, 'dayOfWeek must be between 0 (Sunday) and 6 (Saturday)');
      }
      updateData.dayOfWeek = dayOfWeek;
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

    const updated = await prisma.menuItem.update({
      where: { id: itemId },
      data: updateData,
      include: {
        recipe: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            servings: true
          }
        }
      }
    });

    return success(res, {
      item: {
        id: updated.id,
        dayOfWeek: updated.dayOfWeek,
        mealType: updated.mealType,
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
 * Generate shopping list from menu plan ingredients
 * Aggregates ingredients from all recipes in the plan
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
          }
        }
      }
    });

    if (!menuPlan) {
      return notFound(res, 'Menu plan not found');
    }

    if (!isMember(req.user, menuPlan.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Aggregate ingredients from all recipes
    const ingredientMap = new Map();

    for (const item of menuPlan.items) {
      const recipe = item.recipe;
      if (!recipe || !Array.isArray(recipe.ingredients)) continue;

      for (const ing of recipe.ingredients) {
        const key = `${ing.name?.toLowerCase()}-${ing.unit?.toLowerCase() || ''}`;

        if (ingredientMap.has(key)) {
          const existing = ingredientMap.get(key);
          existing.quantity += (ing.quantity || 0) * servingsMultiplier;
          existing.recipes.push(recipe.title);
        } else {
          ingredientMap.set(key, {
            name: ing.name,
            quantity: (ing.quantity || 0) * servingsMultiplier,
            unit: ing.unit || '',
            recipes: [recipe.title]
          });
        }
      }
    }

    const shoppingList = Array.from(ingredientMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return success(res, {
      menuPlanId: menuPlan.id,
      weekStartDate: menuPlan.weekStartDate,
      servingsMultiplier,
      shoppingList
    });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
