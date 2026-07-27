"""``cellar`` CLI — the same operations as the MCP server, for scripts and debugging.

All commands print JSON to stdout.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from . import core, db


def _print(payload: Any) -> None:
    json.dump(payload, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")


def _add_wine_field_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--vintage", default="")
    parser.add_argument("--wine-type", default="", help="red/white/rose/sparkling/…")
    parser.add_argument("--country", default="")
    parser.add_argument("--region", default="")
    parser.add_argument("--appellation", default="")
    parser.add_argument("--varietal", default="")
    parser.add_argument("--grapes", default="")
    parser.add_argument("--bottle-size-ml", type=int, default=750)
    parser.add_argument("--drink-from", default="", dest="drinking_window_start")
    parser.add_argument("--drink-until", default="", dest="drinking_window_end")
    parser.add_argument("--notes", default="")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cellar", description="Wine cellar database")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("find", help="Fuzzy-search wines (dedupe before adding)")
    p.add_argument("query")
    p.add_argument("--limit", type=int, default=10)

    p = sub.add_parser("add-wine", help="Add a wine label (no stock)")
    p.add_argument("producer")
    p.add_argument("wine_name")
    _add_wine_field_args(p)

    p = sub.add_parser("buy", help="Log a purchase for a wine id")
    p.add_argument("wine_id", type=int)
    p.add_argument("quantity", type=int)
    p.add_argument("--price", type=float, default=None, help="Per bottle")
    p.add_argument("--currency", default="USD")
    p.add_argument("--vendor", default="")
    p.add_argument("--date", default="", help="ISO purchase date, default today")
    p.add_argument("--source", default="other", choices=["online", "in_person", "gift", "other"])
    p.add_argument("--notes", default="")

    p = sub.add_parser("taste", help="Log drinking + review for a wine id")
    p.add_argument("wine_id", type=int)
    p.add_argument("--rating", type=int, default=None, help="0-100")
    p.add_argument("--notes", default="", dest="tasting_notes")
    p.add_argument("--pairing", default="", dest="food_pairing")
    p.add_argument("--context", default="home", dest="context_type")
    p.add_argument("--venue", default="")
    p.add_argument("--price-paid", type=float, default=None)
    p.add_argument("--buy-again", action="store_true", default=None)
    p.add_argument("--date", default="", dest="tasted_on")
    p.add_argument("--user", default="")
    p.add_argument("--no-consume", action="store_true", help="Tasted elsewhere; keep inventory")

    p = sub.add_parser("adjust", help="Manual inventory adjustment")
    p.add_argument("wine_id", type=int)
    p.add_argument("delta", type=int)
    p.add_argument("reason")
    p.add_argument("--event-type", default="adjust", choices=["adjust", "gift", "consume"])

    p = sub.add_parser("show", help="Full dossier for a wine id")
    p.add_argument("wine_id", type=int)

    p = sub.add_parser("list", help="Browse/search inventory")
    p.add_argument("-q", "--query", default="")
    p.add_argument("--type", default="", dest="wine_type")
    p.add_argument("--country", default="")
    p.add_argument("--region", default="")
    p.add_argument("--vintage", default="")
    p.add_argument("--all", action="store_true", help="Include out-of-stock wines")
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--page-size", type=int, default=50)

    sub.add_parser("stats", help="Cellar analytics")
    sub.add_parser("drink-now", help="Drinking-window alerts")

    p = sub.add_parser("photo", help="Attach a photo file")
    p.add_argument("file_path")
    p.add_argument("--wine-id", type=int, default=None)
    p.add_argument("--purchase-id", type=int, default=None)
    p.add_argument("--tasting-id", type=int, default=None)
    p.add_argument("--kind", default="label", choices=["label", "receipt", "other"])

    p = sub.add_parser("wishlist", help="Wishlist operations")
    wl = p.add_subparsers(dest="wishlist_command", required=True)
    w = wl.add_parser("add")
    w.add_argument("wine_id", type=int)
    w.add_argument("--recommended-by", default="")
    w.add_argument("--shop", default="")
    w.add_argument("--price", type=float, default=None)
    w.add_argument("--reason", default="")
    wl.add_parser("list")
    w = wl.add_parser("remove")
    w.add_argument("wishlist_id", type=int)

    p = sub.add_parser("query", help="Read-only SQL")
    p.add_argument("sql")
    p.add_argument("--limit", type=int, default=200)

    p = sub.add_parser("update-wine", help="Update wine fields (JSON object)")
    p.add_argument("wine_id", type=int)
    p.add_argument("fields_json", help='e.g. \'{"region": "Barolo"}\'')

    return parser


def main() -> None:
    args = build_parser().parse_args()
    conn = db.open_db()
    try:
        match args.command:
            case "find":
                _print(core.find_wines(conn, args.query, limit=args.limit))
            case "add-wine":
                _print(
                    core.add_wine(
                        conn,
                        producer=args.producer,
                        wine_name=args.wine_name,
                        vintage=args.vintage,
                        wine_type=args.wine_type,
                        country=args.country,
                        region=args.region,
                        appellation=args.appellation,
                        varietal=args.varietal,
                        grapes=args.grapes,
                        bottle_size_ml=args.bottle_size_ml,
                        drinking_window_start=args.drinking_window_start,
                        drinking_window_end=args.drinking_window_end,
                        notes=args.notes,
                        source_app="cli",
                    )
                )
            case "buy":
                _print(
                    core.log_purchase(
                        conn,
                        args.wine_id,
                        args.quantity,
                        price_per_bottle=args.price,
                        currency=args.currency,
                        vendor=args.vendor or None,
                        purchase_date=args.date or None,
                        source=args.source,
                        notes=args.notes or None,
                    )
                )
            case "taste":
                _print(
                    core.log_tasting(
                        conn,
                        args.wine_id,
                        user=args.user or None,
                        rating=args.rating,
                        tasting_notes=args.tasting_notes or None,
                        food_pairing=args.food_pairing or None,
                        context_type=args.context_type,
                        venue=args.venue or None,
                        price_paid=args.price_paid,
                        buy_again=args.buy_again,
                        tasted_on=args.tasted_on or None,
                        consume_bottle=not args.no_consume,
                    )
                )
            case "adjust":
                _print(
                    core.adjust_inventory(
                        conn, args.wine_id, args.delta, reason=args.reason,
                        event_type=args.event_type,
                    )
                )
            case "show":
                _print(core.get_wine(conn, args.wine_id))
            case "list":
                _print(
                    core.list_inventory(
                        conn,
                        page=args.page,
                        page_size=args.page_size,
                        q=args.query or None,
                        wine_type=args.wine_type or None,
                        country=args.country or None,
                        region=args.region or None,
                        vintage=args.vintage or None,
                        in_stock=not args.all,
                    )
                )
            case "stats":
                _print(core.cellar_stats(conn))
            case "drink-now":
                _print(core.drinking_window_alerts(conn))
            case "photo":
                _print(
                    core.attach_photo(
                        conn,
                        args.file_path,
                        wine_id=args.wine_id,
                        purchase_id=args.purchase_id,
                        tasting_id=args.tasting_id,
                        kind=args.kind,
                    )
                )
            case "wishlist":
                match args.wishlist_command:
                    case "add":
                        _print(
                            core.wishlist_add(
                                conn,
                                args.wine_id,
                                shop_name=args.shop or None,
                                listed_price=args.price,
                                reason=args.reason or None,
                                recommended_by=args.recommended_by or None,
                            )
                        )
                    case "list":
                        _print(core.wishlist_list(conn))
                    case "remove":
                        core.wishlist_remove(conn, args.wishlist_id)
                        _print({"ok": True})
            case "query":
                _print(core.read_query(conn, args.sql, limit=args.limit))
            case "update-wine":
                _print(core.update_wine(conn, args.wine_id, **json.loads(args.fields_json)))
    except ValueError as error:
        json.dump({"error": str(error)}, sys.stdout, indent=2)
        sys.stdout.write("\n")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
