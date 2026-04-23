from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as wine_app


@pytest.fixture()
def client(tmp_path: Path):
    db_path = tmp_path / "test_wine_tracker.db"
    wine_app.DB_PATH = db_path
    wine_app.init_db()
    with TestClient(wine_app.app) as test_client:
        yield test_client


def create_item(client: TestClient, producer: str, wine_name: str, quantity: int = 1) -> dict:
    response = client.post(
        "/api/cellar/items",
        json={
            "producer": producer,
            "wine_name": wine_name,
            "vintage": "2022",
            "quantity": quantity,
            "location": "Rack A",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_homepage_is_cellar_focused_and_hides_management_forms(client: TestClient):
    response = client.get("/")

    assert response.status_code == 200
    html = response.text
    assert "Cellar" in html
    assert "Add a wine" not in html
    assert "Log a tasting" not in html
    assert "wishlist" not in html.lower()
    assert "Manager API" not in html
    assert "GET /api/cellar" not in html


def test_manager_api_can_create_and_list_cellar_inventory(client: TestClient):
    create_response = client.post(
        "/api/cellar/items",
        json={
            "producer": "Pierre Peters",
            "wine_name": "Cuvée de Réserve",
            "vintage": "NV",
            "country": "France",
            "region": "Champagne",
            "appellation": "Le Mesnil-sur-Oger",
            "varietal": "Chardonnay",
            "quantity": 3,
            "bottle_size_ml": 750,
            "location": "Rack A1",
            "acquired_from": "Chambers Street Wines",
            "acquired_price": 74.0,
            "drinking_window_start": "2026-01-01",
            "drinking_window_end": "2029-12-31",
            "notes": "Mineral, sharp, cellar staple",
        },
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["quantity"] == 3
    assert created["location"] == "Rack A1"

    list_response = client.get("/api/cellar")
    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload["summary"]["labels"]["bottles"] == 3
    assert len(payload["items"]) == 1
    assert payload["items"][0]["producer"] == "Pierre Peters"


def test_manager_api_can_adjust_quantity_without_using_ui_forms(client: TestClient):
    create_response = client.post(
        "/api/cellar/items",
        json={
            "producer": "Clos Cibonne",
            "wine_name": "Cuvée Tradition Rosé",
            "vintage": "2022",
            "quantity": 2,
            "location": "Shelf 2",
        },
    )
    item_id = create_response.json()["id"]

    adjust_response = client.post(
        f"/api/cellar/items/{item_id}/adjust",
        json={"delta": -1, "reason": "opened at home"},
    )

    assert adjust_response.status_code == 200
    adjusted = adjust_response.json()
    assert adjusted["quantity"] == 1
    assert adjusted["last_event_reason"] == "opened at home"

    list_response = client.get("/api/cellar")
    assert list_response.json()["summary"]["labels"]["bottles"] == 1


def test_init_db_upgrades_legacy_wines_table_with_cellar_columns(tmp_path: Path):
    db_path = tmp_path / "legacy.db"
    wine_app.DB_PATH = db_path

    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE wines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            producer TEXT NOT NULL,
            wine_name TEXT NOT NULL,
            vintage TEXT,
            country TEXT,
            region TEXT,
            appellation TEXT,
            varietal TEXT,
            source_app TEXT,
            cellartracker_wine_id TEXT,
            photo_ref TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.commit()
    conn.close()

    wine_app.init_db()

    upgraded = sqlite3.connect(db_path)
    columns = {row[1] for row in upgraded.execute("PRAGMA table_info(wines)").fetchall()}
    upgraded.close()

    assert "quantity" in columns
    assert "location" in columns
    assert "last_event_reason" in columns


def test_homepage_paginates_cellar_items_and_uses_full_width_layout(client: TestClient):
    for idx in range(1, 17):
        create_item(client, f"Producer {idx:02d}", f"Wine {idx:02d}")

    response = client.get("/?page=2&page_size=5")

    assert response.status_code == 200
    html = response.text
    assert "cellar-page" in html
    assert "Producer 06" in html
    assert "Producer 10" in html
    assert "Producer 05" not in html
    assert "Producer 11" not in html
    assert "Page 2 of 4" in html
    assert 'href="/?page=1&amp;page_size=5"' in html
    assert 'href="/?page=3&amp;page_size=5"' in html


def test_cellar_api_supports_pagination_metadata(client: TestClient):
    for idx in range(1, 14):
        create_item(client, f"Producer {idx:02d}", f"Wine {idx:02d}")

    response = client.get("/api/cellar?page=3&page_size=4")

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"] == {
        "page": 3,
        "page_size": 4,
        "total_items": 13,
        "total_pages": 4,
        "has_prev": True,
        "has_next": True,
    }
    assert [item["producer"] for item in payload["items"]] == [
        "Producer 09",
        "Producer 10",
        "Producer 11",
        "Producer 12",
    ]
