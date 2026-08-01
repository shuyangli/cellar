"""Core cellar operations shared by the web API, MCP server, and CLI.

Every function takes an open connection (see :func:`cellar.db.open_db`), keeps
``wines.quantity`` consistent with the ``inventory_events`` ledger inside a single
transaction, and returns plain dicts that serialize cleanly to JSON.

Conventions: dates are ISO ``YYYY-MM-DD``, ratings are 0-100, prices are per
bottle with an ISO currency code (default USD).
"""

from __future__ import annotations

import datetime as dt
import re
import shutil
import sqlite3
import uuid
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from . import config

WINE_FIELDS = {
    "producer",
    "wine_name",
    "vintage",
    "country",
    "region",
    "appellation",
    "varietal",
    "wine_type",
    "grapes",
    "bottle_size_ml",
    "location",
    "drinking_window_start",
    "drinking_window_end",
    "notes",
    "source_app",
    "cellartracker_wine_id",
    "photo_ref",
}

WINE_TYPES = {"red", "white", "rose", "sparkling", "dessert", "fortified", "orange", "other"}


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return None if row is None else {key: row[key] for key in row.keys()}


def _rows(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [_row(row) for row in rows]


def _touch_wine(conn: sqlite3.Connection, wine_id: int) -> None:
    conn.execute(
        "UPDATE wines SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (wine_id,)
    )


# ---------------------------------------------------------------------------
# Users


def default_user_id(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT id FROM users WHERE is_default = 1 LIMIT 1").fetchone()
    if row is None:
        row = conn.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
    if row is None:
        raise ValueError("no users exist")
    return row["id"]


def resolve_user(conn: sqlite3.Connection, user: str | int | None) -> int:
    """Accept a user id, a user name (created on first use), or None (default user)."""
    if user is None or user == "":
        return default_user_id(conn)
    if isinstance(user, int) or (isinstance(user, str) and user.isdigit()):
        user_id = int(user)
        if conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone():
            return user_id
        raise ValueError(f"no user with id {user_id}")
    row = conn.execute("SELECT id FROM users WHERE name = ? COLLATE NOCASE", (user,)).fetchone()
    if row:
        return row["id"]
    cursor = conn.execute("INSERT INTO users (name) VALUES (?)", (user,))
    return cursor.lastrowid


def assign_initials(names: Sequence[str]) -> dict[str, str]:
    """Map each name to its first initial, e.g. "Shuyang" -> "S".

    Ratings render as "89S" / "90A". Two reviewers can share an initial — the
    badge is tappable in the UI to reveal the full name — so the initial is just
    a compact default, not a unique identifier.
    """
    return {name: ((name or "").strip()[:1].upper() or "?") for name in names}


def user_initials(conn: sqlite3.Connection) -> dict[int, str]:
    """Reviewer id -> first initial for their rating badge."""
    rows = conn.execute("SELECT id, name FROM users").fetchall()
    by_name = assign_initials([row["name"] for row in rows])
    return {row["id"]: by_name[row["name"]] for row in rows}


def list_users(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """All known reviewers with their review activity and rating initials."""
    users = _rows(
        conn.execute(
            """
            SELECT u.id, u.name, u.is_default,
                   COUNT(t.id) AS tasting_count,
                   MAX(t.tasted_on) AS last_tasted_on
            FROM users u LEFT JOIN tastings t ON t.user_id = u.id
            GROUP BY u.id
            ORDER BY u.is_default DESC, u.name COLLATE NOCASE
            """
        ).fetchall()
    )
    initials = user_initials(conn)
    for user in users:
        user["initials"] = initials.get(user["id"], "?")
    return users


def rating_breakdown(
    conn: sqlite3.Connection, wine_ids: Sequence[int]
) -> dict[int, list[dict[str, Any]]]:
    """Per-wine, per-reviewer ratings, so a wine shows "89S 90A" not one average.

    Fetched for a whole page of wines at once — a per-row query would be an N+1
    against the list view.
    """
    if not wine_ids:
        return {}
    placeholders = ",".join("?" for _ in wine_ids)
    rows = conn.execute(
        f"""
        SELECT t.wine_id, t.user_id, u.name AS user_name,
               ROUND(AVG(t.rating), 1) AS rating, COUNT(t.id) AS tastings
        FROM tastings t LEFT JOIN users u ON u.id = t.user_id
        WHERE t.rating IS NOT NULL AND t.wine_id IN ({placeholders})
        GROUP BY t.wine_id, t.user_id
        ORDER BY u.name COLLATE NOCASE
        """,
        tuple(wine_ids),
    ).fetchall()
    initials = user_initials(conn)
    breakdown: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        entry = _row(row)
        entry["initials"] = initials.get(entry["user_id"], "?")
        breakdown.setdefault(entry.pop("wine_id"), []).append(entry)
    return breakdown


def set_tasting_user(
    conn: sqlite3.Connection, tasting_id: int, user: str | int
) -> dict[str, Any]:
    """Reattribute an existing tasting to a different reviewer."""
    if user is None or user == "":
        raise ValueError("user is required")
    row = conn.execute("SELECT wine_id FROM tastings WHERE id = ?", (tasting_id,)).fetchone()
    if row is None:
        raise ValueError(f"no tasting with id {tasting_id}")
    user_id = resolve_user(conn, user)
    conn.execute("UPDATE tastings SET user_id = ? WHERE id = ?", (user_id, tasting_id))
    conn.commit()
    return get_wine(conn, row["wine_id"])


# ---------------------------------------------------------------------------
# Wines


def get_wine(conn: sqlite3.Connection, wine_id: int) -> dict[str, Any]:
    """Full dossier: wine + purchases, tastings, events, photos, review aggregates."""
    wine = _row(conn.execute("SELECT * FROM wines WHERE id = ?", (wine_id,)).fetchone())
    if wine is None:
        raise ValueError(f"no wine with id {wine_id}")
    wine["purchases"] = _rows(
        conn.execute(
            "SELECT * FROM purchases WHERE wine_id = ? ORDER BY purchase_date, id",
            (wine_id,),
        ).fetchall()
    )
    initials = user_initials(conn)
    wine["tastings"] = _rows(
        conn.execute(
            """
            SELECT t.*, u.name AS user_name
            FROM tastings t LEFT JOIN users u ON u.id = t.user_id
            WHERE t.wine_id = ? ORDER BY t.tasted_on, t.id
            """,
            (wine_id,),
        ).fetchall()
    )
    for tasting in wine["tastings"]:
        tasting["user_initials"] = initials.get(tasting["user_id"], "?")
    wine["events"] = _rows(
        conn.execute(
            "SELECT * FROM inventory_events WHERE wine_id = ? ORDER BY occurred_at, id",
            (wine_id,),
        ).fetchall()
    )
    wine["photos"] = _rows(
        conn.execute(
            "SELECT * FROM photos WHERE wine_id = ? ORDER BY id", (wine_id,)
        ).fetchall()
    )
    ratings = [t["rating"] for t in wine["tastings"] if t["rating"] is not None]
    wine["avg_rating"] = round(sum(ratings) / len(ratings), 1) if ratings else None
    wine["ratings"] = rating_breakdown(conn, [wine_id]).get(wine_id, [])
    return wine


def find_wines(conn: sqlite3.Connection, query: str, limit: int = 10) -> list[dict[str, Any]]:
    """Fuzzy lookup for dedupe-before-insert: every whitespace token must match
    producer, wine_name, vintage, region, appellation, or varietal."""
    tokens = [token for token in re.split(r"\s+", query.strip()) if token]
    if not tokens:
        return []
    clauses = []
    params: list[Any] = []
    for token in tokens:
        clauses.append(
            "(producer LIKE ? OR wine_name LIKE ? OR COALESCE(vintage,'') LIKE ?"
            " OR COALESCE(region,'') LIKE ? OR COALESCE(appellation,'') LIKE ?"
            " OR COALESCE(varietal,'') LIKE ?)"
        )
        like = f"%{token}%"
        params.extend([like] * 6)
    rows = conn.execute(
        f"""
        SELECT id, producer, wine_name, vintage, wine_type, country, region,
               appellation, varietal, quantity
        FROM wines WHERE {" AND ".join(clauses)}
        ORDER BY quantity DESC, producer, wine_name LIMIT ?
        """,
        (*params, limit),
    ).fetchall()
    return _rows(rows)


def _clean_wine_fields(fields: dict[str, Any]) -> dict[str, Any]:
    unknown = set(fields) - WINE_FIELDS
    if unknown:
        raise ValueError(f"unknown wine fields: {sorted(unknown)}")
    cleaned: dict[str, Any] = {}
    for key, value in fields.items():
        if isinstance(value, str):
            value = value.strip()
        cleaned[key] = value if value != "" else None
    wine_type = cleaned.get("wine_type")
    if wine_type is not None:
        wine_type = wine_type.lower()
        if wine_type not in WINE_TYPES:
            raise ValueError(f"wine_type must be one of {sorted(WINE_TYPES)}")
        cleaned["wine_type"] = wine_type
    return cleaned


def add_wine(conn: sqlite3.Connection, **fields: Any) -> dict[str, Any]:
    cleaned = _clean_wine_fields(fields)
    if not cleaned.get("producer") or not cleaned.get("wine_name"):
        raise ValueError("producer and wine_name are required")
    cleaned.setdefault("bottle_size_ml", 750)
    cleaned.setdefault("source_app", "agent")
    columns = ", ".join(cleaned)
    placeholders = ", ".join("?" for _ in cleaned)
    cursor = conn.execute(
        f"INSERT INTO wines ({columns}) VALUES ({placeholders})",
        tuple(cleaned.values()),
    )
    conn.commit()
    return get_wine(conn, cursor.lastrowid)


def update_wine(conn: sqlite3.Connection, wine_id: int, **fields: Any) -> dict[str, Any]:
    cleaned = _clean_wine_fields(fields)
    if not cleaned:
        raise ValueError("no fields to update")
    if conn.execute("SELECT 1 FROM wines WHERE id = ?", (wine_id,)).fetchone() is None:
        raise ValueError(f"no wine with id {wine_id}")
    assignments = ", ".join(f"{key} = ?" for key in cleaned)
    conn.execute(
        f"UPDATE wines SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (*cleaned.values(), wine_id),
    )
    conn.commit()
    return get_wine(conn, wine_id)


# ---------------------------------------------------------------------------
# Inventory


def _apply_event(
    conn: sqlite3.Connection,
    wine_id: int,
    delta: int,
    event_type: str,
    reason: str | None,
    purchase_id: int | None = None,
    tasting_id: int | None = None,
    occurred_at: str | None = None,
) -> None:
    """Write a ledger event and update the cached quantity. No commit."""
    row = conn.execute("SELECT quantity FROM wines WHERE id = ?", (wine_id,)).fetchone()
    if row is None:
        raise ValueError(f"no wine with id {wine_id}")
    new_quantity = row["quantity"] + delta
    if new_quantity < 0:
        raise ValueError(
            f"quantity cannot go below zero (current {row['quantity']}, delta {delta})"
        )
    conn.execute(
        """
        INSERT INTO inventory_events
            (wine_id, delta, event_type, reason, purchase_id, tasting_id, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        """,
        (wine_id, delta, event_type, reason, purchase_id, tasting_id, occurred_at),
    )
    conn.execute(
        """
        UPDATE wines SET quantity = ?, last_event_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (new_quantity, reason or event_type, wine_id),
    )


def log_purchase(
    conn: sqlite3.Connection,
    wine_id: int,
    quantity: int,
    price_per_bottle: float | None = None,
    currency: str = "USD",
    vendor: str | None = None,
    purchase_date: str | None = None,
    source: str = "other",
    notes: str | None = None,
) -> dict[str, Any]:
    if quantity < 1:
        raise ValueError("quantity must be at least 1")
    purchase_date = purchase_date or dt.date.today().isoformat()
    cursor = conn.execute(
        """
        INSERT INTO purchases
            (wine_id, quantity, price_per_bottle, currency, vendor, purchase_date, source, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (wine_id, quantity, price_per_bottle, currency, vendor, purchase_date, source, notes),
    )
    purchase_id = cursor.lastrowid
    # Denormalized "latest purchase" cache used by the inventory UI and the
    # estimated-cost summary (quantity * acquired_price).
    conn.execute(
        """
        UPDATE wines
        SET acquired_price = COALESCE(?, acquired_price),
            acquired_from = COALESCE(?, acquired_from)
        WHERE id = ?
        """,
        (price_per_bottle, vendor, wine_id),
    )
    vendor_note = f" from {vendor}" if vendor else ""
    _apply_event(
        conn,
        wine_id,
        quantity,
        "purchase",
        f"bought {quantity}{vendor_note}",
        purchase_id=purchase_id,
    )
    conn.commit()
    return get_wine(conn, wine_id)


def log_tasting(
    conn: sqlite3.Connection,
    wine_id: int,
    user: str | int | None = None,
    rating: int | None = None,
    tasting_notes: str | None = None,
    food_pairing: str | None = None,
    context_type: str = "home",
    venue: str | None = None,
    price_paid: float | None = None,
    liked: bool | None = None,
    buy_again: bool | None = None,
    tasted_on: str | None = None,
    consume_bottle: bool = True,
) -> dict[str, Any]:
    """Record drinking + reviewing a wine. Decrements inventory unless the wine was
    tasted elsewhere (restaurant, tasting room) — set ``consume_bottle=False`` then."""
    if rating is not None and not 0 <= rating <= 100:
        raise ValueError("rating must be 0-100")
    if conn.execute("SELECT 1 FROM wines WHERE id = ?", (wine_id,)).fetchone() is None:
        raise ValueError(f"no wine with id {wine_id}")
    user_id = resolve_user(conn, user)
    tasted_on = tasted_on or dt.date.today().isoformat()
    if liked is None:
        liked = rating is not None and rating >= 85
    cursor = conn.execute(
        """
        INSERT INTO tastings
            (wine_id, user_id, context_type, venue, price_paid, rating, liked,
             buy_again, tasting_notes, food_pairing, tasted_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            wine_id,
            user_id,
            context_type,
            venue,
            price_paid,
            rating,
            int(bool(liked)),
            int(bool(buy_again)),
            tasting_notes,
            food_pairing,
            tasted_on,
        ),
    )
    tasting_id = cursor.lastrowid
    if consume_bottle:
        _apply_event(
            conn,
            wine_id,
            -1,
            "consume",
            f"opened on {tasted_on}",
            tasting_id=tasting_id,
        )
    conn.commit()
    return get_wine(conn, wine_id)


def adjust_inventory(
    conn: sqlite3.Connection,
    wine_id: int,
    delta: int,
    reason: str | None = None,
    event_type: str = "adjust",
) -> dict[str, Any]:
    if event_type not in {"adjust", "gift", "consume"}:
        raise ValueError("event_type must be adjust, gift, or consume")
    _apply_event(conn, wine_id, delta, event_type, reason)
    conn.commit()
    return get_wine(conn, wine_id)


def delete_tasting(conn: sqlite3.Connection, tasting_id: int) -> dict[str, Any]:
    """Remove a mistaken tasting. Any bottle it consumed is restored."""
    row = conn.execute("SELECT wine_id FROM tastings WHERE id = ?", (tasting_id,)).fetchone()
    if row is None:
        raise ValueError(f"no tasting with id {tasting_id}")
    wine_id = row["wine_id"]
    consumed = conn.execute(
        "SELECT COALESCE(SUM(delta), 0) FROM inventory_events WHERE tasting_id = ?",
        (tasting_id,),
    ).fetchone()[0]
    conn.execute("DELETE FROM inventory_events WHERE tasting_id = ?", (tasting_id,))
    conn.execute("DELETE FROM photos WHERE tasting_id = ?", (tasting_id,))
    conn.execute("DELETE FROM tastings WHERE id = ?", (tasting_id,))
    if consumed:
        conn.execute(
            "UPDATE wines SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP"
            " WHERE id = ?",
            (consumed, wine_id),
        )
    conn.commit()
    return get_wine(conn, wine_id)


def delete_purchase(conn: sqlite3.Connection, purchase_id: int) -> dict[str, Any]:
    """Remove a mistaken purchase and the bottles it added."""
    row = conn.execute(
        "SELECT wine_id, quantity FROM purchases WHERE id = ?", (purchase_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"no purchase with id {purchase_id}")
    wine_id = row["wine_id"]
    added = conn.execute(
        "SELECT COALESCE(SUM(delta), 0) FROM inventory_events WHERE purchase_id = ?",
        (purchase_id,),
    ).fetchone()[0]
    current = conn.execute(
        "SELECT quantity FROM wines WHERE id = ?", (wine_id,)
    ).fetchone()["quantity"]
    if current - added < 0:
        raise ValueError(
            "cannot delete purchase: its bottles are already consumed"
            " — delete the tastings first or adjust inventory instead"
        )
    conn.execute("DELETE FROM inventory_events WHERE purchase_id = ?", (purchase_id,))
    conn.execute("UPDATE tastings SET purchase_id = NULL WHERE purchase_id = ?", (purchase_id,))
    conn.execute("UPDATE photos SET purchase_id = NULL WHERE purchase_id = ?", (purchase_id,))
    conn.execute("DELETE FROM purchases WHERE id = ?", (purchase_id,))
    if added:
        conn.execute(
            "UPDATE wines SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP"
            " WHERE id = ?",
            (added, wine_id),
        )
    conn.commit()
    return get_wine(conn, wine_id)


def delete_wine(conn: sqlite3.Connection, wine_id: int) -> None:
    """Remove a wine and everything attached to it, including photo files."""
    if conn.execute("SELECT 1 FROM wines WHERE id = ?", (wine_id,)).fetchone() is None:
        raise ValueError(f"no wine with id {wine_id}")
    photo_paths = [
        row["path"]
        for row in conn.execute("SELECT path FROM photos WHERE wine_id = ?", (wine_id,))
    ]
    for table in ("inventory_events", "photos", "tastings", "wishlist", "purchases"):
        conn.execute(f"DELETE FROM {table} WHERE wine_id = ?", (wine_id,))
    conn.execute("DELETE FROM wines WHERE id = ?", (wine_id,))
    conn.commit()
    for path in photo_paths:
        target = config.photos_dir() / path
        if target.is_file():
            target.unlink()


# ---------------------------------------------------------------------------
# Listing / search


def list_inventory(
    conn: sqlite3.Connection,
    page: int = 1,
    page_size: int = 50,
    q: str | None = None,
    wine_type: str | None = None,
    country: str | None = None,
    region: str | None = None,
    vintage: str | None = None,
    in_stock: bool = True,
) -> dict[str, Any]:
    where: list[str] = []
    params: list[Any] = []
    if in_stock:
        where.append("quantity > 0")
    if q:
        for token in re.split(r"\s+", q.strip()):
            if not token:
                continue
            where.append(
                "(producer LIKE ? OR wine_name LIKE ? OR COALESCE(vintage,'') LIKE ?"
                " OR COALESCE(region,'') LIKE ? OR COALESCE(appellation,'') LIKE ?"
                " OR COALESCE(varietal,'') LIKE ? OR COALESCE(country,'') LIKE ?)"
            )
            params.extend([f"%{token}%"] * 7)
    for column, value in (
        ("wine_type", wine_type),
        ("country", country),
        ("region", region),
        ("vintage", vintage),
    ):
        if value:
            where.append(f"{column} LIKE ?")
            params.append(f"%{value}%")
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    total_items = conn.execute(
        f"SELECT COUNT(*) FROM wines {where_sql}", params
    ).fetchone()[0]
    total_pages = max(1, (total_items + page_size - 1) // page_size)
    current_page = min(max(page, 1), total_pages)
    offset = (current_page - 1) * page_size
    items = _rows(
        conn.execute(
            f"""
            SELECT w.*,
                   (SELECT ROUND(AVG(rating), 1) FROM tastings
                    WHERE wine_id = w.id AND rating IS NOT NULL) AS avg_rating,
                   (SELECT path FROM photos
                    WHERE wine_id = w.id AND kind = 'label' ORDER BY id LIMIT 1) AS label_photo
            FROM wines w {where_sql}
            ORDER BY producer, wine_name, vintage, id
            LIMIT ? OFFSET ?
            """,
            (*params, page_size, offset),
        ).fetchall()
    )
    breakdown = rating_breakdown(conn, [item["id"] for item in items])
    for item in items:
        item["ratings"] = breakdown.get(item["id"], [])
    return {
        "summary": summary(conn),
        "items": items,
        "pagination": {
            "page": current_page,
            "page_size": page_size,
            "total_items": total_items,
            "total_pages": total_pages,
            "has_prev": current_page > 1,
            "has_next": current_page < total_pages,
        },
    }


def summary(conn: sqlite3.Connection) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT COALESCE(SUM(quantity), 0) AS bottles,
               COUNT(*) AS labels,
               COUNT(DISTINCT producer) AS producers,
               COALESCE(SUM(quantity * COALESCE(acquired_price, 0)), 0) AS estimated_cost
        FROM wines WHERE quantity > 0
        """
    ).fetchone()
    regions = conn.execute(
        "SELECT COUNT(DISTINCT region) FROM wines"
        " WHERE quantity > 0 AND COALESCE(region, '') != ''"
    ).fetchone()[0]
    return {
        "labels": {
            "bottles": row["bottles"],
            "labels": row["labels"],
            "producers": row["producers"],
            "regions": regions,
        },
        "estimated_cost": round(row["estimated_cost"], 2),
    }


# ---------------------------------------------------------------------------
# Analytics


def cellar_stats(conn: sqlite3.Connection) -> dict[str, Any]:
    def grouped(sql: str) -> list[dict[str, Any]]:
        return _rows(conn.execute(sql).fetchall())

    initials = user_initials(conn)

    return {
        "summary": summary(conn),
        "reviewers": list_users(conn),
        "by_type": grouped(
            """
            SELECT COALESCE(wine_type, 'unknown') AS wine_type,
                   SUM(quantity) AS bottles, COUNT(*) AS labels
            FROM wines WHERE quantity > 0 GROUP BY 1 ORDER BY bottles DESC
            """
        ),
        "by_country": grouped(
            """
            SELECT COALESCE(country, 'unknown') AS country,
                   SUM(quantity) AS bottles, COUNT(*) AS labels
            FROM wines WHERE quantity > 0 GROUP BY 1 ORDER BY bottles DESC
            """
        ),
        "by_region": grouped(
            """
            SELECT COALESCE(region, 'unknown') AS region,
                   SUM(quantity) AS bottles, COUNT(*) AS labels
            FROM wines WHERE quantity > 0 GROUP BY 1 ORDER BY bottles DESC LIMIT 15
            """
        ),
        "spend_by_month": grouped(
            """
            SELECT strftime('%Y-%m', purchase_date) AS month,
                   ROUND(SUM(quantity * COALESCE(price_per_bottle, 0)), 2) AS spend,
                   SUM(quantity) AS bottles
            FROM purchases WHERE purchase_date IS NOT NULL
            GROUP BY 1 ORDER BY 1
            """
        ),
        "top_rated": grouped(
            """
            SELECT w.id, w.producer, w.wine_name, w.vintage, w.quantity,
                   ROUND(AVG(t.rating), 1) AS avg_rating, COUNT(t.id) AS tastings
            FROM wines w JOIN tastings t ON t.wine_id = w.id AND t.rating IS NOT NULL
            GROUP BY w.id ORDER BY avg_rating DESC, tastings DESC LIMIT 15
            """
        ),
        "recent_tastings": [
            dict(row, user_initials=initials.get(row["user_id"], "?"))
            for row in grouped(
                """
                SELECT t.id, t.wine_id, t.user_id, w.producer, w.wine_name, w.vintage,
                       t.rating, t.tasted_on, u.name AS user_name
                FROM tastings t
                JOIN wines w ON w.id = t.wine_id
                LEFT JOIN users u ON u.id = t.user_id
                ORDER BY t.tasted_on DESC, t.id DESC LIMIT 10
                """
            )
        ],
    }


def _window_year(value: str | None) -> int | None:
    """Drinking-window fields are free text; extract the first 4-digit year."""
    if not value:
        return None
    match = re.search(r"(19|20)\d{2}", value)
    return int(match.group(0)) if match else None


def drinking_window_alerts(conn: sqlite3.Connection) -> dict[str, Any]:
    year = dt.date.today().year
    drink_first: list[dict[str, Any]] = []
    drink_soon: list[dict[str, Any]] = []
    ready_to_hold: list[dict[str, Any]] = []
    long_term: list[dict[str, Any]] = []
    approaching: list[dict[str, Any]] = []
    past_peak: list[dict[str, Any]] = []
    no_window: list[dict[str, Any]] = []
    rows = conn.execute(
        """
        SELECT id, producer, wine_name, vintage, wine_type, region, quantity,
               drinking_window_start, drinking_window_end
        FROM wines WHERE quantity > 0 ORDER BY producer, wine_name
        """
    ).fetchall()
    for row in rows:
        item = _row(row)
        assert item is not None
        start = _window_year(item["drinking_window_start"])
        end = _window_year(item["drinking_window_end"])
        if start is None and end is None:
            no_window.append(item)
        elif end is not None and end < year:
            past_peak.append(item)
        elif start is not None and start > year:
            approaching.append(item)
        elif end is not None and end <= year + 1:
            drink_first.append(item)
        elif end is not None and end <= year + 3:
            drink_soon.append(item)
        elif end is not None and end >= year + 8:
            long_term.append(item)
        else:
            ready_to_hold.append(item)
    for bucket in (drink_first, drink_soon, ready_to_hold, long_term, approaching):
        bucket.sort(key=lambda w: (_window_year(w["drinking_window_end"]) or 9999))
    return {
        "year": year,
        "drink_first": drink_first,
        "drink_soon": drink_soon,
        "ready_to_hold": ready_to_hold,
        "long_term": long_term,
        "approaching": approaching,
        "past_peak": past_peak,
        "no_window": no_window,
    }


def tasting_history(conn: sqlite3.Connection, limit: int = 200) -> list[dict[str, Any]]:
    rows = _rows(
        conn.execute(
            """
            SELECT t.*, u.name AS user_name,
                   w.producer, w.wine_name, w.vintage, w.wine_type, w.region, w.country
            FROM tastings t
            JOIN wines w ON w.id = t.wine_id
            LEFT JOIN users u ON u.id = t.user_id
            ORDER BY t.tasted_on DESC, t.id DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
    )
    initials = user_initials(conn)
    for row in rows:
        row["user_initials"] = initials.get(row["user_id"], "?")
    return rows


def read_query(conn: sqlite3.Connection, sql: str, limit: int = 200) -> list[dict[str, Any]]:
    """Read-only SQL escape hatch for agent analytics."""
    if re.search(r"\b(insert|update|delete|drop|alter|create|replace|attach|pragma|vacuum)\b",
                 sql, re.IGNORECASE):
        raise ValueError("only read-only SELECT queries are allowed")
    if not re.match(r"\s*(select|with)\b", sql, re.IGNORECASE):
        raise ValueError("query must start with SELECT or WITH")
    rows = conn.execute(sql).fetchmany(limit)
    return _rows(rows)


# ---------------------------------------------------------------------------
# Photos


def attach_photo(
    conn: sqlite3.Connection,
    source_path: str,
    wine_id: int | None = None,
    purchase_id: int | None = None,
    tasting_id: int | None = None,
    kind: str = "label",
) -> dict[str, Any]:
    """Copy an image into the photo store and link it. ``source_path`` is a file on
    this machine (e.g. an image the agent saved from a chat)."""
    if kind not in {"label", "receipt", "other"}:
        raise ValueError("kind must be label, receipt, or other")
    if wine_id is None and purchase_id is None and tasting_id is None:
        raise ValueError("photo must reference a wine, purchase, or tasting")
    source = Path(source_path).expanduser()
    if not source.is_file():
        raise ValueError(f"no file at {source}")
    suffix = source.suffix.lower() or ".jpg"
    filename = f"{uuid.uuid4().hex[:12]}{suffix}"
    destination_dir = config.photos_dir()
    destination_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination_dir / filename)
    cursor = conn.execute(
        "INSERT INTO photos (wine_id, purchase_id, tasting_id, kind, path) VALUES (?, ?, ?, ?, ?)",
        (wine_id, purchase_id, tasting_id, kind, filename),
    )
    if wine_id is not None:
        _touch_wine(conn, wine_id)
    conn.commit()
    return _row(conn.execute("SELECT * FROM photos WHERE id = ?", (cursor.lastrowid,)).fetchone())


# ---------------------------------------------------------------------------
# Wishlist


def wishlist_add(
    conn: sqlite3.Connection,
    wine_id: int,
    shop_name: str | None = None,
    listed_price: float | None = None,
    reason: str | None = None,
    recommended_by: str | None = None,
) -> dict[str, Any]:
    if conn.execute("SELECT 1 FROM wines WHERE id = ?", (wine_id,)).fetchone() is None:
        raise ValueError(f"no wine with id {wine_id}")
    cursor = conn.execute(
        """
        INSERT INTO wishlist (wine_id, shop_name, listed_price, reason, recommended_by)
        VALUES (?, ?, ?, ?, ?)
        """,
        (wine_id, shop_name, listed_price, reason, recommended_by),
    )
    conn.commit()
    return _row(conn.execute("SELECT * FROM wishlist WHERE id = ?", (cursor.lastrowid,)).fetchone())


def wishlist_list(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Wishlist entries, newest first, with enough wine detail to render a row.

    ``quantity`` rides along so callers can flag entries for wine already in the
    cellar — a recommendation often names something we turn out to own.
    """
    return _rows(
        conn.execute(
            """
            SELECT wl.*, w.producer, w.wine_name, w.vintage, w.wine_type,
                   w.region, w.country, w.quantity
            FROM wishlist wl JOIN wines w ON w.id = wl.wine_id
            ORDER BY wl.created_at DESC
            """
        ).fetchall()
    )


def wishlist_remove(conn: sqlite3.Connection, wishlist_id: int) -> None:
    cursor = conn.execute("DELETE FROM wishlist WHERE id = ?", (wishlist_id,))
    if cursor.rowcount == 0:
        raise ValueError(f"no wishlist entry with id {wishlist_id}")
    conn.commit()
