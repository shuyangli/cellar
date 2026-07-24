"""MCP (stdio) server exposing the cellar to AI agents.

Register with Hermes:

    hermes mcp add cellar --command <path-to>/cellar-mcp

Conventions the tools expect: dates ISO ``YYYY-MM-DD``, ratings 0-100 (critic
scale — normalize other scales before logging), prices per bottle with an ISO
currency code (default USD).
"""

from __future__ import annotations

import functools
import inspect
from typing import Any

from mcp.server.fastmcp import FastMCP

from . import core, db

mcp = FastMCP(
    "cellar",
    instructions=(
        "Wine cellar database. Workflow for logging: ALWAYS call find_wine first to "
        "avoid duplicates; if the wine exists, use its id, otherwise add_wine (enrich "
        "with country/region/appellation/varietal/wine_type/drinking window before "
        "adding). Then log_purchase for buys, log_tasting for drinking + reviews. "
        "Dates are ISO YYYY-MM-DD, ratings 0-100, prices per bottle."
    ),
)


def _with_db(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        conn = db.open_db()
        try:
            return fn(conn, *args, **kwargs)
        finally:
            conn.close()

    # Hide the conn parameter from FastMCP's schema introspection.
    signature = inspect.signature(fn)
    wrapper.__signature__ = signature.replace(
        parameters=list(signature.parameters.values())[1:]
    )
    return wrapper


@mcp.tool()
@_with_db
def find_wine(conn, query: str, limit: int = 10) -> list[dict[str, Any]]:
    """Fuzzy-search wines by any mix of producer, name, vintage, region, or grape.
    ALWAYS call this before add_wine to avoid creating duplicates. Returns matches
    with id, quantity in stock, and identifying fields."""
    return core.find_wines(conn, query, limit=limit)


@mcp.tool()
@_with_db
def add_wine(
    conn,
    producer: str,
    wine_name: str,
    vintage: str = "",
    wine_type: str = "",
    country: str = "",
    region: str = "",
    appellation: str = "",
    varietal: str = "",
    grapes: str = "",
    bottle_size_ml: int = 750,
    drinking_window_start: str = "",
    drinking_window_end: str = "",
    notes: str = "",
) -> dict[str, Any]:
    """Add a new wine (a label, not stock — use log_purchase to add bottles).
    Only call after find_wine shows no existing match. Enrich before adding:
    wine_type is one of red/white/rose/sparkling/dessert/fortified/orange/other;
    grapes is a comma-separated blend breakdown if varietal alone is insufficient;
    drinking_window_start/end are years like '2027'. Use vintage 'NV' for
    non-vintage. Put producer/region context or enrichment sources in notes."""
    return core.add_wine(
        conn,
        producer=producer,
        wine_name=wine_name,
        vintage=vintage,
        wine_type=wine_type,
        country=country,
        region=region,
        appellation=appellation,
        varietal=varietal,
        grapes=grapes,
        bottle_size_ml=bottle_size_ml,
        drinking_window_start=drinking_window_start,
        drinking_window_end=drinking_window_end,
        notes=notes,
        source_app="hermes",
    )


@mcp.tool()
@_with_db
def update_wine(conn, wine_id: int, fields: dict[str, Any]) -> dict[str, Any]:
    """Update fields on an existing wine. Allowed keys: producer, wine_name, vintage,
    country, region, appellation, varietal, wine_type, grapes, bottle_size_ml,
    location, drinking_window_start, drinking_window_end, notes."""
    return core.update_wine(conn, wine_id, **fields)


@mcp.tool()
@_with_db
def log_purchase(
    conn,
    wine_id: int,
    quantity: int,
    price_per_bottle: float | None = None,
    currency: str = "USD",
    vendor: str = "",
    purchase_date: str = "",
    source: str = "other",
    notes: str = "",
) -> dict[str, Any]:
    """Record buying bottles of an existing wine (find_wine/add_wine first).
    Increments inventory and writes an auditable event. source is one of
    online/in_person/gift/other. purchase_date defaults to today (ISO date).
    Returns the wine's full updated dossier."""
    return core.log_purchase(
        conn,
        wine_id,
        quantity,
        price_per_bottle=price_per_bottle,
        currency=currency,
        vendor=vendor or None,
        purchase_date=purchase_date or None,
        source=source,
        notes=notes or None,
    )


@mcp.tool()
@_with_db
def log_tasting(
    conn,
    wine_id: int,
    rating: int | None = None,
    tasting_notes: str = "",
    food_pairing: str = "",
    context_type: str = "home",
    venue: str = "",
    price_paid: float | None = None,
    buy_again: bool | None = None,
    tasted_on: str = "",
    user: str = "",
    consume_bottle: bool = True,
) -> dict[str, Any]:
    """Record drinking and reviewing a wine. rating is 0-100 (critic scale);
    capture the drinker's verbatim impressions in tasting_notes — this data is
    mined later for preferences, so keep it rich (aromas, structure, evolution,
    context). By default consumes one bottle from the cellar; set
    consume_bottle=false for wines tasted elsewhere (then set context_type to
    'restaurant' or 'tasting' and venue). user defaults to the cellar owner;
    pass a name for someone else. tasted_on defaults to today."""
    return core.log_tasting(
        conn,
        wine_id,
        user=user or None,
        rating=rating,
        tasting_notes=tasting_notes or None,
        food_pairing=food_pairing or None,
        context_type=context_type,
        venue=venue or None,
        price_paid=price_paid,
        buy_again=buy_again,
        tasted_on=tasted_on or None,
        consume_bottle=consume_bottle,
    )


@mcp.tool()
@_with_db
def adjust_inventory(conn, wine_id: int, delta: int, reason: str, event_type: str = "adjust") -> dict[str, Any]:
    """Manually change bottle count (negative delta removes bottles). Use for
    corrections, breakage, or gifts given (event_type 'gift'). Purchases and
    tastings adjust automatically — do not double-count them. Always give a
    concrete reason."""
    return core.adjust_inventory(conn, wine_id, delta, reason=reason, event_type=event_type)


@mcp.tool()
@_with_db
def get_wine(conn, wine_id: int) -> dict[str, Any]:
    """Full dossier for one wine: fields, quantity, purchases, tastings with
    reviewer names, inventory events, photos, and average rating."""
    return core.get_wine(conn, wine_id)


@mcp.tool()
@_with_db
def list_inventory(
    conn,
    q: str = "",
    wine_type: str = "",
    country: str = "",
    region: str = "",
    vintage: str = "",
    in_stock: bool = True,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    """Browse/search the cellar. q fuzzy-matches producer/name/vintage/region/
    appellation/grape/country; other filters narrow further. Set in_stock=false
    to include wines with zero bottles remaining."""
    return core.list_inventory(
        conn,
        page=page,
        page_size=page_size,
        q=q or None,
        wine_type=wine_type or None,
        country=country or None,
        region=region or None,
        vintage=vintage or None,
        in_stock=in_stock,
    )


@mcp.tool()
@_with_db
def cellar_stats(conn) -> dict[str, Any]:
    """Cellar analytics: totals, composition by type/country/region, spend by
    month, top-rated wines, recent tastings."""
    return core.cellar_stats(conn)


@mcp.tool()
@_with_db
def drinking_window_alerts(conn) -> dict[str, Any]:
    """Wines grouped by drinking window vs. today: ready (with closing_soon
    flags), approaching, past_peak, and no_window (candidates for enrichment)."""
    return core.drinking_window_alerts(conn)


@mcp.tool()
@_with_db
def attach_photo(
    conn,
    file_path: str,
    wine_id: int | None = None,
    purchase_id: int | None = None,
    tasting_id: int | None = None,
    kind: str = "label",
) -> dict[str, Any]:
    """Attach an image (label, receipt, or other) to a wine, purchase, or tasting.
    file_path is a local path to an image already saved on this machine; the file
    is copied into the cellar's photo store."""
    return core.attach_photo(
        conn,
        file_path,
        wine_id=wine_id,
        purchase_id=purchase_id,
        tasting_id=tasting_id,
        kind=kind,
    )


@mcp.tool()
@_with_db
def wishlist_add(
    conn,
    wine_id: int,
    shop_name: str = "",
    listed_price: float | None = None,
    reason: str = "",
) -> dict[str, Any]:
    """Add a wine to the wishlist (add_wine it first if new — a wishlist entry
    references a wine with zero stock). Use when the owner spots something worth
    buying later."""
    return core.wishlist_add(
        conn,
        wine_id,
        shop_name=shop_name or None,
        listed_price=listed_price,
        reason=reason or None,
    )


@mcp.tool()
@_with_db
def wishlist_list(conn) -> list[dict[str, Any]]:
    """List wishlist entries with wine identification."""
    return core.wishlist_list(conn)


@mcp.tool()
@_with_db
def query(conn, sql: str, limit: int = 200) -> list[dict[str, Any]]:
    """Read-only SQL (SELECT/WITH) against the cellar database for custom
    analytics. Tables: wines, purchases, tastings, inventory_events, photos,
    users, wishlist. Mutations are rejected — use the dedicated tools to write."""
    return core.read_query(conn, sql, limit=limit)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
