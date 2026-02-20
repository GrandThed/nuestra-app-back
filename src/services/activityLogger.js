const prisma = require('../lib/prisma');

/**
 * Log an activity to the ActivityLog table
 * Call this after any mutation (create, update, delete) in route handlers
 *
 * @param {Object} params
 * @param {string} params.householdId
 * @param {string} params.userId
 * @param {string} params.action - created, updated, deleted, checked, settled, favorited, rated, voted, archived
 * @param {string} params.entityType - board, board_item, recipe, expense, wishlist, calendar, menu, menu_item, tag, comment
 * @param {string} [params.entityId]
 * @param {Object} [params.metadata] - extra context like { title, amount, categoryName }
 */
const logActivity = async ({ householdId, userId, action, entityType, entityId, metadata }) => {
  try {
    await prisma.activityLog.create({
      data: {
        householdId,
        userId,
        action,
        entityType,
        entityId,
        metadata: metadata || undefined
      }
    });
  } catch (err) {
    // Don't let logging failures break the main request
    console.error('Activity log error:', err.message);
  }
};

module.exports = { logActivity };
