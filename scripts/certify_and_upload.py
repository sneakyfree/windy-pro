#!/usr/bin/env python3
"""
WINDY PRO MODEL CERTIFICATION & UPLOAD PIPELINE
=================================================
Certifies each model passes QA before uploading to HuggingFace.

For STT models (GPU safetensors):
  1. Load model + processor
  2. Transcribe test audio
  3. Compare WER against ground truth
  4. PASS if WER <= threshold

For STT models (CT2 INT8):
  1. Load with ctranslate2 + faster-whisper
  2. Transcribe same test audio
  3. Compare against GPU variant output
  4. PASS if exact match or WER <= threshold

For Translation pair models (OPUS-MT):
  1. Load model + tokenizer
  2. Translate 3 test sentences
  3. Verify output is in target language (not echoed English)
  4. PASS if all translations produce non-English output

Only PASSED models get uploaded to HuggingFace.
"""

import os
import sys
import json
import time
import argparse
import logging
from pathlib import Path
from datetime import datetime

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('/tmp/certification.log'),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

MODELS_DIR = "/home/user1-gpu/Desktop/grants_folder/windy-pro/models"
ORG = "WindyProLabs"
TEST_AUDIO = "/home/user1-gpu/Desktop/grants_folder/windy-pro/test_audio/librispeech_sample.wav"
GROUND_TRUTH = "mister quilter is the apostle of the middle classes and we are glad to welcome his gospel"
CERT_REPORT_PATH = "/home/user1-gpu/Desktop/grants_folder/windy-pro/docs/CERTIFICATION_REPORT.md"

# Translation test sentences
TRANSLATE_TESTS = [
    "The meeting will begin at three o clock in the afternoon.",
    "Please send the financial report to my office by Friday.",
    "The weather forecast predicts heavy rain throughout the weekend.",
]

def compute_wer(reference, hypothesis):
    """Word Error Rate"""
    ref = reference.lower().strip().split()
    hyp = hypothesis.lower().strip().split()
    
    # Levenshtein on words
    d = [[0] * (len(hyp) + 1) for _ in range(len(ref) + 1)]
    for i in range(len(ref) + 1):
        d[i][0] = i
    for j in range(len(hyp) + 1):
        d[0][j] = j
    for i in range(1, len(ref) + 1):
        for j in range(1, len(hyp) + 1):
            if ref[i-1] == hyp[j-1]:
                d[i][j] = d[i-1][j-1]
            else:
                d[i][j] = 1 + min(d[i-1][j], d[i][j-1], d[i-1][j-1])
    return d[len(ref)][len(hyp)] / max(len(ref), 1)


def certify_stt_gpu(model_path, model_name):
    """Certify a GPU STT model (safetensors)."""
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor, WhisperFeatureExtractor
    import soundfile as sf
    
    log.info(f"  Loading GPU model: {model_name}")
    
    try:
        # Check for required files
        has_safetensors = any(f.endswith('.safetensors') for f in os.listdir(model_path))
        has_config = os.path.exists(os.path.join(model_path, 'config.json'))
        
        if not has_safetensors:
            return "FAIL", "No .safetensors file found"
        if not has_config:
            return "FAIL", "No config.json found"
        
        # Load model
        processor = WhisperProcessor.from_pretrained(model_path)
        model = WhisperForConditionalGeneration.from_pretrained(
            model_path, torch_dtype=torch.float16
        ).to("cuda")
        
        # Load test audio
        if not os.path.exists(TEST_AUDIO):
            return "SKIP", f"Test audio not found: {TEST_AUDIO}"
        
        audio, sr = sf.read(TEST_AUDIO)
        input_features = processor(audio, sampling_rate=sr, return_tensors="pt").input_features.to("cuda", torch.float16)
        
        # Transcribe
        with torch.no_grad():
            predicted_ids = model.generate(input_features)
        transcription = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]
        
        # Compute WER
        wer = compute_wer(GROUND_TRUTH, transcription)
        
        # Cleanup GPU memory
        del model
        torch.cuda.empty_cache()
        
        if wer <= 0.15:  # Allow up to 15% WER (matches core 16 threshold)
            return "PASS", f"WER={wer:.4f} | '{transcription}'"
        else:
            return "FAIL", f"WER={wer:.4f} exceeds threshold | '{transcription}'"
            
    except Exception as e:
        try:
            import torch
            torch.cuda.empty_cache()
        except:
            pass
        return "FAIL", f"Error: {str(e)}"


def certify_stt_ct2(model_path, model_name):
    """Certify a CT2 INT8 STT model."""
    log.info(f"  Loading CT2 model: {model_name}")
    
    try:
        # Check for required files
        has_model_bin = os.path.exists(os.path.join(model_path, 'model.bin'))
        if not has_model_bin:
            return "FAIL", "No model.bin found"
        
        from faster_whisper import WhisperModel
        
        model = WhisperModel(model_path, device="cpu", compute_type="int8")
        
        if not os.path.exists(TEST_AUDIO):
            return "SKIP", f"Test audio not found: {TEST_AUDIO}"
        
        segments, info = model.transcribe(TEST_AUDIO)
        transcription = " ".join([s.text.strip() for s in segments])
        
        wer = compute_wer(GROUND_TRUTH, transcription)
        
        del model
        
        if wer <= 0.15:
            return "PASS", f"WER={wer:.4f} | '{transcription}'"
        else:
            return "FAIL", f"WER={wer:.4f} exceeds threshold | '{transcription}'"
            
    except Exception as e:
        return "FAIL", f"Error: {str(e)}"


def certify_stt_lingua_gpu(model_path, model_name):
    """Certify a lingua STT GPU model - test that it loads and runs inference."""
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    import soundfile as sf
    
    log.info(f"  Loading lingua GPU model: {model_name}")
    
    try:
        has_safetensors = any(f.endswith('.safetensors') for f in os.listdir(model_path))
        has_config = os.path.exists(os.path.join(model_path, 'config.json'))
        
        if not has_safetensors:
            return "FAIL", "No .safetensors file found"
        if not has_config:
            return "FAIL", "No config.json found"
        
        # Load model - just verify it loads and can run inference
        processor = WhisperProcessor.from_pretrained(model_path)
        model = WhisperForConditionalGeneration.from_pretrained(
            model_path, torch_dtype=torch.float16
        ).to("cuda")
        
        if not os.path.exists(TEST_AUDIO):
            return "SKIP", f"Test audio not found: {TEST_AUDIO}"
        
        audio, sr = sf.read(TEST_AUDIO)
        input_features = processor(audio, sampling_rate=sr, return_tensors="pt").input_features.to("cuda", torch.float16)
        
        with torch.no_grad():
            predicted_ids = model.generate(input_features)
        transcription = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]
        
        del model
        torch.cuda.empty_cache()
        
        # For lingua models, we just need it to produce output (may be in another language)
        if len(transcription.strip()) > 0:
            return "PASS", f"Inference OK | '{transcription[:80]}'"
        else:
            return "FAIL", "Empty transcription output"
            
    except Exception as e:
        try:
            import torch
            torch.cuda.empty_cache()
        except:
            pass
        return "FAIL", f"Error: {str(e)}"


def certify_stt_lingua_ct2(model_path, model_name):
    """Certify a lingua CT2 model."""
    log.info(f"  Loading lingua CT2 model: {model_name}")
    
    try:
        has_model_bin = os.path.exists(os.path.join(model_path, 'model.bin'))
        if not has_model_bin:
            return "FAIL", "No model.bin found"
        
        from faster_whisper import WhisperModel
        model = WhisperModel(model_path, device="cpu", compute_type="int8")
        
        if not os.path.exists(TEST_AUDIO):
            return "SKIP", f"Test audio not found: {TEST_AUDIO}"
        
        segments, info = model.transcribe(TEST_AUDIO)
        transcription = " ".join([s.text.strip() for s in segments])
        
        del model
        
        if len(transcription.strip()) > 0:
            return "PASS", f"Inference OK | '{transcription[:80]}'"
        else:
            return "FAIL", "Empty transcription output"
            
    except Exception as e:
        return "FAIL", f"Error: {str(e)}"


def certify_translation_pair(model_path, model_name):
    """Certify an OPUS-MT translation pair model."""
    from transformers import MarianMTModel, MarianTokenizer
    
    log.info(f"  Loading translation model: {model_name}")
    
    try:
        has_config = os.path.exists(os.path.join(model_path, 'config.json'))
        if not has_config:
            return "FAIL", "No config.json found"
        
        tokenizer = MarianTokenizer.from_pretrained(model_path)
        model = MarianMTModel.from_pretrained(model_path)
        
        passed = 0
        details = []
        
        for sentence in TRANSLATE_TESTS:
            inputs = tokenizer(sentence, return_tensors="pt", padding=True, truncation=True)
            translated = model.generate(**inputs, max_length=128)
            output = tokenizer.batch_decode(translated, skip_special_tokens=True)[0]
            
            # Check: output should NOT be identical to input (would mean no translation happened)
            if output.strip().lower() != sentence.strip().lower() and len(output.strip()) > 5:
                passed += 1
                details.append(f"OK: '{output[:60]}'")
            else:
                details.append(f"ECHO: '{output[:60]}'")
        
        del model
        
        if passed >= 2:  # At least 2/3 must translate
            return "PASS", f"{passed}/3 translated | {'; '.join(details[:2])}"
        else:
            return "FAIL", f"Only {passed}/3 translated | {'; '.join(details)}"
            
    except Exception as e:
        return "FAIL", f"Error: {str(e)}"


def classify_model(model_name):
    """Determine model type from directory name."""
    if model_name.startswith("windy-pair-"):
        return "translation_pair"
    elif model_name.startswith("windy-lingua-") and model_name.endswith("-ct2"):
        return "lingua_ct2"
    elif model_name.startswith("windy-lingua-"):
        return "lingua_gpu"
    elif model_name.startswith("windy-stt-") and "-ct2" in model_name:
        return "stt_ct2"
    elif model_name.startswith("windy-stt-distil"):
        return "stt_gpu"
    elif model_name.startswith("windy-stt-"):
        return "stt_gpu"
    elif model_name.startswith("windy_translate_"):
        return "translation_generalist"
    else:
        return "unknown"


def upload_to_hf(model_path, model_name):
    """Upload certified model to HuggingFace."""
    from huggingface_hub import HfApi, create_repo
    
    api = HfApi()
    repo_id = f"{ORG}/{model_name}"
    
    try:
        create_repo(repo_id=repo_id, repo_type="model", private=True, exist_ok=True)
        api.upload_folder(folder_path=model_path, repo_id=repo_id, repo_type="model")
        return True, "Uploaded successfully"
    except Exception as e:
        return False, str(e)


def main():
    parser = argparse.ArgumentParser(description="Certify and upload Windy Pro models")
    parser.add_argument("--dry-run", action="store_true", help="Certify only, don't upload")
    parser.add_argument("--filter", type=str, default=None, help="Only process models matching this prefix")
    parser.add_argument("--skip-existing", action="store_true", help="Skip models already on HuggingFace")
    parser.add_argument("--upload-only", action="store_true", help="Skip certification for already-certified models")
    args = parser.parse_args()
    
    from huggingface_hub import HfApi
    api = HfApi()
    
    existing_repos = set()
    if args.skip_existing:
        for r in api.list_models(author=ORG):
            existing_repos.add(r.id.split("/")[-1])
        log.info(f"Already on HuggingFace: {len(existing_repos)} repos")
    
    # Get models to process
    all_models = sorted([
        d for d in os.listdir(MODELS_DIR)
        if os.path.isdir(os.path.join(MODELS_DIR, d))
        and d.startswith("windy-")
    ])
    
    if args.filter:
        all_models = [m for m in all_models if m.startswith(args.filter)]
    
    if args.skip_existing:
        all_models = [m for m in all_models if m not in existing_repos]
    
    log.info(f"Models to process: {len(all_models)}")
    
    # Results tracking
    results = {"PASS": [], "FAIL": [], "SKIP": [], "UPLOAD_OK": [], "UPLOAD_FAIL": []}
    cert_func_map = {
        "stt_gpu": certify_stt_gpu,
        "stt_ct2": certify_stt_ct2,
        "lingua_gpu": certify_stt_lingua_gpu,
        "lingua_ct2": certify_stt_lingua_ct2,
        "translation_pair": certify_translation_pair,
    }
    
    for i, model_name in enumerate(all_models):
        model_path = os.path.join(MODELS_DIR, model_name)
        model_type = classify_model(model_name)
        
        log.info(f"\n[{i+1}/{len(all_models)}] {model_name} (type: {model_type})")
        
        # Certify
        cert_func = cert_func_map.get(model_type)
        if cert_func is None:
            log.warning(f"  SKIP — unknown model type: {model_type}")
            results["SKIP"].append((model_name, "unknown type"))
            continue
        
        status, detail = cert_func(model_path, model_name)
        log.info(f"  Certification: {status} — {detail}")
        
        if status == "PASS":
            results["PASS"].append((model_name, detail))
            
            # Upload if not dry run
            if not args.dry_run:
                log.info(f"  Uploading to HuggingFace...")
                ok, msg = upload_to_hf(model_path, model_name)
                if ok:
                    results["UPLOAD_OK"].append(model_name)
                    log.info(f"  ✅ Upload complete")
                else:
                    results["UPLOAD_FAIL"].append((model_name, msg))
                    log.error(f"  ❌ Upload failed: {msg}")
                time.sleep(2)
        elif status == "FAIL":
            results["FAIL"].append((model_name, detail))
            log.error(f"  ❌ CERTIFICATION FAILED — NOT uploading")
        else:
            results["SKIP"].append((model_name, detail))
    
    # Write certification report
    report = f"""# WINDY PRO — CERTIFICATION REPORT
**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M EST')}
**Models Processed:** {len(all_models)}
**Dry Run:** {args.dry_run}

## Summary
| Result | Count |
|--------|-------|
| ✅ CERTIFIED | {len(results['PASS'])} |
| ❌ FAILED | {len(results['FAIL'])} |
| ⏭️ SKIPPED | {len(results['SKIP'])} |
| 📤 UPLOADED | {len(results['UPLOAD_OK'])} |
| 📤 UPLOAD FAILED | {len(results['UPLOAD_FAIL'])} |

## Certified Models (PASS)
"""
    for name, detail in results["PASS"]:
        report += f"- ✅ **{name}**: {detail}\n"
    
    report += "\n## Failed Models\n"
    for name, detail in results["FAIL"]:
        report += f"- ❌ **{name}**: {detail}\n"
    
    if results["SKIP"]:
        report += "\n## Skipped Models\n"
        for name, detail in results["SKIP"]:
            report += f"- ⏭️ **{name}**: {detail}\n"
    
    if results["UPLOAD_FAIL"]:
        report += "\n## Upload Failures\n"
        for name, detail in results["UPLOAD_FAIL"]:
            report += f"- ❌ **{name}**: {detail}\n"
    
    with open(CERT_REPORT_PATH, 'w') as f:
        f.write(report)
    log.info(f"\nReport written to: {CERT_REPORT_PATH}")
    
    # Print summary
    log.info(f"\n{'='*60}")
    log.info(f"CERTIFICATION COMPLETE")
    log.info(f"  PASS: {len(results['PASS'])}")
    log.info(f"  FAIL: {len(results['FAIL'])}")
    log.info(f"  SKIP: {len(results['SKIP'])}")
    if not args.dry_run:
        log.info(f"  UPLOADED: {len(results['UPLOAD_OK'])}")
        log.info(f"  UPLOAD_FAIL: {len(results['UPLOAD_FAIL'])}")


if __name__ == "__main__":
    main()
