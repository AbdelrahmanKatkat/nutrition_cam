# Adding Agentic AI to NutriSnap

Today the app is a **fixed pipeline**: photo → Gemini → Open Food Facts → render. An *agent* instead decides
**which steps to take** based on what it sees, can call tools, check its own work, and ask the user questions.

## Why bother

| Pipeline today | Agent could |
|---|---|
| One guess for the whole plate | Identify each item, look each up, sum the results |
| Silently returns a low-confidence guess | Notice low confidence and ask "Is that rice or couscous?" |
| Barcode OR meal search | Choose: barcode visible? → OFF lookup. Packaged item? → search by brand. Home-cooked? → estimate |
| Single day, no memory | Compare with today's total and goal, suggest a lighter dinner |

## Target architecture

```
Browser (static site)  ──HTTPS──►  Agent backend (small serverless function)  ──►  Gemini (LLM, tool-calling)
   js/services/agent.js              holds API key, runs the loop                  │
                                                                                   ├─ tool: identify_items(image)
                                                                                   ├─ tool: search_off(query)
                                                                                   ├─ tool: get_off_by_barcode(code)
                                                                                   ├─ tool: estimate_portion(item, image)
                                                                                   └─ tool: get_daily_log() / save_meal()
```

**The agent loop must run on a backend, not in the static page**: it needs a secret key, and multi-step loops
need rate limiting. This also solves the key-exposure problem described in [IMPROVEMENTS.md](IMPROVEMENTS.md#1-security-do-this-before-sharing-the-site-publicly).
GitHub Pages stays as the front end.

## Step-by-step plan

### Step 1 – Put a proxy in front (no agent yet) — ✅ done
The Cloudflare Worker in [`proxy/`](../proxy/README.md) already holds the key and calls Gemini; `predictMeal()` in
`js/services/gemini.js` calls it. The agent loop below can live in this same Worker (add routes/tools to `proxy/src/index.js`).

### Step 2 – Turn existing calls into tools
Expose what the app already does as **function declarations** for Gemini function calling:

```jsonc
{
  "name": "search_off",
  "description": "Search Open Food Facts for a food product by name. Returns nutrition per 100 g.",
  "parameters": {
    "type": "OBJECT",
    "properties": { "query": { "type": "STRING" } },
    "required": ["query"]
  }
}
```

Implement the same logic as `searchProduct` / `getProductByBarcode` server-side (or reuse the modules – they are plain `fetch` code).

### Step 3 – The loop

Pseudocode for the backend (works with any tool-calling LLM):

```js
const tools = { identify_items, search_off, get_off_by_barcode, estimate_portion };

async function runAgent(image, userContext) {
  const messages = [systemPrompt, userMessage(image, userContext)];
  for (let step = 0; step < MAX_STEPS; step++) {          // hard cap: cost + safety
    const reply = await llm.generate({ messages, tools: Object.keys(tools) });
    if (!reply.toolCalls?.length) return parseFinalAnswer(reply);   // structured JSON

    for (const call of reply.toolCalls) {
      const result = await tools[call.name](call.args);   // validate args first
      messages.push(toolResult(call, result));
    }
  }
  throw new Error('Agent step limit reached');
}
```

Guidelines:
- **Cap steps and tokens** (e.g. 6 steps) and set a per-user rate limit.
- **Validate tool arguments**; tools are read-only at first (no write tools until Step 5).
- Keep the **final output schema** identical to `MealPrediction` in `gemini.js`, so the UI doesn't change. Add optional fields (`items[]`, `questions[]`) later.
- Log each step (tool, args, result size) – you will need it to debug.

### Step 4 – Let the agent ask questions
Add an optional `followUpQuestion` to the response. In the UI, render it as chips ("Rice", "Couscous"); the
selected answer is sent back and the loop resumes with it. Only `app.js` / `ui.js` need a small "needs input" state.

### Step 5 – Memory & goals (optional)
Add tools `get_daily_log` and `save_meal` backed by a small DB (Firestore, Supabase, Cloudflare D1) with user auth.
This enables coaching-style answers. Treat as personal health data: get consent, allow deletion.

## Frameworks (optional)

Hand-rolling the loop above is ~50 lines and the best way to learn. If it grows, consider the
**Google Agent Development Kit (ADK)**, **LangGraph**, or the **Vercel AI SDK** – all support tool calling with Gemini.

## Evaluating the agent

Build a small test set (20–50 photos with known calories/ingredients). Track: mean absolute calorie error,
tool-call count per scan, cost per scan, and % of scans that ask a follow-up. Compare against the plain pipeline
before shipping – an agent that costs 5× more but is not more accurate is not an improvement.

## Frontend changes summary

| File | Change |
|---|---|
| `js/services/agent.js` (new) | `analyzeMeal(image, context)` → calls the backend, same return shape as `predictMeal` |
| `js/config.js` | `agent.endpoint` URL and an `agentMode` flag |
| `js/app.js` | Choose `agent.analyzeMeal` vs `predictMeal`; handle `followUpQuestion` |
| `js/ui.js` | Render per-item breakdown and follow-up chips |
