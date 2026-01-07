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
 * Expand recurring events within a date range
 * Returns array of event occurrences (master event + generated occurrences)
 */
const expandRecurringEvents = (events, fromDate, toDate) => {
  const expandedEvents = [];
  const from = new Date(fromDate);
  const to = new Date(toDate);

  for (const event of events) {
    if (event.recurrence === 'none') {
      // Non-recurring: include if within range
      const eventStart = new Date(event.startDate);
      if (eventStart >= from && eventStart <= to) {
        expandedEvents.push({
          ...event,
          isOccurrence: false,
          occurrenceDate: null
        });
      }
    } else {
      // Recurring: expand occurrences within range
      const masterStart = new Date(event.startDate);
      const recurrenceEnd = event.recurrenceEndDate ? new Date(event.recurrenceEndDate) : to;
      const effectiveEnd = recurrenceEnd < to ? recurrenceEnd : to;

      let currentDate = new Date(masterStart);
      let occurrenceIndex = 0;

      while (currentDate <= effectiveEnd) {
        if (currentDate >= from && currentDate <= to) {
          const isFirst = occurrenceIndex === 0;
          expandedEvents.push({
            ...event,
            isOccurrence: !isFirst,
            occurrenceDate: isFirst ? null : currentDate.toISOString(),
            occurrenceId: isFirst ? null : `${event.id}_${currentDate.toISOString().split('T')[0]}`
          });
        }

        // Advance to next occurrence
        switch (event.recurrence) {
          case 'daily':
            currentDate.setDate(currentDate.getDate() + 1);
            break;
          case 'weekly':
            currentDate.setDate(currentDate.getDate() + 7);
            break;
          case 'monthly':
            currentDate.setMonth(currentDate.getMonth() + 1);
            break;
          case 'yearly':
            currentDate.setFullYear(currentDate.getFullYear() + 1);
            break;
          default:
            currentDate = new Date(effectiveEnd.getTime() + 1); // Exit loop
        }
        occurrenceIndex++;

        // Safety limit to prevent infinite loops
        if (occurrenceIndex > 365) break;
      }
    }
  }

  // Sort by start date
  return expandedEvents.sort((a, b) => {
    const dateA = a.occurrenceDate ? new Date(a.occurrenceDate) : new Date(a.startDate);
    const dateB = b.occurrenceDate ? new Date(b.occurrenceDate) : new Date(b.startDate);
    return dateA - dateB;
  });
};

// ==================== TIMELINE (must be before /:id) ====================

/**
 * GET /api/calendar/timeline
 * Unified timeline aggregating calendar events, menu items, and board items
 * Query params: householdId, from, to (required)
 */
router.get('/timeline', async (req, res) => {
  try {
    const { householdId, from, to } = req.query;

    if (!householdId || !from || !to) {
      return error(res, 'householdId, from, and to dates are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return error(res, 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD)');
    }

    // Fetch calendar events
    const events = await prisma.calendarEvent.findMany({
      where: {
        householdId,
        OR: [
          {
            recurrence: 'none',
            startDate: { gte: fromDate, lte: toDate }
          },
          {
            recurrence: { not: 'none' },
            startDate: { lte: toDate },
            OR: [
              { recurrenceEndDate: null },
              { recurrenceEndDate: { gte: fromDate } }
            ]
          }
        ]
      },
      include: {
        linkedBoard: { select: { id: true, name: true } },
        linkedRecipe: { select: { id: true, title: true } },
        linkedMenuPlan: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });

    const expandedEvents = expandRecurringEvents(events, from, to);

    // Fetch menu items in range
    const menuItems = await prisma.menuItem.findMany({
      where: {
        menuPlan: { householdId },
        date: { gte: fromDate, lte: toDate }
      },
      include: {
        recipe: { select: { id: true, title: true, imageUrl: true } },
        menuPlan: { select: { id: true, name: true } }
      }
    });

    // Fetch board items created in range
    const boardItems = await prisma.boardItem.findMany({
      where: {
        board: { householdId },
        createdAt: { gte: fromDate, lte: toDate }
      },
      include: {
        board: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });

    // Combine and format timeline entries
    const timeline = [];

    // Add calendar events
    for (const event of expandedEvents) {
      const eventDate = event.occurrenceDate ? new Date(event.occurrenceDate) : new Date(event.startDate);
      timeline.push({
        type: 'calendar_event',
        date: eventDate.toISOString(),
        id: event.occurrenceId || event.id,
        masterId: event.id,
        title: event.title,
        description: event.description,
        allDay: event.allDay,
        isOccurrence: event.isOccurrence,
        linkedBoard: event.linkedBoard,
        linkedRecipe: event.linkedRecipe,
        linkedMenuPlan: event.linkedMenuPlan
      });
    }

    // Add menu items
    for (const item of menuItems) {
      timeline.push({
        type: 'menu_item',
        date: new Date(item.date).toISOString(),
        id: item.id,
        title: item.recipe.title,
        mealType: item.mealType,
        recipe: item.recipe,
        menuPlan: item.menuPlan
      });
    }

    // Add board items
    for (const item of boardItems) {
      timeline.push({
        type: 'board_item',
        date: new Date(item.createdAt).toISOString(),
        id: item.id,
        title: item.title || (item.type === 'photo' ? 'Photo' : 'Link'),
        itemType: item.type,
        url: item.url,
        thumbnailUrl: item.thumbnailUrl || item.linkPreviewImage,
        board: item.board,
        createdBy: item.createdBy
      });
    }

    // Sort by date
    timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

    return success(res, { timeline });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== EVENTS ====================

/**
 * GET /api/calendar
 * List calendar events in date range (with recurring expansion)
 * Query params: householdId, from, to (required)
 */
router.get('/', async (req, res) => {
  try {
    const { householdId, from, to } = req.query;

    if (!householdId || !from || !to) {
      return error(res, 'householdId, from, and to dates are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return error(res, 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD)');
    }

    // Fetch events that could have occurrences in range:
    // - Non-recurring: startDate within range
    // - Recurring: startDate <= toDate AND (no endDate OR endDate >= fromDate)
    const events = await prisma.calendarEvent.findMany({
      where: {
        householdId,
        OR: [
          // Non-recurring events within range
          {
            recurrence: 'none',
            startDate: {
              gte: fromDate,
              lte: toDate
            }
          },
          // Recurring events that might have occurrences in range
          {
            recurrence: { not: 'none' },
            startDate: { lte: toDate },
            OR: [
              { recurrenceEndDate: null },
              { recurrenceEndDate: { gte: fromDate } }
            ]
          }
        ]
      },
      include: {
        linkedBoard: {
          select: { id: true, name: true }
        },
        linkedRecipe: {
          select: { id: true, title: true }
        },
        linkedMenuPlan: {
          select: { id: true, name: true }
        },
        createdBy: {
          select: { id: true, name: true }
        }
      },
      orderBy: { startDate: 'asc' }
    });

    // Expand recurring events
    const expandedEvents = expandRecurringEvents(events, from, to);

    return success(res, { events: expandedEvents });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * GET /api/calendar/:id
 * Get single calendar event by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const event = await prisma.calendarEvent.findUnique({
      where: { id },
      include: {
        linkedBoard: {
          select: { id: true, name: true }
        },
        linkedRecipe: {
          select: { id: true, title: true }
        },
        linkedMenuPlan: {
          select: { id: true, name: true }
        },
        createdBy: {
          select: { id: true, name: true, avatarUrl: true }
        }
      }
    });

    if (!event) {
      return notFound(res, 'Event not found');
    }

    if (!isMember(req.user, event.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    return success(res, { event });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * POST /api/calendar
 * Create a calendar event
 */
router.post('/', async (req, res) => {
  try {
    const {
      householdId,
      title,
      description,
      startDate,
      endDate,
      allDay = false,
      recurrence = 'none',
      recurrenceEndDate,
      linkedBoardId,
      linkedRecipeId,
      linkedMenuPlanId
    } = req.body;

    if (!householdId || !title || !startDate) {
      return error(res, 'householdId, title, and startDate are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Validate recurrence value
    const validRecurrences = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
    if (!validRecurrences.includes(recurrence)) {
      return error(res, 'Invalid recurrence. Must be: none, daily, weekly, monthly, yearly');
    }

    // Validate linked entities belong to household
    if (linkedBoardId) {
      const board = await prisma.board.findUnique({ where: { id: linkedBoardId } });
      if (!board || board.householdId !== householdId) {
        return error(res, 'Linked board not found or does not belong to household');
      }
    }

    if (linkedRecipeId) {
      const recipe = await prisma.recipe.findUnique({ where: { id: linkedRecipeId } });
      if (!recipe || recipe.householdId !== householdId) {
        return error(res, 'Linked recipe not found or does not belong to household');
      }
    }

    if (linkedMenuPlanId) {
      const menuPlan = await prisma.menuPlan.findUnique({ where: { id: linkedMenuPlanId } });
      if (!menuPlan || menuPlan.householdId !== householdId) {
        return error(res, 'Linked menu plan not found or does not belong to household');
      }
    }

    const event = await prisma.calendarEvent.create({
      data: {
        householdId,
        title,
        description,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        allDay,
        recurrence,
        recurrenceEndDate: recurrenceEndDate ? new Date(recurrenceEndDate) : null,
        linkedBoardId,
        linkedRecipeId,
        linkedMenuPlanId,
        createdById: req.user.id
      },
      include: {
        linkedBoard: {
          select: { id: true, name: true }
        },
        linkedRecipe: {
          select: { id: true, title: true }
        },
        linkedMenuPlan: {
          select: { id: true, name: true }
        },
        createdBy: {
          select: { id: true, name: true }
        }
      }
    });

    return created(res, { event });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * PATCH /api/calendar/:id
 * Update a calendar event
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      startDate,
      endDate,
      allDay,
      recurrence,
      recurrenceEndDate,
      linkedBoardId,
      linkedRecipeId,
      linkedMenuPlanId
    } = req.body;

    const event = await prisma.calendarEvent.findUnique({
      where: { id }
    });

    if (!event) {
      return notFound(res, 'Event not found');
    }

    if (!isMember(req.user, event.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Validate recurrence if provided
    if (recurrence !== undefined) {
      const validRecurrences = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
      if (!validRecurrences.includes(recurrence)) {
        return error(res, 'Invalid recurrence. Must be: none, daily, weekly, monthly, yearly');
      }
    }

    // Validate linked entities if provided
    if (linkedBoardId !== undefined && linkedBoardId !== null) {
      const board = await prisma.board.findUnique({ where: { id: linkedBoardId } });
      if (!board || board.householdId !== event.householdId) {
        return error(res, 'Linked board not found or does not belong to household');
      }
    }

    if (linkedRecipeId !== undefined && linkedRecipeId !== null) {
      const recipe = await prisma.recipe.findUnique({ where: { id: linkedRecipeId } });
      if (!recipe || recipe.householdId !== event.householdId) {
        return error(res, 'Linked recipe not found or does not belong to household');
      }
    }

    if (linkedMenuPlanId !== undefined && linkedMenuPlanId !== null) {
      const menuPlan = await prisma.menuPlan.findUnique({ where: { id: linkedMenuPlanId } });
      if (!menuPlan || menuPlan.householdId !== event.householdId) {
        return error(res, 'Linked menu plan not found or does not belong to household');
      }
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (startDate !== undefined) updateData.startDate = new Date(startDate);
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (allDay !== undefined) updateData.allDay = allDay;
    if (recurrence !== undefined) updateData.recurrence = recurrence;
    if (recurrenceEndDate !== undefined) updateData.recurrenceEndDate = recurrenceEndDate ? new Date(recurrenceEndDate) : null;
    if (linkedBoardId !== undefined) updateData.linkedBoardId = linkedBoardId;
    if (linkedRecipeId !== undefined) updateData.linkedRecipeId = linkedRecipeId;
    if (linkedMenuPlanId !== undefined) updateData.linkedMenuPlanId = linkedMenuPlanId;

    const updated = await prisma.calendarEvent.update({
      where: { id },
      data: updateData,
      include: {
        linkedBoard: {
          select: { id: true, name: true }
        },
        linkedRecipe: {
          select: { id: true, title: true }
        },
        linkedMenuPlan: {
          select: { id: true, name: true }
        },
        createdBy: {
          select: { id: true, name: true }
        }
      }
    });

    return success(res, { event: updated });
  } catch (err) {
    return serverError(res, err);
  }
});

/**
 * DELETE /api/calendar/:id
 * Delete a calendar event
 * Query params:
 *   - deleteRecurring: 'all' (delete master), 'future' (update recurrenceEndDate)
 *   - occurrenceDate: ISO date string for 'future' deletion
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteRecurring, occurrenceDate } = req.query;

    const event = await prisma.calendarEvent.findUnique({
      where: { id }
    });

    if (!event) {
      return notFound(res, 'Event not found');
    }

    if (!isMember(req.user, event.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Handle recurring event deletion
    if (event.recurrence !== 'none' && deleteRecurring === 'future' && occurrenceDate) {
      // Set recurrenceEndDate to day before the occurrence
      const endDate = new Date(occurrenceDate);
      endDate.setDate(endDate.getDate() - 1);

      await prisma.calendarEvent.update({
        where: { id },
        data: { recurrenceEndDate: endDate }
      });

      return success(res, { message: 'Future occurrences deleted' });
    }

    // Default: delete the entire event (including all recurring instances)
    await prisma.calendarEvent.delete({
      where: { id }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
