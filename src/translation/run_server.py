"""
Launcher script for translation server.
Handles imports correctly and supports model selection.

Usage:
    # Base model (default)
    python run_server.py

    # Fine-tuned merged model
    python run_server.py --model-type finetuned

    # LoRA adapter
    python run_server.py --model-type lora --lora-adapter models/windy_translate_lora/final_model

    # Custom model path
    python run_server.py --model-path models/custom_model

Examples:
    # Run with fine-tuned Windy Translate Spark model
    python run_server.py --model-type finetuned

    # Run with LoRA adapter on base model
    python run_server.py --model-type lora --lora-adapter models/windy_translate_lora/checkpoint-5000
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.translation.server import main
import asyncio

if __name__ == "__main__":
    asyncio.run(main())
