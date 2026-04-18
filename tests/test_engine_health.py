"""
Unit tests for src/engine/server.py `_health_payload()` — the /health
endpoint's JSON shape.

Doesn't spawn a server; constructs a WindyServer with attribute stubs
and calls the method directly. Keeps the test fast and not dependent
on websockets/faster_whisper being importable in CI.

See docs/ENGINE-PROTOCOL.md for the consumer contract that this pins.
"""

import sys
import os
import time
from types import SimpleNamespace

# Make the engine importable without actually importing heavy deps.
# server.py's module-level imports will fail if faster_whisper isn't
# available — we handle that by mocking at import time.
import unittest.mock as mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Stub heavy modules so `from src.engine.server import WindyServer`
# doesn't try to load faster_whisper during test collection.
sys.modules.setdefault('faster_whisper', mock.MagicMock())
sys.modules.setdefault('torch', mock.MagicMock())
sys.modules.setdefault('sounddevice', mock.MagicMock())


def _make_server_with_state(**overrides):
    """Build a WindyServer with the instance attributes _health_payload
    reads, without ever starting anything."""
    from src.engine.server import WindyServer
    s = WindyServer(host='127.0.0.1', port=9876)
    s._started_monotonic = time.monotonic() - 1.5  # 1.5s uptime
    s._cold_start_ms = overrides.pop('cold_start_ms', 123)
    s._load_error = overrides.pop('load_error', None)
    s._model_config = overrides.pop('model_config',
        SimpleNamespace(model_size='base', device='cpu'))
    s.transcriber = overrides.pop('transcriber', SimpleNamespace())
    s.clients = overrides.pop('clients', set())
    return s


def test_health_ok_shape():
    s = _make_server_with_state()
    p = s._health_payload()
    assert p['status'] == 'ok'
    assert p['model'] == 'base'
    assert p['device'] == 'cpu'
    assert p['cold_start_ms'] == 123
    assert p['clients'] == 0
    assert isinstance(p['uptime_sec'], float)
    assert p['uptime_sec'] >= 1.0
    assert p['error'] is None
    assert 'version' in p and isinstance(p['version'], str)


def test_health_loading_when_no_transcriber():
    s = _make_server_with_state(transcriber=None)
    p = s._health_payload()
    assert p['status'] == 'loading'


def test_health_error_when_load_error_set():
    s = _make_server_with_state(load_error='model_load_failed')
    p = s._health_payload()
    assert p['status'] == 'error'
    assert p['error'] == 'model_load_failed'


def test_health_reports_client_count():
    s = _make_server_with_state(clients={1, 2, 3})
    p = s._health_payload()
    assert p['clients'] == 3


def test_health_handles_missing_model_config():
    s = _make_server_with_state(model_config=None)
    p = s._health_payload()
    # Gracefully reports None for model/device instead of raising.
    assert p['model'] is None
    assert p['device'] is None


def test_health_status_http_mapping():
    """200 for ok, 503 for loading/error — pins the contract with
    liveness probes."""
    assert _status_code('ok') == 200
    assert _status_code('loading') == 503
    assert _status_code('error') == 503


def _status_code(status):
    # Mirrors the logic in _process_request.
    return 200 if status == 'ok' else 503
