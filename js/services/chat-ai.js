/**
 * One chat request to the Worker, with the answer cleaned up. Shared by NutriSnap (meal_chat)
 * and NutriChef (recipe_chat) so both pages get the same reply shape.
 *
 * @module services/chat-ai
 */

import { askProxy } from './proxy.js';

const str = (v, max) => String(v ?? '').trim().slice(0, max);

/**
 * @param {'meal_chat'|'recipe_chat'} action
 * @param {object} payload  context plus the message history (see proxy/src/tasks.js)
 * @returns {Promise<{reply:string, suggestions:string[]}>}
 */
export async function askChat(action, payload) {
  const raw = await askProxy(action, payload);
  return {
    reply: str(raw.reply, 1500) || 'Sorry, I could not come up with an answer. Please try rephrasing.',
    suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : []).map((s) => str(s, 60)).filter(Boolean).slice(0, 3),
  };
}
