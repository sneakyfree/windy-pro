"""
Windy Pro - Model Evaluation Pipeline
Compare baseline M2M-100 vs fine-tuned LoRA model.

Metrics:
- BLEU score
- chrF++
- Inference speed (ms)
- VRAM usage

Test sets:
- Flores-200 devtest (standard benchmark)
- Custom curated test set
"""

import json
import time
import torch
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from tqdm import tqdm

from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
from peft import PeftModel
import evaluate


@dataclass
class EvaluationResult:
    """Results from model evaluation."""
    model_name: str
    test_set: str
    language_pair: str

    # Metrics
    bleu_score: float
    chrf_score: float

    # Performance
    avg_inference_ms: float
    tokens_per_sec: float
    vram_mb: float

    # Sample counts
    num_samples: int

    # Example translations (first 5)
    examples: List[Dict[str, str]] = None


class ModelEvaluator:
    """
    Evaluate translation models on standard benchmarks.

    Compares:
    - Baseline M2M-100-418M
    - Fine-tuned LoRA model
    """

    def __init__(
        self,
        baseline_model_path: str = "models/m2m100_418M",
        finetuned_model_path: Optional[str] = None,
        device: str = "cuda"
    ):
        self.baseline_model_path = baseline_model_path
        self.finetuned_model_path = finetuned_model_path
        self.device = device

        # Metrics
        self.bleu_metric = evaluate.load("sacrebleu")
        self.chrf_metric = evaluate.load("chrf")

    def load_model(
        self,
        model_path: str,
        is_lora: bool = False,
        lora_path: Optional[str] = None
    ) -> Tuple[M2M100ForConditionalGeneration, M2M100Tokenizer]:
        """Load model and tokenizer."""
        print(f"\nLoading model from {model_path}...")

        tokenizer = M2M100Tokenizer.from_pretrained(model_path)

        if is_lora and lora_path:
            # Load base model + LoRA adapter
            base_model = M2M100ForConditionalGeneration.from_pretrained(
                model_path,
                torch_dtype=torch.float16
            )
            model = PeftModel.from_pretrained(base_model, lora_path)
            print(f"Loaded LoRA adapter from {lora_path}")
        else:
            # Load standard model
            model = M2M100ForConditionalGeneration.from_pretrained(model_path)

        model.to(self.device)
        model.eval()

        if self.device == "cuda":
            vram_mb = torch.cuda.memory_allocated() / 1024 / 1024
            print(f"VRAM usage: {vram_mb:.1f} MB")

        return model, tokenizer

    def load_flores200_devtest(
        self,
        source_lang: str,
        target_lang: str,
        data_dir: str = "data/translation/raw/flores200"
    ) -> List[Dict[str, str]]:
        """
        Load Flores-200 devtest data.

        Returns:
            List of dicts with source_text, target_text
        """
        flores_dir = Path(data_dir) / "devtest"

        # Map language codes to Flores codes (they use different format)
        flores_codes = {
            "en": "eng_Latn",
            "es": "spa_Latn",
            "fr": "fra_Latn",
            "de": "deu_Latn",
            "ru": "rus_Cyrl",
            "zh": "zho_Hans",
            "ja": "jpn_Jpan",
            "ko": "kor_Hang",
            "ar": "arb_Arab",
            "pt": "por_Latn",
            "fi": "fin_Latn"
        }

        src_code = flores_codes.get(source_lang, source_lang)
        tgt_code = flores_codes.get(target_lang, target_lang)

        src_file = flores_dir / f"devtest.{src_code}"
        tgt_file = flores_dir / f"devtest.{tgt_code}"

        if not src_file.exists() or not tgt_file.exists():
            print(f"Warning: Flores-200 files not found for {source_lang}-{target_lang}")
            return []

        # Load parallel lines
        samples = []
        with open(src_file, 'r', encoding='utf-8') as f_src:
            with open(tgt_file, 'r', encoding='utf-8') as f_tgt:
                for src_line, tgt_line in zip(f_src, f_tgt):
                    samples.append({
                        "source_text": src_line.strip(),
                        "target_text": tgt_line.strip(),
                        "source_lang": source_lang,
                        "target_lang": target_lang
                    })

        print(f"Loaded {len(samples)} Flores-200 devtest samples for {source_lang}→{target_lang}")
        return samples

    def load_custom_test_set(
        self,
        test_file: str
    ) -> List[Dict[str, str]]:
        """Load custom test set from JSONL."""
        samples = []
        with open(test_file, 'r', encoding='utf-8') as f:
            for line in f:
                samples.append(json.loads(line))

        print(f"Loaded {len(samples)} samples from {test_file}")
        return samples

    def translate_batch(
        self,
        model: M2M100ForConditionalGeneration,
        tokenizer: M2M100Tokenizer,
        texts: List[str],
        source_lang: str,
        target_lang: str,
        max_length: int = 128,
        num_beams: int = 5
    ) -> Tuple[List[str], List[float]]:
        """
        Translate a batch of texts.

        Returns:
            (translations, inference_times_ms)
        """
        tokenizer.src_lang = source_lang

        # Tokenize
        inputs = tokenizer(
            texts,
            return_tensors="pt",
            max_length=max_length,
            truncation=True,
            padding=True
        ).to(self.device)

        # Translate
        start_time = time.time()
        with torch.no_grad():
            generated_tokens = model.generate(
                **inputs,
                forced_bos_token_id=tokenizer.get_lang_id(target_lang),
                num_beams=num_beams,
                max_length=max_length
            )
        inference_time = (time.time() - start_time) * 1000

        # Decode
        translations = tokenizer.batch_decode(
            generated_tokens,
            skip_special_tokens=True
        )

        # Per-sample time (approximation)
        per_sample_time = inference_time / len(texts)
        inference_times = [per_sample_time] * len(texts)

        return translations, inference_times

    def evaluate_model(
        self,
        model: M2M100ForConditionalGeneration,
        tokenizer: M2M100Tokenizer,
        test_samples: List[Dict[str, str]],
        model_name: str,
        test_set_name: str,
        batch_size: int = 16
    ) -> EvaluationResult:
        """
        Evaluate model on test set.

        Returns:
            EvaluationResult with all metrics
        """
        print(f"\n{'='*60}")
        print(f"Evaluating {model_name} on {test_set_name}")
        print(f"{'='*60}\n")

        # Get language pair (assume all samples have same pair)
        source_lang = test_samples[0]["source_lang"]
        target_lang = test_samples[0]["target_lang"]
        language_pair = f"{source_lang}→{target_lang}"

        # Prepare data
        source_texts = [s["source_text"] for s in test_samples]
        reference_texts = [s["target_text"] for s in test_samples]

        # Translate in batches
        all_predictions = []
        all_inference_times = []

        for i in tqdm(range(0, len(source_texts), batch_size), desc="Translating"):
            batch_sources = source_texts[i:i+batch_size]

            predictions, inf_times = self.translate_batch(
                model,
                tokenizer,
                batch_sources,
                source_lang,
                target_lang
            )

            all_predictions.extend(predictions)
            all_inference_times.extend(inf_times)

        # Compute BLEU
        bleu_result = self.bleu_metric.compute(
            predictions=all_predictions,
            references=[[ref] for ref in reference_texts]
        )

        # Compute chrF++
        chrf_result = self.chrf_metric.compute(
            predictions=all_predictions,
            references=reference_texts
        )

        # Compute performance metrics
        avg_inference_ms = np.mean(all_inference_times)
        tokens_per_sec = 1000 / avg_inference_ms if avg_inference_ms > 0 else 0

        # VRAM usage
        vram_mb = 0
        if self.device == "cuda":
            vram_mb = torch.cuda.memory_allocated() / 1024 / 1024

        # Collect examples (first 5)
        examples = []
        for i in range(min(5, len(test_samples))):
            examples.append({
                "source": source_texts[i],
                "reference": reference_texts[i],
                "prediction": all_predictions[i]
            })

        # Create result
        result = EvaluationResult(
            model_name=model_name,
            test_set=test_set_name,
            language_pair=language_pair,
            bleu_score=bleu_result["score"],
            chrf_score=chrf_result["score"],
            avg_inference_ms=avg_inference_ms,
            tokens_per_sec=tokens_per_sec,
            vram_mb=vram_mb,
            num_samples=len(test_samples),
            examples=examples
        )

        # Print summary
        print(f"\nResults for {model_name}:")
        print(f"  BLEU: {result.bleu_score:.2f}")
        print(f"  chrF++: {result.chrf_score:.2f}")
        print(f"  Avg inference: {result.avg_inference_ms:.1f} ms")
        print(f"  Tokens/sec: {result.tokens_per_sec:.1f}")
        print(f"  VRAM: {result.vram_mb:.1f} MB")

        return result

    def compare_models(
        self,
        test_samples: List[Dict[str, str]],
        test_set_name: str = "flores200_devtest",
        output_dir: str = "reports"
    ) -> Dict[str, EvaluationResult]:
        """
        Compare baseline vs fine-tuned model.

        Returns:
            Dict with results for each model
        """
        results = {}

        # Evaluate baseline
        baseline_model, baseline_tokenizer = self.load_model(self.baseline_model_path)
        baseline_result = self.evaluate_model(
            baseline_model,
            baseline_tokenizer,
            test_samples,
            "M2M-100-418M (baseline)",
            test_set_name
        )
        results["baseline"] = baseline_result

        # Free baseline model
        del baseline_model
        torch.cuda.empty_cache()

        # Evaluate fine-tuned (if available)
        if self.finetuned_model_path:
            finetuned_model, finetuned_tokenizer = self.load_model(
                self.baseline_model_path,
                is_lora=True,
                lora_path=self.finetuned_model_path
            )
            finetuned_result = self.evaluate_model(
                finetuned_model,
                finetuned_tokenizer,
                test_samples,
                "M2M-100-418M (fine-tuned)",
                test_set_name
            )
            results["finetuned"] = finetuned_result

            # Free fine-tuned model
            del finetuned_model
            torch.cuda.empty_cache()

        # Generate comparison report
        self.generate_report(results, output_dir)

        return results

    def generate_report(
        self,
        results: Dict[str, EvaluationResult],
        output_dir: str = "reports"
    ):
        """Generate markdown comparison report."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        report_file = output_path / "baseline_vs_finetuned.md"

        with open(report_file, 'w') as f:
            f.write("# Windy Pro Translation - Model Comparison Report\n\n")
            f.write(f"**Test Set:** {results['baseline'].test_set}\n")
            f.write(f"**Language Pair:** {results['baseline'].language_pair}\n")
            f.write(f"**Samples:** {results['baseline'].num_samples:,}\n\n")

            f.write("## Results Summary\n\n")
            f.write("| Model | BLEU | chrF++ | Inference (ms) | Tokens/sec | VRAM (MB) |\n")
            f.write("|-------|------|--------|----------------|------------|----------|\n")

            for model_type, result in results.items():
                f.write(f"| {result.model_name} | {result.bleu_score:.2f} | {result.chrf_score:.2f} | "
                       f"{result.avg_inference_ms:.1f} | {result.tokens_per_sec:.1f} | {result.vram_mb:.1f} |\n")

            # Improvement metrics (if fine-tuned available)
            if "finetuned" in results:
                baseline = results["baseline"]
                finetuned = results["finetuned"]

                bleu_improvement = finetuned.bleu_score - baseline.bleu_score
                chrf_improvement = finetuned.chrf_score - baseline.chrf_score

                f.write(f"\n## Improvement\n\n")
                f.write(f"- **BLEU:** {bleu_improvement:+.2f} points\n")
                f.write(f"- **chrF++:** {chrf_improvement:+.2f} points\n\n")

            # Examples
            f.write("## Translation Examples\n\n")
            for model_type, result in results.items():
                f.write(f"### {result.model_name}\n\n")
                for i, example in enumerate(result.examples[:3], 1):
                    f.write(f"**Example {i}:**\n")
                    f.write(f"- Source: {example['source']}\n")
                    f.write(f"- Reference: {example['reference']}\n")
                    f.write(f"- Translation: {example['prediction']}\n\n")

        print(f"\nComparison report saved to {report_file}")

        # Save JSON results
        json_file = output_path / "evaluation_results.json"
        results_dict = {k: asdict(v) for k, v in results.items()}
        with open(json_file, 'w') as f:
            json.dump(results_dict, f, indent=2)
        print(f"JSON results saved to {json_file}")


def main():
    """CLI for model evaluation."""
    import argparse

    parser = argparse.ArgumentParser(description="Evaluate translation models")
    parser.add_argument(
        "--baseline",
        default="models/m2m100_418M",
        help="Path to baseline model"
    )
    parser.add_argument(
        "--finetuned",
        default=None,
        help="Path to fine-tuned LoRA adapter"
    )
    parser.add_argument(
        "--test-set",
        default="flores200",
        choices=["flores200", "custom"],
        help="Test set to use"
    )
    parser.add_argument(
        "--custom-test-file",
        help="Path to custom test JSONL file"
    )
    parser.add_argument(
        "--source-lang",
        default="en",
        help="Source language"
    )
    parser.add_argument(
        "--target-lang",
        default="es",
        help="Target language"
    )
    parser.add_argument(
        "--output-dir",
        default="reports",
        help="Output directory for reports"
    )

    args = parser.parse_args()

    # Initialize evaluator
    evaluator = ModelEvaluator(
        baseline_model_path=args.baseline,
        finetuned_model_path=args.finetuned
    )

    # Load test set
    if args.test_set == "flores200":
        test_samples = evaluator.load_flores200_devtest(
            args.source_lang,
            args.target_lang
        )
        test_set_name = f"flores200_devtest_{args.source_lang}_{args.target_lang}"
    else:
        if not args.custom_test_file:
            print("Error: --custom-test-file required for custom test set")
            return
        test_samples = evaluator.load_custom_test_set(args.custom_test_file)
        test_set_name = Path(args.custom_test_file).stem

    if not test_samples:
        print("No test samples loaded. Exiting.")
        return

    # Run comparison
    results = evaluator.compare_models(
        test_samples,
        test_set_name,
        args.output_dir
    )

    print("\nEvaluation complete!")


if __name__ == "__main__":
    main()
