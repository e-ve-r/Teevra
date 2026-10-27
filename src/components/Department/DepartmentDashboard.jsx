import { useEffect, useState, useCallback } from "react";
import Icon from "../Icon";
import TacticalMap from "./TacticalMap";
import "./Department.css";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export default function DepartmentDashboard({ onSwitchToReporter }) {
  const [incidents, setIncidents] = useState([]);
  const [responders, setResponders] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [triageLoading, setTriageLoading] = useState(false);
  const [dispatchingUnit, setDispatchingUnit] = useState(null);
  const [operatorNotes, setOperatorNotes] = useState("");
  const [customEta, setCustomEta] = useState(4);
  const [activeMediaModal, setActiveMediaModal] = useState(null);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Manual phone intake form state
  const [manualForm, setManualForm] = useState({
    reporter_name: "Dispatcher Phone Intake",
    reporter_phone: "+91 99999 00000",
    location_name: "100 Feet Road, Indiranagar, Bengaluru",
    description: "",
  });

  // Ticker for current time
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const [incRes, respRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/incidents`),
        fetch(`${API_BASE}/api/responders`),
        fetch(`${API_BASE}/api/department/stats`),
      ]);
      if (incRes.ok) {
        const incData = await incRes.json();
        setIncidents(incData);
        setSelectedId((curr) => curr || (incData.length > 0 ? incData[0].id : null));
      }
      if (respRes.ok) {
        setResponders(await respRes.json());
      }
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
    } catch (err) {
      console.error("Failed to fetch department data", err);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function loadInitial() {
      try {
        const [incRes, respRes, statsRes] = await Promise.all([
          fetch(`${API_BASE}/api/incidents`),
          fetch(`${API_BASE}/api/responders`),
          fetch(`${API_BASE}/api/department/stats`),
        ]);
        if (ignore) return;
        if (incRes.ok) {
          const incData = await incRes.json();
          setIncidents(incData);
          setSelectedId((curr) => curr || (incData.length > 0 ? incData[0].id : null));
        }
        if (respRes.ok) setResponders(await respRes.json());
        if (statsRes.ok) setStats(await statsRes.json());
      } catch (err) {
        console.error("Failed to load initial department data", err);
      }
    }
    loadInitial();
    const poll = setInterval(fetchData, 4000);
    return () => {
      ignore = true;
      clearInterval(poll);
    };
  }, [fetchData]);

  const selectedIncident = incidents.find((i) => i.id === selectedId) || incidents[0];

  // Re-run AI triage
  const handleReevaluateTriage = async () => {
    if (!selectedIncident) return;
    setTriageLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/incidents/${selectedIncident.id}/triage`, {
        method: "POST",
      });
      if (res.ok) {
        const updated = await res.json();
        setIncidents((curr) => curr.map((inc) => (inc.id === updated.id ? updated : inc)));
      }
    } catch (err) {
      console.error("AI triage update failed", err);
    } finally {
      setTriageLoading(false);
    }
  };

  // Dispatch Unit Action
  const handleApproveDispatch = async (unitId) => {
    if (!selectedIncident || !unitId) return;
    try {
      const res = await fetch(`${API_BASE}/api/incidents/${selectedIncident.id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unit_id: unitId,
          operator_name: "Dispatcher Desk 01",
          operator_notes: operatorNotes || "Priority sirens authorized. Trauma ER alerted.",
          eta_minutes: customEta,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setIncidents((curr) => curr.map((inc) => (inc.id === updated.id ? updated : inc)));
        setOperatorNotes("");
        setDispatchingUnit(null);
        fetchData();
      }
    } catch (err) {
      console.error("Dispatch approval failed", err);
    }
  };

  // Status Lifecycle Transition
  const handleStatusTransition = async (newStatus) => {
    if (!selectedIncident) return;
    try {
      const res = await fetch(`${API_BASE}/api/incidents/${selectedIncident.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          actor: "Dispatcher Desk 01",
          message: `Incident transitioned to ${newStatus.replace("_", " ").toUpperCase()}`,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setIncidents((curr) => curr.map((inc) => (inc.id === updated.id ? updated : inc)));
        fetchData();
      }
    } catch (err) {
      console.error("Status update failed", err);
    }
  };

  // Manual 911 Call Intake
  const handleCreateManual = async (e) => {
    e.preventDefault();
    if (!manualForm.description.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reporter_name: manualForm.reporter_name,
          reporter_phone: manualForm.reporter_phone,
          location_name: manualForm.location_name,
          description: manualForm.description,
          attachments: [],
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setIncidents((curr) => [created, ...curr]);
        setSelectedId(created.id);
        setManualModalOpen(false);
        setManualForm({
          reporter_name: "Dispatcher Phone Intake",
          reporter_phone: "+91 99999 00000",
          location_name: "100 Feet Road, Indiranagar, Bengaluru",
          description: "",
        });
        fetchData();
      }
    } catch (err) {
      console.error("Failed to create manual incident", err);
    }
  };

  // Filter incidents
  const filteredIncidents = incidents.filter((inc) => {
    if (statusFilter !== "all") {
      if (statusFilter === "active" && inc.status === "resolved") return false;
      if (statusFilter === "pending" && inc.status !== "pending_triage") return false;
      if (statusFilter === "dispatched" && !["dispatched", "en_route", "on_scene"].includes(inc.status)) return false;
      if (statusFilter === "resolved" && inc.status !== "resolved") return false;
    }
    if (priorityFilter !== "all" && inc.priority !== priorityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        inc.id.toLowerCase().includes(q) ||
        inc.reporter_name.toLowerCase().includes(q) ||
        inc.description.toLowerCase().includes(q) ||
        inc.location_name.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Calculate elapsed time using pure state
  const getElapsed = (isoTime) => {
    const diffSec = Math.max(1, Math.floor((currentTime.getTime() - new Date(isoTime).getTime()) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min}m ago`;
    return `${Math.floor(min / 60)}h ago`;
  };

  return (
    <div className="dept-shell">
      {/* ================= TEEVRA TOP HEADER ================= */}
      <header className="dept-header">
        <div className="dept-header-inner">
          <div className="dept-brand-area">
            <a
              href="#home"
              className="dept-brand-link"
              onClick={(e) => {
                e.preventDefault();
                onSwitchToReporter();
              }}
              title="Return to Teevra Home"
            >
              <img src="/TeevraLogo.png" alt="Teevra" />
            </a>

            <div className="dept-title-divider" />

            <div className="dept-header-title">
              <p className="eyebrow">
                <span className="status-dot" />
                EMERGENCY OPERATIONS CENTER
              </p>
              <h1>
                Dispatch Control<span className="red-period">.</span>
              </h1>
            </div>
          </div>

          {/* Telemetry KPI Pills */}
          <div className="dept-telemetry-cluster">
            <div className="dept-stat-pill p1-alert">
              <span className="stat-label">Critical P1</span>
              <strong className="stat-value">{stats ? stats.p1_critical_count : 0}</strong>
            </div>
            <div className="dept-stat-pill">
              <span className="stat-label">Active Queue</span>
              <strong className="stat-value">{stats ? stats.active_incidents : 0}</strong>
            </div>
            <div className="dept-stat-pill fleet-ready">
              <span className="stat-label">Fleet Available</span>
              <strong className="stat-value">
                {stats ? `${stats.available_units}/${stats.total_units}` : "4/5"}
              </strong>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="dept-controls">
            <button
              className="dept-btn-small emergency"
              onClick={() => setManualModalOpen(true)}
              title="Intake new phone emergency"
            >
              <Icon name="phone" size={16} />
              <span>Intake 911 Call</span>
            </button>
            <button
              className="dept-btn-small reporter-switch"
              onClick={onSwitchToReporter}
              title="Switch to Reporter Client view"
            >
              <Icon name="user" size={16} />
              <span>Reporter App</span>
              <Icon name="arrow" size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* ================= MAIN 3-COLUMN WORKSPACE ================= */}
      <main className="dept-main-grid">
        {/* ================= LEFT COLUMN: QUEUE ================= */}
        <div className="dept-col-card">
          <div className="surface queue-panel">
            <div className="queue-header-area">
              <div className="queue-top-row">
                <h2>Emergency Queue</h2>
                <span className="queue-badge-count">{filteredIncidents.length} active</span>
              </div>

              {/* Filter Tabs */}
              <div className="queue-filter-tabs">
                <button
                  className={`q-tab ${statusFilter === "all" ? "active" : ""}`}
                  onClick={() => setStatusFilter("all")}
                >
                  All
                </button>
                <button
                  className={`q-tab ${statusFilter === "pending" ? "active" : ""}`}
                  onClick={() => setStatusFilter("pending")}
                >
                  Pending
                </button>
                <button
                  className={`q-tab ${statusFilter === "dispatched" ? "active" : ""}`}
                  onClick={() => setStatusFilter("dispatched")}
                >
                  Dispatched
                </button>
                <button
                  className={`q-tab ${statusFilter === "resolved" ? "active" : ""}`}
                  onClick={() => setStatusFilter("resolved")}
                >
                  Resolved
                </button>
              </div>

              {/* Search Input */}
              <div className="queue-search-input">
                <Icon name="search" size={15} />
                <input
                  type="text"
                  placeholder="Search incident, location, caller…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Priority Chips */}
              <div className="priority-chips-row">
                {["all", "P1", "P2", "P3"].map((p) => (
                  <button
                    key={p}
                    className={`p-chip ${priorityFilter === p ? "active" : ""} ${p !== "all" ? p.toLowerCase() : ""}`}
                    onClick={() => setPriorityFilter(p)}
                  >
                    {p === "all" ? "Any" : `${p} ${p === "P1" ? "Critical" : p === "P2" ? "Urgent" : "Standard"}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Cards List */}
            <div className="queue-cards-list">
              {filteredIncidents.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px 10px", color: "#7483a0" }}>
                  <Icon name="checkCircle" size={28} style={{ color: "#16a34a", marginBottom: 8 }} />
                  <p style={{ fontSize: 13 }}>No incidents matching filters.</p>
                </div>
              ) : (
                filteredIncidents.map((inc) => {
                  const isSelected = inc.id === selectedId;
                  return (
                    <article
                      key={inc.id}
                      className={`queue-incident-card ${isSelected ? "selected" : ""} ${inc.priority.toLowerCase()}`}
                      onClick={() => setSelectedId(inc.id)}
                    >
                      <div className="qcard-header">
                        <div className="qcard-id-grp">
                          <span className="qcard-id">{inc.id}</span>
                          <span className={`qcard-priority ${inc.priority.toLowerCase()}`}>
                            {inc.priority}
                          </span>
                        </div>
                        <span className="qcard-time">{getElapsed(inc.created_at)}</span>
                      </div>

                      <h3 className="qcard-location">
                        <Icon name="pin" size={13} style={{ color: "var(--red)" }} />
                        <span>{inc.location_name}</span>
                      </h3>

                      <p className="qcard-desc">{inc.description}</p>

                      <div className="qcard-footer">
                        <span className="qcard-reporter">
                          <Icon name="user" size={12} /> {inc.reporter_name}
                        </span>
                        <span className={`qcard-status-pill ${inc.status}`}>
                          {inc.status.replace("_", " ")}
                        </span>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ================= CENTER COLUMN: INCIDENT DOSSIER & AI TRIAGE ================= */}
        <div className="dept-col-card dossier-panel">
          {selectedIncident ? (
            <>
              {/* Incident Hero Surface */}
              <div className="surface dossier-hero">
                <div className="dossier-top-meta">
                  <div>
                    <div className="dossier-ids">
                      <span className="dossier-code">{selectedIncident.id}</span>
                      <span className={`qcard-priority ${selectedIncident.priority.toLowerCase()}`}>
                        {selectedIncident.priority} CRITICAL
                      </span>
                      <span className="dossier-cat-badge">{selectedIncident.category}</span>
                    </div>
                    <h1 className="dossier-location-title">{selectedIncident.location_name}</h1>
                  </div>

                  <span className={`dossier-status-badge ${selectedIncident.status}`}>
                    {selectedIncident.status.replace("_", " ")}
                  </span>
                </div>

                <div className="dossier-caller-row">
                  <div className="caller-cell">
                    <Icon name="user" size={15} style={{ color: "var(--blue)" }} />
                    <strong>{selectedIncident.reporter_name}</strong>
                  </div>
                  <div className="caller-cell">
                    <Icon name="phone" size={15} style={{ color: "var(--blue)" }} />
                    <span>{selectedIncident.reporter_phone}</span>
                    <a
                      href={`tel:${selectedIncident.reporter_phone}`}
                      className="caller-call-link"
                    >
                      Call Back
                    </a>
                  </div>
                  <div className="caller-cell" style={{ marginLeft: "auto" }}>
                    <Icon name="clock" size={14} />
                    <span>{new Date(selectedIncident.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>

              {/* Statement & Media Evidence */}
              <div className="surface dossier-box">
                <div className="dossier-sec-header">
                  <Icon name="file" size={18} style={{ color: "var(--blue)" }} />
                  <h3>Caller Incident Statement</h3>
                </div>

                <div className="dossier-quote-box">
                  "{selectedIncident.description}"
                </div>

                {selectedIncident.attachments?.length > 0 && (
                  <div className="dossier-media-row">
                    {selectedIncident.attachments.map((att, i) => (
                      <div key={i}>
                        {att.kind === "image" ? (
                          <div
                            className="media-photo-thumb"
                            onClick={() =>
                              setActiveMediaModal(
                                att.url || "https://images.unsplash.com/photo-1599058917212-d750089bc07e?auto=format&fit=crop&w=1200&q=80"
                              )
                            }
                          >
                            <img
                              src={
                                att.url ||
                                (i % 2 === 0
                                  ? "https://images.unsplash.com/photo-1599058917212-d750089bc07e?auto=format&fit=crop&w=600&q=80"
                                  : "https://images.unsplash.com/photo-1587745416684-47b88f3ce0b6?auto=format&fit=crop&w=600&q=80")
                              }
                              alt={att.name}
                            />
                            <div className="media-photo-overlay">
                              <Icon name="maximize" size={15} /> View Full
                            </div>
                          </div>
                        ) : (
                          <div className="media-voice-card">
                            <div className="voice-head">
                              <span className="voice-icon-circle">
                                <Icon name="mic" size={17} />
                              </span>
                              <div className="voice-titles">
                                <strong>Voice Note</strong>
                                <span>{att.name}</span>
                              </div>
                            </div>
                            <audio controls src={att.url} className="voice-audio-el" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Triage Card (Matches Teevra Assist) */}
              <section className="triage-card">
                <div className="triage-header-row">
                  <div className="triage-brand-tag">
                    <span className="triage-spark-avatar">
                      <Icon name="spark" size={20} />
                    </span>
                    <div>
                      <h3>Teevra AI Clinical Triage</h3>
                      <p style={{ fontSize: 12, color: "#7483a0", margin: 0 }}>
                        Automatic Severity & Resource Assessment
                      </p>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="triage-badge-pill">OPENROUTER TRIAGE</span>
                    <button
                      className="dept-btn-small"
                      onClick={handleReevaluateTriage}
                      disabled={triageLoading}
                      style={{ minHeight: 34, padding: "5px 12px", fontSize: 12 }}
                    >
                      <Icon name="refresh" size={14} className={triageLoading ? "spinning" : ""} />
                      <span>{triageLoading ? "Analyzing…" : "Re-evaluate"}</span>
                    </button>
                  </div>
                </div>

                {selectedIncident.triage && (
                  <div>
                    {/* Severity meter */}
                    <div className="triage-meter-banner">
                      <div className="triage-score-circle">
                        <span className={`triage-score-num ${selectedIncident.priority.toLowerCase()}`}>
                          {selectedIncident.triage.severity_score}
                        </span>
                        <span className="triage-score-sub">/ 100 SEVERITY</span>
                      </div>
                      <div className="triage-bar-slot">
                        <div
                          className={`triage-bar-fill ${selectedIncident.priority.toLowerCase()}`}
                          style={{ width: `${selectedIncident.triage.severity_score}%` }}
                        />
                      </div>
                      <div className="triage-service-rec">
                        <span>RECOMMENDED SERVICE:</span>
                        <strong>{selectedIncident.triage.recommended_service}</strong>
                      </div>
                    </div>

                    <p className="triage-summary-text">{selectedIncident.triage.summary}</p>

                    <div className="triage-cols-2">
                      <div className="triage-hazards-box">
                        <h4>
                          <Icon name="alertTriangle" size={15} style={{ color: "var(--red)" }} />
                          Scene Hazards & Risk Factors
                        </h4>
                        <ul>
                          {selectedIncident.triage.potential_hazards?.map((h, idx) => (
                            <li key={idx}>
                              <span className="dot-hazard" />
                              {h}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="triage-protocol-box">
                        <h4>
                          <Icon name="checkCircle" size={15} style={{ color: "var(--blue)" }} />
                          Dispatcher Protocol Checklist
                        </h4>
                        <div className="triage-protocol-list">
                          {selectedIncident.triage.recommended_actions?.map((act, idx) => (
                            <label key={idx} className="protocol-check-label">
                              <input type="checkbox" defaultChecked={idx === 0} />
                              <span>{act}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Tactical Response Map */}
              <div className="surface dossier-box">
                <div className="dossier-sec-header">
                  <Icon name="pin" size={18} style={{ color: "var(--blue)" }} />
                  <h3>Tactical GPS Scene Grid</h3>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#7483a0" }}>
                    Indiranagar, Sector 4
                  </span>
                </div>

                <TacticalMap
                  incident={selectedIncident}
                  responders={responders}
                  assignedResponder={responders.find(
                    (r) => r.id === selectedIncident?.dispatch?.unit_id
                  )}
                  height="260px"
                  interactive={true}
                />
              </div>

              {/* CAD Log */}
              <div className="surface dossier-box">
                <div className="dossier-sec-header">
                  <Icon name="clock" size={18} style={{ color: "var(--blue)" }} />
                  <h3>CAD Event & Radio Log</h3>
                </div>

                <div className="cad-timeline">
                  {selectedIncident.timeline?.map((ev, idx) => (
                    <div key={idx} className="cad-event-row">
                      <div className="cad-event-dot" />
                      <div className="cad-event-box">
                        <div className="cad-event-meta">
                          <strong className="cad-event-status">{ev.status}</strong>
                          <span className="cad-event-actor">· {ev.actor}</span>
                          <span className="cad-event-time">
                            {new Date(ev.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="cad-event-msg">{ev.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="surface" style={{ padding: 40, textAlign: "center", color: "#7483a0" }}>
              <Icon name="alertCircle" size={42} style={{ color: "var(--blue)", marginBottom: 12 }} />
              <h2>Select an emergency from the queue</h2>
            </div>
          )}
        </div>

        {/* ================= COLUMN 3: FLEET & DISPATCH ================= */}
        <div className="dept-col-card fleet-panel">
          {/* Lifecycle state manager */}
          {selectedIncident && (
            <div className="surface lifecycle-card">
              <h3>Incident Response Progression</h3>

              <div className="response-step-track">
                <div className={`step-node ${selectedIncident.status !== "pending_triage" ? "done" : "current"}`}>
                  <span className="step-node-bubble">1</span>
                  <small>Intake</small>
                </div>
                <div className={`step-node ${["dispatched", "en_route", "on_scene", "resolved"].includes(selectedIncident.status) ? "done" : ""}`}>
                  <span className="step-node-bubble">2</span>
                  <small>Dispatch</small>
                </div>
                <div className={`step-node ${["en_route", "on_scene", "resolved"].includes(selectedIncident.status) ? "done" : ""}`}>
                  <span className="step-node-bubble">3</span>
                  <small>En Route</small>
                </div>
                <div className={`step-node ${["on_scene", "resolved"].includes(selectedIncident.status) ? "done" : ""}`}>
                  <span className="step-node-bubble">4</span>
                  <small>On Scene</small>
                </div>
                <div className={`step-node ${selectedIncident.status === "resolved" ? "done" : ""}`}>
                  <span className="step-node-bubble">5</span>
                  <small>Resolved</small>
                </div>
              </div>

              {/* Status Update Quick Triggers */}
              <div className="lifecycle-actions-stack">
                {selectedIncident.status === "dispatched" && (
                  <button
                    className="action-trans-btn enroute"
                    onClick={() => handleStatusTransition("en_route")}
                  >
                    <Icon name="arrow" size={17} /> Mark Unit En Route
                  </button>
                )}
                {selectedIncident.status === "en_route" && (
                  <button
                    className="action-trans-btn onscene"
                    onClick={() => handleStatusTransition("on_scene")}
                  >
                    <Icon name="pin" size={17} /> Confirm Arrival On Scene
                  </button>
                )}
                {selectedIncident.status === "on_scene" && (
                  <button
                    className="action-trans-btn resolve"
                    onClick={() => handleStatusTransition("resolved")}
                  >
                    <Icon name="checkCircle" size={17} /> Mark Incident Resolved
                  </button>
                )}
                {selectedIncident.status === "resolved" && (
                  <div className="resolved-pill-banner">
                    <Icon name="checkCircle" size={18} />
                    <span>Incident closed & archived.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Available Units Selection */}
          <div className="surface lifecycle-card">
            <div className="fleet-sec-header">
              <h2>Available Fleet</h2>
              <span className="fleet-ready-pill">
                <span className="status-dot" style={{ background: "#16a34a" }} />
                {responders.filter((r) => r.status === "Available").length} Ready
              </span>
            </div>

            <div className="fleet-cards-list">
              {responders.map((unit) => {
                const isSelected = dispatchingUnit === unit.id;
                const isAssigned = selectedIncident?.dispatch?.unit_id === unit.id;
                const isAvailable = unit.status === "Available";

                return (
                  <div
                    key={unit.id}
                    className={`fleet-unit-card ${isSelected ? "selected" : ""} ${isAssigned ? "assigned" : ""}`}
                    onClick={() => isAvailable && setDispatchingUnit(unit.id)}
                  >
                    <div className="funit-top">
                      <div className="funit-title">
                        <strong>{unit.name}</strong>
                        <span>{unit.type}</span>
                      </div>
                      <span className={`funit-status ${unit.status.toLowerCase().replace(" ", "-")}`}>
                        {isAssigned ? "ASSIGNED HERE" : unit.status}
                      </span>
                    </div>

                    <div className="funit-specs">
                      <div className="funit-spec-cell">
                        <Icon name="clock" size={12} style={{ color: "var(--blue)" }} />
                        <span>ETA: {unit.eta_minutes} min</span>
                      </div>
                      <div className="funit-spec-cell">
                        <Icon name="locate" size={12} />
                        <span>{unit.distance_km} km</span>
                      </div>
                    </div>

                    <p className="funit-crew-info">
                      <Icon name="user" size={12} /> {unit.crew.join(" · ")}
                    </p>

                    {/* Dispatch Form Drawer when clicked */}
                    {isSelected && (
                      <div className="funit-dispatch-drawer" onClick={(e) => e.stopPropagation()}>
                        <div className="eta-picker-row">
                          <label>Confirmed ETA (min):</label>
                          <input
                            type="number"
                            min="1"
                            max="30"
                            value={customEta}
                            onChange={(e) => setCustomEta(Number(e.target.value))}
                          />
                        </div>
                        <input
                          type="text"
                          placeholder="Operator priority radio instructions…"
                          value={operatorNotes}
                          onChange={(e) => setOperatorNotes(e.target.value)}
                          className="op-notes-input"
                        />
                        <button
                          className="approve-dispatch-btn"
                          onClick={() => handleApproveDispatch(unit.id)}
                        >
                          <Icon name="send" size={15} />
                          <span>APPROVE & DISPATCH {unit.id}</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* ================= MODAL: PHOTO FULL VIEW ================= */}
      {activeMediaModal && (
        <div className="modal-backdrop-clean" onClick={() => setActiveMediaModal(null)}>
          <div className="modal-dialog-clean photo-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-icon" onClick={() => setActiveMediaModal(null)}>
              <Icon name="cross" size={20} />
            </button>
            <img src={activeMediaModal} alt="Incident Evidence" />
          </div>
        </div>
      )}

      {/* ================= MODAL: 911 PHONE INTAKE ================= */}
      {manualModalOpen && (
        <div className="modal-backdrop-clean" onClick={() => setManualModalOpen(false)}>
          <div className="modal-dialog-clean" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top-bar">
              <h2>
                <Icon name="phone" size={20} style={{ color: "var(--red)" }} />
                Emergency Phone Intake
              </h2>
              <button className="modal-close-icon" onClick={() => setManualModalOpen(false)}>
                <Icon name="cross" size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateManual} className="clean-call-form">
              <div className="form-grid-2">
                <div>
                  <label>Caller Name</label>
                  <input
                    type="text"
                    required
                    value={manualForm.reporter_name}
                    onChange={(e) => setManualForm({ ...manualForm, reporter_name: e.target.value })}
                  />
                </div>
                <div>
                  <label>Caller Phone</label>
                  <input
                    type="tel"
                    required
                    value={manualForm.reporter_phone}
                    onChange={(e) => setManualForm({ ...manualForm, reporter_phone: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label>Incident Location</label>
                <input
                  type="text"
                  required
                  value={manualForm.location_name}
                  onChange={(e) => setManualForm({ ...manualForm, location_name: e.target.value })}
                />
              </div>

              <div>
                <label>Emergency Description</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Detail chief complaint, consciousness, injuries, hazards..."
                  value={manualForm.description}
                  onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
                />
              </div>

              <div className="modal-footer-btns">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setManualModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button red-button" style={{ minHeight: 46 }}>
                  Log & Run AI Triage
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
