"""SQLite connection handling and versioned migrations.

Schema versions (``PRAGMA user_version``):

* ``1`` — the original wine-tracker schema (``wines`` with embedded quantity and
  acquisition fields, ``tastings``, ``wishlist``). A pre-existing database from the
  old single-file app is detected and adopted as version 1.
* ``2`` — the agent-platform schema: ``users``, ``purchases``, ``inventory_events``
  and ``photos`` tables; ``tastings`` gains ``user_id``/``purchase_id``; ``wines``
  gains ``wine_type``/``grapes``. Existing stock is backfilled with synthesized
  purchase + event history so quantities stay auditable from day one.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from pathlib import Path

from . import config

DEFAULT_USER_NAME = "Shuyang"

# Columns the old app added via its ensure_wine_columns() upgrade path. Kept so a
# database written by any old version lands in a consistent v1 state.
_V1_WINE_COLUMNS: dict[str, str] = {
    "quantity": "INTEGER NOT NULL DEFAULT 0",
    "bottle_size_ml": "INTEGER",
    "location": "TEXT",
    "acquired_from": "TEXT",
    "acquired_price": "REAL",
    "drinking_window_start": "TEXT",
    "drinking_window_end": "TEXT",
    "last_event_reason": "TEXT",
}

_V1_SCHEMA = """
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

CREATE INDEX IF NOT EXISTS idx_wines_name ON wines(producer, wine_name, vintage);
CREATE INDEX IF NOT EXISTS idx_wines_quantity ON wines(quantity, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tastings_wine_id ON tastings(wine_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_wine_id ON wishlist(wine_id);
"""

_V2_SCHEMA = """
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wine_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price_per_bottle REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    vendor TEXT,
    purchase_date TEXT,
    source TEXT NOT NULL DEFAULT 'other'
        CHECK (source IN ('online', 'in_person', 'gift', 'other')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wine_id) REFERENCES wines(id)
);

CREATE TABLE inventory_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wine_id INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    event_type TEXT NOT NULL
        CHECK (event_type IN ('purchase', 'consume', 'gift', 'adjust', 'migration')),
    reason TEXT,
    purchase_id INTEGER,
    tasting_id INTEGER,
    occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wine_id) REFERENCES wines(id),
    FOREIGN KEY (purchase_id) REFERENCES purchases(id),
    FOREIGN KEY (tasting_id) REFERENCES tastings(id)
);

CREATE TABLE photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wine_id INTEGER,
    purchase_id INTEGER,
    tasting_id INTEGER,
    kind TEXT NOT NULL DEFAULT 'label' CHECK (kind IN ('label', 'receipt', 'other')),
    path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wine_id) REFERENCES wines(id),
    FOREIGN KEY (purchase_id) REFERENCES purchases(id),
    FOREIGN KEY (tasting_id) REFERENCES tastings(id)
);

ALTER TABLE tastings ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE tastings ADD COLUMN purchase_id INTEGER REFERENCES purchases(id);
ALTER TABLE wines ADD COLUMN wine_type TEXT;
ALTER TABLE wines ADD COLUMN grapes TEXT;

CREATE INDEX idx_purchases_wine_id ON purchases(wine_id);
CREATE INDEX idx_events_wine_id ON inventory_events(wine_id);
CREATE INDEX idx_photos_wine_id ON photos(wine_id);
"""


def _migrate_v1(conn: sqlite3.Connection) -> None:
    conn.executescript(_V1_SCHEMA)
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(wines)")}
    for name, ddl in _V1_WINE_COLUMNS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE wines ADD COLUMN {name} {ddl}")


def _migrate_v2(conn: sqlite3.Connection) -> None:
    conn.executescript(_V2_SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO users (name, is_default) VALUES (?, 1)",
        (DEFAULT_USER_NAME,),
    )
    # Backfill: synthesize purchase + event history for pre-existing stock so
    # SUM(inventory_events.delta) == wines.quantity holds for every wine.
    rows = conn.execute(
        "SELECT id, quantity, acquired_from, acquired_price, created_at FROM wines"
    ).fetchall()
    for row in rows:
        if row["quantity"] <= 0:
            continue
        cursor = conn.execute(
            """
            INSERT INTO purchases (wine_id, quantity, price_per_bottle, vendor,
                                   purchase_date, source, notes, created_at)
            VALUES (?, ?, ?, ?, date(?), 'other', 'backfilled during v2 migration', ?)
            """,
            (
                row["id"],
                row["quantity"],
                row["acquired_price"],
                row["acquired_from"],
                row["created_at"],
                row["created_at"],
            ),
        )
        conn.execute(
            """
            INSERT INTO inventory_events (wine_id, delta, event_type, reason,
                                          purchase_id, occurred_at)
            VALUES (?, ?, 'migration', 'baseline stock at v2 migration', ?, ?)
            """,
            (row["id"], row["quantity"], cursor.lastrowid, row["created_at"]),
        )


_MIGRATIONS: list[Callable[[sqlite3.Connection], None]] = [_migrate_v1, _migrate_v2]
SCHEMA_VERSION = len(_MIGRATIONS)


def connect(path: Path | None = None) -> sqlite3.Connection:
    """Open a connection with sane defaults. Callers own closing it."""
    target = path or config.db_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    # FastAPI may enter, use, and exit a yield dependency on different worker
    # threads. Each request still owns one connection; disable only sqlite3's
    # thread-affinity check so that connection can follow the request lifecycle.
    conn = sqlite3.connect(target, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _current_version(conn: sqlite3.Connection) -> int:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version == 0:
        # A database from the old single-file app predates user_version tracking.
        has_wines = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='wines'"
        ).fetchone()
        if has_wines:
            return 1
    return version


def migrate(conn: sqlite3.Connection) -> None:
    version = _current_version(conn)
    if version > SCHEMA_VERSION:
        raise RuntimeError(
            f"Database schema version {version} is newer than this code ({SCHEMA_VERSION})"
        )
    for index in range(version, SCHEMA_VERSION):
        _MIGRATIONS[index](conn)
        conn.execute(f"PRAGMA user_version = {index + 1}")
    conn.commit()


def open_db(path: Path | None = None) -> sqlite3.Connection:
    """Connect and ensure the schema is current."""
    conn = connect(path)
    version = _current_version(conn)
    if version == 1:
        # An adopted old database may miss late-added v1 columns.
        _migrate_v1(conn)
        conn.execute("PRAGMA user_version = 1")
    migrate(conn)
    return conn
