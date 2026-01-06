const prisma = require('../lib/prisma');

/**
 * Default expense categories for new households
 */
const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Supermercado', icon: '🛒' },
  { name: 'Restaurantes', icon: '🍽️' },
  { name: 'Transporte', icon: '🚗' },
  { name: 'Servicios', icon: '💡' },
  { name: 'Entretenimiento', icon: '🎬' },
  { name: 'Salud', icon: '💊' },
  { name: 'Hogar', icon: '🏠' },
  { name: 'Otros', icon: '📦' }
];

/**
 * Default wishlist categories for new households
 */
const DEFAULT_WISHLIST_CATEGORIES = [
  { name: 'Comprar ahora', type: 'system', sortOrder: 0 },
  { name: 'Comprar cuando podamos', type: 'system', sortOrder: 1 },
  { name: 'Ideas de regalo', type: 'system', sortOrder: 2 }
];

/**
 * Seed default categories for a new household
 */
const seedHouseholdCategories = async (householdId) => {
  // Create expense categories
  await prisma.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map(cat => ({
      householdId,
      name: cat.name,
      icon: cat.icon
    }))
  });

  // Create wishlist categories
  await prisma.wishlistCategory.createMany({
    data: DEFAULT_WISHLIST_CATEGORIES.map(cat => ({
      householdId,
      name: cat.name,
      type: cat.type,
      sortOrder: cat.sortOrder
    }))
  });
};

module.exports = {
  seedHouseholdCategories,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_WISHLIST_CATEGORIES
};
