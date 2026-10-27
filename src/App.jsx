import { useEffect, useRef, useState } from 'react'
import Icon from './components/Icon'
import LiveMap from './components/LiveMap'
import ReportForm from './components/Attachments'
import Assistant from './components/Assistant'
import './App.css'

const DURATION = 360
const navigation = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'tracking', label: 'Live tracking', icon: 'pin' },
  { id: 'report', label: 'Report', icon: 'send' },
  { id: 'chat', label: 'AI chat', icon: 'chat' },
  { id: 'profile', label: 'Profile', icon: 'user' },
]

function PageHeading({ eyebrow, title, children }) {
  return <div className="page-heading"><p className="eyebrow"><span className="status-dot" />{eyebrow}</p><h1>{title}</h1>{children && <p className="page-description">{children}</p>}</div>
}

export default function App() {
  const [page, setPage] = useState('home')
  const [trackingStarted, setTrackingStarted] = useState(null)
  const [remaining, setRemaining] = useState(DURATION)
  const [expanded, setExpanded] = useState(false)
  const [report, setReport] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [reporterName, setReporterName] = useState('Alex Kumar')
  const [nameDraft, setNameDraft] = useState('Alex Kumar')
  const [editingName, setEditingName] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [dialog, setDialog] = useState(null)
  const dialogRef = useRef(null)
  const headingRef = useRef(null)
  const previousPage = useRef('home')
  const reportSequence = useRef(2048)
  const eta = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
  const initials = reporterName.split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase()

  useEffect(() => {
    if (!trackingStarted) return
    function update() { setRemaining(Math.max(0, DURATION - Math.floor((Date.now() - trackingStarted) / 1000))) }
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [trackingStarted])
  useEffect(() => {
    if (previousPage.current !== page) {
      previousPage.current = page
      window.scrollTo({ top: 0, behavior: 'instant' })
      headingRef.current?.focus({ preventScroll: true })
    }
  }, [page])
  useEffect(() => {
    if (!dialog) return
    const previous = document.activeElement
    dialogRef.current?.focus()
    function handleKey(event) {
      if (event.key === 'Escape') setDialog(null)
      if (event.key === 'Tab') {
        const controls = [...dialogRef.current.querySelectorAll('button, a, input')].filter(el => !el.disabled)
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', handleKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = overflow; previous?.focus() }
  }, [dialog])
  useEffect(() => {
    if (!notificationsOpen) return
    const close = event => { if (event.key === 'Escape') setNotificationsOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [notificationsOpen])

  function navigate(target) {
    setPage(target)
    setNotificationsOpen(false)
    if (target === 'tracking' && !trackingStarted) setTrackingStarted(Date.now())
  }
  function submitReport(data) {
    setReport({ ...data, id: `TVR-${reportSequence.current++}` })
    setRemaining(DURATION)
    setTrackingStarted(Date.now())
    setSubmitted(true)
    navigate('tracking')
  }

  return <div className="app-shell">
    <header className="app-header"><div className="header-inner">
      <a href="#home" className="brand" onClick={event => { event.preventDefault(); navigate('home') }} aria-label="Teevra home"><span className="brand-shield"><Icon name="plus" size={27} /></span><span>Teevra<span className="brand-tagline">Here when it matters.</span></span></a>
      <div className="header-actions"><span className="preview-badge">PREVIEW</span><div className="notification-wrap"><button className="icon-button notification-button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(v => !v)}><Icon name="bell" size={22} /><span className="notification-dot" /></button>{notificationsOpen && <><button className="notification-dismiss" aria-label="Dismiss notifications" onClick={() => setNotificationsOpen(false)} /><div className="notification-panel"><strong>Your updates</strong><p>{report ? `Report ${report.id} saved in this session.` : 'Welcome to the Teevra preview.'}</p><p>{trackingStarted ? remaining ? `Demo ambulance arriving in ${Math.ceil(remaining / 60)} min.` : 'The demo ambulance has arrived.' : 'Explore live tracking to see a simulated arrival.'}</p><small>Demo updates. No service has been contacted.</small></div></>}</div><button className="profile-avatar" onClick={() => navigate('profile')} aria-label="Open your profile">{initials}</button></div>
    </div></header>

    <main className={`main-content page-${page}`} ref={headingRef} tabIndex={-1} aria-label={`${navigation.find(item => item.id === page)?.label} screen`}>
      <section hidden={page !== 'home'} className="screen home-screen">
        <PageHeading eyebrow="YOUR EMERGENCY COMPANION" title={<>Here when it<br className="desktop-break" /> matters most<span className="red-period">.</span></>}>Report an emergency. Stay connected to help.</PageHeading>
        <div className="home-layout"><section className="home-report-card"><div className="hero-card-top"><span className="siren-circle"><Icon name="siren" size={35} /></span><span className="hero-card-label">A LITTLE HELP STARTS HERE</span></div><h2>Need help fast?</h2><p>Share what’s happening.<br />We’ll help you take the next step.</p><button className="primary-button red-button" onClick={() => navigate('report')}><Icon name="send" size={22} /> Report an emergency <Icon name="arrow" size={22} /></button><span className="hero-caption">A photo. A few words. Or just your voice.</span><div className="hero-rings" aria-hidden="true"><span /><span /><span /></div></section>
        <div className="home-shortcuts"><button className="shortcut-card" onClick={() => navigate('tracking')}><span className="shortcut-icon"><Icon name="pin" size={27} /></span><span className="shortcut-content"><span className="shortcut-eyebrow">EVERY STEP OF THE WAY</span><strong>Live tracking</strong><span>See where help is and when it arrives.</span></span><Icon name="arrow" size={21} /></button><button className="shortcut-card" onClick={() => navigate('chat')}><span className="shortcut-icon"><Icon name="spark" size={27} /></span><span className="shortcut-content"><span className="shortcut-eyebrow">A LITTLE REASSURANCE</span><strong>Talk to Teevra</strong><span>Your AI companion, one tap away.</span></span><Icon name="arrow" size={21} /></button></div></div>
        <div className="home-reassurance"><Icon name="shield" size={19} /><p>Simple steps. Clear updates. <strong>You’re not alone.</strong></p></div>
      </section>

      <section hidden={page !== 'report'} className="screen report-screen">
        <PageHeading eyebrow="LET’S START WITH THE DETAILS" title={<>Report an emergency<span className="red-period">.</span></>}>A photo, a few words, or your voice. Every detail helps.</PageHeading>
        <ReportForm active={page === 'report'} onSubmit={submitReport} reporterName={reporterName} />
      </section>

      <section hidden={page !== 'tracking'} className="screen tracking-screen">
        <PageHeading eyebrow="CONNECTED, EVERY STEP" title={<>Live tracking<span className="red-period">.</span></>}>Help on the way. A little more peace of mind.</PageHeading>
        {submitted && <div className="success-notice" role="status"><span><Icon name="check" size={20} /></span><div><strong>Your demo report is saved.</strong><p>Nothing has been sent to emergency services.</p></div><button className="icon-button" aria-label="Dismiss report confirmation" onClick={() => setSubmitted(false)}><Icon name="cross" size={18} /></button></div>}
        <section className="tracking-card surface"><div className="eta-overview"><span className="ambulance-illustration"><Icon name="ambulance" size={47} /></span><div className="eta-copy"><h2>{remaining ? 'Ambulance arriving in' : 'Demo ambulance has arrived'}</h2><p className="eta-value">{remaining ? eta : 'Here'}{remaining > 0 && <span> min</span>}</p><p className="distance">{remaining ? `${(2.4 * remaining / DURATION).toFixed(1)} km away` : 'At the reported location'}</p></div><span className="route-status"><span className="status-dot" />{remaining ? 'En route' : 'Arrived'}</span></div>
          <div className="tracking-meta"><span><Icon name="shield" size={17} /> City Emergency Response</span><span className="demo-route-label">SIMULATED ROUTE</span></div>
          <LiveMap progress={1 - remaining / DURATION} expanded={expanded} onExpand={() => setExpanded(value => !value)} />
          <div className="destination"><span className="destination-pin"><Icon name="pin" size={22} /></span><div><span>REPORTED LOCATION</span><strong>100 Feet Road, Indiranagar</strong><p>Bengaluru, Karnataka</p></div><button className="icon-button" aria-label="View tracking details" onClick={() => setDialog('tracking')}><Icon name="chevron" size={21} /></button></div>
        </section>
        <div className="response-steps"><div className="response-step complete"><span><Icon name="check" size={17} /></span><strong>Report received</strong></div><div className={`response-step ${remaining ? 'current' : 'complete'}`}><span><Icon name={remaining ? 'ambulance' : 'check'} size={18} /></span><strong>On the way</strong></div><div className={`response-step ${remaining ? '' : 'current'}`}><span><Icon name="pin" size={17} /></span><strong>Help arrives</strong></div></div>
        <button className="tracking-chat-link" onClick={() => navigate('chat')}><span className="shortcut-icon"><Icon name="spark" size={23} /></span><span><strong>A little support while you wait.</strong><small>Chat with the demo assistant</small></span><Icon name="arrow" size={21} /></button>
      </section>

      <section hidden={page !== 'chat'} className="screen chat-screen"><PageHeading eyebrow="YOU DON’T HAVE TO WAIT ALONE" title={<>A little support<span className="red-period">.</span></>}>Ask a question. We’re right here with you.</PageHeading><Assistant remaining={remaining} report={report} /></section>

      <section hidden={page !== 'profile'} className="screen profile-screen"><PageHeading eyebrow="YOUR REPORTER SPACE" title={<>Your profile<span className="red-period">.</span></>}>The details that keep everything connected.</PageHeading><section className="surface profile-card"><span className="large-avatar">{initials}</span><h2>{reporterName}</h2><span className="profile-role">Reporter · Demo profile</span>{editingName ? <form className="name-form" onSubmit={event => { event.preventDefault(); if (nameDraft.trim()) { setReporterName(nameDraft.trim()); setEditingName(false) } }}><label htmlFor="reporter-name">Your name</label><input id="reporter-name" value={nameDraft} onChange={event => setNameDraft(event.target.value)} maxLength={60} required autoFocus /><div><button type="button" className="secondary-button" onClick={() => { setNameDraft(reporterName); setEditingName(false) }}>Cancel</button><button className="primary-button blue-button">Save name</button></div></form> : <button className="secondary-button" onClick={() => setEditingName(true)}>Edit name <Icon name="arrow" size={16} /></button>}</section><div className="profile-links"><button onClick={() => setDialog('report')}><Icon name="file" size={22} /><span>Your latest report<small>{report ? `#${report.id} · Saved locally` : 'No report submitted yet'}</small></span><Icon name="chevron" size={19} /></button><button onClick={() => setDialog('privacy')}><Icon name="lock" size={22} /><span>About this preview<small>Your data, in this session only</small></span><Icon name="chevron" size={19} /></button></div></section>
      <p className="demo-footnote"><span className="status-dot" /> Frontend preview. No real services are contacted.</p>
    </main>

    <nav className="bottom-nav" aria-label="Main navigation"><div className="bottom-nav-inner">{navigation.map(item => <button key={item.id} className={`bottom-nav-item ${page === item.id ? 'active' : ''} ${item.id === 'report' ? 'nav-report' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{item.id === 'report' ? <span className="report-fab"><Icon name="send" size={27} /><span>Report</span></span> : <><span className="nav-icon"><Icon name={item.icon} size={24} />{item.id === 'tracking' && trackingStarted && <span className="nav-eta">{remaining ? `${Math.ceil(remaining / 60)}m` : '✓'}</span>}</span><span>{item.label}</span></>}</button>)}</div></nav>

    {dialog && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setDialog(null) }}><section className="modal surface" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dialog-heading" tabIndex={-1}><div className="modal-top"><span className="shortcut-icon"><Icon name={dialog === 'privacy' ? 'lock' : dialog === 'tracking' ? 'ambulance' : 'file'} size={25} /></span><button className="icon-button" aria-label="Close dialog" onClick={() => setDialog(null)}><Icon name="cross" size={23} /></button></div><h2 id="dialog-heading">{dialog === 'privacy' ? 'About this preview' : dialog === 'tracking' ? 'Your demo response' : 'Your latest report'}</h2>{dialog === 'privacy' ? <><p>This is a frontend demo for emergency reporters. Reports, photos, audio, and chat messages are held in browser memory and reset when you refresh.</p><p>Map locations and arrival times are simulated. The assistant uses preset replies. No real service is contacted.</p><p className="modal-note">For a real emergency, contact your local emergency service directly.</p></> : dialog === 'tracking' ? <><dl><div><dt>Service</dt><dd>City Emergency Response</dd></div><div><dt>Vehicle</dt><dd>Ambulance · KA 03 AB 1248</dd></div><div><dt>Arrival</dt><dd>{remaining ? `${eta} min · simulated` : 'Arrived · simulated'}</dd></div><div><dt>Location</dt><dd>100 Feet Road, Indiranagar, Bengaluru</dd></div></dl><p className="modal-note">The location is a demo destination. GPS and dispatch will be connected in a future version.</p></> : report ? <><span className="small-badge">#{report.id}</span><p className="report-text">{report.description || 'Voice or image report. No written description.'}</p><dl><div><dt>Reporter</dt><dd>{report.reporterName}</dd></div><div><dt>Attachments</dt><dd>{report.attachments.length} file{report.attachments.length === 1 ? '' : 's'}</dd></div></dl>{report.attachments.length > 0 && <ul className="report-attachment-names">{report.attachments.map((file, i) => <li key={i}><Icon name={file.kind === 'image' ? 'image' : 'mic'} size={16} />{file.name}</li>)}</ul>}<p className="modal-note">Saved locally. No service has been contacted.</p></> : <><p>You haven’t submitted a report yet. Start with a photo, a description, or a voice note.</p><button className="primary-button red-button" onClick={() => { setDialog(null); navigate('report') }}>Create a demo report<Icon name="arrow" size={20} /></button></>}</section></div>}
  </div>
}
