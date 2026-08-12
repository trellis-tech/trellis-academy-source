"""Retain the former billing-plan revision as an Academy no-op.

Revision ID: e9f0a1b2c3d4
Revises: u9v8w7x6y5z4, b8c9d0e1f2a3
"""

from collections.abc import Sequence

revision: str = "e9f0a1b2c3d4"
down_revision: str | Sequence[str] | None = (
    "u9v8w7x6y5z4",
    "b8c9d0e1f2a3",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
