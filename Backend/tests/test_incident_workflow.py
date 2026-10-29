"""Regression tests for ongoing reports, queue ranking, and fleet dispatch."""
import asyncio
from datetime import datetime, timedelta, timezone
import importlib
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient
from pydantic import SecretStr

from Backend import database
from Backend.store import IncidentStore
from Backend.triage import evaluate_incident_ai, rule_based_triage
main = importlib.import_module("Backend.main")


class IncidentWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path_patch = patch.object(database, "DB_PATH", Path(self.temp.name) / "test.db")
        self.local_patch = patch.object(database, "_local", threading.local())
        self.path_patch.start()
        self.local_patch.start()
        self.store = IncidentStore()
        self.initial_fleet = self.store.get_responders()
        conn = database.get_db_connection()
        with conn:
            conn.execute("UPDATE incidents SET status = 'resolved'")
            conn.execute("UPDATE responders SET status = 'Available', assigned_incident_id = NULL")
        self.store_patch = patch.object(main, "store", self.store)
        self.store_patch.start()
        self.client_context = TestClient(main.create_app(main.Settings(openrouter_api_key=SecretStr(""), routing_base_url="")))
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.store_patch.stop()
        database.close_db_connection()
        self.local_patch.stop()
        self.path_patch.stop()
        self.temp.cleanup()

    def create(self, description="Minor ankle sprain", **extra):
        payload = dict(reporter_name="Test Reporter", reporter_phone="+91 90000 00000", location_name="Test intersection", lat=12.9716, lng=77.6412, description=description)
        payload.update(extra)
        response = self.client.post("/api/incidents", json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_legacy_dispatches_are_reconciled_before_fleet_is_available(self):
        assigned = {u.id for u in self.initial_fleet if u.assigned_incident_id}
        self.assertTrue({"AMB-101", "AMB-108", "FIRE-202"}.issubset(assigned))
        self.assertTrue(all(u.status != "Available" for u in self.initial_fleet if u.id in assigned))

    def test_location_and_phone_are_real_inputs_and_unknown_gps_is_null(self):
        response = self.client.post("/api/incidents", json={"description": "Test"})
        self.assertEqual(response.status_code, 422)
        incident = self.create(lat=None, lng=None, location_name="Caller provided address")
        self.assertIsNone(incident["lat"])
        self.assertIsNone(incident["lng"])
        departments = self.client.get(f'/api/incidents/{incident["id"]}/recommendations').json()["departments"]
        self.assertIsNone(departments[0]["units"][0]["eta_minutes"])
        bad = self.client.post("/api/incidents", json={"description": "Test", "reporter_phone": "123----", "location_name": "Street"})
        self.assertEqual(bad.status_code, 422)

    def test_worsening_update_escalates_same_incident_and_adds_departments(self):
        incident = self.create()
        self.assertEqual(incident["priority"], "P3")
        updated = self.client.post(f'/api/incidents/{incident["id"]}/updates', json={"description": "Now a vehicle crash with trapped victim, severe bleeding and fuel leak"})
        self.assertEqual(updated.status_code, 200, updated.text)
        body = updated.json()
        self.assertEqual(body["id"], incident["id"])
        self.assertEqual(body["priority"], "P1")
        self.assertEqual(body["revision"], 1)
        self.assertEqual(len(body["updates"]), 1)
        self.assertEqual(body["created_at"], incident["created_at"])
        recommendation = self.client.get(f'/api/incidents/{incident["id"]}/recommendations').json()
        self.assertEqual({d["department"] for d in recommendation["departments"]}, {"Medical", "Fire & Rescue", "Police"})
        self.create("Minor ankle sprain")
        queue = self.client.get("/api/incidents").json()
        positions = [i["id"] for i in queue]
        self.assertLess(positions.index(incident["id"]), next(index for index, i in enumerate(queue) if i["priority"] == "P3" and i["status"] not in ("resolved", "cancelled")))

    def test_worsening_changes_score_within_the_same_priority_band(self):
        incident = self.create("Car crash with trapped driver")
        updated = self.client.post(f'/api/incidents/{incident["id"]}/updates', json={"description": "Driver is now unconscious with severe bleeding and not breathing"}).json()
        self.assertEqual(incident["priority"], "P1")
        self.assertEqual(updated["priority"], "P1")
        self.assertGreater(updated["triage"]["severity_score"], incident["triage"]["severity_score"])
        saved = self.client.get(f'/api/incidents/{incident["id"]}').json()
        queued = next(i for i in self.client.get("/api/incidents").json() if i["id"] == incident["id"])
        self.assertEqual(saved["triage"]["severity_score"], updated["triage"]["severity_score"])
        self.assertEqual(queued["triage"]["severity_score"], updated["triage"]["severity_score"])

    def test_explicit_improvement_updates_score_without_old_history_pinning_it(self):
        incident = self.create("Car crash with trapped unconscious driver and severe bleeding")
        updated = self.client.post(f'/api/incidents/{incident["id"]}/updates', json={"description": "Driver is no longer trapped, regained consciousness, breathing normally. Bleeding has stopped."}).json()
        self.assertLess(updated["triage"]["severity_score"], incident["triage"]["severity_score"])
        self.assertTrue(updated["triage"]["review_required"])
        self.assertEqual(updated["description"], incident["description"])
        self.assertEqual(len(updated["updates"]), 1)

    def test_fresh_model_score_is_not_overwritten_with_previous_score(self):
        incident = self.create("Unconscious after a car crash")
        fresh = rule_based_triage("Minor ankle sprain")
        fresh.source = "ai"
        fresh.severity_score = 55
        with patch.object(main, "evaluate_incident_ai", new_callable=AsyncMock, return_value=fresh) as evaluate:
            response = self.client.post(f'/api/incidents/{incident["id"]}/updates', json={"description": "Regained consciousness and breathing normally"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["triage"]["severity_score"], 55)
            self.assertEqual(response.json()["priority"], fresh.priority.value)
            self.assertEqual(evaluate.call_args.kwargs["latest_description"], "Regained consciousness and breathing normally")

    def test_map_exposes_assigned_fleet_and_updated_gps_on_both_clients(self):
        incident = self.create("Unconscious patient")
        root = f'/api/incidents/{incident["id"]}'
        self.client.post(root + "/dispatch", json={"unit_id": "AMB-101", "eta_minutes": 5})
        first = self.client.get(root + "/map").json()
        self.assertEqual([u["id"] for u in first["units"]], ["AMB-101"])
        self.assertTrue(first["routing_unavailable"])
        self.client.patch("/api/responders/AMB-101/location", json={"lat": 12.972, "lng": 77.642, "current_location": "GPS test position"})
        second = self.client.get(root + "/map").json()
        self.assertEqual(second["units"][0]["lat"], 12.972)
        self.assertEqual(second["units"][0]["location_source"], "telemetry")
        self.assertNotEqual(first["units"][0]["lat"], second["units"][0]["lat"])

    def test_queue_prefers_older_cases_with_equal_severity(self):
        old = self.create("Severe bleeding")
        new = self.create("Severe bleeding")
        conn = database.get_db_connection()
        with conn:
            conn.execute("UPDATE incidents SET created_at = ? WHERE id = ?", ((datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat(), old["id"]))
        queue = self.client.get("/api/incidents").json()
        ids = [i["id"] for i in queue]
        self.assertLess(ids.index(old["id"]), ids.index(new["id"]))
        self.assertGreater(self.store.get_incident(old["id"]).queue_score, self.store.get_incident(new["id"]).queue_score)

    def test_multi_department_assignment_conflict_and_release(self):
        incident = self.create("Crash with trapped person and severe bleeding")
        root = f'/api/incidents/{incident["id"]}'
        for unit in ("AMB-101", "FIRE-202"):
            response = self.client.post(root + "/dispatch", json={"unit_id": unit, "eta_minutes": 5})
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["dispatches"]), 2)
        self.assertEqual(self.client.post(root + "/dispatch", json={"unit_id": "AMB-101"}).status_code, 409)
        other = self.create()
        self.assertEqual(self.client.post(f'/api/incidents/{other["id"]}/dispatch', json={"unit_id": "AMB-101"}).status_code, 409)
        for status in ("en_route", "on_scene", "resolved"):
            response = self.client.patch(root + "/status", json={"status": status})
            self.assertEqual(response.status_code, 200, response.text)
        fleet = self.client.get("/api/responders").json()
        for unit in fleet:
            if unit["id"] in ("AMB-101", "FIRE-202"):
                self.assertEqual(unit["status"], "Available")
                self.assertIsNone(unit["assigned_incident_id"])
        self.assertEqual(self.client.post(root + "/updates", json={"description": "New details"}).status_code, 409)
        self.assertEqual(self.client.post(root + "/dispatch", json={"unit_id": "AMB-101"}).status_code, 409)

    def test_fleet_etas_recompute_from_telemetry_and_sort(self):
        incident = self.create("Fire with trapped victims")
        root = f'/api/incidents/{incident["id"]}/recommendations'
        self.client.patch("/api/responders/AMB-104/location", json={"lat": 12.9716, "lng": 77.6412, "current_location": "At the test intersection"})
        depts = self.client.get(root).json()["departments"]
        medical = next(d for d in depts if d["department"] == "Medical")
        self.assertEqual(medical["units"][0]["id"], "AMB-104")
        self.assertEqual(medical["units"][0]["distance_km"], 0)
        self.assertEqual(medical["units"][0]["location_source"], "telemetry")
        etas = [d["eta_minutes"] for d in depts if d["eta_minutes"] is not None]
        self.assertEqual(etas, sorted(etas))
        self.client.patch("/api/responders/FIRE-202/status?status=Off%20Duty")
        fire = next(d for d in self.client.get(root).json()["departments"] if d["department"] == "Fire & Rescue")
        self.assertEqual(fire["available_count"], 0)

    def test_updates_survive_reopening_store_and_retriage_uses_history(self):
        incident = self.create("Traffic crash")
        root = f'/api/incidents/{incident["id"]}'
        self.client.post(root + "/updates", json={"description": "Victim is now unconscious and trapped"})
        assessment = rule_based_triage("Severe bleeding")
        with patch.object(main, "evaluate_incident_ai", new_callable=AsyncMock, return_value=assessment) as evaluate:
            self.assertEqual(self.client.post(root + "/triage").status_code, 200)
            description = evaluate.call_args.kwargs["description"]
            self.assertIn("Traffic crash", description)
            self.assertIn("Victim is now unconscious and trapped", description)
        restored = IncidentStore().get_incident(incident["id"])
        self.assertEqual(len(restored.updates), 1)
        self.assertEqual(restored.priority.value, "P1")

    def test_upload_returns_durable_media_url_and_rejects_oversize(self):
        response = self.client.post("/api/upload", files={"file": ("evidence.png", b"test image", "image/png")})
        self.assertEqual(response.status_code, 200)
        uploaded = response.json()
        self.assertEqual(self.client.get(uploaded["url"]).content, b"test image")
        incident = self.create(attachments=[uploaded])
        self.assertEqual(incident["attachments"][0]["url"], uploaded["url"])
        self.assertEqual(self.client.post("/api/upload", files={"file": ("large.wav", b"x" * (20 * 1024 * 1024 + 1), "audio/wav")}).status_code, 413)
        Path(main.__file__).resolve().parent.parent.joinpath(uploaded["url"].lstrip("/")).unlink()

    def test_provider_receives_audio_bytes_and_fallback_is_explicit(self):
        from Backend.models import Attachment
        response = self.client.post("/api/upload", files={"file": ("voice.wav", b"synthetic audio bytes", "audio/wav")})
        attachment = Attachment(**response.json())
        mock_client = AsyncMock()
        mock_client.post.return_value = httpx.Response(200, json={"choices": [{"message": {"content": rule_based_triage("Fire with trapped victim").model_dump_json()}}]})
        result = asyncio.run(evaluate_incident_ai("Voice report", 1, mock_client, SecretStr("test-key"), attachments=[attachment]))
        parts = mock_client.post.call_args.kwargs["json"]["messages"][1]["content"]
        self.assertEqual(parts[1]["type"], "input_audio")
        self.assertEqual(parts[1]["input_audio"]["format"], "wav")
        self.assertTrue(parts[1]["input_audio"]["data"])
        mock_client.post.side_effect = httpx.ConnectError("Unavailable")
        fallback = asyncio.run(evaluate_incident_ai("Voice report", 1, mock_client, SecretStr("test-key"), attachments=[attachment]))
        self.assertEqual(fallback.source, "rules")
        self.assertTrue(fallback.review_required)
        self.assertEqual(fallback.priority.value, "P2")
        self.assertEqual(fallback.ai_confidence, 0)
        Path(main.__file__).resolve().parent.parent.joinpath(response.json()["url"].lstrip("/")).unlink()

    def test_concurrent_updates_preserve_history_and_assessment_order(self):
        incident = self.create()
        async def run_updates():
            async def evaluate(**kwargs):
                await asyncio.sleep(.01)
                return rule_based_triage(kwargs["description"])
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.client.app), base_url="http://test") as client:
                with patch.object(main, "evaluate_incident_ai", side_effect=evaluate):
                    first, second = await asyncio.gather(
                        client.post(f'/api/incidents/{incident["id"]}/updates', json={"description": "Victim is now unconscious"}),
                        client.post(f'/api/incidents/{incident["id"]}/updates', json={"description": "Vehicle fire with trapped victim"}),
                    )
                self.assertEqual(first.status_code, 200)
                self.assertEqual(second.status_code, 200)
                final = (await client.get(f'/api/incidents/{incident["id"]}')).json()
                self.assertEqual(final["revision"], 2)
                self.assertEqual(len(final["updates"]), 2)
                self.assertEqual(final["priority"], "P1")
                self.assertFalse(final["assessment_pending"])
                self.assertEqual(final["category"], "Fire & Rescue")
        asyncio.run(run_updates())

    def test_provider_receives_attachment_bytes(self):
        response = self.client.post("/api/upload", files={"file": ("scene.png", b"test image bytes", "image/png")})
        incident = self.create(attachments=[response.json()])
        from Backend.models import Attachment
        mock_client = AsyncMock()
        mock_client.post.return_value = httpx.Response(200, json={"choices": [{"message": {"content": rule_based_triage("Fire with trapped victim").model_dump_json()}}]})
        result = asyncio.run(evaluate_incident_ai("Fire", 1, mock_client, SecretStr("fake-test-key"), attachments=[Attachment(**incident["attachments"][0])]))
        parts = mock_client.post.call_args.kwargs["json"]["messages"][1]["content"]
        self.assertTrue(parts[1]["image_url"]["url"].startswith("data:image/png;base64,"))
        self.assertEqual(result.source, "ai")
        Path(main.__file__).resolve().parent.parent.joinpath(response.json()["url"].lstrip("/")).unlink()


if __name__ == "__main__":
    unittest.main()
