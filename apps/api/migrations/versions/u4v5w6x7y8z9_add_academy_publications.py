"""Add durable Academy publication receipts.

Revision ID: u4v5w6x7y8z9
Revises: t3r4e5l6s7s8
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "u4v5w6x7y8z9"
down_revision: Union[str, Sequence[str], None] = "t3r4e5l6s7s8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "academypublication",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("receipt_uuid", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("environment", sa.String(), nullable=False),
        sa.Column("operator_instruction", sa.Text(), nullable=False),
        sa.Column("release_tag", sa.String(), nullable=False),
        sa.Column("source_commit", sa.String(), nullable=False),
        sa.Column("compiled_digest", sa.String(), nullable=False),
        sa.Column("readback_digest", sa.String(), nullable=False),
        sa.Column("rollback_target", sa.String(), nullable=False),
        sa.Column("before_state", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("after_state", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_academypublication_compiled_digest",
        "academypublication",
        ["compiled_digest"],
    )
    op.create_index(
        "ix_academypublication_receipt_uuid",
        "academypublication",
        ["receipt_uuid"],
        unique=True,
    )
    op.create_index(
        "uq_academypublication_release_tag",
        "academypublication",
        ["release_tag"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_academypublication_release_tag", table_name="academypublication")
    op.drop_index("ix_academypublication_receipt_uuid", table_name="academypublication")
    op.drop_index("ix_academypublication_compiled_digest", table_name="academypublication")
    op.drop_table("academypublication")
