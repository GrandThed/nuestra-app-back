const prisma = require('../lib/prisma');

/**
 * Query tools executed by the Claude service during the tool loop.
 * These mirror the route handler queries but simplified for LLM context
 * (no auth checks, no signed URLs, capped results).
 */

const searchRecipes = async (householdId, { query } = {}) => {
  const where = { householdId };
  if (query) {
    where.title = { contains: query, mode: 'insensitive' };
  }

  const recipes = await prisma.recipe.findMany({
    where,
    select: {
      id: true,
      title: true,
      servings: true,
      prepTimeMinutes: true,
      cookTimeMinutes: true,
      ingredients: true,
      instructions: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return {
    recipes: recipes.map((r) => ({
      id: r.id,
      title: r.title,
      servings: r.servings,
      prepTimeMinutes: r.prepTimeMinutes,
      cookTimeMinutes: r.cookTimeMinutes,
      ingredientCount: Array.isArray(r.ingredients) ? r.ingredients.length : 0,
      ingredients: Array.isArray(r.ingredients)
        ? r.ingredients.map((i) => (typeof i === 'object' ? `${i.quantity || ''} ${i.unit || ''} ${i.name}`.trim() : i))
        : [],
    })),
    total: recipes.length,
  };
};

const listCalendarEvents = async (householdId, { startDate, endDate } = {}) => {
  const fromDate = startDate ? new Date(startDate) : new Date();
  const toDate = endDate
    ? new Date(endDate)
    : new Date(fromDate.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Calendar events
  const events = await prisma.calendarEvent.findMany({
    where: {
      householdId,
      OR: [
        {
          recurrence: 'none',
          startDate: { gte: fromDate, lte: toDate },
        },
        {
          recurrence: { not: 'none' },
          startDate: { lte: toDate },
          OR: [
            { recurrenceEndDate: null },
            { recurrenceEndDate: { gte: fromDate } },
          ],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      startDate: true,
      endDate: true,
      allDay: true,
      recurrence: true,
      recurrenceEndDate: true,
    },
  });

  // Expand recurring events
  const expandedEvents = [];
  for (const event of events) {
    if (event.recurrence === 'none') {
      expandedEvents.push({
        type: 'calendar_event',
        id: event.id,
        title: event.title,
        description: event.description,
        date: event.startDate.toISOString().split('T')[0],
        allDay: event.allDay,
      });
    } else {
      let currentDate = new Date(event.startDate);
      const effectiveEnd = event.recurrenceEndDate && event.recurrenceEndDate < toDate
        ? event.recurrenceEndDate
        : toDate;
      let count = 0;

      while (currentDate <= effectiveEnd && count < 30) {
        if (currentDate >= fromDate && currentDate <= toDate) {
          expandedEvents.push({
            type: 'calendar_event',
            id: event.id,
            title: event.title,
            description: event.description,
            date: currentDate.toISOString().split('T')[0],
            allDay: event.allDay,
            recurring: event.recurrence,
          });
        }
        switch (event.recurrence) {
          case 'daily': currentDate.setDate(currentDate.getDate() + 1); break;
          case 'weekly': currentDate.setDate(currentDate.getDate() + 7); break;
          case 'monthly': currentDate.setMonth(currentDate.getMonth() + 1); break;
          case 'yearly': currentDate.setFullYear(currentDate.getFullYear() + 1); break;
          default: currentDate = new Date(effectiveEnd.getTime() + 1);
        }
        count++;
      }
    }
  }

  // Menu items in range
  const menuItems = await prisma.menuItem.findMany({
    where: {
      menuPlan: { householdId },
      date: { gte: fromDate, lte: toDate },
    },
    include: {
      recipe: { select: { id: true, title: true } },
      menuPlan: { select: { id: true, name: true } },
    },
  });

  const menuEntries = menuItems.map((item) => ({
    type: 'menu_item',
    id: item.id,
    title: item.recipe?.title || item.customName || 'Comida',
    date: new Date(item.date).toISOString().split('T')[0],
    mealType: item.mealType,
    menuPlanId: item.menuPlan.id,
    menuPlanName: item.menuPlan.name,
  }));

  const timeline = [...expandedEvents, ...menuEntries].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  return { timeline, count: timeline.length };
};

const listWishlistItems = async (householdId, { categoryName } = {}) => {
  const where = {
    householdId,
    archivedAt: null,
  };

  if (categoryName) {
    where.category = { name: { equals: categoryName, mode: 'insensitive' } };
  }

  const items = await prisma.wishlistItem.findMany({
    where,
    include: {
      category: { select: { id: true, name: true } },
    },
    orderBy: [{ checked: 'asc' }, { createdAt: 'desc' }],
    take: 50,
  });

  // Group by category
  const grouped = {};
  for (const item of items) {
    const catName = item.category?.name || 'Sin categoría';
    if (!grouped[catName]) {
      grouped[catName] = {
        categoryId: item.category?.id,
        categoryName: catName,
        items: [],
      };
    }
    grouped[catName].items.push({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      checked: item.checked,
      notes: item.notes,
    });
  }

  return {
    categories: Object.values(grouped),
    totalItems: items.length,
  };
};

const listBoards = async (householdId, { boardName } = {}) => {
  const where = { householdId };
  if (boardName) {
    where.name = { contains: boardName, mode: 'insensitive' };
  }

  const boards = await prisma.board.findMany({
    where,
    include: {
      _count: { select: { items: true } },
      items: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          title: true,
          url: true,
          notes: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    boards: boards.map((b) => ({
      id: b.id,
      name: b.name,
      itemCount: b._count.items,
      items: b.items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        url: item.url,
        notes: item.notes,
      })),
    })),
  };
};

const getExpenseSummary = async (householdId, { month, year } = {}) => {
  const where = { householdId };

  if (month && year) {
    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    where.date = { gte: startDate, lte: endDate };
  } else if (year) {
    const startDate = new Date(parseInt(year), 0, 1);
    const endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    where.date = { gte: startDate, lte: endDate };
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: {
      category: { select: { id: true, name: true } },
      paidBy: { select: { id: true, name: true } },
      splits: {
        include: {
          user: { select: { id: true, name: true } },
        },
      },
    },
  });

  const totalAmount = expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

  // Category breakdown
  const byCategory = {};
  for (const exp of expenses) {
    const catName = exp.category?.name || 'Sin categoría';
    if (!byCategory[catName]) {
      byCategory[catName] = { name: catName, total: 0, count: 0 };
    }
    byCategory[catName].total += parseFloat(exp.amount);
    byCategory[catName].count += 1;
  }

  // Member balances
  const memberBalances = {};
  for (const exp of expenses) {
    const payerId = exp.paidBy.id;
    if (!memberBalances[payerId]) {
      memberBalances[payerId] = { name: exp.paidBy.name, paid: 0, owes: 0 };
    }
    memberBalances[payerId].paid += parseFloat(exp.amount);

    for (const split of exp.splits) {
      if (!memberBalances[split.userId]) {
        memberBalances[split.userId] = { name: split.user.name, paid: 0, owes: 0 };
      }
      if (!split.settled) {
        memberBalances[split.userId].owes += parseFloat(split.amount);
      }
    }
  }

  const balances = Object.values(memberBalances).map((m) => ({
    ...m,
    balance: Math.round((m.paid - m.owes) * 100) / 100,
  }));

  return {
    totalAmount: Math.round(totalAmount * 100) / 100,
    expenseCount: expenses.length,
    byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
    memberBalances: balances,
  };
};

module.exports = {
  searchRecipes,
  listCalendarEvents,
  listWishlistItems,
  listBoards,
  getExpenseSummary,
};
