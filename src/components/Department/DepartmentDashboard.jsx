import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../Icon";
import TacticalMap from "./TacticalMap";
import FleetLocationControl from "./FleetLocationControl";
import { api, post, mediaUrl, statusLabel } from "../../lib/api";
import "./Department.css";

const priorityLabel = { P1: "Critical", P2: "Urgent", P3: "Standard" };
const isClosed = (i) => ["resolved", "cancelled"].includes(i.status);
function elapsed(time, now) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(time)) / 60000));
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes} min ago`
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}
function Media({ attachments }) {
  if (!attachments?.length) return null;
  return (
    <div className="dispatch-media">
      {attachments.map((a, index) => (
        <div key={a.id || index}>
          {a.url ? (
            a.kind === "image" ? (
              <a href={mediaUrl(a.url)} target="_blank" rel="noreferrer">
                <img src={mediaUrl(a.url)} alt={a.name} loading="lazy" />
              </a>
            ) : (
              <audio controls src={mediaUrl(a.url)} preload="none" />
            )
          ) : (
            <p>
              <Icon name={a.kind === "image" ? "image" : "mic"} size={18} />
              {a.name} · Media unavailable
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function DepartmentDashboard() {
  const [liveMap, setLiveMap] = useState(null);
  const [data, setData] = useState({
    incidents: [],
    responders: [],
    stats: null,
  });
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("active");
  const [priority, setPriority] = useState("all");
  const [search, setSearch] = useState("");
  const [recommendation, setRecommendation] = useState(null);
  const [recommendationError, setRecommendationError] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [unitId, setUnitId] = useState("");
  const [eta, setEta] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now);
  const [lastSync, setLastSync] = useState(null);
  const alive = useRef(true);
  const requestSequence = useRef(0);
  const selection = useRef(null);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const [incidents, responders, stats] = await Promise.all([
        api("/api/incidents"),
        api("/api/responders"),
        api("/api/department/stats"),
      ]);
      if (!alive.current || sequence !== requestSequence.current) return;
      setData({ incidents, responders, stats });
      setLastSync(Date.now());
      setError("");
    } catch (failure) {
      if (alive.current) setError(failure.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    const initial = setTimeout(refresh, 0);
    const poll = setInterval(refresh, 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearTimeout(initial);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  const filtered = data.incidents.filter((i) => {
    if (filter === "active" && isClosed(i)) return false;
    if (
      filter === "waiting" &&
      !["pending_triage", "triage_complete"].includes(i.status)
    )
      return false;
    if (
      filter === "assigned" &&
      !["dispatched", "en_route", "on_scene"].includes(i.status)
    )
      return false;
    if (filter === "closed" && !isClosed(i)) return false;
    if (priority !== "all" && i.priority !== priority) return false;
    return `${i.id} ${i.location_name} ${i.reporter_name} ${i.description} ${i.updates?.map((u) => u.description).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase().trim());
  });
  const incident = filtered.find((i) => i.id === selectedId) || filtered[0];
  const activeId = incident?.id;
  useEffect(() => {
    selection.current = activeId;
  }, [activeId]);
  const revision = incident?.revision;
  const assessed = incident?.triage?.assessed_at;
  const fleetSignature = JSON.stringify(data.responders);
  useEffect(() => {
    if (!activeId) return;
    let ignore = false;
    async function loadRecommendations() {
      try {
        const result = await api(`/api/incidents/${activeId}/recommendations`);
        if (!ignore) {
          setRecommendation(result);
          setRecommendationError("");
        }
      } catch (failure) {
        if (!ignore) setRecommendationError(failure.message);
      }
    }
    loadRecommendations();
    return () => {
      ignore = true;
    };
  }, [activeId, revision, assessed, fleetSignature]);

  function selectIncident(id) {
    setSelectedId(id);
    setAssigning(false);
    setUnitId("");
    setEta("");
    setNotes("");
  }
  const departments =
    recommendation &&
    recommendation.incident_id === activeId &&
    recommendation.revision === revision
      ? recommendation.departments
      : [];
  const units = departments.flatMap((d) => d.units);
  const selectedUnit = units.find((u) => u.id === unitId);
  const dispatches =
    incident?.dispatches || (incident?.dispatch ? [incident.dispatch] : []);
  const assigned = data.responders.filter(
    (u) => u.assigned_incident_id === activeId,
  );
  async function action(path, body, method = "POST") {
    if (busy) return;
    const target = activeId;
    setBusy(true);
    setError("");
    try {
      await post(`/api/incidents/${target}/${path}`, body, method);
      if (selection.current === target) {
        setUnitId("");
        setAssigning(false);
        setEta("");
        setNotes("");
      }
      await refresh();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  const next = {
    dispatched: ["en_route", "Mark en route"],
    en_route: ["on_scene", "Mark on scene"],
    on_scene: ["resolved", "Resolve incident"],
  }[incident?.status];

  return (
    <div className="dispatch-app">
      <header className="dispatch-header">
        <div className="dispatch-brand">
          <img src="/TeevraLogo.png" alt="" />
          <strong>
            Teevra<span>.</span>
          </strong>
          <span className="dispatch-divider" />
          <span>Response workspace</span>
        </div>
        <div className={`sync-label ${error ? "offline" : ""}`}>
          <span />
          {error
            ? "Connection needs attention"
            : lastSync
              ? "Connected · refreshes every 3s"
              : "Connecting…"}
        </div>
      </header>
      <main className="dispatch-main">
        <div className="dispatch-heading">
          <div>
            <p className="eyebrow">EMERGENCY OPERATIONS</p>
            <h1>
              Every moment counts<span>.</span>
            </h1>
            <p>A clear view of what needs your attention.</p>
          </div>
          <span className="dispatch-date">
            {new Date(now).toLocaleDateString(undefined, {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
        </div>
        <section className="dispatch-stats" aria-label="Response overview">
          {[
            {
              label: "Critical incidents",
              value: data.stats?.p1_critical_count,
              style: "critical",
              icon: "siren",
            },
            {
              label: "Active reports",
              value: data.stats?.active_incidents,
              icon: "file",
            },
            {
              label: "Available fleet",
              value: data.stats
                ? `${data.stats.available_units} / ${data.stats.total_units}`
                : null,
              style: "ready",
              icon: "ambulance",
            },
          ].map((s) => (
            <div className={`dispatch-stat ${s.style || ""}`} key={s.label}>
              <span className="stat-icon">
                <Icon name={s.icon} size={23} />
              </span>
              <div>
                <p>{s.label}</p>
                <strong>{s.value ?? "—"}</strong>
              </div>
            </div>
          ))}
        </section>
        {error && (
          <div className="dispatch-error" role="alert">
            {error}
            <button onClick={refresh}>Retry</button>
          </div>
        )}
        <FleetLocationControl units={data.responders} />
        <div className="dispatch-workspace">
          <aside
            className="dispatch-queue dispatch-surface"
            aria-label="Emergency queue"
          >
            <div className="queue-heading">
              <h2>Emergency queue</h2>
              <span>{filtered.length}</span>
            </div>
            <p className="queue-order">
              <Icon name="clock" size={14} />
              Priority, severity & time waiting
            </p>
            <div className="dispatch-tabs" aria-label="Queue status">
              {[
                ["active", "Active"],
                ["waiting", "Waiting"],
                ["assigned", "Assigned"],
                ["closed", "Closed"],
              ].map(([id, title]) => (
                <button
                  key={id}
                  onClick={() => {
                    setFilter(id);
                    setAssigning(false);
                    setUnitId("");
                  }}
                  aria-pressed={filter === id}
                >
                  {title}
                </button>
              ))}
            </div>
            <label className="dispatch-search">
              <Icon name="search" size={17} />
              <input
                aria-label="Search reports"
                placeholder="Search report, caller, location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="dispatch-priorities" aria-label="Priority">
              {["all", "P1", "P2", "P3"].map((p) => (
                <button
                  key={p}
                  aria-pressed={priority === p}
                  onClick={() => setPriority(p)}
                >
                  {p === "all" ? "All priorities" : priorityLabel[p]}
                </button>
              ))}
            </div>
            <div className="dispatch-queue-list">
              {loading ? (
                <p className="dispatch-empty">Loading reports…</p>
              ) : filtered.length ? (
                filtered.map((i) => (
                  <button
                    key={i.id}
                    className={`dispatch-queue-item ${i.priority.toLowerCase()} ${activeId === i.id ? "selected" : ""}`}
                    onClick={() => selectIncident(i.id)}
                    aria-pressed={activeId === i.id}
                  >
                    <div className="queue-item-top">
                      <strong>{i.id}</strong>
                      <span
                        className={`priority-label ${i.priority.toLowerCase()}`}
                      >
                        {priorityLabel[i.priority]}
                      </span>
                      <small>{elapsed(i.created_at, now)}</small>
                    </div>
                    <h3>{i.location_name}</h3>
                    <p>{i.updates?.at(-1)?.description || i.description}</p>
                    <div className="queue-item-bottom">
                      <span>{i.reporter_name}</span>
                      <span>
                        {i.updates?.length
                          ? `${i.updates.length} update${i.updates.length === 1 ? "" : "s"} · `
                          : ""}
                        {statusLabel(i.status)}
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <p className="dispatch-empty">
                  No reports match these filters.
                </p>
              )}
            </div>
          </aside>
          <section className="dispatch-detail" aria-label="Selected incident">
            {!incident ? (
              <div className="dispatch-surface dispatch-empty">
                <Icon name="check" size={32} />
                <h2>
                  {loading
                    ? "Getting your workspace ready"
                    : "You’re all caught up"}
                </h2>
                <p>Select another filter to see more reports.</p>
              </div>
            ) : (
              <>
                <section className="dispatch-surface incident-overview">
                  <div className="incident-overline">
                    <span>{incident.id}</span>
                    <span
                      className={`priority-label ${incident.priority.toLowerCase()}`}
                    >
                      {incident.priority} · {priorityLabel[incident.priority]}
                    </span>
                    <span>{incident.category}</span>
                    <span className={`incident-status ${incident.status}`}>
                      {statusLabel(incident.status)}
                    </span>
                  </div>
                  <h2>{incident.location_name}</h2>
                  <div className="incident-contact">
                    <span>
                      <Icon name="user" size={16} />
                      {incident.reporter_name}
                    </span>
                    <a
                      href={`tel:${incident.reporter_phone.replace(/[^+\d]/g, "")}`}
                    >
                      <Icon name="phone" size={16} />
                      {incident.reporter_phone}
                      <span>Call back</span>
                    </a>
                    <span>
                      <Icon name="clock" size={16} />
                      Reported {elapsed(incident.created_at, now)}
                    </span>
                  </div>
                  <div className="incident-action-row">
                    <p>
                      {dispatches.length
                        ? `${dispatches.length} fleet assigned`
                        : "Awaiting fleet assignment"}
                    </p>
                    <div>
                      {!isClosed(incident) && (
                        <button
                          className="dispatch-primary"
                          onClick={() => {
                            setAssigning((v) =>
                              v === activeId ? null : activeId,
                            );
                            setUnitId("");
                          }}
                          aria-expanded={assigning === activeId}
                        >
                          <Icon name="ambulance" size={17} />
                          {assigning === activeId
                            ? "Close assignment"
                            : dispatches.length
                              ? "Assign additional fleet"
                              : "Assign fleet"}
                        </button>
                      )}
                      {next && (
                        <button
                          disabled={busy}
                          className={`dispatch-secondary ${next[0] === "resolved" ? "resolve" : ""}`}
                          onClick={() =>
                            action("status", { status: next[0] }, "PATCH")
                          }
                        >
                          {next[1]}
                          <Icon name="check" size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  {!!dispatches.length && (
                    <div className="assigned-fleets">
                      {dispatches.map((d) => (
                        <span key={d.unit_id}>
                          <Icon name="shield" size={14} />
                          {d.unit_name} ·{" "}
                          {liveMap?.incident_id === activeId &&
                          liveMap.routes.find((r) => r.unit_id === d.unit_id)
                            ? `${liveMap.routes.find((r) => r.unit_id === d.unit_id).eta_minutes} min by road`
                            : `${d.eta_minutes} min assigned ETA`}
                        </span>
                      ))}
                    </div>
                  )}
                </section>
                {assigning === activeId && !isClosed(incident) && (
                  <section className="dispatch-surface fleet-assignment">
                    <div className="dispatch-section-heading">
                      <div>
                        <p className="eyebrow">SUGGESTED DEPARTMENTS</p>
                        <h2>Choose the right response</h2>
                      </div>
                      <span>Nearest available first</span>
                    </div>
                    <p className="assignment-note">
                      Road ETAs exclude live traffic. Approximate estimates are
                      labelled when routing is unavailable. Demo fleet positions
                      are labelled.
                    </p>
                    {recommendationError ? (
                      <p className="dispatch-error" role="alert">
                        {recommendationError}
                      </p>
                    ) : !departments.length ? (
                      <p>Loading available fleet…</p>
                    ) : (
                      departments.map((dept) => (
                        <div className="department-group" key={dept.department}>
                          <div className="department-title">
                            <h3>{dept.department}</h3>
                            <span>
                              {dept.available_count} available
                              {dept.eta_minutes != null
                                ? ` · from ${dept.eta_minutes} min`
                                : ""}
                            </span>
                          </div>
                          {dept.units.length ? (
                            dept.units.map((u) => (
                              <button
                                key={u.id}
                                className={`fleet-option ${unitId === u.id ? "selected" : ""}`}
                                onClick={() => {
                                  setUnitId(u.id);
                                  setEta(u.eta_minutes ?? "");
                                }}
                                aria-pressed={unitId === u.id}
                              >
                                <Icon
                                  name={
                                    u.department === "Medical"
                                      ? "ambulance"
                                      : "shield"
                                  }
                                  size={22}
                                />
                                <div>
                                  <strong>{u.name}</strong>
                                  <span>
                                    {u.current_location}
                                    {u.location_source === "demo"
                                      ? " · Demo location"
                                      : ` · Updated ${elapsed(u.location_updated_at, now)}`}
                                  </span>
                                  <small>{u.crew.join(" · ")}</small>
                                </div>
                                <span className="fleet-eta">
                                  <strong>
                                    {u.eta_minutes != null
                                      ? `${u.eta_minutes} min`
                                      : "ETA unknown"}
                                  </strong>
                                  <small>
                                    {u.distance_km != null
                                      ? `${u.eta_basis === "road_route" ? "Road" : "Approx."} ${u.distance_km} km`
                                      : "Confirm ETA"}
                                  </small>
                                </span>
                              </button>
                            ))
                          ) : (
                            <p className="fleet-unavailable">
                              No available fleet in this department. Coordinate
                              additional support.
                            </p>
                          )}
                        </div>
                      ))
                    )}
                    {selectedUnit && (
                      <form
                        className="assignment-confirm"
                        onSubmit={(e) => {
                          e.preventDefault();
                          action("dispatch", {
                            unit_id: selectedUnit.id,
                            eta_minutes: Number(eta),
                            operator_notes: notes.trim() || null,
                          });
                        }}
                      >
                        <label>
                          Confirmed ETA (minutes)
                          <input
                            type="number"
                            min="1"
                            max="1440"
                            required
                            value={eta}
                            onChange={(e) => setEta(e.target.value)}
                          />
                        </label>
                        <label>
                          Assignment note (optional)
                          <input
                            value={notes}
                            maxLength={500}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Details for the response team"
                          />
                        </label>
                        <button
                          disabled={busy}
                          className="dispatch-primary red"
                        >
                          <Icon name="send" size={17} />
                          {busy ? "Assigning…" : `Assign ${selectedUnit.name}`}
                        </button>
                      </form>
                    )}
                  </section>
                )}
                {incident.triage && (
                  <section className="dispatch-surface assessment-card">
                    <div className="dispatch-section-heading">
                      <div className="assessment-title">
                        <span className="assessment-icon">
                          <Icon name="spark" size={23} />
                        </span>
                        <div>
                          <h2>
                            {incident.assessment_pending
                              ? "Reassessing latest update…"
                              : "Response assessment"}
                          </h2>
                          <p>
                            {incident.triage.source === "rules"
                              ? "Rules fallback · operator review required"
                              : incident.triage.source === "legacy"
                                ? "Imported assessment · verify details"
                                : "AI assessment"}{" "}
                            · {elapsed(incident.triage.assessed_at, now)}
                          </p>
                        </div>
                      </div>
                      <button
                        className="dispatch-secondary"
                        disabled={busy}
                        onClick={() => action("triage")}
                      >
                        <Icon name="refresh" size={15} />
                        {busy ? "Working…" : "Reassess"}
                      </button>
                    </div>
                    <div className="assessment-summary">
                      <div
                        className={`severity-score ${incident.priority.toLowerCase()}`}
                      >
                        <strong>
                          {incident.triage.severity_score}
                          <small>/100</small>
                        </strong>
                        <span>Severity</span>
                      </div>
                      <div>
                        <p>{incident.triage.summary}</p>
                        <strong className="recommended-service">
                          {incident.triage.recommended_service}
                        </strong>
                      </div>
                    </div>
                    {incident.triage.review_required && (
                      <p className="assessment-review">
                        Review required. Confirm the assessment and attached
                        evidence before dispatch.
                      </p>
                    )}
                    {!!incident.triage.potential_hazards?.length && (
                      <div className="hazard-tags">
                        {incident.triage.potential_hazards.map((h) => (
                          <span key={h}>{h}</span>
                        ))}
                      </div>
                    )}
                  </section>
                )}
                <section className="dispatch-surface incident-statement">
                  <div className="dispatch-section-heading">
                    <h2>Reported situation</h2>
                    <span>{incident.updates?.length || 0} updates</span>
                  </div>
                  <p className="incident-description">{incident.description}</p>
                  <Media
                    attachments={incident.attachments?.filter(
                      (a) =>
                        !incident.updates?.some((u) =>
                          u.attachments.some((f) => f.id === a.id),
                        ),
                    )}
                  />
                  {[...(incident.updates || [])].reverse().map((u, index) => (
                    <div className="situation-update" key={index}>
                      <p className="eyebrow">
                        REPORTER UPDATE ·{" "}
                        {new Date(u.timestamp).toLocaleTimeString()}
                      </p>
                      <p>{u.description || "New media attached"}</p>
                      <Media attachments={u.attachments} />
                    </div>
                  ))}
                </section>
                <section className="dispatch-surface incident-location">
                  <div className="dispatch-section-heading">
                    <h2>Incident location</h2>
                    <span>
                      {incident.location_accuracy_m
                        ? `GPS accuracy ±${Math.round(incident.location_accuracy_m)} m`
                        : "Reported location"}
                    </span>
                  </div>
                  <TacticalMap
                    onMapUpdate={setLiveMap}
                    incident={incident}
                    responders={
                      selectedUnit && assigning === activeId
                        ? [...assigned, selectedUnit]
                        : assigned
                    }
                  />
                </section>
              </>
            )}
          </section>
        </div>
        <p className="dispatch-footnote">
          Teevra prototype · Fleet locations are demo data until connected to
          telemetry. No emergency service is contacted.
        </p>
      </main>
    </div>
  );
}
