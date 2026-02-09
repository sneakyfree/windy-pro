"""
Windy Pro - Local Prompt Vault
SQLite-based storage for transcription sessions and segments.

DNA Strand: A4.4 (local mode) / FEAT-017
"""

import sqlite3
import os
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any


class PromptVault:
    """Local SQLite vault for persisting transcription sessions."""
    
    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            db_path = os.path.join(str(Path.home()), '.windy-pro', 'vault.db')
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        
        self.db_path = db_path
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._init_schema()
    
    def _init_schema(self):
        """Create tables if not exists."""
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                ended_at TEXT,
                duration_s REAL DEFAULT 0,
                word_count INTEGER DEFAULT 0,
                title TEXT
            );
            
            CREATE TABLE IF NOT EXISTS segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                start_time REAL NOT NULL,
                end_time REAL NOT NULL,
                confidence REAL DEFAULT 0,
                is_partial INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_segments_session 
                ON segments(session_id);
            CREATE INDEX IF NOT EXISTS idx_segments_text 
                ON segments(text);
        """)
        self._conn.commit()
    
    # ═════════════════════════════════
    #  Session Management
    # ═════════════════════════════════
    
    def create_session(self) -> int:
        """Create a new session. Returns session ID."""
        cursor = self._conn.execute(
            "INSERT INTO sessions (started_at) VALUES (datetime('now'))"
        )
        self._conn.commit()
        return cursor.lastrowid
    
    def end_session(self, session_id: int):
        """Mark a session as ended and calculate duration."""
        self._conn.execute("""
            UPDATE sessions SET 
                ended_at = datetime('now'),
                duration_s = (julianday(datetime('now')) - julianday(started_at)) * 86400,
                word_count = (
                    SELECT COALESCE(SUM(LENGTH(text) - LENGTH(REPLACE(text, ' ', '')) + 1), 0)
                    FROM segments WHERE session_id = ? AND is_partial = 0
                )
            WHERE id = ?
        """, (session_id, session_id))
        self._conn.commit()
    
    def get_sessions(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """Get recent sessions, newest first."""
        rows = self._conn.execute("""
            SELECT s.*, 
                   (SELECT text FROM segments WHERE session_id = s.id AND is_partial = 0 
                    ORDER BY start_time LIMIT 1) as preview
            FROM sessions s
            ORDER BY s.started_at DESC
            LIMIT ? OFFSET ?
        """, (limit, offset)).fetchall()
        return [dict(r) for r in rows]
    
    def get_session(self, session_id: int) -> Optional[Dict[str, Any]]:
        """Get a single session with its segments."""
        row = self._conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not row:
            return None
        
        session = dict(row)
        session['segments'] = self.get_session_segments(session_id)
        return session
    
    def delete_session(self, session_id: int) -> bool:
        """Delete a session and all its segments."""
        cursor = self._conn.execute(
            "DELETE FROM sessions WHERE id = ?", (session_id,)
        )
        self._conn.commit()
        return cursor.rowcount > 0
    
    # ═════════════════════════════════
    #  Segment Management
    # ═════════════════════════════════
    
    def save_segment(self, session_id: int, text: str, start_time: float,
                     end_time: float, confidence: float = 0, 
                     is_partial: bool = False) -> int:
        """Save a transcription segment. Returns segment ID."""
        cursor = self._conn.execute("""
            INSERT INTO segments (session_id, text, start_time, end_time, confidence, is_partial)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (session_id, text, start_time, end_time, confidence, int(is_partial)))
        self._conn.commit()
        return cursor.lastrowid
    
    def get_session_segments(self, session_id: int) -> List[Dict[str, Any]]:
        """Get all non-partial segments for a session, ordered by time."""
        rows = self._conn.execute("""
            SELECT * FROM segments 
            WHERE session_id = ? AND is_partial = 0
            ORDER BY start_time
        """, (session_id,)).fetchall()
        return [dict(r) for r in rows]
    
    # ═════════════════════════════════
    #  Search & Export
    # ═════════════════════════════════
    
    def search(self, query: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Full-text search across all segments."""
        rows = self._conn.execute("""
            SELECT seg.*, ses.started_at as session_date
            FROM segments seg
            JOIN sessions ses ON seg.session_id = ses.id
            WHERE seg.text LIKE ? AND seg.is_partial = 0
            ORDER BY seg.created_at DESC
            LIMIT ?
        """, (f'%{query}%', limit)).fetchall()
        return [dict(r) for r in rows]
    
    def export_session(self, session_id: int, format: str = 'txt') -> str:
        """Export a session as text or markdown."""
        session = self.get_session(session_id)
        if not session:
            return ''
        
        segments = session.get('segments', [])
        
        if format == 'md':
            lines = [f"# Windy Pro Transcript"]
            lines.append(f"**Date:** {session['started_at']}")
            lines.append(f"**Duration:** {session.get('duration_s', 0):.0f}s")
            lines.append(f"**Words:** {session.get('word_count', 0)}")
            lines.append("")
            lines.append("---")
            lines.append("")
            for seg in segments:
                mins = int(seg['start_time'] // 60)
                secs = int(seg['start_time'] % 60)
                lines.append(f"**[{mins}:{secs:02d}]** {seg['text']}")
            return '\n'.join(lines)
        else:  # txt
            return ' '.join(seg['text'] for seg in segments)
    
    def close(self):
        """Close the database connection."""
        if self._conn:
            self._conn.close()
            self._conn = None
