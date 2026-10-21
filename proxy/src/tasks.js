/**
 * Task registry: each action the browser can request maps to a validator + prompt + schema.
 * `build(body)` returns { system, contents, schema } or { error, status } for bad input.
 * `kind` is the only thing recorded by the optional counter (never user content).
 */

import { SCAN_SYSTEM_PROMPT, SCAN_SCHEMA, buildScanUserPrompt, SNAP_CHAT_SYSTEM_PROMPT, buildSnapChatContents } from './prompts/scan.js';
import {
  ANALYSE_SYSTEM_PROMPT, ANALYSE_SCHEMA, buildAnalyseParts,
  CHAT_SYSTEM_PROMPT, CHAT_SCHEMA, buildChatParts,
  SEARCH_SYSTEM_PROMPT, SEARCH_SCHEMA, buildSearchParts,
  CREATE_SYSTEM_PROMPT, CREATE_SCHEMA, buildCreateParts,
} from './prompts/chef.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BASE64_CHARS = 4_000_000; // ≈ 3 MB image; the client already downsizes to ~1024 px

export const TASKS = {
  // NutriSnap: meal photo -> calories
  scan: {
    build({ image, mimeType, hint }) {
      if (typeof image !== 'string' || !image || image.length > MAX_BASE64_CHARS) {
        return { error: 'Image missing or too large', status: 413 };
      }
      if (!ALLOWED_MIME.has(mimeType)) return { error: 'Unsupported image type', status: 415 };
      return {
        system: SCAN_SYSTEM_PROMPT,
        contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: image } }, { text: buildScanUserPrompt(hint) }] }],
        schema: SCAN_SCHEMA,
      };
    },
    kind: (result) => (result.isFood === false ? 'not_food' : 'food'),
  },

  // NutriSnap: chat about the scanned meal (or general nutrition when nothing is scanned)
  meal_chat: {
    build({ context, messages }) {
      const contents = buildSnapChatContents(context, messages);
      if (!contents) return { error: 'A user message is required', status: 400 };
      return { system: SNAP_CHAT_SYSTEM_PROMPT, contents, schema: CHAT_SCHEMA };
    },
    kind: () => 'chat',
  },

  // NutriChef: recipe -> nutrition, vitamins, science, theory, steps
  recipe_analyse: {
    build({ recipe }) {
      const contents = buildAnalyseParts(recipe);
      if (!contents) return { error: 'A recipe with a title and ingredients is required', status: 400 };
      return { system: ANALYSE_SYSTEM_PROMPT, contents, schema: ANALYSE_SCHEMA };
    },
    kind: () => 'recipe',
  },

  // NutriChef: chat about the selected recipe
  recipe_chat: {
    build({ recipe, messages }) {
      const contents = buildChatParts(recipe, messages);
      if (!contents) return { error: 'A recipe and a user message are required', status: 400 };
      return { system: CHAT_SYSTEM_PROMPT, contents, schema: CHAT_SCHEMA };
    },
    kind: () => 'chat',
  },

  // NutriChef: natural-language request -> database searches
  recipe_search: {
    build({ query }) {
      const contents = buildSearchParts(query);
      if (!contents) return { error: 'A search request is required', status: 400 };
      return { system: SEARCH_SYSTEM_PROMPT, contents, schema: SEARCH_SCHEMA };
    },
    kind: () => 'recipe_search',
  },

  // NutriChef: write a recipe when the database has none
  recipe_create: {
    build({ query }) {
      const contents = buildCreateParts(query);
      if (!contents) return { error: 'A recipe request is required', status: 400 };
      return { system: CREATE_SYSTEM_PROMPT, contents, schema: CREATE_SCHEMA };
    },
    kind: () => 'recipe_create',
  },
};
