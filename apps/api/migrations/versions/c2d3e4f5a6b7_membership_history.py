"""Retain the former billing-membership revision as an Academy no-op.

Revision ID: c2d3e4f5a6b7
Revises: b1n2u3d4g5e6
"""

from collections.abc import Sequence

revision: str = "c2d3e4f5a6b7"
down_revision: str | Sequence[str] | None = "b1n2u3d4g5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
