import sqlite3
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cellar import config, core, db
from cellar.web import app


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
    ready = add_sample_wine(conn, producer="A", wine_name="Ready",
                            drinking_window_start="2020", drinking_window_end="2030")
    approaching = add_sample_wine(conn, producer="B", wine_name="Approaching",
                                  drinking_window_start="2035", drinking_window_end="2045")
    past = add_sample_wine(conn, producer="C", wine_name="Past",
                           drinking_window_start="2010", drinking_window_end="2015")
    none = add_sample_wine(conn, producer="D", wine_name="NoWindow")
    for wine in (ready, approaching, past, none):
        core.log_purchase(conn, wine["id"], 1)
    alerts = core.drinking_window_alerts(conn)
    assert [w["wine_name"] for w in alerts["ready"]] == ["Ready"]
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


def test_delete_purchase_removes_bottles(conn):
    wine = add_sample_wine(conn)
    wine = core.log_purchase(conn, wine["id"], 3)
    purchase_id = wine["purchases"][0]["id"]
    wine = core.delete_purchase(conn, purchase_id)
    assert wine["quantity"] == 0
    assert wine["purchases"] == []
    assert wine["events"] == []


def test_delete_purchase_blocked_when_bottles_consumed(conn):
    wine = add_sample_wine(conn)
    wine = core.log_purchase(conn, wine["id"], 1)
    core.log_tasting(conn, wine["id"], rating=90)
    with pytest.raises(ValueError, match="already consumed"):
        core.delete_purchase(conn, wine["purchases"][0]["id"])


def test_delete_wine_cascades_including_photos(conn, tmp_path: Path):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 2)
    core.log_tasting(conn, wine["id"], rating=90)
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


def test_assign_initials_disambiguates_collisions():
    # Distinct first letters stay single letters.
    assert core.assign_initials(["Shuyang", "Alex"]) == {"Shuyang": "S", "Alex": "A"}
    # A colliding name forces both to grow only as far as they must.
    assert core.assign_initials(["Shuyang", "Alex", "Sam"]) == {
        "Shuyang": "Sh",
        "Alex": "A",
        "Sam": "Sa",
    }
    # A name that is a prefix of another keeps its whole self; the longer grows.
    assert core.assign_initials(["Sam", "Samuel"]) == {"Sam": "Sam", "Samuel": "Samu"}
    # Case differences must not read as distinct people.
    assert core.assign_initials(["shuyang", "Sam"]) == {"shuyang": "Sh", "Sam": "Sa"}
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


def test_new_reviewer_shifts_initials_of_colliding_name(conn):
    wine = add_sample_wine(conn)
    core.log_purchase(conn, wine["id"], 2)
    core.log_tasting(conn, wine["id"], user="Shuyang", rating=89)
    assert core.get_wine(conn, wine["id"])["ratings"][0]["initials"] == "S"

    core.log_tasting(conn, wine["id"], user="Sam", rating=85)
    rendered = {e["user_name"]: e["initials"] for e in core.get_wine(conn, wine["id"])["ratings"]}
    assert rendered == {"Shuyang": "Sh", "Sam": "Sa"}


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
