"""Persistent SQLite-backed Incident and Fleet Store for Teevra Emergency Operations Center."""

from datetime import datetime, timezone
import json
import sqlite3
import threading
from typing import Dict, List, Optional

from Backend.database import get_db_connection, init_database
from Backend.models import (
    Attachment,
    DepartmentStats,
    DispatchDetails,
    Incident,
    IncidentCategory,
    IncidentCreateRequest,
    IncidentPriority,
    IncidentStatus,
    ResponderUnit,
    TimelineEvent,
    TriageAssessment,
)


class IncidentStore:
    def __init__(self):
        self._lock = threading.Lock()
        init_database()

    def _row_to_incident(self, conn: sqlite3.Connection, row: sqlite3.Row) -> Incident:
        triage = TriageAssessment(**json.loads(row["triage_json"])) if row["triage_json"] else None
        dispatch = DispatchDetails(**json.loads(row["dispatch_json"])) if row["dispatch_json"] else None
        attachments = [Attachment(**a) for a in json.loads(row["attachments_json"])]

        cur = conn.cursor()
        cur.execute(
            "SELECT timestamp, status, actor, message FROM timeline_events WHERE incident_id = ? ORDER BY id ASC;",
            (row["id"],),
        )
        timeline = [
            TimelineEvent(
                timestamp=t["timestamp"],
                status=t["status"],
                actor=t["actor"],
                message=t["message"],
            )
            for t in cur.fetchall()
        ]

        return Incident(
            id=row["id"],
            reporter_name=row["reporter_name"],
            reporter_phone=row["reporter_phone"],
            location_name=row["location_name"],
            lat=row["lat"],
            lng=row["lng"],
            description=row["description"],
            category=IncidentCategory(row["category"]) if row["category"] in IncidentCategory._value2member_map_ else IncidentCategory.MEDICAL,
            priority=IncidentPriority(row["priority"]) if row["priority"] in IncidentPriority._value2member_map_ else IncidentPriority.P1,
            status=IncidentStatus(row["status"]) if row["status"] in IncidentStatus._value2member_map_ else IncidentStatus.PENDING_TRIAGE,
            created_at=row["created_at"],
            triage=triage,
            dispatch=dispatch,
            attachments=attachments,
            timeline=timeline,
        )

    def _row_to_responder(self, row: sqlite3.Row) -> ResponderUnit:
        return ResponderUnit(
            id=row["id"],
            name=row["name"],
            type=row["type"],
            status=row["status"],
            base_station=row["base_station"],
            current_location=row["current_location"],
            eta_minutes=row["eta_minutes"],
            distance_km=row["distance_km"],
            crew=json.loads(row["crew_json"]),
            assigned_incident_id=row["assigned_incident_id"],
        )

    def list_incidents(
        self,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        category: Optional[str] = None,
        search: Optional[str] = None,
    ) -> List[Incident]:
        with self._lock:
            conn = get_db_connection()
            query = "SELECT * FROM incidents WHERE 1=1"
            params = []

            if status and status != "all":
                query += " AND status = ?"
                params.append(status)
            if priority and priority != "all":
                query += " AND priority = ?"
                params.append(priority)
            if category and category != "all":
                query += " AND category = ?"
                params.append(category)
            if search and search.strip():
                query += " AND (description LIKE ? OR reporter_name LIKE ? OR location_name LIKE ?)"
                term = f"%{search.strip()}%"
                params.extend([term, term, term])

            query += " ORDER BY created_at DESC;"

            cur = conn.cursor()
            cur.execute(query, params)
            rows = cur.fetchall()

            return [self._row_to_incident(conn, r) for r in rows]

    get_incidents = list_incidents

    def get_incident(self, incident_id: str) -> Optional[Incident]:
        with self._lock:
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM incidents WHERE id = ?;", (incident_id,))
            row = cur.fetchone()
            if not row:
                return None
            return self._row_to_incident(conn, row)

    def create_incident(
        self,
        req: IncidentCreateRequest,
        triage: Optional[TriageAssessment] = None,
    ) -> Incident:
        with self._lock:
            conn = get_db_connection()
            cur = conn.cursor()

            # Generate incremental TVR-xxxx ID
            cur.execute("SELECT COUNT(*) FROM incidents;")
            seq = cur.fetchone()[0] + 2050
            incident_id = f"TVR-{seq}"

            now = datetime.now(timezone.utc).isoformat()
            priority = triage.priority if triage else req.priority
            category = triage.category if triage else req.category
            status = IncidentStatus.PENDING_TRIAGE

            attachments_data = [a.model_dump() for a in req.attachments]

            with conn:
                conn.execute(
                    """
                    INSERT INTO incidents (
                        id, reporter_name, reporter_phone, location_name, lat, lng,
                        description, category, priority, status, created_at,
                        triage_json, dispatch_json, attachments_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        incident_id,
                        req.reporter_name,
                        req.reporter_phone,
                        req.location_name,
                        req.lat,
                        req.lng,
                        req.description,
                        category.value,
                        priority.value,
                        status.value,
                        now,
                        triage.model_dump_json() if triage else None,
                        None,
                        json.dumps(attachments_data),
                    ),
                )

                # Add initial timeline event
                conn.execute(
                    """
                    INSERT INTO timeline_events (incident_id, timestamp, status, actor, message)
                    VALUES (?, ?, ?, ?, ?);
                    """,
                    (
                        incident_id,
                        now,
                        "Report Received",
                        f"Reporter {req.reporter_name}",
                        f"Incident logged at {req.location_name} with {len(req.attachments)} attachments.",
                    ),
                )

                if triage:
                    conn.execute(
                        """
                        INSERT INTO timeline_events (incident_id, timestamp, status, actor, message)
                        VALUES (?, ?, ?, ?, ?);
                        """,
                        (
                            incident_id,
                            now,
                            "AI Triage Complete",
                            "AI Clinical Engine",
                            f"Assigned priority {triage.priority.value} (Score {triage.severity_score}/100). {triage.recommended_service}",
                        ),
                    )

            return self.get_incident(incident_id)

    def assign_dispatch(
        self,
        incident_id: str,
        unit_id: str,
        operator_name: str = "Dispatcher",
        operator_notes: Optional[str] = None,
        custom_eta: Optional[int] = None,
    ) -> Incident:
        with self._lock:
            conn = get_db_connection()
            cur = conn.cursor()

            cur.execute("SELECT * FROM incidents WHERE id = ?;", (incident_id,))
            inc_row = cur.fetchone()
            if not inc_row:
                raise KeyError(f"Incident {incident_id} not found")

            cur.execute("SELECT * FROM responders WHERE id = ?;", (unit_id,))
            unit_row = cur.fetchone()
            if not unit_row:
                raise KeyError(f"Responder unit {unit_id} not found")

            now = datetime.now(timezone.utc).isoformat()
            eta = custom_eta if custom_eta is not None else unit_row["eta_minutes"]

            dispatch_details = DispatchDetails(
                unit_id=unit_row["id"],
                unit_name=unit_row["name"],
                responder_type=unit_row["type"],
                eta_minutes=eta,
                dispatched_at=now,
                operator_name=operator_name,
                operator_notes=operator_notes or f"Unit {unit_row['name']} dispatched by {operator_name}.",
            )

            with conn:
                # Update responder
                conn.execute(
                    "UPDATE responders SET status = 'Dispatched', assigned_incident_id = ? WHERE id = ?;",
                    (incident_id, unit_id),
                )

                # Update incident
                conn.execute(
                    "UPDATE incidents SET status = ?, dispatch_json = ? WHERE id = ?;",
                    (IncidentStatus.DISPATCHED.value, dispatch_details.model_dump_json(), incident_id),
                )

                # Log timeline
                conn.execute(
                    """
                    INSERT INTO timeline_events (incident_id, timestamp, status, actor, message)
                    VALUES (?, ?, ?, ?, ?);
                    """,
                    (
                        incident_id,
                        now,
                        "Dispatch Approved",
                        operator_name,
                        f"Approved dispatch of {unit_row['name']} (ETA: {eta} min). {operator_notes or ''}".strip(),
                    ),
                )

            return self.get_incident(incident_id)

    dispatch_unit = assign_dispatch

    def update_incident_status(
        self,
        incident_id: str,
        status: IncidentStatus,
        actor: str = "Dispatcher",
        message: Optional[str] = None,
    ) -> Incident:
        with self._lock:
            conn = get_db_connection()
            cur = conn.cursor()

            cur.execute("SELECT * FROM incidents WHERE id = ?;", (incident_id,))
            inc_row = cur.fetchone()
            if not inc_row:
                raise KeyError(f"Incident {incident_id} not found")

            now = datetime.now(timezone.utc).isoformat()
            dispatch_json = inc_row["dispatch_json"]

            with conn:
                conn.execute(
                    "UPDATE incidents SET status = ? WHERE id = ?;",
                    (status.value, incident_id),
                )

                if dispatch_json:
                    disp = json.loads(dispatch_json)
                    unit_id = disp.get("unit_id")
                    if unit_id:
                        if status == IncidentStatus.EN_ROUTE:
                            conn.execute("UPDATE responders SET status = 'En Route' WHERE id = ?;", (unit_id,))
                        elif status == IncidentStatus.ON_SCENE:
                            conn.execute("UPDATE responders SET status = 'On Scene' WHERE id = ?;", (unit_id,))
                        elif status in (IncidentStatus.RESOLVED, IncidentStatus.CANCELLED):
                            conn.execute(
                                "UPDATE responders SET status = 'Available', assigned_incident_id = NULL WHERE id = ?;",
                                (unit_id,),
                            )

                log_msg = message or f"Status transitioned to {status.value.replace('_', ' ').title()}."
                conn.execute(
                    """
                    INSERT INTO timeline_events (incident_id, timestamp, status, actor, message)
                    VALUES (?, ?, ?, ?, ?);
                    """,
                    (incident_id, now, status.value.replace("_", " ").title(), actor, log_msg),
                )

            return self.get_incident(incident_id)

    def update_triage(
        self,
        incident_id: str,
        triage: TriageAssessment,
        actor: str = "AI Triage Engine",
    ) -> Incident:
        with self._lock:
            conn = get_db_connection()
            cur = conn.cursor()

            cur.execute("SELECT * FROM incidents WHERE id = ?;", (incident_id,))
            inc_row = cur.fetchone()
            if not inc_row:
                raise KeyError(f"Incident {incident_id} not found")

            now = datetime.now(timezone.utc).isoformat()

            with conn:
                conn.execute(
                    "UPDATE incidents SET priority = ?, category = ?, triage_json = ? WHERE id = ?;",
                    (triage.priority.value, triage.category.value, triage.model_dump_json(), incident_id),
                )

                conn.execute(
                    """
                    INSERT INTO timeline_events (incident_id, timestamp, status, actor, message)
                    VALUES (?, ?, ?, ?, ?);
                    """,
                    (
                        incident_id,
                        now,
                        "Triage Updated",
                        actor,
                        f"Re-evaluated priority: {triage.priority.value} (Score: {triage.severity_score}/100).",
                    ),
                )

            return self.get_incident(incident_id)

    def get_responders(self) -> List[ResponderUnit]:
        with self._lock:
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM responders ORDER BY id ASC;")
            rows = cur.fetchall()
            return [self._row_to_responder(r) for r in rows]

    def update_responder_status(self, unit_id: str, status: str) -> ResponderUnit:
        with self._lock:
            conn = get_db_connection()
            with conn:
                conn.execute("UPDATE responders SET status = ? WHERE id = ?;", (status, unit_id))

            cur = conn.cursor()
            cur.execute("SELECT * FROM responders WHERE id = ?;", (unit_id,))
            row = cur.fetchone()
            if not row:
                raise KeyError(f"Responder unit {unit_id} not found")
            return self._row_to_responder(row)

    def get_stats(self) -> DepartmentStats:
        with self._lock:
            conn = get_db_connection()
            cur = conn.cursor()

            cur.execute("SELECT priority, status, dispatch_json FROM incidents;")
            inc_rows = cur.fetchall()

            cur.execute("SELECT status FROM responders;")
            resp_rows = cur.fetchall()

        active = [r for r in inc_rows if r["status"] not in (IncidentStatus.RESOLVED.value, IncidentStatus.CANCELLED.value)]
        p1 = len([r for r in active if r["priority"] == IncidentPriority.P1.value])
        p2 = len([r for r in active if r["priority"] == IncidentPriority.P2.value])
        p3 = len([r for r in active if r["priority"] == IncidentPriority.P3.value])
        available = len([r for r in resp_rows if r["status"] == "Available"])

        return DepartmentStats(
            active_incidents=len(active),
            p1_critical_count=p1,
            p2_urgent_count=p2,
            p3_standard_count=p3,
            available_units=available,
            total_units=len(resp_rows),
            avg_response_time_minutes=4.4,
            dispatched_today=len([r for r in inc_rows if r["dispatch_json"] is not None]),
        )


# Global singleton instance
store = IncidentStore()
