# Wine Cellar

Local SQLite + FastAPI backend with a TanStack Start UI for a private cellar inventory view.

What the app does:
- FastAPI serves cellar data as JSON
- TanStack Start (in [`ui/`](ui/)) renders the browser UI (read-only)
- manager APIs for adding bottles and adjusting counts

Manager APIs:
- `GET /api/cellar` — summary + current inventory
- `POST /api/cellar/items` — add a cellar item
- `POST /api/cellar/items/<id>/adjust` — change bottle count after buys, openings, gifts, or moves

Run the backend:

```bash
cd /Users/shuyangli/src/wine-tracker
/Users/shuyangli/.hermes/hermes-agent/venv/bin/python -m uvicorn app:app --host 0.0.0.0 --port 8787
```

Run the UI (in a separate shell):

```bash
cd ui
npm install
npm run dev   # http://localhost:3000
```

The Vite dev server proxies `/api` and `/health` to the FastAPI backend on `:8787`.

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Database path:
- `/Users/shuyangli/src/wine-tracker/data/wine_tracker.db`
