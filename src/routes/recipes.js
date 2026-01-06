const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { success, created, error, forbidden, notFound, serverError, noContent } = require('../lib/response');
const { authenticate } = require('../middleware/auth');
const { uploadImage, handleUploadError } = require('../middleware/upload');
const { uploadFile, deleteFile, getSignedDownloadUrl } = require('../services/storage');

// All routes require authentication
router.use(authenticate);

/**
 * Check if user is member of household
 */
const isMember = (user, householdId) => {
  return user.householdMembers.some(m => m.householdId === householdId);
};

/**
 * Get current week of the year (1-52)
 */
const getCurrentWeek = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  const oneWeek = 1000 * 60 * 60 * 24 * 7;
  return Math.ceil(diff / oneWeek);
};

/**
 * Check if a week falls within a vegetable's season
 * Handles wrap-around (e.g., startWeek=48, endWeek=14)
 */
const isWeekInSeason = (week, startWeek, endWeek) => {
  if (startWeek <= endWeek) {
    // Normal range (e.g., weeks 24-40)
    return week >= startWeek && week <= endWeek;
  } else {
    // Wraps around year (e.g., weeks 48-14)
    return week >= startWeek || week <= endWeek;
  }
};

/**
 * Adjust week for hemisphere (Southern = +26 weeks, wrapping at 52)
 */
const adjustWeekForHemisphere = (week, hemisphere) => {
  if (hemisphere === 'south') {
    return ((week + 25) % 52) + 1; // Offset by 26 weeks
  }
  return week;
};

/**
 * Refresh signed URL for recipe image
 */
const refreshImageUrl = async (recipe) => {
  if (recipe.imageUrl) {
    return {
      ...recipe,
      imageUrl: await getSignedDownloadUrl(recipe.imageUrl, 7 * 24 * 60 * 60)
    };
  }
  return recipe;
};

/**
 * GET /api/recipes
 * List all recipes for a household
 */
router.get('/', async (req, res) => {
  try {
    const { householdId, search, inSeason } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const where = { householdId };

    // Search in title
    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }

    const recipes = await prisma.recipe.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, name: true, avatarUrl: true }
        },
        _count: {
          select: { menuItems: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Refresh image URLs
    const recipesWithUrls = await Promise.all(
      recipes.map(async (recipe) => {
        const refreshed = await refreshImageUrl(recipe);
        return {
          id: refreshed.id,
          title: refreshed.title,
          imageUrl: refreshed.imageUrl,
          servings: refreshed.servings,
          ingredientCount: Array.isArray(refreshed.ingredients) ? refreshed.ingredients.length : 0,
          usedInMenus: refreshed._count.menuItems,
          createdBy: refreshed.createdBy,
          createdAt: refreshed.createdAt
        };
      })
    );

    return success(res, { recipes: recipesWithUrls });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/recipes
 * Create a new recipe
 */
router.post('/', async (req, res) => {
  try {
    const { householdId, title, ingredients, instructions, servings, sourceUrl } = req.body;

    if (!householdId || !title) {
      return error(res, 'householdId and title are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const recipe = await prisma.recipe.create({
      data: {
        householdId,
        title: title.trim(),
        ingredients: ingredients || [],
        instructions: instructions || [],
        servings: servings || null,
        sourceUrl: sourceUrl || null,
        createdById: req.user.id
      },
      include: {
        createdBy: {
          select: { id: true, name: true, avatarUrl: true }
        }
      }
    });

    return created(res, {
      recipe: {
        id: recipe.id,
        title: recipe.title,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions,
        imageUrl: recipe.imageUrl,
        servings: recipe.servings,
        sourceUrl: recipe.sourceUrl,
        createdBy: recipe.createdBy,
        createdAt: recipe.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * GET /api/recipes/seasonal-vegetables
 * Get list of seasonal vegetables with current availability
 * NOTE: This route MUST be defined before /:id routes
 */
router.get('/seasonal-vegetables', async (req, res) => {
  try {
    const { householdId } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Get household hemisphere
    const household = await prisma.household.findUnique({
      where: { id: householdId },
      select: { hemisphere: true }
    });

    if (!household) {
      return notFound(res, 'Household not found');
    }

    const currentWeek = getCurrentWeek();
    const adjustedWeek = adjustWeekForHemisphere(currentWeek, household.hemisphere);

    const vegetables = await prisma.seasonalVegetable.findMany({
      orderBy: { name: 'asc' }
    });

    const vegsWithSeasonality = vegetables.map(veg => ({
      id: veg.id,
      name: veg.name,
      inSeason: isWeekInSeason(adjustedWeek, veg.startWeek, veg.endWeek),
      startWeek: veg.startWeek,
      endWeek: veg.endWeek
    }));

    return success(res, {
      currentWeek,
      hemisphere: household.hemisphere,
      vegetables: vegsWithSeasonality
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * GET /api/recipes/:id
 * Get recipe details
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const recipe = await prisma.recipe.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, name: true, avatarUrl: true }
        },
        household: {
          select: { hemisphere: true }
        }
      }
    });

    if (!recipe) {
      return notFound(res, 'Recipe not found');
    }

    if (!isMember(req.user, recipe.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Refresh image URL
    const refreshed = await refreshImageUrl(recipe);

    // Calculate seasonality based on ingredients
    const currentWeek = getCurrentWeek();
    const adjustedWeek = adjustWeekForHemisphere(currentWeek, recipe.household.hemisphere);

    // Get seasonal vegetables
    const seasonalVegs = await prisma.seasonalVegetable.findMany();

    // Check which ingredients are in season
    const ingredientSeasonality = [];
    if (Array.isArray(recipe.ingredients)) {
      for (const ing of recipe.ingredients) {
        const vegMatch = seasonalVegs.find(
          v => ing.name && v.name.toLowerCase() === ing.name.toLowerCase()
        );
        if (vegMatch) {
          ingredientSeasonality.push({
            name: ing.name,
            inSeason: isWeekInSeason(adjustedWeek, vegMatch.startWeek, vegMatch.endWeek)
          });
        }
      }
    }

    return success(res, {
      recipe: {
        id: refreshed.id,
        title: refreshed.title,
        ingredients: refreshed.ingredients,
        instructions: refreshed.instructions,
        imageUrl: refreshed.imageUrl,
        servings: refreshed.servings,
        sourceUrl: refreshed.sourceUrl,
        createdBy: refreshed.createdBy,
        createdAt: refreshed.createdAt,
        seasonality: {
          currentWeek,
          hemisphere: recipe.household.hemisphere,
          ingredients: ingredientSeasonality
        }
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * PATCH /api/recipes/:id
 * Update a recipe
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, ingredients, instructions, servings, sourceUrl } = req.body;

    const recipe = await prisma.recipe.findUnique({
      where: { id }
    });

    if (!recipe) {
      return notFound(res, 'Recipe not found');
    }

    if (!isMember(req.user, recipe.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (ingredients !== undefined) updateData.ingredients = ingredients;
    if (instructions !== undefined) updateData.instructions = instructions;
    if (servings !== undefined) updateData.servings = servings;
    if (sourceUrl !== undefined) updateData.sourceUrl = sourceUrl;

    const updated = await prisma.recipe.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: {
          select: { id: true, name: true, avatarUrl: true }
        }
      }
    });

    const refreshed = await refreshImageUrl(updated);

    return success(res, {
      recipe: {
        id: refreshed.id,
        title: refreshed.title,
        ingredients: refreshed.ingredients,
        instructions: refreshed.instructions,
        imageUrl: refreshed.imageUrl,
        servings: refreshed.servings,
        sourceUrl: refreshed.sourceUrl,
        createdBy: refreshed.createdBy,
        createdAt: refreshed.createdAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/recipes/:id/image
 * Upload recipe image
 */
router.post('/:id/image', uploadImage.single('image'), handleUploadError, async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return error(res, 'Image file is required');
    }

    const recipe = await prisma.recipe.findUnique({
      where: { id }
    });

    if (!recipe) {
      return notFound(res, 'Recipe not found');
    }

    if (!isMember(req.user, recipe.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Delete old image if exists
    if (recipe.imageUrl) {
      try {
        await deleteFile(recipe.imageUrl);
      } catch (e) {
        console.error('Failed to delete old image:', e);
      }
    }

    // Upload new image
    const uploadResult = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      `recipes/${recipe.householdId}`,
      req.file.mimetype
    );

    const updated = await prisma.recipe.update({
      where: { id },
      data: { imageUrl: uploadResult.key }
    });

    return success(res, {
      imageUrl: uploadResult.url
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/recipes/:id
 * Delete a recipe
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const recipe = await prisma.recipe.findUnique({
      where: { id }
    });

    if (!recipe) {
      return notFound(res, 'Recipe not found');
    }

    if (!isMember(req.user, recipe.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Delete image from storage if exists
    if (recipe.imageUrl) {
      try {
        await deleteFile(recipe.imageUrl);
      } catch (e) {
        console.error('Failed to delete image:', e);
      }
    }

    await prisma.recipe.delete({
      where: { id }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
