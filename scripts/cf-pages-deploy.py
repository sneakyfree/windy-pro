#!/usr/bin/env python3
"""
Cloudflare Pages Direct Upload — a wrangler-free deploy path.

Why this exists
---------------
`wrangler pages deploy` returns Cloudflare API error 9106 ("Authorization error")
with our account-scoped tokens, even though the same tokens succeed on every
underlying endpoint via direct curl. The root cause appears to be wrangler's
internal auth sanity checks demanding scopes we don't need for the actual
upload flow. Rather than chase wrangler's version-specific quirks, we drive
the Direct Upload API ourselves. It's the documented lower-layer that
wrangler wraps; we get the same result with none of the wrapper's opinions.

Flow
----
1. GET  /accounts/X/pages/projects/Y/upload-token  →  project-scoped JWT
2. POST /pages/assets/check-missing                →  list of hashes that
                                                      aren't already cached
3. POST /pages/assets/upload (batched)             →  upload missing files
                                                      as base64 under their
                                                      content hash
4. POST /accounts/X/pages/projects/Y/deployments   →  create deployment,
                                                      manifest maps
                                                      pathname → hash

Cloudflare's asset store is content-addressable, so repeated deploys are
cheap: only files whose hashes changed need to be uploaded.

Usage
-----
    CLOUDFLARE_API_TOKEN=cfut_...  \\
    CLOUDFLARE_ACCOUNT_ID=193b...  \\
    python3 scripts/cf-pages-deploy.py <project_name> <dist_dir> [branch]

Exit codes
----------
    0  deployment success
    1  deployment failed (see stderr for reason)
    2  argument / environment error
"""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import sys
import time
from pathlib import Path
from typing import Any


API = "https://api.cloudflare.com/client/v4"
UPLOAD_BATCH_SIZE = 5
REQUEST_TIMEOUT = 60
MAX_ATTEMPTS = 3

# Cloudflare Pages uses 32-char hex file hashes (16 bytes). The hash function
# wrangler uses is BLAKE3 truncated — but the API accepts any 32-char hex
# string as the identifier as long as it's stable across the same content.
# We use sha256 truncated to 32 hex chars (16 bytes) which is collision-safe
# for realistic deploy sizes (<10^9 files).
HASH_BYTES = 16


try:
    import requests
except ImportError:
    import subprocess

    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "requests"])
    import requests  # type: ignore


def err(msg: str, *, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr, flush=True)
    sys.exit(code)


def content_hash(path: Path) -> str:
    h = hashlib.sha256(path.read_bytes()).hexdigest()
    return h[: HASH_BYTES * 2]


def request_with_retry(method: str, url: str, **kwargs: Any):
    last_exc: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            r = requests.request(method, url, timeout=REQUEST_TIMEOUT, **kwargs)
            if r.status_code >= 500:
                raise RuntimeError(f"{r.status_code}: {r.text[:200]}")
            return r
        except (requests.exceptions.RequestException, RuntimeError) as exc:
            last_exc = exc
            wait = 2 ** attempt
            print(f"  transient error (attempt {attempt + 1}/{MAX_ATTEMPTS}): {exc}; retrying in {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"request failed after {MAX_ATTEMPTS} attempts: {last_exc}")


def walk_dist(dist: Path):
    for p in sorted(dist.rglob("*")):
        if p.is_file():
            rel = "/" + str(p.relative_to(dist))
            yield rel, p


def main() -> int:
    if len(sys.argv) < 3:
        err("usage: cf-pages-deploy.py <project_name> <dist_dir> [branch]", code=2)

    project = sys.argv[1]
    dist = Path(sys.argv[2]).resolve()
    branch = sys.argv[3] if len(sys.argv) > 3 else "main"

    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token:
        err("CLOUDFLARE_API_TOKEN env var must be set", code=2)
    if not account:
        err("CLOUDFLARE_ACCOUNT_ID env var must be set", code=2)
    if not dist.is_dir():
        err(f"not a directory: {dist}", code=2)

    token_header = {"Authorization": f"Bearer {token}"}

    print(f"[1/5] Requesting upload-token for project '{project}'...", flush=True)
    r = request_with_retry(
        "GET",
        f"{API}/accounts/{account}/pages/projects/{project}/upload-token",
        headers=token_header,
    )
    data = r.json()
    if not data.get("success"):
        err(f"upload-token failed: {data.get('errors')}")
    jwt = data["result"]["jwt"]
    jwt_header = {"Authorization": f"Bearer {jwt}"}
    print(f"      got upload JWT", flush=True)

    print(f"[2/5] Hashing files under {dist}...", flush=True)
    manifest: dict[str, str] = {}
    hash_to_path: dict[str, Path] = {}
    for pathname, abs_path in walk_dist(dist):
        h = content_hash(abs_path)
        manifest[pathname] = h
        hash_to_path[h] = abs_path
    print(f"      {len(manifest)} files, {len(hash_to_path)} unique hashes", flush=True)

    print(f"[3/5] Check-missing against content-addressable cache...", flush=True)
    r = request_with_retry(
        "POST",
        f"{API}/pages/assets/check-missing",
        headers={**jwt_header, "Content-Type": "application/json"},
        json={"hashes": list(hash_to_path.keys())},
    )
    data = r.json()
    if not data.get("success"):
        err(f"check-missing failed: {data.get('errors')}")
    missing = data["result"] or []
    print(f"      {len(missing)} of {len(hash_to_path)} need upload", flush=True)

    if missing:
        batches = (len(missing) + UPLOAD_BATCH_SIZE - 1) // UPLOAD_BATCH_SIZE
        print(f"[4/5] Uploading {len(missing)} assets in {batches} batches...", flush=True)
        for i in range(0, len(missing), UPLOAD_BATCH_SIZE):
            batch = missing[i : i + UPLOAD_BATCH_SIZE]
            payload = []
            for h in batch:
                path = hash_to_path[h]
                content_type, _ = mimetypes.guess_type(path.name)
                payload.append(
                    {
                        "base64": True,
                        "key": h,
                        "metadata": {"contentType": content_type or "application/octet-stream"},
                        "value": base64.b64encode(path.read_bytes()).decode("ascii"),
                    }
                )
            r = request_with_retry(
                "POST",
                f"{API}/pages/assets/upload",
                headers={**jwt_header, "Content-Type": "application/json"},
                json=payload,
            )
            rj = r.json()
            if not rj.get("success"):
                err(f"upload batch {i // UPLOAD_BATCH_SIZE + 1}/{batches} failed: {rj.get('errors')}")
            print(f"      batch {i // UPLOAD_BATCH_SIZE + 1}/{batches} uploaded", flush=True)
    else:
        print(f"[4/5] All assets already cached, skipping upload", flush=True)

    print(f"[5/5] Creating deployment on branch '{branch}'...", flush=True)

    files = {
        "manifest": (None, json.dumps(manifest), "application/json"),
        "branch": (None, branch, "text/plain"),
    }
    # Cloudflare Pages honours these files if they're present at deploy root
    # (separate from the manifest upload — they're processed specially).
    for special in ("_headers", "_redirects", "_routes.json"):
        p = dist / special
        if p.is_file():
            files[special] = (special, p.read_bytes(), "application/octet-stream")

    r = request_with_retry(
        "POST",
        f"{API}/accounts/{account}/pages/projects/{project}/deployments",
        headers=token_header,
        files=files,
    )
    data = r.json()
    if not data.get("success"):
        err(f"deployment creation failed ({r.status_code}): {data.get('errors') or r.text[:400]}")
    result = data["result"]

    # Structured summary — also dumps JSON on last line for CI log parsing
    print("")
    print(f"  ✅ deployment created")
    print(f"     id:      {result.get('id')}")
    print(f"     url:     {result.get('url')}")
    print(f"     aliases: {result.get('aliases') or '(none — first deploy, custom domain alias pending)'}")
    print(f"     stage:   {result.get('latest_stage', {}).get('status')}")
    print("")
    print(
        json.dumps(
            {
                "deployment_id": result.get("id"),
                "url": result.get("url"),
                "aliases": result.get("aliases") or [],
                "stage": result.get("latest_stage", {}).get("status"),
                "files_uploaded": len(missing),
                "files_reused_from_cache": len(hash_to_path) - len(missing),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
