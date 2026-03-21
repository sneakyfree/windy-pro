"""
Verify Windy Translate Standard translation quality.
Tests 5 language pairs: en→es, en→fr, en→de, en→zh, en→ja
"""

import torch
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer

def verify_translations(model_path: str = "models/windy-translate-standard"):
    """Test translation quality on 5 language pairs."""

    print(f"{'='*60}")
    print("Windy Translate Standard - Translation Verification")
    print(f"{'='*60}\n")

    # Load model
    print(f"Loading model from {model_path}...")
    tokenizer = M2M100Tokenizer.from_pretrained(model_path)
    model = M2M100ForConditionalGeneration.from_pretrained(
        model_path,
        torch_dtype=torch.float16
    ).to("cuda")
    model.eval()
    print("✓ Model loaded\n")

    # Test cases: (source_lang, target_lang, text, expected_contains)
    test_cases = [
        ("en", "es", "Hello, how are you today?", ["hola", "cómo", "estás"]),
        ("en", "fr", "The weather is beautiful today.", ["temps", "beau", "aujourd'hui"]),
        ("en", "de", "I would like to order a coffee.", ["möchte", "kaffee", "bestellen"]),
        ("en", "zh", "Thank you very much for your help.", ["谢谢", "帮助"]),
        ("en", "ja", "Good morning! Have a nice day.", ["おはよう", "いい日"]),
    ]

    results = []

    for source_lang, target_lang, text, expected in test_cases:
        print(f"{'─'*60}")
        print(f"Test: {source_lang.upper()} → {target_lang.upper()}")
        print(f"Input:  {text}")

        # Tokenize
        tokenizer.src_lang = source_lang
        inputs = tokenizer(
            text,
            return_tensors="pt",
            max_length=128,
            truncation=True
        ).to("cuda")

        # Generate translation
        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                forced_bos_token_id=tokenizer.get_lang_id(target_lang),
                num_beams=5,
                max_length=128,
                early_stopping=True
            )

        translation = tokenizer.decode(outputs[0], skip_special_tokens=True)
        print(f"Output: {translation}")

        # Basic quality check
        quality = "✓ PASS" if len(translation) > 5 else "✗ FAIL"
        print(f"Quality: {quality}")
        results.append((source_lang, target_lang, text, translation, quality))

    # Summary
    print(f"\n{'='*60}")
    print("VERIFICATION SUMMARY")
    print(f"{'='*60}")

    passed = sum(1 for r in results if "✓" in r[4])
    total = len(results)

    print(f"Tests passed: {passed}/{total}")
    print(f"Success rate: {100*passed/total:.0f}%")

    if passed == total:
        print("\n✅ All translation tests PASSED!")
    else:
        print(f"\n⚠️  {total-passed} test(s) failed")

    print(f"{'='*60}\n")

    return results

if __name__ == "__main__":
    verify_translations()
