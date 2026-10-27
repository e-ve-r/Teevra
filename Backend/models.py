"""Data models for Teevra emergency incident intake, triage, and dispatch."""

from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class IncidentPriority(str, Enum):
    P1 = "P1"  # Critical / Life-threatening
    P2 = "P2"  # Urgent / Serious
    P3 = "P3"  # Standard / Non-critical


class IncidentStatus(str, Enum):
    PENDING_TRIAGE = "pending_triage"
    TRIAGE_COMPLETE = "triage_complete"
    DISPATCHED = "dispatched"
    EN_ROUTE = "en_route"
    ON_SCENE = "on_scene"
    RESOLVED = "resolved"
    CANCELLED = "cancelled"


class IncidentCategory(str, Enum):
    MEDICAL = "Medical"
    TRAFFIC = "Traffic Collision"
    FIRE = "Fire & Rescue"
    HAZARD = "Hazardous / Public Safety"
    POLICE = "Crime / Police"
    OTHER = "General Emergency"


class Attachment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%f"))
    name: str
    kind: str  # "image" or "audio"
    url: Optional[str] = None
    size: Optional[int] = None


class TriageAssessment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    priority: IncidentPriority
    severity_score: int = Field(ge=0, le=100)
    category: IncidentCategory
    summary: str
    recommended_service: str
    potential_hazards: List[str] = Field(default_factory=list)
    recommended_actions: List[str] = Field(default_factory=list)
    ai_confidence: float = Field(default=0.92, ge=0.0, le=1.0)
    assessed_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class TimelineEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    status: str
    actor: str  # e.g., "AI Triage System", "Dispatcher Alex", "Reporter"
    message: str


class DispatchDetails(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    unit_id: str
    unit_name: str
    responder_type: str = Field(default="Ambulance", alias="unit_type")
    eta_minutes: int
    dispatched_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    operator_name: str = "Dispatcher"
    operator_notes: Optional[str] = None


class ResponderUnit(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    type: str  # "Ambulance", "Fire", "Police", "Trauma ALS"
    status: str  # "Available", "Dispatched", "En Route", "On Scene", "Off Duty"
    base_station: str
    current_location: str
    eta_minutes: int
    distance_km: float
    crew: List[str]
    assigned_incident_id: Optional[str] = None


class IncidentCreateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reporter_name: str = "Alex Kumar"
    reporter_phone: Optional[str] = "+91 98765 43210"
    location_name: Optional[str] = "Connaught Place, Inner Circle"
    lat: Optional[float] = 28.6315
    lng: Optional[float] = 77.2167
    description: str = Field(min_length=1, max_length=2000)
    attachments: List[Attachment] = Field(default_factory=list)
    category: Optional[IncidentCategory] = None


class Incident(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    reporter_name: str
    reporter_phone: str
    location_name: str
    lat: float
    lng: float
    description: str
    category: IncidentCategory
    priority: IncidentPriority
    status: IncidentStatus
    created_at: str
    attachments: List[Attachment] = Field(default_factory=list)
    triage: Optional[TriageAssessment] = None
    dispatch: Optional[DispatchDetails] = None
    timeline: List[TimelineEvent] = Field(default_factory=list)


class DispatchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    unit_id: str
    operator_name: str = "Dispatcher 04"
    operator_notes: Optional[str] = None
    eta_minutes: Optional[int] = None


class StatusUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    status: IncidentStatus
    actor: str = "Dispatcher"
    message: Optional[str] = None


class DepartmentStats(BaseModel):
    active_incidents: int
    p1_critical_count: int
    p2_urgent_count: int
    p3_standard_count: int
    available_units: int
    total_units: int
    avg_response_time_minutes: float
    dispatched_today: int
