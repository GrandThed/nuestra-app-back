const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const prisma = require('../lib/prisma');
const { success, error, forbidden, serverError } = require('../lib/response');
const { runChatLoop } = require('../services/claude');
const { buildChatContext } = require('../services/chatContext');

// All chat routes require authentication
router.use(authenticate);

const HISTORY_LIMIT = 30; // Messages sent to Claude as conversation context

/**
 * Check if user is a member of any household
 * Returns the first household membership
 */
const getHouseholdId = (user) => {
  if (!user.householdMembers || user.householdMembers.length === 0) return null;
  return user.householdMembers[0].householdId;
};

/**
 * Fetch recent messages for conversation history
 */
const getConversationHistory = async (householdId, limit = HISTORY_LIMIT) => {
  const messages = await prisma.chatMessage.findMany({
    where: { householdId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      role: true,
      content: true,
      imageUrls: true,
    },
  });

  // Reverse to chronological order
  return messages.reverse().map((m) => ({
    role: m.role === 'system' ? 'assistant' : m.role,
    content: m.content,
    ...(m.imageUrls.length > 0 && { imageUrls: m.imageUrls }),
  }));
};

// ==================== POST /api/chat ====================
// Send a new message to the assistant
router.post('/', async (req, res) => {
  try {
    const { message, imageUrls } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return error(res, 'Message is required');
    }

    if (message.length > 2000) {
      return error(res, 'Message must be 2000 characters or less');
    }

    if (imageUrls && (!Array.isArray(imageUrls) || imageUrls.length > 5)) {
      return error(res, 'Maximum 5 images allowed');
    }

    const householdId = getHouseholdId(req.user);
    if (!householdId) {
      return forbidden(res, 'You must belong to a household to use the assistant');
    }

    // Store user message
    await prisma.chatMessage.create({
      data: {
        householdId,
        userId: req.user.id,
        role: 'user',
        content: message.trim(),
        imageUrls: imageUrls || [],
      },
    });

    // Build context and history
    const [context, history] = await Promise.all([
      buildChatContext(householdId),
      getConversationHistory(householdId),
    ]);

    // Call Claude (handles query tool loop internally)
    const claudeResponse = await runChatLoop({
      message: message.trim(),
      imageUrls: imageUrls || [],
      history,
      context,
      householdId,
    });

    // Store and return the response
    const assistantMsg = await prisma.chatMessage.create({
      data: {
        householdId,
        role: 'assistant',
        content: claudeResponse.reply || '',
        toolCalls: claudeResponse.toolCalls && claudeResponse.toolCalls.length > 0
          ? claudeResponse.toolCalls
          : undefined,
        suggestions: claudeResponse.suggestions || [],
      },
    });

    return success(res, {
      type: 'response',
      messageId: assistantMsg.id,
      reply: claudeResponse.reply || '',
      toolCalls: claudeResponse.toolCalls || [],
      suggestions: claudeResponse.suggestions || [],
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
      return error(res, 'El asistente tardó demasiado en responder. Intenta de nuevo.', 504);
    }
    return serverError(res, err);
  }
});

// ==================== POST /api/chat/continue ====================
// Deprecated: query tools are now executed server-side in the Claude loop.
// Kept for backward compatibility — the frontend will never call this.
router.post('/continue', async (req, res) => {
  return success(res, {
    type: 'response',
    messageId: null,
    reply: 'Este endpoint ya no es necesario. El asistente maneja las consultas internamente.',
    toolCalls: [],
    suggestions: [],
  });
});

// ==================== GET /api/chat/history ====================
// Fetch chat history with pagination
router.get('/history', async (req, res) => {
  try {
    const householdId = getHouseholdId(req.user);
    if (!householdId) {
      return forbidden(res, 'You must belong to a household');
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
    const before = req.query.before; // cursor: message ID

    const where = {
      householdId,
      role: { in: ['user', 'assistant'] }, // Filter out system/data_request messages
    };

    if (before) {
      const cursor = await prisma.chatMessage.findUnique({ where: { id: before } });
      if (cursor) {
        where.createdAt = { lt: cursor.createdAt };
      }
    }

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Fetch one extra to check hasMore
      include: {
        user: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
    });

    const hasMore = messages.length > limit;
    const result = (hasMore ? messages.slice(0, limit) : messages).reverse();

    return success(res, {
      messages: result.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        imageUrls: m.imageUrls,
        toolCalls: m.toolCalls || [],
        suggestions: m.suggestions,
        user: m.user ? {
          id: m.user.id,
          name: m.user.name,
          avatarUrl: m.user.avatarUrl,
        } : null,
        createdAt: m.createdAt.toISOString(),
      })),
      hasMore,
    });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== DELETE /api/chat/history/from/:messageId ====================
// Delete a message and all messages after it (backtrack)
router.delete('/history/from/:messageId', async (req, res) => {
  try {
    const householdId = getHouseholdId(req.user);
    if (!householdId) {
      return forbidden(res, 'You must belong to a household');
    }

    const { messageId } = req.params;

    // Find the target message
    const targetMessage = await prisma.chatMessage.findUnique({
      where: { id: messageId },
    });

    if (!targetMessage || targetMessage.householdId !== householdId) {
      return error(res, 'Message not found', 404);
    }

    // Delete the target message and all messages after it
    await prisma.chatMessage.deleteMany({
      where: {
        householdId,
        createdAt: { gte: targetMessage.createdAt },
      },
    });

    return success(res, { deleted: true });
  } catch (err) {
    return serverError(res, err);
  }
});

// ==================== DELETE /api/chat/history ====================
// Clear all chat messages for the household
router.delete('/history', async (req, res) => {
  try {
    const householdId = getHouseholdId(req.user);
    if (!householdId) {
      return forbidden(res, 'You must belong to a household');
    }

    await prisma.chatMessage.deleteMany({
      where: { householdId },
    });

    return success(res, { cleared: true });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
