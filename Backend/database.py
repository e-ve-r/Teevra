"""SQLite Database layer for Teevra Emergency Operations Center.
Provides persistent ACID storage for incidents, responder units, and CAD event logs.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import threading
from typing import Any, Dict, List, Optional

DB_PATH = Path(__file__).resolve().parent / "teevra.db"

_local = threading.local()


def get_db_connection() -> sqlite3.Connection:
    """Get a thread-local SQLite connection with WAL mode enabled."""
    if not hasattr(_local, "connection") or _local.connection is None:
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        _local.connection = conn
    return _local.connection


def close_db_connection():
    connection = getattr(_local, "connection", None)
    if connection is not None:
        connection.close()
        _local.connection = None


def init_database():
    """Create tables if not already present, and seed initial incidents if empty."""
    conn = get_db_connection()
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS responders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                base_station TEXT NOT NULL,
                current_location TEXT NOT NULL,
                eta_minutes INTEGER NOT NULL,
                distance_km REAL NOT NULL,
                crew_json TEXT NOT NULL,
                assigned_incident_id TEXT
            );
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY,
                reporter_name TEXT NOT NULL,
                reporter_phone TEXT NOT NULL,
                location_name TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                priority TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                triage_json TEXT,
                dispatch_json TEXT,
                attachments_json TEXT NOT NULL
            );
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS timeline_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                status TEXT NOT NULL,
                actor TEXT NOT NULL,
                message TEXT NOT NULL,
                FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
            );
        """)

        # Check if responders table needs seeding
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM responders;")
        count = cursor.fetchone()[0]
        if count == 0:
            _seed_responders(conn)

        # Check if incidents table needs seeding
        cursor.execute("SELECT COUNT(*) FROM incidents;")
        count = cursor.fetchone()[0]
        if count == 0:
            _seed_incidents(conn)

        # Additive migration preserves existing incident and fleet records.
        migrations = {
            "incidents": {
                "coordinates_known": "INTEGER NOT NULL DEFAULT 1",
                "location_accuracy_m": "REAL",
                "updates_json": "TEXT NOT NULL DEFAULT '[]'",
                "dispatches_json": "TEXT NOT NULL DEFAULT '[]'",
                "revision": "INTEGER NOT NULL DEFAULT 0",
            },
            "responders": {
                "lat": "REAL", "lng": "REAL", "location_updated_at": "TEXT",
                "location_source": "TEXT NOT NULL DEFAULT 'demo'",
            },
        }
        for table, columns in migrations.items():
            existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            for name, definition in columns.items():
                if name not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        demo_positions = {
            "AMB-101": (12.9745, 77.6450), "AMB-104": (12.9609, 77.6387),
            "FIRE-202": (12.9815, 77.6270), "POL-301": (12.9750, 77.6405),
            "AMB-108": (12.9680, 77.6430),
        }
        for unit_id, (lat, lng) in demo_positions.items():
            conn.execute("UPDATE responders SET lat = ?, lng = ? WHERE id = ? AND lat IS NULL AND location_source = 'demo'", (lat, lng, unit_id))
        # Older versions stored dispatches without updating fleet readiness.
        # Reconcile those assignments before exposing available vehicles.
        for row in conn.execute("SELECT id, status, dispatch_json, dispatches_json FROM incidents WHERE status NOT IN ('resolved', 'cancelled') ORDER BY created_at DESC"):
            dispatches = json.loads(row["dispatches_json"] or "[]")
            if not dispatches and row["dispatch_json"]:
                dispatches = [json.loads(row["dispatch_json"])]
            for dispatch in dispatches:
                conn.execute("UPDATE responders SET status = ?, assigned_incident_id = ? WHERE id = ? AND assigned_incident_id IS NULL AND status != 'Off Duty'", (
                    row["status"].replace("_", " ").title(), row["id"], dispatch["unit_id"],
                ))


def _seed_responders(conn: sqlite3.Connection):
    seed_fleet = [
        (
            "AMB-101",
            "Medic-1 ALS Ambulance",
            "Ambulance",
            "Available",
            "Apollo Clinic Base, Indiranagar",
            "12th Main Road Junction",
            4,
            1.4,
            json.dumps(["Dr. Priya Sharma (Paramedic)", "R. Nair (EMT-Basic)"]),
            None,
        ),
        (
            "AMB-104",
            "Rapid Rescue Medic-4",
            "Ambulance",
            "Available",
            "Old Airport Road EMS",
            "Domlur Flyover Ramp",
            7,
            2.8,
            json.dumps(["K. Verma (Critical Care Paramedic)", "A. Khan (Driver/EMT)"]),
            None,
        ),
        (
            "FIRE-202",
            "Heavy Rescue Tender 2",
            "Fire",
            "Available",
            "Ulsoor Fire Station",
            "Ulsoor Station Bay 3",
            6,
            2.2,
            json.dumps(["Station Officer M. David", "Crew: 4 Firefighters"]),
            None,
        ),
        (
            "POL-301",
            "Traffic Interceptor Patrol 12",
            "Police",
            "Available",
            "Indiranagar Traffic Police Station",
            "CMH Road & 80 Feet Rd Crossing",
            3,
            0.9,
            json.dumps(["Sub-Inspector S. Rao", "Constable G. Gowda"]),
            None,
        ),
        (
            "AMB-108",
            "Trauma Critical Care 8",
            "Trauma ALS",
            "On Scene",
            "Manipal Hospital Trauma Wing",
            "100 Feet Road, Indiranagar",
            0,
            0.0,
            json.dumps(["Dr. Ananya Roy (ER Physician)", "V. Joshi (Flight Paramedic)"]),
            "TVR-2041",
        ),
    ]

    conn.executemany("""
        INSERT INTO responders (id, name, type, status, base_station, current_location, eta_minutes, distance_km, crew_json, assigned_incident_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, seed_fleet)


def _seed_incidents(conn: sqlite3.Connection):
    now = datetime.now(timezone.utc).isoformat()

    # Incident 1: TVR-2041 (P1 High-speed collision - Realistic traffic accident photo)
    triage_2041 = {
        "priority": "P1",
        "severity_score": 96,
        "category": "Traffic Collision",
        "summary": "High-speed head-on collision with pinned unresponsive occupant, severe hemorrhage, and active fuel leak. Immediate ALS and hydraulic extrication required.",
        "recommended_service": "Trauma Critical Care Ambulance + Fire Rescue Tender",
        "scene_hazards": [
            "Occupant entrapment with spinal trauma",
            "Active fuel leak ignition risk",
            "Secondary roadway collision",
        ],
        "dispatcher_checklist": [
            "Dispatch Trauma Critical Care ALS",
            "Dispatch Fire Extrication unit",
            "Instruct caller to establish 50m clear perimeter",
        ],
    }
    dispatch_2041 = {
        "unit_id": "AMB-108",
        "unit_name": "Trauma Critical Care 8",
        "responder_type": "Trauma ALS",
        "dispatched_at": now,
        "eta_minutes": 0,
        "operator_notes": "Priority sirens authorized. Trauma ER team alerted for immediate surgical intake.",
    }
    attachments_2041 = [
        {
            "id": "att-1",
            "name": "accident_collision_front.jpg",
            "kind": "image",
            "url": "https://images.unsplash.com/photo-1599058917212-d750089bc07e?auto=format&fit=crop&w=1200&q=80",
            "size": 2450000,
        },
        {
            "id": "att-2",
            "name": "vehicle_extrication_scene.jpg",
            "kind": "image",
            "url": "https://images.unsplash.com/photo-1587745416684-47b88f3ce0b6?auto=format&fit=crop&w=1200&q=80",
            "size": 1890000,
        },
    ]

    # Incident 2: TVR-2045 (P1 Acute Myocardial Infarction)
    triage_2045 = {
        "priority": "P1",
        "severity_score": 94,
        "category": "Medical",
        "summary": "Classic acute coronary syndrome / suspected myocardial infarction with respiratory compromise. Critical life threat; urgent cardiac ALS transit required.",
        "recommended_service": "Medic-1 ALS Ambulance with 12-lead ECG & Defibrillator",
        "scene_hazards": [
            "Sudden cardiac arrest / ventricular arrhythmia",
            "Cardiogenic shock risk",
        ],
        "dispatcher_checklist": [
            "Immediate dispatch of ALS Ambulance with cardiac monitor",
            "Advise caller to keep patient sitting upright, loosen tight collar",
            "Prepare for telephone CPR guidance if unresponsiveness occurs",
        ],
    }
    dispatch_2045 = {
        "unit_id": "AMB-101",
        "unit_name": "Medic-1 ALS Ambulance",
        "responder_type": "Ambulance",
        "dispatched_at": now,
        "eta_minutes": 4,
        "operator_notes": "Pre-notified Apollo Cardiology triage desk. 12-lead telemetry enabled.",
    }
    attachments_2045 = [
        {
            "id": "att-audio-1",
            "name": "caller_audio_note.webm",
            "kind": "audio",
            "url": None,
            "size": 420000,
        }
    ]

    # Incident 3: TVR-2047 (P2 Kitchen Fire)
    triage_2047 = {
        "priority": "P2",
        "severity_score": 74,
        "category": "Fire & Rescue",
        "summary": "Commercial kitchen exhaust grease flare-up. Heavy particulate smoke filling indoor seating area. Potential structural extension without prompt containment.",
        "recommended_service": "Fire Heavy Rescue Tender + BLS Evacuation Support",
        "scene_hazards": [
            "Grease fire water-incompatibility (Class K / Class B)",
            "Toxic smoke inhalation for restaurant occupants",
        ],
        "dispatcher_checklist": [
            "Order immediate full evacuation of structure",
            "Ensure building main gas supply valve is closed",
            "Warn occupants NOT to apply water to burning oil",
        ],
    }
    dispatch_2047 = {
        "unit_id": "FIRE-202",
        "unit_name": "Heavy Rescue Tender 2",
        "responder_type": "Fire",
        "dispatched_at": now,
        "eta_minutes": 6,
        "operator_notes": "Crew deploying Class K wet-chemical extinguishers and thermal imaging camera.",
    }
    attachments_2047 = [
        {
            "id": "att-3",
            "name": "exhaust_flame_smoke.jpg",
            "kind": "image",
            "url": "https://images.unsplash.com/photo-1542385151-efd9000785a0?auto=format&fit=crop&w=1200&q=80",
            "size": 3120000,
        }
    ]

    # Incident 4: TVR-2038 (P3 Minor road skid - Resolved)
    triage_2038 = {
        "priority": "P3",
        "severity_score": 28,
        "category": "Medical",
        "summary": "Low-velocity scooter slip with superficial abrasion. Conscious, alert, vitals stable, no loss of consciousness or cervical spine tenderness.",
        "recommended_service": "BLS First Responder / Self Care Guidance",
        "scene_hazards": ["Roadway traffic hazard on wet pavement"],
        "dispatcher_checklist": [
            "Move patient safely onto pedestrian sidewalk",
            "Apply clean pressure dressing to knee abrasion",
        ],
    }
    attachments_2038 = []

    incidents_data = [
        (
            "TVR-2041",
            "Vikram Sethi",
            "+91 98450 11223",
            "100 Feet Road, Indiranagar, Bengaluru",
            12.9716,
            77.6412,
            "Two cars collided head-on at high speed. Driver trapped in front vehicle with heavy head bleeding and shallow breathing. Fuel leaking on asphalt.",
            "Traffic Collision",
            "P1",
            "on_scene",
            now,
            json.dumps(triage_2041),
            json.dumps(dispatch_2041),
            json.dumps(attachments_2041),
        ),
        (
            "TVR-2045",
            "Sunita Rao",
            "+91 98450 99882",
            "HAL 2nd Stage, 12th Main, Bengaluru",
            12.9658,
            77.6534,
            "Elderly male, 68 years, sudden severe clutching chest pain radiating to left arm. Profuse cold sweating, pale, struggling to breathe. Conscious but unable to speak in sentences.",
            "Medical",
            "P1",
            "dispatched",
            now,
            json.dumps(triage_2045),
            json.dumps(dispatch_2045),
            json.dumps(attachments_2045),
        ),
        (
            "TVR-2047",
            "Arjun Patel",
            "+91 98450 44556",
            "Domlur 1st Stage, Near Shanti Sagar, Bengaluru",
            12.9609,
            77.6387,
            "Grease fire in restaurant kitchen exhaust hood. Thick dark smoke filling ground floor dining area. Commercial gas cylinder lines nearby. Evacuation underway.",
            "Fire & Rescue",
            "P2",
            "en_route",
            now,
            json.dumps(triage_2047),
            json.dumps(dispatch_2047),
            json.dumps(attachments_2047),
        ),
        (
            "TVR-2038",
            "Kavita Menon",
            "+91 98450 77112",
            "CMH Road, Metro Pillar 42, Bengaluru",
            12.9782,
            77.6398,
            "Scooter slipped on wet road markings. Minor gravel rash on left knee, helmet intact. Conscious, oriented, no head strike, refusing ambulance transit.",
            "Medical",
            "P3",
            "resolved",
            now,
            json.dumps(triage_2038),
            None,
            json.dumps(attachments_2038),
        ),
    ]

    conn.executemany("""
        INSERT INTO incidents (id, reporter_name, reporter_phone, location_name, lat, lng, description, category, priority, status, created_at, triage_json, dispatch_json, attachments_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, incidents_data)

    # Seed initial timeline events
    timeline_data = [
        ("TVR-2041", now, "Report Received", "Reporter Vikram Sethi", "Incident submitted via Teevra Mobile App with 2 photos."),
        ("TVR-2041", now, "AI Triage Complete", "AI Clinical Engine", "Classified as P1-Critical (Severity 96/100). ALS extrication recommended."),
        ("TVR-2041", now, "Dispatch Approved", "Operator Sharma", "Unit AMB-108 dispatched with priority sirens."),
        ("TVR-2041", now, "On Scene", "AMB-108 Unit Crew", "Unit arrived on scene. Commencing extrication and cervical stabilization."),

        ("TVR-2045", now, "Report Received", "Reporter Sunita Rao", "Voice note and emergency report registered."),
        ("TVR-2045", now, "AI Triage Complete", "AI Clinical Engine", "Identified acute cardiac emergency. Escalated to P1 Queue."),
        ("TVR-2045", now, "Dispatch Approved", "Dispatcher Desk 01", "Approved dispatch of Medic-1 ALS Ambulance (ETA: 4 min). Priority sirens authorized."),

        ("TVR-2047", now, "Report Received", "Reporter Arjun Patel", "Kitchen fire reported with active gas danger."),
        ("TVR-2047", now, "AI Triage Complete", "AI Clinical Engine", "Classified as P2-Urgent fire hazmat. Heavy tender recommended."),
        ("TVR-2047", now, "Dispatch Approved", "Dispatcher Desk 02", "Heavy Rescue Tender 2 en route via Old Airport Road."),

        ("TVR-2038", now, "Report Received", "Reporter Kavita Menon", "Report submitted for minor slip."),
        ("TVR-2038", now, "Triage Completed", "AI Clinical Engine", "P3 Standard First Aid advice issued."),
        ("TVR-2038", now, "Resolved", "Operator Sharma", "Caller confirmed safe and wound treated. Incident closed."),
    ]

    conn.executemany("""
        INSERT INTO timeline_events (incident_id, timestamp, status, actor, message)
        VALUES (?, ?, ?, ?, ?);
    """, timeline_data)
