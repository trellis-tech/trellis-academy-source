import io
import importlib
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

os.environ.setdefault(
    "LEARNHOUSE_AUTH_JWT_SECRET_KEY", "test-only-secret-key-32-characters"
)
os.environ.setdefault("TESTING", "true")

from src.db.courses.assignments import AssignmentTaskSubmissionCreate
from src.db.courses.courses import AuthorWithRole as CourseAuthorWithRole
from src.db.podcasts.podcasts import AuthorWithRole as PodcastAuthorWithRole
from src.db.user_audit_events import UserAuditEvent
from src.db.users import (
    AnonymousUser,
    APITokenUser,
    PublicUser,
    SuperadminAPITokenUser,
    UserReadAuthor,
)
from src.security.api_token_utils import (
    get_authenticated_non_api_token_user,
    reject_api_token_access,
)
from src.security.csrf import CSRFProtectionMiddleware
from src.security.features_utils.dependencies import require_org_admin
from src.security.file_validation import FILE_TYPES, validate_upload
from src.security.rbac.config import RESOURCE_CONFIGS
from src.security.rbac.dependencies import require_create_access
from src.security.rbac.rbac import (
    _load_applicable_roles,
    _load_roles_for_user_target,
    authorization_verify_api_token_permissions,
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_based_on_roles_and_authorship_or_api_token,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_author,
)
from src.security.rbac.resource_access import ResourceAccessChecker
from src.security.rbac.types import AccessAction, AccessDecision
from src.security.submission_file_access import _file_owned_by_user
from src.security.submission_file_access import enforce_submission_file_access


def _public_user() -> PublicUser:
    return PublicUser(
        id=42,
        user_uuid="user_42",
        username="learner",
        first_name="Test",
        last_name="Learner",
        email="learner@example.com",
    )


@pytest.mark.asyncio
async def test_create_is_not_existing_resource_authorship() -> None:
    assert not await authorization_verify_if_user_is_author(
        MagicMock(), 42, "create", "course_x", MagicMock()
    )


@pytest.mark.asyncio
async def test_public_course_query_requires_published() -> None:
    course = MagicMock(public=True, published=True)
    course_result = MagicMock()
    course_result.scalars.return_value.first.return_value = course
    group_result = MagicMock()
    group_result.scalars.return_value.first.return_value = None
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[course_result, group_result])

    assert await authorization_verify_if_element_is_public(
        MagicMock(), "course_1", "read", db
    )

    assert course.published


def test_submission_constraint_migration_refuses_destructive_deduplication() -> None:
    migration = importlib.import_module(
        "migrations.versions.a2b3c4d5e6f7_unique_assignment_submission_rows"
    )
    bind = MagicMock()
    bind.execute.return_value.scalar_one.return_value = 1
    inspector = MagicMock()
    inspector.get_table_names.return_value = ["assignmentusersubmission"]
    inspector.get_unique_constraints.return_value = []

    with (
        patch.object(migration.op, "get_bind", return_value=bind),
        patch.object(migration.op, "create_unique_constraint") as create_constraint,
        patch.object(migration.sa, "inspect", return_value=inspector),
        pytest.raises(RuntimeError, match="duplicate"),
    ):
        migration.upgrade()

    create_constraint.assert_not_called()


def test_certificate_constraint_migration_refuses_destructive_deduplication() -> None:
    migration = importlib.import_module(
        "migrations.versions.f1a2b3c4d5e6_unique_certificateuser_user_certification"
    )
    bind = MagicMock()
    bind.execute.return_value.scalar_one.return_value = 1
    inspector = MagicMock()
    inspector.get_table_names.return_value = ["certificateuser"]
    inspector.get_unique_constraints.return_value = []

    with (
        patch.object(migration.op, "get_bind", return_value=bind),
        patch.object(migration.op, "create_unique_constraint") as create_constraint,
        patch.object(migration.sa, "inspect", return_value=inspector),
        pytest.raises(RuntimeError, match="duplicate"),
    ):
        migration.upgrade()

    create_constraint.assert_not_called()


@pytest.mark.asyncio
async def test_org_admin_dependency_rejects_api_tokens() -> None:
    token = APITokenUser(org_id=1, created_by_user_id=42)
    db = MagicMock()
    db.execute = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await require_org_admin(1, token, db)

    assert exc.value.status_code == 403
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_unpublished_public_course_does_not_fall_back_to_role() -> None:
    checker = ResourceAccessChecker(MagicMock(), MagicMock(), _public_user())
    checker._is_public_and_published = AsyncMock(return_value=(True, False))
    checker._has_linked_usergroups = AsyncMock(return_value=False)
    checker._is_resource_author = AsyncMock(return_value=False)
    checker._is_admin_or_maintainer = AsyncMock(return_value=False)
    checker._check_usergroup_membership = AsyncMock(return_value=False)

    with patch(
        "src.security.rbac.resource_access.authorization_verify_based_on_roles",
        new=AsyncMock(return_value=True),
    ):
        decision = await checker._check_public_view_read_access(
            "course_1", RESOURCE_CONFIGS["courses"]
        )

    assert not decision.allowed
    assert not decision.via_role


@pytest.mark.asyncio
async def test_ownership_required_does_not_fall_back_to_role() -> None:
    checker = ResourceAccessChecker(MagicMock(), MagicMock(), _public_user())
    checker._is_resource_author = AsyncMock(return_value=False)
    checker._is_admin_or_maintainer = AsyncMock(return_value=False)

    with patch(
        "src.security.rbac.resource_access.authorization_verify_based_on_roles",
        new=AsyncMock(return_value=True),
    ):
        decision = await checker._check_ownership_access(
            "course_1", AccessAction.UPDATE, RESOURCE_CONFIGS["courses"]
        )

    assert not decision.allowed
    assert not decision.via_role


def test_large_upload_is_rejected_before_full_read() -> None:
    upload = MagicMock()
    upload.filename = "lesson.mp4"
    upload.content_type = "video/mp4"
    upload.size = 65 * 1024 * 1024
    upload.file = io.BytesIO(b"\0\0\0\x18ftypisom")

    with pytest.raises(HTTPException) as exc:
        validate_upload(upload, ["video"])

    assert exc.value.status_code == 413


def test_audit_history_survives_user_and_org_deletion() -> None:
    org_fk = next(iter(UserAuditEvent.__table__.c.org_id.foreign_keys))
    user_fk = next(iter(UserAuditEvent.__table__.c.user_id.foreign_keys))

    assert org_fk.ondelete == "SET NULL"
    assert user_fk.ondelete == "SET NULL"
    assert UserAuditEvent.__table__.c.user_id.nullable


def test_docker_healthcheck_uses_configured_port() -> None:
    dockerfile = Path(__file__).resolve().parents[3] / "Dockerfile"
    source = dockerfile.read_text()

    assert "${LEARNHOUSE_PORT:-9000}" in source
    assert "TRELLIS_ACADEMY_RUNTIME=1" in source


def test_release_one_foundation_excludes_billing_and_seat_tracking() -> None:
    src = Path(__file__).resolve().parents[2]
    excluded = (
        src / "db" / "billing_usage.py",
        src / "db" / "organization_plan_history.py",
        src / "db" / "user_activity.py",
        src / "db" / "user_organization_membership_history.py",
        src / "db" / "course_embeddings.py",
        src / "db" / "ai" / "generations.py",
        src / "security" / "features_utils" / "active_users.py",
        src / "security" / "features_utils" / "usage.py",
    )

    assert not [path for path in excluded if path.exists()]


def test_collection_migrations_are_additive_only() -> None:
    migrations = Path(__file__).resolve().parents[3] / "migrations" / "versions"
    destructive = migrations / "d4e5f6a7b8c9_drop_collections_tables.py"
    folder_source = (migrations / "f7a8b9c0d1e2_folders_and_media.py").read_text()
    graph_sources = "\n".join(
        path.read_text()
        for path in (
            migrations / "7f2b9d1c3e4a_merge_secure_media_and_drop_collections.py",
            migrations / "f9e8d7c6b5a4_add_ai_generation_history.py",
        )
    )

    assert not destructive.exists()
    assert "op.drop_table('collectioncourse')" not in folder_source
    assert "op.drop_table('collection')" not in folder_source
    assert "d4e5f6a7b8c9" not in graph_sources


def test_excluded_billing_and_ai_revisions_are_noop_lineage_markers() -> None:
    migrations = Path(__file__).resolve().parents[3] / "migrations" / "versions"
    revision_names = (
        "c2d3e4f5a6b7_membership_history.py",
        "u9v8w7x6y5z4_add_user_activity_day.py",
        "e9f0a1b2c3d4_add_organization_plan_history.py",
        "f9e8d7c6b5a4_add_ai_generation_history.py",
        "b7c8d9e0f1a2_add_scenario_aigeneration_kind.py",
    )

    for revision_name in revision_names:
        source = (migrations / revision_name).read_text()
        assert "op.create_table" not in source
        assert "op.execute" not in source


def test_declared_upload_limits_match_in_memory_contract() -> None:
    max_in_memory = 64 * 1024 * 1024

    assert all(
        config["max_size"] <= max_in_memory for config in FILE_TYPES.values()
    )


@pytest.mark.asyncio
async def test_api_token_cannot_create_resource_without_target_org() -> None:
    token = APITokenUser(
        org_id=1,
        created_by_user_id=42,
        rights={"courses": {"action_create": True}},
    )
    checker = ResourceAccessChecker(MagicMock(), MagicMock(), token)

    decision = await checker._check_api_token_access(
        "course_x", AccessAction.CREATE, RESOURCE_CONFIGS["courses"]
    )

    assert not decision.allowed


def test_release_one_rbac_has_no_paid_enrollment_branch() -> None:
    rbac_source = (
        Path(__file__).resolve().parents[2] / "security" / "rbac" / "rbac.py"
    ).read_text()

    assert "PaymentsOffer" not in rbac_source
    assert "check_enrollment_access" not in rbac_source
    assert "PAYMENT_REQUIRED" not in rbac_source


def test_learner_submission_create_schema_excludes_server_owned_fields() -> None:
    assert set(AssignmentTaskSubmissionCreate.model_fields) == {"task_submission"}


@pytest.mark.asyncio
async def test_legacy_api_token_helper_rejects_unresolved_org() -> None:
    token = APITokenUser(
        org_id=1,
        created_by_user_id=42,
        rights={"courses": {"action_create": True}},
    )

    with (
        patch(
            "src.security.rbac.rbac.check_element_type",
            new=AsyncMock(return_value="courses"),
        ),
        patch(
            "src.security.rbac.rbac.get_element_organization_id",
            new=AsyncMock(return_value=None),
        ),
        pytest.raises(HTTPException) as exc,
    ):
        await authorization_verify_api_token_permissions(
            MagicMock(), token, "create", "course_x", MagicMock()
        )

    assert exc.value.status_code == 403


def test_session_only_guard_rejects_superadmin_api_token() -> None:
    token = SuperadminAPITokenUser(created_by_user_id=42)

    with pytest.raises(HTTPException) as exc:
        reject_api_token_access(token)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_authenticated_session_dependency_rejects_superadmin_token() -> None:
    token = SuperadminAPITokenUser(created_by_user_id=42)

    with (
        patch(
            "src.security.auth.get_authenticated_user",
            new=AsyncMock(return_value=token),
        ),
        pytest.raises(HTTPException) as exc,
    ):
        await get_authenticated_non_api_token_user(MagicMock(), MagicMock())

    assert exc.value.status_code == 403


def test_refresh_replay_cache_never_stores_successor_credentials() -> None:
    auth_source = (
        Path(__file__).resolve().parents[2] / "security" / "auth.py"
    ).read_text()

    assert "_store_refresh_grace" not in auth_source
    assert "_get_refresh_grace" not in auth_source


@pytest.mark.asyncio
async def test_top_level_creation_requires_explicit_org_policy_context() -> None:
    checker = ResourceAccessChecker(MagicMock(), MagicMock(), _public_user())
    checker._enforce_org_mfa_policy = AsyncMock()
    checker._check_create_permission = AsyncMock(
        return_value=MagicMock(allowed=True)
    )

    missing = await checker.check_access("course_x", AccessAction.CREATE)
    assert not missing.allowed

    await checker.check_access(
        "course_x", AccessAction.CREATE, target_org_id=7
    )
    checker._enforce_org_mfa_policy.assert_awaited_once_with(
        "course_x", RESOURCE_CONFIGS["courses"], 7
    )
    checker._check_create_permission.assert_awaited_once_with(
        "course_x", RESOURCE_CONFIGS["courses"], 7
    )


@pytest.mark.asyncio
async def test_role_queries_join_membership_to_its_actual_role() -> None:
    member_result = MagicMock()
    member_result.scalars.return_value.first.return_value = object()
    roles_result = MagicMock()
    roles_result.scalars.return_value.all.return_value = []
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[member_result, roles_result, roles_result])

    await _load_applicable_roles(db, 42, 7)
    applicable_statement = db.execute.await_args_list[1].args[0]
    await _load_roles_for_user_target(db, 42, [7])
    user_target_statement = db.execute.await_args_list[2].args[0]

    expected_join = "userorganization.role_id = role.id"
    assert expected_join in str(applicable_statement)
    assert expected_join in str(user_target_statement)


@pytest.mark.asyncio
async def test_create_role_check_receives_requested_organization() -> None:
    checker = ResourceAccessChecker(MagicMock(), MagicMock(), _public_user())

    with (
        patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new=AsyncMock(return_value=False),
        ) as role_check,
        patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_org_admin_status",
            new=AsyncMock(return_value=False),
        ) as admin_check,
    ):
        decision = await checker._check_create_permission(
            "course_x", RESOURCE_CONFIGS["courses"], 7
        )

    assert not decision.allowed
    assert role_check.await_args.args[-1] == 7
    assert admin_check.await_args.args[-1] == 7


def test_academy_startup_never_runs_native_auto_install() -> None:
    events = Path(__file__).resolve().parents[2] / "core" / "events"
    source = (events / "events.py").read_text()

    assert not (events / "autoinstall.py").exists()
    assert "auto_install" not in source
    assert "reconcile_pack" not in source
    assert "caption_jobs" not in source
    assert "nudges" not in source
    assert "run_ee_startup" not in source
    assert "bootstrap_schema=False" in source


def test_short_installer_validates_password_before_schema_mutation() -> None:
    cli_source = (Path(__file__).resolve().parents[3] / "cli.py").read_text()

    password_check = cli_source.index(
        'os.environ.get("LEARNHOUSE_INITIAL_ADMIN_PASSWORD")'
    )
    schema_mutation = cli_source.index("create_schema_and_stamp(sql_url)")
    assert password_check < schema_mutation


def test_fresh_schema_bootstrap_stamps_alembic_head() -> None:
    bootstrap = importlib.import_module("src.core.schema_bootstrap")
    engine = MagicMock()

    with (
        patch.object(bootstrap, "create_engine", return_value=engine),
        patch.object(bootstrap.SQLModel.metadata, "create_all") as create_all,
        patch.object(bootstrap.command, "stamp") as stamp,
        patch.object(bootstrap, "import_all_models_strict") as import_models,
    ):
        bootstrap.create_schema_and_stamp("postgresql://db:5432/academy")

    create_all.assert_called_once_with(engine)
    import_models.assert_called_once_with()
    stamp.assert_called_once()
    assert stamp.call_args.args[1] == "head"
    engine.dispose.assert_called_once()


def test_authenticated_redis_url_uses_network_host() -> None:
    parser = importlib.import_module("src.core.connection_url")
    redis_url = "redis://" + "default:credential" + "@redis.internal:6380/0"

    assert parser.parse_connection_target(
        redis_url, 6379
    ) == ("redis.internal", 6380)

    entrypoint = Path(__file__).resolve().parents[3] / "docker-entrypoint.sh"
    assert "src.core.connection_url" in entrypoint.read_text()


def test_public_author_schemas_exclude_private_account_fields() -> None:
    assert CourseAuthorWithRole.model_fields["user"].annotation is UserReadAuthor
    assert PodcastAuthorWithRole.model_fields["user"].annotation is UserReadAuthor


@pytest.mark.asyncio
async def test_legacy_public_verifier_uses_centralized_access_policy() -> None:
    with patch(
        "src.security.rbac.resource_access.ResourceAccessChecker.check_access",
        new=AsyncMock(
            return_value=AccessDecision(
                allowed=False,
                reason="restricted",
                resource_uuid="course_1",
            )
        ),
    ):
        with pytest.raises(HTTPException) as exc:
            await authorization_verify_if_element_is_public(
                MagicMock(), "course_1", "read", MagicMock()
            )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_legacy_membership_cannot_read_unpublished_course() -> None:
    with (
        patch(
            "src.security.rbac.rbac.is_user_superadmin",
            new=AsyncMock(return_value=False),
        ),
        patch(
            "src.security.rbac.rbac.authorization_verify_if_user_is_author",
            new=AsyncMock(return_value=False),
        ),
        patch(
            "src.security.rbac.rbac.authorization_verify_based_on_roles",
            new=AsyncMock(return_value=False),
        ),
        patch(
            "src.security.rbac.rbac._is_published_for_learner",
            new=AsyncMock(return_value=False),
            create=True,
        ),
        patch(
            "src.security.rbac.rbac.check_usergroup_access",
            new=AsyncMock(return_value=True),
        ) as membership_check,
        pytest.raises(HTTPException) as exc,
    ):
        await authorization_verify_based_on_roles_and_authorship(
            MagicMock(), 42, "read", "course_1", MagicMock()
        )

    assert exc.value.status_code == 403
    membership_check.assert_not_awaited()


@pytest.mark.asyncio
async def test_authenticated_chapter_lock_denies_anonymous_parent_reader() -> None:
    checker = ResourceAccessChecker(MagicMock(), MagicMock(), AnonymousUser())
    checker._resolve_parent_resource_uuid = AsyncMock(return_value="course_1")
    checker._check_read_access = AsyncMock(
        return_value=AccessDecision(
            allowed=True, reason="public course", resource_uuid="course_1"
        )
    )
    checker._get_resource = AsyncMock(
        return_value=MagicMock(lock_type="authenticated")
    )
    checker._has_linked_usergroups = AsyncMock(return_value=False)

    decision = await checker.check_access("chapter_1", AccessAction.READ)

    assert not decision.allowed


@pytest.mark.asyncio
async def test_restricted_child_without_linked_group_fails_closed() -> None:
    checker = ResourceAccessChecker(MagicMock(), MagicMock(), _public_user())
    checker._get_resource = AsyncMock(
        return_value=MagicMock(lock_type="restricted")
    )
    checker._has_linked_usergroups = AsyncMock(return_value=False)
    checker._check_usergroup_membership = AsyncMock(return_value=True)

    decision = await checker._child_lock_denial(
        "chapter_1", RESOURCE_CONFIGS["coursechapters"]
    )

    assert decision is not None
    assert not decision.allowed
    checker._check_usergroup_membership.assert_not_awaited()


@pytest.mark.asyncio
async def test_activity_inherits_containing_chapter_lock() -> None:
    checker = ResourceAccessChecker(MagicMock(), MagicMock(), AnonymousUser())
    activity = MagicMock(id=11, lock_type="public")
    chapter = MagicMock(chapter_uuid="chapter_1", lock_type="authenticated")
    checker._get_resource = AsyncMock(return_value=activity)
    checker._activity_chapters = AsyncMock(return_value=[chapter])

    decision = await checker._child_lock_denial(
        "activity_1", RESOURCE_CONFIGS["activities"]
    )

    assert decision is not None
    assert not decision.allowed


@pytest.mark.asyncio
async def test_resource_checker_rejects_superadmin_api_tokens() -> None:
    token = SuperadminAPITokenUser(id=42, created_by_user_id=7)
    checker = ResourceAccessChecker(MagicMock(), MagicMock(), token)

    decision = await checker.check_access("course_1", AccessAction.READ)

    assert not decision.allowed


@pytest.mark.asyncio
async def test_submission_files_reject_superadmin_api_tokens_before_db_lookup() -> None:
    token = SuperadminAPITokenUser(id=42, created_by_user_id=7)
    db = MagicMock()
    db.execute = AsyncMock()
    parts = [
        "orgs", "org_1", "courses", "course_1", "activities", "activity_1",
        "assignments", "assignment_1", "tasks", "task_1", "subs",
        "file_submission_user_42.pdf",
    ]

    with pytest.raises(HTTPException) as exc:
        await enforce_submission_file_access(parts, token, db)

    assert exc.value.status_code == 403
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_legacy_combined_rbac_rejects_superadmin_api_tokens() -> None:
    token = SuperadminAPITokenUser(id=42, created_by_user_id=7)
    db = MagicMock()
    db.execute = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await authorization_verify_based_on_roles_and_authorship_or_api_token(
            MagicMock(), token, "read", "course_1", db
        )

    assert exc.value.status_code == 403
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_dependency_passes_explicit_target_org() -> None:
    request = MagicMock()
    request.path_params = {"org_id": "7"}
    request.query_params = {}
    dependency = require_create_access("courses")

    with patch(
        "src.security.rbac.dependencies.ResourceAccessChecker.check_access",
        new=AsyncMock(
            return_value=AccessDecision(
                allowed=True, reason="role", resource_uuid="course_x"
            )
        ),
    ) as check_access:
        await dependency(request, MagicMock(), _public_user())

    assert check_access.await_args.kwargs["target_org_id"] == 7


@pytest.mark.asyncio
async def test_custom_domain_csrf_origin_must_match_destination_host() -> None:
    middleware = object.__new__(CSRFProtectionMiddleware)

    assert not await middleware._is_verified_custom_domain_origin(
        "https://tenant-a.example.com", "tenant-b.example.com"
    )


def test_submission_file_owner_comes_from_server_filename() -> None:
    assert _file_owned_by_user("uuid_submission_user_42.pdf", 42)
    assert not _file_owned_by_user("uuid_submission_user_7.pdf", 42)


@pytest.mark.asyncio
async def test_api_token_creation_validates_explicit_target_org() -> None:
    token = APITokenUser(
        org_id=7,
        created_by_user_id=42,
        rights={"courses": {"action_create": True}},
    )
    checker = ResourceAccessChecker(MagicMock(), MagicMock(), token)

    allowed = await checker.check_access(
        "course_x", AccessAction.CREATE, target_org_id=7
    )
    denied = await checker.check_access(
        "course_x", AccessAction.CREATE, target_org_id=8
    )

    assert allowed.allowed
    assert not denied.allowed
