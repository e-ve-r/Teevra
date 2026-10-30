# Teevra

AI assisted emergency reporting and response coordination, with separate reporter and responder dashboards. This is a prototype; it does not contact real emergency services.

## Run locally

```sh
npm ci
python3 -m venv Backend/.venv
Backend/.venv/bin/python -m pip install -r Backend/requirements.txt
Backend/.venv/bin/python -m uvicorn Backend.main:app --reload --reload-dir Backend --reload-exclude '**/.venv/**' --host 127.0.0.1 --port 8000
```

In another terminal, run `npm run dev`.

- Reporter: `http://localhost:5173/`
- Responder: `http://localhost:5173/responder` (`/dispatch` is an alias)

There are no links or role switches between the two dashboards. These routes separate the interfaces; they do not implement authentication or role based API authorization.

The backend stores reports, updates, fleet assignments and uploaded media locally. It starts with sample incidents and fleet locations. Configure `Backend/.env` for model inference; see [backend configuration](Backend/README.md). Without a working provider, triage uses an explicitly labelled rules fallback requiring operator review. Chat reports an error if inference is unavailable.

## Reporting

Reports accept text, photos and recorded or uploaded audio. A callback mobile number is required. Browsers do not expose the phone's mobile number, so the reporter enters it. GPS capture requires browser permission on localhost or HTTPS; coordinates are refreshed on submission and include accuracy. If GPS is denied or unavailable, an incident address can be entered without fabricating coordinates.

After submitting, the reporter follows saved assignment/status information and can add more text, photos or voice notes to the same incident. Chat messages can also become incident updates through the visible sharing checkbox. Each update is saved, re-evaluated against the full timestamped history, and reflected on the responder dashboard through three second polling. The incident's original report time is preserved. The report ID and reporter name survive refresh within the browser session; reports and media remain in backend storage.

## Response workspace

Stats appear in the main workspace. The queue orders open incidents by priority band, severity and time waiting; closed incidents appear separately. The score is `priority band + severity × 0.7 + min(waiting minutes, 120) × 0.25`, with priority bands of 200 / 100 / 0 for P1 / P2 / P3. Older reports win equal scores. Aging cannot let standard incidents displace critical ones.

Incidents show a top status label, caller details, assessment, situation updates and location. Fleet selection appears when assigning, grouped by the suggested departments. A single incident can receive fleets from multiple departments. Assigned or unavailable fleets are excluded from suggestions and duplicate assignments are rejected by the API. Closing an incident releases all its assigned units.

Departments and available fleets are sorted by estimated arrival time, then distance. ETAs use OSRM road routes from the stored fleet coordinates to the reported incident. When road routing is unavailable, clearly labelled approximate estimates use a 1.3 distance factor, 30 km/h and two minutes for mobilisation. Neither includes live traffic. Missing coordinates show an unknown ETA and require operator confirmation. Demo fleet positions are labelled; a location-update endpoint supports actual telemetry integration.

Worsening reports can increase priority and change recommendations. Reassessment replaces the previous score; explicit reported improvement can lower the score, and rules assessments require operator review. The model considers report text and local uploaded image/audio bytes; unsupported media or provider failures use the rules fallback and remain available to the operator.

## Validation

```sh
npm run lint
npm run build
Backend/.venv/bin/python -m unittest discover -s Backend/tests -v
```

Regression coverage includes callback/location validation, unknown GPS, escalation and history, severity/age ordering, telemetry based recommendations, legacy fleet reconciliation, multi-department assignments, assignment conflicts, release on resolution, durable uploads and multimodal provider payloads. Provider tests use mocks.

## Implementation

React, Vite, Leaflet, plain CSS, FastAPI, SQLite and OpenRouter. Vite proxies both `/api` and `/uploads` to port 8000. For separate hosting, set `VITE_API_BASE_URL`, configure backend CORS, and route both paths to the backend. Production hosting must serve the frontend entry point for `/responder` and `/dispatch`.

The app is not connected to emergency dispatch networks or live traffic. Responders can share device GPS for a selected fleet. Authentication and role authorization remain integration work. Uploaded media and report text are sent to OpenRouter and its selected inference provider for assessment when configured. Map tiles use OpenStreetMap. Do not commit environment files, the SQLite database, uploaded media or generated builds.

## Real maps and fleet-to-reporter ETA

Both dashboards show real OpenStreetMap street tiles, the reported incident pin, assigned fleet positions and OSRM road routes from each fleet to the incident. The reporter’s main ETA and responder assignment label use the current road ETA. Maps poll fleet positions every 15 seconds; the reporter response summary refreshes every three seconds. No simulated movement is generated.

On the responder dashboard, choose the correct fleet under **Fleet location**, then select **Share fleet GPS** from that fleet’s device and grant browser location permission. New GPS positions are uploaded at most once every ten seconds and recalculate routes. Stopping sharing retains the last known position and its timestamp. Until GPS is shared, existing seeded fleet coordinates remain labelled as demo positions. The reporter can use GPS or tap the real map to choose the incident pin.

Set server-side `ROUTING_BASE_URL` to a compatible OSRM deployment; the default is `https://router.project-osrm.org`. Routes are cached for five minutes per exact coordinate pair and invalidated by movement; failures are cached for 30 seconds. Road ETA is route driving duration, without live traffic or mobilisation time. If routing fails, maps show positions without invented routes and fleet recommendations explicitly label approximate estimates. Unknown coordinates require a confirmed ETA.

The default public OSRM and OpenStreetMap services are suitable for local prototype validation, not a guaranteed emergency-service dependency. Configure a production routing/tile service for deployment and follow the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/). Routing sends fleet/incident coordinates to the configured server; map tiles request the displayed geographic area.
