const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { success, created, error, forbidden, notFound, serverError, noContent } = require('../lib/response');
const { authenticate } = require('../middleware/auth');
const { uploadImage, handleUploadError } = require('../middleware/upload');
const { uploadFile, deleteFile, getSignedDownloadUrl } = require('../services/storage');
const { logActivity } = require('../services/activityLogger');

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
 * Query params: householdId, search, inSeason, favorites, maxPrepTime, maxCookTime
 */
router.get('/', async (req, res) => {
  try {
    const { householdId, search, inSeason, favorites, maxPrepTime, maxCookTime } = req.query;

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

    // Filter by favorites for current user
    if (favorites === 'true') {
      where.favorites = {
        some: { userId: req.user.id }
      };
    }

    // Filter by prep time
    if (maxPrepTime) {
      where.prepTimeMinutes = { lte: parseInt(maxPrepTime, 10) };
    }

    // Filter by cook time
    if (maxCookTime) {
      where.cookTimeMinutes = { lte: parseInt(maxCookTime, 10) };
    }

    const recipes = await prisma.recipe.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, name: true, avatarUrl: true }
        },
        _count: {
          select: { menuItems: true }
        },
        ratings: {
          select: { rating: true }
        },
        favorites: {
          where: { userId: req.user.id },
          select: { id: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Refresh image URLs
    const recipesWithUrls = await Promise.all(
      recipes.map(async (recipe) => {
        const refreshed = await refreshImageUrl(recipe);

        // Calculate average rating
        const ratingsArr = refreshed.ratings || [];
        const averageRating = ratingsArr.length > 0
          ? ratingsArr.reduce((sum, r) => sum + r.rating, 0) / ratingsArr.length
          : null;

        return {
          id: refreshed.id,
          title: refreshed.title,
          imageUrl: refreshed.imageUrl,
          servings: refreshed.servings,
          prepTimeMinutes: refreshed.prepTimeMinutes,
          cookTimeMinutes: refreshed.cookTimeMinutes,
          ingredientCount: Array.isArray(refreshed.ingredients) ? refreshed.ingredients.length : 0,
          usedInMenus: refreshed._count.menuItems,
          averageRating,
          isFavorite: refreshed.favorites.length > 0,
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
    const { householdId, title, ingredients, instructions, servings, sourceUrl, prepTimeMinutes, cookTimeMinutes } = req.body;

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
        prepTimeMinutes: prepTimeMinutes != null ? parseInt(prepTimeMinutes, 10) : null,
        cookTimeMinutes: cookTimeMinutes != null ? parseInt(cookTimeMinutes, 10) : null,
        createdById: req.user.id
      },
      include: {
        createdBy: {
          select: { id: true, name: true, avatarUrl: true }
        }
      }
    });

    await logActivity({
      householdId,
      userId: req.user.id,
      action: 'created',
      entityType: 'recipe',
      entityId: recipe.id,
      metadata: { title: recipe.title }
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
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
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
 * POST /api/recipes/import-url
 * Import a recipe from a URL (placeholder - actual AI extraction uses n8n)
 * NOTE: This route MUST be defined before /:id routes
 */
router.post('/import-url', async (req, res) => {
  try {
    const { householdId, url } = req.body;

    if (!householdId || !url) {
      return error(res, 'householdId and url are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Basic URL validation
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return error(res, 'Invalid URL provided');
    }

    // Fetch the page to extract the title
    let pageTitle = parsedUrl.hostname;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'HouseholdHub/1.0' },
        signal: AbortSignal.timeout(10000)
      });
      const html = await response.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        pageTitle = titleMatch[1].trim();
      }
    } catch (e) {
      console.error('Failed to fetch URL for title extraction:', e.message);
      // Continue with hostname as title
    }

    // Create a placeholder recipe with the URL and extracted title
    const recipe = await prisma.recipe.create({
      data: {
        householdId,
        title: pageTitle,
        ingredients: [],
        instructions: [],
        sourceUrl: url,
        createdById: req.user.id
      },
      include: {
        createdBy: {
          select: { id: true, name: true, avatarUrl: true }
        }
      }
    });

    await logActivity({
      householdId,
      userId: req.user.id,
      action: 'created',
      entityType: 'recipe',
      entityId: recipe.id,
      metadata: { title: recipe.title, source: 'url_import' }
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
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        createdBy: recipe.createdBy,
        createdAt: recipe.createdAt
      },
      imported: false,
      message: 'Recipe placeholder created from URL. Full extraction requires n8n workflow.'
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
        },
        ratings: {
          include: {
            user: {
              select: { id: true, name: true, avatarUrl: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        favorites: {
          where: { userId: req.user.id },
          select: { id: true }
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

    // Format ratings for response
    const ratingsFormatted = refreshed.ratings.map(r => ({
      id: r.id,
      rating: r.rating,
      note: r.note,
      user: r.user,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    return success(res, {
      recipe: {
        id: refreshed.id,
        title: refreshed.title,
        ingredients: refreshed.ingredients,
        instructions: refreshed.instructions,
        imageUrl: refreshed.imageUrl,
        servings: refreshed.servings,
        sourceUrl: refreshed.sourceUrl,
        prepTimeMinutes: refreshed.prepTimeMinutes,
        cookTimeMinutes: refreshed.cookTimeMinutes,
        ratings: ratingsFormatted,
        isFavorite: refreshed.favorites.length > 0,
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
    const { title, ingredients, instructions, servings, sourceUrl, prepTimeMinutes, cookTimeMinutes } = req.body;

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
    if (prepTimeMinutes !== undefined) updateData.prepTimeMinutes = prepTimeMinutes != null ? parseInt(prepTimeMinutes, 10) : null;
    if (cookTimeMinutes !== undefined) updateData.cookTimeMinutes = cookTimeMinutes != null ? parseInt(cookTimeMinutes, 10) : null;

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

    await logActivity({
      householdId: recipe.householdId,
      userId: req.user.id,
      action: 'updated',
      entityType: 'recipe',
      entityId: recipe.id,
      metadata: { title: refreshed.title }
    });

    return success(res, {
      recipe: {
        id: refreshed.id,
        title: refreshed.title,
        ingredients: refreshed.ingredients,
        instructions: refreshed.instructions,
        imageUrl: refreshed.imageUrl,
        servings: refreshed.servings,
        sourceUrl: refreshed.sourceUrl,
        prepTimeMinutes: refreshed.prepTimeMinutes,
        cookTimeMinutes: refreshed.cookTimeMinutes,
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
 * POST /api/recipes/:id/rating
 * Create or update a rating for a recipe
 */
router.post('/:id/rating', async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, note } = req.body;

    if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      return error(res, 'rating is required and must be an integer between 1 and 5');
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

    const recipeRating = await prisma.recipeRating.upsert({
      where: {
        recipeId_userId: {
          recipeId: id,
          userId: req.user.id
        }
      },
      update: {
        rating,
        note: note !== undefined ? note : undefined
      },
      create: {
        recipeId: id,
        userId: req.user.id,
        rating,
        note: note || null
      },
      include: {
        user: {
          select: { id: true, name: true, avatarUrl: true }
        }
      }
    });

    await logActivity({
      householdId: recipe.householdId,
      userId: req.user.id,
      action: 'rated',
      entityType: 'recipe',
      entityId: id,
      metadata: { title: recipe.title, rating }
    });

    return success(res, {
      rating: {
        id: recipeRating.id,
        rating: recipeRating.rating,
        note: recipeRating.note,
        user: recipeRating.user,
        createdAt: recipeRating.createdAt,
        updatedAt: recipeRating.updatedAt
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * GET /api/recipes/:id/ratings
 * Get all ratings for a recipe
 */
router.get('/:id/ratings', async (req, res) => {
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

    const ratings = await prisma.recipeRating.findMany({
      where: { recipeId: id },
      include: {
        user: {
          select: { id: true, name: true, avatarUrl: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const averageRating = ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
      : null;

    return success(res, {
      ratings: ratings.map(r => ({
        id: r.id,
        rating: r.rating,
        note: r.note,
        user: r.user,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      })),
      averageRating,
      totalRatings: ratings.length
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/recipes/:id/favorite
 * Toggle favorite status for a recipe
 */
router.post('/:id/favorite', async (req, res) => {
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

    // Check if favorite already exists
    const existing = await prisma.recipeFavorite.findUnique({
      where: {
        recipeId_userId: {
          recipeId: id,
          userId: req.user.id
        }
      }
    });

    if (existing) {
      // Remove favorite
      await prisma.recipeFavorite.delete({
        where: { id: existing.id }
      });

      await logActivity({
        householdId: recipe.householdId,
        userId: req.user.id,
        action: 'favorited',
        entityType: 'recipe',
        entityId: id,
        metadata: { title: recipe.title, favorited: false }
      });

      return success(res, { isFavorite: false });
    } else {
      // Add favorite
      await prisma.recipeFavorite.create({
        data: {
          recipeId: id,
          userId: req.user.id
        }
      });

      await logActivity({
        householdId: recipe.householdId,
        userId: req.user.id,
        action: 'favorited',
        entityType: 'recipe',
        entityId: id,
        metadata: { title: recipe.title, favorited: true }
      });

      return success(res, { isFavorite: true });
    }
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

    await logActivity({
      householdId: recipe.householdId,
      userId: req.user.id,
      action: 'deleted',
      entityType: 'recipe',
      entityId: id,
      metadata: { title: recipe.title }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
