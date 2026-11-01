"""Verify voice chat uses local models, bounded uploads, and safe provider errors."""
import io
import unittest
import wave
from unittest.mock import AsyncMock, patch, MagicMock
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
        self.app = create_app(Settings(_env_file=None, routing_base_url=""))
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        self.post = AsyncMock()
        self.app.state.http_client.post = self.post

    def tearDown(self):
        self.context.__exit__(None, None, None)

    @patch("Backend.main.transcribe_wav", return_value="नमस्ते")
    def test_transcription_uses_local_whisper(self, mock_transcribe):
        data = wav_bytes()
        response = self.client.post("/api/chat/transcribe", files={"audio": ("voice.wav", data, "audio/wav")})
        self.assertEqual(response.json(), {"text": "नमस्ते"})
        mock_transcribe.assert_called_once_with(data)

    def test_rejects_bad_audio_before_calling_provider(self):
        response = self.client.post("/api/chat/transcribe", files={"audio": ("bad.wav", b"nope", "audio/wav")})
        self.assertEqual(response.status_code, 415)
        self.post.assert_not_awaited()
        response = self.client.post("/api/chat/transcribe", files={"audio": ("large.wav", b"0" * 2_000_001, "audio/wav")})
        self.assertEqual(response.status_code, 413)
        self.post.assert_not_awaited()

    @patch("Backend.main.transcribe_wav", return_value="मुझे मदद चाहिए")
    def test_transcription_passes_selected_hindi_language(self, mock_transcribe):
        data = wav_bytes()
        response = self.client.post("/api/chat/transcribe", data={"language": "hi-IN"}, files={"audio": ("voice.wav", data, "audio/wav")})
        self.assertEqual(response.status_code, 200)
        mock_transcribe.assert_called_once_with(data, "hi-IN")

    @patch("Backend.main.synthesize_speech")
    def test_speech_returns_audio_from_kokoro(self, mock_synthesize):
        sound = wav_bytes()
        mock_synthesize.return_value = sound
        response = self.client.post("/api/chat/speech", json={"text": "नमस्ते"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, sound)
        self.assertEqual(response.headers["content-type"], "audio/wav")
        mock_synthesize.assert_called_once_with("नमस्ते")

    @patch("Backend.main.synthesize_speech", side_effect=ValueError("Speech synthesis produced no audio."))
    def test_speech_failure_returns_502(self, mock_synthesize):
        response = self.client.post("/api/chat/speech", json={"text": "hello"})
        self.assertEqual(response.status_code, 502)

    @patch("Backend.main.synthesize_speech", side_effect=RuntimeError("Model files not found"))
    def test_speech_missing_model_returns_503(self, mock_synthesize):
        response = self.client.post("/api/chat/speech", json={"text": "hello"})
        self.assertEqual(response.status_code, 503)

    @patch("Backend.main.transcribe_wav", side_effect=ValueError("No speech detected"))
    def test_transcription_failure_returns_502(self, mock_transcribe):
        response = self.client.post("/api/chat/transcribe", files={"audio": ("voice.wav", wav_bytes(), "audio/wav")})
        self.assertEqual(response.status_code, 502)

    @patch("Backend.main.transcribe_wav", side_effect=RuntimeError("Model not loaded"))
    def test_transcription_missing_model_returns_503(self, mock_transcribe):
        response = self.client.post("/api/chat/transcribe", files={"audio": ("voice.wav", wav_bytes(), "audio/wav")})
        self.assertEqual(response.status_code, 503)

    def test_chat_uses_local_ollama_and_selected_reply_language(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "नमस्ते"}}]})
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "Hello"}], "reply_language": "Hindi"})
        self.assertEqual(response.json()["reply"], "नमस्ते")
        self.assertFalse(response.json()["recommend_report"])
        self.assertIsNone(response.json()["tool_call"])
        call = self.post.await_args.kwargs["json"]
        self.assertEqual(call["model"], "llama3.2")
        self.assertEqual(self.post.await_args.args[0], "http://127.0.0.1:11434/v1/chat/completions")
        self.assertIn("Respond in Hindi", call["messages"][0]["content"])

    def test_report_recommendation_is_cleaned_and_does_not_create_report(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "Please review a report. [[REPORT_RECOMMENDED]]"}}]})
        with patch.object(store, "create_incident") as create:
            response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "I want to report a fall"}]})
        data = response.json()
        self.assertEqual(data["reply"], "Please review a report.")
        self.assertTrue(data["recommend_report"])
        self.assertIsNone(data["tool_call"])
        create.assert_not_called()

    def test_report_request_can_gather_condition_before_review(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "How are you feeling now?"}}]})
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "I want to report a fall"}]})
        self.assertEqual(response.json()["reply"], "How are you feeling now?")
        self.assertIsNone(response.json()["tool_call"])
        prompt = self.post.await_args.kwargs["json"]["messages"][0]["content"]
        self.assertIn("current condition", prompt)
        self.assertIn("ordinary conversation", prompt)

    def test_ollama_tool_call_opens_report_form_with_user_details(self):
        self.post.return_value = provider_response(json={
            "choices": [{
                "message": {
                    "content": "",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "open_report_form",
                            "arguments": '{"summary": "Vehicle collision with minor injuries", "location": "MG Road, Pune", "reporter_name": "Aditi", "reporter_phone": "9876543210"}'
                        }
                    }]
                }
            }]
        })
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "Please report a crash on MG Road Pune. My name is Aditi and my number is 9876543210"}]})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["recommend_report"])
        self.assertIsNotNone(data["tool_call"])
        self.assertEqual(data["tool_call"]["name"], "open_report_form")
        self.assertEqual(data["tool_call"]["arguments"]["summary"], "Vehicle collision with minor injuries")
        self.assertEqual(data["tool_call"]["arguments"]["location"], "MG Road, Pune")
        self.assertEqual(data["tool_call"]["arguments"]["reporter_name"], "Aditi")
        self.assertEqual(data["tool_call"]["arguments"]["reporter_phone"], "9876543210")
        self.assertIn("report", data["reply"].lower())

    def test_missing_reporter_name_is_requested_before_review(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "", "tool_calls": [{"function": {"name": "open_report_form", "arguments": {"summary": "Fall, knee hurts", "location": "MG Road", "reporter_phone": "9876543210", "reporter_name": ""}}}]}}]})
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "I fell, my knee hurts. MG Road. My number is 9876543210"}]})
        self.assertEqual(response.json()["tool_call"]["arguments"]["reporter_name"], "")
        self.assertIn("confirm", response.json()["reply"])

    def test_malformed_text_tool_call_is_not_shown_to_user(self):
        content = '{"name": open_report_form, "parameters": {"summary": "fell off stairs", "location": "", "reporter_name": "", "reporter_phone": ""}}'
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": content}}]})
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "I fell off stairs"}]})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("open_report_form", response.json()["reply"])
        self.assertIsNotNone(response.json()["tool_call"])
        self.assertIn("confirm", response.json()["reply"])

    def test_repeated_questions_open_review_after_phone_is_provided(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "What is your address and phone number?"}}]})
        messages = [
            {"role": "user", "content": "I want to report a fall; my knee hurts."},
            {"role": "assistant", "content": "What is your name and phone number?"},
            {"role": "user", "content": "Aditi, 9876543210"},
            {"role": "assistant", "content": "What is the location?"},
            {"role": "user", "content": "MG Road, Pune"},
        ]
        with patch.object(store, "create_incident") as create:
            response = self.client.post("/api/chat", json={"messages": messages})
        self.assertEqual(response.json()["tool_call"]["name"], "open_report_form")
        self.assertEqual(response.json()["tool_call"]["arguments"]["reporter_phone"], "9876543210")
        create.assert_not_called()

    def test_reformatted_contact_does_not_block_review(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": "", "tool_calls": [{"function": {"name": "open_report_form", "arguments": {"summary": "Fall", "location": "Road 1, New Delhi", "reporter_name": "Aditi Sharma", "reporter_phone": "+91 9876543210"}}}]}}]})
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "I fell. I am Aditi, at 1 Road, Delhi. My number is 9876543210."}]})
        args = response.json()["tool_call"]["arguments"]
        self.assertEqual(args["reporter_phone"], "9876543210")
        self.assertEqual(args["location"], "")
        self.assertEqual(args["reporter_name"], "")

    def test_unparseable_text_tool_call_is_hidden_and_asks_condition(self):
        self.post.return_value = provider_response(json={"choices": [{"message": {"content": '{"name": open_report_form, broken'}}]})
        response = self.client.post("/api/chat", json={"messages": [{"role": "user", "content": "I fell"}]})
        self.assertNotIn("open_report_form", response.json()["reply"])
        self.assertIn("feeling", response.json()["reply"])
        self.assertIsNone(response.json()["tool_call"])

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
        import base64
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
