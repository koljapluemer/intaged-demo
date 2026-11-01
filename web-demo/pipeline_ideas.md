# Pipeline ideas

Research and options for changing the widget generation pipeline (`server/generator.ts`). Nothing here is implemented unless noted. Measure before and after any change with the run log (see README, "Measuring and choosing a model").

Collected 2026-11-01. SDK facts were checked against the installed `ai@7.0.153`, `@ai-sdk/google@4.0.109` and `@openrouter/ai-sdk-provider@3.1.0`; recheck them after upgrading.

## Why runs sit in "Planning" with Gemini free tier

What "Planning" covers:

- `progress('Planning')` is set right before `agent.generate()`. The stage only changes when a tool starts running (`onToolExecutionStart` → `stageFor()` in `server/tools.ts`).
- For a new widget, `userPrompt()` tells the model to write everything in one `write_files` call. `generate()` doesn't stream, so a tool can only run after the whole response has arrived. "Planning" therefore covers thinking, writing every file as JSON tool arguments, and the round trip. This was already true with OpenRouter alone.

What makes Gemini free tier worse:

- **Silent SDK retries.** `maxRetries` defaults to 2, with 2s and 4s backoff, on 408, 409, 429 and 5xx (`ai/dist/index.js` ~2638). An HTTP `retry-after`/`retry-after-ms` header under 60s is honoured. The `RetryInfo.retryDelay` that Gemini puts in its error body is not read by the provider. A 429 costs about 6s. A slow 503 is restarted from zero, up to twice, all inside one step. These retries are logged as `model_call` events (implemented).
- **Capacity shedding.** The Google forums show many reports of 503 "model is overloaded" errors and slow or empty replies, including for paid `gemini-3.7-flash` projects.
- **Quotas.** Requests per minute, input tokens per minute, and requests per day, counted per project. Every agent step resends the whole history, so one run uses a lot of the token budget. When the daily cap is used up, every request returns 429.
- **No per-step timeout.** `generationTimeoutMs` (300s) is a total limit only. A stalled Gemini call can keep "Planning" up for 5 minutes. The OpenRouter fallback then starts from an empty workspace.
- Queued jobs show "Waiting to start", not "Planning" (`server/jobs.ts`), so concurrency is not the cause.

## SDK capabilities (verified in the installed versions)

- **`maxRetries`** can be set on `ToolLoopAgent` settings or per call (`RequestOptions`). `0` disables the silent retries.
- **`timeout`** is a `TimeoutConfiguration`: a number (meaning `totalMs`), or `{ totalMs, stepMs, firstChunkMs, chunkMs, toolMs, tools: { <name>Ms } }`.
  - With `generate()`, only `totalMs` and `stepMs` take effect. `firstChunkMs` and `chunkMs` only log an "unsupported" warning.
  - `stepMs` covers model generation, retries and tool execution, and aborts with `DOMException('TimeoutError')`. The generator's `isTimeout()` already handles that, so the salvage-or-fallback path would work unchanged.
- **Streaming** (`agent.stream()`): `firstChunkMs` is cleared by any non-empty text, reasoning or tool-input delta, or by a tool call. Gemini only sends reasoning if `thinkingConfig.includeThoughts: true` is set (it isn't today). `streamRetries` defaults to 0.
- **Streaming tool-call arguments for Gemini is Vertex-only.** On the Gemini API, `streamFunctionCallArguments` is ignored with a warning, so `write_files` arrives in one piece at the end of the step even when streaming. Streaming can't show "Drawing" earlier on Gemini.
- **Switching models mid-loop**: `prepareStep` can return a different `model` per step. When GPT tool calls are replayed to Gemini 3 without thought signatures, the Google provider inserts the documented `skip_thought_signature_validator` placeholder instead of failing with a 400.
- **Cost**: OpenRouter's `usage.cost` is exposed as `providerMetadata.openrouter.usage.cost`. It's logged per step as `costUsd` (implemented).

### Cheap fixes for the Planning problem
1. `timeout: { totalMs: 300_000, stepMs: N }` on the Gemini route, with N chosen from the observed step-0 `ms`. A stalled Gemini step then falls back after N instead of 300s.
2. `maxRetries: 0` on the Gemini route, so a 429 or 503 goes straight to OpenRouter.
3. Optional: stream with `includeThoughts: true` and `firstChunkMs`, to catch a call that never starts producing output. More work, and the UI still shows "Planning" until the tool call is complete.

## Which steps suit Gemini free tier

| Work | Token profile | User waiting? | Free-tier fit |
|---|---|---|---|
| Step 0, new widget: design and write all files in one `write_files` | Mostly output and reasoning, one very large request | Yes ("Planning") | **Worst**, and it's what Gemini runs today |
| Build-fix steps (step 1+), `edit_files` against diagnostics | Mostly input (whole history resent), small output; on OpenRouter mostly served from the prompt cache | Yes | OK, low savings |
| `search_packages` / `package_docs` | Doc results up to 12k characters, resent on every later step | Yes | Good, if split out |
| Continuations: spec edits and client-reported runtime errors (`previous` set) | Starts fresh from the previous source, usually smaller edits | Yes | Good |

The fixed prompt is small (system prompt plus tool schemas, about 2–3k tokens). Most of the spend is likely step-0 output and reasoning. Check the per-step split in the run log before moving work around: if step 0 dominates, moving the other parts to Gemini saves little.

Options, best fit first:
1. **Send continuations and runtime-error fixes to Gemini, new widgets to OpenRouter.** A routing switch on `input.previous` in `WidgetGenerator`.
2. **Have Gemini condense package docs.** `package_docs` calls Gemini (short timeout, `maxRetries: 0`) to cut the README and `.d.ts` down to what the spec needs. On failure it returns the truncated raw docs, as now.
3. **Switch build-fix steps to Gemini via `prepareStep`.** Possible (see above), but you lose the OpenRouter cache, every fix step waits on Gemini, and quality is unknown when Gemini edits code GPT wrote. Low priority.
4. **Hedged race.** Start Gemini. If it hasn't finished after X seconds, also start OpenRouter on its own workspace, keep whichever builds first, and abort the other. OpenRouter is only paid when Gemini is slow, and slow Gemini work is never thrown away halfway.

Not worth it: a separate Gemini "planning" call before GPT writes the code. It adds a free-tier request to the critical path, and GPT already runs at low reasoning effort.

## Prior art

### Composite pipelines: one main model, cheap fixers around it
- **Vercel v0, "How we made v0 an effective coding agent"** (Jan 2026):
  - a dynamic system prompt (SDK knowledge injected only when relevant, kept stable for prompt-cache hits),
  - **"LLM Suspense"**: deterministic find-and-replace on the output while it streams (bad imports, lucide icons that no longer exist) in under 100ms with no model call,
  - **autofixers**: deterministic first, a model for problems that span files or need AST analysis.

  https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent
- **v0 composite model family**: the base model can be swapped behind a fixed pipeline. The fix pass uses `vercel-autofixer-01`, a small model trained with reinforcement fine-tuning that Vercel says is on par with gemini-2.5-flash at 10–40× the speed (Fireworks' table: 86% vs 89.6% error-free). https://vercel.com/blog/v0-composite-model-family · https://fireworks.ai/blog/vercel
- Lesson: much of the reliability comes from deterministic code or a very small model, not from a second agent turn.

### Separating planning from editing
- **Aider architect/editor**: a strong model works out the change, a cheaper model writes the edits. o1-preview with DeepSeek or o1-mini scored 85% on Aider's benchmark (state of the art in Sept 2024). https://aider.chat/2024/09/26/architect.html
- **Fast-apply models**: the large model writes a short edit, and a small model merges it into the file.
  - Cursor "Instant Apply": a fine-tuned 70B model at about 1000 tok/s using speculative edits, which predict most of the output from the original file. https://cursor.com/blog/instant-apply
  - Morph Fast Apply: OpenAI-compatible, about $0.80–1.20 per million tokens, claims 4,500–10,500 tok/s, no tool calls. https://morphllm.com/fast-apply-model · https://docs.morphllm.com/introduction
- Lesson: step 0 makes one model both design the widget and write every file. These patterns split that.

### Minimal loops and pipelines with no agent loop
- **Agentless**: a fixed pipeline (find the location, generate patches, filter and rerank) with no model-driven loop. $0.34 per issue vs $3.34 for agents on SWE-bench Lite in the paper; later measured at about $0.70. https://huggingface.co/papers/2407.01489
- **mini-swe-agent**: about 100 lines, bash only, a linear history, competitive scores. GPT-5-mini gives up about 5 points for much cheaper runs. https://www.swebench.com/post-250808-gpt5.html
- **Anthropic, "Building effective agents"**: fixed workflows (chaining with gates, routing, parallelization, evaluator-optimizer) vs open-ended agents. Start with the simplest workflow that works. https://www.anthropic.com/research/building-effective-agents
- Lesson: our loop is already close to a workflow (write → build → fix). Making the stages explicit lets each one have its own model, timeout and fallback.

### Are repair loops worth paying for?
- **Olausson et al., "Is Self-Repair a Silver Bullet for Code Generation?"** (ICLR 2024). Counting the cost of repair, gains are small, uneven, and sometimes zero. At small budgets, fresh samples often match or beat repair. Feedback quality is the bottleneck, and feedback from a stronger model helps a lot. https://arxiv.org/abs/2306.09896
- Lesson: several fix steps with a weak model may cost more than one fresh attempt. Measure steps per run against success.

### Routing and cascades
- **FrugalGPT** (cascade: cheap models first, escalate when needed) reports matching GPT-4 at up to 98% lower cost on general benchmarks. https://huggingface.co/papers/2305.05176
- **RouteLLM** (one model chosen per query in advance) reports over 85% savings on MT-Bench. https://shekhargulati.com/2024/07/09/routellm-paper/
- Caveat: not measured on multi-step coding agents, where a cheap model's errors build up.

### Faster inference instead of cheaper inference
- Diffusion LLMs: Mercury Coder runs at about 737–1109 tok/s (Artificial Analysis) but trails similar small autoregressive models on quality. Nothing found that measures them inside agent loops. https://www.deeplearning.ai/the-batch/mercury-coder-may-be-the-first-commercially-available-language-diffusion-model/
- Cerebras and Groq: about 2,000 tok/s claimed for Qwen3 Coder on Cerebras, and contested benchmarks between the two. Speed only helps if generation is where the time goes. https://www.morphllm.com/cerebras-pricing · https://the-decoder.com/nvidia-says-its-groq-3-lpx-is-four-times-faster-than-cerebras-but-the-math-is-more-complicated/
- The README already notes Cerebras via OpenRouter (`:nitro`, `openai/gpt-oss-120b`) as an option for raw speed.

### Small specialized UI models
- Tesslate UIGEN (Apache-2.0): 4B–14B Qwen fine-tunes for HTML, Tailwind and React, including a version trained with RL on accessibility and Lighthouse scores. Research previews with no benchmark numbers, limited to basic UIs. https://featherless.ai/models/Tesslate/UIGEN-FX-4B-Preview

### Takeaways
1. The proven pattern is a strong model for one large generation, plus deterministic fixes and a small or fast model for repairs.
2. Deterministic fixes before any LLM repair: the bundler already returns diagnostics, so common errors (imports, missing packages) could be patched in code.
3. A free or cheap model fits best as the editor for small edits, not as the from-scratch designer.
4. Measure whether fix steps beat a fresh attempt.

## Measurement process (next steps, not implemented)

- **Benchmark spec set**: `bench/specs/*.md` with 10–15 specs (chart, map, form, 3D, a package outside the preinstalled set, a continuation with an injected runtime error). A `just bench` script runs `WidgetGenerator` directly (it accepts injected `routes`) and writes each artifact plus a summary table (built, attempts, steps, `planningMs`, time, tokens, $, fallback). Quality is rated by hand in a `rating` column.
- **Experiment log**: one entry per change:
  ```
  ## E-001 Gemini stepMs=90s + maxRetries=0   (date, generatorVersion)
  Hypothesis: …  Baseline: settingsHash … / bench run …
  Result: …  Decision: keep / revert / follow-up
  ```
- Bump `GENERATOR_VERSION` whenever prompt or pipeline behaviour changes. `settingsHash` in the run log covers settings and prompt changes automatically.

## Sources (other)
- Gemini rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- 503 reports: https://discuss.ai.google.dev/t/persistent-503-unavailable-for-paid-gemini-3-7-flash-project/183055 · https://discuss.ai.google.dev/t/error-the-model-is-overloaded/48410 · https://discuss.ai.google.dev/t/handling-429-503-errors-from-the-gemini-api/124640
- Thought signatures: https://ai.google.dev/gemini-api/docs/thought-signatures
