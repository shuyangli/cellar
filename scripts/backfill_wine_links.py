"""Review-first backfill for Vivino and CellarTracker wine links.

The exporter creates a CSV review queue with one row per in-stock wine and
provider search URLs. A human or AI reviewer fills exact links and marks rows
``approved``. The importer validates provider domains, exact-page URL shapes,
and the wine identity snapshot before writing. Dry-run is the default.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import sqlite3
from pathlib import Path
from urllib.parse import quote_plus

from cellar import core, db

REVIEW_FIELDS = [
    "id",
    "producer",
    "wine_name",
    "vintage",
    "quantity",
    "identity_sha256",
    "vivino_url",
    "cellartracker_url",
    "vivino_search_url",
    "cellartracker_search_url",
    "review_status",
    "review_notes",
]
IDENTITY_FIELDS = ("producer", "wine_name", "vintage")
APPROVED = "approved"
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def identity_sha256(row: sqlite3.Row | dict[str, object]) -> str:
    identity = [str(row[field] or "").strip() for field in IDENTITY_FIELDS]
    payload = json.dumps(identity, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def spreadsheet_safe(value: object) -> object:
    """Prevent database text from becoming a spreadsheet formula in review CSVs."""
    if isinstance(value, str) and value.startswith(FORMULA_PREFIXES):
        return "'" + value
    return value


def wine_query(row: sqlite3.Row | dict[str, object]) -> str:
    return " ".join(
        str(row[key]).strip()
        for key in ("producer", "wine_name", "vintage")
        if row[key] is not None and str(row[key]).strip() not in {"", "NV"}
    )


def provider_search_urls(row: sqlite3.Row | dict[str, object]) -> tuple[str, str]:
    query = quote_plus(wine_query(row))
    return (
        f"https://www.vivino.com/search/wines?q={query}",
        (f"https://www.cellartracker.com/list.asp?Table=List&iUserOverride=0&szSearch={query}"),
    )


def export_review_queue(
    conn: sqlite3.Connection, output: Path, *, include_out_of_stock: bool = False
) -> int:
    where = "" if include_out_of_stock else "WHERE quantity > 0"
    rows = conn.execute(
        f"""
        SELECT id, producer, wine_name, vintage, quantity,
               vivino_url, cellartracker_wine_id
        FROM wines {where}
        ORDER BY producer COLLATE NOCASE, wine_name COLLATE NOCASE, vintage, id
        """
    ).fetchall()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=REVIEW_FIELDS)
        writer.writeheader()
        for row in rows:
            vivino_search, cellartracker_search = provider_search_urls(row)
            cellartracker_link = core.safe_cellartracker_url(row["cellartracker_wine_id"])
            invalid_cellartracker = bool(row["cellartracker_wine_id"] and not cellartracker_link)
            writer.writerow(
                {
                    "id": row["id"],
                    "producer": spreadsheet_safe(row["producer"]),
                    "wine_name": spreadsheet_safe(row["wine_name"]),
                    "vintage": spreadsheet_safe(row["vintage"] or ""),
                    "quantity": row["quantity"],
                    "identity_sha256": identity_sha256(row),
                    "vivino_url": row["vivino_url"] or "",
                    "cellartracker_url": cellartracker_link or "",
                    "vivino_search_url": vivino_search,
                    "cellartracker_search_url": cellartracker_search,
                    "review_status": "",
                    "review_notes": (
                        "Invalid stored CellarTracker id; find and approve the exact page."
                        if invalid_cellartracker
                        else ""
                    ),
                }
            )
    return len(rows)


def read_approved_updates(
    conn: sqlite3.Connection, review_file: Path
) -> list[tuple[int, dict[str, str]]]:
    updates: list[tuple[int, dict[str, str]]] = []
    seen: set[int] = set()
    with review_file.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        missing = set(REVIEW_FIELDS) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"review CSV is missing columns: {sorted(missing)}")
        for line_number, review in enumerate(reader, start=2):
            status = (review["review_status"] or "").strip().lower()
            if status != APPROVED:
                continue
            try:
                wine_id = int(review["id"])
            except (TypeError, ValueError) as error:
                raise ValueError(f"line {line_number}: invalid wine id") from error
            if wine_id in seen:
                raise ValueError(f"line {line_number}: duplicate approved wine id {wine_id}")
            seen.add(wine_id)
            current = conn.execute("SELECT * FROM wines WHERE id = ?", (wine_id,)).fetchone()
            if current is None:
                raise ValueError(f"line {line_number}: no wine with id {wine_id}")
            expected_hash = (review["identity_sha256"] or "").strip().lower()
            actual_hash = identity_sha256(current)
            if expected_hash != actual_hash:
                raise ValueError(
                    f"line {line_number}: wine {wine_id} identity changed; "
                    "re-export before applying"
                )

            fields: dict[str, str] = {}
            vivino = (review["vivino_url"] or "").strip()
            cellartracker = (review["cellartracker_url"] or "").strip()
            if vivino:
                fields["vivino_url"] = core.canonical_vivino_url(vivino)
            if cellartracker:
                fields["cellartracker_url"] = (
                    core.cellartracker_url(core.cellartracker_wine_id(cellartracker)) or ""
                )
            if not fields:
                raise ValueError(
                    f"line {line_number}: approved row {wine_id} has no exact provider link"
                )

            changed: dict[str, str] = {}
            if "vivino_url" in fields and fields["vivino_url"] != (current["vivino_url"] or None):
                changed["vivino_url"] = fields["vivino_url"]
            current_cellartracker = core.safe_cellartracker_url(current["cellartracker_wine_id"])
            if (
                "cellartracker_url" in fields
                and fields["cellartracker_url"] != current_cellartracker
            ):
                changed["cellartracker_url"] = fields["cellartracker_url"]
            if changed:
                updates.append((wine_id, changed))
    return updates


def backup_database(database_file: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = dt.datetime.now().astimezone().strftime("%Y%m%d_%H%M%S_%f")
    path = backup_dir / f"cellar.db.before_wine_link_backfill.{timestamp}.bak"
    source = sqlite3.connect(f"{database_file.resolve().as_uri()}?mode=ro", uri=True)
    destination = sqlite3.connect(path)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    check = sqlite3.connect(path)
    try:
        result = check.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        check.close()
    if result != "ok":
        path.unlink(missing_ok=True)
        raise RuntimeError(f"backup integrity check failed: {result}")
    return path


def apply_review_queue(
    conn: sqlite3.Connection,
    review_file: Path,
    *,
    write: bool = False,
    backup_dir: Path | None = None,
) -> dict[str, object]:
    if not write:
        updates = read_approved_updates(conn, review_file)
        return {
            "mode": "dry-run",
            "updates": [{"wine_id": wine_id, "fields": fields} for wine_id, fields in updates],
            "updated_count": len(updates),
        }

    conn.execute("BEGIN IMMEDIATE")
    try:
        # Validate identity only after holding the writer lock. No other process can
        # change a wine between this check, the backup, and the corresponding update.
        updates = read_approved_updates(conn, review_file)
        result: dict[str, object] = {
            "mode": "write",
            "updates": [{"wine_id": wine_id, "fields": fields} for wine_id, fields in updates],
            "updated_count": len(updates),
        }
        if not updates:
            conn.rollback()
            return result

        database_file = Path(
            next(
                row["file"] for row in conn.execute("PRAGMA database_list") if row["name"] == "main"
            )
        )
        # A separate read connection can copy the latest committed snapshot while
        # this connection's RESERVED lock prevents a new writer from overtaking us.
        backup = backup_database(database_file, backup_dir or database_file.parent / "backups")
        for wine_id, fields in updates:
            core.update_wine(conn, wine_id, commit=False, **fields)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    result["backup"] = str(backup)
    return result


def link_status(conn: sqlite3.Connection, *, include_out_of_stock: bool = False) -> dict[str, int]:
    where = "" if include_out_of_stock else "WHERE quantity > 0"
    rows = conn.execute(f"SELECT vivino_url, cellartracker_wine_id FROM wines {where}").fetchall()
    with_vivino = sum(bool((row["vivino_url"] or "").strip()) for row in rows)
    valid_cellartracker = [
        bool(core.safe_cellartracker_url(row["cellartracker_wine_id"])) for row in rows
    ]
    with_cellartracker = sum(valid_cellartracker)
    invalid_cellartracker = sum(
        bool(row["cellartracker_wine_id"]) and not valid
        for row, valid in zip(rows, valid_cellartracker, strict=True)
    )
    with_both = sum(
        bool((row["vivino_url"] or "").strip()) and valid
        for row, valid in zip(rows, valid_cellartracker, strict=True)
    )
    return {
        "wines": len(rows),
        "with_vivino": with_vivino,
        "with_cellartracker": with_cellartracker,
        "with_both": with_both,
        "invalid_cellartracker": invalid_cellartracker,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=None, help="Cellar SQLite path")
    subparsers = parser.add_subparsers(dest="command", required=True)

    export = subparsers.add_parser("export", help="Create the review CSV")
    export.add_argument("--output", required=True, type=Path)
    export.add_argument("--all", action="store_true", help="Include out-of-stock labels")

    apply = subparsers.add_parser("apply", help="Validate/apply approved CSV rows")
    apply.add_argument("--input", required=True, type=Path)
    apply.add_argument("--write", action="store_true", help="Write after validation")
    apply.add_argument("--backup-dir", type=Path, default=None)

    status = subparsers.add_parser("status", help="Report link coverage")
    status.add_argument("--all", action="store_true", help="Include out-of-stock labels")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    conn = db.open_db(args.db)
    try:
        if args.command == "export":
            count = export_review_queue(conn, args.output, include_out_of_stock=args.all)
            payload: object = {"exported": count, "output": str(args.output)}
        elif args.command == "apply":
            payload = apply_review_queue(
                conn,
                args.input,
                write=args.write,
                backup_dir=args.backup_dir,
            )
        else:
            payload = link_status(conn, include_out_of_stock=args.all)
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    except (ValueError, RuntimeError) as error:
        raise SystemExit(str(error)) from error
    finally:
        conn.close()


if __name__ == "__main__":
    main()
