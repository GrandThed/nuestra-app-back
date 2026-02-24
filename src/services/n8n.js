const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const CHAT_TIMEOUT = 60000; // 60 seconds for LLM calls

/**
 * Send a new message to the n8n chat webhook
 * @param {Object} params
 * @param {string} params.message - User's message
 * @param {string[]} params.imageUrls - Attached image URLs
 * @param {Object[]} params.history - Conversation history [{role, content}]
 * @param {Object} params.context - Household context data
 * @returns {Promise<{type: string, reply?: string, message?: string, toolCalls?: Array, suggestions?: Array, requests?: Array}>}
 */
const sendChatMessage = async ({ message, imageUrls, history, context }) => {
  if (!N8N_WEBHOOK_URL) {
    throw new Error('N8N_WEBHOOK_URL is not configured');
  }

  const response = await fetch(`${N8N_WEBHOOK_URL}/webhook/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'new_message',
      message,
      imageUrls: imageUrls || [],
      history,
      context,
    }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new Error(`n8n webhook error (${response.status}): ${text}`);
  }

  return response.json();
};

/**
 * Continue a conversation by sending query results back to n8n
 * @param {Object} params
 * @param {Object[]} params.requestResults - [{tool, result}] from frontend query execution
 * @param {Object[]} params.history - Conversation history
 * @param {Object} params.context - Household context data
 * @returns {Promise<{type: string, reply?: string, message?: string, toolCalls?: Array, suggestions?: Array, requests?: Array}>}
 */
const continueChatWithData = async ({ requestResults, history, context }) => {
  if (!N8N_WEBHOOK_URL) {
    throw new Error('N8N_WEBHOOK_URL is not configured');
  }

  const response = await fetch(`${N8N_WEBHOOK_URL}/webhook/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'continue_with_data',
      requestResults,
      history,
      context,
    }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new Error(`n8n webhook error (${response.status}): ${text}`);
  }

  return response.json();
};

module.exports = { sendChatMessage, continueChatWithData };
