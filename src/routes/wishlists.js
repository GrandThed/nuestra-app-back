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

// ==================== CATEGORIES ====================

/**
 * GET /api/wishlists/categories
 * List all wishlist categories for a household
 */
router.get('/categories', async (req, res) => {
  try {
    const { householdId } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const categories = await prisma.wishlistCategory.findMany({
      where: { householdId },
      include: {
        _count: {
          select: { items: true }
        }
      },
      orderBy: { sortOrder: 'asc' }
    });

    return success(res, {
      categories: categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        type: cat.type,
        sortOrder: cat.sortOrder,
        itemCount: cat._count.items
      }))
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/wishlists/categories
 * Create a new wishlist category
 */
router.post('/categories', async (req, res) => {
  try {
    const { householdId, name, sortOrder } = req.body;

    if (!householdId || !name) {
      return error(res, 'householdId and name are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Check if category with same name exists
    const existing = await prisma.wishlistCategory.findUnique({
      where: {
        householdId_name: { householdId, name }
      }
    });

    if (existing) {
      return error(res, 'A category with this name already exists');
    }

    const category = await prisma.wishlistCategory.create({
      data: {
        householdId,
        name,
        type: 'custom',
        sortOrder: sortOrder || 0
      }
    });

    return created(res, { category });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * PATCH /api/wishlists/categories/:id
 * Update a wishlist category
 */
router.patch('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sortOrder } = req.body;

    const category = await prisma.wishlistCategory.findUnique({
      where: { id }
    });

    if (!category) {
      return notFound(res, 'Category not found');
    }

    if (!isMember(req.user, category.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const updated = await prisma.wishlistCategory.update({
      where: { id },
      data: updateData
    });

    return success(res, { category: updated });
  } catch (err) {
    if (err.code === 'P2002') {
      return error(res, 'A category with this name already exists');
    }
    return serverError(res, err);
  }
});

/**
 * DELETE /api/wishlists/categories/:id
 * Delete a wishlist category (and all its items)
 */
router.delete('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.wishlistCategory.findUnique({
      where: { id }
    });

    if (!category) {
      return notFound(res, 'Category not found');
    }

    if (!isMember(req.user, category.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    await prisma.wishlistCategory.delete({
      where: { id }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== ITEMS ====================

/**
 * GET /api/wishlists
 * List wishlist items for a household
 */
router.get('/', async (req, res) => {
  try {
    const { householdId, categoryId, checked } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const where = { householdId };
    if (categoryId) where.categoryId = categoryId;
    if (checked !== undefined) where.checked = checked === 'true';

    const items = await prisma.wishlistItem.findMany({
      where,
      include: {
        category: {
          select: { id: true, name: true }
        },
        user: {
          select: { id: true, name: true }
        },
        sourceRecipe: {
          select: { id: true, title: true }
        }
      },
      orderBy: [{ checked: 'asc' }, { createdAt: 'desc' }]
    });

    return success(res, { items });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/wishlists
 * Create a wishlist item
 */
router.post('/', async (req, res) => {
  try {
    const {
      householdId,
      categoryId,
      name,
      ownerType = 'shared',
      userId,
      url,
      price,
      preferenceEmoji,
      quantity,
      unit,
      sourceRecipeId
    } = req.body;

    if (!householdId || !categoryId || !name) {
      return error(res, 'householdId, categoryId, and name are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Verify category belongs to household
    const category = await prisma.wishlistCategory.findUnique({
      where: { id: categoryId }
    });

    if (!category || category.householdId !== householdId) {
      return notFound(res, 'Category not found');
    }

    const item = await prisma.wishlistItem.create({
      data: {
        householdId,
        categoryId,
        name,
        ownerType,
        userId: ownerType === 'personal' ? (userId || req.user.id) : null,
        url,
        price,
        preferenceEmoji,
        quantity,
        unit,
        sourceRecipeId
      },
      include: {
        category: {
          select: { id: true, name: true }
        }
      }
    });

    return created(res, { item });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/wishlists/bulk
 * Create multiple wishlist items at once (for menu shopping list)
 */
router.post('/bulk', async (req, res) => {
  try {
    const { householdId, categoryId, items } = req.body;

    if (!householdId || !categoryId || !Array.isArray(items) || items.length === 0) {
      return error(res, 'householdId, categoryId, and items array are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Verify category belongs to household
    const category = await prisma.wishlistCategory.findUnique({
      where: { id: categoryId }
    });

    if (!category || category.householdId !== householdId) {
      return notFound(res, 'Category not found');
    }

    const createdItems = await prisma.wishlistItem.createMany({
      data: items.map(item => ({
        householdId,
        categoryId,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        ownerType: 'shared',
        sourceRecipeId: item.sourceRecipeId || null
      }))
    });

    return created(res, {
      count: createdItems.count,
      categoryId
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * PATCH /api/wishlists/:id
 * Update a wishlist item (toggle checked, edit details)
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, checked, quantity, unit, price, url, preferenceEmoji, categoryId } = req.body;

    const item = await prisma.wishlistItem.findUnique({
      where: { id }
    });

    if (!item) {
      return notFound(res, 'Item not found');
    }

    if (!isMember(req.user, item.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (checked !== undefined) updateData.checked = checked;
    if (quantity !== undefined) updateData.quantity = quantity;
    if (unit !== undefined) updateData.unit = unit;
    if (price !== undefined) updateData.price = price;
    if (url !== undefined) updateData.url = url;
    if (preferenceEmoji !== undefined) updateData.preferenceEmoji = preferenceEmoji;
    if (categoryId !== undefined) updateData.categoryId = categoryId;

    const updated = await prisma.wishlistItem.update({
      where: { id },
      data: updateData,
      include: {
        category: {
          select: { id: true, name: true }
        }
      }
    });

    return success(res, { item: updated });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/wishlists/:id
 * Delete a wishlist item
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const item = await prisma.wishlistItem.findUnique({
      where: { id }
    });

    if (!item) {
      return notFound(res, 'Item not found');
    }

    if (!isMember(req.user, item.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    await prisma.wishlistItem.delete({
      where: { id }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/wishlists/clear-checked
 * Delete all checked items in a household (or category)
 */
router.delete('/clear-checked', async (req, res) => {
  try {
    const { householdId, categoryId } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const where = { householdId, checked: true };
    if (categoryId) where.categoryId = categoryId;

    const result = await prisma.wishlistItem.deleteMany({ where });

    return success(res, { deletedCount: result.count });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * Helper: Get or create a category by name
 */
const getOrCreateCategory = async (householdId, name, type = 'system') => {
  let category = await prisma.wishlistCategory.findUnique({
    where: {
      householdId_name: { householdId, name }
    }
  });

  if (!category) {
    category = await prisma.wishlistCategory.create({
      data: {
        householdId,
        name,
        type,
        sortOrder: type === 'system' ? -1 : 0 // System categories sort first
      }
    });
  }

  return category;
};

// Export helper for use in menus route
router.getOrCreateCategory = getOrCreateCategory;

module.exports = router;
