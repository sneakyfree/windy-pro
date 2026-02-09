"""
Tests for Windy Pro Transcriber
"""

import pytest
import numpy as np
from unittest.mock import MagicMock, patch, PropertyMock
from src.engine.transcriber import StreamingTranscriber, TranscriberConfig, TranscriptionState


class TestTranscriberConfig:
    """Test configuration dataclass."""
    
    def test_default_config(self):
        config = TranscriberConfig()
        assert config.model_size == "base"
        assert config.device == "auto"
        assert config.language == "en"
        assert config.compute_type == "auto"
    
    def test_custom_config(self):
        config = TranscriberConfig(
            model_size="large-v3",
            device="cuda",
            language="ja",
            compute_type="float16"
        )
        assert config.model_size == "large-v3"
        assert config.device == "cuda"
        assert config.language == "ja"


class TestTranscriptionState:
    """Test state machine."""
    
    def test_states_exist(self):
        assert TranscriptionState.IDLE
        assert TranscriptionState.LISTENING
        assert TranscriptionState.BUFFERING
        assert TranscriptionState.ERROR
    
    def test_state_values(self):
        assert TranscriptionState.IDLE.value == "idle"
        assert TranscriptionState.LISTENING.value == "listening"


class TestStreamingTranscriber:
    """Test the streaming transcriber."""
    
    def test_init(self):
        config = TranscriberConfig()
        transcriber = StreamingTranscriber(config)
        assert transcriber.state == TranscriptionState.IDLE
        assert transcriber.config == config
    
    def test_state_callbacks(self):
        config = TranscriberConfig()
        transcriber = StreamingTranscriber(config)
        
        states = []
        def on_change(old, new):
            states.append((old.value, new.value))
        
        transcriber.on_state_change(on_change)
        transcriber._set_state(TranscriptionState.LISTENING)
        
        assert len(states) == 1
        assert states[0] == ("idle", "listening")
    
    def test_transcript_callbacks(self):
        config = TranscriberConfig()
        transcriber = StreamingTranscriber(config)
        
        segments = []
        transcriber.on_transcript(lambda seg: segments.append(seg))
        
        # Simulate a transcript segment
        from src.engine.transcriber import TranscriptionSegment
        seg = TranscriptionSegment(
            text="hello world",
            start_time=0.0,
            end_time=1.5,
            confidence=0.95,
            is_partial=False,
            words=[]
        )
        transcriber._emit_segment(seg)
        
        assert len(segments) == 1
        assert segments[0].text == "hello world"
    
    def test_feed_audio_without_model(self):
        """feed_audio should handle gracefully when no model loaded."""
        config = TranscriberConfig()
        transcriber = StreamingTranscriber(config)
        # Should not crash
        audio = np.zeros(1600, dtype=np.int16).tobytes()
        transcriber.feed_audio(audio)
    
    def test_start_stop_session(self):
        """Session start/stop changes state."""
        config = TranscriberConfig()
        transcriber = StreamingTranscriber(config)
        
        transcriber.start_session()
        assert transcriber.state == TranscriptionState.LISTENING
        
        result = transcriber.stop_session()
        assert transcriber.state == TranscriptionState.IDLE
        assert isinstance(result, str)
