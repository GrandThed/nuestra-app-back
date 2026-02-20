const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { success, error, forbidden } = require('../lib/response');

router.use(authenticate);

/**
 * GET /api/activity
 * Get household activity feed
 * Query: householdId (required), limit (default 20), offset (default 0)
 */
router.get('/', async (req, res) => {
  try {
    const { householdId, limit = '20', offset = '0' } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    const isMember = req.user.householdMembers.some(m => m.householdId === householdId);
    if (!isMember) {
      return forbidden(res, 'Not a member of this household');
    }

    const take = Math.min(parseInt(limit) || 20, 50);
    const skip = parseInt(offset) || 0;

    const [activities, total] = await Promise.all([
      prisma.activityLog.findMany({
        where: { householdId },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          user: {
            select: { id: true, name: true, avatarUrl: true }
          }
        }
      }),
      prisma.activityLog.count({ where: { householdId } })
    ]);

    return success(res, { activities, total, limit: take, offset: skip });
  } catch (err) {
    console.error('Activity feed error:', err);
    return error(res, err.message, 500);
  }
});

/**
 * GET /api/activity/digest
 * Get weekly digest summary for a household
 * Query: householdId (required)
 */
router.get('/digest', async (req, res) => {
  try {
    const { householdId } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    const isMember = req.user.householdMembers.some(m => m.householdId === householdId);
    if (!isMember) {
      return forbidden(res, 'Not a member of this household');
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const activities = await prisma.activityLog.findMany({
      where: {
        householdId,
        createdAt: { gte: oneWeekAgo }
      },
      include: {
        user: { select: { id: true, name: true } }
      }
    });

    // Aggregate by entity type
    const summary = {};
    for (const activity of activities) {
      const key = activity.entityType;
      if (!summary[key]) {
        summary[key] = { count: 0, actions: {} };
      }
      summary[key].count++;
      summary[key].actions[activity.action] = (summary[key].actions[activity.action] || 0) + 1;
    }

    return success(res, {
      period: { from: oneWeekAgo.toISOString(), to: new Date().toISOString() },
      totalActivities: activities.length,
      summary
    });
  } catch (err) {
    console.error('Activity digest error:', err);
    return error(res, err.message, 500);
  }
});

module.exports = router;
