"""
Lightweight WebSocket protocol validator.

Reads shared/schemas/engine-protocol.schema.json and validates
inbound client commands against the `clientActions` map. Inbound
validation is gated on `WINDY_VALIDATE_WS=1` — OFF by default in
production, ON in dev/CI so drift between client and server
surfaces immediately.

No jsonschema dependency. A full Draft-2020-12 validator is
overkill for a message format this small; we implement the subset
of features the schema actually uses:

  - type:    object / string / number / boolean / null / union
  - required: required field list
  - properties: per-field type check
  - enum:    value-in-set
  - minimum / maximum (numbers), maxLength (strings)

Anything unrecognised in the schema is ignored (forward-compatible).
Validation errors surface as a list of human-readable strings; the
caller (server._handle_command) decides whether to reject the
message or just log it.
"""

from __future__ import annotations
import json
import os
from pathlib import Path
from typing import Any, Iterable

# Module-level schema load — the file ships in the bundle, never
# changes at runtime.
_SCHEMA_PATH = Path(__file__).resolve().parent.parent.parent \
    / 'shared' / 'schemas' / 'engine-protocol.schema.json'

_SCHEMA = None
_ENABLED = os.environ.get('WINDY_VALIDATE_WS', '').lower() in ('1', 'true', 'yes', 'on')


def _load_schema():
    global _SCHEMA
    if _SCHEMA is None:
        try:
            with _SCHEMA_PATH.open('r', encoding='utf-8') as f:
                _SCHEMA = json.load(f)
        except Exception:
            _SCHEMA = {}
    return _SCHEMA


def enabled() -> bool:
    """True iff WINDY_VALIDATE_WS is set. Keeps the hot path cheap
    in production (no schema walk when disabled)."""
    return _ENABLED


def _type_ok(value, expected) -> bool:
    if isinstance(expected, list):
        return any(_type_ok(value, t) for t in expected)
    if expected == 'object':  return isinstance(value, dict)
    if expected == 'string':  return isinstance(value, str)
    if expected == 'number':  return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == 'boolean': return isinstance(value, bool)
    if expected == 'null':    return value is None
    return True  # unknown → don't fail


def _validate_field(name: str, value, spec: dict) -> Iterable[str]:
    t = spec.get('type')
    if t is not None and not _type_ok(value, t):
        yield f"{name}: expected type {t}, got {type(value).__name__}"
        return
    if 'enum' in spec and value not in spec['enum']:
        yield f"{name}: value {value!r} not in {spec['enum']}"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if 'minimum' in spec and value < spec['minimum']:
            yield f"{name}: {value} below minimum {spec['minimum']}"
        if 'maximum' in spec and value > spec['maximum']:
            yield f"{name}: {value} above maximum {spec['maximum']}"
    if isinstance(value, str) and 'maxLength' in spec:
        if len(value) > spec['maxLength']:
            yield f"{name}: string length {len(value)} exceeds maxLength {spec['maxLength']}"


def validate_client_message(msg: Any) -> list[str]:
    """Validate one inbound client message. Returns a list of
    error strings (empty list means OK). Never raises."""
    if not _ENABLED:
        return []
    if not isinstance(msg, dict):
        return ['message is not a JSON object']
    action = msg.get('action')
    if not isinstance(action, str):
        return ["missing or non-string 'action' field"]
    schema = _load_schema()
    actions = schema.get('clientActions') or {}
    if action not in actions:
        base = schema.get('$defs', {}).get('baseClientMessage', {})
        allowed = base.get('properties', {}).get('action', {}).get('enum')
        if allowed and action not in allowed:
            return [f"unknown action {action!r}"]
        return []  # action exists at base level but no per-action spec
    spec = actions[action]
    errs: list[str] = []
    for req in spec.get('required', []):
        if req not in msg:
            errs.append(f"action={action}: missing required field {req!r}")
    for field, field_spec in (spec.get('properties') or {}).items():
        if field in msg:
            errs.extend(_validate_field(f"action={action}.{field}", msg[field], field_spec))
    return errs


def validate_server_message(msg: Any) -> list[str]:
    """Validate one outbound server message. Same shape as
    validate_client_message; used by tests pinning the server's
    emit contract."""
    if not _ENABLED:
        return []
    if not isinstance(msg, dict):
        return ['message is not a JSON object']
    mtype = msg.get('type')
    if not isinstance(mtype, str):
        return ["missing or non-string 'type' field"]
    schema = _load_schema()
    types = schema.get('serverTypes') or {}
    spec = types.get(mtype)
    if spec is None:
        base = schema.get('$defs', {}).get('baseServerMessage', {})
        allowed = base.get('properties', {}).get('type', {}).get('enum')
        if allowed and mtype not in allowed:
            return [f"unknown server type {mtype!r}"]
        return []
    errs: list[str] = []
    for req in spec.get('required', []):
        if req not in msg:
            errs.append(f"type={mtype}: missing required field {req!r}")
    for field, field_spec in (spec.get('properties') or {}).items():
        if field in msg:
            errs.extend(_validate_field(f"type={mtype}.{field}", msg[field], field_spec))
    return errs
