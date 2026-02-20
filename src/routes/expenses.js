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

// ==================== RECURRING EXPENSES ====================

/**
 * GET /api/expenses/recurring
 * List recurring expenses for a household
 */
router.get('/recurring', async (req, res) => {
  try {
    const { householdId } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const recurringExpenses = await prisma.recurringExpense.findMany({
      where: { householdId },
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        },
        paidBy: {
          select: { id: true, name: true, avatarUrl: true }
        },
        _count: {
          select: { expenses: true }
        }
      },
      orderBy: { nextDueDate: 'asc' }
    });

    return success(res, {
      recurringExpenses: recurringExpenses.map(re => ({
        id: re.id,
        householdId: re.householdId,
        description: re.description,
        amount: re.amount,
        currency: re.currency,
        category: re.category,
        paidBy: re.paidBy,
        recurrence: re.recurrence,
        nextDueDate: re.nextDueDate,
        isActive: re.isActive,
        generatedCount: re._count.expenses,
        createdAt: re.createdAt
      }))
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/expenses/recurring
 * Create a recurring expense template
 */
router.post('/recurring', async (req, res) => {
  try {
    const { householdId, description, amount, currency, categoryId, paidById, recurrence, nextDueDate } = req.body;

    if (!householdId || !description || !amount || !recurrence || !nextDueDate) {
      return error(res, 'householdId, description, amount, recurrence, and nextDueDate are required');
    }

    if (!['monthly', 'weekly', 'yearly'].includes(recurrence)) {
      return error(res, 'recurrence must be monthly, weekly, or yearly');
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

    // If paidById is provided, verify membership
    const effectivePaidById = paidById || req.user.id;
    if (paidById) {
      const paidByMember = await prisma.householdMember.findFirst({
        where: { householdId, userId: paidById }
      });
      if (!paidByMember) {
        return error(res, 'The specified payer is not a member of this household');
      }
    }

    const recurringExpense = await prisma.recurringExpense.create({
      data: {
        householdId,
        description,
        amount,
        currency: currency || 'ARS',
        categoryId: categoryId || null,
        paidById: effectivePaidById,
        recurrence,
        nextDueDate: new Date(nextDueDate)
      },
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        },
        paidBy: {
          select: { id: true, name: true, avatarUrl: true }
        }
      }
    });

    logActivity({
      householdId,
      userId: req.user.id,
      action: 'created',
      entityType: 'expense',
      entityId: recurringExpense.id,
      metadata: { title: description, amount, recurrence, type: 'recurring' }
    });

    return created(res, { recurringExpense });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/expenses/recurring/generate
 * Generate expenses from due recurring templates
 */
router.post('/recurring/generate', async (req, res) => {
  try {
    const { householdId } = req.body;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const now = new Date();

    // Find all active recurring expenses that are due
    const dueRecurring = await prisma.recurringExpense.findMany({
      where: {
        householdId,
        isActive: true,
        nextDueDate: { lte: now }
      }
    });

    const generatedExpenses = [];

    for (const recurring of dueRecurring) {
      // Calculate splits for this expense
      const splits = await calculateSplits(recurring.householdId, recurring.amount);

      // Create the expense
      const expense = await prisma.expense.create({
        data: {
          householdId: recurring.householdId,
          description: recurring.description,
          amount: recurring.amount,
          currency: recurring.currency,
          date: recurring.nextDueDate,
          categoryId: recurring.categoryId,
          paidById: recurring.paidById,
          recurringExpenseId: recurring.id,
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

      // Advance the nextDueDate based on recurrence
      const nextDate = new Date(recurring.nextDueDate);
      switch (recurring.recurrence) {
        case 'weekly':
          nextDate.setDate(nextDate.getDate() + 7);
          break;
        case 'monthly':
          nextDate.setMonth(nextDate.getMonth() + 1);
          break;
        case 'yearly':
          nextDate.setFullYear(nextDate.getFullYear() + 1);
          break;
      }

      await prisma.recurringExpense.update({
        where: { id: recurring.id },
        data: { nextDueDate: nextDate }
      });

      generatedExpenses.push(expense);
    }

    logActivity({
      householdId,
      userId: req.user.id,
      action: 'created',
      entityType: 'expense',
      metadata: { type: 'recurring_generate', count: generatedExpenses.length }
    });

    return success(res, {
      generatedCount: generatedExpenses.length,
      expenses: generatedExpenses
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * PATCH /api/expenses/recurring/:id
 * Update a recurring expense template
 */
router.patch('/recurring/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { description, amount, currency, categoryId, paidById, recurrence, nextDueDate, isActive } = req.body;

    const recurring = await prisma.recurringExpense.findUnique({
      where: { id }
    });

    if (!recurring) {
      return notFound(res, 'Recurring expense not found');
    }

    if (!isMember(req.user, recurring.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const updateData = {};
    if (description !== undefined) updateData.description = description;
    if (amount !== undefined) updateData.amount = amount;
    if (currency !== undefined) updateData.currency = currency;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (paidById !== undefined) updateData.paidById = paidById;
    if (recurrence !== undefined) {
      if (!['monthly', 'weekly', 'yearly'].includes(recurrence)) {
        return error(res, 'recurrence must be monthly, weekly, or yearly');
      }
      updateData.recurrence = recurrence;
    }
    if (nextDueDate !== undefined) updateData.nextDueDate = new Date(nextDueDate);
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await prisma.recurringExpense.update({
      where: { id },
      data: updateData,
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        },
        paidBy: {
          select: { id: true, name: true, avatarUrl: true }
        }
      }
    });

    logActivity({
      householdId: recurring.householdId,
      userId: req.user.id,
      action: 'updated',
      entityType: 'expense',
      entityId: id,
      metadata: { title: updated.description, type: 'recurring' }
    });

    return success(res, { recurringExpense: updated });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/expenses/recurring/:id
 * Delete a recurring expense template
 */
router.delete('/recurring/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const recurring = await prisma.recurringExpense.findUnique({
      where: { id }
    });

    if (!recurring) {
      return notFound(res, 'Recurring expense not found');
    }

    if (!isMember(req.user, recurring.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    await prisma.recurringExpense.delete({
      where: { id }
    });

    logActivity({
      householdId: recurring.householdId,
      userId: req.user.id,
      action: 'deleted',
      entityType: 'expense',
      entityId: id,
      metadata: { title: recurring.description, type: 'recurring' }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== CATEGORY BUDGETS ====================

/**
 * GET /api/expenses/budgets
 * Get budgets for a household for a specific month/year
 */
router.get('/budgets', async (req, res) => {
  try {
    const { householdId, month, year } = req.query;

    if (!householdId || !month || !year) {
      return error(res, 'householdId, month, and year are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const budgets = await prisma.expenseBudget.findMany({
      where: {
        householdId,
        month: parseInt(month),
        year: parseInt(year)
      },
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        }
      },
      orderBy: { category: { name: 'asc' } }
    });

    // Get actual spending per category for this period
    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);

    const expenses = await prisma.expense.groupBy({
      by: ['categoryId'],
      where: {
        householdId,
        date: { gte: startDate, lte: endDate },
        categoryId: { not: null }
      },
      _sum: { amount: true }
    });

    const spendingMap = {};
    for (const exp of expenses) {
      spendingMap[exp.categoryId] = parseFloat(exp._sum.amount) || 0;
    }

    return success(res, {
      budgets: budgets.map(b => ({
        id: b.id,
        category: b.category,
        monthlyLimit: b.monthlyLimit,
        month: b.month,
        year: b.year,
        actualSpending: spendingMap[b.categoryId] || 0,
        remaining: parseFloat(b.monthlyLimit) - (spendingMap[b.categoryId] || 0),
        percentUsed: spendingMap[b.categoryId]
          ? Math.round(((spendingMap[b.categoryId] || 0) / parseFloat(b.monthlyLimit)) * 100)
          : 0
      }))
    });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/expenses/budgets
 * Create or update a budget for a category/month/year
 */
router.post('/budgets', async (req, res) => {
  try {
    const { householdId, categoryId, monthlyLimit, month, year } = req.body;

    if (!householdId || !categoryId || !monthlyLimit || !month || !year) {
      return error(res, 'householdId, categoryId, monthlyLimit, month, and year are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Verify category belongs to household
    const category = await prisma.expenseCategory.findUnique({
      where: { id: categoryId }
    });
    if (!category || category.householdId !== householdId) {
      return notFound(res, 'Category not found');
    }

    const budget = await prisma.expenseBudget.upsert({
      where: {
        householdId_categoryId_month_year: {
          householdId,
          categoryId,
          month: parseInt(month),
          year: parseInt(year)
        }
      },
      update: {
        monthlyLimit
      },
      create: {
        householdId,
        categoryId,
        monthlyLimit,
        month: parseInt(month),
        year: parseInt(year)
      },
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        }
      }
    });

    logActivity({
      householdId,
      userId: req.user.id,
      action: 'updated',
      entityType: 'expense',
      entityId: budget.id,
      metadata: { title: category.name, monthlyLimit, month, year, type: 'budget' }
    });

    return created(res, { budget });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * GET /api/expenses/budgets/status
 * Get budget vs actual spending per category
 */
router.get('/budgets/status', async (req, res) => {
  try {
    const { householdId, month, year } = req.query;

    if (!householdId || !month || !year) {
      return error(res, 'householdId, month, and year are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);

    // Get all budgets for this period
    const budgets = await prisma.expenseBudget.findMany({
      where: {
        householdId,
        month: parseInt(month),
        year: parseInt(year)
      },
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        }
      }
    });

    // Get actual spending grouped by category
    const expenses = await prisma.expense.groupBy({
      by: ['categoryId'],
      where: {
        householdId,
        date: { gte: startDate, lte: endDate },
        categoryId: { not: null }
      },
      _sum: { amount: true },
      _count: { id: true }
    });

    const spendingMap = {};
    const countMap = {};
    for (const exp of expenses) {
      spendingMap[exp.categoryId] = parseFloat(exp._sum.amount) || 0;
      countMap[exp.categoryId] = exp._count.id;
    }

    // Get all categories for the household to include unbudgeted spending
    const allCategories = await prisma.expenseCategory.findMany({
      where: { householdId },
      select: { id: true, name: true, icon: true }
    });

    const budgetMap = {};
    for (const b of budgets) {
      budgetMap[b.categoryId] = b;
    }

    const statuses = allCategories.map(cat => {
      const budget = budgetMap[cat.id];
      const actual = spendingMap[cat.id] || 0;
      const limit = budget ? parseFloat(budget.monthlyLimit) : null;

      return {
        category: cat,
        budgetId: budget?.id || null,
        monthlyLimit: limit,
        actualSpending: actual,
        expenseCount: countMap[cat.id] || 0,
        remaining: limit !== null ? limit - actual : null,
        percentUsed: limit !== null && limit > 0 ? Math.round((actual / limit) * 100) : null,
        overBudget: limit !== null ? actual > limit : false
      };
    });

    // Sort: over-budget first, then by percent used descending
    statuses.sort((a, b) => {
      if (a.overBudget && !b.overBudget) return -1;
      if (!a.overBudget && b.overBudget) return 1;
      return (b.percentUsed || 0) - (a.percentUsed || 0);
    });

    // Calculate totals
    const totalBudgeted = budgets.reduce((sum, b) => sum + parseFloat(b.monthlyLimit), 0);
    const totalSpent = Object.values(spendingMap).reduce((sum, v) => sum + v, 0);

    return success(res, {
      period: { month: parseInt(month), year: parseInt(year) },
      totalBudgeted,
      totalSpent,
      totalRemaining: totalBudgeted - totalSpent,
      categories: statuses
    });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== EXPENSE TRENDS ====================

/**
 * GET /api/expenses/trends
 * Month-over-month comparison of expense totals by category
 */
router.get('/trends', async (req, res) => {
  try {
    const { householdId, months } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const numMonths = parseInt(months) || 6;
    const now = new Date();

    // Calculate start date (N months ago, first day of that month)
    const startDate = new Date(now.getFullYear(), now.getMonth() - numMonths + 1, 1);

    // Get all expenses in range
    const expenses = await prisma.expense.findMany({
      where: {
        householdId,
        date: { gte: startDate }
      },
      include: {
        category: {
          select: { id: true, name: true, icon: true }
        }
      },
      orderBy: { date: 'asc' }
    });

    // Build month-by-month breakdown
    const monthlyData = {};
    for (let i = 0; i < numMonths; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - numMonths + 1 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyData[key] = {
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        label: key,
        total: 0,
        byCategory: {}
      };
    }

    for (const exp of expenses) {
      const d = new Date(exp.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyData[key]) continue;

      const amount = parseFloat(exp.amount);
      monthlyData[key].total += amount;

      const catName = exp.category?.name || 'Uncategorized';
      const catId = exp.category?.id || 'uncategorized';
      if (!monthlyData[key].byCategory[catId]) {
        monthlyData[key].byCategory[catId] = {
          categoryId: catId,
          name: catName,
          icon: exp.category?.icon || null,
          total: 0,
          count: 0
        };
      }
      monthlyData[key].byCategory[catId].total += amount;
      monthlyData[key].byCategory[catId].count += 1;
    }

    // Convert to array and sort byCategory into arrays
    const trends = Object.values(monthlyData).map(m => ({
      month: m.month,
      year: m.year,
      label: m.label,
      total: Math.round(m.total * 100) / 100,
      byCategory: Object.values(m.byCategory).sort((a, b) => b.total - a.total)
    }));

    // Calculate averages
    const totalAcrossMonths = trends.reduce((sum, m) => sum + m.total, 0);
    const averageMonthly = trends.length > 0 ? Math.round((totalAcrossMonths / trends.length) * 100) / 100 : 0;

    return success(res, {
      months: numMonths,
      trends,
      averageMonthly,
      totalAcrossMonths: Math.round(totalAcrossMonths * 100) / 100
    });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== CSV EXPORT ====================

/**
 * GET /api/expenses/export
 * Export expenses as CSV
 */
router.get('/export', async (req, res) => {
  try {
    const { householdId, month, year, format } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    if (format !== 'csv') {
      return error(res, 'Only csv format is supported');
    }

    const where = { householdId };

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
          select: { name: true }
        },
        paidBy: {
          select: { name: true }
        },
        splits: {
          include: {
            user: {
              select: { name: true }
            }
          }
        }
      },
      orderBy: { date: 'asc' }
    });

    // Build CSV
    const headers = ['Date', 'Description', 'Amount', 'Currency', 'Category', 'Paid By', 'Split Details'];
    const rows = expenses.map(exp => {
      const splitDetails = exp.splits
        .map(s => `${s.user.name}: ${parseFloat(s.amount).toFixed(2)}${s.settled ? ' (settled)' : ''}`)
        .join('; ');

      return [
        new Date(exp.date).toISOString().split('T')[0],
        `"${(exp.description || '').replace(/"/g, '""')}"`,
        parseFloat(exp.amount).toFixed(2),
        exp.currency,
        exp.category?.name || 'Uncategorized',
        exp.paidBy?.name || 'Unknown',
        `"${splitDetails}"`
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    const filename = month && year
      ? `expenses_${year}_${String(month).padStart(2, '0')}.csv`
      : year
        ? `expenses_${year}.csv`
        : 'expenses.csv';

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
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
        recurringExpenseId: exp.recurringExpenseId,
        linkedWishlistItemId: exp.linkedWishlistItemId,
        splits: exp.splits.map(s => ({
          id: s.id,
          userId: s.userId,
          user: s.user,
          amount: s.amount,
          customAmount: s.customAmount,
          isCustom: s.isCustom,
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
 * Create an expense with automatic or custom splits
 * Optionally link to a wishlist item (archives it and creates purchase history)
 */
router.post('/', async (req, res) => {
  try {
    const { householdId, description, amount, currency, date, categoryId, receiptUrl, paidById, customSplits, linkedWishlistItemId } = req.body;

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

    // If paidById is provided, verify that user is a member of the household
    const effectivePaidById = paidById || req.user.id;
    if (paidById) {
      const paidByMember = await prisma.householdMember.findFirst({
        where: { householdId, userId: paidById }
      });
      if (!paidByMember) {
        return error(res, 'The specified payer is not a member of this household');
      }
    }

    // Use custom splits or calculate automatically
    let splits;
    let isCustom = false;

    if (customSplits && Array.isArray(customSplits) && customSplits.length > 0) {
      // Validate custom splits
      const customTotal = customSplits.reduce((sum, s) => sum + parseFloat(s.amount), 0);
      const expenseAmount = parseFloat(amount);

      // Allow a small rounding tolerance
      if (Math.abs(customTotal - expenseAmount) > 0.01) {
        return error(res, `Custom splits total (${customTotal.toFixed(2)}) must equal expense amount (${expenseAmount.toFixed(2)})`);
      }

      // Verify all users in custom splits are household members
      for (const split of customSplits) {
        const member = await prisma.householdMember.findFirst({
          where: { householdId, userId: split.userId }
        });
        if (!member) {
          return error(res, `User ${split.userId} is not a member of this household`);
        }
      }

      splits = customSplits.map(s => ({
        userId: s.userId,
        amount: parseFloat(s.amount)
      }));
      isCustom = true;
    } else {
      splits = await calculateSplits(householdId, amount);
    }

    // Build expense data
    const expenseData = {
      householdId,
      description,
      amount,
      currency: currency || 'ARS',
      date: new Date(date),
      categoryId: categoryId || null,
      receiptUrl: receiptUrl || null,
      paidById: effectivePaidById,
      linkedWishlistItemId: linkedWishlistItemId || null,
      splits: {
        create: splits.map(s => ({
          userId: s.userId,
          amount: s.amount,
          customAmount: isCustom ? s.amount : null,
          isCustom,
          settled: false
        }))
      }
    };

    // Create expense (and handle wishlist linking in a transaction if needed)
    let expense;

    if (linkedWishlistItemId) {
      // Verify the wishlist item exists and belongs to this household
      const wishlistItem = await prisma.wishlistItem.findUnique({
        where: { id: linkedWishlistItemId },
        include: {
          category: {
            select: { householdId: true }
          }
        }
      });

      if (!wishlistItem || wishlistItem.category.householdId !== householdId) {
        return notFound(res, 'Wishlist item not found');
      }

      // Use a transaction to create expense, archive wishlist item, and create purchase history
      const result = await prisma.$transaction(async (tx) => {
        const newExpense = await tx.expense.create({
          data: expenseData,
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

        // Archive the wishlist item
        await tx.wishlistItem.update({
          where: { id: linkedWishlistItemId },
          data: {
            checked: true,
            archivedAt: new Date()
          }
        });

        // Create purchase history entry
        await tx.wishlistPurchaseHistory.create({
          data: {
            householdId,
            name: wishlistItem.name,
            price: amount,
            purchasedById: effectivePaidById,
            linkedExpenseId: newExpense.id,
            originalItemId: linkedWishlistItemId
          }
        });

        return newExpense;
      });

      expense = result;
    } else {
      expense = await prisma.expense.create({
        data: expenseData,
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
    }

    logActivity({
      householdId,
      userId: req.user.id,
      action: 'created',
      entityType: 'expense',
      entityId: expense.id,
      metadata: {
        title: description,
        amount,
        isCustomSplit: isCustom,
        linkedWishlistItemId: linkedWishlistItemId || undefined
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
