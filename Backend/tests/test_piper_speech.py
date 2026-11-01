"""Check that local synthesis selects and reuses the requested language voice."""
import unittest
import wave
import io
from unittest.mock import patch
from Backend import voice


class FakeVoice:
    def synthesize_wav(self, text, output):
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(22050)
        output.writeframes(b"\x00\x00" * 100)


class PiperSpeechTests(unittest.TestCase):
    def test_selects_voice_for_each_language_and_returns_wav(self):
        with patch.object(voice, "_get_piper_voice", return_value=FakeVoice()) as get_voice:
            for text, language in (("Hello, how are you?", "en"), ("आप कैसे हैं?", "hi")):
                audio = voice.synthesize_speech(text)
                with wave.open(io.BytesIO(audio)) as wav:
                    self.assertGreater(wav.getnframes(), 0)
                self.assertEqual(get_voice.call_args.args[0], language)
