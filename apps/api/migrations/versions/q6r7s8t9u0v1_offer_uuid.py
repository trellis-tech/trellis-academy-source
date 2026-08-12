"""Retain legacy payments tables until a transactional conversion exists

Revision ID: q6r7s8t9u0v1
Revises: 0314ec7791e1, m3b4c5d6e7f8
Create Date: 2026-02-28 00:00:00.000000
"""
from typing import Sequence, Union

revision: str = 'q6r7s8t9u0v1'
down_revision: Union[str, tuple] = ('0314ec7791e1', 'm3b4c5d6e7f8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The historical one-shot converter does not record a durable per-row
    # migration marker, so this revision cannot prove that dropping these
    # tables is safe. Retain them until a later migration can convert and
    # validate the data transactionally.
    pass


def downgrade() -> None:
    pass
