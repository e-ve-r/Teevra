import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./components/Icon";
import Assistant from "./components/Assistant";
import TacticalMap from "./components/Department/TacticalMap";
import { api, post, statusLabel } from "./lib/api";
import { archiveChatHistory } from "./lib/chatHistory";
import "./App.css";

const closed = (report) => ["resolved", "cancelled"].includes(report?.status);
const readLocal = (key, fallback = "") =>
  localStorage.getItem(key) || sessionStorage.getItem(key) || fallback;
function historyIds() {
  try {
    const ids = JSON.parse(localStorage.getItem("teevra.history") || "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [page, setPage] = useState("chat");
  const [profileTab, setProfileTab] = useState("details");
  const [reporterName, setReporterName] = useState(() =>
    readLocal("teevra.name"),
  );
  const [reporterPhone, setReporterPhone] = useState(() =>
    readLocal("teevra.phone"),
  );
  const [incidentId, setIncidentId] = useState(() =>
    readLocal("teevra.incident"),
  );
  const [history, setHistory] = useState(historyIds);
  const [report, setReport] = useState(null);
  const [liveMap, setLiveMap] = useState(null);
  const [historyReports, setHistoryReports] = useState([]);
  const [viewedReport, setViewedReport] = useState(null);
  const [viewedMap, setViewedMap] = useState(null);
  const [error, setError] = useState("");
  const [reportNotFound, setReportNotFound] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [updateText, setUpdateText] = useState("");
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateNotice, setUpdateNotice] = useState("");
  const [conversationKey, setConversationKey] = useState(0);
  const submitBusy = useRef(false);
  const activeReport = report && !closed(report);
  const viewedId = viewedReport?.id;
  const onTrackingMapUpdate = useCallback(
    (map) => {
      if (viewedId) setViewedMap(map);
      else setLiveMap(map);
    },
    [viewedId],
  );
  const initials = reporterName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => name[0])
    .join("")
    .toUpperCase();

  useEffect(() => {
    if (!incidentId || (page === "tracking" && viewedId)) return;
    let cancelled = false;
    let timer;
    let inFlight = false;
    async function refresh() {
      if (cancelled || document.hidden || inFlight) return;
      inFlight = true;
      try {
        const updated = await api(
          `/api/incidents/${encodeURIComponent(incidentId)}`,
        );
        if (!cancelled) {
          setReport((current) =>
            current &&
            current.id === updated.id &&
            current.revision > updated.revision
              ? current
              : updated,
          );
          setReportNotFound(false);
          setError("");
        }
      } catch (failure) {
        if (!cancelled) {
          setError(failure.message);
          setLiveMap(null);
          if (failure.status === 404) {
            setReport(null);
            setReportNotFound(true);
          }
        }
      } finally {
        inFlight = false;
        if (!cancelled && !document.hidden) timer = setTimeout(refresh, 10000);
      }
    }
    function visibilityChanged() {
      clearTimeout(timer);
      if (!document.hidden) refresh();
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [incidentId, page, viewedId]);

  useEffect(() => {
    if (page !== "tracking" || !viewedId) return;
    let cancelled = false;
    let timer;
    let inFlight = false;
    async function refresh() {
      if (cancelled || document.hidden || inFlight) return;
      inFlight = true;
      try {
        const updated = await api(
          `/api/incidents/${encodeURIComponent(viewedId)}`,
        );
        if (!cancelled) {
          setViewedReport(updated);
          setError("");
        }
      } catch (failure) {
        if (!cancelled) {
          setError(failure.message);
          setViewedMap(null);
        }
      } finally {
        inFlight = false;
        if (!cancelled && !document.hidden) timer = setTimeout(refresh, 10000);
      }
    }
    function visibilityChanged() {
      clearTimeout(timer);
      if (!document.hidden) refresh();
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [page, viewedId]);

  useEffect(() => {
    if (page !== "profile" || profileTab !== "reports") return;
    let cancelled = false;
    const ids = [...new Set([incidentId, ...history].filter(Boolean))];
    Promise.all(
      ids.map((id) =>
        api(`/api/incidents/${encodeURIComponent(id)}`).catch(() => null),
      ),
    ).then((items) => {
      if (!cancelled) setHistoryReports(items.filter(Boolean));
    });
    return () => {
      cancelled = true;
    };
  }, [page, profileTab, history, incidentId]);

  async function submitReport(data) {
    if (submitBusy.current)
      throw new Error("A report is already being submitted.");
    if (incidentId && !report)
      throw new Error("Your report is still loading. Please try again.");
    if (activeReport)
      throw new Error(
        "You already have an active report. Use tracking to follow it.",
      );
    submitBusy.current = true;
    try {
      const created = await post("/api/incidents", data);
      const nextHistory = [
        ...new Set([created.id, incidentId, ...history].filter(Boolean)),
      ];
      setHistory(nextHistory);
      setReporterName(data.reporter_name);
      setReporterPhone(data.reporter_phone);
      setIncidentId(created.id);
      setReport(created);
      setViewedReport(null);
      try {
        localStorage.setItem("teevra.incident", created.id);
        localStorage.setItem("teevra.history", JSON.stringify(nextHistory));
        localStorage.setItem("teevra.name", data.reporter_name);
        localStorage.setItem("teevra.phone", data.reporter_phone);
      } catch {
        setProfileNotice(
          "Report sent, but this browser could not save its details for a later visit.",
        );
      }
      return created;
    } finally {
      submitBusy.current = false;
    }
  }

  function openTracking(item = null) {
    setViewedMap(null);
    setLiveMap(null);
    setUpdateOpen(false);
    setUpdateNotice("");
    setError("");
    setViewedReport(item && item.id !== incidentId ? item : null);
    setPage("tracking");
  }
  const selected = viewedReport || report;
  const candidateMap = viewedReport ? viewedMap : liveMap;
  const selectedMap =
    candidateMap?.incident_id === selected?.id ? candidateMap : null;
  const dispatches =
    selected?.dispatches || (selected?.dispatch ? [selected.dispatch] : []);

  return (
    <div className="app-shell reporter-shell">
      <header className="reporter-header">
        {page === "chat" ? (
          <span aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="reporter-back"
            onClick={() => setPage("chat")}
          >
            <Icon name="arrowLeft" size={20} /> Chat
          </button>
        )}
        <img className="reporter-logo" src="/TeevraLogo.png" alt="Teevra" />
        <button
          type="button"
          className="reporter-profile-button"
          onClick={() => setPage("profile")}
          aria-label="Open profile and reports"
        >
          <span className="reporter-profile-avatar">
            {initials || <Icon name="user" size={22} />}
          </span>
        </button>
      </header>
      <main className={`reporter-main reporter-page-${page}`}>
        <section className="reporter-chat" hidden={page !== "chat"}>
          <Assistant
            key={conversationKey}
            active={page === "chat"}
            report={report}
            incidentId={incidentId}
            reporterName={reporterName}
            reporterPhone={reporterPhone}
            onSubmitReport={submitReport}
            onReportUpdated={(updated) => setReport((current) =>
              current && current.id === updated.id && current.revision > updated.revision ? current : updated,
            )}
            onTrack={() => openTracking()}
          />
        </section>
        {page === "tracking" && (
          <section className="reporter-detail-page">
            <h1>Live tracking</h1>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {!selected ? (
              <>
                <p>
                  {reportNotFound
                    ? "This report is not available on the current server."
                    : incidentId
                      ? "Loading report…"
                      : "No report yet."}
                </p>
                {reportNotFound && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      if (!archiveChatHistory(localStorage)) {
                        setError(
                          "Could not save the previous chat on this device.",
                        );
                        return;
                      }
                      const nextHistory = [
                        ...new Set([incidentId, ...history].filter(Boolean)),
                      ];
                      localStorage.removeItem("teevra.incident");
                      sessionStorage.removeItem("teevra.incident");
                      localStorage.setItem(
                        "teevra.history",
                        JSON.stringify(nextHistory),
                      );
                      setHistory(nextHistory);
                      setIncidentId("");
                      setReportNotFound(false);
                      setError("");
                      setConversationKey((n) => n + 1);
                      setPage("chat");
                    }}
                  >
                    Start a new report
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="tracking-card surface">
                  <div className="report-response-heading">
                    <div>
                      <p className="eyebrow">{selected.id}</p>
                      <h2>{statusLabel(selected.status)}</h2>
                    </div>
                  </div>
                  <div className="response-assignment-list">
                    {dispatches.length ? (
                      dispatches.map((unit) => {
                        const route = selectedMap?.routes?.find(
                          (item) => item.unit_id === unit.unit_id,
                        );
                        return (
                          <div key={unit.unit_id}>
                            <Icon name="shield" size={21} />
                            <div>
                              <strong>{unit.unit_name}</strong>
                              <p>
                                {closed(selected)
                                  ? "Response completed"
                                  : selected.status === "on_scene"
                                    ? "At the incident"
                                    : route
                                      ? `Road estimate: ${route.eta_minutes} min · ${route.distance_km} km`
                                      : `ETA at assignment: ${unit.eta_minutes} min`}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p>No unit has been assigned yet.</p>
                    )}
                  </div>
                  {selected.lat != null && selected.lng != null && (
                    <TacticalMap
                      incident={selected}
                      height="280px"
                      onMapUpdate={onTrackingMapUpdate}
                    />
                  )}
                  <div className="destination">
                    <span className="destination-pin">
                      <Icon name="pin" size={20} />
                    </span>
                    <div>
                      <span>INCIDENT LOCATION</span>
                      <strong>{selected.location_name}</strong>
                    </div>
                  </div>
                </div>
                <p className="reporter-tracking-note">
                  Prototype: reports reach the response workspace, not emergency
                  services. Demo locations are labelled; road estimates exclude
                  live traffic.
                </p>
                {!closed(selected) && (
                  <div className="reporter-update">
                    {!updateOpen ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setUpdateOpen(true)}
                      >
                        Share an update
                      </button>
                    ) : (
                      <form
                        onSubmit={async (event) => {
                          event.preventDefault();
                          if (!updateText.trim() || updateBusy) return;
                          setUpdateBusy(true);
                          setUpdateNotice("");
                          try {
                            const updated = await post(
                              `/api/incidents/${encodeURIComponent(selected.id)}/updates`,
                              {
                                description: updateText.trim(),
                                attachments: [],
                              },
                            );
                            if (viewedReport) setViewedReport(updated);
                            else setReport(updated);
                            setUpdateText("");
                            setUpdateOpen(false);
                            setUpdateNotice("Update sent.");
                          } catch (failure) {
                            setUpdateNotice(failure.message);
                          } finally {
                            setUpdateBusy(false);
                          }
                        }}
                      >
                        <label htmlFor="tracking-update">
                          What has changed?
                        </label>
                        <textarea
                          id="tracking-update"
                          value={updateText}
                          onChange={(event) =>
                            setUpdateText(event.target.value)
                          }
                          maxLength={2000}
                          required
                          rows={3}
                        />
                        <div>
                          <button
                            className="primary-button blue-button"
                            disabled={updateBusy}
                          >
                            {updateBusy ? "Sending…" : "Send update"}
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={updateBusy}
                            onClick={() => setUpdateOpen(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                    {updateNotice && <p role="status">{updateNotice}</p>}
                  </div>
                )}
              </>
            )}
          </section>
        )}
        {page === "profile" && (
          <section className="reporter-detail-page">
            <h1>Profile</h1>
            <div
              className="reporter-tabs"
              role="tablist"
              aria-label="Profile sections"
            >
              <button
                type="button"
                role="tab"
                aria-selected={profileTab === "details"}
                onClick={() => setProfileTab("details")}
              >
                Your details
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={profileTab === "reports"}
                onClick={() => setProfileTab("reports")}
              >
                Your reports
              </button>
            </div>
            {profileTab === "details" ? (
              <form
                className="reporter-details-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  localStorage.setItem("teevra.name", reporterName.trim());
                  localStorage.setItem("teevra.phone", reporterPhone.trim());
                  setProfileNotice("Saved on this device.");
                }}
              >
                <label htmlFor="profile-name">Name</label>
                <input
                  id="profile-name"
                  value={reporterName}
                  onChange={(event) => setReporterName(event.target.value)}
                  maxLength={80}
                  autoComplete="name"
                />
                <label htmlFor="profile-phone">Phone number</label>
                <input
                  id="profile-phone"
                  type="tel"
                  value={reporterPhone}
                  onChange={(event) => setReporterPhone(event.target.value)}
                  maxLength={22}
                  autoComplete="tel"
                />
                <button className="primary-button blue-button">
                  Save details
                </button>
                {profileNotice && <p role="status">{profileNotice}</p>}
              </form>
            ) : (
              <div className="reporter-history">
                {profileNotice && <p role="status">{profileNotice}</p>}
                {historyReports.length ? (
                  historyReports.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openTracking(item)}
                    >
                      <span>
                        <strong>{item.id}</strong>
                        <small>
                          {new Date(item.created_at).toLocaleString("en-IN")}
                        </small>
                      </span>
                      <span>
                        {statusLabel(item.status)}{" "}
                        <Icon name="chevron" size={18} />
                      </span>
                    </button>
                  ))
                ) : (
                  <p>No reports on this device yet.</p>
                )}
                {report && closed(report) && (
                  <button
                    type="button"
                    className="reporter-new-chat"
                    onClick={() => {
                      if (!archiveChatHistory(localStorage)) {
                        setProfileNotice(
                          "Could not save the previous chat on this device.",
                        );
                        return;
                      }
                      localStorage.removeItem("teevra.incident");
                      sessionStorage.removeItem("teevra.incident");
                      setIncidentId("");
                      setReport(null);
                      setLiveMap(null);
                      setConversationKey((n) => n + 1);
                      setPage("chat");
                    }}
                  >
                    Start a new report
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
