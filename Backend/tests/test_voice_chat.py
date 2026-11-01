"""Verify voice chat uses free models, bounded uploads, and safe provider errors."""
import base64
import io
import unittest
import wave
from unittest.mock import AsyncMock

import httpx
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from Backend.main import Settings, create_app


def provider_response(json=None, content=None, status=200, headers=None):
    return httpx.Response(status, json=json, content=content, headers=headers,
                          request=httpx.Request("POST", "https://openrouter.ai/api/v1/test"))


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(16000)
        recording.writeframes(b"\0\0" * 1600)
    return output.getvalue()


class VoiceChatTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(Settings(_env_file=None, openrouter_api_key=SecretStr("test-key"), gemini_key=SecretStr("gemini-test-key"), routing_base_url=""))
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        self.post = AsyncMock()
        self.app.state.openrouter_client.post = self.post

    def tearDown(self):
        self.context.__exit__(None, None, None)

    def test_transcription_sends_audio_to_free_multimodal_model(self):
        self.post.return_value = provider_response(json={"candidates": [{"content": {"parts": [{"audioTranscription": {"text": "नमस्ते"}}]}}]})
        data = wav_bytes()
        response = self.client.post("/api/chat/transcribe", files={"audio": ("voice.wav", data, "audio/wav")})
        self.assertEqual(response.json(), {"text": "नमस्ते"})
        call = self.post.await_args.kwargs["json"]
        self.assertIn("gemini-3.5-transcribe", self.post.await_args.args[0])
        part = call["contents"][0]["parts"][0]["inlineData"]
        self.assertEqual(part["mimeType"], "audio/wav")
        self.assertEqual(base64.b64decode(part["data"]), data)

    def test_rejects_bad_audio_before_calling_provider(self):
        response = self.client.post("/api/chat/transcribe", files={"audio": ("bad.wav", b"nope", "audio/wav")})
        self.assertEqual(response.status_code, 415)
        self.post.assert_not_awaited()
        response = self.client.post("/api/chat/transcribe", files={"audio": ("large.wav", b"0" * 2_000_001, "audio/wav")})
        self.assertEqual(response.status_code, 413)
        self.post.assert_not_awaited()

    def test_speech_returns_audio_from_gemini(self):
        sound = wav_bytes()
        self.post.return_value = provider_response(json={"candidates": [{"content": {"parts": [{"inlineData": {
            "mimeType": "audio/wav", "data": base64.b64encode(sound).decode(),
        }}]}}]})
        response = self.client.post("/api/chat/speech", json={"text": "नमस्ते"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, sound)
        self.assertEqual(response.headers["content-type"], "audio/wav")
        self.assertIn("gemini-3.8-flash-lite-tts", self.post.await_args.args[0])
        call = self.post.await_args.kwargs["json"]
        self.assertEqual(call["contents"][0]["parts"][0]["text"], "नमस्ते")
        self.assertEqual(call["generationConfig"]["responseModalities"], ["AUDIO"])

    def test_raw_pcm_is_wrapped_in_wav(self):
        self.post.return_value = provider_response(json={"candidates": [{"content": {"parts": [{"inlineData": {
            "mimeType": "audio/L16;rate=24000", "data": base64.b64encode(b"\x00\x01" * 20).decode(),
        }}]}}]})
        response = self.client.post("/api/chat/speech", json={"text": "Hello"})
        self.assertEqual(response.status_code, 200)
        with wave.open(io.BytesIO(response.content), "rb") as sound:
            self.assertEqual(sound.getframerate(), 24000)
            self.assertEqual(sound.getnframes(), 20)

    def test_provider_failures_and_invalid_audio_are_not_treated_as_speech(self):
        self.post.return_value = provider_response(status=429, json={"error": "sensitive upstream detail"})
        response = self.client.post("/api/chat/speech", json={"text": "hello"})
        self.assertEqual(response.status_code, 429)
        self.assertNotIn("sensitive", response.text)
        self.post.return_value = provider_response(json={"error": "invalid audio"})
        self.assertEqual(self.client.post("/api/chat/speech", json={"text": "hello"}).status_code, 502)

    def test_invalid_gemini_key_is_reported(self):
        self.post.return_value = provider_response(status=403, json={"error": {"message": "private details"}})
        response = self.client.post("/api/chat/transcribe", files={"audio": ("voice.wav", wav_bytes(), "audio/wav")})
        self.assertEqual(response.status_code, 503)
        self.assertIn("Gemini", response.json()["detail"])
        self.assertNotIn("private details", response.text)

    def test_chat_uses_free_router_and_selected_reply_language(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "नमस्ते"}}]})
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "Hello"}], "reply_language": "Hindi"})
        self.assertEqual(response.json(), {"reply": "नमस्ते"})
        call = self.post.await_args.kwargs["json"]
        self.assertEqual(call["model"], "openrouter/free")
        self.assertIn("Respond in Hindi", call["messages"][0]["content"])

    def test_paid_model_override_is_rejected(self):
        with self.assertRaises(ValidationError):
            Settings(_env_file=None, openrouter_chat_model="google/gemma-4-31b-it")


if __name__ == "__main__":
    unittest.main()
