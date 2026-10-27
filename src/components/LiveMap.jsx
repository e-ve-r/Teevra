import { useState } from 'react'
import Icon from './Icon'

const route = [{ x: 220, y: 296 }, { x: 345, y: 296 }, { x: 345, y: 175 }, { x: 568, y: 175 }, { x: 568, y: 247 }]

function vehiclePosition(progress) {
  const lengths = route.slice(1).map((p, i) => Math.hypot(p.x - route[i].x, p.y - route[i].y))
  let remaining = lengths.reduce((sum, n) => sum + n, 0) * Math.min(1, Math.max(0, progress))
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) return { x: route[i].x + (route[i + 1].x - route[i].x) * remaining / lengths[i], y: route[i].y + (route[i + 1].y - route[i].y) * remaining / lengths[i] }
    remaining -= lengths[i]
  }
  return route.at(-1)
}

export default function LiveMap({ progress, expanded, onExpand }) {
  const [zoom, setZoom] = useState(1)
  const vehicle = vehiclePosition(progress)
  return <div className={`map ${expanded ? 'map-expanded' : ''}`}>
    <svg className="map-art" viewBox="0 0 800 390" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustrative demo map of an ambulance approaching your reported location in Indiranagar, Bengaluru">
      <defs><pattern id="blocks" width="120" height="100" patternUnits="userSpaceOnUse" patternTransform="rotate(-13)"><rect width="120" height="100" fill="#f1f0e9" /><rect x="8" y="8" width="43" height="34" rx="3" fill="#e8e7e0" /><rect x="59" y="8" width="53" height="34" rx="3" fill="#e8e7e0" /><rect x="8" y="50" width="63" height="42" rx="3" fill="#e8e7e0" /><rect x="79" y="50" width="33" height="42" rx="3" fill="#e8e7e0" /><path d="M0 0h120M0 0v100" stroke="#fff" strokeWidth="9" /></pattern><filter id="pin-shadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity=".13" /></filter></defs>
      <g transform={`translate(${400 * (1 - zoom)}, ${195 * (1 - zoom)}) scale(${zoom})`} className="map-zoom-layer">
        <rect x="-400" y="-200" width="1600" height="800" fill="url(#blocks)" />
        <path d="m0 83 150 12 92-18 147 15 124-24L800 83M-10 296h355V-10M568-10v410M0 175h810M0 360l800-26" stroke="#dcdcd3" strokeWidth="19" fill="none" />
        <path d="m0 83 150 12 92-18 147 15 124-24L800 83M-10 296h355V-10M568-10v410M0 175h810M0 360l800-26" stroke="#fffefa" strokeWidth="15" fill="none" />
        <path d="M8 0 61 71l38 122 81 221M680-20l-24 131 37 123L800 304" stroke="#dcdcd3" strokeWidth="15" fill="none" /><path d="M8 0 61 71l38 122 81 221M680-20l-24 131 37 123L800 304" stroke="#fffefa" strokeWidth="11" fill="none" />
        <path d="m391 206 118-1 24 93-142 18Z" fill="#e0e8ec" /><path d="m46 111 47-8 16 42-49 13Z" fill="#e0e8ec" /><path d="m700 92 72 12-9 48-74-9Z" fill="#e0e8ec" />
        <g fill="#d6e1e8"><circle cx="414" cy="229" r="9" /><circle cx="437" cy="224" r="8" /><circle cx="492" cy="225" r="11" /><circle cx="421" cy="289" r="10" /><circle cx="505" cy="282" r="9" /></g>
        <g fontFamily="Arial, sans-serif" textAnchor="middle" fill="#92948b" fontSize="9"><text x="237" y="72" letterSpacing="1.5">HAL 2ND STAGE</text><text x="465" y="53" letterSpacing="1.5">INDIRANAGAR</text><text x="464" y="258" fill="#8193a7" fontSize="10">Indiranagar</text><text x="464" y="272" fill="#8193a7" fontSize="10">Park</text><text x="162" y="167">100 Feet Road</text><text x="462" y="166">12th Main Road</text><text x="667" y="166">12th Main Road</text><text x="442" y="345">CMH Road</text><text x="337" y="110" transform="rotate(-90 337 110)">80 Feet Road</text><text x="558" y="100" transform="rotate(-90 558 100)">100 Feet Road</text><text x="195" y="249" fontSize="10">HAL 2nd Stage</text><text x="708" y="320" letterSpacing="1">DOMLUR</text><text x="717" y="64">Defence Colony</text></g>
        <path d="M220 296H345V175H568V247" fill="none" stroke="#c6dcff" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" /><path d="M220 296H345V175H568V247" fill="none" stroke="#1765f4" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="568" cy="247" r="30" fill="#ed2546" opacity=".10" /><circle cx="568" cy="247" r="20" fill="#ed2546" opacity=".13" />
        <g transform="translate(568 247)" filter="url(#pin-shadow)"><path d="M0 4C-3 0-13-8-13-18a13 13 0 1 1 26 0C13-8 3 0 0 4Z" fill="#ed2546" stroke="white" strokeWidth="2.5" /><circle cy="-18" r="4" fill="white" /></g>
        <g transform="translate(568 278)"><rect x="-49" y="-11" width="98" height="24" rx="5" fill="white" filter="url(#pin-shadow)" /><text textAnchor="middle" y="5" fontSize="10" fontWeight="600" fill="#405675">Your location</text></g>
        <g transform={`translate(${vehicle.x} ${vehicle.y})`} className="vehicle-marker"><circle r="27" fill="#1765f4" opacity=".12" /><circle r="19" fill="#fff" filter="url(#pin-shadow)" /><rect x="-14" y="-11" width="28" height="22" rx="6" fill="#1765f4" /><path d="M-8-4H2V5H-8ZM2-1H6L9 2V5H2M-5-6V1M-8-3h6" stroke="white" strokeWidth="1.4" fill="none" /><circle cx="-5" cy="6" r="2" fill="white" /><circle cx="6" cy="6" r="2" fill="white" /></g>
      </g>
    </svg>
    <div className="map-label"><span className="status-dot" /> Live route <span className="map-demo">DEMO</span></div>
    <div className="map-tools"><button aria-label="Zoom in" disabled={zoom >= 1.8} onClick={() => setZoom(z => Math.min(1.8, z + .2))}><Icon name="plus" size={17} /></button><button aria-label="Zoom out" disabled={zoom <= .8} onClick={() => setZoom(z => Math.max(.8, z - .2))}><Icon name="minus" size={17} /></button><span /><button aria-label="Recenter map" onClick={() => setZoom(1)}><Icon name="locate" size={17} /></button></div>
    <button className="map-expand" onClick={onExpand}>{expanded ? 'Collapse map' : 'Expand map'} <Icon name={expanded ? 'minus' : 'plus'} size={13} /></button>
    <span className="map-attribution">Illustrative map · simulated location</span>
  </div>
}
