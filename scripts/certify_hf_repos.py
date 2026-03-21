#!/usr/bin/env python3
"""
Retroactive certification of all 98 WindyProLabs HuggingFace models.
Downloads each model, runs inference, certifies, logs results.
"""
import os, sys, json, torch, logging, shutil
from datetime import datetime
from huggingface_hub import HfApi, snapshot_download

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('/tmp/hf_cert.log'),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

TEST_AUDIO = "/home/user1-gpu/Desktop/grants_folder/windy-pro/test_audio/librispeech_sample.wav"
CACHE_DIR = "/tmp/hf_cert_cache"
VENV = "/home/user1-gpu/Desktop/grants_folder/windy-pro/.venv/bin"

api = HfApi()
results = {"pass": [], "fail": [], "skip": []}

TRANSLATE_TESTS = [
    "The meeting will begin at three o clock in the afternoon.",
    "Please send the financial report to my office by Friday.",
    "The weather forecast predicts heavy rain throughout the weekend.",
]


def certify_stt_gpu(repo_id, local_path):
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    import soundfile as sf
    
    processor = WhisperProcessor.from_pretrained(local_path)
    model = WhisperForConditionalGeneration.from_pretrained(local_path, torch_dtype=torch.float16).to("cuda")
    
    audio, sr = sf.read(TEST_AUDIO)
    inputs = processor(audio, sampling_rate=sr, return_tensors="pt").input_features.to("cuda", torch.float16)
    
    with torch.no_grad():
        ids = model.generate(inputs)
    text = processor.batch_decode(ids, skip_special_tokens=True)[0]
    
    del model; torch.cuda.empty_cache()
    
    if len(text.strip()) > 5:
        return True, text.strip()[:80]
    return False, "Empty or too short output"


def certify_stt_ct2(repo_id, local_path):
    from faster_whisper import WhisperModel
    model = WhisperModel(local_path, device="cpu", compute_type="int8")
    segments, info = model.transcribe(TEST_AUDIO)
    text = " ".join([s.text.strip() for s in segments])
    del model
    if len(text.strip()) > 5:
        return True, text.strip()[:80]
    return False, "Empty or too short output"


def certify_translate(repo_id, local_path):
    from transformers import MarianMTModel, MarianTokenizer, M2M100ForConditionalGeneration, M2M100Tokenizer
    
    # Detect model type
    config_path = os.path.join(local_path, "config.json")
    with open(config_path) as f:
        config = json.load(f)
    
    arch = config.get("architectures", [""])[0]
    
    if "M2M100" in arch:
        tokenizer = M2M100Tokenizer.from_pretrained(local_path)
        model = M2M100ForConditionalGeneration.from_pretrained(local_path)
        tokenizer.src_lang = "en"
        test = "The weather forecast predicts heavy rain throughout the weekend."
        inputs = tokenizer(test, return_tensors="pt")
        out = model.generate(**inputs, forced_bos_token_id=tokenizer.get_lang_id("es"), max_length=128)
        result = tokenizer.batch_decode(out, skip_special_tokens=True)[0]
        del model
        if result.strip().lower() != test.lower() and len(result.strip()) > 5:
            return True, f"'{result[:60]}'"
        return False, "No translation produced"
    else:
        tokenizer = MarianTokenizer.from_pretrained(local_path)
        model = MarianMTModel.from_pretrained(local_path)
        passed = 0
        for sent in TRANSLATE_TESTS:
            inputs = tokenizer(sent, return_tensors="pt", padding=True, truncation=True)
            out = model.generate(**inputs, max_length=128)
            result = tokenizer.batch_decode(out, skip_special_tokens=True)[0]
            if result.strip().lower() != sent.strip().lower() and len(result.strip()) > 5:
                passed += 1
        del model
        if passed >= 2:
            return True, f"{passed}/3 translated"
        return False, f"Only {passed}/3 translated"


def main():
    repos = sorted([r.id for r in api.list_models(author='WindyProLabs')])
    log.info(f"Certifying {len(repos)} models from WindyProLabs")
    
    os.makedirs(CACHE_DIR, exist_ok=True)
    
    for i, repo_id in enumerate(repos, 1):
        name = repo_id.split('/')[-1]
        log.info(f"[{i}/{len(repos)}] {name}")
        
        try:
            # Download
            local_path = snapshot_download(repo_id=repo_id, cache_dir=CACHE_DIR, local_dir=f"{CACHE_DIR}/{name}")
            
            # Determine type and certify
            is_ct2 = name.endswith('-ct2')
            is_stt = name.startswith('windy-') and not name.startswith('windy-lingua') and not name.startswith('windy-pair') and not name.startswith('windy-translate') or name.startswith('windy-lingua-')
            is_translate = name.startswith('windy-pair-') or name.startswith('windy-translate')
            is_distil = 'distil' in name
            
            if is_stt and is_ct2:
                ok, detail = certify_stt_ct2(repo_id, local_path)
            elif is_stt:
                ok, detail = certify_stt_gpu(repo_id, local_path)
            elif is_translate:
                ok, detail = certify_translate(repo_id, local_path)
            else:
                log.warning(f"  Unknown type, skipping")
                results["skip"].append(name)
                continue
            
            if ok:
                log.info(f"  ✅ PASS: {detail}")
                results["pass"].append(name)
            else:
                log.error(f"  ❌ FAIL: {detail}")
                results["fail"].append(name)
                
        except Exception as e:
            log.error(f"  ❌ ERROR: {e}")
            results["fail"].append(name)
        finally:
            # Cleanup download
            dl_path = f"{CACHE_DIR}/{name}"
            if os.path.exists(dl_path):
                shutil.rmtree(dl_path, ignore_errors=True)
            torch.cuda.empty_cache()
    
    # Write final report
    log.info(f"\n{'='*60}")
    log.info(f"CERTIFICATION COMPLETE")
    log.info(f"  ✅ PASS: {len(results['pass'])}")
    log.info(f"  ❌ FAIL: {len(results['fail'])}")
    log.info(f"  ⏭️ SKIP: {len(results['skip'])}")
    
    if results['fail']:
        log.info(f"\nFailed models:")
        for m in results['fail']:
            log.info(f"  ❌ {m}")
    
    # Save results
    with open('/tmp/hf_cert_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    log.info(f"\nResults saved to /tmp/hf_cert_results.json")


if __name__ == "__main__":
    main()
