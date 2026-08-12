"""Retain the former AI-generation merge revision as an Academy no-op.

Revision ID: f9e8d7c6b5a4
Revises: all prior open heads in down_revision
"""

from collections.abc import Sequence

revision: str = "f9e8d7c6b5a4"
down_revision: str | Sequence[str] | None = (
    "m3b4c5d6e7f8",
    "5e3a9c7f1b2d",
    "n4o5p6q7r8s9",
    "d3e4f5a6b7c8",
    "c1d2e3f4a5b6",
    "b2c3d4e5f8a9",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
