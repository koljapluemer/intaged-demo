# Run Flask (:5000) and Vite (:5173) together; Ctrl-C stops both.
dev:
    #!/usr/bin/env bash
    trap 'kill 0' EXIT
    uv run flask --app server run --debug --port 5000 &
    (cd frontend && npm run dev) &
    wait

# Lint and build everything; afterwards `uv run flask --app server run` serves the built app.
build:
    uv run ruff check --fix server
    uv run ruff format server
    cd frontend && npm run lint:fix && npm run build
