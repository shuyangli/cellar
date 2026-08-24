import sqlite3
from pathlib import Path

import pytest

from cellar import core, db
from scripts import backfill_provider_metrics as metrics


@pytest.fixture(autouse=True)
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CELLAR_DATA_DIR", str(tmp_path))


@pytest.fixture()
def conn():
    connection = db.open_db()
    yield connection
    connection.close()


def add_linked_wine(conn, *, vintage: str = "2024"):
    wine = core.add_wine(
        conn,
        producer="Château Example",
        wine_name="Test Cuvée",
        vintage=vintage,
        vivino_url=f"https://www.vivino.com/en/example-test-cuvee/w/123?year={vintage}",
        cellartracker_url="https://www.cellartracker.com/wine.asp?iWine=456",
    )
    return core.log_purchase(conn, wine["id"], 1)


def review_payload(
    *,
    year: int = 2024,
    wine_id: int = 123,
    vintage_id: int = 500,
    status: str = "Normal",
    rating: float = 4.3,
):
    return {
        "reviews": [
            {
                "vintage": {
                    "id": vintage_id,
                    "year": year,
                    "name": f"Château Example Test Cuvée {year}",
                    "wine": {"id": wine_id},
                    "statistics": {"status": status, "ratings_average": rating},
                }
            }
        ]
    }


def price_payload(*, vintage_id: int = 500, year: int = 2024, amount: float = 42.5):
    return {
        "prices": {
            "market": {"country": "US", "currency": {"code": "USD"}},
            "vintages": {
                str(vintage_id): {
                    "vintage": {"id": vintage_id, "year": year},
                    "price": {"amount": amount},
                }
            },
        }
    }


def test_fetch_vivino_requires_exact_wine_and_vintage(conn, monkeypatch: pytest.MonkeyPatch):
    wine = add_linked_wine(conn)

    def fake_json(url: str, *, timeout: float):
        if "/reviews?" in url:
            return review_payload()
        assert "vintage_ids%5B%5D=500" in url
        assert "country_code=US" in url
        assert "currency_code=USD" in url
        return price_payload()

    monkeypatch.setattr(metrics, "_get_json", fake_json)
    fields, notes = metrics.fetch_vivino(
        conn.execute("SELECT * FROM wines WHERE id = ?", (wine["id"],)).fetchone(), timeout=1
    )
    assert notes == []
    assert fields == {
        "vivino_url": "https://www.vivino.com/en/example-test-cuvee/w/123?year=2024",
        "vivino_rating": 4.3,
        "vivino_price": 42.5,
        "vivino_price_currency": "USD",
    }


@pytest.mark.parametrize("key, value", [("year", 2023), ("wine_id", 999)])
def test_fetch_vivino_rejects_wrong_review_identity(
    conn, monkeypatch: pytest.MonkeyPatch, key: str, value: int
):
    wine = add_linked_wine(conn)
    kwargs = {key: value}
    monkeypatch.setattr(metrics, "_get_json", lambda url, *, timeout: review_payload(**kwargs))
    fields, notes = metrics.fetch_vivino(
        conn.execute("SELECT * FROM wines WHERE id = ?", (wine["id"],)).fetchone(), timeout=1
    )
    assert fields == {}
    assert notes and "skipped" in notes[0]


def test_fetch_vivino_rejects_silently_substituted_price_vintage(
    conn, monkeypatch: pytest.MonkeyPatch
):
    wine = add_linked_wine(conn)

    def fake_json(url: str, *, timeout: float):
        return review_payload() if "/reviews?" in url else price_payload(vintage_id=501, year=2023)

    monkeypatch.setattr(metrics, "_get_json", fake_json)
    fields, notes = metrics.fetch_vivino(
        conn.execute("SELECT * FROM wines WHERE id = ?", (wine["id"],)).fetchone(), timeout=1
    )
    assert fields == {
        "vivino_url": "https://www.vivino.com/en/example-test-cuvee/w/123?year=2024",
        "vivino_rating": 4.3,
    }
    assert notes == ["Vivino price unavailable: response did not confirm the exact vintage"]


def test_fetch_vivino_does_not_treat_below_threshold_zero_as_a_rating(
    conn, monkeypatch: pytest.MonkeyPatch
):
    wine = add_linked_wine(conn)

    def fake_json(url: str, *, timeout: float):
        return (
            review_payload(status="BelowThreshold", rating=0)
            if "/reviews?" in url
            else {"prices": {"market": {"currency": {"code": "USD"}}, "vintages": {}}}
        )

    monkeypatch.setattr(metrics, "_get_json", fake_json)
    fields, notes = metrics.fetch_vivino(
        conn.execute("SELECT * FROM wines WHERE id = ?", (wine["id"],)).fetchone(), timeout=1
    )
    assert fields == {}
    assert notes == ["Vivino price unavailable: response did not confirm the exact vintage"]


def test_fetch_cellartracker_fails_closed_on_waf(conn, monkeypatch: pytest.MonkeyPatch):
    wine = add_linked_wine(conn)
    monkeypatch.setattr(
        metrics, "_get_text", lambda url, *, timeout: "window.awsWafCookieDomainList = []"
    )
    fields, notes = metrics.fetch_cellartracker(
        conn.execute("SELECT * FROM wines WHERE id = ?", (wine["id"],)).fetchone(), timeout=1
    )
    assert fields == {}
    assert notes == ["CellarTracker unavailable: WAF challenge"]


def test_fetch_cellartracker_intentionally_records_only_rating(
    conn, monkeypatch: pytest.MonkeyPatch
):
    wine = add_linked_wine(conn)
    monkeypatch.setattr(
        metrics,
        "_get_text",
        lambda url, *, timeout: (
            "Average of 91.2 points in 50 community wine reviews. "
            "Community Average Value: USD 42.00"
        ),
    )
    fields, notes = metrics.fetch_cellartracker(
        conn.execute("SELECT * FROM wines WHERE id = ?", (wine["id"],)).fetchone(), timeout=1
    )
    assert fields == {"cellartracker_rating": 91.2}
    assert notes == []


def test_enrich_dry_run_then_write_with_backup(
    conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    wine = add_linked_wine(conn)
    monkeypatch.setattr(
        metrics,
        "fetch_vivino",
        lambda row, *, timeout: (
            {
                "vivino_url": "https://www.vivino.com/en/example-test-cuvee/w/123?year=2024",
                "vivino_rating": 4.3,
                "vivino_price": 42.5,
                "vivino_price_currency": "USD",
            },
            [],
        ),
    )
    monkeypatch.setattr(
        metrics, "fetch_cellartracker", lambda row, *, timeout: ({"cellartracker_rating": 91.2}, [])
    )

    dry = metrics.enrich(conn, delay=0)
    assert dry["mode"] == "dry-run"
    assert dry["updated_count"] == 1
    assert core.get_wine(conn, wine["id"])["vivino_rating"] is None

    written = metrics.enrich(conn, write=True, delay=0, backup_dir=tmp_path / "backups")
    assert written["mode"] == "write"
    assert Path(written["backup"]).exists()
    updated = core.get_wine(conn, wine["id"])
    assert updated["vivino_rating"] == 4.3
    assert updated["vivino_price"] == 42.5
    assert updated["vivino_price_currency"] == "USD"
    assert updated["cellartracker_rating"] == 91.2


def test_apply_refuses_identity_change_after_network_plan(conn, monkeypatch: pytest.MonkeyPatch):
    wine = add_linked_wine(conn)
    monkeypatch.setattr(
        metrics,
        "fetch_vivino",
        lambda row, *, timeout: ({"vivino_rating": 4.3}, []),
    )
    monkeypatch.setattr(metrics, "fetch_cellartracker", lambda row, *, timeout: ({}, []))
    updates, _ = metrics.collect_updates(conn, delay=0)
    core.update_wine(conn, wine["id"], producer="Changed")
    with pytest.raises(ValueError, match="identity changed"):
        metrics.apply_updates(conn, updates, write=True)
    assert core.get_wine(conn, wine["id"])["vivino_rating"] is None


def test_apply_refuses_provider_link_change_after_network_plan(
    conn, monkeypatch: pytest.MonkeyPatch
):
    wine = add_linked_wine(conn)
    monkeypatch.setattr(metrics, "fetch_vivino", lambda row, *, timeout: ({}, []))
    monkeypatch.setattr(
        metrics,
        "fetch_cellartracker",
        lambda row, *, timeout: ({"cellartracker_rating": 91.2}, []),
    )
    updates, _ = metrics.collect_updates(conn, delay=0)
    core.update_wine(
        conn,
        wine["id"],
        cellartracker_url="https://www.cellartracker.com/wine.asp?iWine=999",
    )
    with pytest.raises(ValueError, match="provider link changed"):
        metrics.apply_updates(conn, updates, write=True)
    assert core.get_wine(conn, wine["id"])["cellartracker_rating"] is None


def test_backup_is_a_valid_sqlite_copy(conn, tmp_path: Path):
    wine = add_linked_wine(conn)
    database = Path(
        next(row["file"] for row in conn.execute("PRAGMA database_list") if row["name"] == "main")
    )
    backup = metrics.backup_database(database, tmp_path)
    copy = sqlite3.connect(backup)
    try:
        assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert (
            copy.execute("SELECT id FROM wines WHERE id = ?", (wine["id"],)).fetchone()[0]
            == wine["id"]
        )
    finally:
        copy.close()
