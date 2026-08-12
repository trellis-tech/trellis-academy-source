"""Retain the former active-seat revision as an Academy no-op.

Revision ID: u9v8w7x6y5z4
Revises: a2b3c4d5e6f7, r5s6t7u8v9w0
"""

from collections.abc import Sequence

revision: str = "u9v8w7x6y5z4"
down_revision: str | Sequence[str] | None = (
    "a2b3c4d5e6f7",
    "r5s6t7u8v9w0",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
