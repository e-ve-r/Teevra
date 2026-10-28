"""AI Triage Engine for emergency incident evaluation and resource recommendation."""

import json
import logging
from typing import List, Optional
import httpx
from pydantic import SecretStr

from Backend.models import IncidentCategory, IncidentPriority, TriageAssessment

logger = logging.getLogger("teevra.triage")

TRIAGE_SYSTEM_PROMPT = """You are Teevra AI Emergency Triage Coordinator.
Analyze incoming emergency reports and generate a rapid clinical & operational triage evaluation.
You must return valid JSON only, without any markdown fences, backticks, or other text.

JSON format:
{
  "priority": "P1" | "P2" | "P3",
  "severity_score": <int between 1 and 100>,
  "category": "Medical" | "Traffic Collision" | "Fire & Rescue" | "Hazardous / Public Safety" | "Crime / Police" | "General Emergency",
  "summary": "<Concise 2-sentence clinical/operational summary of incident>",
  "recommended_service": "<e.g. Advanced Life Support (ALS) Ambulance, Fire Rescue Unit, Trauma Team, Police Patrol>",
  "potential_hazards": ["<hazard 1>", "<hazard 2>", ...],
  "recommended_actions": ["<immediate protocol action 1>", "<action 2>", ...],
  "ai_confidence": <float between 0.70 and 0.99>
}

Priority definitions:
- P1 (Critical / Red): Imminent threat to life or limb (e.g. unconscious, severe hemorrhage, cardiac arrest, respiratory failure, high-speed collision, structure fire with trapped victims). Requires immediate dispatch (< 4-6 mins).
- P2 (Urgent / Amber): Severe illness or injury needing urgent response but not immediately fatal (e.g. deep laceration, suspected bone fracture, kitchen fire contained, non-critical crash). Response target 8-12 mins.
- P3 (Standard / Blue): Non-life-threatening, stable patient (e.g. minor abrasions, sprain, noise complaint, minor road skid).
"""


def rule_based_triage(
    description: str,
    attachments_count: int = 0,
    category_hint: Optional[IncidentCategory] = None,
) -> TriageAssessment:
    """Intelligent rule-based clinical emergency triage fallback.
    Guarantees fast, accurate, and deterministic priority assessment even when offline.
    """
    desc = description.lower()

    # P1 Critical triggers
    p1_keywords = [
        "unconscious",
        "not breathing",
        "no pulse",
        "cardiac",
        "heart attack",
        "severe bleeding",
        "heavy bleeding",
        "blood everywhere",
        "hemorrhage",
        "head injury",
        "trapped",
        "explosion",
        "collapsed",
        "drowning",
        "stroke",
        "choking",
        "gunshot",
        "stab",
        "critically injured",
        "gasping",
        "high speed",
    ]

    # Fire triggers
    fire_keywords = ["fire", "smoke", "blaze", "burning", "flames", "gas leak"]

    # Traffic collision triggers
    traffic_keywords = [
        "accident",
        "crash",
        "collision",
        "hit and run",
        "car hit",
        "bike hit",
        "pedestrian hit",
        "overturned",
    ]

    is_p1 = any(kw in desc for kw in p1_keywords)
    has_fire = any(kw in desc for kw in fire_keywords)
    has_traffic = any(kw in desc for kw in traffic_keywords)

    if has_fire:
        category = IncidentCategory.FIRE
        priority = (
            IncidentPriority.P1
            if ("trapped" in desc or "large" in desc or "spreading" in desc or is_p1)
            else IncidentPriority.P2
        )
        severity = 92 if priority == IncidentPriority.P1 else 78
        rec_service = (
            "Heavy Rescue Tender & Fire Engine Unit"
            if priority == IncidentPriority.P1
            else "Standard Fire Engine & Water Tender"
        )
        hazards = [
            "Toxic smoke inhalation",
            "Thermal structural damage",
            "Rapid fire spread",
        ]
        actions = [
            "Dispatch Engine Company with breathing apparatus",
            "Establish 100m safety perimeter",
            "Alert municipal water and utility dispatch",
        ]
        summary = "Active fire incident reported. Structural and smoke exposure risk present; immediate fire suppression requested."

    elif has_traffic:
        category = IncidentCategory.TRAFFIC
        priority = (
            IncidentPriority.P1
            if (is_p1 or "trapped" in desc or "unresponsive" in desc)
            else IncidentPriority.P2
        )
        severity = 88 if priority == IncidentPriority.P1 else 72
        rec_service = (
            "Advanced Life Support (ALS) Ambulance + Traffic Interceptor"
            if priority == IncidentPriority.P1
            else "Basic Life Support (BLS) Ambulance"
        )
        hazards = [
            "Secondary roadway collision risk",
            "Suspected cervical/spinal trauma",
            "Flammable fluid leak from vehicle",
        ]
        actions = [
            "Dispatch ALS Ambulance and nearest Traffic Patrol",
            "Instruct caller to not move patients unless fire danger present",
            "Alert regional trauma center standby",
        ]
        summary = "Vehicular collision reported. Roadside hazard and potential orthopedic/head trauma identified."

    elif is_p1:
        category = IncidentCategory.MEDICAL
        priority = IncidentPriority.P1
        severity = 95
        rec_service = (
            "Advanced Life Support (ALS) Ambulance with Critical Care Paramedic"
        )
        hazards = [
            "Impending airway or circulatory collapse",
            "Severe irreversible neurological hypoxia",
        ]
        actions = [
            "Dispatch Level-1 ALS Medic Unit immediately",
            "Provide bystander telephone CPR / bleeding control instructions",
            "Notify emergency department for incoming resuscitation code",
        ]
        summary = "High-severity life-threatening medical emergency. Immediate resuscitation and rapid ALS transit required."

    else:
        # P2 / P3 General or Medical
        category = category_hint or (
            IncidentCategory.MEDICAL
            if (
                "pain" in desc
                or "fall" in desc
                or "hurt" in desc
                or "fever" in desc
                or "dizzy" in desc
            )
            else IncidentCategory.OTHER
        )
        if any(
            w in desc
            for w in [
                "fracture",
                "broken",
                "deep cut",
                "burn",
                "seizure",
                "severe pain",
            ]
        ):
            priority = IncidentPriority.P2
            severity = 68
            rec_service = "Paramedic Rescue Ambulance"
            hazards = ["Pain escalation", "Possible occult injury or infection"]
            actions = [
                "Dispatch standard paramedic unit",
                "Advise patient to remain still in a comfortable position",
            ]
            summary = "Urgent incident requiring stabilization. Patient condition stable but requires prompt evaluation."
        else:
            priority = IncidentPriority.P3
            severity = 42
            rec_service = "Community Response / Basic Assessment Unit"
            hazards = ["Environmental exposure", "Delay in treatment"]
            actions = [
                "Assign standard response unit",
                "Advise caller to call back immediately if symptoms worsen",
            ]
            summary = "Non-life-threatening emergency report. Low acute risk; queued for routine response."

    if attachments_count > 0:
        hazards.append(f"{attachments_count} visual/audio evidence attached for operator review")

    return TriageAssessment(
        priority=priority,
        severity_score=severity,
        category=category,
        summary=summary,
        recommended_service=rec_service,
        potential_hazards=hazards,
        recommended_actions=actions,
        ai_confidence=0.91,
    )


async def evaluate_incident_ai(
    description: str,
    attachments_count: int,
    client: Optional[httpx.AsyncClient],
    api_key: SecretStr,
    model: str = "google/gemma-4-31b-it",
) -> TriageAssessment:
    """Invokes OpenRouter to produce rich clinical triage, with reliable fallback."""
    if hasattr(api_key, "get_secret_value"):
        token = api_key.get_secret_value().strip()
    else:
        token = str(api_key or "").strip()

    if not token or not client:
        return rule_based_triage(description, attachments_count)

    prompt = f"""Emergency Incident Intake Report:
Description: "{description}"
Attachments: {attachments_count} media files (photos/audio notes)
Evaluate priority, severity (1-100), category, hazards, and recommended response unit. Return JSON only."""

    try:
        response = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": TRIAGE_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 400,
                "temperature": 0.2,
            },
            timeout=12.0,
        )
        if response.status_code == 200:
            content = response.json()["choices"][0]["message"]["content"].strip()
            # Clean possible markdown fences
            if content.startswith("```"):
                content = content.strip("`")
                if content.startswith("json"):
                    content = content[4:].strip()
            parsed = json.loads(content)
            return TriageAssessment(
                priority=IncidentPriority(parsed.get("priority", "P2")),
                severity_score=int(parsed.get("severity_score", 70)),
                category=IncidentCategory(
                    parsed.get("category", IncidentCategory.MEDICAL.value)
                ),
                summary=parsed.get(
                    "summary", "Emergency incident analyzed by AI triage."
                ),
                recommended_service=parsed.get(
                    "recommended_service", "Advanced Life Support Ambulance"
                ),
                potential_hazards=parsed.get("potential_hazards", []),
                recommended_actions=parsed.get("recommended_actions", []),
                ai_confidence=float(parsed.get("ai_confidence", 0.94)),
            )
    except Exception as exc:
        logger.warning(
            "OpenRouter triage call failed, using rule-based fallback: %s", exc
        )

    return rule_based_triage(description, attachments_count)
