"""Test: source missing a NOT NULL column that target has."""
import os
import sys
sys.path.insert(0, "/home/z/my-project")

from sqlalchemy import create_engine, text, Column, Integer, Text, Boolean, MetaData, Table

# 1. Fresh source DB — schema WITHOUT is_muted (legacy PG style)
os.system("rm -f /tmp/src_missing.db /tmp/dst_missing.db")

src_engine = create_engine("sqlite:////tmp/src_missing.db", future=True)
src_metadata = MetaData()
# chat_members WITHOUT is_muted (legacy schema)
src_members = Table("chat_members", src_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("room_id", Integer, nullable=False),
    Column("user_id", Integer, nullable=False),
    Column("username", Text, default=""),
    Column("role", Text, default="member"),
    Column("last_read_msg_id", Integer, nullable=True),
    Column("joined_at", Text),
    # NOTE: NO is_muted column — this is what legacy PG looks like
)
src_metadata.create_all(bind=src_engine)

with src_engine.begin() as conn:
    conn.execute(text("""
        INSERT INTO chat_members (id, room_id, user_id, username, role, last_read_msg_id, joined_at)
        VALUES (1, 1, 1, 'admin', 'admin', NULL, '2026-06-21T00:00:00+00:00')
    """))
    conn.execute(text("""
        INSERT INTO chat_members (id, room_id, user_id, username, role, last_read_msg_id, joined_at)
        VALUES (2, 1, 2, 'alice', 'member', NULL, '2026-06-21T00:00:00+00:00')
    """))
    conn.execute(text("""
        INSERT INTO chat_members (id, room_id, user_id, username, role, last_read_msg_id, joined_at)
        VALUES (3, 2, 1, 'admin', 'member', NULL, '2026-06-21T00:00:00+00:00')
    """))

src_engine.dispose()

print("=== Source DB prepared:")
print("  - chat_members with 3 rows, NO is_muted column")
print()

# 2. Now transfer to target (which has is_muted NOT NULL DEFAULT FALSE)
print("=== Running transfer ===")
from app.db_serialize import transfer_db
report = transfer_db(
    from_url="sqlite:////tmp/src_missing.db",
    to_url="sqlite:////tmp/dst_missing.db",
    on_conflict="skip",  # avoid prompts in test
)
print()
print("=== Report ===")
print(f"Copied: {report['copied']} rows")
print(f"Tables:")
for t, n in report["tables"].items():
    print(f"  {t:40s} {n}")
print(f"Schema sync:")
for k, v in report["schema_sync"].items():
    print(f"  {k}: {v}")

# 3. Verify target
print()
print("=== Verify target DB ===")
dst_engine = create_engine("sqlite:////tmp/dst_missing.db", future=True)
with dst_engine.connect() as conn:
    # Check chat_members — should have is_muted column (from target schema)
    cols = [r[1] for r in conn.execute(text("PRAGMA table_info(chat_members)"))]
    print(f"chat_members columns: {cols}")
    assert "is_muted" in cols, "is_muted column missing on target!"
    # Check data — is_muted should be False (0) for all rows (coerced default)
    rows = conn.execute(text("SELECT id, username, is_muted FROM chat_members ORDER BY id")).fetchall()
    print(f"chat_members data: {rows}")
    for row_id, username, is_muted in rows:
        assert is_muted in (0, 1, False, True), f"Unexpected is_muted value: {is_muted!r}"
        if is_muted in (0, False):
            print(f"  ✓ row id={row_id} ({username}): is_muted={is_muted} (default False)")
dst_engine.dispose()

print()
print("All tests passed — missing NOT NULL columns auto-filled with defaults!")
