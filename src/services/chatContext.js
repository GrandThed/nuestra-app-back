const prisma = require('../lib/prisma');

/**
 * Calculate current season based on hemisphere
 * @param {string} hemisphere - 'north' or 'south'
 * @returns {string} Season name in Spanish
 */
const calculateSeason = (hemisphere) => {
  const month = new Date().getMonth() + 1; // 1-12

  // Northern hemisphere seasons
  let season;
  if (month >= 3 && month <= 5) season = 'primavera';
  else if (month >= 6 && month <= 8) season = 'verano';
  else if (month >= 9 && month <= 11) season = 'otoño';
  else season = 'invierno';

  // Flip for southern hemisphere
  if (hemisphere === 'south') {
    const flip = {
      primavera: 'otoño',
      verano: 'invierno',
      otoño: 'primavera',
      invierno: 'verano',
    };
    season = flip[season];
  }

  return season;
};

/**
 * Build household context to send to n8n along with chat messages.
 * Includes structural/reference data (names, categories) but NOT actual content
 * (events, items, amounts) — the LLM fetches those via query tools.
 *
 * @param {string} householdId
 * @returns {Promise<Object>} Context object for n8n
 */
const buildChatContext = async (householdId) => {
  const [household, boards, wishlistCategories, expenseCategories] = await Promise.all([
    prisma.household.findUnique({
      where: { id: householdId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.board.findMany({
      where: { householdId },
      select: { id: true, name: true },
    }),
    prisma.wishlistCategory.findMany({
      where: { householdId },
      select: { id: true, name: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.expenseCategory.findMany({
      where: { householdId },
      select: { id: true, name: true },
    }),
  ]);

  if (!household) {
    throw new Error('Household not found');
  }

  return {
    members: household.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      role: m.role,
    })),
    boards: boards.map((b) => ({ id: b.id, name: b.name })),
    wishlistCategories: wishlistCategories.map((c) => ({ id: c.id, name: c.name })),
    expenseCategories: expenseCategories.map((c) => ({ id: c.id, name: c.name })),
    today: new Date().toISOString().split('T')[0],
    hemisphere: household.hemisphere || 'south',
    season: calculateSeason(household.hemisphere || 'south'),
  };
};

module.exports = { buildChatContext, calculateSeason };
