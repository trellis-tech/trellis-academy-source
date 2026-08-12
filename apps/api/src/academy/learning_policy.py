"""Release-one learning policy: Academy courses are enabled and unmetered."""


async def require_courses_feature() -> bool:
    return True


async def check_feature_access(*_args, **_kwargs) -> bool:
    return True


async def check_limits_with_usage(*_args, **_kwargs) -> bool:
    return True


async def increase_feature_usage(*_args, **_kwargs) -> bool:
    return True


async def decrease_feature_usage(*_args, **_kwargs) -> bool:
    return True
