"""Minimal application lifecycle for the Academy launch runtime."""

from collections.abc import Callable

from fastapi import FastAPI

from config.config import LearnHouseConfig, get_learnhouse_config
from src.core.events.content import check_content_directory
from src.core.events.database import close_database, connect_to_db
from src.core.events.logs import create_logs_dir


def academy_startup_app(app: FastAPI) -> Callable:
    async def start_app() -> None:
        config: LearnHouseConfig = get_learnhouse_config()
        app.learnhouse_config = config  # type: ignore[attr-defined]
        await connect_to_db(app, bootstrap_schema=False)
        await create_logs_dir()
        await check_content_directory()

    return start_app


def academy_shutdown_app(app: FastAPI) -> Callable:
    async def close_app() -> None:
        await close_database(app)

    return close_app
