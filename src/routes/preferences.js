const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { success, created, error } = require('../lib/response');

router.use(authenticate);

/**
 * GET /api/users/preferences
 * Get all preferences for the current user
 */
router.get('/', async (req, res) => {
  try {
    const preferences = await prisma.userPreference.findMany({
      where: { userId: req.user.id }
    });

    // Convert to key-value object
    const prefsMap = {};
    for (const pref of preferences) {
      prefsMap[pref.key] = pref.value;
    }

    return success(res, { preferences: prefsMap });
  } catch (err) {
    console.error('Get preferences error:', err);
    return error(res, err.message, 500);
  }
});

/**
 * POST /api/users/preferences
 * Set a preference for the current user
 * Body: { key, value }
 */
router.post('/', async (req, res) => {
  try {
    const { key, value } = req.body;

    if (!key) {
      return error(res, 'key is required');
    }

    const preference = await prisma.userPreference.upsert({
      where: {
        userId_key: {
          userId: req.user.id,
          key
        }
      },
      update: { value },
      create: {
        userId: req.user.id,
        key,
        value
      }
    });

    return created(res, { preference });
  } catch (err) {
    console.error('Set preference error:', err);
    return error(res, err.message, 500);
  }
});

/**
 * PATCH /api/users/preferences/:key
 * Update a specific preference
 * Body: { value }
 */
router.patch('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const preference = await prisma.userPreference.upsert({
      where: {
        userId_key: {
          userId: req.user.id,
          key
        }
      },
      update: { value },
      create: {
        userId: req.user.id,
        key,
        value
      }
    });

    return success(res, { preference });
  } catch (err) {
    console.error('Update preference error:', err);
    return error(res, err.message, 500);
  }
});

module.exports = router;
