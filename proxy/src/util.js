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
