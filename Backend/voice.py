"""Local STT (faster-whisper) and TTS (Piper via ONNX) — no cloud API keys needed."""

import io
import logging
import wave
import threading
from pathlib import Path


log = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).resolve().parent / "models"

# ---------------------------------------------------------------------------
# Lazy singletons – heavy models load on first call, not at import time.
# ---------------------------------------------------------------------------

_whisper_model = None
_piper_voices = {}
_piper_lock = threading.Lock()


def _get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        log.info("Loading Whisper 'base' model (first call — may take a few seconds)…")
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
        log.info("Whisper model ready.")
    return _whisper_model


def _get_piper_voice(language: str):
    from piper import PiperVoice

    if language not in _piper_voices:
        voice_name = "hi_IN-pratham-medium" if language == "hi" else "en_IN-spicor"
        model_path = MODELS_DIR / "piper" / f"{voice_name}.onnx"
        if not model_path.exists() or not model_path.with_suffix(".onnx.json").exists():
            raise RuntimeError("Piper voice files are missing. Run Backend/download_voices.py.")
        _piper_voices[language] = PiperVoice.load(str(model_path))
    return _piper_voices[language]


# ---------------------------------------------------------------------------
# STT: WAV bytes → transcript string
# ---------------------------------------------------------------------------

def transcribe_wav(wav_bytes: bytes, language: str | None = None) -> str:
    """Transcribe a WAV recording to text using local Whisper model.

    Args:
        wav_bytes: Raw bytes of a WAV file (16-bit PCM expected).

    Returns:
        Transcribed text string.

    Raises:
        ValueError: If the audio is empty or produces no transcript.
    """
    model = _get_whisper()
    buf = io.BytesIO(wav_bytes)
    segments, info = model.transcribe(buf, beam_size=5, **({"language": language.split("-")[0]} if language else {}))
    text = " ".join(segment.text for segment in segments).strip()
    if not text:
        raise ValueError("No speech detected in the recording.")
    return text[:2000]


# ---------------------------------------------------------------------------
# TTS: text → WAV bytes
# ---------------------------------------------------------------------------

def synthesize_speech(text: str) -> bytes:
    """Synthesize Hindi or Indian English locally and return a WAV file."""
    language = "hi" if any("\u0900" <= char <= "\u097f" for char in text) else "en"
    out = io.BytesIO()
    with _piper_lock:
        voice = _get_piper_voice(language)
        with wave.open(out, "wb") as wav:
            voice.synthesize_wav(text, wav)
    result = out.getvalue()
    if len(result) < 100:
        raise ValueError("Speech synthesis produced empty audio.")
    return result
