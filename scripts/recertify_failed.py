#!/usr/bin/env python3
"""Re-certify the 14 failed models from staged_models.json"""

import os
import json
import sys
from pathlib import Path

# Add scripts dir to path to import from model_factory
sys.path.insert(0, '/home/user1-gpu/Desktop/grants_folder/windy-pro/scripts')

from model_factory import certify_marian, MODELS_DIR

STAGED_JSON = "/home/user1-gpu/Desktop/grants_folder/windy-pro/scripts/staged_models.json"

def main():
    # Load staged models
    with open(STAGED_JSON) as f:
        staged = json.load(f)

    # Find failed models (gpu_cert=false)
    failed = [m for m in staged if not m.get('gpu_cert', False)]

    print(f"Found {len(failed)} failed models to re-certify\n")

    passed = 0
    still_failed = 0
    needs_rebuild = 0

    for model in failed:
        pair_code = model['pair_code']
        gpu_name = model['gpu_name']
        gpu_path = os.path.join(MODELS_DIR, gpu_name)

        print(f"Re-certifying {pair_code}...", end=" ")

        # Check if model still exists locally
        if not os.path.exists(gpu_path):
            print(f"❌ Model dir not found - marking needs_rebuild")
            model['needs_rebuild'] = True
            needs_rebuild += 1
            continue

        # Run certification with new logic
        cert_ok, cert_output = certify_marian(gpu_path)

        # Update staged_models.json entry
        model['gpu_cert'] = cert_ok
        model['gpu_cert_output'] = cert_output

        if cert_ok:
            print(f"✅ PASS - {cert_output}")
            passed += 1
        else:
            print(f"❌ FAIL - {cert_output}")
            still_failed += 1

    # Write updated staged_models.json
    with open(STAGED_JSON, 'w') as f:
        json.dump(staged, f, indent=2)

    print(f"\n{'='*60}")
    print(f"Re-certification complete:")
    print(f"  PASSED: {passed}")
    print(f"  STILL FAILED: {still_failed}")
    print(f"  NEEDS REBUILD: {needs_rebuild}")
    print(f"  TOTAL CHECKED: {len(failed)}")
    print(f"{'='*60}")

    # Show updated counts from full staged_models.json
    total_pass = sum(1 for m in staged if m.get('gpu_cert', False))
    total_fail = sum(1 for m in staged if not m.get('gpu_cert', False))
    print(f"\nFull staged_models.json status:")
    print(f"  PASS: {total_pass}")
    print(f"  FAIL: {total_fail}")

if __name__ == "__main__":
    main()
