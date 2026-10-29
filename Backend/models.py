"""Data models for Teevra emergency incident intake, triage, and dispatch."""

from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    recommended_departments: List[str] = Field(default_factory=list)
    source: str = "ai"
    review_required: bool = False
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
    eta_minutes: Optional[int] = None
    distance_km: Optional[float] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    location_updated_at: Optional[str] = None
    location_source: str = "demo"
    eta_basis: str = "approximate"
    department: str = "Medical"
    crew: List[str]
    assigned_incident_id: Optional[str] = None


class IncidentCreateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reporter_name: str = Field(default="Reporter", min_length=1, max_length=80)
    reporter_phone: str = Field(pattern=r"^\+?[\d\s()-]{7,22}$")
    location_name: str = Field(min_length=1, max_length=300)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    location_accuracy_m: Optional[float] = Field(default=None, ge=0)
    description: str = Field(min_length=1, max_length=2000)
    attachments: List[Attachment] = Field(default_factory=list)
    category: Optional[IncidentCategory] = None

    @model_validator(mode="after")
    def coordinate_pair(self):
        if (self.lat is None) != (self.lng is None):
            raise ValueError("Latitude and longitude must be supplied together")
        if not 7 <= sum(c.isdigit() for c in self.reporter_phone) <= 15:
            raise ValueError("Enter a valid mobile number including country code")
        return self


class IncidentUpdateRequest(BaseModel):
    description: str = Field(default="", max_length=2000)
    attachments: List[Attachment] = Field(default_factory=list, max_length=10)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    location_name: Optional[str] = Field(default=None, max_length=300)
    location_accuracy_m: Optional[float] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def valid_update(self):
        if not self.description.strip() and not self.attachments:
            raise ValueError("Describe the change or attach media")
        if (self.lat is None) != (self.lng is None):
            raise ValueError("Latitude and longitude must be supplied together")
        return self


class IncidentUpdate(BaseModel):
    timestamp: str
    description: str
    attachments: List[Attachment] = Field(default_factory=list)


class ResponderLocationRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    current_location: str = Field(min_length=1, max_length=300)


class Incident(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    reporter_name: str
    reporter_phone: str
    location_name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    location_accuracy_m: Optional[float] = None
    description: str
    category: IncidentCategory
    priority: IncidentPriority
    status: IncidentStatus
    created_at: str
    attachments: List[Attachment] = Field(default_factory=list)
    triage: Optional[TriageAssessment] = None
    dispatch: Optional[DispatchDetails] = None
    dispatches: List[DispatchDetails] = Field(default_factory=list)
    updates: List[IncidentUpdate] = Field(default_factory=list)
    revision: int = 0
    queue_score: float = 0
    assessment_pending: bool = False
    timeline: List[TimelineEvent] = Field(default_factory=list)


class DispatchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    unit_id: str
    operator_name: str = "Dispatcher 04"
    operator_notes: Optional[str] = None
    eta_minutes: Optional[int] = Field(default=None, ge=1, le=1440)


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
