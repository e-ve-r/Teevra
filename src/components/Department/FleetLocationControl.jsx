import { useEffect, useRef, useState } from "react";
import { post } from "../../lib/api";

export default function FleetLocationControl({ units }) {
  const [unitId, setUnitId] = useState("");
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("");
  const watch = useRef(null);
  const lastSent = useRef(0);
  const sending = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; if (watch.current != null) navigator.geolocation.clearWatch(watch.current); }, []);
  function stop() {
    generation.current++;
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    setSharing(false);
    setMessage("GPS sharing stopped. The map keeps the last reported position.");
  }
  function start() {
    if (!unitId || !navigator.geolocation) { setMessage("Choose a fleet and use a browser with location support."); return; }
    const version = ++generation.current;
    lastSent.current = 0;
    setSharing(true);
    setMessage("Waiting for this device’s GPS permission…");
    watch.current = navigator.geolocation.watchPosition(async (position) => {
      if (version !== generation.current || sending.current || Date.now() - lastSent.current < 10000) return;
      sending.current = true;
      try {
        await post(`/api/responders/${encodeURIComponent(unitId)}/location`, {
          lat: position.coords.latitude, lng: position.coords.longitude,
          current_location: `Live GPS: ${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`,
        }, "PATCH");
        if (version === generation.current) { lastSent.current = Date.now(); setMessage(`GPS shared at ${new Date().toLocaleTimeString()} · ±${Math.round(position.coords.accuracy)} m`); }
      } catch (failure) { if (version === generation.current) setMessage(failure.message); }
      finally { sending.current = false; }
    }, (failure) => {
      if (version !== generation.current) return;
      if (failure.code === 1) { stop(); setMessage("Location permission denied. Allow it in your browser to share fleet GPS."); }
      else setMessage("GPS unavailable. Waiting for a position; check location services.");
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  return <section className="fleet-gps-control" aria-label="Fleet GPS sharing"><div><strong>Fleet location</strong><p>Use from the fleet’s device. Share this device’s GPS to update both maps and road ETAs.</p></div><label><span className="sr-only">Fleet to track</span><select value={unitId} disabled={sharing} onChange={(e) => setUnitId(e.target.value)}><option value="">Choose your fleet</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><button className="dispatch-secondary" disabled={!sharing && !unitId} onClick={sharing ? stop : start}>{sharing ? "Stop GPS sharing" : "Share fleet GPS"}</button>{message && <p className="fleet-gps-message" role="status">{message}</p>}</section>;
}
