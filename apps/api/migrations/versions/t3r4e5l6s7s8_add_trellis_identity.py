"""Map immutable Trellis subjects to Academy learners.

Revision ID: t3r4e5l6s7s8
Revises: c2d3e4f5a6b7
Create Date: 2026-08-11 13:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "t3r4e5l6s7s8"
down_revision: str | Sequence[str] | None = "c2d3e4f5a6b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "trellisidentity",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("trellis_subject", sa.String(length=36), nullable=False),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("trellis_subject"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(
        "ix_trellisidentity_trellis_subject",
        "trellisidentity",
        ["trellis_subject"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_trellisidentity_trellis_subject",
        table_name="trellisidentity",
    )
    op.drop_table("trellisidentity")
