"""Add unique constraints on assignment submission rows

A learner has exactly one AssignmentUserSubmission per (user, assignment) and one
AssignmentTaskSubmission per (user, task) — retries reset the row in place. Without
DB constraints, two concurrent submit / save-progress requests could each pass the
"does a row already exist?" SELECT and both INSERT, producing duplicate rows that
split grading and double-fire webhooks.

Refuses to add the constraints while duplicate rows exist. Submission rows
contain learner answers and grades, so choosing one row automatically would
destroy evidence. Operators must reconcile any reported duplicate groups
before retrying the migration.

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TARGETS = [
    ('assignmentusersubmission', 'uq_assignmentusersubmission_user_assignment',
     ['user_id', 'assignment_id']),
    ('assignmenttasksubmission', 'uq_assignmenttasksubmission_user_task',
     ['user_id', 'assignment_task_id']),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, constraint, cols in _TARGETS:
        if table not in inspector.get_table_names():
            continue
        existing = {uc['name'] for uc in inspector.get_unique_constraints(table)}
        if constraint in existing:
            continue
        a, b = cols
        duplicate_groups = bind.execute(
            sa.text(
                f"""
                SELECT COUNT(*)
                FROM (
                    SELECT {a}, {b}
                    FROM {table}
                    GROUP BY {a}, {b}
                    HAVING COUNT(*) > 1
                ) duplicate_keys
                """
            )
        ).scalar_one()
        if duplicate_groups:
            raise RuntimeError(
                f"Cannot add {constraint}: found {duplicate_groups} duplicate "
                f"{table} ({a}, {b}) group(s); reconcile them before retrying"
            )
        op.create_unique_constraint(constraint, table, cols)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, constraint, _cols in _TARGETS:
        if table not in inspector.get_table_names():
            continue
        existing = {uc['name'] for uc in inspector.get_unique_constraints(table)}
        if constraint in existing:
            op.drop_constraint(constraint, table, type_='unique')
