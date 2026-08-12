"""Connection URL parsing used by the container readiness checks."""

import sys
from urllib.parse import urlsplit


def parse_connection_target(url: str, default_port: int) -> tuple[str, int]:
    parsed = urlsplit(url)
    if parsed.hostname is None:
        raise ValueError("Connection URL has no hostname")
    return parsed.hostname, parsed.port or default_port


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m src.core.connection_url URL DEFAULT_PORT")
    host, port = parse_connection_target(sys.argv[1], int(sys.argv[2]))
    print(f"{host} {port}")


if __name__ == "__main__":
    main()
