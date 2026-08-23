import asyncio
import csv
import inspect
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cellar import core, db, mcp_server
from cellar.web import app
from scripts import backfill_wine_links


@pytest.fixture(autouse=True)
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("CELLAR_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture()
def conn():
    connection = db.open_db()
    yield connection
    connection.close()


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


def add_wine(conn, *, quantity: int = 1):
    wine = core.add_wine(
        conn,
        producer="Château d'Esclans",
        wine_name="Whispering Angel Rosé",
        vintage="2024",
        country="France",
    )
    if quantity:
        wine = core.log_purchase(conn, wine["id"], quantity)
    return wine


def rewrite_csv(path: Path, mutate) -> None:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
        fieldnames = list(rows[0])
    mutate(rows)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def test_v7_migration_and_external_source_round_trip(conn):
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION == 7
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(wines)")}
    assert {
        "vivino_url",
        "vivino_rating",
        "vivino_price",
        "vivino_price_currency",
        "cellartracker_rating",
        "cellartracker_price",
        "cellartracker_price_currency",
    } <= columns

    wine = core.add_wine(
        conn,
        producer="Example",
        wine_name="Exact Wine",
        vivino_url="https://vivino.com/US/en/example-exact-wine/w/12345?year=2024",
        vivino_rating=4.2,
        vivino_price=42.99,
        vivino_price_currency="usd",
        cellartracker_url="https://cellartracker.com/wine.asp?iWine=006789&foo=bar",
        cellartracker_rating=91.4,
        cellartracker_price=38,
        cellartracker_price_currency="USD",
    )
    assert wine["vivino_url"] == (
        "https://www.vivino.com/US/en/example-exact-wine/w/12345?year=2024"
    )
    assert wine["cellartracker_wine_id"] == "6789"
    assert wine["cellartracker_url"] == ("https://www.cellartracker.com/wine.asp?iWine=6789")
    assert wine["vivino_rating"] == 4.2
    assert wine["vivino_price"] == 42.99
    assert wine["vivino_price_currency"] == "USD"
    assert wine["cellartracker_rating"] == 91.4
    assert wine["cellartracker_price"] == 38
    assert wine["cellartracker_price_currency"] == "USD"


def test_v7_migrates_an_existing_v6_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    path = tmp_path / "v6.db"
    with monkeypatch.context() as legacy:
        legacy.setattr(db, "_MIGRATIONS", db._MIGRATIONS[:6])
        legacy.setattr(db, "SCHEMA_VERSION", 6)
        connection = db.open_db(path)
        legacy_wine = core.add_wine(connection, producer="Legacy", wine_name="Preserved")
        legacy_id = legacy_wine["id"]
        connection.close()

    migrated = db.open_db(path)
    try:
        assert migrated.execute("PRAGMA user_version").fetchone()[0] == 7
        wine = core.get_wine(migrated, legacy_id)
        assert wine["wine_name"] == "Preserved"
        assert wine["vivino_rating"] is None
        assert wine["cellartracker_price"] is None
    finally:
        migrated.close()

    with monkeypatch.context() as legacy:
        legacy.setattr(db, "_MIGRATIONS", db._MIGRATIONS[:6])
        legacy.setattr(db, "SCHEMA_VERSION", 6)
        with pytest.raises(RuntimeError, match="requires code at schema version 7"):
            db.open_db(path)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("vivino_rating", 4.2),
        ("cellartracker_rating", 90),
        ("vivino_price", float("inf")),
        ("cellartracker_price", float("inf")),
        ("vivino_price_currency", "usd"),
        ("cellartracker_price_currency", "USDX"),
    ],
)
def test_v7_database_constraints_reject_invalid_provider_snapshots(conn, field, value):
    wine = core.add_wine(conn, producer="Constraint", wine_name="Protected")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(f"UPDATE wines SET {field} = ? WHERE id = ?", (value, wine["id"]))


@pytest.mark.parametrize(
    "columns",
    [
        {"vivino_url": "https://www.vivino.com/en/direct/w/1", "vivino_price": 10},
        {
            "vivino_url": "https://www.vivino.com/en/direct/w/1",
            "vivino_price_currency": "USD",
        },
        {"vivino_price": 10, "vivino_price_currency": "USD"},
    ],
)
def test_v7_database_constraints_enforce_price_currency_and_link_pairing(conn, columns):
    names = ", ".join(["producer", "wine_name", *columns])
    placeholders = ", ".join("?" for _ in range(len(columns) + 2))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            f"INSERT INTO wines ({names}) VALUES ({placeholders})",
            ("Constraint", "Pairing", *columns.values()),
        )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("vivino_rating", 5.1, "vivino_rating must be between 0 and 5"),
        ("vivino_rating", "4.2", "vivino_rating must be a number"),
        ("cellartracker_rating", 100.1, "cellartracker_rating must be between 0 and 100"),
        ("vivino_price", -0.01, "vivino_price must be nonnegative"),
        ("vivino_price", 1_000_000_001, "vivino_price must be at most 1e\\+09"),
        ("cellartracker_price", float("nan"), "cellartracker_price must be finite"),
        ("vivino_price_currency", "dollars", "3-letter currency"),
    ],
)
def test_external_source_metrics_are_validated(conn, field, value, message):
    with pytest.raises(ValueError, match=message):
        core.add_wine(conn, producer="Example", wine_name="Metrics", **{field: value})


@pytest.mark.parametrize(
    ("field", "value", "provider"),
    [
        ("vivino_rating", 4.2, "vivino_url"),
        ("cellartracker_price", 40, "cellartracker_url"),
    ],
)
def test_external_source_metrics_require_an_exact_provider_link(conn, field, value, provider):
    with pytest.raises(ValueError, match=f"requires {provider}"):
        core.add_wine(conn, producer="Example", wine_name="No provenance", **{field: value})


def test_price_requires_explicit_currency_and_currency_requires_price(conn):
    with pytest.raises(ValueError, match="vivino_price requires vivino_price_currency"):
        core.add_wine(
            conn,
            producer="Example",
            wine_name="Currency required",
            vivino_url="https://www.vivino.com/en/currency-required/w/123",
            vivino_price=25,
        )
    with pytest.raises(ValueError, match="cellartracker_price_currency requires"):
        core.add_wine(
            conn,
            producer="Example",
            wine_name="Orphan currency",
            cellartracker_url="https://www.cellartracker.com/wine.asp?iWine=125",
            cellartracker_price_currency="EUR",
        )
    link_only = core.add_wine(
        conn,
        producer="Example",
        wine_name="Currency without price",
        vivino_url="https://www.vivino.com/en/currency-without-price/w/125",
    )
    with pytest.raises(ValueError, match="requires vivino_price"):
        core.update_wine(conn, link_only["id"], vivino_price_currency="EUR")


def test_price_update_preserves_currency_and_clearing_price_clears_it(conn):
    wine = core.add_wine(
        conn,
        producer="Example",
        wine_name="Price update",
        vivino_url="https://www.vivino.com/en/price-update/w/124",
        vivino_price=25,
        vivino_price_currency="EUR",
    )
    updated = core.update_wine(conn, wine["id"], vivino_price=30)
    assert updated["vivino_price"] == 30
    assert updated["vivino_price_currency"] == "EUR"
    cleared = core.update_wine(conn, wine["id"], vivino_price="")
    assert cleared["vivino_price"] is None
    assert cleared["vivino_price_currency"] is None


def test_changing_provider_link_clears_stale_metrics_unless_replaced(conn):
    wine = core.add_wine(
        conn,
        producer="Example",
        wine_name="Relink",
        vivino_url="https://www.vivino.com/en/original/w/126",
        vivino_rating=4.2,
        vivino_price=25,
        vivino_price_currency="EUR",
    )
    relinked = core.update_wine(
        conn,
        wine["id"],
        vivino_url="https://www.vivino.com/en/replacement/w/127",
    )
    assert relinked["vivino_rating"] is None
    assert relinked["vivino_price"] is None
    assert relinked["vivino_price_currency"] is None

    with pytest.raises(ValueError, match="vivino_price requires vivino_price_currency"):
        core.update_wine(
            conn,
            wine["id"],
            producer="Renamed Example",
            vivino_url="https://www.vivino.com/en/newest/w/128",
            vivino_price=30,
        )

    refreshed = core.update_wine(
        conn,
        wine["id"],
        vivino_url="https://www.vivino.com/en/newest/w/128",
        vivino_rating=4.3,
        vivino_price=30,
        vivino_price_currency="GBP",
    )
    assert refreshed["vivino_rating"] == 4.3
    assert refreshed["vivino_price"] == 30
    assert refreshed["vivino_price_currency"] == "GBP"


def test_vintage_metrics_require_matching_vivino_year_and_identity_edits_clear_sources(conn):
    for url in (
        "https://www.vivino.com/en/vintage-provenance/w/129",
        "https://www.vivino.com/en/vintage-provenance/w/129?year=2023",
    ):
        with pytest.raises(ValueError, match="year selector matching"):
            core.add_wine(
                conn,
                producer="Example",
                wine_name="Link-only vintage provenance",
                vintage="2024",
                vivino_url=url,
            )
    with pytest.raises(ValueError, match="year selector matching"):
        core.add_wine(
            conn,
            producer="Example",
            wine_name="Vintage provenance",
            vintage="2024",
            vivino_url="https://www.vivino.com/en/vintage-provenance/w/129?year=2023",
            vivino_rating=4.1,
        )
    wine = core.add_wine(
        conn,
        producer="Example",
        wine_name="Vintage provenance",
        vintage="2024",
        vivino_url="https://www.vivino.com/en/vintage-provenance/w/129?year=2024",
        vivino_rating=4.1,
        cellartracker_url="https://www.cellartracker.com/wine.asp?iWine=130",
        cellartracker_rating=90,
    )
    with pytest.raises(ValueError, match="year selector matching"):
        core.update_wine(
            conn,
            wine["id"],
            vivino_url="https://www.vivino.com/en/vintage-provenance/w/129?year=2023",
        )
    changed = core.update_wine(conn, wine["id"], vintage="2023")
    assert changed["vivino_url"] is None
    assert changed["vivino_rating"] is None
    assert changed["cellartracker_url"] is None
    assert changed["cellartracker_rating"] is None


def test_external_link_validation_rejects_search_and_wrong_provider(conn):
    with pytest.raises(ValueError, match="exact wine page"):
        core.add_wine(
            conn,
            producer="Example",
            wine_name="Search Result",
            vivino_url="https://www.vivino.com/search/wines?q=example",
        )
    wine = core.add_wine(conn, producer="Example", wine_name="Wrong CT")
    with pytest.raises(ValueError, match="CellarTracker"):
        core.update_wine(
            conn,
            wine["id"],
            cellartracker_url="https://example.com/wine.asp?iWine=1",
        )
    for ambiguous in (
        "https://www.cellartracker.com/wine.asp?iWine=1&iWine=2",
        "https://www.cellartracker.com/wine.asp?iWine=1&iWine=",
        "https://www.cellartracker.com/wine.asp?iWine=1&IWine=2",
    ):
        with pytest.raises(ValueError, match="exactly one"):
            core.update_wine(conn, wine["id"], cellartracker_url=ambiguous)
    for ambiguous_vivino in (
        "https://www.vivino.com/en/test/w/1?year=2023&year=2024",
        "https://www.vivino.com/en/test/w/1?Year=2024",
        "https://www.vivino.com/en/test/w/1?year=",
    ):
        with pytest.raises(ValueError, match="year"):
            core.update_wine(conn, wine["id"], vivino_url=ambiguous_vivino)


def test_mcp_add_wine_schema_exposes_external_links_ratings_and_prices():
    tools = asyncio.run(mcp_server.mcp.list_tools())
    schema = next(tool.inputSchema for tool in tools if tool.name == "add_wine")
    assert {
        "vivino_url",
        "vivino_rating",
        "vivino_price",
        "vivino_price_currency",
        "cellartracker_url",
        "cellartracker_rating",
        "cellartracker_price",
        "cellartracker_price_currency",
    } <= set(schema["properties"])
    vivino_number = schema["properties"]["vivino_rating"]["anyOf"][0]
    cellartracker_number = schema["properties"]["cellartracker_rating"]["anyOf"][0]
    assert (vivino_number["minimum"], vivino_number["maximum"]) == (0, 5)
    assert (cellartracker_number["minimum"], cellartracker_number["maximum"]) == (0, 100)


def test_mcp_update_rejects_numeric_strings_inside_fields(conn):
    wine = core.add_wine(
        conn,
        producer="Strict MCP",
        wine_name="Update",
        vivino_url="https://www.vivino.com/en/strict-mcp/w/131",
    )
    with pytest.raises(ValueError, match="vivino_rating must be a number"):
        inspect.unwrap(mcp_server.update_wine)(conn, wine["id"], {"vivino_rating": "4.2"})


def test_review_queue_export_defaults_to_current_inventory(conn, tmp_path: Path):
    in_stock = add_wine(conn)
    core.add_wine(conn, producer="Empty", wine_name="Out of Stock")
    output = tmp_path / "review.csv"

    assert backfill_wine_links.export_review_queue(conn, output) == 1
    with output.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert rows[0]["id"] == str(in_stock["id"])
    assert "vivino.com/search/wines" in rows[0]["vivino_search_url"]
    assert "cellartracker.com/list.asp" in rows[0]["cellartracker_search_url"]
    assert len(rows[0]["identity_sha256"]) == 64


def test_review_queue_escapes_spreadsheet_formulas_without_changing_identity(conn, tmp_path: Path):
    wine = core.add_wine(conn, producer='=HYPERLINK("bad")', wine_name="Safe")
    core.log_purchase(conn, wine["id"], 1)
    review = tmp_path / "review.csv"
    backfill_wine_links.export_review_queue(conn, review)
    with review.open(newline="", encoding="utf-8") as handle:
        row = next(csv.DictReader(handle))
    assert row["producer"].startswith("'=")
    assert row["identity_sha256"] == backfill_wine_links.identity_sha256(
        conn.execute("SELECT * FROM wines WHERE id = ?", (wine["id"],)).fetchone()
    )


def test_review_queue_dry_run_then_write_with_verified_backup(conn, tmp_path: Path):
    wine = add_wine(conn)
    review = tmp_path / "review.csv"
    backfill_wine_links.export_review_queue(conn, review)

    def approve(rows):
        rows[0]["vivino_url"] = (
            "https://www.vivino.com/US/en/synthetic-test-wine/w/99991?year=2024"
        )
        rows[0]["cellartracker_url"] = "https://www.cellartracker.com/wine.asp?iWine=99992"
        rows[0]["review_status"] = "approved"

    rewrite_csv(review, approve)
    dry_run = backfill_wine_links.apply_review_queue(conn, review)
    assert dry_run["mode"] == "dry-run"
    assert dry_run["updated_count"] == 1
    assert core.get_wine(conn, wine["id"])["vivino_url"] is None

    result = backfill_wine_links.apply_review_queue(
        conn, review, write=True, backup_dir=tmp_path / "backups"
    )
    assert result["updated_count"] == 1
    assert Path(str(result["backup"])).exists()
    updated = core.get_wine(conn, wine["id"])
    assert updated["vivino_url"].endswith("/w/99991?year=2024")
    assert updated["cellartracker_wine_id"] == "99992"
    assert backfill_wine_links.link_status(conn)["with_both"] == 1


def test_review_queue_refuses_stale_identity(conn, tmp_path: Path):
    wine = add_wine(conn)
    review = tmp_path / "review.csv"
    backfill_wine_links.export_review_queue(conn, review)

    def approve(rows):
        rows[0]["vivino_url"] = "https://www.vivino.com/US/en/example/w/123"
        rows[0]["review_status"] = "approved"

    rewrite_csv(review, approve)
    core.update_wine(conn, wine["id"], producer="Changed after export")
    with pytest.raises(ValueError, match="re-export"):
        backfill_wine_links.apply_review_queue(conn, review, write=True)


def test_malformed_legacy_cellartracker_id_is_reported_without_breaking_reads(conn, tmp_path: Path):
    wine = add_wine(conn)
    conn.execute(
        "UPDATE wines SET cellartracker_wine_id = 'legacy-bad-value' WHERE id = ?",
        (wine["id"],),
    )
    conn.commit()
    assert core.get_wine(conn, wine["id"])["cellartracker_url"] is None
    assert core.list_inventory(conn)["items"][0]["cellartracker_url"] is None

    review = tmp_path / "review.csv"
    backfill_wine_links.export_review_queue(conn, review)
    with review.open(newline="", encoding="utf-8") as handle:
        row = next(csv.DictReader(handle))
    assert row["cellartracker_url"] == ""
    assert "Invalid stored" in row["review_notes"]
    assert backfill_wine_links.link_status(conn)["invalid_cellartracker"] == 1

    def repair(rows):
        rows[0]["cellartracker_url"] = "https://www.cellartracker.com/wine.asp?iWine=12345"
        rows[0]["review_status"] = "approved"

    rewrite_csv(review, repair)
    dry_run = backfill_wine_links.apply_review_queue(conn, review)
    assert dry_run["updated_count"] == 1
    backfill_wine_links.apply_review_queue(
        conn, review, write=True, backup_dir=tmp_path / "backups"
    )
    assert core.get_wine(conn, wine["id"])["cellartracker_wine_id"] == "12345"
    assert backfill_wine_links.link_status(conn)["invalid_cellartracker"] == 0


def test_web_create_accepts_external_source_metrics(client):
    response = client.post(
        "/api/cellar/items",
        json={
            "producer": "API Producer",
            "wine_name": "API Wine",
            "quantity": 0,
            "cellartracker_url": "https://www.cellartracker.com/wine.asp?iWine=12345",
            "cellartracker_rating": 89.7,
            "cellartracker_price": 36.5,
            "cellartracker_price_currency": "usd",
            "vivino_url": "https://www.vivino.com/en/api-wine/w/67890",
            "vivino_rating": 4.1,
            "vivino_price": 39.99,
            "vivino_price_currency": "USD",
        },
    )
    assert response.status_code == 201
    assert response.json()["cellartracker_wine_id"] == "12345"
    assert response.json()["cellartracker_url"].endswith("iWine=12345")
    assert response.json()["cellartracker_rating"] == 89.7
    assert response.json()["cellartracker_price"] == 36.5
    assert response.json()["cellartracker_price_currency"] == "USD"
    assert response.json()["vivino_rating"] == 4.1
    assert response.json()["vivino_price"] == 39.99


@pytest.mark.parametrize("value", [True, "4.2"])
def test_web_provider_numbers_reject_type_coercion(client, value):
    response = client.post(
        "/api/cellar/items",
        json={
            "producer": "Strict API",
            "wine_name": "Numbers",
            "quantity": 0,
            "vivino_url": "https://www.vivino.com/en/strict-api/w/67891",
            "vivino_rating": value,
        },
    )
    assert response.status_code == 422


def test_web_provider_price_requires_currency_and_can_be_cleared(client):
    missing_currency = client.post(
        "/api/cellar/items",
        json={
            "producer": "API Currency",
            "wine_name": "Required",
            "quantity": 0,
            "vivino_url": "https://www.vivino.com/en/api-currency/w/67892",
            "vivino_price": 39.99,
        },
    )
    assert missing_currency.status_code == 400

    created = client.post(
        "/api/cellar/items",
        json={
            "producer": "API Currency",
            "wine_name": "Clearable",
            "quantity": 0,
            "vivino_url": "https://www.vivino.com/en/api-clearable/w/67893",
            "vivino_rating": 4.1,
            "vivino_price": 39.99,
            "vivino_price_currency": "EUR",
        },
    )
    assert created.status_code == 201
    cleared = client.patch(
        f"/api/wines/{created.json()['id']}",
        json={"vivino_rating": None, "vivino_price": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["vivino_rating"] is None
    assert cleared.json()["vivino_price"] is None
    assert cleared.json()["vivino_price_currency"] is None


def test_web_provider_price_limit_is_a_validation_error(client):
    response = client.post(
        "/api/cellar/items",
        json={
            "producer": "API Limit",
            "wine_name": "Protected",
            "quantity": 0,
            "vivino_url": "https://www.vivino.com/en/api-limit/w/67894",
            "vivino_price": 1_000_000_001,
            "vivino_price_currency": "USD",
        },
    )
    assert response.status_code == 422


def test_link_fields_can_be_cleared(conn):
    wine = core.add_wine(
        conn,
        producer="Clear",
        wine_name="Links",
        cellartracker_url="https://www.cellartracker.com/wine.asp?iWine=123",
        cellartracker_rating=90,
        cellartracker_price=40,
        cellartracker_price_currency="USD",
        vivino_url="https://www.vivino.com/en/clear-links/w/456",
        vivino_rating=4.1,
        vivino_price=35,
        vivino_price_currency="USD",
    )
    cleared = core.update_wine(conn, wine["id"], cellartracker_url="", vivino_url="")
    assert cleared["cellartracker_wine_id"] is None
    assert cleared["cellartracker_url"] is None
    assert cleared["vivino_url"] is None
    assert cleared["cellartracker_rating"] is None
    assert cleared["cellartracker_price"] is None
    assert cleared["cellartracker_price_currency"] is None
    assert cleared["vivino_rating"] is None
    assert cleared["vivino_price"] is None
    assert cleared["vivino_price_currency"] is None


def test_backfill_rolls_back_the_batch_when_an_update_fails(
    conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    first = add_wine(conn)
    second = core.add_wine(conn, producer="Second", wine_name="Wine")
    core.log_purchase(conn, second["id"], 1)
    review = tmp_path / "review.csv"
    backfill_wine_links.export_review_queue(conn, review)

    def approve(rows):
        for index, row in enumerate(rows, start=1):
            row["vivino_url"] = (
                f"https://www.vivino.com/en/test/w/{90000 + index}?year=2024"
            )
            row["review_status"] = "approved"

    rewrite_csv(review, approve)
    original = core.update_wine
    calls = 0

    def fail_second(connection, wine_id, *, commit=True, **fields):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("simulated update failure")
        return original(connection, wine_id, commit=commit, **fields)

    monkeypatch.setattr(core, "update_wine", fail_second)
    with pytest.raises(RuntimeError, match="simulated"):
        backfill_wine_links.apply_review_queue(
            conn, review, write=True, backup_dir=tmp_path / "backups"
        )
    assert original(conn, first["id"], notes="still usable")["vivino_url"] is None
    assert core.get_wine(conn, second["id"])["vivino_url"] is None
