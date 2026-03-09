"""
Windy Pro - Translation Test Client
Tests the translation WebSocket server with sample translations.
"""

import asyncio
import json
import time
import sys
from typing import Optional

try:
    import websockets
except ImportError:
    print("Install websockets: pip install websockets")
    sys.exit(1)


class TranslationClient:
    """WebSocket client for testing translation server."""

    def __init__(self, host: str = "127.0.0.1", port: int = 9877):
        self.url = f"ws://{host}:{port}"
        self.ws = None

    async def connect(self):
        """Connect to the translation server."""
        print(f"Connecting to {self.url}...")
        self.ws = await websockets.connect(self.url)

        # Receive welcome message
        welcome = await self.ws.recv()
        welcome_data = json.loads(welcome)
        print(f"Connected: {welcome_data}\n")
        return welcome_data

    async def health_check(self):
        """Check server health."""
        print("Health check...")
        await self.ws.send(json.dumps({"type": "health"}))
        response = await self.ws.recv()
        data = json.loads(response)
        print(f"Health: {json.dumps(data, indent=2)}\n")
        return data

    async def translate(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        verbose: bool = True
    ) -> Optional[dict]:
        """
        Translate text and return result.

        Args:
            text: Text to translate
            source_lang: Source language code (or "auto")
            target_lang: Target language code
            verbose: Whether to print detailed output
        """
        start_time = time.time()

        request = {
            "text": text,
            "source_lang": source_lang,
            "target_lang": target_lang
        }

        await self.ws.send(json.dumps(request))
        response = await self.ws.recv()
        data = json.loads(response)

        round_trip_ms = int((time.time() - start_time) * 1000)

        if verbose:
            if "error" in data:
                print(f"❌ Error: {data['error']}")
            else:
                print(f"✅ {source_lang} → {target_lang}")
                print(f"   Input:  {text}")
                print(f"   Output: {data['translated_text']}")
                print(f"   Inference: {data.get('inference_ms', 0)}ms | Round-trip: {round_trip_ms}ms")
                if "tokens_per_sec" in data:
                    print(f"   Speed: {data['tokens_per_sec']} tokens/sec")
                print()

        return data

    async def close(self):
        """Close the connection."""
        if self.ws:
            await self.ws.close()


async def run_basic_tests():
    """Run basic translation tests."""
    client = TranslationClient()

    await client.connect()
    await client.health_check()

    print("="*60)
    print("Running basic translation tests...")
    print("="*60 + "\n")

    # Test cases
    tests = [
        ("Hello, how are you?", "en", "es"),
        ("Good morning", "en", "ru"),
        ("Thank you very much", "en", "ja"),
        ("I love programming", "en", "de"),
        ("The weather is nice today", "en", "fr"),
    ]

    for text, src, tgt in tests:
        await client.translate(text, src, tgt)
        await asyncio.sleep(0.1)  # Small delay between requests

    await client.close()
    print("Tests completed!")


async def run_language_pair_tests():
    """Run tests for the 10 required language pairs."""
    client = TranslationClient()

    await client.connect()

    print("="*60)
    print("Testing 10 Required Language Pairs")
    print("="*60 + "\n")

    test_pairs = [
        # English ↔ Russian
        ("Hello, my name is John.", "en", "ru"),
        ("Привет, как дела?", "ru", "en"),

        # Portuguese ↔ Finnish
        ("Bom dia, como vai?", "pt", "fi"),
        ("Hyvää huomenta, kuinka voit?", "fi", "pt"),

        # English ↔ Spanish
        ("The weather is beautiful today.", "en", "es"),
        ("Me gusta mucho la música.", "es", "en"),

        # Chinese → English
        ("你好，很高兴见到你。", "zh", "en"),

        # English → Arabic
        ("Welcome to our company.", "en", "ar"),

        # Japanese → German
        ("こんにちは、元気ですか？", "ja", "de"),

        # Korean → French
        ("안녕하세요, 만나서 반갑습니다.", "ko", "fr"),
    ]

    results = []
    for text, src, tgt in test_pairs:
        result = await client.translate(text, src, tgt)
        results.append(result)
        await asyncio.sleep(0.1)

    await client.close()

    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    successful = sum(1 for r in results if "error" not in r)
    avg_inference_ms = sum(r.get("inference_ms", 0) for r in results if "error" not in r) / max(successful, 1)
    print(f"Successful translations: {successful}/{len(results)}")
    print(f"Average inference time: {avg_inference_ms:.1f}ms")
    print()


async def interactive_mode():
    """Interactive translation mode."""
    client = TranslationClient()
    await client.connect()
    await client.health_check()

    print("="*60)
    print("Interactive Translation Mode")
    print("Commands: 'quit' to exit, 'help' for help")
    print("="*60 + "\n")

    while True:
        try:
            text = input("Text to translate (or 'quit'): ").strip()
            if text.lower() == "quit":
                break
            if text.lower() == "help":
                print("Enter text to translate, then specify source and target languages.")
                print("Use 'auto' for automatic language detection.")
                print("Example: en → es (English to Spanish)")
                continue
            if not text:
                continue

            source_lang = input("Source language (or 'auto'): ").strip() or "auto"
            target_lang = input("Target language: ").strip() or "en"

            await client.translate(text, source_lang, target_lang)

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"Error: {e}\n")

    await client.close()
    print("\nGoodbye!")


async def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Windy Pro Translation Test Client")
    parser.add_argument("--mode", choices=["basic", "pairs", "interactive"], default="basic",
                        help="Test mode (default: basic)")
    parser.add_argument("--host", default="127.0.0.1", help="Server host")
    parser.add_argument("--port", type=int, default=9877, help="Server port")
    args = parser.parse_args()

    if args.mode == "basic":
        await run_basic_tests()
    elif args.mode == "pairs":
        await run_language_pair_tests()
    elif args.mode == "interactive":
        await interactive_mode()


if __name__ == "__main__":
    asyncio.run(main())
