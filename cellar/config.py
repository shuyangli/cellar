"""Data locations and runtime settings.

Everything lives outside the repository, following the local convention used by
hermes-email-workflows: ``~/.local/share/cellar/``.
"""

from __future__ import annotations

import os
from pathlib import Path


def data_dir() -> Path:
    override = os.environ.get("CELLAR_DATA_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".local" / "share" / "cellar"


def db_path() -> Path:
    return data_dir() / "cellar.db"


def photos_dir() -> Path:
    return data_dir() / "photos"


def web_host() -> str:
    return os.environ.get("CELLAR_HOST", "127.0.0.1")


def web_port() -> int:
    return int(os.environ.get("CELLAR_PORT", "8788"))
