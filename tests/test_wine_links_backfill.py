import asyncio
import csv
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


def test_v6_migration_and_external_link_round_trip(conn):
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION == 6
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(wines)")}
    assert "vivino_url" in columns

    wine = core.add_wine(
        conn,
        producer="Example",
        wine_name="Exact Wine",
        vivino_url="https://vivino.com/US/en/example-exact-wine/w/12345?year=2024",
        cellartracker_url="https://cellartracker.com/wine.asp?iWine=006789&foo=bar",
    )
    assert wine["vivino_url"] == "https://www.vivino.com/US/en/example-exact-wine/w/12345"
    assert wine["cellartracker_wine_id"] == "6789"
    assert wine["cellartracker_url"] == ("https://www.cellartracker.com/wine.asp?iWine=6789")


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


def test_mcp_add_wine_schema_exposes_both_external_links():
    tools = asyncio.run(mcp_server.mcp.list_tools())
    schema = next(tool.inputSchema for tool in tools if tool.name == "add_wine")
    assert {"vivino_url", "cellartracker_url"} <= set(schema["properties"])


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
        rows[0]["vivino_url"] = "https://www.vivino.com/US/en/synthetic-test-wine/w/99991"
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
    assert updated["vivino_url"].endswith("/w/99991")
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


def test_web_create_accepts_cellartracker_url(client):
    response = client.post(
        "/api/cellar/items",
        json={
            "producer": "API Producer",
            "wine_name": "API Wine",
            "quantity": 0,
            "cellartracker_url": "https://www.cellartracker.com/wine.asp?iWine=12345",
            "vivino_url": "https://www.vivino.com/en/api-wine/w/67890",
        },
    )
    assert response.status_code == 201
    assert response.json()["cellartracker_wine_id"] == "12345"
    assert response.json()["cellartracker_url"].endswith("iWine=12345")


def test_link_fields_can_be_cleared(conn):
    wine = core.add_wine(
        conn,
        producer="Clear",
        wine_name="Links",
        cellartracker_url="https://www.cellartracker.com/wine.asp?iWine=123",
        vivino_url="https://www.vivino.com/en/clear-links/w/456",
    )
    cleared = core.update_wine(conn, wine["id"], cellartracker_url="", vivino_url="")
    assert cleared["cellartracker_wine_id"] is None
    assert cleared["cellartracker_url"] is None
    assert cleared["vivino_url"] is None


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
            row["vivino_url"] = f"https://www.vivino.com/en/test/w/{90000 + index}"
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
