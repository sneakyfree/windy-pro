"""
Windy Pro Translation Engine
Text-to-text translation powered by Meta's M2M-100.
"""

from .translator import Translator, TranslationConfig
from .server import TranslationServer

__version__ = "0.1.0"
__all__ = ["Translator", "TranslationConfig", "TranslationServer"]
