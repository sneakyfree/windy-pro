"""
Tests for Windy Pro Vibe Toggle (Grammar Correction)
"""

import pytest
from src.engine.vibe import VibeProcessor


@pytest.fixture
def processor():
    """Create an enabled VibeProcessor."""
    return VibeProcessor({'vibe_enabled': True})


@pytest.fixture
def disabled_processor():
    """Create a disabled VibeProcessor."""
    return VibeProcessor({'vibe_enabled': False})


class TestFillerRemoval:
    def test_remove_um(self, processor):
        result = processor.process("I um think this is um great")
        assert "um" not in result.lower()
        assert "think" in result
    
    def test_remove_uh(self, processor):
        result = processor.process("uh hello uh world")
        assert "uh" not in result.lower()
        assert "hello" in result.lower()
    
    def test_remove_like(self, processor):
        result = processor.process("it was like really good")
        assert "like" not in result.lower()
    
    def test_remove_you_know(self, processor):
        result = processor.process("I was you know thinking about it")
        assert "you know" not in result.lower()


class TestGrammarCorrections:
    def test_wanna(self, processor):
        result = processor.process("I wanna go home")
        assert "want to" in result
    
    def test_gonna(self, processor):
        result = processor.process("I gonna do it")
        assert "going to" in result
    
    def test_gotta(self, processor):
        result = processor.process("I gotta leave")
        assert "got to" in result
    
    def test_cuz(self, processor):
        result = processor.process("i left cuz it was late")
        assert "because" in result


class TestPunctuation:
    def test_capitalize_first(self, processor):
        result = processor.process("hello world")
        assert result[0] == 'H'
    
    def test_add_period(self, processor):
        result = processor.process("this is a test")
        assert result.endswith('.')
    
    def test_preserve_existing_punctuation(self, processor):
        result = processor.process("is this a question?")
        assert result.endswith('?')
    
    def test_capitalize_after_period(self, processor):
        result = processor.process("hello. world")
        assert "Hello. World" in result


class TestDisabled:
    def test_disabled_passthrough(self, disabled_processor):
        text = "um i wanna like go"
        result = disabled_processor.process(text)
        assert result == text
    
    def test_empty_string(self, processor):
        assert processor.process("") == ""
    
    def test_none_handling(self, processor):
        assert processor.process(None) is None


class TestWhitespace:
    def test_collapse_spaces(self, processor):
        result = processor.process("hello    world")
        assert "  " not in result
    
    def test_no_space_before_punctuation(self, processor):
        result = processor.process("hello , world")
        assert "hello, world" in result.lower() or "Hello, world" in result
