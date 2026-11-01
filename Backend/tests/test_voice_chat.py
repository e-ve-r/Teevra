"""Verify voice chat uses free models, bounded uploads, and safe provider errors."""
import base64
import io
import unittest
import wave
from unittest.mock import AsyncMock
from unittest.mock import patch
from types import SimpleNamespace

import httpx
from fastapi.testclient import TestClient
from pydantic import SecretStr

from Backend.main import Settings, create_app
from Backend.models import IncidentStatus
from Backend.store import store


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
        self.app.state.http_client.post = self.post

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

    def test_chat_uses_local_ollama_and_selected_reply_language(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "नमस्ते"}}]})
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "Hello"}], "reply_language": "Hindi"})
        self.assertEqual(response.json(), {"reply": "नमस्ते", "recommend_report": False})
        call = self.post.await_args.kwargs["json"]
        self.assertEqual(call["model"], "llama3.2")
        self.assertEqual(self.post.await_args.args[0], "http://127.0.0.1:11434/v1/chat/completions")
        self.assertIn("Respond in Hindi", call["messages"][0]["content"])

    def test_report_recommendation_is_cleaned_and_does_not_create_report(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "Please review a report. [[REPORT_RECOMMENDED]]"}}]})
        with patch.object(store, "create_incident") as create:
            response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "I want to report a fall"}]})
        self.assertEqual(response.json(), {"reply": "Please review a report.", "recommend_report": True})
        create.assert_not_called()

    def test_report_summary_uses_full_conversation_without_creating_report(self):
        history = [{"role": "user", "content": "I fell from a bicycle."},
                   {"role": "assistant", "content": "Are you bleeding?"},
                   {"role": "user", "content": "My knee hurts, but there is no bleeding."}]
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "Bicycle fall; knee pain reported, without bleeding. Location unknown."}}]})
        with patch.object(store, "create_incident") as create:
            response = self.client.post("/api/chat/report-summary", json={"messages": history})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["summary"], "Bicycle fall; knee pain reported, without bleeding. Location unknown.")
        sent = self.post.await_args.kwargs["json"]["messages"]
        import json
        self.assertEqual(json.loads(sent[1]["content"]), history)
        self.assertIn("do not treat the assistant's questions", sent[0]["content"])
        create.assert_not_called()

    def test_report_summary_failure_allows_manual_entry(self):
        self.post.return_value = provider_response(status=429, json={"error": "provider details"})
        response = self.client.post("/api/chat/report-summary", json={"messages": [{"role": "user", "content": "I fell"}]})
        self.assertEqual(response.status_code, 503)
        self.assertIn("write a brief summary", response.json()["detail"])
        self.assertNotIn("provider details", response.text)

    def test_report_draft_extracts_only_a_location_present_in_user_messages(self):
        history = [{"role": "user", "content": "I fell near MG Road, Pune."}]
        def provider(location):
            import json
            return provider_response(json={"choices": [{"message": {"content": json.dumps({"summary": "Fall reported.", "location": location})}}]})
        self.post.return_value = provider("MG Road, Pune")
        response = self.client.post("/api/chat/report-summary", json={"messages": history})
        self.assertEqual(response.json(), {"summary": "Fall reported.", "location": "MG Road, Pune"})
        self.post.return_value = provider("Mumbai")
        response = self.client.post("/api/chat/report-summary", json={"messages": history})
        self.assertEqual(response.json()["location"], "")

    def test_urgent_breathing_report_does_not_depend_on_model_guidance(self):
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "My friend is unconscious and not breathing normally"}]})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["recommend_report"])
        self.assertIn("emergency service", response.json()["reply"])
        self.post.assert_not_awaited()

    def test_possible_emergency_offers_review_even_without_model_marker(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "What happened in the crash?"}}]})
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "There was a vehicle crash"}]})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["recommend_report"])

    def test_chat_uses_moondream_and_reuses_image_description(self):
        image = self.client.post("/api/upload", files={"file": ("test.png", b"image bytes", "image/png")}).json()
        async def local_model(url, **kwargs):
            if url.endswith("/api/chat"):
                self.assertEqual(kwargs["json"]["model"], "moondream")
                self.assertEqual(base64.b64decode(kwargs["json"]["messages"][0]["images"][0]), b"image bytes")
                return provider_response(json={"message": {"content": "A bicycle on a road."}})
            return provider_response(json={"choices": [{"message": {"content": "What happened?"}}]})
        self.post.side_effect = local_model
        try:
            payload = {"messages": [{"role": "user", "content": "What can you see?", "attachments": [image]}]}
            response = self.client.post("/api/chat", json=payload)
            self.assertEqual(response.status_code, 200, response.text)
            content = self.post.await_args.kwargs["json"]["messages"][-1]["content"]
            self.assertIn("What can you see?", content)
            self.assertIn("A bicycle on a road.", content)
            self.assertIn("Unverified image analysis", content)
            self.assertEqual(self.client.post("/api/chat", json=payload).status_code, 200)
            self.assertEqual(sum(call.args[0].endswith("/api/chat") for call in self.post.await_args_list), 1)
        finally:
            from pathlib import Path
            Path("uploads", image["url"].split("/")[-1]).unlink(missing_ok=True)

    def test_moondream_failure_is_reported_to_llama(self):
        image = self.client.post("/api/upload", files={"file": ("test.png", b"image bytes", "image/png")}).json()
        async def local_model(url, **kwargs):
            if url.endswith("/api/chat"):
                raise httpx.ConnectError("unavailable")
            return provider_response(json={"choices": [{"message": {"content": "Please describe the image."}}]})
        self.post.side_effect = local_model
        try:
            response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "What happened?", "attachments": [image]}]})
            self.assertEqual(response.status_code, 200)
            self.assertIn("Image analysis is unavailable", self.post.await_args.kwargs["json"]["messages"][-1]["content"])
        finally:
            from pathlib import Path
            Path("uploads", image["url"].split("/")[-1]).unlink(missing_ok=True)

    def test_chat_uses_current_server_incident_and_does_not_recommend_duplicate(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "Checking. [[REPORT_RECOMMENDED]]"}}]})
        incident = SimpleNamespace(id="CASE-1", status=IncidentStatus.EN_ROUTE, description="Fall", updates=[], location_name="Main street", dispatches=[])
        with patch.object(store, "get_incident", return_value=incident), patch.object(store, "get_responders", return_value=[]):
            response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "Where is help?"}], "context": {"incident_id": "CASE-1", "has_report": False}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["recommend_report"])
        system = self.post.await_args.kwargs["json"]["messages"][0]["content"]
        self.assertIn('"status": "en_route"', system)
        self.assertIn('"units": []', system)
        self.assertIn('"traffic_aware": false', system)

    def test_full_conversation_and_latest_responder_updates_reach_model(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "The responder is on scene."}}]})
        history = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"Message {i}"} for i in range(25)]
        event = SimpleNamespace(timestamp="2026-01-01T10:00:00Z", status="on_scene", actor="Responder", message="Arrived at the scene")
        dispatch = SimpleNamespace(unit_id="U1", unit_name="Unit 1", dispatched_at="2026-01-01T09:50:00Z", operator_notes="Approaching from north", eta_minutes=10)
        incident = SimpleNamespace(id="CASE-1", status=IncidentStatus.ON_SCENE, description="Fall", updates=[], location_name="Main street", dispatches=[dispatch], timeline=[event])
        with patch.object(store, "get_incident", return_value=incident), patch.object(store, "get_responders", return_value=[]):
            response = self.client.post("/api/chat", json={"messages": history, "context": {"incident_id": "CASE-1"}})
        self.assertEqual(response.status_code, 200, response.text)
        sent = self.post.await_args.kwargs["json"]["messages"]
        self.assertEqual(sent[1:], history)
        self.assertIn("Arrived at the scene", sent[0]["content"])
        self.assertIn("Approaching from north", sent[0]["content"])

    def test_chat_reports_when_ollama_is_not_running(self):
        self.post.side_effect = httpx.ConnectError("unavailable")
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "Hello"}]})
        self.assertEqual(response.status_code, 503)
        self.assertIn("Start the Ollama server", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
