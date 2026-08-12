import asyncio
import json
import sys

from sqlalchemy import func
from sqlmodel import select

from src.core.events.database import _async_session_factory
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trellis_identities import TrellisIdentity


async def main(subject: str) -> None:
    async with _async_session_factory() as session:
        user_id = (
            await session.execute(
                select(TrellisIdentity.user_id).where(
                    TrellisIdentity.trellis_subject == subject
                )
            )
        ).scalar_one()
        runs = (
            await session.execute(
                select(func.count()).select_from(TrailRun).where(TrailRun.user_id == user_id)
            )
        ).scalar_one()
        steps = (
            await session.execute(
                select(func.count()).select_from(TrailStep).where(TrailStep.user_id == user_id)
            )
        ).scalar_one()
    print(json.dumps({"runs": runs, "steps": steps}))


asyncio.run(main(sys.argv[1]))
