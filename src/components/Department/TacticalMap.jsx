import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api } from "../../lib/api";
import "leaflet/dist/leaflet.css";
import "./Map.css";

const EMPTY_FLEET = [];
export default function TacticalMap({ incident, responders = EMPTY_FLEET, height = "300px", onLocationPick }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const viewKey = useRef("");
  const [mapData, setMapData] = useState(null);
  const [error, setError] = useState("");
  const [tileError, setTileError] = useState(false);
  const lat = incident?.lat;
  const lng = incident?.lng;
  const id = incident?.id;
  const fleetKey = JSON.stringify(responders);
  const unitIds = responders.map((u) => u.id).sort().join(",");

  useEffect(() => {
    const map = L.map(container.current, { center: [12.9716, 77.5946], zoom: 12, scrollWheelZoom: false });
    const tiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 19,
    }).addTo(map);
    const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19,
    });
    [tiles, streets].forEach((layer) => {
      layer.on("tileerror", () => setTileError(true));
      layer.on("tileload", () => setTileError(false));
    });
    L.control.layers({ "Light map": tiles, "Street map": streets }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onLocationPick) return;
    const choose = (event) => onLocationPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    map.on("click", choose);
    return () => { map.off("click", choose); };
  }, [onLocationPick]);

  useEffect(() => {
    if (!id || lat == null || lng == null) return;
    let stopped = false;
    let timer;
    async function refresh() {
      try {
        const result = await api(`/api/incidents/${encodeURIComponent(id)}/map${unitIds ? `?unit_ids=${encodeURIComponent(unitIds)}` : ""}`);
        if (!stopped) { setMapData(result); setError(""); }
      } catch (failure) { if (!stopped) setError(failure.message); }
      finally { if (!stopped) timer = setTimeout(refresh, 15000); }
    }
    refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [id, lat, lng, unitIds]);

  const currentData = mapData?.incident_id === id ? mapData : null;
  const dataKey = JSON.stringify(currentData);
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (lat == null || lng == null) return;
    const data = JSON.parse(dataKey);
    const units = data?.units || JSON.parse(fleetKey);
    const bounds = L.latLngBounds([[lat, lng]]);
    const scene = L.circleMarker([lat, lng], { radius: 10, color: "#fff", weight: 3, fillColor: "#ed2546", fillOpacity: 1 }).addTo(layer);
    const label = document.createElement("span");
    label.textContent = incident?.location_name || "Selected incident location";
    scene.bindPopup(label);
    if (incident?.location_accuracy_m) L.circle([lat, lng], { radius: incident.location_accuracy_m, weight: 1, color: "#ed2546", fillOpacity: .06 }).addTo(layer);
    units.filter((u) => u.lat != null && u.lng != null).forEach((u) => {
      const marker = L.circleMarker([u.lat, u.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#1765f4", fillOpacity: 1 }).addTo(layer);
      const text = document.createElement("span");
      text.textContent = `${u.name} · ${u.current_location}${u.location_source === "demo" ? " (demo location)" : ` · GPS updated ${new Date(u.location_updated_at).toLocaleTimeString()}`}`;
      marker.bindPopup(text);
      bounds.extend([u.lat, u.lng]);
    });
    (data?.routes || []).forEach((route) => {
      const line = L.geoJSON(route.geometry, { style: { color: "#1765f4", weight: 5, opacity: .8 } }).addTo(layer);
      const text = document.createElement("span");
      text.textContent = `${route.unit_id}: ${route.eta_minutes} min · ${route.distance_km} km by road`;
      line.bindPopup(text);
      bounds.extend(line.getBounds());
    });
    const key = JSON.stringify([lat, lng, units.map((u) => [u.id, u.lat, u.lng]), (data?.routes || []).map((r) => r.geometry)]);
    if (viewKey.current !== key) {
      map.fitBounds(bounds, { padding: [35, 35], maxZoom: 15 });
      viewKey.current = key;
    }
  }, [lat, lng, incident?.location_name, incident?.location_accuracy_m, fleetKey, dataKey]);

  return <div className="real-map-shell">
    <div ref={container} className="incident-map" style={{ height, width: "100%" }} aria-label={onLocationPick ? "Select incident location on the map" : "Incident and fleet street map"} />
    <div className="real-map-caption"><span><i className="map-scene-dot" />Incident</span>{!onLocationPick && <span><i className="map-fleet-dot" />Fleet</span>}<button type="button" onClick={() => { if (lat != null && lng != null) { mapRef.current?.setView([lat, lng], 15); } }}>Recenter</button>{lat != null && lng != null && <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`} target="_blank" rel="noreferrer">Open map ↗</a>}</div>
    {onLocationPick && <p className="real-map-note">{lat == null ? "Tap the map to pin the incident. The initial view is Bengaluru." : "Tap elsewhere to move the incident pin."}</p>}
    {!onLocationPick && lat == null && <p className="real-map-note">Incident coordinates haven’t been shared. This view is not a confirmed incident location.</p>}
    {tileError && <p className="real-map-warning" role="status">Map tiles could not load. Check your connection or switch map layers.</p>}
    {error && <p className="real-map-warning" role="status">Fleet updates unavailable. {error}</p>}
    {currentData?.routes?.map((route) => <p key={route.unit_id} className="real-map-note">{currentData.units.find((u) => u.id === route.unit_id)?.name || route.unit_id}: {route.eta_minutes} min · {route.distance_km} km by road{currentData.units.find((u) => u.id === route.unit_id)?.location_source === "demo" ? " · Demo fleet position" : ""}</p>)}
    {!!currentData?.routes?.length && <p className="real-map-note">Road estimates exclude live traffic. Fleet positions refresh every 15 seconds.</p>}
    {currentData?.routing_unavailable && <p className="real-map-warning">Road routing unavailable for one or more fleets. Positions are shown without a route.</p>}
  </div>;
}
