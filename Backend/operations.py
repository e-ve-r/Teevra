"""Deterministic queue ordering and department / fleet recommendations."""
from datetime import datetime, timezone
from math import asin, ceil, cos, radians, sin, sqrt

CLOSED = {"resolved", "cancelled"}


def queue_score(incident, now=None):
    """Bounded aging promotes waiting cases without eclipsing critical cases."""
    now = now or datetime.now(timezone.utc)
    age = max(0, (now - datetime.fromisoformat(incident.created_at)).total_seconds() / 60)
    severity = incident.triage.severity_score if incident.triage else 60
    band = {"P1": 200, "P2": 100, "P3": 0}[incident.priority.value]
    return round(band + severity * .7 + min(age, 120) * .25, 2)


def department_for(unit_type):
    kind = unit_type.lower()
    return "Fire & Rescue" if "fire" in kind else "Police" if "police" in kind else "Medical"


def departments_for(category, description, suggested=()):
    departments = {d for d in suggested if d in {"Medical", "Fire & Rescue", "Police"}}
    category = getattr(category, "value", category)
    text = description.lower()
    if any(w in text for w in ("crash", "collision", "accident", "hit and run")):
        departments.update(("Police", "Medical"))
        if any(w in text for w in ("trapped", "fuel", "fire", "extricat", "overturned")):
            departments.add("Fire & Rescue")
    if category == "Fire & Rescue":
        departments.add("Fire & Rescue")
        if any(w in text for w in ("injur", "trapped", "smoke", "burn", "breath", "unconscious")):
            departments.add("Medical")
    elif category == "Traffic Collision":
        departments.update(("Medical", "Police"))
        if any(w in text for w in ("trapped", "fuel", "fire", "extricat", "overturned")):
            departments.add("Fire & Rescue")
    elif category == "Crime / Police":
        departments.add("Police")
        if any(w in text for w in ("injur", "bleed", "stab", "gunshot")):
            departments.add("Medical")
    elif category == "Hazardous / Public Safety":
        departments.update(("Fire & Rescue", "Police"))
    elif not departments:
        departments.add("Medical")
    return sorted(departments)


def estimate_unit(unit, incident):
    """Estimate from the unit's stored coordinates; no invented traffic or route data."""
    unit = unit.model_copy(deep=True)
    unit.eta_minutes = unit.distance_km = None
    if None not in (unit.lat, unit.lng, incident.lat, incident.lng):
        lat1, lat2 = radians(unit.lat), radians(incident.lat)
        dlat, dlng = lat2 - lat1, radians(incident.lng - unit.lng)
        direct = 6371 * 2 * asin(min(1, sqrt(sin(dlat / 2)**2 + cos(lat1)*cos(lat2)*sin(dlng / 2)**2)))
        unit.distance_km = round(direct * 1.3, 1)
        unit.eta_minutes = max(1, ceil(unit.distance_km / 30 * 60 + 2))
    return unit


def recommendations(incident, units):
    departments = departments_for(incident.category, incident.description + "\n" + "\n".join(u.description for u in incident.updates), incident.triage.recommended_departments if incident.triage else ())
    result = []
    for department in departments:
        fleet = [estimate_unit(u, incident) for u in units if u.department == department and u.status == "Available" and not u.assigned_incident_id]
        fleet.sort(key=lambda u: (u.eta_minutes is None, u.eta_minutes or 0, u.distance_km or 0, u.id))
        result.append({"department": department, "available_count": len(fleet), "eta_minutes": fleet[0].eta_minutes if fleet else None, "units": fleet})
    result.sort(key=lambda d: (d["eta_minutes"] is None, d["eta_minutes"] or 0, d["department"]))
    return result
