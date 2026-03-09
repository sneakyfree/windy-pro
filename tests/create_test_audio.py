#!/usr/bin/env python3
"""Create test audio files from LibriSpeech dataset for model QA testing."""

from datasets import load_dataset
import soundfile as sf

print("Loading LibriSpeech test-clean dataset...")
ds = load_dataset('librispeech_asr', 'clean', split='test', streaming=True)

# Get first sample (short, ~10 seconds)
print("\nFetching short test sample...")
sample_iter = iter(ds)
short_sample = next(sample_iter)

# Save short audio
audio_data = short_sample['audio']['array']
sample_rate = short_sample['audio']['sampling_rate']
ground_truth_short = short_sample['text']

print(f"Short sample duration: {len(audio_data) / sample_rate:.2f} seconds")
print(f"Ground truth text: {ground_truth_short}")

sf.write('tests/audio/test_short.wav', audio_data, sample_rate)
with open('tests/audio/test_short_groundtruth.txt', 'w') as f:
    f.write(ground_truth_short)

# Get a longer sample (~30-60 seconds)
print("\nSearching for longer test sample...")
long_sample = None
for sample in sample_iter:
    duration = len(sample['audio']['array']) / sample['audio']['sampling_rate']
    if 25 < duration < 70:
        long_sample = sample
        print(f"Found sample with duration: {duration:.2f} seconds")
        break

if long_sample:
    audio_data_long = long_sample['audio']['array']
    sample_rate_long = long_sample['audio']['sampling_rate']
    ground_truth_long = long_sample['text']

    print(f"Ground truth text: {ground_truth_long[:100]}...")

    sf.write('tests/audio/test_long.wav', audio_data_long, sample_rate_long)
    with open('tests/audio/test_long_groundtruth.txt', 'w') as f:
        f.write(ground_truth_long)
else:
    print("Could not find suitable long sample, using short sample for both tests")

print("\n✓ Test audio files created successfully!")
print("  - tests/audio/test_short.wav")
print("  - tests/audio/test_short_groundtruth.txt")
if long_sample:
    print("  - tests/audio/test_long.wav")
    print("  - tests/audio/test_long_groundtruth.txt")
