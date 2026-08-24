"""Fail-closed backfill for provider rating and listed-price snapshots.

Uses only the exact provider records already stored on a wine label. Vivino
returns a vintage-specific rating and, where available, a current US/USD listed
price through its public JSON surfaces. CellarTracker is queried only for its
community rating at the exact wine page; its prices are intentionally out of
scope for this backfill. WAF blocks or ambiguous pages leave its values untouched.

Dry-run is the default. ``--write`` takes a verified SQLite backup and applies
all planned updates in one transaction after re-checking wine identity.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import re
import sqlite3
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from cellar import core, db

IDENTITY_FIELDS = ("producer", "wine_name", "vintage")
VIVINO_WINE_ID = re.compile(r"/w/(\d+)$", re.IGNORECASE)
CELLARTRACKER_RATING = re.compile(
    r"Average of\s+(\d+(?:\.\d+)?)\s+points\s+in\s+\d+\s+community wine reviews",
    re.IGNORECASE,
)
USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
    "AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
)
# Explicit user-selected market for this backfill. Do not reuse this script for
# another cellar without making market/currency a user-provided option.
VIVINO_PRICE_COUNTRY = "US"
VIVINO_PRICE_CURRENCY = "USD"


@dataclass(frozen=True)
class PlannedUpdate:
    wine_id: int
    identity_sha256: str
    vivino_url: str | None
    cellartracker_wine_id: str | None
    fields: dict[str, Any]
    notes: tuple[str, ...]


def identity_sha256(row: sqlite3.Row | dict[str, Any]) -> str:
    identity = [str(row[field] or "").strip() for field in IDENTITY_FIELDS]
    return hashlib.sha256(
        json.dumps(identity, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _canonical_vivino_year_url(value: str, year: str) -> tuple[str, int]:
    """Require a stored exact Vivino wine page and attach the exact vintage."""
    canonical = core.canonical_vivino_url(value)
    parsed = urlparse(canonical)
    match = VIVINO_WINE_ID.search(parsed.path.rstrip("/"))
    if match is None:
        raise ValueError("Vivino link is not an exact wine page")
    return f"https://www.vivino.com{parsed.path.rstrip('/')}?year={year}", int(match.group(1))


def _number(value: Any, field: str, *, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} is not a number")  # noqa: TRY004 - malformed provider data
    number = float(value)
    if not math.isfinite(number) or not low <= number <= high:
        raise ValueError(f"{field} is outside its valid range")
    return number


def _get_json(url: str, *, timeout: float) -> dict[str, Any]:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    with urlopen(request, timeout=timeout) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ValueError("provider response was not an object")  # noqa: TRY004 - malformed provider data
    return payload


def _get_text(url: str, *, timeout: float) -> str:
    request = Request(url, headers={"Accept": "text/html", "User-Agent": USER_AGENT})
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def _normalized_tokens(value: str) -> set[str]:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return {token for token in re.findall(r"[a-z0-9]+", ascii_value.casefold()) if len(token) > 1}


def _matches_identity(wine: sqlite3.Row, name: str) -> bool:
    wanted = _normalized_tokens(f"{wine['producer']} {wine['wine_name']}")
    observed = _normalized_tokens(name)
    # At least two substantive identity tokens are required when available.
    required = min(2, len(wanted))
    return required == 0 or len(wanted & observed) >= required


def fetch_vivino(wine: sqlite3.Row, *, timeout: float) -> tuple[dict[str, Any], list[str]]:
    """Fetch only metrics demonstrably tied to the existing exact Vivino link."""
    vintage = str(wine["vintage"] or "").strip()
    if re.fullmatch(r"\d{4}", vintage) is None:
        return {}, ["Vivino skipped: only four-digit vintages can be verified automatically"]
    if not wine["vivino_url"]:
        return {}, ["Vivino skipped: no exact link"]

    exact_url, wine_id = _canonical_vivino_year_url(str(wine["vivino_url"]), vintage)
    review_query = urlencode({"year": vintage, "per_page": 1})
    review_data = _get_json(
        f"https://www.vivino.com/api/wines/{wine_id}/reviews?{review_query}", timeout=timeout
    )
    reviews = review_data.get("reviews")
    if not isinstance(reviews, list) or not reviews:
        return {}, ["Vivino skipped: no exact-vintage response"]
    source_vintage = reviews[0].get("vintage") if isinstance(reviews[0], dict) else None
    if not isinstance(source_vintage, dict):
        return {}, ["Vivino skipped: malformed exact-vintage response"]
    source_wine = source_vintage.get("wine")
    if not isinstance(source_wine, dict) or source_wine.get("id") != wine_id:
        return {}, ["Vivino skipped: returned wine id differs from stored exact link"]
    if str(source_vintage.get("year")) != vintage:
        return {}, ["Vivino skipped: returned vintage differs from local wine"]
    if not _matches_identity(wine, str(source_vintage.get("name") or "")):
        return {}, ["Vivino skipped: returned identity does not match local wine"]

    fields: dict[str, Any] = {}

    def with_exact_url() -> dict[str, Any]:
        return {"vivino_url": exact_url, **fields} if fields else {}

    stats = source_vintage.get("statistics")
    if isinstance(stats, dict) and stats.get("status") == "Normal":
        try:
            fields["vivino_rating"] = _number(
                stats.get("ratings_average"), "Vivino rating", low=0.000001, high=5
            )
        except ValueError:
            pass

    vintage_id = source_vintage.get("id")
    if isinstance(vintage_id, int) and not isinstance(vintage_id, bool):
        price_query = urlencode(
            [
                ("vintage_ids[]", str(vintage_id)),
                ("country_code", VIVINO_PRICE_COUNTRY),
                ("currency_code", VIVINO_PRICE_CURRENCY),
            ]
        )
        try:
            prices = _get_json(f"https://www.vivino.com/api/prices?{price_query}", timeout=timeout)
            root = prices.get("prices")
            if isinstance(root, dict):
                market = root.get("market")
                entries = root.get("vintages")
                entry = entries.get(str(vintage_id)) if isinstance(entries, dict) else None
                currency = (
                    market.get("currency", {}).get("code")
                    if isinstance(market, dict) and isinstance(market.get("currency"), dict)
                    else None
                )
                returned_vintage = entry.get("vintage") if isinstance(entry, dict) else None
                listed = entry.get("price") if isinstance(entry, dict) else None
                if (
                    isinstance(returned_vintage, dict)
                    and returned_vintage.get("id") == vintage_id
                    and str(returned_vintage.get("year")) == vintage
                    and isinstance(listed, dict)
                    and isinstance(currency, str)
                    and currency == VIVINO_PRICE_CURRENCY
                    and isinstance(market, dict)
                    and str(market.get("country", "")).upper() == VIVINO_PRICE_COUNTRY
                ):
                    price = _number(
                        listed.get("amount"),
                        "Vivino listed price",
                        low=0.000001,
                        high=1_000_000_000,
                    )
                    fields["vivino_price"] = round(price, 2)
                    fields["vivino_price_currency"] = currency
                else:
                    return with_exact_url(), [
                        "Vivino price unavailable: response did not confirm the exact vintage"
                    ]
        except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
            return with_exact_url(), [f"Vivino price unavailable: {type(error).__name__}"]
    return with_exact_url(), []


def fetch_cellartracker(wine: sqlite3.Row, *, timeout: float) -> tuple[dict[str, Any], list[str]]:
    """Read a public exact CellarTracker page when it is actually accessible."""
    wine_id = wine["cellartracker_wine_id"]
    if not wine_id:
        return {}, ["CellarTracker skipped: no exact link"]
    url = core.cellartracker_url(str(wine_id))
    if not url:
        return {}, ["CellarTracker skipped: invalid stored id"]
    try:
        body = _get_text(url, timeout=timeout)
    except (HTTPError, URLError, TimeoutError) as error:
        return {}, [f"CellarTracker unavailable: {type(error).__name__}"]
    if "awsWafCookieDomainList" in body or "request could not be satisfied" in body.casefold():
        return {}, ["CellarTracker unavailable: WAF challenge"]
    match = CELLARTRACKER_RATING.search(body)
    if match is None:
        return {}, ["CellarTracker rating unavailable on exact page"]
    rating = _number(float(match.group(1)), "CellarTracker rating", low=0, high=100)
    return {"cellartracker_rating": rating}, []


def _changed_fields(current: sqlite3.Row, fields: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in fields.items() if current[key] != value}


def collect_updates(
    conn: sqlite3.Connection,
    *,
    include_out_of_stock: bool = False,
    limit: int | None = None,
    timeout: float = 30.0,
    delay: float = 0.5,
) -> tuple[list[PlannedUpdate], list[dict[str, Any]]]:
    """Fetch a plan without touching the database; failures are per-wine and fail closed."""
    where = "" if include_out_of_stock else "WHERE quantity > 0"
    query = f"SELECT * FROM wines {where} ORDER BY id"
    if limit is not None:
        query += " LIMIT ?"
        rows = conn.execute(query, (limit,)).fetchall()
    else:
        rows = conn.execute(query).fetchall()

    updates: list[PlannedUpdate] = []
    outcomes: list[dict[str, Any]] = []
    for index, wine in enumerate(rows):
        notes: list[str] = []
        fields: dict[str, Any] = {}
        try:
            vivino, vivino_notes = fetch_vivino(wine, timeout=timeout)
            fields.update(vivino)
            notes.extend(vivino_notes)
        except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
            notes.append(f"Vivino unavailable: {type(error).__name__}")
        try:
            cellartracker, cellartracker_notes = fetch_cellartracker(wine, timeout=timeout)
            fields.update(cellartracker)
            notes.extend(cellartracker_notes)
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            notes.append(f"CellarTracker unavailable: {type(error).__name__}")

        changed = _changed_fields(wine, fields)
        if changed:
            updates.append(
                PlannedUpdate(
                    wine["id"],
                    identity_sha256(wine),
                    wine["vivino_url"],
                    wine["cellartracker_wine_id"],
                    changed,
                    tuple(notes),
                )
            )
        outcomes.append(
            {
                "wine_id": wine["id"],
                "producer": wine["producer"],
                "wine_name": wine["wine_name"],
                "vintage": wine["vintage"],
                "fields": changed,
                "status": "planned" if changed else "unchanged",
                "notes": notes,
            }
        )
        if delay and index + 1 < len(rows):
            time.sleep(delay)
    return updates, outcomes


def backup_database(database_file: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = dt.datetime.now().astimezone().strftime("%Y%m%d_%H%M%S_%f")
    path = backup_dir / f"cellar.db.before_provider_metrics_backfill.{timestamp}.bak"
    source = sqlite3.connect(f"{database_file.resolve().as_uri()}?mode=ro", uri=True)
    destination = sqlite3.connect(path)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    check = sqlite3.connect(path)
    try:
        integrity = check.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        check.close()
    if integrity != "ok":
        path.unlink(missing_ok=True)
        raise RuntimeError(f"backup integrity check failed: {integrity}")
    return path


def apply_updates(
    conn: sqlite3.Connection,
    updates: list[PlannedUpdate],
    *,
    write: bool = False,
    backup_dir: Path | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "mode": "write" if write else "dry-run",
        "updates": [{"wine_id": item.wine_id, "fields": item.fields} for item in updates],
        "updated_count": len(updates),
    }
    if not write or not updates:
        return payload

    conn.execute("BEGIN IMMEDIATE")
    try:
        for item in updates:
            current = conn.execute("SELECT * FROM wines WHERE id = ?", (item.wine_id,)).fetchone()
            if current is None or identity_sha256(current) != item.identity_sha256:
                raise ValueError(f"wine {item.wine_id} identity changed; re-run the backfill")
            if (
                current["vivino_url"] != item.vivino_url
                or current["cellartracker_wine_id"] != item.cellartracker_wine_id
            ):
                raise ValueError(f"wine {item.wine_id} provider link changed; re-run the backfill")
        database_file = Path(
            next(
                row["file"] for row in conn.execute("PRAGMA database_list") if row["name"] == "main"
            )
        )
        backup = backup_database(database_file, backup_dir or database_file.parent / "backups")
        for item in updates:
            core.update_wine(conn, item.wine_id, commit=False, **item.fields)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    payload["backup"] = str(backup)
    return payload


def enrich(
    conn: sqlite3.Connection,
    *,
    write: bool = False,
    include_out_of_stock: bool = False,
    limit: int | None = None,
    timeout: float = 30.0,
    delay: float = 0.5,
    backup_dir: Path | None = None,
) -> dict[str, Any]:
    updates, outcomes = collect_updates(
        conn,
        include_out_of_stock=include_out_of_stock,
        limit=limit,
        timeout=timeout,
        delay=delay,
    )
    payload = apply_updates(conn, updates, write=write, backup_dir=backup_dir)
    payload["outcomes"] = outcomes
    payload["scanned_count"] = len(outcomes)
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=None, help="Cellar SQLite path")
    parser.add_argument("--all", action="store_true", help="Include out-of-stock labels")
    parser.add_argument("--limit", type=int, default=None, help="Cap labels scanned")
    parser.add_argument(
        "--timeout", type=float, default=30, help="Provider request timeout in seconds"
    )
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between labels in seconds")
    parser.add_argument(
        "--write", action="store_true", help="Apply planned values after a verified backup"
    )
    parser.add_argument("--backup-dir", type=Path, default=None)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit must be positive")
    if args.timeout <= 0 or args.delay < 0:
        raise SystemExit("--timeout must be positive and --delay nonnegative")
    conn = db.open_db(args.db)
    try:
        print(
            json.dumps(
                enrich(
                    conn,
                    write=args.write,
                    include_out_of_stock=args.all,
                    limit=args.limit,
                    timeout=args.timeout,
                    delay=args.delay,
                    backup_dir=args.backup_dir,
                ),
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
