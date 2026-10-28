import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export default function TacticalMap({
  incident,
  responders = [],
  assignedResponder = null,
  height = "260px",
  interactive = true,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);

  // Default coordinate if incident has none
  const incidentLat = incident?.lat || 12.9716;
  const incidentLng = incident?.lng || 77.6412;

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Destroy existing map if any
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Initialize Leaflet map
    const map = L.map(mapContainerRef.current, {
      center: [incidentLat, incidentLng],
      zoom: 14,
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: false,
      attributionControl: false,
    });

    // High-performance CartoDB Positron light tiles
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 19,
        subdomains: "abcd",
      }
    ).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);
    markersLayerRef.current = markersGroup;
    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [incidentLat, incidentLng, interactive]);

  // Update markers, route polyline, and view when incident or responders change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersLayerRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();

    // 1. Render Incident Scene Marker
    const isP1 = incident?.priority === "P1";
    const incidentPinColor = isP1 ? "#ed2546" : incident?.priority === "P2" ? "#d97706" : "#2563eb";

    const incidentIcon = L.divIcon({
      className: "custom-cad-marker",
      html: `
        <div style="position: relative; width: 44px; height: 44px; display: grid; place-items: center;">
          <div style="position: absolute; width: 36px; height: 36px; border-radius: 50%; background: ${incidentPinColor}22; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="width: 28px; height: 28px; border-radius: 50%; background: ${incidentPinColor}; border: 3px solid #ffffff; box-shadow: 0 4px 12px ${incidentPinColor}66; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 13px; font-weight: 800;">
            !
          </div>
          <div style="position: absolute; top: 38px; white-space: nowrap; background: #ffffff; color: #11234b; font-size: 10px; font-weight: 750; padding: 2px 8px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); border: 1px solid #dce6f7;">
            ${incident?.id || "SCENE"}
          </div>
        </div>
      `,
      iconSize: [44, 52],
      iconAnchor: [22, 22],
    });

    const incidentMarker = L.marker([incidentLat, incidentLng], { icon: incidentIcon }).addTo(markersGroup);
    incidentMarker.bindPopup(`
      <div style="font-family: 'DM Sans', sans-serif; min-width: 180px;">
        <strong style="color: ${incidentPinColor}; font-size: 12px;">${incident?.id || "Incident Scene"} (${incident?.priority || "P1"})</strong>
        <p style="margin: 4px 0 0 0; font-size: 11px; color: #334155;">${incident?.location_name || "Emergency Location"}</p>
        <span style="display: inline-block; margin-top: 4px; font-size: 10px; color: #64748b; text-transform: uppercase;">Status: ${incident?.status || "Pending"}</span>
      </div>
    `);

    // 2. Render Responders
    const bounds = L.latLngBounds([[incidentLat, incidentLng]]);

    responders.forEach((unit) => {
      // Determine unit coordinates based on unit id or default offsets
      let uLat;
      let uLng;

      if (unit.id === "AMB-101") {
        uLat = 12.9745;
        uLng = 77.6450;
      } else if (unit.id === "AMB-104") {
        uLat = 12.9609;
        uLng = 77.6387;
      } else if (unit.id === "FIRE-202") {
        uLat = 12.9815;
        uLng = 77.6270;
      } else if (unit.id === "POL-301") {
        uLat = 12.9750;
        uLng = 77.6405;
      } else if (unit.id === "AMB-108") {
        uLat = 12.9680;
        uLng = 77.6430;
      } else {
        uLat = incidentLat + 0.005;
        uLng = incidentLng + 0.005;
      }

      const isCurrentAssigned = assignedResponder?.id === unit.id || incident?.dispatch?.unit_id === unit.id;
      const unitBg = isCurrentAssigned ? "#1765f4" : unit.status === "Available" ? "#16a34a" : "#64748b";
      const unitSymbol = unit.type.includes("Ambulance") || unit.type.includes("Trauma") ? "🚑" : unit.type.includes("Fire") ? "🚒" : "🚓";

      const unitIcon = L.divIcon({
        className: "custom-cad-unit-marker",
        html: `
          <div style="position: relative; width: 36px; height: 36px; display: grid; place-items: center;">
            <div style="width: 30px; height: 30px; border-radius: 50%; background: ${unitBg}; border: 2.5px solid #ffffff; box-shadow: 0 4px 10px rgba(0,0,0,0.18); display: flex; align-items: center; justify-content: center; font-size: 14px;">
              ${unitSymbol}
            </div>
            <div style="position: absolute; top: 32px; white-space: nowrap; background: #ffffff; color: ${unitBg}; font-size: 9px; font-weight: 750; padding: 1px 6px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); border: 1px solid #dce6f7;">
              ${unit.name.split(" ")[0]}
            </div>
          </div>
        `,
        iconSize: [36, 44],
        iconAnchor: [18, 18],
      });

      const uMarker = L.marker([uLat, uLng], { icon: unitIcon }).addTo(markersGroup);
      uMarker.bindPopup(`
        <div style="font-family: 'DM Sans', sans-serif; min-width: 170px;">
          <strong style="color: ${unitBg}; font-size: 12px;">${unit.name}</strong>
          <p style="margin: 2px 0 0 0; font-size: 11px; color: #475569;">${unit.type} · ${unit.status}</p>
          <div style="margin-top: 6px; font-size: 10px; color: #64748b; line-height: 1.4;">
            <div><strong>Base:</strong> ${unit.base_station}</div>
            <div><strong>ETA:</strong> ${unit.eta_minutes} min (${unit.distance_km} km)</div>
          </div>
        </div>
      `);

      bounds.extend([uLat, uLng]);

      // If this unit is assigned, draw high-visibility route polyline
      if (isCurrentAssigned) {
        // Waypoint to create realistic road geometry
        const midLat = (incidentLat + uLat) / 2 + 0.001;
        const midLng = (incidentLng + uLng) / 2 - 0.001;

        const routeCoords = [
          [uLat, uLng],
          [midLat, midLng],
          [incidentLat, incidentLng],
        ];

        // Route casing (darker border)
        L.polyline(routeCoords, {
          color: "#0d44b5",
          weight: 6,
          opacity: 0.8,
          lineCap: "round",
        }).addTo(markersGroup);

        // Core bright blue route
        L.polyline(routeCoords, {
          color: "#1765f4",
          weight: 4,
          opacity: 1,
          dashArray: "10 8",
          lineCap: "round",
        }).addTo(markersGroup);
      }
    });

    // Fit map bounds smoothly
    if (responders.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    } else {
      map.setView([incidentLat, incidentLng], 14);
    }
  }, [incident, responders, assignedResponder, incidentLat, incidentLng]);

  return (
    <div style={{ position: "relative", width: "100%", height: height, borderRadius: "14px", overflow: "hidden", border: "1px solid var(--line)" }}>
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />

      {/* High-visibility map telemetry badge */}
      <div
        style={{
          position: "absolute",
          top: "10px",
          left: "10px",
          zIndex: 1000,
          background: "#fffffffa",
          backdropFilter: "blur(8px)",
          padding: "4px 10px",
          borderRadius: "8px",
          border: "1px solid #dce6f7",
          boxShadow: "0 2px 8px rgba(18, 36, 77, 0.08)",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "11px",
          fontWeight: 700,
          color: "#12244d",
        }}
      >
        <span
          style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            background: "#16a34a",
            boxShadow: "0 0 6px #16a34a",
          }}
        />
        <span>GIS Tactical Grid: Bengaluru Indiranagar Sector</span>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: "10px",
          right: "10px",
          zIndex: 1000,
          background: "#fffffffa",
          backdropFilter: "blur(8px)",
          padding: "3px 8px",
          borderRadius: "6px",
          border: "1px solid #dce6f7",
          fontSize: "10px",
          fontWeight: 600,
          color: "#64748b",
        }}
      >
        CartoDB / OpenStreetMap
      </div>
    </div>
  );
}
