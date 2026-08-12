from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, DateTime, Index, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class AcademyPublication(SQLModel, table=True):
    __table_args__ = (
        Index("uq_academypublication_release_tag", "release_tag", unique=True),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    receipt_uuid: str = Field(index=True, unique=True)
    status: str
    environment: str
    operator_instruction: str = Field(sa_column=Column(Text, nullable=False))
    release_tag: str
    source_commit: str
    compiled_digest: str = Field(index=True)
    readback_digest: str
    rollback_target: str
    before_state: dict = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False))
    after_state: dict = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class AcademyPublicationRead(SQLModel):
    receipt_uuid: str
    status: str
    environment: str
    release_tag: str
    source_commit: str
    compiled_digest: str
    readback_digest: str
    rollback_target: str
    created_at: datetime
