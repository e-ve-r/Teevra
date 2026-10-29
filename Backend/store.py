"""Persistent incident and fleet operations. All writes share a reentrant lock."""
from datetime import datetime, timezone
import json
import threading

if __package__:
    from .database import get_db_connection, init_database
    from .models import Incident, IncidentPriority, IncidentCategory, IncidentStatus, DispatchDetails, DepartmentStats, ResponderUnit
    from .operations import CLOSED, department_for, estimate_unit, queue_score
else:
    from database import get_db_connection, init_database
    from models import Incident, IncidentPriority, IncidentCategory, IncidentStatus, DispatchDetails, DepartmentStats, ResponderUnit
    from operations import CLOSED, department_for, estimate_unit, queue_score


def now_iso():
    return datetime.now(timezone.utc).isoformat()


class IncidentStore:
    def __init__(self):
        self._lock = threading.RLock()
        init_database()

    def _row_to_incident(self, conn, row):
        data = dict(row)
        for field in ("triage", "dispatch", "attachments", "updates", "dispatches"):
            raw = data.pop(field + "_json")
            data[field] = json.loads(raw) if raw else (None if field in ("triage", "dispatch") else [])
        if not data["dispatches"] and data["dispatch"]:
            data["dispatches"] = [data["dispatch"]]
        if data["triage"]:
            triage = data["triage"]
            triage.setdefault("assessed_at", data["created_at"])
            triage.setdefault("source", "legacy")
            triage.setdefault("review_required", triage["source"] == "legacy")
            triage.setdefault("potential_hazards", triage.get("scene_hazards", []))
            triage.setdefault("recommended_actions", triage.get("dispatcher_checklist", []))
        if not data.pop("coordinates_known"):
            data["lat"] = data["lng"] = None
        data["timeline"] = [dict(r) for r in conn.execute("SELECT timestamp, status, actor, message FROM timeline_events WHERE incident_id = ? ORDER BY id", (row["id"],))]
        incident = Incident(**data)
        incident.queue_score = queue_score(incident)
        incident.assessment_pending = bool(incident.updates and (
            not incident.triage or incident.updates[-1].timestamp > incident.triage.assessed_at
        ))
        return incident

    def _row_to_responder(self, row):
        data = dict(row)
        data["crew"] = json.loads(data.pop("crew_json"))
        data["department"] = department_for(data["type"])
        return ResponderUnit(**data)

    def list_incidents(self, status=None, priority=None, category=None, search=None):
        with self._lock:
            conn = get_db_connection()
            query, params = "SELECT * FROM incidents WHERE 1=1", []
            for column, value in (("status", status), ("priority", priority), ("category", category)):
                if value and value != "all":
                    query += f" AND {column} = ?"
                    params.append(value)
            if search and search.strip():
                query += " AND (id LIKE ? OR description LIKE ? OR reporter_name LIKE ? OR location_name LIKE ?)"
                params.extend([f"%{search.strip()}%"] * 4)
            incidents = [self._row_to_incident(conn, r) for r in conn.execute(query, params)]
            return sorted(incidents, key=lambda i: (i.status.value in CLOSED, -i.queue_score, i.created_at, i.id))

    get_incidents = list_incidents

    def get_incident(self, incident_id):
        with self._lock:
            conn = get_db_connection()
            row = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
            return self._row_to_incident(conn, row) if row else None

    def _event(self, conn, incident_id, status, actor, message):
        conn.execute("INSERT INTO timeline_events (incident_id, timestamp, status, actor, message) VALUES (?, ?, ?, ?, ?)", (incident_id, now_iso(), status, actor, message))

    def create_incident(self, req, triage=None):
        with self._lock:
            conn = get_db_connection()
            seq = max([int(r[0].split("-")[-1]) for r in conn.execute("SELECT id FROM incidents") if r[0].split("-")[-1].isdigit()] + [2049]) + 1
            incident_id = f"TVR-{seq}"
            with conn:
                conn.execute("""INSERT INTO incidents (id, reporter_name, reporter_phone, location_name, lat, lng, description, category, priority, status, created_at, triage_json, dispatch_json, attachments_json, coordinates_known, location_accuracy_m)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (
                    incident_id, req.reporter_name, req.reporter_phone, req.location_name,
                    req.lat if req.lat is not None else 0, req.lng if req.lng is not None else 0,
                    req.description, (triage.category if triage else req.category or IncidentCategory.OTHER).value,
                    (triage.priority if triage else IncidentPriority.P2).value,
                    IncidentStatus.TRIAGE_COMPLETE.value if triage else IncidentStatus.PENDING_TRIAGE.value,
                    now_iso(), triage.model_dump_json() if triage else None, None,
                    json.dumps([a.model_dump() for a in req.attachments]), int(req.lat is not None), req.location_accuracy_m))
                self._event(conn, incident_id, "Report received", "Reporter", req.description)
            return self.get_incident(incident_id)

    def append_update(self, incident_id, req):
        with self._lock:
            incident = self.get_incident(incident_id)
            if not incident:
                raise KeyError("Incident not found")
            if incident.status.value in CLOSED:
                raise ValueError("This incident is closed. Submit a new report.")
            updates = [u.model_dump() for u in incident.updates]
            updates.append({"timestamp": now_iso(), "description": req.description.strip(), "attachments": [a.model_dump() for a in req.attachments]})
            attachments = [a.model_dump() for a in incident.attachments + req.attachments]
            conn = get_db_connection()
            with conn:
                conn.execute("UPDATE incidents SET updates_json = ?, attachments_json = ?, revision = revision + 1 WHERE id = ?", (json.dumps(updates), json.dumps(attachments), incident_id))
                if req.lat is not None:
                    conn.execute("UPDATE incidents SET lat = ?, lng = ?, coordinates_known = 1, location_accuracy_m = ?, location_name = ? WHERE id = ?", (req.lat, req.lng, req.location_accuracy_m, req.location_name or f"{req.lat:.5f}, {req.lng:.5f}", incident_id))
                elif req.location_name:
                    conn.execute("UPDATE incidents SET location_name = ?, coordinates_known = 0 WHERE id = ?", (req.location_name, incident_id))
                self._event(conn, incident_id, "Situation updated", "Reporter", req.description or "New media attached")
            return self.get_incident(incident_id)

    def assign_dispatch(self, incident_id, unit_id, operator_name="Dispatcher", operator_notes=None, custom_eta=None):
        with self._lock:
            conn = get_db_connection()
            incident = self.get_incident(incident_id)
            if not incident:
                raise KeyError("Incident not found")
            if incident.status.value in CLOSED:
                raise ValueError("Cannot assign a fleet to a closed incident")
            row = conn.execute("SELECT * FROM responders WHERE id = ?", (unit_id,)).fetchone()
            if not row:
                raise KeyError("Responder unit not found")
            if row["status"] != "Available" or row["assigned_incident_id"]:
                raise ValueError("This fleet is already assigned or unavailable. Refresh and choose another.")
            unit = estimate_unit(self._row_to_responder(row), incident)
            eta = custom_eta if custom_eta is not None else unit.eta_minutes
            if eta is None:
                raise ValueError("Location unavailable. Enter a confirmed ETA before assigning.")
            dispatch = DispatchDetails(unit_id=unit.id, unit_name=unit.name, responder_type=unit.type, eta_minutes=eta, operator_name=operator_name, operator_notes=operator_notes)
            dispatches = [d.model_dump() for d in incident.dispatches] + [dispatch.model_dump()]
            with conn:
                changed = conn.execute("UPDATE responders SET status = 'Dispatched', assigned_incident_id = ? WHERE id = ? AND status = 'Available' AND assigned_incident_id IS NULL", (incident_id, unit_id)).rowcount
                if not changed:
                    raise ValueError("Fleet was assigned by another operator")
                conn.execute("UPDATE incidents SET status = ?, dispatch_json = ?, dispatches_json = ? WHERE id = ?", (
                    incident.status.value if incident.dispatches else "dispatched",
                    incident.dispatch.model_dump_json() if incident.dispatch else dispatch.model_dump_json(), json.dumps(dispatches), incident_id))
                self._event(conn, incident_id, "Fleet assigned", operator_name, f"{unit.name} · ETA {eta} min")
            return self.get_incident(incident_id)

    dispatch_unit = assign_dispatch

    def update_incident_status(self, incident_id, status, actor="Dispatcher", message=None):
        with self._lock:
            incident = self.get_incident(incident_id)
            if not incident:
                raise KeyError("Incident not found")
            allowed = {"pending_triage": {"cancelled"}, "triage_complete": {"cancelled"}, "dispatched": {"en_route", "cancelled"}, "en_route": {"on_scene", "cancelled"}, "on_scene": {"resolved", "cancelled"}}
            if status.value not in allowed.get(incident.status.value, set()):
                raise ValueError("Invalid incident status transition")
            conn = get_db_connection()
            with conn:
                conn.execute("UPDATE incidents SET status = ? WHERE id = ?", (status.value, incident_id))
                if status.value in CLOSED:
                    conn.execute("UPDATE responders SET status = 'Available', assigned_incident_id = NULL WHERE assigned_incident_id = ?", (incident_id,))
                else:
                    conn.execute("UPDATE responders SET status = ? WHERE assigned_incident_id = ?", (status.value.replace("_", " ").title(), incident_id))
                self._event(conn, incident_id, status.value, actor, message or "Response status updated")
            return self.get_incident(incident_id)

    def update_triage(self, incident_id, triage, actor="AI Triage Engine"):
        with self._lock:
            incident = self.get_incident(incident_id)
            if not incident:
                raise KeyError("Incident not found")
            conn = get_db_connection()
            with conn:
                conn.execute("UPDATE incidents SET priority = ?, category = ?, triage_json = ?, status = ? WHERE id = ?", (triage.priority.value, triage.category.value, triage.model_dump_json(), "triage_complete" if incident.status.value == "pending_triage" else incident.status.value, incident_id))
                self._event(conn, incident_id, "Assessment updated", actor, f"{triage.priority.value}: {triage.recommended_service}")
            return self.get_incident(incident_id)

    def get_responders(self):
        with self._lock:
            return [self._row_to_responder(r) for r in get_db_connection().execute("SELECT * FROM responders ORDER BY id")]

    def update_responder_location(self, unit_id, req):
        with self._lock:
            conn = get_db_connection()
            with conn:
                changed = conn.execute("UPDATE responders SET lat = ?, lng = ?, current_location = ?, location_updated_at = ?, location_source = 'telemetry' WHERE id = ?", (req.lat, req.lng, req.current_location, now_iso(), unit_id)).rowcount
            if not changed:
                raise KeyError("Responder not found")
            return self._row_to_responder(conn.execute("SELECT * FROM responders WHERE id = ?", (unit_id,)).fetchone())

    def update_responder_status(self, unit_id, status):
        with self._lock:
            if status not in {"Available", "Off Duty"}:
                raise ValueError("Use incident lifecycle controls for assigned fleets")
            conn = get_db_connection()
            row = conn.execute("SELECT * FROM responders WHERE id = ?", (unit_id,)).fetchone()
            if not row:
                raise KeyError("Responder not found")
            if row["assigned_incident_id"]:
                raise ValueError("Resolve the assigned incident before changing readiness")
            with conn:
                conn.execute("UPDATE responders SET status = ? WHERE id = ?", (status, unit_id))
            return self._row_to_responder(conn.execute("SELECT * FROM responders WHERE id = ?", (unit_id,)).fetchone())

    def get_stats(self):
        incidents, units = self.list_incidents(), self.get_responders()
        active = [i for i in incidents if i.status.value not in CLOSED]
        return DepartmentStats(active_incidents=len(active), p1_critical_count=sum(i.priority.value == "P1" for i in active), p2_urgent_count=sum(i.priority.value == "P2" for i in active), p3_standard_count=sum(i.priority.value == "P3" for i in active), available_units=sum(u.status == "Available" and not u.assigned_incident_id for u in units), total_units=len(units), avg_response_time_minutes=0, dispatched_today=sum(any(d.dispatched_at[:10] == now_iso()[:10] for d in i.dispatches) for i in incidents))


store = IncidentStore()
