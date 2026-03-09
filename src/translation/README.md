# Windy Pro Translation Engine

Proprietary text-to-text translation engine for Windy Pro, powered by Meta's M2M-100 model.

## Features

- **100 languages, 9,900 language pairs** using M2M-100-418M
- **WebSocket API** on port 9877
- **GPU-accelerated** by default with CPU fallback
- **Auto language detection** (source_lang: "auto")
- **Low latency** for real-time translation
- **MIT licensed** base model (facebook/m2m100_418M)

## Architecture

```
windy-pro/
  src/translation/
    server.py          # WebSocket server (port 9877)
    translator.py      # Core translation logic
    test_client.py     # Test client
    benchmark.py       # Benchmark script
    download_model.py  # Model downloader
    requirements.txt   # Dependencies
  models/
    m2m100_418M/       # Downloaded model
```

## Installation

1. Install dependencies:
```bash
cd src/translation
pip install -r requirements.txt
```

2. Download the M2M-100-418M model:
```bash
python3 download_model.py
```

This will download ~1.8GB to `models/m2m100_418M/`.

## Usage

### Start the Server

```bash
python3 -m src.translation.server
```

Or with custom options:
```bash
python3 -m src.translation.server --host 127.0.0.1 --port 9877 --device cuda
```

The server will:
- Load the M2M-100-418M model
- Start WebSocket server on port 9877
- Display device info (cuda/cpu) and VRAM usage

### Test the Server

Run basic tests:
```bash
python3 src/translation/test_client.py --mode basic
```

Test all 10 required language pairs:
```bash
python3 src/translation/test_client.py --mode pairs
```

Interactive mode:
```bash
python3 src/translation/test_client.py --mode interactive
```

### Run Benchmark

```bash
python3 src/translation/benchmark.py
```

This will:
- Test 10 language pairs
- Measure inference speed, latency, VRAM usage
- Generate a markdown report (`benchmark_report.md`)

## API Protocol

### Translation Request

```json
{
  "text": "Hello, how are you?",
  "source_lang": "en",
  "target_lang": "es"
}
```

Use `"source_lang": "auto"` for automatic language detection.

### Translation Response

```json
{
  "type": "translation",
  "translated_text": "Hola, ¿cómo estás?",
  "source_lang": "en",
  "target_lang": "es",
  "model": "m2m100_418M",
  "inference_ms": 123,
  "input_length": 21,
  "output_length": 20,
  "tokens_per_sec": 45.2
}
```

### Health Check

Request:
```json
{
  "type": "health"
}
```

Response:
```json
{
  "type": "health",
  "status": "ok",
  "server_version": "0.1.0",
  "model": "m2m100_418M",
  "model_loaded": true,
  "device": "cuda",
  "vram_usage": {
    "allocated_mb": 1234.5,
    "reserved_mb": 1400.0,
    "max_allocated_mb": 1234.5
  }
}
```

### Get Supported Languages

Request:
```json
{
  "type": "languages"
}
```

Response:
```json
{
  "type": "languages",
  "languages": ["en", "es", "fr", "de", "ru", "zh", "ja", "ko", "ar", ...]
}
```

## Supported Languages

The M2M-100-418M model supports 100 languages including:

- **European**: en, es, fr, de, it, pt, ru, nl, pl, cs, uk, ro, sv, el, hu, da, no, fi
- **Asian**: zh, ja, ko, hi, th, vi, id, ms
- **Middle Eastern**: ar, he, fa, tr
- And many more...

## Performance

On RTX 5090 (32GB VRAM):
- **Inference speed**: ~40-60 tokens/sec
- **Latency**: 100-300ms per request (depending on text length)
- **VRAM usage**: ~1.5-2GB

On CPU:
- **Inference speed**: ~5-10 tokens/sec
- **Latency**: 1-3 seconds per request

## Error Handling

Errors are returned as:
```json
{
  "type": "error",
  "error": "Error message here"
}
```

Common errors:
- `"Model not loaded"` - Server failed to load model
- `"Unsupported source language: xx"` - Invalid language code
- `"Missing or empty 'text' field"` - Empty translation request

## Integration with Windy Pro

The translation server mirrors the existing Whisper STT server architecture:
- **Whisper STT**: port 9876 (audio → text)
- **Translation**: port 9877 (text → text)

Both servers use the same WebSocket pattern for consistency.

## Development

### Project Structure

- `translator.py`: Core translation logic (model loading, inference)
- `server.py`: WebSocket server implementation
- `test_client.py`: Test client with multiple modes
- `benchmark.py`: Comprehensive benchmarking
- `download_model.py`: Model download utility

### Adding New Features

The server follows the pattern from `src/engine/server.py`. Key components:
- `TranslationServer`: WebSocket server class
- `Translator`: Model wrapper with inference logic
- `TranslationConfig`: Configuration dataclass

## License

- **Windy Pro Translation Engine**: Proprietary
- **M2M-100 base model**: MIT License (Facebook/Meta)

## Troubleshooting

### Model not loading
- Check that `models/m2m100_418M/` exists and contains the model files
- Run `python3 src/translation/download_model.py` to re-download

### Out of VRAM
- Use CPU mode: `--device cpu`
- The 418M model should fit on most GPUs with 4GB+ VRAM

### Connection refused
- Ensure the server is running: `python3 -m src.translation.server`
- Check that port 9877 is not in use: `lsof -i :9877`

## Next Steps (Future Phases)

- Fine-tuning for domain-specific translations
- Streaming translation for long texts
- Caching for common phrases
- Multi-model support (larger M2M models)
- Integration with Electron UI
