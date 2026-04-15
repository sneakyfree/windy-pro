"""
Unit tests for src/engine/protocol_validator.py.

Pins the WebSocket protocol contract shipped in
shared/schemas/engine-protocol.schema.json. If anyone changes the
schema (add/remove an action, rename a field, tighten a bound),
the matching test needs to update — which is the point.

No external jsonschema dep; tests run on a fresh Python env.
"""

import os
import sys
from pathlib import Path

# Ensure validation is always enabled in tests, independent of
# the user's environment.
os.environ['WINDY_VALIDATE_WS'] = '1'

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Import AFTER env var is set so the module-level _ENABLED reads true.
from src.engine.protocol_validator import (
    validate_client_message, validate_server_message, enabled,
)


def test_validator_is_enabled_when_env_var_set():
    assert enabled() is True


def test_client_start_message_valid():
    assert validate_client_message({'action': 'start'}) == []


def test_client_unknown_action_flagged():
    errs = validate_client_message({'action': 'reboot_the_moon'})
    assert any('unknown action' in e for e in errs)


def test_client_missing_action_flagged():
    errs = validate_client_message({})
    assert errs and any("action" in e for e in errs)


def test_client_non_object_flagged():
    errs = validate_client_message('not a dict')
    assert errs


def test_client_vault_get_requires_session_id():
    errs = validate_client_message({'action': 'vault_get'})
    assert any("session_id" in e for e in errs)


def test_client_vault_get_happy_path():
    assert validate_client_message({'action': 'vault_get', 'session_id': 42}) == []


def test_client_vault_get_wrong_type_flagged():
    errs = validate_client_message({'action': 'vault_get', 'session_id': 'forty-two'})
    assert any('expected type' in e for e in errs)


def test_client_vault_list_bounds():
    # limit <= 500 per schema
    assert validate_client_message({'action': 'vault_list', 'limit': 50}) == []
    errs = validate_client_message({'action': 'vault_list', 'limit': 9999})
    assert any('maximum' in e for e in errs)


def test_client_vault_search_max_length():
    errs = validate_client_message({'action': 'vault_search', 'query': 'x' * 2000})
    assert any('maxLength' in e for e in errs)


def test_client_vault_export_format_enum():
    errs = validate_client_message({'action': 'vault_export', 'session_id': 1, 'format': 'docx'})
    assert any('not in' in e for e in errs)
    # txt / md / srt are allowed
    assert validate_client_message(
        {'action': 'vault_export', 'session_id': 1, 'format': 'md'}) == []


def test_client_transcribe_blob_format_enum():
    errs = validate_client_message({'action': 'transcribe_blob', 'format': 'avi'})
    assert errs and any('not in' in e for e in errs)


# ───── Server outbound ─────────────────────────────────────────────

def test_server_state_requires_both_states():
    errs = validate_server_message({'type': 'state'})
    assert any('oldState' in e for e in errs)


def test_server_state_happy_path():
    assert validate_server_message(
        {'type': 'state', 'oldState': 'idle', 'newState': 'listening'}) == []


def test_server_health_requires_status_and_uptime():
    errs = validate_server_message({'type': 'health'})
    assert any('status' in e for e in errs)


def test_server_health_status_enum():
    errs = validate_server_message(
        {'type': 'health', 'status': 'bonkers', 'uptime_sec': 1})
    assert any('not in' in e for e in errs)


def test_server_health_happy_path():
    assert validate_server_message({
        'type': 'health', 'status': 'ok', 'uptime_sec': 12.3,
        'cold_start_ms': 420, 'model': 'base', 'device': 'cpu',
        'clients': 2, 'version': '0.3.0', 'error': None,
    }) == []


def test_server_unknown_type_flagged():
    errs = validate_server_message({'type': 'brand_new_message'})
    assert any('unknown server type' in e for e in errs)


def test_server_transcript_text_is_string():
    errs = validate_server_message({'type': 'transcript', 'text': 12345})
    assert any('expected type' in e for e in errs)


def test_server_pong_heartbeat_optional_boolean():
    # no payload → ok
    assert validate_server_message({'type': 'pong'}) == []
    # boolean → ok
    assert validate_server_message({'type': 'pong', 'heartbeat': True}) == []
    # not a boolean → error
    errs = validate_server_message({'type': 'pong', 'heartbeat': 'yes'})
    assert errs


# ───── Disabled mode ────────────────────────────────────────────────

def test_validation_is_cheap_when_disabled(monkeypatch):
    """When WINDY_VALIDATE_WS is not set, validators no-op
    immediately without reading the schema file."""
    import src.engine.protocol_validator as pv
    monkeypatch.setattr(pv, '_ENABLED', False)
    # Malformed message — would normally error — returns [] when off
    assert pv.validate_client_message('totally invalid') == []
    assert pv.validate_server_message({'type': 'nonsense'}) == []
