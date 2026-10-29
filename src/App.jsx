import { useEffect, useRef, useState } from "react";
import Icon from "./components/Icon";
import ReportForm from "./components/Attachments";
import Assistant from "./components/Assistant";
import TacticalMap from "./components/Department/TacticalMap";
import { api, post, statusLabel } from "./lib/api";
import "./App.css";

const navigation = [
  { id: "home", label: "Home", icon: "home" },
  { id: "tracking", label: "Live tracking", icon: "pin" },
  { id: "report", label: "Report", icon: "send" },
  { id: "chat", label: "AI chat", icon: "chat" },
  { id: "profile", label: "Profile", icon: "user" },
];
const closed = (report) => ["resolved", "cancelled"].includes(report?.status);
function PageHeading({ eyebrow, title, children }) {
  return <div className="page-heading">{eyebrow && <p className="eyebrow"><span className="status-dot" />{eyebrow}</p>}<h1>{title}<span className="red-period">.</span></h1>{children && <p className="page-description">{children}</p>}</div>;
}

export default function App() {
  const [page, setPage] = useState("home");
  const [liveMap, setLiveMap] = useState(null);
  const [report, setReport] = useState(null);
  const [incidentId, setIncidentId] = useState(() => sessionStorage.getItem("teevra.incident"));
  const [reporterName, setReporterName] = useState(() => sessionStorage.getItem("teevra.name") || "Reporter");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updateOpen, setUpdateOpen] = useState(false);
  const heading = useRef(null);
  const initials = reporterName.split(/\s+/).slice(0, 2).map((n) => n[0]).join("").toUpperCase();

  useEffect(() => {
    if (!incidentId) return;
    let cancelled = false;
    async function refresh() {
      try {
        const updated = await api(`/api/incidents/${incidentId}`);
        const map = await api(`/api/incidents/${incidentId}/map`).catch(() => null);
        if (!cancelled) {
          setReport((current) => current && current.id === updated.id && current.revision > updated.revision ? current : updated);
          if (map) setLiveMap(map);
          setError("");
        }
      } catch (failure) {
        if (!cancelled) setError(failure.message);
      }
    }
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [incidentId]);

  function navigate(target) {
    setPage(target);
    window.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }
  async function submitReport(data) {
    const created = await post("/api/incidents", { ...data, description: data.description || "Media report. Review the attached evidence to assess the emergency." });
    sessionStorage.setItem("teevra.incident", created.id);
    setIncidentId(created.id);
    setReport(created);
    setNotice("Your report has been received. You can keep sharing changes below.");
    navigate("tracking");
  }
  async function updateReport(data) {
    const updated = await post(`/api/incidents/${incidentId}/updates`, {
      description: data.description, attachments: data.attachments || [],
    });
    setReport(updated);
    setNotice("Update received. Your incident assessment and response recommendations have been refreshed.");
  }
  const dispatches = report?.dispatches || (report?.dispatch ? [report.dispatch] : []);
  const hasLocation = report?.lat != null && report?.lng != null;

  return <div className="app-shell">
    <header className="app-header"><div className="header-inner">
      <a href="/" className="brand" onClick={(e) => { e.preventDefault(); navigate("home"); }} aria-label="Teevra home"><img className="brand-logo" src="/TeevraLogo.png" alt="" width={64} height={64} /><span className="brand-name">Teevra</span></a>
      <div className="header-actions"><span className="preview-badge">PREVIEW</span><button className="profile-avatar" onClick={() => navigate("profile")} aria-label="Open your profile">{initials}</button></div>
    </div></header>
    <main className={`main-content page-${page}`} ref={heading} tabIndex={-1} aria-label={`${navigation.find((n) => n.id === page)?.label} screen`}>
      <section hidden={page !== "home"} className="screen home-screen">
        <PageHeading title={<>We got you<br className="desktop-break" /> quick</>}>Report an emergency. Get help.</PageHeading>
        <div className="home-layout">
          <section className="home-report-card"><div className="hero-card-top"><span className="siren-circle"><Icon name="siren" size={35} /></span></div><h2>Unsure?</h2><p>Share what’s happening.<br />We’ll help you take the next step.</p><button className="primary-button red-button" onClick={() => navigate("report")}><Icon name="send" size={22} />Report an emergency<Icon name="arrow" size={22} /></button><span className="hero-caption">A photo. A few words. Or just your voice.</span><div className="hero-rings" aria-hidden="true"><span /><span /><span /></div></section>
          <div className="home-shortcuts">
            {[{ target: "tracking", icon: "pin", eyebrow: "EVERY STEP OF THE WAY", title: "Your response", text: "Follow your report and share what changes." }, { target: "chat", icon: "spark", eyebrow: "A LITTLE REASSURANCE", title: "Talk to Teevra", text: "Your AI companion, one tap away." }].map((s) => <button key={s.target} className="shortcut-card" onClick={() => navigate(s.target)}><span className="shortcut-icon"><Icon name={s.icon} size={27} /></span><span className="shortcut-content"><span className="shortcut-eyebrow">{s.eyebrow}</span><strong>{s.title}</strong><span>{s.text}</span></span><Icon name="arrow" size={21} /></button>)}
          </div>
        </div>
        {report && <button className="report-home-status surface" onClick={() => navigate("tracking")}><span className="status-dot" /><strong>{report.id}</strong><span>{statusLabel(report.status)}</span><Icon name="arrow" size={18} /></button>}
      </section>
      <section hidden={page !== "report"} className="screen report-screen">
        <PageHeading eyebrow="LET’S START WITH THE DETAILS" title="Report an emergency">A photo, a few words, or your voice. Every detail helps.</PageHeading>
        {report && !closed(report) && <div className="existing-report-notice"><p>You have an active report, {report.id}. Share a change on that report to keep your response team up to date.</p><button className="secondary-button" onClick={() => { setUpdateOpen(true); navigate("tracking"); }}>Update existing report<Icon name="arrow" size={16} /></button></div>}
        <ReportForm active={page === "report"} onSubmit={submitReport} reporterName={reporterName} />
      </section>
      <section hidden={page !== "tracking"} className="screen tracking-screen">
        <PageHeading eyebrow="CONNECTED, EVERY STEP" title="Your response">Follow your report. Keep us up to date.</PageHeading>
        {error && <p role="alert" className="form-error">{error}</p>}
        {notice && <div className="success-notice" role="status"><Icon name="check" size={20} /><p>{notice}</p><button className="icon-button" aria-label="Dismiss confirmation" onClick={() => setNotice("")}><Icon name="cross" size={18} /></button></div>}
        {!report ? <div className="surface empty-report"><Icon name="pin" size={32} /><h2>{incidentId ? "Loading your report…" : "Your report will appear here"}</h2><p>Once you submit an emergency, you can follow its response and send updates here.</p><button className="primary-button red-button" onClick={() => navigate("report")}>Report an emergency<Icon name="arrow" size={18} /></button></div> : <>
          <section className="tracking-card surface">
            <div className="report-response-heading"><div><p className="eyebrow">{report.id}</p><h2>{statusLabel(report.status)}</h2></div><span className="route-status"><span className="status-dot" />{closed(report) ? "Closed" : "Updates every 3 seconds"}</span></div>
            <div className="response-assignment-list">{dispatches.length ? dispatches.map((d) => <div key={d.unit_id}><Icon name="shield" size={21} /><div><strong>{d.unit_name}</strong><p>{closed(report) ? "Response completed" : report.status === "on_scene" ? "At the incident" : (liveMap?.incident_id === report.id && liveMap.routes.find((r) => r.unit_id === d.unit_id) ? `Road ETA: ${liveMap.routes.find((r) => r.unit_id === d.unit_id).eta_minutes} min · ${liveMap.routes.find((r) => r.unit_id === d.unit_id).distance_km} km` : `Assigned ETA: ${d.eta_minutes} min`)}</p></div></div>) : <p>Your report is in the response queue. A fleet has not been assigned yet.</p>}</div>
            {hasLocation && page === "tracking" && <TacticalMap incident={report} height="280px" />}
            <div className="destination"><span className="destination-pin"><Icon name="pin" size={22} /></span><div><span>REPORTED LOCATION</span><strong>{report.location_name}</strong><p>{hasLocation ? `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}${report.location_accuracy_m ? ` · ±${Math.round(report.location_accuracy_m)} m` : ""}` : "Address provided · GPS not shared"}</p></div></div>
          </section>
          {!closed(report) && <div className="situation-updates"><button className="tracking-chat-link" aria-expanded={updateOpen} onClick={() => setUpdateOpen((v) => !v)}><span className="shortcut-icon"><Icon name="send" size={22} /></span><span><strong>Has anything changed?</strong><small>Send new details, a photo, or a voice note.</small></span><Icon name={updateOpen ? "minus" : "plus"} size={21} /></button>{updateOpen && <ReportForm active={page === "tracking" && updateOpen} isUpdate onSubmit={updateReport} reporterName={reporterName} />}</div>}
          {!!report.updates?.length && <section className="surface reporter-update-history"><h2>Your situation updates</h2>{[...report.updates].reverse().map((u, index) => <div key={index}><small>{new Date(u.timestamp).toLocaleString()}</small><p>{u.description || "Media update"}</p><span>{u.attachments.length ? `${u.attachments.length} attachment(s)` : ""}</span></div>)}</section>}
        </>}
      </section>
      <section hidden={page !== "chat"} className="screen chat-screen"><PageHeading eyebrow="YOU DON’T HAVE TO WAIT ALONE" title="A little support">Ask a question. We’re right here with you.</PageHeading><Assistant remaining={0} report={report} trackingStarted={false} onReportUpdate={report && !closed(report) ? updateReport : null} /></section>
      <section hidden={page !== "profile"} className="screen profile-screen"><PageHeading eyebrow="YOUR REPORTER SPACE" title="Your profile">The details that keep everything connected.</PageHeading><section className="surface profile-card"><span className="large-avatar">{initials}</span><form className="name-form" onSubmit={(e) => { e.preventDefault(); sessionStorage.setItem("teevra.name", reporterName); setNotice("Your name is saved for this session."); }}><label htmlFor="reporter-name">Your name</label><input id="reporter-name" value={reporterName} onChange={(e) => setReporterName(e.target.value)} required maxLength={80} /><button className="primary-button blue-button">Save name</button></form>{notice && <p role="status">{notice}</p>}{report && <p>Latest report: {report.id}<br />Callback: {report.reporter_phone}</p>}</section></section>
      <p className="demo-footnote">Prototype · Demo fleets are labelled; road ETAs exclude live traffic. For a real emergency, call your local emergency service.</p>
    </main>
    <nav className="bottom-nav" aria-label="Main navigation"><div className="bottom-nav-inner">{navigation.map((n) => <button key={n.id} className={`bottom-nav-item ${page === n.id ? "active" : ""} ${n.id === "report" ? "nav-report" : ""}`} aria-current={page === n.id ? "page" : undefined} onClick={() => navigate(n.id)}>{n.id === "report" ? <span className="report-fab"><Icon name="send" size={27} /><span>Report</span></span> : <><span className="nav-icon"><Icon name={n.icon} size={24} /></span><span>{n.label}</span></>}</button>)}</div></nav>
  </div>;
}
