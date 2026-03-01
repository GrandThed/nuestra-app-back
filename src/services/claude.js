const Anthropic = require('@anthropic-ai/sdk');
const {
  searchRecipes,
  listCalendarEvents,
  listWishlistItems,
  listBoards,
  getExpenseSummary,
} = require('./chatQueryTools');

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6-20250514';
const MAX_TOOL_ITERATIONS = 5;

const anthropic = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ==================== Tool Definitions ====================

const queryTools = [
  {
    name: 'search_recipes',
    description:
      'Buscá recetas en el recetario del hogar. Devuelve recetas que matchean por título. Usala cuando el usuario pregunte por recetas, quiera sugerencias de comida, o pregunte qué puede cocinar.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Término de búsqueda para filtrar recetas por título. Dejalo vacío para obtener todas.',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_calendar_events',
    description:
      'Listá eventos del calendario y comidas del menú semanal en un rango de fechas. Usala cuando el usuario pregunte por eventos, planes, o qué pasa en fechas específicas.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Fecha inicio en formato YYYY-MM-DD. Por defecto es hoy.',
        },
        endDate: {
          type: 'string',
          description: 'Fecha fin en formato YYYY-MM-DD. Por defecto es 7 días desde startDate.',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_wishlist_items',
    description:
      'Listá items de las listas de compras/deseos del hogar. Usala cuando el usuario pregunte qué hay que comprar, qué hay en las listas, o items de wishlist.',
    input_schema: {
      type: 'object',
      properties: {
        categoryName: {
          type: 'string',
          description: 'Filtrar por nombre de categoría. Debe ser EXACTAMENTE uno de los nombres de categoría del contexto (case insensitive).',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_boards',
    description:
      'Listá los tableros estilo Pinterest y sus items (links y fotos). Usala cuando el usuario pregunte por links guardados, tableros, o colecciones de inspiración.',
    input_schema: {
      type: 'object',
      properties: {
        boardName: {
          type: 'string',
          description: 'Filtrar por nombre de tablero.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_expense_summary',
    description:
      'Obtené un resumen de gastos del hogar con totales, desglose por categoría y balances entre miembros. Usala cuando el usuario pregunte por gastos, cuánto se gastó, o resúmenes financieros.',
    input_schema: {
      type: 'object',
      properties: {
        month: {
          type: 'integer',
          description: 'Número de mes (1-12). Si no se especifica, devuelve resumen general.',
        },
        year: {
          type: 'integer',
          description: 'Año (ej: 2026). Si no se especifica, devuelve resumen general.',
        },
      },
      required: [],
    },
  },
];

const respondToUserTool = {
  name: 'respond_to_user',
  description:
    'OBLIGATORIO: SIEMPRE tenés que llamar esta herramienta como tu acción final en cada turno. Usala para enviar tu respuesta al usuario, junto con herramientas de acción que quieras que confirme, y sugerencias de seguimiento.',
  input_schema: {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'Tu respuesta de texto al usuario en español argentino. Usá un tono cálido y servicial.',
      },
      actionTools: {
        type: 'array',
        description:
          'Herramientas de acción que requieren confirmación del usuario antes de ejecutarse. Solo incluí si el pedido implica crear/modificar datos.',
        items: {
          type: 'object',
          properties: {
            tool: {
              type: 'string',
              enum: [
                'create_recipe',
                'add_wishlist_items',
                'create_expense',
                'create_calendar_event',
                'add_board_link',
                'add_menu_item',
                'generate_shopping_list',
              ],
            },
            params: {
              type: 'object',
              description: 'Parámetros de la herramienta de acción. Seguí los esquemas del system prompt.',
            },
          },
          required: ['tool', 'params'],
        },
      },
      suggestions: {
        type: 'array',
        description: '2-4 sugerencias cortas de seguimiento. En español argentino. Máximo 40 caracteres cada una.',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 4,
      },
    },
    required: ['reply', 'suggestions'],
  },
};

const allTools = [...queryTools, respondToUserTool];

// ==================== System Prompt ====================

const buildSystemPrompt = (context) => {
  const memberNames = context.members.map((m) => m.name).join(' y ');
  const memberList = context.members
    .map((m) => `- ${m.name} (${m.role}, id: ${m.id})`)
    .join('\n');
  const boardList = context.boards
    .map((b) => `- "${b.name}" (id: ${b.id})`)
    .join('\n');
  const wishlistCatList = context.wishlistCategories
    .map((c) => `- "${c.name}" (id: ${c.id})`)
    .join('\n');
  const expenseCatList = context.expenseCategories
    .map((c) => `- "${c.name}" (id: ${c.id})`)
    .join('\n');

  return `Sos el asistente del hogar de ${memberNames}. Tu nombre es el Asistente de Casa.

## Tu personalidad
- Hablás en español argentino informal (vos, tenés, podés)
- Sos cálido, práctico y resolutivo — directo pero simpático
- Sos experto en cocina, especialmente cocina argentina, latinoamericana y de temporada
- Conocés muy bien las verduras y frutas de estación en el hemisferio ${context.hemisphere === 'south' ? 'sur' : 'norte'}
- No sos demasiado verborrágico — vas al grano

## Información del hogar
Miembros:
${memberList}

Tableros:
${boardList || '- (ninguno todavía)'}

Categorías de lista:
${wishlistCatList || '- (ninguna todavía)'}

Categorías de gastos:
${expenseCatList || '- (ninguna todavía)'}

Fecha de hoy: ${context.today}
Hemisferio: ${context.hemisphere === 'south' ? 'sur' : 'norte'}
Estación actual: ${context.season}

## Tus capacidades

### Consultas (herramientas nativas)
Podés buscar en los datos del hogar usando las herramientas de consulta (search_recipes, list_calendar_events, list_wishlist_items, list_boards, get_expense_summary). Usalas ANTES de responder cuando necesites datos reales del hogar.

### Acciones (vía respond_to_user.actionTools)
Podés proponer acciones que el usuario debe confirmar:

#### create_recipe
Crea una receta nueva en el recetario.
Parámetros: { title (string, requerido), ingredients (array de {name, quantity, unit}), instructions (array de strings), servings (integer), prepTimeMinutes (integer), cookTimeMinutes (integer) }

#### add_wishlist_items
Agrega items a una categoría de lista. IMPORTANTE: Usá EXACTAMENTE uno de los nombres/IDs de categoría del contexto.
Parámetros: { categoryName (string, DEBE ser uno de los de arriba), items (array de {name, quantity?, unit?, notes?}) }

#### create_expense
Registra un gasto.
Parámetros: { description (string), amount (number, en ARS), categoryName (string, intentá matchear con las de arriba), date (string YYYY-MM-DD, default hoy) }

#### create_calendar_event
Crea un evento en el calendario.
Parámetros: { title (string), startDate (string ISO), endDate (string ISO, opcional), allDay (boolean), description (string, opcional), recurrence ("none"|"daily"|"weekly"|"monthly"|"yearly") }

#### add_board_link
Guarda un link en un tablero.
Parámetros: { boardName (string, DEBE matchear con los de arriba), url (string), title (string, opcional) }

#### add_menu_item
Agrega una comida al menú semanal.
Parámetros: { recipeName (string, opcional), customName (string, opcional), date (string YYYY-MM-DD), mealType ("desayuno"|"almuerzo"|"merienda"|"cena") }

#### generate_shopping_list
Genera lista de compras desde el menú.
Parámetros: { menuPlanId (string) }

## Instrucciones CRÍTICAS

1. SIEMPRE terminá tu turno llamando a respond_to_user. Es OBLIGATORIO. Nunca respondas solo con texto.

2. Cuando necesites datos del hogar (recetas guardadas, eventos, items de lista, etc.), usá las herramientas de consulta ANTES de responder. No inventes datos del hogar.

3. Para recetas, sos un EXPERTO culinario. Podés:
   - Sugerir recetas nuevas basándote en tu conocimiento (no necesitás buscar en internet)
   - Adaptar recetas a la estación actual (${context.season})
   - Sugerir sustituciones de ingredientes
   - Dar tips de cocina y técnicas
   - Si no encontrás la receta en el recetario del hogar, SUGERÍ una receta nueva con ingredientes y pasos detallados

4. Si el usuario envía una FOTO:
   - MIRÁ LA IMAGEN atentamente. Podés ver imágenes directamente.
   - Si es una receta: extraé título, ingredientes con cantidades, instrucciones paso a paso, tiempos
   - Si es un ticket/recibo: extraé descripción, monto total, y sugerí una categoría de gasto
   - Si es comida: identificá el plato y ofrecé agregar la receta

5. Para listas de compras/wishlist: usá EXACTAMENTE los nombres de categoría que aparecen arriba. NO inventes categorías nuevas.

6. Las sugerencias (suggestions) deben ser 2-4 opciones cortas y relevantes. En español argentino, máximo 40 caracteres.

7. Si el usuario pide algo que no podés hacer, explicalo amablemente y sugerí alternativas.

8. Cuando propongas crear una receta, sé detallado con los ingredientes (cantidad + unidad + nombre) y las instrucciones (pasos claros y numerados).`;
};

// ==================== Message Building ====================

/**
 * Build Claude messages array from conversation history + current message.
 * Handles images as proper vision content blocks.
 */
const buildClaudeMessages = (history, currentMessage, currentImageUrls) => {
  const messages = [];

  for (const msg of history) {
    if (msg.role === 'user' && msg.imageUrls && msg.imageUrls.length > 0) {
      const content = [];
      for (const url of msg.imageUrls) {
        content.push({
          type: 'image',
          source: { type: 'url', url },
        });
      }
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      messages.push({ role: 'user', content });
    } else {
      messages.push({
        role: msg.role === 'system' ? 'assistant' : msg.role,
        content: msg.content || '',
      });
    }
  }

  // Add current message
  if (currentImageUrls && currentImageUrls.length > 0) {
    const content = [];
    for (const url of currentImageUrls) {
      content.push({
        type: 'image',
        source: { type: 'url', url },
      });
    }
    content.push({ type: 'text', text: currentMessage });
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: currentMessage });
  }

  // Ensure messages alternate user/assistant properly
  // Claude requires messages to alternate roles
  return consolidateMessages(messages);
};

/**
 * Ensure messages alternate between user and assistant roles.
 * Merges consecutive same-role messages.
 */
const consolidateMessages = (messages) => {
  if (messages.length === 0) return [];

  const result = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1];
    const curr = messages[i];

    if (prev.role === curr.role) {
      // Merge consecutive same-role messages
      const prevText = typeof prev.content === 'string' ? prev.content : prev.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const currText = typeof curr.content === 'string' ? curr.content : curr.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      result[result.length - 1] = {
        role: prev.role,
        content: `${prevText}\n\n${currText}`,
      };
    } else {
      result.push(curr);
    }
  }

  return result;
};

// ==================== Query Tool Execution ====================

const executeQueryTool = async (toolName, params, householdId) => {
  try {
    switch (toolName) {
      case 'search_recipes':
        return await searchRecipes(householdId, params);
      case 'list_calendar_events':
        return await listCalendarEvents(householdId, params);
      case 'list_wishlist_items':
        return await listWishlistItems(householdId, params);
      case 'list_boards':
        return await listBoards(householdId, params);
      case 'get_expense_summary':
        return await getExpenseSummary(householdId, params);
      default:
        return { error: `Herramienta desconocida: ${toolName}` };
    }
  } catch (err) {
    console.error(`Error executing query tool ${toolName}:`, err);
    return { error: `Error al ejecutar ${toolName}: ${err.message}` };
  }
};

// ==================== Main Chat Loop ====================

/**
 * Run the Claude chat loop with tool execution.
 *
 * @param {Object} params
 * @param {string} params.message - User's message
 * @param {string[]} params.imageUrls - Attached image URLs
 * @param {Object[]} params.history - Conversation history [{role, content, imageUrls?}]
 * @param {Object} params.context - Household context data
 * @param {string} params.householdId - Household ID for query tools
 * @returns {Promise<{reply: string, toolCalls: Array, suggestions: Array}>}
 */
const runChatLoop = async ({ message, imageUrls, history, context, householdId }) => {
  const systemPrompt = buildSystemPrompt(context);
  let claudeMessages = buildClaudeMessages(history, message, imageUrls);
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    let response;
    try {
      response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: claudeMessages,
        tools: allTools,
      });
    } catch (err) {
      if (err.status === 429) {
        throw new Error('El asistente está ocupado. Esperá un momento e intentá de nuevo.');
      }
      if (err.status === 529) {
        throw new Error('El servicio está temporalmente sobrecargado. Intentá en unos minutos.');
      }
      if (err.error?.type === 'invalid_request_error') {
        console.error('Claude invalid request:', err.message);
        throw new Error('No pude procesar tu mensaje. Intentá reformularlo.');
      }
      throw err;
    }

    // Check if Claude called respond_to_user
    const respondCall = response.content.find(
      (block) => block.type === 'tool_use' && block.name === 'respond_to_user'
    );

    if (respondCall) {
      return {
        reply: respondCall.input.reply || '',
        toolCalls: respondCall.input.actionTools || [],
        suggestions: respondCall.input.suggestions || [],
      };
    }

    // Check for query tool calls
    const toolUseCalls = response.content.filter((block) => block.type === 'tool_use');

    if (toolUseCalls.length === 0) {
      // Claude ended without tools — extract text as fallback
      const textContent = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      return {
        reply: textContent || 'No pude generar una respuesta. ¿Podés reformular tu pregunta?',
        toolCalls: [],
        suggestions: ['¿Qué podés hacer?', 'Sugerí una receta', 'Mostrame las listas'],
      };
    }

    // Execute query tools and build tool_result messages
    claudeMessages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const call of toolUseCalls) {
      const result = await executeQueryTool(call.name, call.input, householdId);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify(result),
      });
    }

    claudeMessages.push({ role: 'user', content: toolResults });
  }

  // Max iterations reached
  return {
    reply: 'Necesité demasiadas consultas para responder. ¿Podés ser más específico?',
    toolCalls: [],
    suggestions: ['Intentar de nuevo', '¿Qué podés hacer?'],
  };
};

module.exports = { runChatLoop };
