from __future__ import annotations

import sqlite3
from contextlib import asynccontextmanager, closing
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
DB_PATH = DATA_DIR / "wine_tracker.db"

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Wine Cellar", lifespan=lifespan)

WINE_COLUMNS: dict[str, str] = {
    "quantity": "INTEGER NOT NULL DEFAULT 0",
    "bottle_size_ml": "INTEGER",
    "location": "TEXT",
    "acquired_from": "TEXT",
    "acquired_price": "REAL",
    "drinking_window_start": "TEXT",
    "drinking_window_end": "TEXT",
    "last_event_reason": "TEXT",
}


class CellarItemCreate(BaseModel):
    producer: str
    wine_name: str
    vintage: str = ""
    country: str = ""
    region: str = ""
    appellation: str = ""
    varietal: str = ""
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


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_wine_columns(conn: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(wines)").fetchall()
    }
    for name, ddl in WINE_COLUMNS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE wines ADD COLUMN {name} {ddl}")


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with closing(get_conn()) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS wines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                producer TEXT NOT NULL,
                wine_name TEXT NOT NULL,
                vintage TEXT,
                country TEXT,
                region TEXT,
                appellation TEXT,
                varietal TEXT,
                source_app TEXT,
                cellartracker_wine_id TEXT,
                photo_ref TEXT,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                quantity INTEGER NOT NULL DEFAULT 0,
                bottle_size_ml INTEGER,
                location TEXT,
                acquired_from TEXT,
                acquired_price REAL,
                drinking_window_start TEXT,
                drinking_window_end TEXT,
                last_event_reason TEXT
            );

            CREATE TABLE IF NOT EXISTS tastings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wine_id INTEGER,
                context_type TEXT NOT NULL,
                venue TEXT,
                price_paid REAL,
                rating INTEGER,
                liked INTEGER NOT NULL DEFAULT 0,
                buy_again INTEGER NOT NULL DEFAULT 0,
                tasting_notes TEXT,
                food_pairing TEXT,
                tasted_on TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (wine_id) REFERENCES wines(id)
            );

            CREATE TABLE IF NOT EXISTS wishlist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wine_id INTEGER,
                shop_name TEXT,
                listed_price REAL,
                match_confidence TEXT,
                reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (wine_id) REFERENCES wines(id)
            );
            """
        )
        ensure_wine_columns(conn)
        conn.executescript(
            """
            CREATE INDEX IF NOT EXISTS idx_wines_name ON wines(producer, wine_name, vintage);
            CREATE INDEX IF NOT EXISTS idx_wines_quantity ON wines(quantity, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_tastings_wine_id ON tastings(wine_id);
            CREATE INDEX IF NOT EXISTS idx_wishlist_wine_id ON wishlist(wine_id);
            """
        )
        conn.commit()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def build_summary(conn: sqlite3.Connection) -> dict[str, Any]:
    summary_row = conn.execute(
        """
        SELECT
            COALESCE(SUM(quantity), 0) AS bottles,
            COUNT(*) AS labels,
            COUNT(DISTINCT producer) AS producers,
            COALESCE(SUM(quantity * COALESCE(acquired_price, 0)), 0) AS estimated_cost
        FROM wines
        WHERE quantity > 0
        """
    ).fetchone()
    region_count = conn.execute(
        "SELECT COUNT(DISTINCT region) FROM wines WHERE quantity > 0 AND COALESCE(region, '') != ''"
    ).fetchone()[0]

    return {
        "labels": {
            "bottles": summary_row["bottles"],
            "labels": summary_row["labels"],
            "producers": summary_row["producers"],
            "regions": region_count,
        },
        "estimated_cost": round(summary_row["estimated_cost"], 2),
    }


def fetch_cellar_items(
    conn: sqlite3.Connection,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    total_items = conn.execute(
        "SELECT COUNT(*) FROM wines WHERE quantity > 0"
    ).fetchone()[0]
    total_pages = max(1, (total_items + page_size - 1) // page_size)
    current_page = min(max(page, 1), total_pages)
    offset = (current_page - 1) * page_size
    rows = conn.execute(
        """
        SELECT
            id,
            producer,
            wine_name,
            vintage,
            country,
            region,
            appellation,
            varietal,
            quantity,
            bottle_size_ml,
            location,
            acquired_from,
            acquired_price,
            drinking_window_start,
            drinking_window_end,
            notes,
            source_app,
            cellartracker_wine_id,
            photo_ref,
            last_event_reason,
            updated_at
        FROM wines
        WHERE quantity > 0
        ORDER BY producer, wine_name, vintage, id
        LIMIT ? OFFSET ?
        """,
        (page_size, offset),
    ).fetchall()
    pagination = {
        "page": current_page,
        "page_size": page_size,
        "total_items": total_items,
        "total_pages": total_pages,
        "has_prev": current_page > 1,
        "has_next": current_page < total_pages,
    }
    return [row_to_dict(row) for row in rows], pagination


def fetch_cellar_payload(page: int = 1, page_size: int = 50) -> dict[str, Any]:
    with closing(get_conn()) as conn:
        items, pagination = fetch_cellar_items(conn, page=page, page_size=page_size)
        return {
            "summary": build_summary(conn),
            "items": items,
            "pagination": pagination,
        }


@app.get("/api/cellar")
def api_cellar(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=250),
) -> dict[str, Any]:
    return fetch_cellar_payload(page=page, page_size=page_size)


@app.post("/api/cellar/items", status_code=201)
def create_cellar_item(item: CellarItemCreate) -> dict[str, Any]:
    with closing(get_conn()) as conn:
        cursor = conn.execute(
            """
            INSERT INTO wines (
                producer,
                wine_name,
                vintage,
                country,
                region,
                appellation,
                varietal,
                source_app,
                cellartracker_wine_id,
                photo_ref,
                quantity,
                bottle_size_ml,
                location,
                acquired_from,
                acquired_price,
                drinking_window_start,
                drinking_window_end,
                notes,
                last_event_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item.producer.strip(),
                item.wine_name.strip(),
                item.vintage.strip(),
                item.country.strip(),
                item.region.strip(),
                item.appellation.strip(),
                item.varietal.strip(),
                item.source_app.strip(),
                item.cellartracker_wine_id.strip(),
                item.photo_ref.strip(),
                item.quantity,
                item.bottle_size_ml,
                item.location.strip(),
                item.acquired_from.strip(),
                item.acquired_price,
                item.drinking_window_start.strip(),
                item.drinking_window_end.strip(),
                item.notes.strip(),
                "created via manager api",
            ),
        )
        item_id = cursor.lastrowid
        conn.commit()
        created = conn.execute(
            "SELECT * FROM wines WHERE id = ?",
            (item_id,),
        ).fetchone()
    return row_to_dict(created)


@app.post("/api/cellar/items/{item_id}/adjust")
def adjust_inventory(item_id: int, adjustment: InventoryAdjustment) -> dict[str, Any]:
    with closing(get_conn()) as conn:
        row = conn.execute("SELECT * FROM wines WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Cellar item not found")

        new_quantity = row["quantity"] + adjustment.delta
        if new_quantity < 0:
            raise HTTPException(status_code=400, detail="Quantity cannot go below zero")

        conn.execute(
            """
            UPDATE wines
            SET quantity = ?,
                last_event_reason = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_quantity, adjustment.reason.strip(), item_id),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM wines WHERE id = ?", (item_id,)).fetchone()
    return row_to_dict(updated)


@app.get("/health")
def health() -> dict[str, Any]:
    with closing(get_conn()) as conn:
        summary = build_summary(conn)
    return {
        "ok": True,
        "db": str(DB_PATH),
        "bottles": summary["labels"]["bottles"],
        "labels": summary["labels"]["labels"],
    }
