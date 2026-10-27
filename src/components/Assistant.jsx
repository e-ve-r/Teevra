import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

export default function Assistant({ remaining, report }) {
  const [messages, setMessages] = useState([{ id: 'welcome', from: 'assistant', text: 'Hi, I’m Teevra Assist. I can help you find your way around the app, add details to a report, or check the demo arrival time.' }])
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const replyTimer = useRef(null)
  const messageList = useRef(null)
  useEffect(() => () => clearTimeout(replyTimer.current), [])
  useEffect(() => { if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight }, [messages, typing])

  function sendMessage(event, suggestion) {
    event?.preventDefault()
    const text = (suggestion || draft).trim()
    if (!text || typing) return
    setMessages(current => [...current, { id: crypto.randomUUID(), from: 'user', text }])
    setDraft('')
    setTyping(true)
    replyTimer.current = setTimeout(() => {
      let reply = 'I’m a demo assistant for now. Use the red Report button to add a photo, type a description, or record your voice. Your information stays in this session until a backend is connected.'
      if (/where|arriv|eta|long|time|track/i.test(text)) reply = remaining > 0 ? `The simulated ambulance is about ${Math.ceil(remaining / 60)} minutes away. Tap Live tracking in the bottom bar to follow its route. This is demo tracking; no real service has been dispatched.` : 'The demo ambulance has reached the reported location. This is a simulated arrival; no real service has been dispatched.'
      else if (/photo|image|upload|record|audio|voice/i.test(text)) reply = 'Tap the red Report button, then choose Open camera or Upload image. Describe the emergency below, or tap the microphone to record a voice note. You can also upload an existing audio recording.'
      else if (/my report|submitted|details/i.test(text) && report) reply = `Your demo report ${report.id} includes ${report.attachments.length} attachment${report.attachments.length === 1 ? '' : 's'}${report.description ? ' and a written description' : ''}. You can see it under Profile → Your latest report. Nothing has been sent to emergency services.`
      else if (/hurt|bleed|breath|pain|medical|injur|safe|emergency/i.test(text)) reply = 'This demo assistant cannot assess an emergency, give medical advice, or contact responders. If someone needs urgent help, contact your local emergency service directly.'
      setMessages(current => [...current, { id: crypto.randomUUID(), from: 'assistant', text: reply }])
      setTyping(false)
    }, 650)
  }
  return <section className="chat-surface surface">
    <div className="chat-heading"><span className="assistant-avatar"><Icon name="spark" size={24} /></span><div><h2>Teevra Assist</h2><p>A little support, right here.</p></div><span className="small-badge">DEMO</span></div>
    <div className="chat-messages" ref={messageList} role="log" aria-label="Conversation" aria-live="polite">{messages.map(message => <div key={message.id} className={`chat-message ${message.from}`}>{message.from === 'assistant' && <span className="message-avatar"><Icon name="spark" size={17} /></span>}<div><div className="message-bubble">{message.text}</div><span className="message-time">{message.from === 'assistant' ? 'Teevra Assist' : 'You'}</span></div></div>)}{typing && <div className="typing-indicator">Preparing a demo reply <span>•••</span></div>}</div>
    {messages.length === 1 && <div className="chat-suggestions"><span>YOU CAN ASK</span>{['When will help arrive?', 'How do I add a photo?'].map(text => <button key={text} onClick={() => sendMessage(null, text)}>{text}<Icon name="arrow" size={17} /></button>)}</div>}
    <form className="chat-composer" onSubmit={sendMessage}><label className="sr-only" htmlFor="chat-input">Message Teevra Assist</label><input id="chat-input" placeholder="Type your message…" value={draft} onChange={e => setDraft(e.target.value)} maxLength={2000} autoComplete="off" /><button aria-label="Send message" disabled={!draft.trim() || typing}><Icon name="send" size={21} /></button></form>
    <p className="chat-disclaimer">Demo responses · Not an emergency service</p>
  </section>
}
