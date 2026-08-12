"""Retain the secure-media migration lineage

The destructive collection-table revision was removed from the Academy graph.
This revision remains as a no-op lineage marker after secure media.

Revision ID: 7f2b9d1c3e4a
Revises: 5e3a9c7f1b2d
Create Date: 2026-06-23

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = '7f2b9d1c3e4a'
down_revision: Union[str, Sequence[str], None] = '5e3a9c7f1b2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
