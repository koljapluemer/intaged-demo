# intaged demo

Markdown editor (Tiptap) where ` ```intaged ` code blocks are specs for small widgets
that OpenAI generates as sandboxed HTML/CSS/JS.

## Setup

```sh
cp .env.example .env        # set OPENAI_API_KEY; optional OPENAI_MODEL (default gpt-5.6-terra)
uv sync
(cd frontend && pnpm install)
```

## Run

- `just dev`: Flask on :5000 and Vite on http://localhost:5173
- `just build`: lint and build; then `uv run flask --app server run` serves the app on :5000

## How it works

- Documents are Markdown files in `documents/` (gitignored, seeded with `welcome.md`).
- Widget blocks are plain fenced code blocks with language `intaged`. The stock Tiptap
  CodeBlock handles parsing and serialization; `frontend/src/editor/CodeBlockView.vue`
  renders them as widgets.
- `POST /api/generate` calls the OpenAI Responses API with Structured Outputs
  (`{title, html, css, js}`). See `server/prompts.py` for the runtime contract.
- Widgets run in an `<iframe sandbox="allow-scripts">` with a CSP that blocks all network
  access. Runtime errors are reported back; one automatic repair request follows if the
  fresh widget throws.
- Generated code is cached in localStorage, keyed by a hash of the spec.
