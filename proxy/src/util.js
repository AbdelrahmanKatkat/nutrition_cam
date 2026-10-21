/**
 * Small helpers shared by the Worker modules.
 */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Clean one line of untrusted text: strip control characters and angle brackets (so it cannot
 * close the tag it is fenced in), collapse whitespace, and cap the length.
 */
export function cleanLine(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Same as cleanLine but keeps line breaks (used for recipe instructions). */
export function cleanBlock(value, max) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

const MAX_HISTORY = 8;      // last N chat messages are sent to the model
const MAX_MESSAGE = 600;    // characters per message

/**
 * Clean a chat history from the browser. Returns turns shaped for the model ({role, text}),
 * starting with a user turn and ending with the user's new message, or null if that is not the case.
 */
export function cleanHistory(messages) {
  const history = (Array.isArray(messages) ? messages : []).slice(-MAX_HISTORY)
    .map((m) => ({ role: m?.role === 'assistant' ? 'model' : 'user', text: cleanLine(m?.text, MAX_MESSAGE) }))
    .filter((m) => m.text);
  while (history.length && history[0].role !== 'user') history.shift(); // the model requires a user turn first
  if (!history.length || history[history.length - 1].role !== 'user') return null;
  return history;
}
