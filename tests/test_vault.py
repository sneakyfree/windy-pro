"""
Tests for Windy Pro Prompt Vault
"""

import pytest
import tempfile
import os
from src.engine.vault import PromptVault


@pytest.fixture
def vault(tmp_path):
    """Create a fresh vault in a temp directory."""
    db_path = os.path.join(str(tmp_path), 'test_vault.db')
    v = PromptVault(db_path=db_path)
    yield v
    v.close()


class TestSessionManagement:
    """Test session CRUD operations."""
    
    def test_create_session(self, vault):
        session_id = vault.create_session()
        assert session_id is not None
        assert isinstance(session_id, int)
        assert session_id > 0
    
    def test_create_multiple_sessions(self, vault):
        id1 = vault.create_session()
        id2 = vault.create_session()
        assert id1 != id2
        assert id2 > id1
    
    def test_end_session(self, vault):
        session_id = vault.create_session()
        vault.save_segment(session_id, "hello world", 0.0, 1.0, 0.95)
        vault.end_session(session_id)
        
        session = vault.get_session(session_id)
        assert session is not None
        assert session['ended_at'] is not None
        assert session['word_count'] == 2
        assert session['duration_s'] >= 0
    
    def test_get_sessions(self, vault):
        vault.create_session()
        vault.create_session()
        vault.create_session()
        
        sessions = vault.get_sessions()
        assert len(sessions) == 3
    
    def test_get_sessions_limit(self, vault):
        for _ in range(5):
            vault.create_session()
        
        sessions = vault.get_sessions(limit=2)
        assert len(sessions) == 2
    
    def test_get_session_nonexistent(self, vault):
        result = vault.get_session(9999)
        assert result is None
    
    def test_delete_session(self, vault):
        session_id = vault.create_session()
        vault.save_segment(session_id, "test", 0, 1, 0.9)
        
        result = vault.delete_session(session_id)
        assert result is True
        
        # Verify deleted
        assert vault.get_session(session_id) is None
    
    def test_delete_nonexistent_session(self, vault):
        result = vault.delete_session(9999)
        assert result is False


class TestSegmentManagement:
    """Test segment CRUD operations."""
    
    def test_save_segment(self, vault):
        session_id = vault.create_session()
        seg_id = vault.save_segment(
            session_id, "hello world", 0.0, 1.5, 0.95
        )
        assert seg_id is not None
        assert isinstance(seg_id, int)
    
    def test_get_session_segments(self, vault):
        session_id = vault.create_session()
        vault.save_segment(session_id, "first segment", 0.0, 1.0, 0.9)
        vault.save_segment(session_id, "second segment", 1.0, 2.0, 0.85)
        vault.save_segment(session_id, "partial", 2.0, 2.5, 0.5, is_partial=True)
        
        segments = vault.get_session_segments(session_id)
        assert len(segments) == 2  # Partial excluded
        assert segments[0]['text'] == "first segment"
        assert segments[1]['text'] == "second segment"
    
    def test_segment_ordering(self, vault):
        session_id = vault.create_session()
        vault.save_segment(session_id, "late", 5.0, 6.0, 0.9)
        vault.save_segment(session_id, "early", 0.0, 1.0, 0.9)
        
        segments = vault.get_session_segments(session_id)
        assert segments[0]['text'] == "early"
        assert segments[1]['text'] == "late"
    
    def test_cascade_delete(self, vault):
        session_id = vault.create_session()
        vault.save_segment(session_id, "will be deleted", 0, 1, 0.9)
        vault.delete_session(session_id)
        
        # Segments should be gone via CASCADE
        segments = vault.get_session_segments(session_id)
        assert len(segments) == 0


class TestSearch:
    """Test full-text search."""
    
    def test_search_basic(self, vault):
        s1 = vault.create_session()
        vault.save_segment(s1, "the quick brown fox", 0, 1, 0.9)
        vault.save_segment(s1, "jumps over the lazy dog", 1, 2, 0.9)
        
        results = vault.search("fox")
        assert len(results) == 1
        assert "fox" in results[0]['text']
    
    def test_search_case_insensitive(self, vault):
        s1 = vault.create_session()
        vault.save_segment(s1, "Hello World", 0, 1, 0.9)
        
        results = vault.search("hello")
        assert len(results) == 1
    
    def test_search_no_results(self, vault):
        s1 = vault.create_session()
        vault.save_segment(s1, "hello world", 0, 1, 0.9)
        
        results = vault.search("xyz123")
        assert len(results) == 0
    
    def test_search_across_sessions(self, vault):
        s1 = vault.create_session()
        vault.save_segment(s1, "meeting about budget", 0, 1, 0.9)
        
        s2 = vault.create_session()
        vault.save_segment(s2, "budget review follow up", 0, 1, 0.9)
        
        results = vault.search("budget")
        assert len(results) == 2


class TestExport:
    """Test export functionality."""
    
    def test_export_txt(self, vault):
        s1 = vault.create_session()
        vault.save_segment(s1, "hello", 0, 1, 0.9)
        vault.save_segment(s1, "world", 1, 2, 0.9)
        
        text = vault.export_session(s1, 'txt')
        assert text == "hello world"
    
    def test_export_markdown(self, vault):
        s1 = vault.create_session()
        vault.save_segment(s1, "first segment", 0, 1, 0.9)
        
        md = vault.export_session(s1, 'md')
        assert "# Windy Pro Transcript" in md
        assert "first segment" in md
        assert "**[0:00]**" in md
    
    def test_export_nonexistent(self, vault):
        text = vault.export_session(9999)
        assert text == ''
