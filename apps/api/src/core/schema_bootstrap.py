"""Explicit fresh-database bootstrap for the Academy CLI."""

import importlib
import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlmodel import SQLModel


def import_all_models_strict() -> None:
    """Populate SQLModel metadata from every vendored database model."""
    api_root = Path(__file__).resolve().parents[2]
    model_root = api_root / "src" / "db"
    for root, dirs, files in os.walk(model_root):
        dirs.sort()
        for filename in sorted(files):
            if not filename.endswith(".py") or filename == "__init__.py":
                continue
            relative = Path(root).relative_to(api_root).with_suffix("")
            module = ".".join((*relative.parts, filename[:-3]))
            importlib.import_module(module)


def create_schema_and_stamp(sql_url: str) -> None:
    """Create the current schema and mark the matching Alembic head applied."""
    import_all_models_strict()
    sync_url = sql_url.replace("+asyncpg", "")
    engine = create_engine(sync_url, echo=False, pool_pre_ping=True)
    try:
        SQLModel.metadata.create_all(engine)
    finally:
        engine.dispose()

    api_root = Path(__file__).resolve().parents[2]
    alembic_config = Config(str(api_root / "alembic.ini"))
    alembic_config.set_main_option("script_location", str(api_root / "migrations"))
    alembic_config.set_main_option("sqlalchemy.url", sync_url.replace("%", "%%"))
    command.stamp(alembic_config, "head")
