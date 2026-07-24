"""FastAPI app: JSON API + photo serving + the built TanStack UI.

Preserves the original endpoints (``GET /api/cellar``, ``POST /api/cellar/items``,
``POST /api/cellar/items/{id}/adjust``, ``GET /health``) and adds the richer
agent-platform surface. Binds to localhost; tailnet access goes through
``tailscale serve`` (see scripts/install_launchagent.sh).
"""

from __future__ import annotations

import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, core, db

UI_DIST = Path(__file__).resolve().parent.parent / "ui" / "dist" / "client"


@asynccontextmanager
async def lifespan(_: FastAPI):
    connection = db.open_db()
    connection.close()
    yield


app = FastAPI(title="Wine Cellar", lifespan=lifespan)


def get_conn():
    conn = db.open_db()
    try:
        yield conn
    finally:
        conn.close()


def _wrap(operation, *args, **kwargs) -> Any:
    try:
        return operation(*args, **kwargs)
    except ValueError as error:
        message = str(error)
        status = 404 if message.startswith("no wine with id") else 400
        raise HTTPException(status_code=status, detail=message) from error


# ---------------------------------------------------------------------------
# Request models


class CellarItemCreate(BaseModel):
    producer: str
    wine_name: str
    vintage: str = ""
    country: str = ""
    region: str = ""
    appellation: str = ""
    varietal: str = ""
    wine_type: str = ""
    grapes: str = ""
    source_app: str = "manual"
    cellartracker_wine_id: str = ""
    photo_ref: str = ""
    quantity: int = Field(default=1, ge=0)
    bottle_size_ml: int | None = Field(default=750, ge=1)
    location: str = ""
    acquired_from: str = ""
    acquired_price: float | None = Field(default=None, ge=0)
    drinking_window_start: str = ""
    drinking_window_end: str = ""
    notes: str = ""


class InventoryAdjustment(BaseModel):
    delta: int
    reason: str = ""
    event_type: str = "adjust"


class PurchaseCreate(BaseModel):
    quantity: int = Field(ge=1)
    price_per_bottle: float | None = Field(default=None, ge=0)
    currency: str = "USD"
    vendor: str = ""
    purchase_date: str = ""
    source: str = "other"
    notes: str = ""


class TastingCreate(BaseModel):
    user: str | int | None = None
    rating: int | None = Field(default=None, ge=0, le=100)
    tasting_notes: str = ""
    food_pairing: str = ""
    context_type: str = "home"
    venue: str = ""
    price_paid: float | None = Field(default=None, ge=0)
    liked: bool | None = None
    buy_again: bool | None = None
    tasted_on: str = ""
    consume_bottle: bool = True


# ---------------------------------------------------------------------------
# Original endpoints (shape-compatible with the old app)


@app.get("/api/cellar")
def api_cellar(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=250),
    q: str | None = None,
    wine_type: str | None = None,
    country: str | None = None,
    region: str | None = None,
    vintage: str | None = None,
    in_stock: bool = True,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    return core.list_inventory(
        conn,
        page=page,
        page_size=page_size,
        q=q,
        wine_type=wine_type,
        country=country,
        region=region,
        vintage=vintage,
        in_stock=in_stock,
    )


@app.post("/api/cellar/items", status_code=201)
def create_cellar_item(
    item: CellarItemCreate, conn: sqlite3.Connection = Depends(get_conn)
) -> dict[str, Any]:
    fields = item.model_dump()
    quantity = fields.pop("quantity")
    price = fields.pop("acquired_price")
    vendor = fields.pop("acquired_from")
    wine = _wrap(core.add_wine, conn, **fields)
    if quantity > 0:
        wine = _wrap(
            core.log_purchase,
            conn,
            wine["id"],
            quantity,
            price_per_bottle=price,
            vendor=vendor or None,
        )
    return wine


@app.post("/api/cellar/items/{item_id}/adjust")
def adjust_inventory(
    item_id: int,
    adjustment: InventoryAdjustment,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    return _wrap(
        core.adjust_inventory,
        conn,
        item_id,
        adjustment.delta,
        reason=adjustment.reason.strip() or None,
        event_type=adjustment.event_type,
    )


@app.get("/health")
def health(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    stats = core.summary(conn)
    return {
        "ok": True,
        "db": str(config.db_path()),
        "bottles": stats["labels"]["bottles"],
        "labels": stats["labels"]["labels"],
    }


# ---------------------------------------------------------------------------
# Agent-platform endpoints


@app.get("/api/wines/{wine_id}")
def api_wine(wine_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    return _wrap(core.get_wine, conn, wine_id)


@app.post("/api/wines/{wine_id}/purchases", status_code=201)
def api_log_purchase(
    wine_id: int, purchase: PurchaseCreate, conn: sqlite3.Connection = Depends(get_conn)
) -> dict[str, Any]:
    return _wrap(
        core.log_purchase,
        conn,
        wine_id,
        purchase.quantity,
        price_per_bottle=purchase.price_per_bottle,
        currency=purchase.currency,
        vendor=purchase.vendor.strip() or None,
        purchase_date=purchase.purchase_date.strip() or None,
        source=purchase.source,
        notes=purchase.notes.strip() or None,
    )


@app.post("/api/wines/{wine_id}/tastings", status_code=201)
def api_log_tasting(
    wine_id: int, tasting: TastingCreate, conn: sqlite3.Connection = Depends(get_conn)
) -> dict[str, Any]:
    return _wrap(
        core.log_tasting,
        conn,
        wine_id,
        user=tasting.user,
        rating=tasting.rating,
        tasting_notes=tasting.tasting_notes.strip() or None,
        food_pairing=tasting.food_pairing.strip() or None,
        context_type=tasting.context_type,
        venue=tasting.venue.strip() or None,
        price_paid=tasting.price_paid,
        liked=tasting.liked,
        buy_again=tasting.buy_again,
        tasted_on=tasting.tasted_on.strip() or None,
        consume_bottle=tasting.consume_bottle,
    )


@app.get("/api/stats")
def api_stats(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    return core.cellar_stats(conn)


@app.get("/api/drink-now")
def api_drink_now(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    return core.drinking_window_alerts(conn)


@app.get("/api/tastings")
def api_tastings(
    limit: int = Query(default=200, ge=1, le=1000),
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[dict[str, Any]]:
    return core.tasting_history(conn, limit=limit)


@app.get("/api/wishlist")
def api_wishlist(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    return core.wishlist_list(conn)


@app.get("/photos/{filename}")
def api_photo(filename: str) -> FileResponse:
    # Photo paths are bare generated filenames; reject traversal.
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="not found")
    path = config.photos_dir() / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(path)


# ---------------------------------------------------------------------------
# Built UI (SPA) — mounted last so /api and /photos win.

if UI_DIST.is_dir():
    # TanStack Start's SPA build emits the app shell as _shell.html.
    SHELL = "_shell.html" if (UI_DIST / "_shell.html").is_file() else "index.html"

    class SpaStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope):  # type: ignore[override]
            if path in ("", "."):
                return await super().get_response(SHELL, scope)
            try:
                response = await super().get_response(path, scope)
            except StarletteHTTPException as error:
                if error.status_code != 404:
                    raise
                return await super().get_response(SHELL, scope)
            if response.status_code == 404:
                return await super().get_response(SHELL, scope)
            return response

    app.mount("/", SpaStaticFiles(directory=UI_DIST, html=True), name="ui")


def main() -> None:
    uvicorn.run(app, host=config.web_host(), port=config.web_port())


if __name__ == "__main__":
    main()
