"""SQLite connection handling and versioned migrations.

Schema versions (``PRAGMA user_version``):

* ``1`` — the original wine-tracker schema (``wines`` with embedded quantity and
  acquisition fields, ``tastings``, ``wishlist``). A pre-existing database from the
  old single-file app is detected and adopted as version 1.
* ``2`` — the agent-platform schema: ``users``, ``purchases``, ``inventory_events``
  and ``photos`` tables; ``tastings`` gains ``user_id``/``purchase_id``; ``wines``
  gains ``wine_type``/``grapes``. Existing stock is backfilled with synthesized
  purchase + event history so quantities stay auditable from day one.
* ``3`` — ``wishlist`` gains ``recommended_by``.
* ``4`` — ``ordered_wines`` tracks bottles paid for but not yet received, with
  shipment metadata and an idempotent handoff into purchases/inventory.
* ``5`` — ``tastings`` gains ``inventory_event_id`` so one inventory change can
  carry reviews from multiple people without applying the stock change again.

Forward compatibility
---------------------

The service runs straight from a git working tree, so a branch carrying a new
migration can upgrade the live database and then be swapped away. Refusing to
open any newer database would strand every other branch — a one-column addition
would stop the service from starting at all.

So each migration declares ``min_compatible``: the oldest ``SCHEMA_VERSION``
that can still safely open the database once it has run. Additive steps keep the
floor where it is; only a destructive step raises it. The resulting floor is
recorded in the database, so older code can ask "am I still allowed?" instead of
assuming the worst.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

from . import config

DEFAULT_USER_NAME = "Shuyang"
_LEGACY_TIMESTAMP_FALLBACK = "1970-01-01 00:00:00"

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


def _execute_schema(conn: sqlite3.Connection, schema: str) -> None:
    """Execute a SQL script without sqlite3.executescript's implicit commit."""
    statement = ""
    for line in schema.splitlines(keepends=True):
        statement += line
        if not sqlite3.complete_statement(statement):
            continue
        sql = statement.strip()
        if sql:
            conn.execute(sql)
        statement = ""
    if statement.strip():
        raise sqlite3.OperationalError("incomplete migration statement")


def _migrate_v1(conn: sqlite3.Connection) -> None:
    _execute_schema(conn, _V1_SCHEMA)
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(wines)")}
    for name, ddl in _V1_WINE_COLUMNS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE wines ADD COLUMN {name} {ddl}")


def _migrate_v2(conn: sqlite3.Connection) -> None:
    _execute_schema(conn, _V2_SCHEMA)
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
        created_at = row["created_at"] or _LEGACY_TIMESTAMP_FALLBACK
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
                created_at,
                created_at,
            ),
        )
        conn.execute(
            """
            INSERT INTO inventory_events (wine_id, delta, event_type, reason,
                                          purchase_id, occurred_at)
            VALUES (?, ?, 'migration', 'baseline stock at v2 migration', ?, ?)
            """,
            (row["id"], row["quantity"], cursor.lastrowid, created_at),
        )


_V3_SCHEMA = """
ALTER TABLE wishlist ADD COLUMN recommended_by TEXT;
"""


def _migrate_v3(conn: sqlite3.Connection) -> None:
    """Wishlist entries start life as recommendations, so record who made them.

    The v1 wishlist only captured shop/price — enough for "spotted this bottle
    somewhere", but not for "a friend said to try this", which is how most
    entries actually arrive.
    """
    _execute_schema(conn, _V3_SCHEMA)


_V4_SCHEMA = """
CREATE TABLE ordered_wines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wine_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price_per_bottle REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    vendor TEXT,
    order_reference TEXT,
    ordered_on TEXT,
    tracking_url TEXT,
    expected_on TEXT,
    status TEXT NOT NULL DEFAULT 'ordered'
        CHECK (status IN ('ordered', 'arrived', 'cancelled')),
    arrived_on TEXT,
    purchase_id INTEGER,
    source_message_id TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wine_id) REFERENCES wines(id),
    FOREIGN KEY (purchase_id) REFERENCES purchases(id)
);

CREATE INDEX idx_ordered_wines_status ON ordered_wines(status, expected_on, id);
CREATE INDEX idx_ordered_wines_wine_id ON ordered_wines(wine_id);
CREATE UNIQUE INDEX idx_ordered_wines_reference_line
    ON ordered_wines(vendor COLLATE NOCASE, order_reference COLLATE NOCASE, wine_id)
    WHERE COALESCE(vendor, '') != '' AND COALESCE(order_reference, '') != '';
CREATE UNIQUE INDEX idx_ordered_wines_source_line
    ON ordered_wines(source_message_id, wine_id)
    WHERE COALESCE(source_message_id, '') != '';
"""


def _migrate_v4(conn: sqlite3.Connection) -> None:
    """Add the pre-arrival order ledger without changing existing inventory."""
    _execute_schema(conn, _V4_SCHEMA)


_V5_SCHEMA = """
ALTER TABLE tastings ADD COLUMN inventory_event_id INTEGER REFERENCES inventory_events(id);
CREATE INDEX idx_tastings_inventory_event_id ON tastings(inventory_event_id);
"""


def _migrate_v5(conn: sqlite3.Connection) -> None:
    """Let reviews attach to an existing ledger event without changing stock."""
    _execute_schema(conn, _V5_SCHEMA)


class Migration(NamedTuple):
    """One schema step, plus how far back the result stays readable.

    ``min_compatible`` is the oldest ``SCHEMA_VERSION`` that can still open the
    database once this step has run. Adding a table or a nullable column leaves
    older code working, so those keep the floor where it was. A step that drops
    or renames something older code reads, or that rewrites data into a shape it
    would misread, must set this to its own version — which locks that code out
    deliberately, with a message saying so.
    """

    run: Callable[[sqlite3.Connection], None]
    min_compatible: int


_MIGRATIONS: list[Migration] = [
    Migration(_migrate_v1, min_compatible=1),
    # Purely additive: new tables, new nullable columns, backfilled history.
    Migration(_migrate_v2, min_compatible=1),
    # Purely additive: one nullable column on wishlist.
    Migration(_migrate_v3, min_compatible=1),
    # Older code cannot safely delete wines/purchases referenced by this table.
    Migration(_migrate_v4, min_compatible=4),
    # Older code does not clear review links before deleting inventory events.
    Migration(_migrate_v5, min_compatible=5),
]
SCHEMA_VERSION = len(_MIGRATIONS)

# Metadata about migrations, so it is deliberately not itself migrated — it is
# created on demand and carries no application data.
_META_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
)
"""
_MIN_COMPATIBLE_KEY = "min_compatible_version"


def _required_min_compatible() -> int:
    """The floor this code's schema imposes on whoever opens the result."""
    return max((step.min_compatible for step in _MIGRATIONS), default=1)


def _read_min_compatible(conn: sqlite3.Connection) -> int | None:
    """The floor recorded in the database, or None if it predates tracking."""
    try:
        row = conn.execute(
            "SELECT value FROM schema_meta WHERE key = ?", (_MIN_COMPATIBLE_KEY,)
        ).fetchone()
    except sqlite3.OperationalError:
        # No schema_meta table: written before compatibility tracking existed.
        return None
    return None if row is None else row[0]


def _write_min_compatible(conn: sqlite3.Connection, floor: int) -> None:
    conn.execute(_META_SCHEMA)
    conn.execute(
        """
        INSERT INTO schema_meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (_MIN_COMPATIBLE_KEY, floor),
    )


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
        floor = _read_min_compatible(conn)
        # No recorded floor means the database predates compatibility tracking.
        # Every migration shipped before it (v1-v3) was additive, so this code
        # can still read the database.
        if floor is not None and floor > SCHEMA_VERSION:
            raise RuntimeError(
                f"Database schema version {version} requires code at schema version "
                f"{floor} or newer, but this code is at {SCHEMA_VERSION}. "
                "Update to a revision containing that migration."
            )
        # Readable, but migrations this code has never seen own the schema from
        # here on — so read it as found and write nothing.
        return

    floor = _required_min_compatible()
    if version == SCHEMA_VERSION and _read_min_compatible(conn) == floor:
        return

    conn.execute("BEGIN IMMEDIATE")
    try:
        # Another connection may have migrated while this one waited for the
        # write lock. Re-read the schema state before choosing migration steps.
        version = _current_version(conn)
        if version > SCHEMA_VERSION:
            current_floor = _read_min_compatible(conn)
            if current_floor is not None and current_floor > SCHEMA_VERSION:
                raise RuntimeError(
                    f"Database schema version {version} requires code at schema "
                    f"version {current_floor} or newer, but this code is at "
                    f"{SCHEMA_VERSION}. Update to a revision containing that migration."
                )
            conn.commit()
            return
        if version == SCHEMA_VERSION and _read_min_compatible(conn) == floor:
            conn.commit()
            return
        for index in range(version, SCHEMA_VERSION):
            _MIGRATIONS[index].run(conn)
            conn.execute("PRAGMA user_version = " + str(index + 1))

        # Record the floor, also backfilling databases migrated before tracking.
        if _read_min_compatible(conn) != floor:
            _write_min_compatible(conn, floor)
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def open_db(path: Path | None = None) -> sqlite3.Connection:
    """Connect and ensure the schema is current."""
    conn = connect(path)
    version = _current_version(conn)
    if version == 1:
        # An adopted old database may miss late-added v1 columns.
        conn.execute("BEGIN IMMEDIATE")
        try:
            _migrate_v1(conn)
            conn.execute("PRAGMA user_version = 1")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    migrate(conn)
    return conn
