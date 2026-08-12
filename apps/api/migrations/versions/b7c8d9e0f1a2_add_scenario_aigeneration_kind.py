"""Retain the former AI-generation enum revision as an Academy no-op.

Revision ID: b7c8d9e0f1a2
Revises: f9e8d7c6b5a4
"""

from collections.abc import Sequence

revision: str = "b7c8d9e0f1a2"
down_revision: str | Sequence[str] | None = "f9e8d7c6b5a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
