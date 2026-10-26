# theadoc

Collaborative Markdown documents with AI-generated interactive widgets. Documents sync through Automerge, remain available offline in IndexedDB, and are shared through unguessable edit links.

## Run locally with Docker

Requirements: Docker Engine with the Compose plugin.

```sh
cp .env.example .env
# Add a capped OPENROUTER_API_KEY to .env.
docker compose --env-file .env -f compose.local.yaml up --build
```

Open http://localhost:3000. The Automerge WebSocket server is exposed on `localhost:3030`, and persistent data is written to `./data`.

Stop the app with `Ctrl-C`, then remove the containers without deleting data:

```sh
docker compose --env-file .env -f compose.local.yaml down
```

## Native development

Requirements: Node.js 24 and npm.

```sh
cp .env.example .env
# Add an OPENROUTER_API_KEY to .env.
npm install
npm run dev
```

The development UI runs at http://localhost:5173, the API at `:3000`, and Automerge sync at `:3030`.

Checks:

```sh
npm run lint:fix
npm test
npm run build
```

## OpenRouter budget

Use a dedicated inference key rather than a management key. Create it in OpenRouter with a fixed USD limit and no reset; `$10` is the suggested demo ceiling. The application additionally allows two concurrent generations and queues ten.

The default model is `openai/gpt-5.6-terra`. Override it with `OPENROUTER_MODEL`.

## Ubuntu VPS deployment

The production target is Ubuntu 24.04 with Docker Engine, the Compose plugin, two DNS names, and provider-managed daily snapshots.

### 1. Prepare the host

Create a non-root deployment user and install Docker from Docker's official apt repository. Add the user to the `docker` group. Enable the firewall while preserving SSH:

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

Point DNS A records for both names at the VPS:

- `theadoc.example.com`
- `sync.theadoc.example.com`

Add AAAA records only if IPv6 is configured on the VPS.

### 2. Configure

Clone the repository, enter `private-demo`, and create the production environment:

```sh
cp .env.production.example .env
chmod 600 .env
mkdir -p data/automerge data/widgets
```

Set `APP_DOMAIN`, `SYNC_DOMAIN`, `ACME_EMAIL`, and the capped `OPENROUTER_API_KEY`. The application is intentionally public: possession of a document URL grants edit access, and no document index is exposed.

The container runs as UID 1000. On a new host, give it ownership of the data directory:

```sh
sudo chown -R 1000:1000 data
```

### 3. Start and verify

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f theadoc caddy
curl -fsS "https://$APP_DOMAIN/api/health"
curl -fsS "https://$SYNC_DOMAIN/"
```

Caddy obtains and renews TLS certificates. Only Caddy publishes host ports; application and sync ports remain inside the Compose network.

### Updates and rollback

Take a provider snapshot before an upgrade, then:

```sh
git pull --ff-only
docker compose up -d --build
```

To roll back, check out the previous known-good commit and run the same Compose command. Do not remove `data/` or run `docker compose down -v`.

### Backups

Enable daily snapshots in the VPS provider dashboard. For a manual portable data backup, briefly stop the writer and archive the bind mount:

```sh
docker compose stop theadoc
tar -czf "theadoc-data-$(date +%Y%m%d-%H%M%S).tar.gz" data
docker compose start theadoc
```

Copy the archive off the VPS. Restore by stopping theadoc, replacing `data/` from an archive, restoring ownership to UID 1000, and starting the service again.

## Storage

- Automerge repository: `/data/automerge`
- Immutable generated artifacts: `/data/widgets`
- Browser-local document cache: IndexedDB
- Browser-local recent list: localStorage

Generated code runs in a sandboxed iframe without same-origin access. Widget artifacts are immutable JSON files and are included alongside Markdown in portable `.theadoc.zip` exports.
