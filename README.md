# Wine Cellar

Local SQLite + FastAPI app for a private cellar inventory view.

What the app does:
- shows what is currently in the cellar
- keeps the browser UI read-only
- exposes manager APIs for adding bottles and adjusting counts

Manager APIs:
- `GET /api/cellar` — summary + current inventory
- `POST /api/cellar/items` — add a cellar item
- `POST /api/cellar/items/<id>/adjust` — change bottle count after buys, openings, gifts, or moves

Run with Hermes venv:

```bash
cd /Users/shuyangli/src/wine-tracker
/Users/shuyangli/.hermes/hermes-agent/venv/bin/python -m uvicorn app:app --host 0.0.0.0 --port 8787
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Database path:
- `/Users/shuyangli/src/wine-tracker/data/wine_tracker.db`
