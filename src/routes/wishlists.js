const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { success, created, error, forbidden, notFound, serverError, noContent } = require('../lib/response');
const { authenticate } = require('../middleware/auth');
const { logActivity } = require('../services/activityLogger');

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
        description: cat.description,
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

    await prisma.wishlistItem.deleteMany({
      where: { categoryId: id }
    });

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
    const { householdId, categoryId, checked, ownerType } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const where = {
      householdId,
      archivedAt: null, // Only show non-archived items
      // Hide secret items from the user they're hidden from
      NOT: {
        AND: [
          { isSecret: true },
          { hiddenFromUserId: req.user.id }
        ]
      }
    };
    if (categoryId) where.categoryId = categoryId;
    if (ownerType) where.ownerType = ownerType;
    if (checked !== undefined) where.checked = checked === 'true';

    const { sortBy } = req.query;

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
        },
        votes: {
          select: { id: true, userId: true, priority: true }
        }
      },
      orderBy: [{ checked: 'asc' }, { createdAt: 'desc' }]
    });

    // Calculate average priority from votes
    let result = items.map(item => {
      const avgPriority = item.votes.length > 0
        ? item.votes.reduce((sum, v) => sum + v.priority, 0) / item.votes.length
        : 0;
      return {
        ...item,
        averagePriority: Math.round(avgPriority * 10) / 10,
        voteCount: item.votes.length,
        myVote: item.votes.find(v => v.userId === req.user.id) || null
      };
    });

    // Sort by votes if requested
    if (sortBy === 'votes') {
      result.sort((a, b) => b.averagePriority - a.averagePriority);
    }

    return success(res, { items: result });
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
      sourceRecipeId,
      isSecret = false,
      hiddenFromUserId
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
        sourceRecipeId,
        isSecret,
        hiddenFromUserId: isSecret ? hiddenFromUserId : null
      },
      include: {
        category: {
          select: { id: true, name: true }
        }
      }
    });

    logActivity({
      householdId,
      userId: req.user.id,
      action: 'created',
      entityType: 'wishlist',
      entityId: item.id,
      metadata: { name: item.name, categoryName: item.category?.name }
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
    const { householdId, categoryId, categoryName, items } = req.body;

    if (!householdId || !Array.isArray(items) || items.length === 0) {
      return error(res, 'householdId and items array are required');
    }

    if (!categoryId && !categoryName) {
      return error(res, 'categoryId or categoryName is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Resolve category by ID or name (auto-create if name doesn't exist)
    let category;
    if (categoryId) {
      category = await prisma.wishlistCategory.findUnique({
        where: { id: categoryId }
      });
      if (!category || category.householdId !== householdId) {
        return notFound(res, 'Category not found');
      }
    } else {
      category = await prisma.wishlistCategory.findFirst({
        where: {
          householdId,
          name: { equals: categoryName, mode: 'insensitive' }
        }
      });
      if (!category) {
        // Auto-create the category (e.g. shopping lists from menu planner)
        const maxOrder = await prisma.wishlistCategory.aggregate({
          where: { householdId },
          _max: { sortOrder: true }
        });
        category = await prisma.wishlistCategory.create({
          data: {
            householdId,
            name: categoryName,
            sortOrder: (maxOrder._max.sortOrder || 0) + 1
          }
        });
      }
    }

    const createdItems = await prisma.wishlistItem.createMany({
      data: items.map(item => ({
        householdId,
        categoryId: category.id,
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
 * DELETE /api/wishlists/clear-checked
 * Delete all checked items in a household (or category)
 * NOTE: must be registered before /:id or Express matches "clear-checked" as an id
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

    // Snapshot names before deleting so the bulk delete is auditable
    const items = await prisma.wishlistItem.findMany({
      where,
      select: { id: true, name: true }
    });

    const result = await prisma.wishlistItem.deleteMany({ where });

    logActivity({
      householdId,
      userId: req.user.id,
      action: 'deleted',
      entityType: 'wishlist',
      metadata: {
        type: 'clear_checked',
        categoryId: categoryId || null,
        deletedCount: result.count,
        itemNames: items.map(i => i.name)
      }
    });

    return success(res, { deletedCount: result.count });
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

    logActivity({
      householdId: item.householdId,
      userId: req.user.id,
      action: 'deleted',
      entityType: 'wishlist',
      entityId: id,
      metadata: {
        name: item.name,
        price: item.price ? parseFloat(item.price) : null,
        categoryId: item.categoryId
      }
    });

    return noContent(res);
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

// ==================== VOTING ====================

/**
 * POST /api/wishlists/:id/vote
 * Set priority vote for an item (upsert)
 * Body: { priority: 1-5 }
 */
router.post('/:id/vote', async (req, res) => {
  try {
    const { id } = req.params;
    const { priority } = req.body;

    if (!priority || priority < 1 || priority > 5) {
      return error(res, 'priority must be between 1 and 5');
    }

    const item = await prisma.wishlistItem.findUnique({
      where: { id }
    });

    if (!item) {
      return notFound(res, 'Item not found');
    }

    if (!isMember(req.user, item.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const vote = await prisma.wishlistVote.upsert({
      where: {
        wishlistItemId_userId: {
          wishlistItemId: id,
          userId: req.user.id
        }
      },
      update: { priority },
      create: {
        wishlistItemId: id,
        userId: req.user.id,
        priority
      }
    });

    logActivity({
      householdId: item.householdId,
      userId: req.user.id,
      action: 'voted',
      entityType: 'wishlist',
      entityId: id,
      metadata: { name: item.name, priority }
    });

    return success(res, { vote });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== PURCHASE HISTORY ====================

/**
 * GET /api/wishlists/history
 * Get purchase history (archived items)
 */
router.get('/history', async (req, res) => {
  try {
    const { householdId, limit = '50', offset = '0' } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const take = Math.min(parseInt(limit) || 50, 100);
    const skip = parseInt(offset) || 0;

    const [history, total] = await Promise.all([
      prisma.wishlistPurchaseHistory.findMany({
        where: { householdId },
        include: {
          purchasedBy: {
            select: { id: true, name: true, avatarUrl: true }
          }
        },
        orderBy: { purchasedAt: 'desc' },
        take,
        skip
      }),
      prisma.wishlistPurchaseHistory.count({ where: { householdId } })
    ]);

    return success(res, { history, total, limit: take, offset: skip });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/wishlists/:id/purchase
 * Mark item as purchased: archive it + optionally create expense
 * Body: { createExpense?: boolean, categoryId?: string, paidById?: string }
 */
router.post('/:id/purchase', async (req, res) => {
  try {
    const { id } = req.params;
    const { createExpense = false, categoryId, paidById } = req.body;

    const item = await prisma.wishlistItem.findUnique({
      where: { id }
    });

    if (!item) {
      return notFound(res, 'Item not found');
    }

    if (!isMember(req.user, item.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Archive the item
    await prisma.wishlistItem.update({
      where: { id },
      data: {
        checked: true,
        archivedAt: new Date()
      }
    });

    // Create purchase history entry
    const historyEntry = await prisma.wishlistPurchaseHistory.create({
      data: {
        householdId: item.householdId,
        name: item.name,
        price: item.price,
        purchasedById: req.user.id,
        originalItemId: item.id
      }
    });

    let expense = null;

    // Optionally create an expense
    if (createExpense && item.price) {
      // Import calculateSplits logic inline
      const members = await prisma.householdMember.findMany({
        where: { householdId: item.householdId }
      });

      const membersWithIncome = members.filter(m => m.income && parseFloat(m.income) > 0);
      let splits;

      if (membersWithIncome.length === 0) {
        const equalShare = parseFloat(item.price) / members.length;
        splits = members.map(m => ({ userId: m.userId, amount: equalShare }));
      } else {
        const totalIncome = membersWithIncome.reduce((sum, m) => sum + parseFloat(m.income), 0);
        splits = members.map(m => {
          const memberIncome = m.income ? parseFloat(m.income) : 0;
          const proportion = totalIncome > 0 ? memberIncome / totalIncome : 0;
          return { userId: m.userId, amount: parseFloat(item.price) * proportion };
        });
      }

      expense = await prisma.expense.create({
        data: {
          householdId: item.householdId,
          description: item.name,
          amount: item.price,
          currency: 'ARS',
          date: new Date(),
          categoryId: categoryId || null,
          paidById: paidById || req.user.id,
          linkedWishlistItemId: item.id,
          splits: {
            create: splits.map(s => ({
              userId: s.userId,
              amount: s.amount,
              settled: false
            }))
          }
        }
      });

      // Update history entry with expense link
      await prisma.wishlistPurchaseHistory.update({
        where: { id: historyEntry.id },
        data: { linkedExpenseId: expense.id }
      });
    }

    logActivity({
      householdId: item.householdId,
      userId: req.user.id,
      action: 'archived',
      entityType: 'wishlist',
      entityId: id,
      metadata: { name: item.name, price: item.price ? parseFloat(item.price) : null, expenseCreated: !!expense }
    });

    return success(res, {
      archived: true,
      historyEntry,
      expense: expense ? { id: expense.id } : null
    });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
