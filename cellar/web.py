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
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config, core, db

UI_DIST = Path(__file__).resolve().parent.parent / "ui" / "dist" / "client"


@asynccontextmanager
async def lifespan(_: FastAPI):
    connection = db.open_db()
    connection.close()
    yield


app = FastAPI(title="Wine Cellar", lifespan=lifespan)


def cache_control_value(path: str, content_type: str) -> str:
    """Return a browser cache policy suited to a frequently updated SPA."""
    if path.startswith("/api/") or path == "/health" or content_type.startswith("text/html"):
        return "no-store"
    if path.startswith("/assets/"):
        return "public, max-age=31536000, immutable"
    return "no-cache"


@app.middleware("http")
async def add_cache_control(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = cache_control_value(
        request.url.path,
        response.headers.get("Content-Type", ""),
    )
    return response


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
        # core raises "no <thing> with id <n>" for missing rows; everything else
        # is a bad request.
        missing = message.startswith("no ") and " with id " in message
        raise HTTPException(status_code=404 if missing else 400, detail=message) from error


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


class TastingUpdate(BaseModel):
    user: str | int | None = None
    rating: int | None = Field(default=None, ge=0, le=100)
    tasting_notes: str | None = None
    food_pairing: str | None = None
    context_type: str = "home"
    venue: str | None = None
    price_paid: float | None = Field(default=None, ge=0)
    liked: bool = False
    buy_again: bool = False
    tasted_on: str | None = None

    @field_validator("context_type")
    @classmethod
    def context_type_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("context type is required")
        return value

    @field_validator("user")
    @classmethod
    def user_must_not_be_blank(cls, value: str | int | None) -> str | int | None:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("reviewer is required")
        return value


class WishlistCreate(BaseModel):
    wine_id: int
    recommended_by: str = ""
    reason: str = ""
    shop_name: str = ""
    listed_price: float | None = Field(default=None, ge=0)


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


class WineUpdate(BaseModel):
    producer: str | None = None
    wine_name: str | None = None
    vintage: str | None = None
    country: str | None = None
    region: str | None = None
    appellation: str | None = None
    varietal: str | None = None
    wine_type: str | None = None
    grapes: str | None = None
    bottle_size_ml: int | None = Field(default=None, ge=1)
    location: str | None = None
    drinking_window_start: str | None = None
    drinking_window_end: str | None = None
    notes: str | None = None


@app.get("/api/wines/{wine_id}")
def api_wine(wine_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    return _wrap(core.get_wine, conn, wine_id)


@app.patch("/api/wines/{wine_id}")
def api_update_wine(
    wine_id: int, update: WineUpdate, conn: sqlite3.Connection = Depends(get_conn)
) -> dict[str, Any]:
    fields = {key: value for key, value in update.model_dump().items() if value is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="no fields to update")
    return _wrap(core.update_wine, conn, wine_id, **fields)


@app.delete("/api/wines/{wine_id}")
def api_delete_wine(
    wine_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> dict[str, Any]:
    _wrap(core.delete_wine, conn, wine_id)
    return {"ok": True, "deleted_wine_id": wine_id}


@app.delete("/api/tastings/{tasting_id}")
def api_delete_tasting(
    tasting_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> dict[str, Any]:
    try:
        return core.delete_tasting(conn, tasting_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.patch("/api/tastings/{tasting_id}")
def api_update_tasting(
    tasting_id: int,
    update: TastingUpdate,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    fields = update.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="no fields to update")
    return _wrap(core.update_tasting, conn, tasting_id, **fields)


@app.delete("/api/purchases/{purchase_id}")
def api_delete_purchase(
    purchase_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> dict[str, Any]:
    try:
        return core.delete_purchase(conn, purchase_id)
    except ValueError as error:
        status = 404 if str(error).startswith("no purchase") else 400
        raise HTTPException(status_code=status, detail=str(error)) from error


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


@app.get("/api/users")
def api_users(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    """Reviewers plus the initials their ratings render with."""
    return core.list_users(conn)


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


@app.post("/api/wishlist")
def api_wishlist_add(
    entry: WishlistCreate,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    return _wrap(
        core.wishlist_add,
        conn,
        entry.wine_id,
        shop_name=entry.shop_name.strip() or None,
        listed_price=entry.listed_price,
        reason=entry.reason.strip() or None,
        recommended_by=entry.recommended_by.strip() or None,
    )


@app.delete("/api/wishlist/{wishlist_id}")
def api_wishlist_remove(
    wishlist_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, bool]:
    _wrap(core.wishlist_remove, conn, wishlist_id)
    return {"ok": True}


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
