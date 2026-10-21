/**
 * NutriChat: the chat panel shared by NutriSnap and NutriChef.
 *
 * It owns the panel's DOM (#chat-log, #chat-chips, #chat-form, #chat-input, #chat-send, #chat-sub),
 * the conversation history, the busy state and the cooldown check. Each page supplies only what is
 * specific to it: how to ask (with its own context) and how to wait/notify.
 *
 * @module chat
 */

import { $, esc, mdLite } from './dom.js';

/**
 * @param {object} options
 * @param {(history: {role:'user'|'assistant', text:string}[]) => Promise<{reply:string, suggestions:string[]}>} options.ask
 *        sends the history (ending with the new user message) with the page's own context
 * @param {() => number} options.secondsToWait  seconds until another AI request is allowed (0 = go)
 * @param {() => void}   options.startCooldown  called when a request starts
 * @param {(err: Error) => string} options.errorText  friendly text for a failed request
 * @param {(message: string, isError: boolean) => void} options.notify  page-level message (cooldown)
 * @param {number} options.maxChars  longest message the user can send
 */
export function setupChat({ ask, secondsToWait, startCooldown, errorText, notify, maxChars }) {
  const history = [];   // what the model sees: strictly alternating user / assistant
  let busy = false;
  let generation = 0;   // bumped on reset so a late answer never lands in a newer conversation
  let chips = [];       // suggestions shown when the model returns none, and after an error

  const input = $('chat-input');
  input.maxLength = maxChars;

  function renderChips(list) {
    $('chat-chips').innerHTML = list
      .map((t) => `<button type="button" class="chip" data-q="${esc(t)}">${esc(t)}</button>`).join('');
  }

  function addMessage(role, text) {
    const log = $('chat-log');
    const el = document.createElement('div');
    el.className = `msg msg--${role}`;
    el.innerHTML = role === 'user'
      ? `<p><b>You:</b> ${esc(text)}</p>`
      : `<img class="msg__avatar" src="assets/nutri-ai.svg" alt="" width="32" height="32"><div class="msg__text">${mdLite(text)}</div>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function setTyping(on) {
    const existing = $('chat-typing');
    if (!on) { existing?.remove(); return; }
    if (existing) return;
    const el = document.createElement('div');
    el.id = 'chat-typing';
    el.className = 'msg msg--ai';
    el.innerHTML = '<img class="msg__avatar" src="assets/nutri-ai.svg" alt="" width="32" height="32"><div class="msg__text typing"><span></span><span></span><span></span></div>';
    $('chat-log').appendChild(el);
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
  }

  function setBusy(on) {
    busy = on;
    $('chat-send').disabled = on || input.disabled;
    input.readOnly = on;
  }

  async function submit(raw) {
    const text = String(raw || '').trim().slice(0, maxChars);
    if (!text || busy || input.disabled) return;
    const wait = secondsToWait();
    if (wait) return notify(`Please wait ${wait}s before the next question.`, true);

    notify('', false);
    const mine = generation;
    setBusy(true);
    history.push({ role: 'user', text });
    addMessage('user', text);
    input.value = '';
    renderChips([]);
    setTyping(true);
    startCooldown();

    try {
      const answer = await ask([...history]);
      if (mine !== generation) return; // the conversation was reset meanwhile
      setTyping(false);
      history.push({ role: 'assistant', text: answer.reply });
      addMessage('ai', answer.reply);
      renderChips(answer.suggestions.length ? answer.suggestions : chips);
    } catch (err) {
      if (mine !== generation) return;
      setTyping(false);
      history.pop(); // keep the history strictly user/assistant alternating
      addMessage('ai', `Sorry, I couldn't answer that. ${errorText(err)} Please send your question again.`);
      renderChips(chips);
    } finally {
      if (mine === generation) setBusy(false);
    }
  }

  $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });
  $('chat-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-q]');
    if (chip) submit(chip.dataset.q);
  });

  return {
    /**
     * Start a fresh conversation.
     * @param {{enabled?:boolean, subtitle?:string, greeting?:string, chips?:string[]}} [opts]
     */
    reset({ enabled = true, subtitle = '', greeting = '', chips: next = [] } = {}) {
      generation += 1;
      history.length = 0;
      busy = false;
      chips = next;
      $('chat-log').innerHTML = '';
      $('chat-sub').textContent = subtitle;
      input.value = '';
      input.readOnly = false;
      input.disabled = !enabled;
      $('chat-send').disabled = !enabled;
      renderChips(enabled ? chips : []);
      if (enabled && greeting) addMessage('ai', greeting);
    },
  };
}
