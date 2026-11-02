"""Build a legacy data root whose SQLite database still has a non-empty WAL.

The fixture writes committed documents through ``kb_mcp_lite`` (the same code
the runtime ships) and then exits with ``os._exit(0)`` so no ``close()`` /
checkpoint runs: a WAL writer holds ``-wal``/``-shm`` sidecars that outlive
the process. That is exactly the state a user leaves behind after a crash or
a kill, and the upgrade must not lose those writes when it moves the root.

Run with the kbmcp venv python (``kbmcp/.venv/Scripts/python.exe``); the
drill passes HOME/USERPROFILE at a sandbox and PYTHONIOENCODING=utf-8.

Usage: wal_fixture.py <data_root> [--vault NAME] [--docs N]
Prints one JSON object on stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SRC_DIR = REPO_ROOT / "kbmcp" / "src"
sys.path.insert(0, str(SRC_DIR))

from kb_mcp_lite.schema import Document  # noqa: E402
from kb_mcp_lite.store.sqlite import SqliteStore  # noqa: E402
from kb_mcp_lite.vault import VaultManager  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root")
    parser.add_argument("--vault", default="default")
    parser.add_argument("--docs", type=int, default=3)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)

    manager = VaultManager(root)
    names = [vault.name for vault in manager.list_vaults()]
    if args.vault not in names:
        manager.create(args.vault)
    manager.switch(args.vault)
    db_path = manager.resolve_path(args.vault)

    store = SqliteStore(db_path, embedder=None, auto_start_worker=False)
    titles = []
    for index in range(args.docs):
        title = f"Wal Fixture Document {index + 1}"
        doc_id = f"wal-fixture-document-{index + 1}"
        store.add(Document(id=doc_id, type="lesson", title=title, body=f"{title} body"))
        titles.append(title)
    rows = store.list(limit=1000)

    wal_path = Path(str(db_path) + "-wal")
    shm_path = Path(str(db_path) + "-shm")
    report = {
        "root": str(root),
        "vault": args.vault,
        "db_path": str(db_path),
        "inserted": len(titles),
        "documents": len(rows),
        "wal_path": str(wal_path),
        "wal_bytes": wal_path.stat().st_size if wal_path.exists() else 0,
        "shm_bytes": shm_path.stat().st_size if shm_path.exists() else 0,
        "jobs": [],
    }
    print(json.dumps(report))
    sys.stdout.flush()
    sys.stderr.flush()
    # Skip SqliteStore.close(): closing checkpoints (and truncates) the WAL.
    os._exit(0)
    return 0


if __name__ == "__main__":
    sys.exit(main())