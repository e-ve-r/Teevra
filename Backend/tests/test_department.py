import unittest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from Backend.main import Settings, create_app


class DepartmentEndpointTests(unittest.TestCase):
    def setUp(self):
        self.settings = Settings(_env_file=None, openrouter_api_key=SecretStr(""))
        self.app = create_app(self.settings)
        self.client = self.enterContext(TestClient(self.app))

    def test_get_department_stats(self):
        resp = self.client.get("/api/department/stats")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("active_incidents", data)
        self.assertIn("p1_critical_count", data)
        self.assertIn("available_units", data)
        self.assertGreaterEqual(data["total_units"], 1)

    def test_list_incidents(self):
        resp = self.client.get("/api/incidents")
        self.assertEqual(resp.status_code, 200)
        incidents = resp.json()
        self.assertGreaterEqual(len(incidents), 3)

        # Test filter by priority
        resp_p1 = self.client.get("/api/incidents?priority=P1")
        self.assertEqual(resp_p1.status_code, 200)
        for inc in resp_p1.json():
            self.assertEqual(inc["priority"], "P1")

    def test_create_and_dispatch_incident(self):
        # 1. Create incident
        payload = {
            "reporter_name": "Rohan Mehra",
            "reporter_phone": "+91 98888 77777",
            "location_name": "Koramangala 5th Block",
            "description": "Severe motorcycle crash, rider unconscious and not breathing properly.",
            "attachments": [
                {"name": "helmet_damage.jpg", "kind": "image", "size": 1200000}
            ],
        }
        create_resp = self.client.post("/api/incidents", json=payload)
        self.assertEqual(create_resp.status_code, 201)
        created = create_resp.json()
        incident_id = created["id"]
        self.assertTrue(incident_id.startswith("TVR-"))
        self.assertEqual(created["reporter_name"], "Rohan Mehra")
        self.assertEqual(created["priority"], "P1")
        self.assertIsNotNone(created["triage"])
        self.assertGreaterEqual(created["triage"]["severity_score"], 80)

        # 2. Get incident by ID
        get_resp = self.client.get(f"/api/incidents/{incident_id}")
        self.assertEqual(get_resp.status_code, 200)
        self.assertEqual(get_resp.json()["id"], incident_id)

        # 3. Dispatch unit
        dispatch_payload = {
            "unit_id": "AMB-101",
            "operator_name": "Dispatcher Sarah",
            "operator_notes": "Immediate ALS response initiated.",
            "eta_minutes": 3,
        }
        dispatch_resp = self.client.post(f"/api/incidents/{incident_id}/dispatch", json=dispatch_payload)
        self.assertEqual(dispatch_resp.status_code, 200)
        dispatched = dispatch_resp.json()
        self.assertEqual(dispatched["status"], "dispatched")
        self.assertEqual(dispatched["dispatch"]["unit_id"], "AMB-101")
        self.assertEqual(dispatched["dispatch"]["operator_name"], "Dispatcher Sarah")

        # 4. Status transitions
        status_resp = self.client.patch(
            f"/api/incidents/{incident_id}/status",
            json={"status": "en_route", "actor": "AMB-101 Crew", "message": "En route, lights and siren."},
        )
        self.assertEqual(status_resp.status_code, 200)
        self.assertEqual(status_resp.json()["status"], "en_route")

        # 5. Mark resolved
        resolve_resp = self.client.patch(
            f"/api/incidents/{incident_id}/status",
            json={"status": "resolved", "actor": "Hospital ER", "message": "Patient transferred to ER."},
        )
        self.assertEqual(resolve_resp.status_code, 200)
        self.assertEqual(resolve_resp.json()["status"], "resolved")

    def test_list_responders(self):
        resp = self.client.get("/api/responders")
        self.assertEqual(resp.status_code, 200)
        units = resp.json()
        self.assertGreater(len(units), 0)
        ids = [u["id"] for u in units]
        self.assertIn("AMB-101", ids)


if __name__ == "__main__":
    unittest.main()
