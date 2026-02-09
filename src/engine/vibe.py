"""
Windy Pro - Vibe Toggle (Grammar Correction Post-Processing)

Optional post-processing that cleans up transcription output:
- Fixes capitalization
- Adds proper punctuation
- Removes filler words (um, uh, like)
- Fixes common speech-to-text errors

DNA Strand: FEAT-067
"""

import re
from typing import Optional


class VibeProcessor:
    """
    Post-processing pipeline for transcript cleanup.
    Uses rule-based corrections (no LLM required for basic mode).
    """
    
    # Common filler words to remove
    FILLERS = {
        'um', 'uh', 'uhh', 'umm', 'hmm', 'like',
        'you know', 'i mean', 'basically', 'literally',
        'sort of', 'kind of', 'actually'
    }
    
    # Common speech-to-text misrecognitions
    CORRECTIONS = {
        r'\bwanna\b': 'want to',
        r'\bgonna\b': 'going to',
        r'\bgotta\b': 'got to',
        r'\bkinda\b': 'kind of',
        r'\bsorta\b': 'sort of',
        r'\bcuz\b': 'because',
        r'\blemme\b': 'let me',
        r'\bdunno\b': "don't know",
    }
    
    def __init__(self, settings=None):
        self.enabled = False
        self.remove_fillers = True
        self.fix_grammar = True
        self.fix_punctuation = True
        
        if settings:
            self.enabled = settings.get('vibe_enabled', False)
            self.remove_fillers = settings.get('vibe_remove_fillers', True)
            self.fix_grammar = settings.get('vibe_fix_grammar', True)
            self.fix_punctuation = settings.get('vibe_fix_punctuation', True)
    
    def process(self, text: str) -> str:
        """Apply all enabled post-processing to transcript text."""
        if not self.enabled or not text:
            return text
        
        result = text
        
        if self.remove_fillers:
            result = self._remove_fillers(result)
        
        if self.fix_grammar:
            result = self._fix_grammar(result)
        
        if self.fix_punctuation:
            result = self._fix_punctuation(result)
        
        # Final cleanup
        result = self._clean_whitespace(result)
        
        return result
    
    def _remove_fillers(self, text: str) -> str:
        """Remove filler words from text."""
        # Sort by length (longest first) to avoid partial matches
        sorted_fillers = sorted(self.FILLERS, key=len, reverse=True)
        
        for filler in sorted_fillers:
            # Match filler as whole word, case-insensitive
            pattern = r'\b' + re.escape(filler) + r'\b'
            text = re.sub(pattern, '', text, flags=re.IGNORECASE)
        
        return text
    
    def _fix_grammar(self, text: str) -> str:
        """Apply common grammar corrections."""
        for pattern, replacement in self.CORRECTIONS.items():
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
        
        return text
    
    def _fix_punctuation(self, text: str) -> str:
        """Add basic punctuation where missing."""
        # Capitalize first letter of text
        if text and text[0].islower():
            text = text[0].upper() + text[1:]
        
        # Capitalize after sentence-ending punctuation
        text = re.sub(
            r'([.!?])\s+([a-z])',
            lambda m: m.group(1) + ' ' + m.group(2).upper(),
            text
        )
        
        # Add period at end if missing punctuation
        if text and text[-1] not in '.!?':
            text += '.'
        
        return text
    
    def _clean_whitespace(self, text: str) -> str:
        """Remove extra whitespace artifacts from processing."""
        # Collapse multiple spaces
        text = re.sub(r' {2,}', ' ', text)
        # Remove space before punctuation
        text = re.sub(r' ([.!?,;:])', r'\1', text)
        # Remove leading/trailing whitespace
        text = text.strip()
        return text


def create_vibe_processor(settings: Optional[dict] = None) -> VibeProcessor:
    """Factory function for creating a VibeProcessor."""
    return VibeProcessor(settings)
