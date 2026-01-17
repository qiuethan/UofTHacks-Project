"""
SQLite database operations for Avatar storage
"""

import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
from contextlib import contextmanager

DB_PATH = Path("./data/avatars.db")


def get_db_path() -> Path:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return DB_PATH


@contextmanager
def get_connection():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    """Initialize database tables"""
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS avatars (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sprite_path TEXT,
                color TEXT NOT NULL DEFAULT '#000000',
                bio TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_avatars_name ON avatars(name)")
        conn.commit()


# ============================================================================
# CRUD Operations
# ============================================================================

def create_avatar(name: str, color: str = "#000000", bio: Optional[str] = None) -> dict:
    """Create a new avatar"""
    avatar_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO avatars (id, name, color, bio, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (avatar_id, name, color, bio, now, now)
        )
        conn.commit()
    
    return get_avatar_by_id(avatar_id)


def get_avatar_by_id(avatar_id: str) -> Optional[dict]:
    """Get avatar by ID"""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM avatars WHERE id = ?", (avatar_id,)
        ).fetchone()
        return dict(row) if row else None


def get_all_avatars() -> list[dict]:
    """Get all avatars"""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM avatars ORDER BY created_at DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def update_avatar(avatar_id: str, name: Optional[str] = None, 
                  color: Optional[str] = None, bio: Optional[str] = None) -> Optional[dict]:
    """Update avatar fields"""
    existing = get_avatar_by_id(avatar_id)
    if not existing:
        return None
    
    updates = []
    values = []
    
    if name is not None:
        updates.append("name = ?")
        values.append(name)
    if color is not None:
        updates.append("color = ?")
        values.append(color)
    if bio is not None:
        updates.append("bio = ?")
        values.append(bio)
    
    if not updates:
        return existing
    
    updates.append("updated_at = ?")
    values.append(datetime.utcnow().isoformat())
    values.append(avatar_id)
    
    with get_connection() as conn:
        conn.execute(
            f"UPDATE avatars SET {', '.join(updates)} WHERE id = ?",
            values
        )
        conn.commit()
    
    return get_avatar_by_id(avatar_id)


def update_avatar_sprite(avatar_id: str, sprite_path: str) -> Optional[dict]:
    """Update avatar sprite path"""
    with get_connection() as conn:
        conn.execute(
            "UPDATE avatars SET sprite_path = ?, updated_at = ? WHERE id = ?",
            (sprite_path, datetime.utcnow().isoformat(), avatar_id)
        )
        conn.commit()
    return get_avatar_by_id(avatar_id)


def delete_avatar(avatar_id: str) -> bool:
    """Delete avatar by ID"""
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM avatars WHERE id = ?", (avatar_id,))
        conn.commit()
        return cursor.rowcount > 0
