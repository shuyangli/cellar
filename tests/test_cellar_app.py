import asyncio
import sqlite3
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mcp.server.fastmcp.exceptions import ToolError

from cellar import config, core, db, mcp_server
from cellar.web import app, cache_control_value


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


def test_dynamic_responses_disable_browser_caching(client):
    assert client.get("/health").headers["cache-control"] == "no-store"
    assert client.get("/api/cellar").headers["cache-control"] == "no-store"


def test_cache_policy_keeps_hashed_assets_immutable():
    assert (
        cache_control_value("/assets/index-AbCd1234.js", "text/javascript")
        == "public, max-age=31536000, immutable"
    )


def test_cache_policy_never_caches_the_app_shell():
    assert cache_control_value("/", "text/html; charset=utf-8") == "no-store"
    assert cache_control_value("/missing-route", "text/html; charset=utf-8") == "no-store"


def add_sample_wine(conn, **overrides):
    fields = {
        "producer": "Pierre Peters",
        "wine_name": "Cuvée de Réserve",
        "vintage": "NV",
        "country": "France",
        "region": "Champagne",
        "appellation": "Le Mesnil-sur-Oger",
        "varietal": "Chardonnay",
        "wine_type": "sparkling",
    }
    fields.update(overrides)
    return core.add_wine(conn, **fields)


# ---------------------------------------------------------------------------
# Migrations


def build_old_database(path: Path) -> None:
    """Create a database exactly as the old single-file app would have."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE wines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            producer TEXT NOT NULL,
            wine_name TEXT NOT NULL,
            vintage TEXT, country TEXT, region TEXT, appellation TEXT,
            varietal TEXT, source_app TEXT, cellartracker_wine_id TEXT,
            photo_ref TEXT, notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            quantity INTEGER NOT NULL DEFAULT 0,
            bottle_size_ml INTEGER, location TEXT, acquired_from TEXT,
            acquired_price REAL, drinking_window_start TEXT,
            drinking_window_end TEXT, last_event_reason TEXT
        );
        CREATE TABLE tastings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wine_id INTEGER, context_type TEXT NOT NULL, venue TEXT,
            price_paid REAL, rating INTEGER,
            liked INTEGER NOT NULL DEFAULT 0,
            buy_again INTEGER NOT NULL DEFAULT 0,
            tasting_notes TEXT, food_pairing TEXT, tasted_on TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (wine_id) REFERENCES wines(id)
        );
        CREATE TABLE wishlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wine_id INTEGER, shop_name TEXT, listed_price REAL,
            match_confidence TEXT, reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (wine_id) REFERENCES wines(id)
        );
        INSERT INTO wines (producer, wine_name, vintage, quantity, acquired_from, acquired_price)
        VALUES ('Produttori del Barbaresco', 'Barbaresco', '2019', 6, 'K&L', 42.0);
        INSERT INTO wines (producer, wine_name, vintage, quantity)
        VALUES ('Drunk Up', 'Empty Wine', '2015', 0);
        INSERT INTO tastings (wine_id, context_type, rating, tasting_notes)
        VALUES (1, 'home', 92, 'classic nebbiolo');
        """
    )
    conn.commit()
    conn.close()


def test_migrates_old_database_in_place(data_dir: Path):
    build_old_database(config.db_path())
    conn = db.open_db()
    try:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION

        # Existing stock got synthesized purchase + event history.
        wine = core.get_wine(conn, 1)
        assert wine["quantity"] == 6
        assert len(wine["purchases"]) == 1
        assert wine["purchases"][0]["vendor"] == "K&L"
        assert wine["purchases"][0]["price_per_bottle"] == 42.0
        assert sum(event["delta"] for event in wine["events"]) == 6

        # Zero-quantity wines get no synthetic history.
        empty = core.get_wine(conn, 2)
        assert empty["purchases"] == []
        assert empty["events"] == []

        # Old tastings survive; default user exists.
        assert wine["tastings"][0]["rating"] == 92
        assert core.default_user_id(conn) > 0
    finally:
        conn.close()


def test_migration_is_idempotent(data_dir: Path):
    build_old_database(config.db_path())
    for _ in range(2):
        conn = db.open_db()
        conn.close()
    conn = db.open_db()
    try:
        assert len(core.get_wine(conn, 1)["purchases"]) == 1
    finally:
        conn.close()


def test_full_history_handles_null_timestamps_in_migrated_legacy_database(
    data_dir: Path,
):
    build_old_database(config.db_path())
    legacy = sqlite3.connect(config.db_path())
    legacy.execute("UPDATE wines SET created_at = NULL, updated_at = NULL WHERE id = 1")
    legacy.execute("UPDATE tastings SET tasted_on = NULL, created_at = NULL WHERE id = 1")
    legacy.commit()
    legacy.close()

    conn = db.open_db()
    try:
        modern = add_sample_wine(conn, producer="Modern", wine_name="Timestamp")
        core.log_purchase(conn, modern["id"], 1)

        history = core.full_history(conn)
        assert len(history) == 3
        assert all(entry["sort_at"] is not None for entry in history)
        assert history == core.full_history(conn)
        migrated = next(
            entry
            for entry in history
            if entry["event"] and entry["event"]["event_type"] == "migration"
        )
        assert migrated["event"]["occurred_at"] == "1970-01-01 00:00:00"
    finally:
        conn.close()


def test_records_the_compatibility_floor_on_migrate(data_dir: Path):
    conn = db.open_db()
    try:
        assert db._read_min_compatible(conn) == db._required_min_compatible()
    finally:
        conn.close()


def test_backfills_the_floor_into_a_database_migrated_before_tracking(data_dir: Path):
    conn = db.open_db()
    conn.execute("DROP TABLE schema_meta")
    conn.commit()
    conn.close()

    conn = db.open_db()
    try:
        assert db._read_min_compatible(conn) == db._required_min_compatible()
    finally:
        conn.close()


def test_opens_a_newer_database_when_its_migrations_stayed_additive(data_dir: Path):
    """The bug this guards: an additive migration must not strand older code.

    A branch carrying a new column upgraded the live database, and every branch
    without that migration then refused to start.
    """
    conn = db.open_db()
    # Stand in for a future additive migration run by newer code.
    conn.execute("ALTER TABLE wines ADD COLUMN future_column TEXT")
    conn.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION + 1}")
    db._write_min_compatible(conn, db.SCHEMA_VERSION)
    conn.commit()
    conn.close()

    conn = db.open_db()
    try:
        assert core.list_inventory(conn)["pagination"]["total_items"] == 0
        # The newer schema is left exactly as found.
        assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION + 1
    finally:
        conn.close()


def test_refuses_a_newer_database_whose_migration_broke_compatibility(data_dir: Path):
    conn = db.open_db()
    conn.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION + 1}")
    # A destructive migration raises the floor above what this code provides.
    db._write_min_compatible(conn, db.SCHEMA_VERSION + 1)
    conn.commit()
    conn.close()

    with pytest.raises(RuntimeError, match="requires code at schema version"):
        db.open_db()


def test_adopts_a_newer_database_that_predates_tracking(data_dir: Path):
    """Every migration shipped before tracking was additive, so this is readable."""
    conn = db.open_db()
    conn.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION + 1}")
    conn.execute("DROP TABLE schema_meta")
    conn.commit()
    conn.close()

    conn = db.open_db()
    try:
        assert core.list_inventory(conn)["pagination"]["total_items"] == 0
    finally:
        conn.close()


def test_does_not_rewrite_the_floor_on_every_open(data_dir: Path):
    """open_db runs per request; the marker must not be a write on the hot path."""
    db.open_db().close()

    conn = db.connect()
    writes = []
    conn.set_trace_callback(lambda statement: writes.append(statement))
    db.migrate(conn)
    conn.close()

    assert not [w for w in writes if "INSERT INTO schema_meta" in w]


# ---------------------------------------------------------------------------
# Core flows


def test_purchase_event_quantity_consistency(conn):
    wine = add_sample_wine(conn)
    wine = core.log_purchase(conn, wine["id"], 3, price_per_bottle=74.0, vendor="Chambers Street")
    assert wine["quantity"] == 3
    wine = core.log_purchase(conn, wine["id"], 2, price_per_bottle=80.0)
    assert wine["quantity"] == 5
    assert len(wine["purchases"]) == 2
    assert sum(event["delta"] for event in wine["events"]) == wine["quantity"]
    # Latest-purchase cache feeds the inventory UI.
    assert wine["acquired_price"] == 80.0
    assert wine["acquired_from"] == "Chambers Street"


def test_tasting_decrements_inventory_and_links_event(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 2)
    wine = core.log_tasting(
        conn, wine["id"], rating=93, tasting_notes="chalky, saline, long", buy_again=True
    )
    assert wine["quantity"] == 1
    consume = [event for event in wine["events"] if event["event_type"] == "consume"]
    assert len(consume) == 1
    assert consume[0]["tasting_id"] == wine["tastings"][0]["id"]
    assert wine["tastings"][0]["user_name"] == db.DEFAULT_USER_NAME
    assert wine["avg_rating"] == 93


def test_tasting_elsewhere_keeps_inventory(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 1)
    wine = core.log_tasting(
        conn, wine["id"], rating=88, context_type="restaurant", venue="Frenchette",
        consume_bottle=False,
    )
    assert wine["quantity"] == 1


def test_full_history_combines_inventory_changes_and_reviews(conn):
    wine = add_sample_wine(conn)
    wine = core.log_purchase(
        conn,
        wine["id"],
        2,
        price_per_bottle=74.0,
        vendor="Chambers Street",
        purchase_date="2026-08-01",
    )
    wine = core.adjust_inventory(
        conn,
        wine["id"],
        -1,
        reason="drunk (marked in web UI)",
        event_type="consume",
    )
    consume_event = next(
        event for event in wine["events"] if event["event_type"] == "consume"
    )
    quantity_before = wine["quantity"]

    core.review_inventory_event(
        conn,
        consume_event["id"],
        user="Shuyang",
        rating=92,
        tasting_notes="chalk and citrus",
    )
    core.review_inventory_event(
        conn,
        consume_event["id"],
        user="Alex",
        rating=90,
        tasting_notes="very mineral",
    )
    core.log_tasting(
        conn,
        wine["id"],
        user="Alex",
        rating=88,
        context_type="restaurant",
        consume_bottle=False,
        tasted_on="2026-08-02",
    )

    assert core.get_wine(conn, wine["id"])["quantity"] == quantity_before
    history = core.full_history(conn)
    assert {entry["kind"] for entry in history} == {"inventory_change", "review"}
    assert len(history) == 3  # purchase, consumed bottle, standalone restaurant review

    consumed = next(
        entry
        for entry in history
        if entry["event"] and entry["event"]["id"] == consume_event["id"]
    )
    assert consumed["event"]["delta"] == -1
    assert consumed["event"]["wine_id"] == wine["id"]
    assert {review["user_name"] for review in consumed["reviews"]} == {
        "Shuyang",
        "Alex",
    }

    purchase = next(
        entry
        for entry in history
        if entry["event"] and entry["event"]["event_type"] == "purchase"
    )
    assert purchase["event"]["purchase_vendor"] == "Chambers Street"
    assert purchase["event"]["purchase_price_per_bottle"] == 74.0


def test_review_inventory_event_handles_null_legacy_timestamp(conn):
    wine = add_sample_wine(conn)
    wine = core.log_purchase(conn, wine["id"], 1)
    event_id = wine["events"][0]["id"]
    conn.execute(
        "UPDATE inventory_events SET occurred_at = NULL WHERE id = ?", (event_id,)
    )
    conn.commit()

    reviewed = core.review_inventory_event(conn, event_id, rating=90)

    assert reviewed["quantity"] == 1
    assert reviewed["tastings"][0]["tasted_on"] == "1970-01-01"
    event_entry = next(
        entry for entry in core.full_history(conn) if entry["key"] == f"inventory:{event_id}"
    )
    assert event_entry["event"]["occurred_at"] == "1970-01-01 00:00:00"


def test_deleting_attached_review_keeps_inventory_event(conn):
    wine = add_sample_wine(conn)
    wine = core.log_purchase(conn, wine["id"], 2)
    wine = core.adjust_inventory(conn, wine["id"], -1, "drunk", "consume")
    event = wine["events"][-1]
    reviewed = core.review_inventory_event(conn, event["id"], rating=91)
    tasting_id = reviewed["tastings"][0]["id"]

    after = core.delete_tasting(conn, tasting_id)

    assert after["quantity"] == 1
    assert [item["id"] for item in after["events"]] == [
        item["id"] for item in wine["events"]
    ]
    assert after["tastings"] == []


def test_deleting_primary_tasting_keeps_additional_review_standalone(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 1)
    wine = core.log_tasting(conn, wine["id"], user="Shuyang", rating=92)
    event = next(item for item in wine["events"] if item["event_type"] == "consume")
    primary_id = event["tasting_id"]
    core.review_inventory_event(conn, event["id"], user="Alex", rating=90)

    after = core.delete_tasting(conn, primary_id)

    assert after["quantity"] == 1
    assert len(after["tastings"]) == 1
    assert after["tastings"][0]["user_name"] == "Alex"
    assert after["tastings"][0]["inventory_event_id"] is None


def test_second_user_reviews_same_wine(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 2)
    core.log_tasting(conn, wine["id"], rating=90)
    wine = core.log_tasting(conn, wine["id"], rating=80, user="Alex", consume_bottle=False)
    users = {tasting["user_name"] for tasting in wine["tastings"]}
    assert users == {db.DEFAULT_USER_NAME, "Alex"}
    assert wine["avg_rating"] == 85.0


def test_inventory_cannot_go_negative(conn):
    wine = add_sample_wine(conn)
    with pytest.raises(ValueError, match="below zero"):
        core.log_tasting(conn, wine["id"], rating=90)


def test_find_wines_dedupe_search(conn):
    add_sample_wine(conn)
    add_sample_wine(conn, producer="Produttori del Barbaresco", wine_name="Barbaresco",
                    vintage="2019", region="Piedmont", varietal="Nebbiolo",
                    wine_type="red", country="Italy")
    assert len(core.find_wines(conn, "barbaresco 2019")) == 1
    assert len(core.find_wines(conn, "peters champagne")) == 1
    assert core.find_wines(conn, "produttori 2020") == []


def test_read_query_rejects_mutations(conn):
    with pytest.raises(ValueError):
        core.read_query(conn, "DELETE FROM wines")
    with pytest.raises(ValueError):
        core.read_query(conn, "SELECT 1; DROP TABLE wines")
    assert core.read_query(conn, "SELECT COUNT(*) AS n FROM wines") == [{"n": 0}]


def test_drinking_window_alerts_buckets(conn):
    year = core.dt.date.today().year
    wines = [
        add_sample_wine(
            conn,
            producer="A",
            wine_name="Past",
            drinking_window_start=str(year - 10),
            drinking_window_end=str(year - 1),
        ),
        add_sample_wine(
            conn,
            producer="B",
            wine_name="DrinkFirst",
            drinking_window_start=str(year - 5),
            drinking_window_end=str(year + 1),
        ),
        add_sample_wine(
            conn,
            producer="C",
            wine_name="DrinkSoon",
            drinking_window_start=str(year - 2),
            drinking_window_end=str(year + 3),
        ),
        add_sample_wine(
            conn,
            producer="D",
            wine_name="ReadyToHold",
            drinking_window_start=str(year),
            drinking_window_end=str(year + 7),
        ),
        add_sample_wine(
            conn,
            producer="E",
            wine_name="LongTerm",
            drinking_window_start=str(year),
            drinking_window_end=str(year + 8),
        ),
        add_sample_wine(
            conn,
            producer="F",
            wine_name="OpenEnded",
            drinking_window_start=str(year - 2),
        ),
        add_sample_wine(
            conn,
            producer="G",
            wine_name="Approaching",
            drinking_window_start=str(year + 2),
            drinking_window_end=str(year + 12),
        ),
        add_sample_wine(conn, producer="H", wine_name="NoWindow"),
    ]
    for wine in wines:
        core.log_purchase(conn, wine["id"], 1)
    alerts = core.drinking_window_alerts(conn)
    assert [w["wine_name"] for w in alerts["drink_first"]] == ["DrinkFirst"]
    assert [w["wine_name"] for w in alerts["drink_soon"]] == ["DrinkSoon"]
    assert [w["wine_name"] for w in alerts["ready_to_hold"]] == [
        "ReadyToHold",
        "OpenEnded",
    ]
    assert [w["wine_name"] for w in alerts["long_term"]] == ["LongTerm"]
    assert [w["wine_name"] for w in alerts["approaching"]] == ["Approaching"]
    assert [w["wine_name"] for w in alerts["past_peak"]] == ["Past"]
    assert [w["wine_name"] for w in alerts["no_window"]] == ["NoWindow"]


def test_attach_photo_copies_into_store(conn, tmp_path: Path):
    wine = add_sample_wine(conn)
    source = tmp_path / "label.jpg"
    source.write_bytes(b"fake image bytes")
    photo = core.attach_photo(conn, str(source), wine_id=wine["id"], kind="label")
    stored = config.photos_dir() / photo["path"]
    assert stored.read_bytes() == b"fake image bytes"
    listing = core.list_inventory(conn, in_stock=False)
    assert listing["items"][0]["label_photo"] == photo["path"]


# ---------------------------------------------------------------------------
# Web API (original shapes preserved)


def test_manager_api_can_create_and_list_cellar_inventory(client):
    response = client.post(
        "/api/cellar/items",
        json={
            "producer": "Pierre Peters",
            "wine_name": "Cuvée de Réserve",
            "vintage": "NV",
            "country": "France",
            "region": "Champagne",
            "quantity": 3,
            "acquired_from": "Chambers Street Wines",
            "acquired_price": 74.0,
        },
    )
    assert response.status_code == 201
    created = response.json()
    assert created["quantity"] == 3
    assert created["acquired_price"] == 74.0

    payload = client.get("/api/cellar").json()
    assert payload["summary"]["labels"]["bottles"] == 3
    assert payload["summary"]["estimated_cost"] == 222.0
    assert payload["pagination"]["total_items"] == 1
    assert payload["items"][0]["producer"] == "Pierre Peters"


def test_adjust_endpoint_writes_event(client):
    wine_id = client.post(
        "/api/cellar/items",
        json={"producer": "P", "wine_name": "W", "quantity": 4},
    ).json()["id"]
    response = client.post(
        f"/api/cellar/items/{wine_id}/adjust",
        json={"delta": -1, "reason": "broke a bottle"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["quantity"] == 3
    assert body["last_event_reason"] == "broke a bottle"
    events = client.get(f"/api/wines/{wine_id}").json()["events"]
    assert [event["delta"] for event in events] == [4, -1]

    assert client.post(
        f"/api/cellar/items/{wine_id}/adjust", json={"delta": -5, "reason": "oops"}
    ).status_code == 400
    assert client.post(
        "/api/cellar/items/9999/adjust", json={"delta": 1, "reason": "x"}
    ).status_code == 404


def test_tasting_and_stats_endpoints(client):
    wine_id = client.post(
        "/api/cellar/items",
        json={"producer": "P", "wine_name": "W", "wine_type": "red", "quantity": 2,
              "acquired_price": 30.0},
    ).json()["id"]
    response = client.post(
        f"/api/wines/{wine_id}/tastings",
        json={"rating": 91, "tasting_notes": "great", "buy_again": True},
    )
    assert response.status_code == 201
    assert response.json()["quantity"] == 1

    stats = client.get("/api/stats").json()
    assert stats["by_type"][0]["wine_type"] == "red"
    assert stats["top_rated"][0]["avg_rating"] == 91.0
    history = client.get("/api/tastings").json()
    assert history[0]["rating"] == 91

    assert client.get("/api/drink-now").status_code == 200
    assert client.get("/health").json()["ok"] is True


def test_history_endpoint_and_inventory_event_review(client):
    wine = client.post(
        "/api/cellar/items",
        json={"producer": "P", "wine_name": "W", "quantity": 2},
    ).json()
    adjusted = client.post(
        f"/api/cellar/items/{wine['id']}/adjust",
        json={"delta": -1, "reason": "drunk", "event_type": "consume"},
    ).json()
    event = adjusted["events"][-1]
    quantity_before = adjusted["quantity"]

    created = client.post(
        f"/api/inventory-events/{event['id']}/reviews",
        json={
            "user": "Alex",
            "rating": 93,
            "tasting_notes": "silky and long",
            "buy_again": True,
        },
    )

    assert created.status_code == 201
    assert created.json()["quantity"] == quantity_before
    history = client.get("/api/history")
    assert history.status_code == 200
    event_entry = next(
        item for item in history.json() if item["key"] == f"inventory:{event['id']}"
    )
    assert event_entry["event"]["delta"] == -1
    assert event_entry["event"]["wine_id"] == wine["id"]
    assert event_entry["reviews"][0]["user_name"] == "Alex"
    assert event_entry["reviews"][0]["rating"] == 93

    missing = client.post(
        "/api/inventory-events/9999/reviews", json={"rating": 90}
    )
    assert missing.status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {"tasted_on": "not-a-date"},
        {"tasted_on": "2026-02-30"},
        {"context_type": "   "},
        {"rating": True},
        {"rating": "90"},
        {"rating": 90.0},
        {"price_paid": True},
        {"price_paid": "12.5"},
    ],
)
def test_review_create_endpoints_reject_invalid_values_without_side_effects(
    client, payload
):
    wine = client.post(
        "/api/cellar/items",
        json={"producer": "Strict", "wine_name": "Review", "quantity": 2},
    ).json()
    event = wine["events"][0]

    for endpoint in (
        f"/api/wines/{wine['id']}/tastings",
        f"/api/inventory-events/{event['id']}/reviews",
    ):
        response = client.post(endpoint, json=payload)
        assert response.status_code == 422
        dossier = client.get(f"/api/wines/{wine['id']}").json()
        assert dossier["quantity"] == 2
        assert dossier["tastings"] == []


def test_review_create_endpoints_reject_non_finite_price_without_side_effects(client):
    wine = client.post(
        "/api/cellar/items",
        json={"producer": "Finite", "wine_name": "Review", "quantity": 2},
    ).json()
    event = wine["events"][0]

    for endpoint in (
        f"/api/wines/{wine['id']}/tastings",
        f"/api/inventory-events/{event['id']}/reviews",
    ):
        response = client.post(
            endpoint,
            content='{"price_paid":1e999}',
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 422
        dossier = client.get(f"/api/wines/{wine['id']}").json()
        assert dossier["quantity"] == 2
        assert dossier["tastings"] == []


def test_review_create_accepts_empty_tasted_on(client):
    wine = client.post(
        "/api/cellar/items",
        json={"producer": "Default", "wine_name": "Review date", "quantity": 1},
    ).json()

    response = client.post(
        f"/api/wines/{wine['id']}/tastings",
        json={"rating": 90, "tasted_on": ""},
    )

    assert response.status_code == 201
    assert (
        response.json()["tastings"][0]["tasted_on"]
        == core.dt.datetime.now().astimezone().date().isoformat()
    )


def test_delete_tasting_restores_bottle(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 2)
    wine = core.log_tasting(conn, wine["id"], rating=90)
    assert wine["quantity"] == 1
    wine = core.delete_tasting(conn, wine["tastings"][0]["id"])
    assert wine["quantity"] == 2
    assert wine["tastings"] == []
    assert sum(event["delta"] for event in wine["events"]) == 2


def test_tastings_attributed_per_user(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 2)
    core.log_tasting(conn, wine["id"], rating=92, tasting_notes="owner take")
    wine = core.log_tasting(
        conn, wine["id"], user="Alex", rating=88, tasting_notes="alex take", consume_bottle=False
    )
    assert [t["user_name"] for t in wine["tastings"]] == ["Shuyang", "Alex"]
    assert wine["quantity"] == 1  # shared bottle consumed once

    users = {u["name"]: u for u in core.list_users(conn)}
    assert users["Shuyang"]["is_default"] == 1
    assert users["Shuyang"]["tasting_count"] == 1
    assert users["Alex"]["tasting_count"] == 1

    # Case-insensitive reuse: "alex" must not create a second reviewer.
    core.log_tasting(conn, wine["id"], user="alex", rating=89, consume_bottle=False)
    assert len(core.list_users(conn)) == 2


def test_set_tasting_user_reattributes_review(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 1)
    wine = core.log_tasting(conn, wine["id"], rating=90)
    tasting_id = wine["tastings"][0]["id"]
    wine = core.set_tasting_user(conn, tasting_id, "Alex")
    assert wine["tastings"][0]["user_name"] == "Alex"
    with pytest.raises(ValueError, match="no tasting"):
        core.set_tasting_user(conn, 9999, "Alex")
    with pytest.raises(ValueError, match="user is required"):
        core.set_tasting_user(conn, tasting_id, "")


def test_update_tasting_edits_review_without_changing_inventory(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 2)
    wine = core.log_tasting(
        conn,
        wine["id"],
        rating=88,
        tasting_notes="closed at first",
        context_type="home",
        consume_bottle=True,
    )
    tasting_id = wine["tastings"][0]["id"]
    quantity_before = wine["quantity"]
    events_before = wine["events"]

    updated = core.update_tasting(
        conn,
        tasting_id,
        user="Alex",
        rating=93,
        tasting_notes="opened into chalk and citrus",
        food_pairing="roast chicken",
        context_type="restaurant",
        venue="The Four Horsemen",
        price_paid=24.0,
        liked=False,
        buy_again=True,
        tasted_on="2026-08-01",
    )

    [review] = updated["tastings"]
    assert review["user_name"] == "Alex"
    assert review["rating"] == 93
    assert review["tasting_notes"] == "opened into chalk and citrus"
    assert review["food_pairing"] == "roast chicken"
    assert review["context_type"] == "restaurant"
    assert review["venue"] == "The Four Horsemen"
    assert review["price_paid"] == 24.0
    assert review["liked"] == 0
    assert review["buy_again"] == 1
    assert review["tasted_on"] == "2026-08-01"
    assert updated["quantity"] == quantity_before
    assert updated["events"] == events_before
    assert updated["avg_rating"] == 93


def test_update_tasting_can_clear_optional_review_fields(conn):
    wine = add_sample_wine(conn)
    wine = core.log_tasting(
        conn,
        wine["id"],
        rating=91,
        tasting_notes="temporary note",
        venue="At home",
        price_paid=30.0,
        consume_bottle=False,
    )

    updated = core.update_tasting(
        conn,
        wine["tastings"][0]["id"],
        rating=None,
        tasting_notes="",
        venue="",
        price_paid=None,
    )

    [review] = updated["tastings"]
    assert review["rating"] is None
    assert review["tasting_notes"] is None
    assert review["venue"] is None
    assert review["price_paid"] is None
    assert updated["avg_rating"] is None


def test_update_tasting_rejects_invalid_fields_and_missing_rows(conn):
    wine = add_sample_wine(conn)
    wine = core.log_tasting(conn, wine["id"], rating=90, consume_bottle=False)
    tasting_id = wine["tastings"][0]["id"]

    with pytest.raises(ValueError, match="rating must be 0-100"):
        core.update_tasting(conn, tasting_id, rating=101)
    with pytest.raises(ValueError, match="context type is required"):
        core.update_tasting(conn, tasting_id, context_type=None)
    with pytest.raises(ValueError, match="context type is required"):
        core.update_tasting(conn, tasting_id, context_type=" ")
    with pytest.raises(ValueError, match="buy again must be true or false"):
        core.update_tasting(conn, tasting_id, buy_again=None)
    with pytest.raises(ValueError, match="unknown tasting fields"):
        core.update_tasting(conn, tasting_id, consume_bottle=True)
    with pytest.raises(ValueError, match="no tasting"):
        core.update_tasting(conn, 9999, rating=90)


def test_update_tasting_preserves_or_clears_unattributed_reviewer(conn):
    wine = add_sample_wine(conn)
    wine = core.log_tasting(
        conn, wine["id"], user="Alex", rating=90, consume_bottle=False
    )
    tasting_id = wine["tastings"][0]["id"]

    reattributed = core.update_tasting(conn, tasting_id, user="  alex  ")
    assert reattributed["tastings"][0]["user_name"] == "Alex"
    assert [user["name"] for user in core.list_users(conn)] == ["Shuyang", "Alex"]

    with pytest.raises(ValueError, match="reviewer is required"):
        core.update_tasting(conn, tasting_id, user="  ")

    cleared = core.update_tasting(conn, tasting_id, user=None)
    assert cleared["tastings"][0]["user_name"] is None

    preserved = core.update_tasting(conn, tasting_id, rating=91)
    assert preserved["tastings"][0]["user_name"] is None


def test_delete_purchase_removes_bottles_and_detaches_reviews(conn):
    wine = add_sample_wine(conn)
    wine = core.log_purchase(conn, wine["id"], 3)
    purchase_id = wine["purchases"][0]["id"]
    purchase_event_id = wine["events"][0]["id"]
    core.review_inventory_event(conn, purchase_event_id, rating=90)

    wine = core.delete_purchase(conn, purchase_id)

    assert wine["quantity"] == 0
    assert wine["purchases"] == []
    assert wine["events"] == []
    assert len(wine["tastings"]) == 1
    assert wine["tastings"][0]["inventory_event_id"] is None


def test_delete_purchase_blocked_when_bottles_consumed(conn):
    wine = add_sample_wine(conn)
    wine = core.log_purchase(conn, wine["id"], 1)
    core.log_tasting(conn, wine["id"], rating=90)
    with pytest.raises(ValueError, match="already consumed"):
        core.delete_purchase(conn, wine["purchases"][0]["id"])


def test_delete_wine_cascades_including_photos(conn, tmp_path: Path):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 2)
    wine = core.log_tasting(conn, wine["id"], rating=90)
    consume_event = next(
        event for event in wine["events"] if event["event_type"] == "consume"
    )
    core.review_inventory_event(conn, consume_event["id"], user="Alex", rating=88)
    source = tmp_path / "label.jpg"
    source.write_bytes(b"img")
    photo = core.attach_photo(conn, str(source), wine_id=wine["id"])
    stored = config.photos_dir() / photo["path"]
    assert stored.is_file()

    core.delete_wine(conn, wine["id"])
    assert not stored.is_file()
    for table in ("wines", "purchases", "tastings", "inventory_events", "photos"):
        assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


def test_update_and_delete_endpoints(client):
    wine_id = client.post(
        "/api/cellar/items",
        json={"producer": "P", "wine_name": "W", "quantity": 1},
    ).json()["id"]

    response = client.patch(
        f"/api/wines/{wine_id}", json={"region": "Barolo", "wine_type": "red"}
    )
    assert response.status_code == 200
    assert response.json()["region"] == "Barolo"
    assert client.patch(f"/api/wines/{wine_id}", json={}).status_code == 400

    tasting = client.post(
        f"/api/wines/{wine_id}/tastings", json={"rating": 88}
    ).json()["tastings"][0]
    edited = client.patch(
        f"/api/tastings/{tasting['id']}",
        json={
            "user": "Alex",
            "rating": 94,
            "tasting_notes": "much better with air",
            "liked": False,
            "buy_again": True,
        },
    )
    assert edited.status_code == 200
    [edited_review] = edited.json()["tastings"]
    assert edited_review["user_name"] == "Alex"
    assert edited_review["rating"] == 94
    assert edited_review["tasting_notes"] == "much better with air"
    assert edited_review["liked"] == 0
    assert edited_review["buy_again"] == 1
    assert edited.json()["quantity"] == 0
    assert client.patch(
        f"/api/tastings/{tasting['id']}", json={"rating": 101}
    ).status_code == 422
    for invalid in (
        {"user": "  "},
        {"context_type": None},
        {"context_type": " "},
        {"liked": None},
        {"buy_again": None},
    ):
        assert client.patch(
            f"/api/tastings/{tasting['id']}", json=invalid
        ).status_code == 422
    assert client.patch(f"/api/tastings/{tasting['id']}", json={}).status_code == 400
    assert client.patch("/api/tastings/9999", json={"rating": 90}).status_code == 404
    restored = client.delete(f"/api/tastings/{tasting['id']}")
    assert restored.status_code == 200
    assert restored.json()["quantity"] == 1
    assert client.delete("/api/tastings/9999").status_code == 404

    assert client.delete(f"/api/wines/{wine_id}").json()["ok"] is True
    assert client.get(f"/api/wines/{wine_id}").status_code == 404


def test_photo_endpoint_rejects_traversal(client, data_dir: Path):
    # A secret file next to the photos dir must not be reachable.
    (data_dir / "cellar-secret.txt").write_text("secret")
    for path in ("/photos/.hidden", "/photos/nonexistent.jpg"):
        assert client.get(path).status_code == 404
    # Encoded traversal is normalized away from the /photos route; whatever
    # answers (404 or the SPA shell), it must not leak file contents.
    response = client.get("/photos/%2e%2e%2fcellar-secret.txt")
    assert b"secret" not in response.content


def test_connection_supports_fastapi_worker_thread_handoffs(tmp_path: Path) -> None:
    conn = db.connect(tmp_path / "threaded.db")
    errors: list[BaseException] = []

    def query_from_worker() -> None:
        try:
            conn.execute("SELECT 1").fetchone()
        except BaseException as exc:
            errors.append(exc)

    worker = threading.Thread(target=query_from_worker)
    worker.start()
    worker.join()
    conn.close()

    assert errors == []


def test_wishlist_round_trip_with_recommender(conn):
    wine = add_sample_wine(conn)
    entry = core.wishlist_add(
        conn,
        wine["id"],
        recommended_by="Alex",
        reason="Said it drinks like grand cru for half the price",
    )
    assert entry["recommended_by"] == "Alex"

    listed = core.wishlist_list(conn)
    assert len(listed) == 1
    # The join must carry enough wine detail to render a row without a second fetch.
    assert listed[0]["producer"] == wine["producer"]
    assert listed[0]["quantity"] == 0
    assert listed[0]["recommended_by"] == "Alex"

    core.wishlist_remove(conn, entry["id"])
    assert core.wishlist_list(conn) == []


def test_wishlist_rejects_unknown_wine_and_entry(conn):
    with pytest.raises(ValueError, match="no wine with id"):
        core.wishlist_add(conn, 9999, recommended_by="Nobody")
    with pytest.raises(ValueError, match="no wishlist entry with id"):
        core.wishlist_remove(conn, 9999)


def test_wishlist_endpoints(client):
    wine_id = client.post(
        "/api/cellar/items",
        json={"producer": "Overnoy", "wine_name": "Ploussard", "quantity": 0},
    ).json()["id"]

    created = client.post(
        "/api/wishlist",
        json={
            "wine_id": wine_id,
            "recommended_by": "  Marta  ",
            "reason": "Poured it at dinner",
            "listed_price": 62.0,
        },
    )
    assert created.status_code == 200
    assert created.json()["recommended_by"] == "Marta"

    entries = client.get("/api/wishlist").json()
    assert len(entries) == 1
    assert entries[0]["wine_name"] == "Ploussard"
    assert entries[0]["listed_price"] == 62.0

    # Wanting a bottle must not imply owning one.
    assert client.get("/api/cellar").json()["pagination"]["total_items"] == 0

    assert client.delete(f"/api/wishlist/{entries[0]['id']}").status_code == 200
    assert client.get("/api/wishlist").json() == []


def test_wishlist_endpoint_reports_missing_rows(client):
    assert client.post("/api/wishlist", json={"wine_id": 4242}).status_code == 404
    assert client.delete("/api/wishlist/4242").status_code == 404


def test_assign_initials_uses_first_letter():
    assert core.assign_initials(["Shuyang", "Alex"]) == {"Shuyang": "S", "Alex": "A"}
    # Colliding names share an initial; the UI flips the badge to the full name.
    assert core.assign_initials(["Shuyang", "Sam"]) == {"Shuyang": "S", "Sam": "S"}
    # A lowercase name still yields an uppercase initial.
    assert core.assign_initials(["shuyang"]) == {"shuyang": "S"}
    assert core.assign_initials([""]) == {"": "?"}
    assert core.assign_initials([]) == {}


def test_ratings_are_attributed_per_reviewer(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 3)
    core.log_tasting(conn, wine["id"], user="Shuyang", rating=89)
    core.log_tasting(conn, wine["id"], user="Alex", rating=90)

    dossier = core.get_wine(conn, wine["id"])
    rendered = {entry["initials"]: entry["rating"] for entry in dossier["ratings"]}
    assert rendered == {"S": 89.0, "A": 90.0}
    assert dossier["avg_rating"] == 89.5
    # Each tasting carries its own reviewer's initials for the history list.
    assert {t["user_initials"] for t in dossier["tastings"]} == {"S", "A"}


def test_rating_breakdown_averages_repeat_tastings_per_reviewer(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 3)
    core.log_tasting(conn, wine["id"], user="Alex", rating=88)
    core.log_tasting(conn, wine["id"], user="Alex", rating=92)

    [entry] = core.get_wine(conn, wine["id"])["ratings"]
    assert entry["rating"] == 90.0
    assert entry["tastings"] == 2


def test_colliding_reviewers_share_an_initial(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 2)
    core.log_tasting(conn, wine["id"], user="Shuyang", rating=89)
    assert core.get_wine(conn, wine["id"])["ratings"][0]["initials"] == "S"

    core.log_tasting(conn, wine["id"], user="Sam", rating=85)
    rendered = {e["user_name"]: e["initials"] for e in core.get_wine(conn, wine["id"])["ratings"]}
    assert rendered == {"Shuyang": "S", "Sam": "S"}


def test_list_view_carries_per_reviewer_ratings(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 3)
    core.log_tasting(conn, wine["id"], user="Shuyang", rating=89)
    core.log_tasting(conn, wine["id"], user="Alex", rating=90)

    [item] = core.list_inventory(conn)["items"]
    assert {e["initials"]: e["rating"] for e in item["ratings"]} == {"S": 89.0, "A": 90.0}


def test_users_endpoint_reports_initials(client):
    wine_id = client.post(
        "/api/cellar/items", json={"producer": "P", "wine_name": "W"}
    ).json()["id"]
    client.post(f"/api/wines/{wine_id}/purchases", json={"quantity": 2})
    client.post(
        f"/api/wines/{wine_id}/tastings",
        json={"user": "Alex", "rating": 90, "consume_bottle": True},
    )

    users = client.get("/api/users").json()
    by_name = {user["name"]: user for user in users}
    assert by_name["Alex"]["initials"] == "A"
    assert by_name["Alex"]["tasting_count"] == 1
    # A reviewer named in a tasting is created on first use.
    assert by_name["Shuyang"]["is_default"] == 1


def test_tasting_endpoint_attributes_and_renders_initials(client):
    wine_id = client.post(
        "/api/cellar/items", json={"producer": "P", "wine_name": "W"}
    ).json()["id"]
    client.post(f"/api/wines/{wine_id}/purchases", json={"quantity": 3})
    for user, rating in (("Shuyang", 89), ("Alex", 90)):
        client.post(
            f"/api/wines/{wine_id}/tastings",
            json={"user": user, "rating": rating, "consume_bottle": True},
        )

    dossier = client.get(f"/api/wines/{wine_id}").json()
    assert {e["initials"]: e["rating"] for e in dossier["ratings"]} == {
        "S": 89.0,
        "A": 90.0,
    }
    history = client.get("/api/tastings").json()
    assert {t["user_initials"] for t in history} == {"S", "A"}


# ---------------------------------------------------------------------------
# Ordered wines


def test_ordered_wine_round_trip_and_tracking_update(conn):
    wine = add_sample_wine(conn)
    order = core.add_ordered_wine(
        conn,
        wine["id"],
        4,
        vendor="Crush Wine & Spirits",
        order_reference="CW-123",
        ordered_on="2026-08-01",
        price_per_bottle=52.50,
        tracking_url="https://www.ups.com/track?loc=en_US&tracknum=1Z999",
        expected_on="2026-08-07",
        source_message_id="gmail-message-1",
    )

    assert order["status"] == "ordered"
    assert order["quantity"] == 4
    assert order["producer"] == wine["producer"]
    assert core.list_ordered_wines(conn) == [order]

    updated = core.update_ordered_wine(
        conn,
        order["id"],
        tracking_url="https://tools.usps.com/go/TrackConfirmAction?tLabels=9400",
        expected_on="2026-08-08",
        source_message_id="gmail-message-2",
    )
    assert updated["tracking_url"].startswith("https://tools.usps.com/")
    assert updated["expected_on"] == "2026-08-08"
    assert updated["source_message_id"] == "gmail-message-1"


def test_ordered_wine_email_replay_updates_existing_order_line(conn):
    wine = add_sample_wine(conn)
    first = core.add_ordered_wine(
        conn,
        wine["id"],
        2,
        vendor="Kogod Wine Merchant",
        order_reference="ORDER-42",
        ordered_on="2026-01-01",
        currency="EUR",
        source_message_id="confirmation-message",
    )
    replayed = core.add_ordered_wine(
        conn,
        wine["id"],
        2,
        vendor="Kogod Wine Merchant",
        order_reference="ORDER-42",
        tracking_url="https://www.fedex.com/fedextrack/?trknbr=123",
        source_message_id="tracking-message",
    )

    assert replayed["id"] == first["id"]
    assert replayed["tracking_url"].startswith("https://www.fedex.com/")
    assert replayed["source_message_id"] == "confirmation-message"
    assert replayed["ordered_on"] == "2026-01-01"
    assert replayed["currency"] == "EUR"
    assert len(core.list_ordered_wines(conn)) == 1


def test_ordered_wine_email_message_replay_is_idempotent_without_order_reference(conn):
    wine = add_sample_wine(conn)
    first = core.add_ordered_wine(
        conn,
        wine["id"],
        1,
        vendor="Small Importer",
        source_message_id="gmail-message-unique",
    )
    replayed = core.add_ordered_wine(
        conn,
        wine["id"],
        1,
        vendor="Small Importer",
        source_message_id="gmail-message-unique",
        tracking_url="https://www.ups.com/track?tracknum=1Z1",
    )

    assert replayed["id"] == first["id"]
    assert len(core.list_ordered_wines(conn)) == 1


def test_arriving_ordered_wine_adds_inventory_once(conn):
    wine = add_sample_wine(conn)
    order = core.add_ordered_wine(
        conn,
        wine["id"],
        3,
        vendor="Chambers Street Wines",
        ordered_on="2026-08-01",
        price_per_bottle=74.0,
        currency="USD",
        notes="summer allocation",
    )

    arrived = core.mark_ordered_wine_arrived(conn, order["id"], arrived_on="2026-08-06")
    assert arrived["status"] == "arrived"
    assert arrived["arrived_on"] == "2026-08-06"
    assert arrived["purchase_id"] is not None

    dossier = core.get_wine(conn, wine["id"])
    assert dossier["quantity"] == 3
    assert len(dossier["purchases"]) == 1
    assert dossier["purchases"][0]["purchase_date"] == "2026-08-01"
    assert dossier["purchases"][0]["vendor"] == "Chambers Street Wines"

    # Double clicks / retried API requests are idempotent.
    again = core.mark_ordered_wine_arrived(conn, order["id"], arrived_on="2026-08-07")
    assert again["purchase_id"] == arrived["purchase_id"]
    assert core.get_wine(conn, wine["id"])["quantity"] == 3
    assert core.list_ordered_wines(conn) == []
    assert core.list_ordered_wines(conn, include_arrived=True) == [again]


def test_concurrent_arrival_requests_only_add_inventory_once(tmp_path: Path):
    path = tmp_path / "concurrent-arrival.db"
    setup = db.open_db(path)
    wine = add_sample_wine(setup)
    order = core.add_ordered_wine(setup, wine["id"], 3)
    setup.close()

    errors: list[Exception] = []

    def arrive() -> None:
        connection = db.open_db(path)
        try:
            core.mark_ordered_wine_arrived(connection, order["id"])
        except (sqlite3.Error, ValueError, threading.BrokenBarrierError) as error:
            errors.append(error)
        finally:
            connection.close()

    workers = [threading.Thread(target=arrive) for _ in range(2)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=10)

    assert all(not worker.is_alive() for worker in workers)
    assert errors == []
    verify = db.open_db(path)
    assert core.get_wine(verify, wine["id"])["quantity"] == 3
    assert len(core.get_wine(verify, wine["id"])["purchases"]) == 1
    verify.close()


def test_update_cannot_modify_an_order_after_concurrent_arrival(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    path = tmp_path / "update-arrival-race.db"
    setup = db.open_db(path)
    wine = add_sample_wine(setup)
    order = core.add_ordered_wine(setup, wine["id"], 3)

    original_get = core.get_ordered_wine
    stale_read_complete = threading.Event()
    arrival_complete = threading.Event()
    first_update_read = True

    def pause_stale_update(conn, order_id):
        nonlocal first_update_read
        result = original_get(conn, order_id)
        if threading.current_thread().name == "stale-order-update" and first_update_read:
            first_update_read = False
            stale_read_complete.set()
            assert arrival_complete.wait(timeout=5)
        return result

    monkeypatch.setattr(core, "get_ordered_wine", pause_stale_update)
    update_errors: list[ValueError] = []

    def update_quantity() -> None:
        connection = db.open_db(path)
        try:
            core.update_ordered_wine(connection, order["id"], quantity=5)
        except ValueError as error:
            update_errors.append(error)
        finally:
            connection.close()

    worker = threading.Thread(target=update_quantity, name="stale-order-update")
    worker.start()
    assert stale_read_complete.wait(timeout=5)
    arrived = core.mark_ordered_wine_arrived(setup, order["id"])
    arrival_complete.set()
    worker.join(timeout=10)

    assert not worker.is_alive()
    assert len(update_errors) == 1
    final = core.get_ordered_wine(setup, order["id"])
    assert final["status"] == "arrived"
    assert final["quantity"] == 3
    assert arrived["purchase_id"] == final["purchase_id"]
    dossier = core.get_wine(setup, wine["id"])
    assert dossier["quantity"] == 3
    assert dossier["purchases"][0]["quantity"] == 3
    setup.close()


def test_arrival_snapshot_cannot_be_overtaken_by_a_metadata_update(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    path = tmp_path / "arrival-update-race.db"
    setup = db.open_db(path)
    wine = add_sample_wine(setup)
    order = core.add_ordered_wine(
        setup,
        wine["id"],
        3,
        price_per_bottle=10,
        vendor="Original vendor",
    )
    setup.close()

    original_get = core.get_ordered_wine
    arrival_has_read = threading.Event()
    release_arrival = threading.Event()

    def pause_arrival_after_read(conn, order_id):
        result = original_get(conn, order_id)
        if (
            threading.current_thread().name == "arrival"
            and not arrival_has_read.is_set()
        ):
            arrival_has_read.set()
            assert release_arrival.wait(timeout=5)
        return result

    monkeypatch.setattr(core, "get_ordered_wine", pause_arrival_after_read)
    errors: list[Exception] = []
    update_started = threading.Event()
    update_finished = threading.Event()

    def arrive() -> None:
        connection = db.open_db(path)
        try:
            core.mark_ordered_wine_arrived(connection, order["id"])
        except (sqlite3.Error, ValueError, threading.BrokenBarrierError) as error:
            errors.append(error)
        finally:
            connection.close()

    def update() -> None:
        connection = db.open_db(path)
        try:
            update_started.set()
            core.update_ordered_wine(
                connection,
                order["id"],
                quantity=5,
                price_per_bottle=20,
                vendor="Updated vendor",
            )
        except ValueError:
            pass
        except sqlite3.Error as error:
            errors.append(error)
        finally:
            update_finished.set()
            connection.close()

    arrival_worker = threading.Thread(target=arrive, name="arrival")
    arrival_worker.start()
    assert arrival_has_read.wait(timeout=5)
    update_worker = threading.Thread(target=update, name="metadata-update")
    update_worker.start()
    assert update_started.wait(timeout=5)
    update_overtook_arrival = update_finished.wait(timeout=0.25)
    release_arrival.set()
    arrival_worker.join(timeout=10)
    update_worker.join(timeout=10)

    assert not update_overtook_arrival
    assert errors == []
    monkeypatch.setattr(core, "get_ordered_wine", original_get)
    verify = db.open_db(path)
    final = core.get_ordered_wine(verify, order["id"])
    dossier = core.get_wine(verify, wine["id"])
    assert final["status"] == "arrived"
    assert dossier["quantity"] == final["quantity"]
    assert dossier["purchases"][0]["quantity"] == final["quantity"]
    assert dossier["purchases"][0]["price_per_bottle"] == final["price_per_bottle"]
    assert dossier["purchases"][0]["vendor"] == final["vendor"]
    verify.close()


def test_concurrent_case_variant_email_replays_return_one_order(tmp_path: Path):
    path = tmp_path / "concurrent-email-replay.db"
    setup = db.open_db(path)
    wine = add_sample_wine(setup)
    setup.close()
    both_lookups_complete = threading.Barrier(2)

    class SynchronizedLookupConnection(sqlite3.Connection):
        def execute(self, sql, parameters=()):
            cursor = super().execute(sql, parameters)
            if (
                "vendor = ? COLLATE NOCASE" in sql
                and not getattr(self, "_first_lookup_done", False)
            ):
                self._first_lookup_done = True
                both_lookups_complete.wait(timeout=5)
            return cursor

    results: list[dict] = []
    errors: list[sqlite3.Error] = []

    def replay(vendor: str, reference: str) -> None:
        connection = sqlite3.connect(
            path, timeout=10, factory=SynchronizedLookupConnection
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            results.append(
                core.add_ordered_wine(
                    connection,
                    wine["id"],
                    2,
                    vendor=vendor,
                    order_reference=reference,
                )
            )
        except sqlite3.Error as error:
            errors.append(error)
        finally:
            connection.close()

    workers = [
        threading.Thread(target=replay, args=("Merchant", "ORDER-9")),
        threading.Thread(target=replay, args=("merchant", "order-9")),
    ]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=10)

    assert all(not worker.is_alive() for worker in workers)
    assert errors == []
    assert len(results) == 2
    assert results[0]["id"] == results[1]["id"]
    verify = db.open_db(path)
    assert len(core.list_ordered_wines(verify)) == 1
    verify.close()


def test_conflicting_replay_identities_do_not_modify_either_order(conn):
    wine = add_sample_wine(conn)
    first = core.add_ordered_wine(
        conn,
        wine["id"],
        2,
        vendor="First merchant",
        order_reference="FIRST-1",
        source_message_id="message-first",
    )
    second = core.add_ordered_wine(
        conn,
        wine["id"],
        3,
        vendor="Second merchant",
        order_reference="SECOND-2",
        source_message_id="message-second",
    )

    with pytest.raises(ValueError, match="conflicting ordered-wine identities"):
        core.add_ordered_wine(
            conn,
            wine["id"],
            99,
            vendor="First merchant",
            order_reference="FIRST-1",
            source_message_id="message-second",
        )

    assert core.get_ordered_wine(conn, first["id"])["quantity"] == 2
    assert core.get_ordered_wine(conn, second["id"])["quantity"] == 3


def test_concurrent_source_message_updates_keep_the_first_committed_value(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    path = tmp_path / "source-message-race.db"
    setup = db.open_db(path)
    wine = add_sample_wine(setup)
    order = core.add_ordered_wine(setup, wine["id"], 1)
    setup.close()
    both_read_empty = threading.Barrier(2)
    first_committed = threading.Event()
    reads = threading.local()
    original_get = core.get_ordered_wine

    def synchronize_initial_reads(conn, order_id):
        result = original_get(conn, order_id)
        count = getattr(reads, "count", 0)
        reads.count = count + 1
        if count == 0:
            both_read_empty.wait(timeout=5)
        return result

    monkeypatch.setattr(core, "get_ordered_wine", synchronize_initial_reads)

    class OrderedSourceConnection(sqlite3.Connection):
        def execute(self, sql, parameters=()):
            if (
                threading.current_thread().name == "later-source"
                and "UPDATE ordered_wines" in sql
            ):
                assert first_committed.wait(timeout=5)
            return super().execute(sql, parameters)

    errors: list[sqlite3.Error] = []

    def set_source(source: str) -> None:
        connection = sqlite3.connect(path, timeout=10, factory=OrderedSourceConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            core.update_ordered_wine(
                connection, order["id"], source_message_id=source
            )
            if threading.current_thread().name == "first-source":
                first_committed.set()
        except sqlite3.Error as error:
            errors.append(error)
        finally:
            connection.close()

    first = threading.Thread(
        target=set_source, args=("first-committed",), name="first-source"
    )
    later = threading.Thread(
        target=set_source, args=("later-overwrite",), name="later-source"
    )
    first.start()
    later.start()
    first.join(timeout=10)
    later.join(timeout=10)

    assert not first.is_alive() and not later.is_alive()
    assert errors == []
    monkeypatch.setattr(core, "get_ordered_wine", original_get)
    verify = db.open_db(path)
    assert core.get_ordered_wine(verify, order["id"])["source_message_id"] == (
        "first-committed"
    )
    verify.close()


def test_deleting_arrival_purchase_restores_order_to_outstanding(conn):
    wine = add_sample_wine(conn)
    order = core.add_ordered_wine(conn, wine["id"], 2)
    arrived = core.mark_ordered_wine_arrived(conn, order["id"])

    core.delete_purchase(conn, arrived["purchase_id"])

    [restored] = core.list_ordered_wines(conn)
    assert restored["id"] == order["id"]
    assert restored["status"] == "ordered"
    assert restored["arrived_on"] is None
    assert restored["purchase_id"] is None
    assert core.get_wine(conn, wine["id"])["quantity"] == 0


def test_ordered_wine_rejects_bad_tracking_urls_and_updates_after_arrival(conn):
    wine = add_sample_wine(conn)
    with pytest.raises(ValueError, match="tracking_url must use http or https"):
        core.add_ordered_wine(conn, wine["id"], 1, tracking_url="javascript:alert(1)")

    order = core.add_ordered_wine(conn, wine["id"], 1)
    core.mark_ordered_wine_arrived(conn, order["id"])
    with pytest.raises(ValueError, match="already arrived"):
        core.update_ordered_wine(conn, order["id"], quantity=2)


def test_ordered_wine_validates_currency_and_iso_dates(conn):
    wine = add_sample_wine(conn)
    with pytest.raises(ValueError, match="currency must be a 3-letter code"):
        core.add_ordered_wine(conn, wine["id"], 1, currency="US dollars")
    with pytest.raises(ValueError, match="ordered_on must be an ISO date"):
        core.add_ordered_wine(conn, wine["id"], 1, ordered_on="tomorrow")

    order = core.add_ordered_wine(conn, wine["id"], 1)
    with pytest.raises(ValueError, match="expected_on must be an ISO date"):
        core.update_ordered_wine(conn, order["id"], expected_on="next week")
    with pytest.raises(ValueError, match="arrived_on must be an ISO date"):
        core.mark_ordered_wine_arrived(conn, order["id"], arrived_on="soon")


def test_ordered_wine_rejects_non_finite_prices(conn):
    wine = add_sample_wine(conn)
    for price in (float("inf"), float("-inf"), float("nan")):
        with pytest.raises(ValueError, match="price_per_bottle must be finite"):
            core.add_ordered_wine(conn, wine["id"], 1, price_per_bottle=price)


def test_ordered_wine_rejects_boolean_quantities(conn):
    wine = add_sample_wine(conn)
    with pytest.raises(ValueError, match="quantity must be an integer"):
        core.add_ordered_wine(conn, wine["id"], True)

    order = core.add_ordered_wine(conn, wine["id"], 1)
    with pytest.raises(ValueError, match="quantity must be an integer"):
        core.update_ordered_wine(conn, order["id"], quantity=False)


@pytest.mark.parametrize("price", [True, "12.5"])
def test_ordered_wine_core_rejects_coerced_prices(conn, price):
    wine = add_sample_wine(conn)
    with pytest.raises(ValueError, match="price_per_bottle must be a number"):
        core.add_ordered_wine(conn, wine["id"], 1, price_per_bottle=price)


def test_ordered_wine_core_rejects_boolean_wine_id(conn):
    add_sample_wine(conn)
    with pytest.raises(ValueError, match="wine_id must be an integer"):
        core.add_ordered_wine(conn, True, 1)


def test_ordered_wine_endpoints(client):
    wine_id = client.post(
        "/api/cellar/items",
        json={"producer": "Camille Jacquet", "wine_name": "Le Mesnil", "quantity": 0},
    ).json()["id"]
    created = client.post(
        "/api/ordered-wines",
        json={
            "wine_id": wine_id,
            "quantity": 4,
            "vendor": "Importer",
            "order_reference": "A-9",
            "tracking_url": "https://www.ups.com/track?tracknum=1Z9",
        },
    )
    assert created.status_code == 201
    order_id = created.json()["id"]

    listed = client.get("/api/ordered-wines").json()
    assert [item["id"] for item in listed] == [order_id]
    assert listed[0]["producer"] == "Camille Jacquet"

    patched = client.patch(
        f"/api/ordered-wines/{order_id}",
        json={"expected_on": "2026-08-10"},
    )
    assert patched.status_code == 200
    assert patched.json()["expected_on"] == "2026-08-10"

    arrived = client.post(
        f"/api/ordered-wines/{order_id}/arrive",
        json={"arrived_on": "2026-08-09"},
    )
    assert arrived.status_code == 200
    assert arrived.json()["status"] == "arrived"
    assert client.get("/api/ordered-wines").json() == []
    assert client.get("/api/cellar").json()["summary"]["labels"]["bottles"] == 4


def test_ordered_wine_arrival_accepts_the_ui_default_payload(client):
    wine_id = client.post(
        "/api/cellar/items",
        json={"producer": "Default", "wine_name": "Arrival", "quantity": 0},
    ).json()["id"]
    order_id = client.post(
        "/api/ordered-wines", json={"wine_id": wine_id, "quantity": 1}
    ).json()["id"]

    response = client.post(
        f"/api/ordered-wines/{order_id}/arrive", json={"arrived_on": ""}
    )

    assert response.status_code == 200
    assert response.json()["status"] == "arrived"


def test_ordered_wine_endpoint_rejects_non_finite_price(client):
    wine_id = client.post(
        "/api/cellar/items",
        json={"producer": "Finite", "wine_name": "Only", "quantity": 0},
    ).json()["id"]
    response = client.post(
        "/api/ordered-wines",
        content=f'{{"wine_id":{wine_id},"quantity":1,"price_per_bottle":1e999}}',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 422


def test_ordered_wine_endpoint_rejects_boolean_quantity(client):
    wine_id = client.post(
        "/api/cellar/items",
        json={"producer": "Strict", "wine_name": "Quantity", "quantity": 0},
    ).json()["id"]
    response = client.post(
        "/api/ordered-wines", json={"wine_id": wine_id, "quantity": True}
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "overrides",
    [
        {"wine_id": True},
        {"wine_id": "1"},
        {"price_per_bottle": True},
        {"price_per_bottle": "12.5"},
    ],
)
def test_ordered_wine_endpoint_rejects_coerced_numbers(client, overrides):
    wine_id = client.post(
        "/api/cellar/items",
        json={"producer": "Strict", "wine_name": "Numbers", "quantity": 0},
    ).json()["id"]
    response = client.post(
        "/api/ordered-wines",
        json={"wine_id": wine_id, "quantity": 1, **overrides},
    )
    assert response.status_code == 422


def test_ordered_wine_mcp_rejects_coerced_numeric_arguments(conn):
    wine = add_sample_wine(conn)
    invalid_add_payloads = [
        {"wine_id": True, "quantity": 1},
        {"wine_id": str(wine["id"]), "quantity": 1},
        {"wine_id": wine["id"], "quantity": True},
        {"wine_id": wine["id"], "quantity": "1"},
        {"wine_id": wine["id"], "quantity": 1, "price_per_bottle": True},
        {"wine_id": wine["id"], "quantity": 1, "price_per_bottle": "12.5"},
        {"wine_id": wine["id"], "quantity": 1, "price_per_bottle": float("inf")},
        {"wine_id": wine["id"], "quantity": 1, "price_per_bottle": float("nan")},
        {"wine_id": wine["id"], "quantity": 1, "price_per_bottle": -1},
        {"wine_id": 0, "quantity": 1},
        {"wine_id": wine["id"], "quantity": 0},
    ]

    for payload in invalid_add_payloads:
        with pytest.raises(ToolError, match="validation error"):
            asyncio.run(mcp_server.mcp.call_tool("ordered_wine_add", payload))

    assert core.list_ordered_wines(conn) == []

    asyncio.run(
        mcp_server.mcp.call_tool(
            "ordered_wine_add",
            {"wine_id": wine["id"], "quantity": 1, "price_per_bottle": 12},
        )
    )
    order = core.list_ordered_wines(conn)[0]

    for tool_name, payload in [
        ("ordered_wine_update", {"order_id": True, "notes": "wrong row"}),
        ("ordered_wine_update", {"order_id": str(order["id"]), "notes": "wrong row"}),
        ("ordered_wine_arrived", {"order_id": True}),
        ("ordered_wine_arrived", {"order_id": str(order["id"])}),
        ("ordered_wine_list", {"include_arrived": "true"}),
    ]:
        with pytest.raises(ToolError, match="validation error"):
            asyncio.run(mcp_server.mcp.call_tool(tool_name, payload))

    assert core.get_ordered_wine(conn, order["id"])["status"] == "ordered"


@pytest.mark.parametrize(
    "payload",
    [
        {"currency": ""},
        {"currency": "US dollars"},
        {"ordered_on": "tomorrow"},
        {"expected_on": "next week"},
    ],
)
def test_ordered_wine_endpoint_rejects_invalid_metadata(client, payload):
    wine_id = client.post(
        "/api/cellar/items",
        json={"producer": "P", "wine_name": "W", "quantity": 0},
    ).json()["id"]
    response = client.post(
        "/api/ordered-wines",
        json={"wine_id": wine_id, "quantity": 1, **payload},
    )
    assert response.status_code == 422


def test_v5_schema_refuses_older_code_that_cannot_manage_event_review_links(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    path = tmp_path / "future.db"
    connection = db.open_db(path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == 5
    connection.close()

    legacy = db.connect(path)
    monkeypatch.setattr(db, "_MIGRATIONS", db._MIGRATIONS[:4])
    monkeypatch.setattr(db, "SCHEMA_VERSION", 4)
    with pytest.raises(RuntimeError, match="requires code at schema version 5 or newer"):
        db.migrate(legacy)
    legacy.close()


def test_failed_v4_migration_rolls_back_and_can_be_retried(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    path = tmp_path / "interrupted-migration.db"
    migrations = db._MIGRATIONS.copy()
    monkeypatch.setattr(db, "_MIGRATIONS", migrations[:3])
    monkeypatch.setattr(db, "SCHEMA_VERSION", 3)
    connection = db.open_db(path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == 3

    def fail_mid_migration(conn):
        conn.execute("CREATE TABLE ordered_wines (id INTEGER PRIMARY KEY)")
        raise RuntimeError("simulated index failure")

    monkeypatch.setattr(
        db,
        "_MIGRATIONS",
        [*migrations[:3], db.Migration(fail_mid_migration, min_compatible=4)],
    )
    monkeypatch.setattr(db, "SCHEMA_VERSION", 4)
    with pytest.raises(RuntimeError, match="simulated index failure"):
        db.migrate(connection)

    assert connection.execute("PRAGMA user_version").fetchone()[0] == 3
    assert (
        connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='ordered_wines'"
        ).fetchone()
        is None
    )

    monkeypatch.setattr(db, "_MIGRATIONS", migrations[:4])
    db.migrate(connection)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == 4
    connection.close()


def test_concurrent_migrations_recheck_version_after_acquiring_lock(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    path = tmp_path / "concurrent-migration.db"
    migrations = db._MIGRATIONS.copy()
    monkeypatch.setattr(db, "_MIGRATIONS", migrations[:3])
    monkeypatch.setattr(db, "SCHEMA_VERSION", 3)
    setup = db.open_db(path)
    setup.close()

    monkeypatch.setattr(db, "_MIGRATIONS", migrations[:4])
    monkeypatch.setattr(db, "SCHEMA_VERSION", 4)
    original_version = db._current_version
    first_reads = threading.Barrier(2)
    calls = threading.local()

    def synchronize_first_version_read(conn):
        version = original_version(conn)
        count = getattr(calls, "count", 0)
        calls.count = count + 1
        if count == 0:
            first_reads.wait(timeout=5)
        return version

    monkeypatch.setattr(db, "_current_version", synchronize_first_version_read)
    errors: list[Exception] = []

    def migrate() -> None:
        connection = db.connect(path)
        try:
            db.migrate(connection)
        except (sqlite3.Error, RuntimeError, threading.BrokenBarrierError) as error:
            errors.append(error)
        finally:
            connection.close()

    workers = [threading.Thread(target=migrate) for _ in range(2)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=10)

    assert all(not worker.is_alive() for worker in workers)
    assert errors == []
    verify = db.connect(path)
    assert verify.execute("PRAGMA user_version").fetchone()[0] == 4
    assert (
        verify.execute(
            "SELECT COUNT(*) FROM sqlite_master "
            "WHERE type='table' AND name='ordered_wines'"
        ).fetchone()[0]
        == 1
    )
    verify.close()
