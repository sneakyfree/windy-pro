"""
Windy Pro - Translation Dataset Curator
Downloads and preprocesses parallel corpora for M2M-100 fine-tuning.

Sources (MIT/Apache/CC-BY licensed):
- OPUS collections: Tatoeba, OpenSubtitles2018, GNOME, Ubuntu, KDE
- Flores-200 dev/devtest (Facebook)
- TED talks parallel corpus

Target: 50k-200k high-quality sentence pairs per language direction
Focus: conversational speech, business/professional, proper nouns, technical
"""

import json
import re
import hashlib
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, asdict
from collections import defaultdict
import urllib.request
import gzip
import zipfile
import tarfile


@dataclass
class ParallelSentence:
    """A single parallel sentence pair."""
    source_text: str
    target_text: str
    source_lang: str
    target_lang: str
    source: str  # Dataset source name
    quality_score: float = 1.0


class DatasetCurator:
    """
    Curates high-quality parallel corpora for translation fine-tuning.

    Priority language pairs:
    - en ↔ ru, fi, pt, es, fr, de, zh, ja, ko, ar (20 directions)
    """

    # Priority languages
    PRIORITY_LANGS = ["en", "ru", "fi", "pt", "es", "fr", "de", "zh", "ja", "ko", "ar"]

    # OPUS dataset URLs (MIT/Apache licensed)
    OPUS_DATASETS = {
        "tatoeba": "https://object.pouta.csc.fi/OPUS-Tatoeba/v2023-04-12/moses/{src}-{tgt}.txt.zip",
        "opensubtitles": "https://object.pouta.csc.fi/OPUS-OpenSubtitles/v2018/moses/{src}-{tgt}.txt.zip",
        "gnome": "https://object.pouta.csc.fi/OPUS-GNOME/v1/moses/{src}-{tgt}.txt.zip",
        "ubuntu": "https://object.pouta.csc.fi/OPUS-Ubuntu/v14.10/moses/{src}-{tgt}.txt.zip",
        "kde4": "https://object.pouta.csc.fi/OPUS-KDE4/v2/moses/{src}-{tgt}.txt.zip"
    }

    # Quality thresholds
    MIN_LENGTH = 5  # Minimum tokens
    MAX_LENGTH = 200  # Maximum tokens
    MIN_QUALITY_SCORE = 0.5

    def __init__(self, output_dir: str = "data/translation"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.raw_dir = self.output_dir / "raw"
        self.raw_dir.mkdir(exist_ok=True)
        self.processed_dir = self.output_dir / "processed"
        self.processed_dir.mkdir(exist_ok=True)

        # Deduplication tracking
        self.seen_hashes = defaultdict(set)

    def download_opus_dataset(
        self,
        dataset_name: str,
        source_lang: str,
        target_lang: str
    ) -> Optional[Tuple[Path, Path]]:
        """
        Download parallel corpus from OPUS.

        Returns:
            Tuple of (source_file, target_file) paths, or None if failed
        """
        # Normalize language pair (OPUS uses alphabetical order)
        lang_pair = tuple(sorted([source_lang, target_lang]))
        url_template = self.OPUS_DATASETS.get(dataset_name)

        if not url_template:
            print(f"Unknown dataset: {dataset_name}")
            return None

        url = url_template.format(src=lang_pair[0], tgt=lang_pair[1])
        zip_path = self.raw_dir / f"{dataset_name}_{lang_pair[0]}-{lang_pair[1]}.zip"

        # Download if not cached
        if not zip_path.exists():
            print(f"Downloading {dataset_name} {lang_pair[0]}-{lang_pair[1]}...")
            try:
                urllib.request.urlretrieve(url, zip_path)
                print(f"  Downloaded to {zip_path}")
            except Exception as e:
                print(f"  Failed to download: {e}")
                return None
        else:
            print(f"Using cached {zip_path}")

        # Extract zip
        extract_dir = self.raw_dir / f"{dataset_name}_{lang_pair[0]}-{lang_pair[1]}"
        extract_dir.mkdir(exist_ok=True)

        try:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)
        except Exception as e:
            print(f"  Failed to extract: {e}")
            return None

        # Find the source and target files
        src_file = None
        tgt_file = None

        for file in extract_dir.rglob("*.txt"):
            if f".{source_lang}" in file.name:
                src_file = file
            elif f".{target_lang}" in file.name:
                tgt_file = file

        if src_file and tgt_file:
            return (src_file, tgt_file)

        print(f"  Could not find parallel files in {extract_dir}")
        return None

    def download_flores200(self) -> Optional[Path]:
        """
        Download Flores-200 dev/devtest dataset.

        Returns:
            Path to extracted flores directory
        """
        url = "https://github.com/facebookresearch/flores/raw/main/flores200/dev.tar.gz"
        devtest_url = "https://github.com/facebookresearch/flores/raw/main/flores200/devtest.tar.gz"

        flores_dir = self.raw_dir / "flores200"
        flores_dir.mkdir(exist_ok=True)

        # Download dev and devtest
        for name, flores_url in [("dev", url), ("devtest", devtest_url)]:
            tar_path = flores_dir / f"{name}.tar.gz"

            if not tar_path.exists():
                print(f"Downloading Flores-200 {name}...")
                try:
                    urllib.request.urlretrieve(flores_url, tar_path)
                    print(f"  Downloaded to {tar_path}")
                except Exception as e:
                    print(f"  Failed to download: {e}")
                    continue

            # Extract
            try:
                with tarfile.open(tar_path, 'r:gz') as tar:
                    tar.extractall(flores_dir)
                print(f"  Extracted {name}")
            except Exception as e:
                print(f"  Failed to extract: {e}")

        return flores_dir

    def clean_text(self, text: str) -> str:
        """Clean and normalize text."""
        # Remove excessive whitespace
        text = re.sub(r'\s+', ' ', text)
        text = text.strip()

        # Remove control characters
        text = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', text)

        return text

    def compute_quality_score(self, src_text: str, tgt_text: str) -> float:
        """
        Compute quality score for a sentence pair.

        Checks:
        - Length ratio (source vs target)
        - Character diversity
        - No excessive punctuation
        - No URLs or emails
        """
        score = 1.0

        # Length ratio check (should be within 0.5 to 2.0)
        src_len = len(src_text.split())
        tgt_len = len(tgt_text.split())

        if src_len == 0 or tgt_len == 0:
            return 0.0

        length_ratio = max(src_len, tgt_len) / min(src_len, tgt_len)
        if length_ratio > 3.0:
            score *= 0.5
        elif length_ratio > 2.0:
            score *= 0.7

        # Check for URLs or emails
        if re.search(r'http[s]?://|www\.|@\w+\.\w+', src_text + tgt_text):
            score *= 0.5

        # Excessive punctuation check
        punct_ratio = sum(c in '!?.,:;' for c in src_text) / max(len(src_text), 1)
        if punct_ratio > 0.3:
            score *= 0.6

        # Character diversity (avoid repeated characters like "aaaaaaa")
        unique_chars = len(set(src_text.lower()))
        if unique_chars < 5:
            score *= 0.3

        return score

    def deduplicate_hash(self, src_text: str, tgt_text: str, lang_pair: str) -> bool:
        """
        Check if sentence pair is duplicate using hash.

        Returns:
            True if new (not duplicate), False if duplicate
        """
        combined = f"{src_text}|||{tgt_text}"
        text_hash = hashlib.md5(combined.encode()).hexdigest()

        if text_hash in self.seen_hashes[lang_pair]:
            return False

        self.seen_hashes[lang_pair].add(text_hash)
        return True

    def process_parallel_file(
        self,
        src_file: Path,
        tgt_file: Path,
        source_lang: str,
        target_lang: str,
        dataset_name: str,
        max_pairs: int = 200000
    ) -> List[ParallelSentence]:
        """
        Process parallel text files into cleaned sentence pairs.

        Returns:
            List of ParallelSentence objects
        """
        sentences = []
        lang_pair = f"{source_lang}_{target_lang}"

        print(f"Processing {dataset_name} {source_lang}→{target_lang}...")

        try:
            with open(src_file, 'r', encoding='utf-8') as f_src:
                with open(tgt_file, 'r', encoding='utf-8') as f_tgt:
                    for i, (src_line, tgt_line) in enumerate(zip(f_src, f_tgt)):
                        if i >= max_pairs:
                            break

                        # Clean text
                        src_clean = self.clean_text(src_line)
                        tgt_clean = self.clean_text(tgt_line)

                        # Length filtering
                        src_tokens = len(src_clean.split())
                        tgt_tokens = len(tgt_clean.split())

                        if (src_tokens < self.MIN_LENGTH or src_tokens > self.MAX_LENGTH or
                            tgt_tokens < self.MIN_LENGTH or tgt_tokens > self.MAX_LENGTH):
                            continue

                        # Quality filtering
                        quality = self.compute_quality_score(src_clean, tgt_clean)
                        if quality < self.MIN_QUALITY_SCORE:
                            continue

                        # Deduplication
                        if not self.deduplicate_hash(src_clean, tgt_clean, lang_pair):
                            continue

                        sentences.append(ParallelSentence(
                            source_text=src_clean,
                            target_text=tgt_clean,
                            source_lang=source_lang,
                            target_lang=target_lang,
                            source=dataset_name,
                            quality_score=quality
                        ))

            print(f"  Extracted {len(sentences)} high-quality pairs")

        except Exception as e:
            print(f"  Error processing files: {e}")

        return sentences

    def curate_language_pair(
        self,
        source_lang: str,
        target_lang: str,
        target_count: int = 100000
    ) -> List[ParallelSentence]:
        """
        Curate dataset for a specific language pair.

        Downloads from multiple sources and combines them.
        """
        all_sentences = []
        lang_pair = f"{source_lang}_{target_lang}"

        print(f"\n{'='*60}")
        print(f"Curating {source_lang} → {target_lang}")
        print(f"Target: {target_count:,} sentence pairs")
        print(f"{'='*60}\n")

        # Try each OPUS dataset
        for dataset_name in self.OPUS_DATASETS.keys():
            if len(all_sentences) >= target_count:
                break

            result = self.download_opus_dataset(dataset_name, source_lang, target_lang)
            if result:
                src_file, tgt_file = result
                sentences = self.process_parallel_file(
                    src_file,
                    tgt_file,
                    source_lang,
                    target_lang,
                    dataset_name,
                    max_pairs=target_count
                )
                all_sentences.extend(sentences)

        print(f"\nTotal collected: {len(all_sentences):,} pairs")

        # Sort by quality score (descending)
        all_sentences.sort(key=lambda s: s.quality_score, reverse=True)

        # Take top N
        final_sentences = all_sentences[:target_count]

        return final_sentences

    def save_dataset(self, sentences: List[ParallelSentence], output_name: str):
        """Save dataset as JSON lines."""
        output_path = self.processed_dir / f"{output_name}.jsonl"

        print(f"\nSaving to {output_path}...")

        with open(output_path, 'w', encoding='utf-8') as f:
            for sentence in sentences:
                f.write(json.dumps(asdict(sentence), ensure_ascii=False) + '\n')

        print(f"Saved {len(sentences):,} pairs")

        # Save statistics
        stats = {
            "total_pairs": len(sentences),
            "language_pair": f"{sentences[0].source_lang}_{sentences[0].target_lang}",
            "avg_quality": sum(s.quality_score for s in sentences) / len(sentences),
            "sources": list(set(s.source for s in sentences))
        }

        stats_path = self.processed_dir / f"{output_name}_stats.json"
        with open(stats_path, 'w') as f:
            json.dumps(stats, f, indent=2)

        return output_path

    def curate_all_priority_pairs(self, pairs_per_direction: int = 100000):
        """
        Curate datasets for all priority language pairs.

        Focuses on bidirectional pairs with English.
        """
        # Generate language pairs (bidirectional with en)
        pairs = []
        for lang in self.PRIORITY_LANGS:
            if lang != "en":
                pairs.append(("en", lang))
                pairs.append((lang, "en"))

        print(f"\n{'='*60}")
        print(f"WINDY PRO - DATASET CURATION")
        print(f"{'='*60}")
        print(f"Priority languages: {', '.join(self.PRIORITY_LANGS)}")
        print(f"Total language pairs: {len(pairs)}")
        print(f"Target per pair: {pairs_per_direction:,}")
        print(f"Total target: {len(pairs) * pairs_per_direction:,}")
        print(f"{'='*60}\n")

        results = {}

        for src_lang, tgt_lang in pairs:
            try:
                sentences = self.curate_language_pair(src_lang, tgt_lang, pairs_per_direction)

                if sentences:
                    output_name = f"{src_lang}_{tgt_lang}"
                    output_path = self.save_dataset(sentences, output_name)
                    results[f"{src_lang}→{tgt_lang}"] = {
                        "path": str(output_path),
                        "count": len(sentences)
                    }

            except Exception as e:
                print(f"\nError curating {src_lang}→{tgt_lang}: {e}")
                continue

        # Save summary
        summary_path = self.output_dir / "curation_summary.json"
        with open(summary_path, 'w') as f:
            json.dump(results, f, indent=2)

        print(f"\n{'='*60}")
        print(f"CURATION COMPLETE")
        print(f"Summary saved to {summary_path}")
        print(f"{'='*60}\n")

        return results


def main():
    """CLI for dataset curation."""
    import argparse

    parser = argparse.ArgumentParser(description="Curate translation datasets")
    parser.add_argument(
        "--output-dir",
        default="data/translation",
        help="Output directory for datasets"
    )
    parser.add_argument(
        "--pairs-per-direction",
        type=int,
        default=100000,
        help="Target number of pairs per language direction"
    )
    parser.add_argument(
        "--language-pair",
        help="Single language pair to curate (e.g., en-es)"
    )

    args = parser.parse_args()

    curator = DatasetCurator(output_dir=args.output_dir)

    if args.language_pair:
        # Curate single pair
        src, tgt = args.language_pair.split('-')
        sentences = curator.curate_language_pair(src, tgt, args.pairs_per_direction)
        curator.save_dataset(sentences, f"{src}_{tgt}")
    else:
        # Curate all priority pairs
        curator.curate_all_priority_pairs(args.pairs_per_direction)


if __name__ == "__main__":
    main()
