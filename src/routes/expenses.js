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
 * Calculate expense splits based on household members' income
 * If no income data, splits equally
 */
const calculateSplits = async (householdId, amount) => {
  const members = await prisma.householdMember.findMany({
    where: { householdId },
    include: {
      user: {
        select: { id: true, name: true }
      }
    }
  });

  if (members.length === 0) {
    return [];
  }

  // Check if any member has income set
  const membersWithIncome = members.filter(m => m.income && parseFloat(m.income) > 0);

  if (membersWithIncome.length === 0) {
    // Equal split if no income data
    const equalShare = parseFloat(amount) / members.length;
    return members.map(m => ({
      userId: m.userId,
      amount: equalShare
    }));
  }

  // Proportional split based on income
  const totalIncome = membersWithIncome.reduce((sum, m) => sum + parseFloat(m.income), 0);

  return members.map(m => {
    const memberIncome = m.income ? parseFloat(m.income) : 0;
    // If member has no income, they don't contribute
    const proportion = totalIncome > 0 ? memberIncome / totalIncome : 0;
    return {
      userId: m.userId,
      amount: parseFloat(amount) * proportion
    };
  });
};

// ==================== CATEGORIES ====================

/**
 * GET /api/expenses/categories
 * List expense categories for a household
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

    const categories = await prisma.expenseCategory.findMany({
      where: { householdId },
      include: {
        _count: {
          select: { expenses: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    return success(res, {
      categories: categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        icon: cat.icon,
        expenseCount: cat._count.expenses
      }))
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/expenses/categories
 * Create a new expense category
 */
router.post('/categories', async (req, res) => {
  try {
    const { householdId, name, icon } = req.body;

    if (!householdId || !name) {
      return error(res, 'householdId and name are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const category = await prisma.expenseCategory.create({
      data: {
        householdId,
        name,
        icon: icon || null
      }
    });

    return created(res, { category });
  } catch (err) {
    if (err.code === 'P2002') {
      return error(res, 'A category with this name already exists');
    }
    return serverError(res, err);
  }
});

/**
 * PATCH /api/expenses/categories/:id
 * Update an expense category
 */
router.patch('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon } = req.body;

    const category = await prisma.expenseCategory.findUnique({
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
    if (icon !== undefined) updateData.icon = icon;

    const updated = await prisma.expenseCategory.update({
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
 * DELETE /api/expenses/categories/:id
 * Delete an expense category (expenses keep null categoryId)
 */
router.delete('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.expenseCategory.findUnique({
      where: { id }
    });

    if (!category) {
      return notFound(res, 'Category not found');
    }

    if (!isMember(req.user, category.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Set expenses in this category to null categoryId
    await prisma.expense.updateMany({
      where: { categoryId: id },
      data: { categoryId: null }
    });

    await prisma.expenseCategory.delete({
      where: { id }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== SUMMARY (must be before /:id) ====================

/**
 * GET /api/expenses/summary
 * Get expense summary with balances
 */
router.get('/summary', async (req, res) => {
  try {
    const { householdId, month, year, settledOnly } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const where = { householdId };

    // Filter by month/year
    if (month && year) {
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
      where.date = {
        gte: startDate,
        lte: endDate
      };
    } else if (year) {
      const startDate = new Date(parseInt(year), 0, 1);
      const endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
      where.date = {
        gte: startDate,
        lte: endDate
      };
    }

    const expenses = await prisma.expense.findMany({
      where,
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        },
        paidBy: {
          select: { id: true, name: true }
        },
        splits: {
          include: {
            user: {
              select: { id: true, name: true }
            }
          }
        }
      }
    });

    // Filter by settled status if requested
    let filteredExpenses = expenses;
    if (settledOnly === 'true') {
      filteredExpenses = expenses.filter(e => e.splits.every(s => s.settled));
    } else if (settledOnly === 'false') {
      filteredExpenses = expenses.filter(e => !e.splits.every(s => s.settled));
    }

    // Calculate totals
    const totalAmount = filteredExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

    // Category breakdown
    const byCategory = {};
    for (const exp of filteredExpenses) {
      const catName = exp.category?.name || 'Uncategorized';
      if (!byCategory[catName]) {
        byCategory[catName] = { name: catName, icon: exp.category?.icon, total: 0, count: 0 };
      }
      byCategory[catName].total += parseFloat(exp.amount);
      byCategory[catName].count += 1;
    }

    // Member balances (what they paid vs what they owe)
    const memberBalances = {};
    for (const exp of filteredExpenses) {
      const payerId = exp.paidBy.id;

      // Initialize payer if not exists
      if (!memberBalances[payerId]) {
        memberBalances[payerId] = {
          userId: payerId,
          name: exp.paidBy.name,
          paid: 0,
          owes: 0
        };
      }
      memberBalances[payerId].paid += parseFloat(exp.amount);

      // Add what each member owes from splits
      for (const split of exp.splits) {
        if (!memberBalances[split.userId]) {
          memberBalances[split.userId] = {
            userId: split.userId,
            name: split.user.name,
            paid: 0,
            owes: 0
          };
        }
        // Only count unsettled amounts as owed
        if (!split.settled) {
          memberBalances[split.userId].owes += parseFloat(split.amount);
        }
      }
    }

    // Calculate net balance (positive = owed money, negative = owes money)
    const balances = Object.values(memberBalances).map(m => ({
      ...m,
      balance: m.paid - m.owes // positive means others owe them
    }));

    // Calculate settlements needed
    const settlements = [];
    const debtors = balances.filter(b => b.balance < 0).map(b => ({ ...b })).sort((a, b) => a.balance - b.balance);
    const creditors = balances.filter(b => b.balance > 0).map(b => ({ ...b })).sort((a, b) => b.balance - a.balance);

    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amount = Math.min(Math.abs(debtors[i].balance), creditors[j].balance);

      if (amount > 0.01) { // Ignore tiny amounts
        settlements.push({
          from: { id: debtors[i].userId, name: debtors[i].name },
          to: { id: creditors[j].userId, name: creditors[j].name },
          amount: Math.round(amount * 100) / 100
        });
      }

      debtors[i].balance += amount;
      creditors[j].balance -= amount;

      if (Math.abs(debtors[i].balance) < 0.01) i++;
      if (creditors[j].balance < 0.01) j++;
    }

    return success(res, {
      period: {
        month: month ? parseInt(month) : null,
        year: year ? parseInt(year) : null
      },
      totalAmount,
      expenseCount: filteredExpenses.length,
      byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
      memberBalances: balances,
      settlements
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/expenses/settle-period
 * Settle all unsettled expenses in a date range
 */
router.post('/settle-period', async (req, res) => {
  try {
    const { householdId, fromDate, toDate } = req.body;

    if (!householdId || !fromDate || !toDate) {
      return error(res, 'householdId, fromDate, and toDate are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Get all expenses in the period
    const expenses = await prisma.expense.findMany({
      where: {
        householdId,
        date: {
          gte: new Date(fromDate),
          lte: new Date(toDate)
        }
      },
      select: { id: true }
    });

    const expenseIds = expenses.map(e => e.id);

    // Settle all splits for these expenses
    const result = await prisma.expenseSplit.updateMany({
      where: {
        expenseId: { in: expenseIds },
        settled: false
      },
      data: { settled: true }
    });

    return success(res, {
      settledCount: result.count,
      expensesAffected: expenseIds.length,
      period: { from: fromDate, to: toDate }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== EXPENSES ====================

/**
 * GET /api/expenses
 * List expenses for a household with filters
 */
router.get('/', async (req, res) => {
  try {
    const { householdId, categoryId, paidById, month, year, settled } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const where = { householdId };
    if (categoryId) where.categoryId = categoryId;
    if (paidById) where.paidById = paidById;

    // Filter by month/year
    if (month && year) {
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
      where.date = {
        gte: startDate,
        lte: endDate
      };
    } else if (year) {
      const startDate = new Date(parseInt(year), 0, 1);
      const endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
      where.date = {
        gte: startDate,
        lte: endDate
      };
    }

    // Filter by settled status (all splits settled)
    let expenses = await prisma.expense.findMany({
      where,
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        },
        paidBy: {
          select: { id: true, name: true, avatarUrl: true }
        },
        splits: {
          include: {
            user: {
              select: { id: true, name: true }
            }
          }
        }
      },
      orderBy: { date: 'desc' }
    });

    // Filter by settled if requested
    if (settled !== undefined) {
      const isSettled = settled === 'true';
      expenses = expenses.filter(exp => {
        const allSettled = exp.splits.every(s => s.settled);
        return isSettled ? allSettled : !allSettled;
      });
    }

    return success(res, {
      expenses: expenses.map(exp => ({
        id: exp.id,
        householdId: exp.householdId,
        description: exp.description,
        amount: exp.amount,
        currency: exp.currency,
        date: exp.date,
        receiptUrl: exp.receiptUrl,
        category: exp.category,
        paidBy: exp.paidBy,
        splits: exp.splits.map(s => ({
          id: s.id,
          userId: s.userId,
          user: s.user,
          amount: s.amount,
          settled: s.settled
        })),
        allSettled: exp.splits.every(s => s.settled),
        createdAt: exp.createdAt
      }))
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/expenses
 * Create an expense with automatic splits
 */
router.post('/', async (req, res) => {
  try {
    const { householdId, description, amount, currency, date, categoryId, receiptUrl } = req.body;

    if (!householdId || !description || !amount || !date) {
      return error(res, 'householdId, description, amount, and date are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Verify category if provided
    if (categoryId) {
      const category = await prisma.expenseCategory.findUnique({
        where: { id: categoryId }
      });
      if (!category || category.householdId !== householdId) {
        return notFound(res, 'Category not found');
      }
    }

    // Calculate splits
    const splits = await calculateSplits(householdId, amount);

    // Create expense with splits
    const expense = await prisma.expense.create({
      data: {
        householdId,
        description,
        amount,
        currency: currency || 'ARS',
        date: new Date(date),
        categoryId: categoryId || null,
        receiptUrl: receiptUrl || null,
        paidById: req.user.id,
        splits: {
          create: splits.map(s => ({
            userId: s.userId,
            amount: s.amount,
            settled: false
          }))
        }
      },
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        },
        paidBy: {
          select: { id: true, name: true, avatarUrl: true }
        },
        splits: {
          include: {
            user: {
              select: { id: true, name: true }
            }
          }
        }
      }
    });

    return created(res, { expense });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== EXPENSE BY ID ====================

/**
 * GET /api/expenses/:id
 * Get expense with splits
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const expense = await prisma.expense.findUnique({
      where: { id },
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        },
        paidBy: {
          select: { id: true, name: true, avatarUrl: true }
        },
        splits: {
          include: {
            user: {
              select: { id: true, name: true }
            }
          }
        }
      }
    });

    if (!expense) {
      return notFound(res, 'Expense not found');
    }

    if (!isMember(req.user, expense.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    return success(res, {
      expense: {
        ...expense,
        allSettled: expense.splits.every(s => s.settled)
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * PATCH /api/expenses/:id
 * Update expense (recalculates splits if amount changes)
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { description, amount, currency, date, categoryId, receiptUrl } = req.body;

    const expense = await prisma.expense.findUnique({
      where: { id }
    });

    if (!expense) {
      return notFound(res, 'Expense not found');
    }

    if (!isMember(req.user, expense.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const updateData = {};
    if (description !== undefined) updateData.description = description;
    if (currency !== undefined) updateData.currency = currency;
    if (date !== undefined) updateData.date = new Date(date);
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (receiptUrl !== undefined) updateData.receiptUrl = receiptUrl;

    // If amount changes, recalculate splits
    if (amount !== undefined && parseFloat(amount) !== parseFloat(expense.amount)) {
      updateData.amount = amount;

      // Delete old splits and create new ones
      await prisma.expenseSplit.deleteMany({
        where: { expenseId: id }
      });

      const splits = await calculateSplits(expense.householdId, amount);
      await prisma.expenseSplit.createMany({
        data: splits.map(s => ({
          expenseId: id,
          userId: s.userId,
          amount: s.amount,
          settled: false
        }))
      });
    }

    const updated = await prisma.expense.update({
      where: { id },
      data: updateData,
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        },
        paidBy: {
          select: { id: true, name: true, avatarUrl: true }
        },
        splits: {
          include: {
            user: {
              select: { id: true, name: true }
            }
          }
        }
      }
    });

    return success(res, {
      expense: {
        ...updated,
        householdId: updated.householdId,
        allSettled: updated.splits.every(s => s.settled)
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/expenses/:id
 * Delete expense (cascades to splits)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const expense = await prisma.expense.findUnique({
      where: { id }
    });

    if (!expense) {
      return notFound(res, 'Expense not found');
    }

    if (!isMember(req.user, expense.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    await prisma.expense.delete({
      where: { id }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * PATCH /api/expenses/:id/settle
 * Settle all splits for an expense or specific user's split
 */
router.patch('/:id/settle', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, settled = true } = req.body;

    const expense = await prisma.expense.findUnique({
      where: { id },
      include: { splits: true }
    });

    if (!expense) {
      return notFound(res, 'Expense not found');
    }

    if (!isMember(req.user, expense.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    if (userId) {
      // Settle specific user's split
      await prisma.expenseSplit.updateMany({
        where: { expenseId: id, userId },
        data: { settled }
      });
    } else {
      // Settle all splits
      await prisma.expenseSplit.updateMany({
        where: { expenseId: id },
        data: { settled }
      });
    }

    const updated = await prisma.expense.findUnique({
      where: { id },
      include: {
        splits: {
          include: {
            user: {
              select: { id: true, name: true }
            }
          }
        }
      }
    });

    return success(res, {
      expense: {
        id: updated.id,
        splits: updated.splits,
        allSettled: updated.splits.every(s => s.settled)
      }
    });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
