# Wine Cellar

Agent-managed wine cellar on a Mac mini: a SQLite core with an MCP server and CLI
for AI agents (Hermes), and a FastAPI + TanStack Start web UI for humans.

```text
Hermes (label photos, receipts, free text) ──MCP (stdio)──┐
scripts / debugging ─────────────────────────── cellar CLI ┼─► cellar/ core ─► SQLite + photos
phone / laptop over Tailscale ───────── FastAPI :8788 ─────┘   ~/.local/share/cellar/
                                          └─ serves the built TanStack UI + JSON API
```

Agents do all the writing (logging purchases, tastings, photos); the web UI is
read-only.

## Layout

- `cellar/` — Python package
  - `db.py` — schema + versioned migrations (adopts an old `wine_tracker.db` in place)
  - `core.py` — all operations; keeps `wines.quantity` consistent with the
    `inventory_events` ledger in one transaction
  - `mcp_server.py` — `cellar-mcp`, stdio MCP server for agents
  - `cli.py` — `cellar`, same operations as JSON-printing subcommands
  - `web.py` — `cellar-web`, FastAPI app + static UI serving
- `ui/` — TanStack Start + shadcn UI, built in SPA mode
- `scripts/` — launchd install/uninstall
- `docs/hermes-cellar-manager.md` — instruction snippet for the Hermes agent

## Data model

`wines` (labels + cached `quantity`) · `purchases` (price/vendor/date history) ·
`inventory_events` (auditable ledger; every quantity change has an event) ·
`tastings` (consumption + review: rating 0-100, notes, pairing, per-user) ·
`users` (multi-reviewer ready) · `photos` (label/receipt images) · `wishlist`.

Data lives in `~/.local/share/cellar/` (`cellar.db`, `photos/`). Override with
`CELLAR_DATA_DIR`. A `wine_tracker.db` from the old single-file app can be
renamed to `cellar.db` and dropped there — migrations upgrade it in place and
synthesize purchase/event history for existing stock.

## Setup

```bash
uv sync                 # Python env + entry points in .venv/bin/
cd ui && npm install && npm run build && cd ..
uv run pytest           # 15 tests
```

## Run

```bash
.venv/bin/cellar-web    # http://127.0.0.1:8788 (UI + API)
```

Continuously, via launchd:

```bash
scripts/install_launchagent.sh    # com.shuyang.cellar; logs in ~/Library/Logs/cellar/
```

Environment: `CELLAR_PORT` (default 8788), `CELLAR_HOST` (default 127.0.0.1),
`CELLAR_DATA_DIR`.

### Phone access (Tailscale)

The app binds to localhost; expose it to your tailnet with:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:8788
```

Then open `https://<machine-name>.<tailnet>.ts.net` from any tailnet device.

## Agent integration (Hermes)

```bash
hermes mcp add cellar --command "$PWD/.venv/bin/cellar-mcp"
hermes mcp test cellar
```

Tools: `find_wine`, `add_wine`, `update_wine`, `log_purchase`, `log_tasting`,
`adjust_inventory`, `get_wine`, `list_inventory`, `cellar_stats`,
`drinking_window_alerts`, `attach_photo`, `wishlist_add`, `wishlist_list`,
`query` (read-only SQL). Conventions: ISO dates, ratings 0-100, prices per
bottle. See `docs/hermes-cellar-manager.md` for the recommended agent
instructions (dedupe with `find_wine` before adding, enrich before logging).

## CLI

```bash
cellar find "barbaresco 2019"
cellar add-wine "Produttori del Barbaresco" "Barbaresco" --vintage 2019 \
  --wine-type red --country Italy --region Piedmont --varietal Nebbiolo
cellar buy 1 3 --price 42 --vendor "K&L" --source online
cellar taste 1 --rating 92 --notes "tar and roses" --pairing "braised short rib"
cellar list -q nebbiolo
cellar drink-now
cellar stats
cellar query "SELECT producer, AVG(rating) FROM tastings t JOIN wines w ON w.id=t.wine_id GROUP BY 1"
```

## API

Original endpoints (kept): `GET /api/cellar`, `POST /api/cellar/items`,
`POST /api/cellar/items/{id}/adjust`, `GET /health`.

Added: `GET /api/wines/{id}` (full dossier), `POST /api/wines/{id}/purchases`,
`POST /api/wines/{id}/tastings`, `GET /api/stats`, `GET /api/drink-now`,
`GET /api/tastings`, `GET /api/wishlist`, `GET /photos/{filename}`.

## UI development

```bash
cd ui && npm run dev    # http://localhost:3000, proxies /api to :8788
```

`npm run build` emits `ui/dist/client/`, which `cellar-web` serves when present.
