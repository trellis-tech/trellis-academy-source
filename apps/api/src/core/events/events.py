"""Minimal Academy application lifecycle."""

from collections.abc import Callable

from config.config import LearnHouseConfig, get_learnhouse_config
from fastapi import FastAPI

from src.core.events.content import check_content_directory
from src.core.events.database import close_database, connect_to_db
from src.core.events.logs import create_logs_dir


def startup_app(app: FastAPI) -> Callable:
    async def start_app() -> None:
        learnhouse_config: LearnHouseConfig = get_learnhouse_config()
        app.learnhouse_config = learnhouse_config  # type: ignore

        # Schema installation is an explicit CLI operation. Runtime startup
        # verifies connectivity and never performs DDL or provider work.
        await connect_to_db(app, bootstrap_schema=False)
        await create_logs_dir()
        await check_content_directory()

    return start_app


def shutdown_app(app: FastAPI) -> Callable:
    async def close_app() -> None:
        await close_database(app)

    return close_app
