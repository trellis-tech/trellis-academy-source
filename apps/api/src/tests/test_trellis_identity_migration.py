from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_trellis_identity_migration_is_in_the_single_head_chain() -> None:
    api_root = Path(__file__).parents[2]
    script = ScriptDirectory.from_config(Config(api_root / "alembic.ini"))

    head = script.get_current_head()
    assert head == "u4v5w6x7y8z9"

    migration = script.get_revision("t3r4e5l6s7s8")
    assert migration is not None
    source = Path(migration.path).read_text()
    assert '"trellisidentity"' in source
    assert '"trellis_subject"' in source
    assert 'sa.ForeignKey("user.id", ondelete="CASCADE")' in source


def test_alembic_environment_does_not_load_runtime_auth_configuration() -> None:
    api_root = Path(__file__).parents[2]
    source = (api_root / "migrations" / "env.py").read_text()

    assert "get_learnhouse_config" not in source
    assert 'os.environ.get("LEARNHOUSE_SQL_CONNECTION_STRING")' in source
