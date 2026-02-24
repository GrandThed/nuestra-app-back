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
 * Weekday name to JS Date.getDay() mapping
 */
const WEEKDAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * Parse comma-separated weekday string into a Set of day numbers
 */
const parseWeekdays = (recurrenceDays) => {
  if (!recurrenceDays) return null;
  const days = new Set();
  for (const d of recurrenceDays.split(',')) {
    const num = WEEKDAY_MAP[d.trim().toLowerCase()];
    if (num !== undefined) days.add(num);
  }
  return days.size > 0 ? days : null;
};

/**
 * Normalize a date to midnight UTC (strips time component)
 */
const toMidnightUTC = (date) => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/**
 * Expand task occurrences within a date range.
 * Handles: recurrenceInterval (every N days), recurrenceDays (specific weekdays),
 * and standard recurrence types (daily, weekly, monthly, yearly).
 */
const expandTaskOccurrences = (tasks, fromDate, toDate) => {
  const expanded = [];
  const from = new Date(fromDate);
  const to = new Date(toDate);

  for (const task of tasks) {
    const hasTaskRecurrence = task.recurrenceInterval || task.recurrenceDays;
    const hasStandardRecurrence = task.recurrence && task.recurrence !== 'none';

    if (!hasTaskRecurrence && !hasStandardRecurrence) {
      // One-time task
      const taskDate = new Date(task.startDate);
      if (taskDate >= from && taskDate <= to) {
        expanded.push({
          ...task,
          occurrenceDate: task.startDate.toISOString(),
          occurrenceId: `${task.id}_${task.startDate.toISOString().split('T')[0]}`
        });
      }
      continue;
    }

    const recurrenceEnd = task.recurrenceEndDate ? new Date(task.recurrenceEndDate) : to;
    const effectiveEnd = recurrenceEnd < to ? recurrenceEnd : to;
    const weekdaySet = parseWeekdays(task.recurrenceDays);

    let currentDate = new Date(task.startDate);
    let iterations = 0;

    while (currentDate <= effectiveEnd && iterations < 730) {
      iterations++;

      if (currentDate >= from) {
        // For weekday-based recurrence, only include if the date matches a selected weekday
        if (!weekdaySet || weekdaySet.has(currentDate.getDay())) {
          expanded.push({
            ...task,
            occurrenceDate: currentDate.toISOString(),
            occurrenceId: `${task.id}_${currentDate.toISOString().split('T')[0]}`
          });
        }
      }

      // Advance to next date
      if (task.recurrenceInterval) {
        currentDate = new Date(currentDate);
        currentDate.setDate(currentDate.getDate() + task.recurrenceInterval);
      } else if (weekdaySet) {
        // Advance by 1 day to check next weekday
        currentDate = new Date(currentDate);
        currentDate.setDate(currentDate.getDate() + 1);
      } else {
        // Standard recurrence types
        currentDate = new Date(currentDate);
        switch (task.recurrence) {
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
            currentDate = new Date(effectiveEnd.getTime() + 1);
        }
      }
    }
  }

  return expanded;
};

// ==================== GET PENDING TASKS ====================

/**
 * GET /api/tasks
 * Returns pending (uncompleted) task occurrences, deduped to oldest per task
 * Query: householdId (required)
 */
router.get('/', async (req, res) => {
  try {
    const { householdId } = req.query;

    if (!householdId) {
      return error(res, 'householdId is required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 90); // Look back 90 days for overdue
    const toDate = new Date(now);
    toDate.setDate(toDate.getDate() + 7); // Look ahead 7 days

    // Fetch all tasks for the household
    const tasks = await prisma.calendarEvent.findMany({
      where: {
        householdId,
        isTask: true,
        OR: [
          // Non-recurring: startDate within range
          {
            recurrence: 'none',
            recurrenceInterval: null,
            recurrenceDays: null,
            startDate: { gte: fromDate, lte: toDate }
          },
          // Recurring (any type): started before toDate, ends at/after fromDate or never ends
          {
            AND: [
              {
                OR: [
                  { recurrence: { not: 'none' } },
                  { recurrenceInterval: { not: null } },
                  { recurrenceDays: { not: null } }
                ]
              },
              { startDate: { lte: toDate } },
              {
                OR: [
                  { recurrenceEndDate: null },
                  { recurrenceEndDate: { gte: fromDate } }
                ]
              }
            ]
          }
        ]
      },
      include: {
        createdBy: { select: { id: true, name: true, avatarUrl: true } },
        taskCompletions: true
      }
    });

    // Expand occurrences
    const allOccurrences = expandTaskOccurrences(tasks, fromDate, toDate);

    // Build set of completed occurrence keys
    const completionSet = new Set();
    for (const task of tasks) {
      for (const c of task.taskCompletions) {
        const dateKey = c.occurrenceDate.toISOString().split('T')[0];
        completionSet.add(`${c.eventId}_${dateKey}`);
      }
    }

    // Dedup: for each task, keep only the oldest uncompleted occurrence
    const occurrencesByTask = {};
    for (const occ of allOccurrences) {
      if (!occurrencesByTask[occ.id]) occurrencesByTask[occ.id] = [];
      occurrencesByTask[occ.id].push(occ);
    }

    const pendingTasks = [];
    for (const [taskId, occurrences] of Object.entries(occurrencesByTask)) {
      // Sort oldest first
      occurrences.sort((a, b) => new Date(a.occurrenceDate) - new Date(b.occurrenceDate));

      const oldest = occurrences.find(occ => {
        const dateKey = occ.occurrenceDate.split('T')[0];
        return !completionSet.has(`${taskId}_${dateKey}`);
      });

      if (oldest) {
        // Strip taskCompletions from response (internal data)
        const { taskCompletions, ...taskData } = oldest;
        pendingTasks.push(taskData);
      }
    }

    // Sort by occurrence date ascending (most urgent first)
    pendingTasks.sort((a, b) => new Date(a.occurrenceDate) - new Date(b.occurrenceDate));

    return success(res, { tasks: pendingTasks });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== CREATE TASK ====================

/**
 * POST /api/tasks
 * Creates a CalendarEvent with isTask: true
 */
router.post('/', async (req, res) => {
  try {
    const {
      householdId, title, description, startDate,
      recurrence, recurrenceEndDate, recurrenceInterval,
      recurrenceDays, colorHex
    } = req.body;

    if (!householdId || !title || !startDate) {
      return error(res, 'householdId, title, and startDate are required');
    }

    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Validate recurrenceInterval
    if (recurrenceInterval !== undefined && recurrenceInterval !== null) {
      const interval = parseInt(recurrenceInterval, 10);
      if (isNaN(interval) || interval < 1) {
        return error(res, 'recurrenceInterval must be a positive integer');
      }
    }

    // Validate recurrenceDays
    if (recurrenceDays) {
      const validDays = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
      const days = recurrenceDays.split(',').map(d => d.trim().toLowerCase());
      for (const d of days) {
        if (!validDays.has(d)) {
          return error(res, `Invalid weekday: ${d}. Valid values: sun,mon,tue,wed,thu,fri,sat`);
        }
      }
    }

    const task = await prisma.calendarEvent.create({
      data: {
        householdId,
        title,
        description: description || null,
        startDate: new Date(startDate),
        allDay: true,
        isTask: true,
        recurrence: recurrence || 'none',
        recurrenceEndDate: recurrenceEndDate ? new Date(recurrenceEndDate) : null,
        recurrenceInterval: recurrenceInterval ? parseInt(recurrenceInterval, 10) : null,
        recurrenceDays: recurrenceDays || null,
        colorHex: colorHex || null,
        createdById: req.user.id
      },
      include: {
        createdBy: { select: { id: true, name: true, avatarUrl: true } }
      }
    });

    logActivity({
      householdId,
      userId: req.user.id,
      action: 'created',
      entityType: 'task',
      entityId: task.id,
      metadata: { title: task.title }
    });

    return created(res, { task });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== UPDATE TASK ====================

/**
 * PATCH /api/tasks/:id
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const task = await prisma.calendarEvent.findUnique({ where: { id } });
    if (!task) return notFound(res, 'Task not found');
    if (!task.isTask) return notFound(res, 'Task not found');
    if (!isMember(req.user, task.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const {
      title, description, startDate, recurrence,
      recurrenceEndDate, recurrenceInterval, recurrenceDays, colorHex
    } = req.body;

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (startDate !== undefined) updateData.startDate = new Date(startDate);
    if (recurrence !== undefined) updateData.recurrence = recurrence;
    if (recurrenceEndDate !== undefined) {
      updateData.recurrenceEndDate = recurrenceEndDate ? new Date(recurrenceEndDate) : null;
    }
    if (recurrenceInterval !== undefined) {
      updateData.recurrenceInterval = recurrenceInterval ? parseInt(recurrenceInterval, 10) : null;
    }
    if (recurrenceDays !== undefined) updateData.recurrenceDays = recurrenceDays || null;
    if (colorHex !== undefined) updateData.colorHex = colorHex || null;

    const updated = await prisma.calendarEvent.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: { select: { id: true, name: true, avatarUrl: true } }
      }
    });

    logActivity({
      householdId: task.householdId,
      userId: req.user.id,
      action: 'updated',
      entityType: 'task',
      entityId: id,
      metadata: { title: updated.title }
    });

    return success(res, { task: updated });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== DELETE TASK ====================

/**
 * DELETE /api/tasks/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const task = await prisma.calendarEvent.findUnique({ where: { id } });
    if (!task) return notFound(res, 'Task not found');
    if (!task.isTask) return notFound(res, 'Task not found');
    if (!isMember(req.user, task.householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    await prisma.calendarEvent.delete({ where: { id } });

    logActivity({
      householdId: task.householdId,
      userId: req.user.id,
      action: 'deleted',
      entityType: 'task',
      entityId: id,
      metadata: { title: task.title }
    });

    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== COMPLETE TASK OCCURRENCE ====================

/**
 * POST /api/tasks/:id/complete
 * Body: { occurrenceDate, householdId }
 */
router.post('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { occurrenceDate, householdId } = req.body;

    if (!occurrenceDate || !householdId) {
      return error(res, 'occurrenceDate and householdId are required');
    }

    const task = await prisma.calendarEvent.findUnique({ where: { id } });
    if (!task) return notFound(res, 'Task not found');
    if (!task.isTask) return notFound(res, 'Task not found');
    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    // Normalize occurrence date to midnight UTC
    const normalizedDate = toMidnightUTC(occurrenceDate);

    const completion = await prisma.taskCompletion.upsert({
      where: {
        eventId_occurrenceDate: {
          eventId: id,
          occurrenceDate: normalizedDate
        }
      },
      create: {
        eventId: id,
        occurrenceDate: normalizedDate,
        completedById: req.user.id,
        householdId
      },
      update: {
        completedById: req.user.id,
        completedAt: new Date()
      }
    });

    logActivity({
      householdId,
      userId: req.user.id,
      action: 'completed',
      entityType: 'task',
      entityId: id,
      metadata: { title: task.title, occurrenceDate: normalizedDate.toISOString() }
    });

    return success(res, { completion });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== UNDO TASK COMPLETION ====================

/**
 * DELETE /api/tasks/:id/complete
 * Query: occurrenceDate, householdId
 */
router.delete('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { occurrenceDate, householdId } = req.query;

    if (!occurrenceDate || !householdId) {
      return error(res, 'occurrenceDate and householdId are required');
    }

    const task = await prisma.calendarEvent.findUnique({ where: { id } });
    if (!task) return notFound(res, 'Task not found');
    if (!task.isTask) return notFound(res, 'Task not found');
    if (!isMember(req.user, householdId)) {
      return forbidden(res, 'You are not a member of this household');
    }

    const normalizedDate = toMidnightUTC(occurrenceDate);

    await prisma.taskCompletion.delete({
      where: {
        eventId_occurrenceDate: {
          eventId: id,
          occurrenceDate: normalizedDate
        }
      }
    });

    return noContent(res);
  } catch (err) {
    if (err.code === 'P2025') {
      return notFound(res, 'Completion not found');
    }
    return serverError(res, err);
  }
});

module.exports = router;
