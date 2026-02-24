const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const prisma = require('../lib/prisma');
const { success, error, forbidden, serverError } = require('../lib/response');
const { sendChatMessage, continueChatWithData } = require('../services/n8n');
const { buildChatContext } = require('../services/chatContext');

// All chat routes require authentication
router.use(authenticate);

const HISTORY_LIMIT = 20; // Messages sent to n8n as conversation context
const MAX_CONTINUE_ROUNDS = 2; // Max data_request rounds per message

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

    // Call n8n
    const n8nResponse = await sendChatMessage({
      message: message.trim(),
      imageUrls: imageUrls || [],
      history,
      context,
    });

    // Handle data_request (LLM needs more data)
    if (n8nResponse.type === 'data_request') {
      // Store the data request as a system message
      const systemMsg = await prisma.chatMessage.create({
        data: {
          householdId,
          role: 'system',
          content: n8nResponse.message || 'Recopilando información...',
          metadata: {
            type: 'data_request',
            requests: n8nResponse.requests || [],
            round: 1,
          },
        },
      });

      return success(res, {
        type: 'data_request',
        messageId: systemMsg.id,
        message: n8nResponse.message || 'Recopilando información...',
        requests: n8nResponse.requests || [],
      });
    }

    // Handle final response
    const assistantMsg = await prisma.chatMessage.create({
      data: {
        householdId,
        role: 'assistant',
        content: n8nResponse.reply || '',
        toolCalls: n8nResponse.toolCalls && n8nResponse.toolCalls.length > 0
          ? n8nResponse.toolCalls
          : undefined,
        suggestions: n8nResponse.suggestions || [],
      },
    });

    return success(res, {
      type: 'response',
      messageId: assistantMsg.id,
      reply: n8nResponse.reply || '',
      toolCalls: n8nResponse.toolCalls || [],
      suggestions: n8nResponse.suggestions || [],
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
      return error(res, 'El asistente tardó demasiado en responder. Intenta de nuevo.', 504);
    }
    return serverError(res, err);
  }
});

// ==================== POST /api/chat/continue ====================
// Send query results back to the LLM for a final response
router.post('/continue', async (req, res) => {
  try {
    const { requestResults } = req.body;

    if (!requestResults || !Array.isArray(requestResults)) {
      return error(res, 'requestResults array is required');
    }

    const householdId = getHouseholdId(req.user);
    if (!householdId) {
      return forbidden(res, 'You must belong to a household to use the assistant');
    }

    // Check the last system message to track rounds
    const lastSystemMsg = await prisma.chatMessage.findFirst({
      where: { householdId, role: 'system' },
      orderBy: { createdAt: 'desc' },
    });

    const currentRound = lastSystemMsg?.metadata?.round || 1;
    if (currentRound >= MAX_CONTINUE_ROUNDS) {
      return error(res, 'Maximum data gathering rounds reached');
    }

    // Build context and history
    const [context, history] = await Promise.all([
      buildChatContext(householdId),
      getConversationHistory(householdId),
    ]);

    // Call n8n with the query results
    const n8nResponse = await continueChatWithData({
      requestResults,
      history,
      context,
    });

    // Handle another data_request (fallback round)
    if (n8nResponse.type === 'data_request') {
      const systemMsg = await prisma.chatMessage.create({
        data: {
          householdId,
          role: 'system',
          content: n8nResponse.message || 'Buscando más información...',
          metadata: {
            type: 'data_request',
            requests: n8nResponse.requests || [],
            round: currentRound + 1,
          },
        },
      });

      return success(res, {
        type: 'data_request',
        messageId: systemMsg.id,
        message: n8nResponse.message || 'Buscando más información...',
        requests: n8nResponse.requests || [],
      });
    }

    // Handle final response
    const assistantMsg = await prisma.chatMessage.create({
      data: {
        householdId,
        role: 'assistant',
        content: n8nResponse.reply || '',
        toolCalls: n8nResponse.toolCalls && n8nResponse.toolCalls.length > 0
          ? n8nResponse.toolCalls
          : undefined,
        suggestions: n8nResponse.suggestions || [],
      },
    });

    return success(res, {
      type: 'response',
      messageId: assistantMsg.id,
      reply: n8nResponse.reply || '',
      toolCalls: n8nResponse.toolCalls || [],
      suggestions: n8nResponse.suggestions || [],
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
      return error(res, 'El asistente tardó demasiado en responder. Intenta de nuevo.', 504);
    }
    return serverError(res, err);
  }
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
