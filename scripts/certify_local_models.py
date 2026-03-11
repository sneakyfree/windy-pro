#!/usr/bin/env python3
"""
Certify all local Windy Pro models before upload to HuggingFace.
Runs inference on each model, marks PASS/FAIL, saves results.
"""

import os
import sys
import json
import time
import shutil
from pathlib import Path
from datetime import datetime

MODELS_DIR = Path("/home/user1-gpu/Desktop/grants_folder/windy-pro/models")
TEST_AUDIO = "/home/user1-gpu/Desktop/grants_folder/windy-pro/test_audio/librispeech_sample.wav"
RESULTS_FILE = Path("/home/user1-gpu/Desktop/grants_folder/windy-pro/scripts/local_cert_results.json")
SUMMARY_FILE = Path("/tmp/local_cert_summary.txt")

SKIP_DIRS = {"m2m100_1.2B", "m2m100_418M"}
MODEL_EXTENSIONS = {".safetensors", ".bin", ".pt"}


def has_content(path: Path) -> bool:
    return any(f.suffix in MODEL_EXTENSIONS for f in path.rglob("*") if f.is_file())


def is_ct2_stt(path: Path) -> bool:
    """CT2/faster-whisper model: has model.bin + vocabulary.json, no safetensors"""
    has_bin = (path / "model.bin").exists()
    has_vocab = (path / "vocabulary.json").exists()
    has_sf = any(f.suffix == ".safetensors" for f in path.iterdir())
    return has_bin and has_vocab and not has_sf


def is_gpu_stt(path: Path) -> bool:
    """HuggingFace safetensors Whisper model"""
    return any(f.suffix == ".safetensors" for f in path.iterdir() if f.is_file())


def is_translation(path: Path) -> bool:
    return "pair" in path.name or "translate" in path.name.lower()


def certify_ct2(model_dir: Path) -> tuple:
    """Test CT2 model with faster_whisper on CPU"""
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(str(model_dir), device="cpu", compute_type="int8")
        segments, info = model.transcribe(TEST_AUDIO)
        text = " ".join([s.text.strip() for s in segments])
        del model
        if len(text.strip()) > 5:
            return True, text.strip()[:80]
        return False, "Empty transcription"
    except Exception as e:
        return False, str(e)[:100]


def certify_gpu_stt(model_dir: Path) -> tuple:
    """Test GPU safetensors model with transformers"""
    try:
        import torch
        from transformers import WhisperForConditionalGeneration, WhisperProcessor
        import soundfile as sf

        processor = WhisperProcessor.from_pretrained(str(model_dir))
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        model = WhisperForConditionalGeneration.from_pretrained(
            str(model_dir), torch_dtype=dtype
        ).to(device)

        audio, sr = sf.read(TEST_AUDIO)
        inputs = processor(audio, sampling_rate=sr, return_tensors="pt").input_features
        inputs = inputs.to(device, dtype)

        with torch.no_grad():
            ids = model.generate(inputs, max_new_tokens=128)
        text = processor.batch_decode(ids, skip_special_tokens=True)[0]

        del model
        if device == "cuda":
            torch.cuda.empty_cache()

        if len(text.strip()) > 5:
            return True, text.strip()[:80]
        return False, "Empty transcription"
    except Exception as e:
        return False, str(e)[:100]


def certify_translation(model_dir: Path) -> tuple:
    """Test OPUS-MT translation model with ctranslate2"""
    try:
        import ctranslate2
        from sentencepiece import SentencePieceProcessor

        sp_model = str(model_dir / "source.spm")
        if not os.path.exists(sp_model):
            sp_model = str(model_dir / "tokenizer.model")
        if not os.path.exists(sp_model):
            return False, "No sentencepiece model found"

        sp = SentencePieceProcessor()
        sp.load(sp_model)

        translator = ctranslate2.Translator(str(model_dir), device="cpu", inter_threads=2)
        test_input = "The weather is nice today."
        tokens = sp.encode(test_input, out_type=str)
        results = translator.translate_batch([tokens])
        output_tokens = results[0].hypotheses[0]
        output_text = sp.decode(output_tokens)

        del translator
        if len(output_text.strip()) > 2:
            return True, output_text.strip()[:80]
        return False, "Empty translation"
    except Exception as e:
        return False, str(e)[:100]


def load_results() -> dict:
    if RESULTS_FILE.exists():
        return json.load(open(RESULTS_FILE))
    return {"pass": [], "fail": {}, "skip": [], "last_run": None}


def save_results(results: dict):
    results["last_run"] = datetime.now().isoformat()
    with open(RESULTS_FILE, "w") as f:
        json.dump(results, f, indent=2)


def main():
    # Load previous results
    results = load_results()
    already_done = set(results["pass"]) | set(results["fail"].keys())

    # Get all local model dirs
    all_dirs = sorted([d for d in MODELS_DIR.iterdir()
                       if d.is_dir() and d.name not in SKIP_DIRS])

    to_cert = []
    for d in all_dirs:
        if d.name in already_done:
            continue
        if not has_content(d):
            if d.name not in results["skip"]:
                results["skip"].append(d.name)
            continue
        to_cert.append(d)

    print(f"Total model dirs: {len(all_dirs)}")
    print(f"Already certified: {len(already_done)}")
    print(f"Skipped (empty): {len(results['skip'])}")
    print(f"To certify now: {len(to_cert)}")
    print()

    passed = 0
    failed = 0

    for i, model_dir in enumerate(to_cert):
        name = model_dir.name
        print(f"[{i+1}/{len(to_cert)}] {name}...", end=" ", flush=True)

        # Determine model type and certify
        if is_translation(model_dir):
            ok, text = certify_translation(model_dir)
        elif is_ct2_stt(model_dir):
            ok, text = certify_ct2(model_dir)
        elif is_gpu_stt(model_dir):
            ok, text = certify_gpu_stt(model_dir)
        else:
            # Unknown type — try CT2 first, then GPU
            ok, text = certify_ct2(model_dir)
            if not ok:
                ok2, text2 = certify_gpu_stt(model_dir)
                if ok2:
                    ok, text = ok2, text2

        if ok:
            print(f"✅ '{text[:50]}'")
            results["pass"].append(name)
            passed += 1
        else:
            print(f"❌ {text[:60]}")
            results["fail"][name] = text
            failed += 1

        # Save after each model
        save_results(results)

        # Small delay to keep resource usage down
        time.sleep(0.5)

    # Summary
    summary = f"""
=== LOCAL CERTIFICATION SUMMARY ===
Date: {datetime.now().strftime('%Y-%m-%d %H:%M EST')}

Total dirs: {len(all_dirs)}
Skipped (empty/no model files): {len(results['skip'])}
This run — PASS: {passed} | FAIL: {failed}
All-time — PASS: {len(results['pass'])} | FAIL: {len(results['fail'])}

FAILED MODELS:
{json.dumps(results['fail'], indent=2) if results['fail'] else '  None'}
"""
    print(summary)
    with open(SUMMARY_FILE, "w") as f:
        f.write(summary)

    print(f"Results saved to {RESULTS_FILE}")
    print(f"Summary saved to {SUMMARY_FILE}")

    # Notify
    os.system("openclaw system event --text 'Done: Local model cert complete — check /tmp/local_cert_summary.txt' --mode now")


if __name__ == "__main__":
    main()
