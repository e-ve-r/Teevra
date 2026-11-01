# Teevra

AI assisted emergency reporting and response coordination, with separate reporter and responder dashboards. This is a prototype; it does not contact real emergency services.

## Run locally

Start [Ollama](https://ollama.com/) and pull the local models once:

```sh
ollama pull llama3.2
ollama pull moondream
```

Leave Ollama running while the app is in use. If the Ollama app is not already running, start it with `ollama serve` in a separate terminal.

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

The backend stores reports, updates, fleet assignments and uploaded media locally. New databases start without demo incidents or fleets; existing data is retained. Configure `Backend/.env` for model inference; see [backend configuration](Backend/README.md). Without a working provider, triage uses an explicitly labelled rules fallback requiring operator review. Chat reports an error if inference is unavailable.

## Reporting

The reporter starts in a full-screen AI chat and can type, attach an image or use voice. The assistant asks follow-up questions and may recommend a report; the reporter selects the red **Report** button to review and send it. The model prepares a summary for the reporter to check along with their name, callback phone and incident address before explicitly sending it to the responder workspace. GPS is optional and requires browser permission on localhost or HTTPS. Reports are limited to 2,000 characters. Images are resized to at most 1,280 pixels and compressed locally before upload.

After submission, the bottom button opens live tracking. On each chat request, the backend fetches the saved incident, recent updates, assigned units and available route estimates; the model is instructed to distinguish estimated, cached and demo data from live emergency services. Tickets use UUID-based IDs and are saved immediately with an initial rules assessment marked for operator review. AI refinement runs in the background and cannot replace an assessment based on a newer update. The responder workspace polls while visible. The profile stores the name, callback number and report IDs in this browser's local storage; report data remains in backend storage. A few English and Hindi breathing and consciousness red flags return a fixed instruction to call emergency services immediately, independently of model output. This is not comprehensive medical triage.

## Voice chat and translation

In chat, choose EN or हिं for spoken input, select the microphone, allow access, and speak. Tap the checkmark to finish; the browser may also finish after a pause. The transcript is sent to chat and the response is spoken. Tap the microphone for each new turn. Recording and playback stop when leaving chat or hiding the tab.

By default, voice uses the browser's speech recognition and speech synthesis, so it does not use the Gemini API. Recognition availability, language support, voices, and network requirements depend on the browser and device; browser recognition may send audio to the browser vendor's service. Chrome is a useful testing option. A Hindi voice must be installed on the device for Hindi speech playback. Set `VITE_VOICE_PROVIDER=gemini` in the frontend environment and restart Vite to use the optional Gemini voice endpoints instead; this requires a server-side Gemini key. Chat, report summaries and assessments use local Ollama. Voice transcripts may be inaccurate; review the report details before confirming.

## Response workspace

Stats appear in the main workspace. The queue orders open incidents by priority band, severity and time waiting; closed incidents appear separately. The score is `priority band + severity × 0.7 + min(waiting minutes, 120) × 0.25`, with priority bands of 200 / 100 / 0 for P1 / P2 / P3. Older reports win equal scores. Aging cannot let standard incidents displace critical ones.

Incidents show a top status label, caller details, assessment, situation updates and location. Fleet selection appears when assigning, grouped by the suggested departments. A single incident can receive fleets from multiple departments. Assigned or unavailable fleets are excluded from suggestions and duplicate assignments are rejected by the API. Closing an incident releases all its assigned units.

Departments and available fleets are sorted by estimated arrival time, then distance. ETAs use OSRM road routes from the stored fleet coordinates to the reported incident. When road routing is unavailable, clearly labelled approximate estimates use a 1.3 distance factor, 30 km/h and two minutes for mobilisation. Neither includes live traffic. Missing coordinates show an unknown ETA and require operator confirmation. Demo fleet positions are labelled; a location-update endpoint supports actual telemetry integration.

Worsening reports can increase priority and change recommendations. Reassessment replaces the previous score; explicit reported improvement can lower the score, and rules assessments require operator review. Moondream describes uploaded images for chat; descriptions are unverified and may be inaccurate. Llama assesses report text, and any attached image or audio remains available for operator review rather than being interpreted by the triage model.

## Validation

```sh
npm run lint
npm test
npm run build
Backend/.venv/bin/python -m unittest discover -s Backend/tests -v
```

Regression coverage includes callback/location validation, unknown GPS, escalation and history, severity/age ordering, telemetry based recommendations, legacy fleet reconciliation, multi-department assignments, assignment conflicts, release on resolution, durable uploads and local model payloads. Provider tests use mocks.

## Implementation

React, Vite, Leaflet, plain CSS, FastAPI, SQLite and Ollama. Vite proxies both `/api` and `/uploads` to port 8000. For separate hosting, set `VITE_API_BASE_URL`, configure backend CORS, and route both paths to the backend. Production hosting must serve the frontend entry point for `/responder` and `/dispatch`.

The app is not connected to emergency dispatch networks or live traffic. Responders can share device GPS for a selected fleet. Authentication and role authorization remain integration work. Text and images sent to the configured Ollama server stay local with the default address; browser speech recognition and map/routing services may use network providers. Map tiles use OpenStreetMap. Do not commit environment files, the SQLite database, uploaded media or generated builds.

## Real maps and fleet-to-reporter ETA

Both dashboards show real OpenStreetMap street tiles, the reported incident pin, assigned fleet positions and OSRM road routes from each fleet to the incident. The reporter’s main ETA and responder assignment label use the current road ETA. Maps poll fleet positions every 15 seconds; the reporter response summary refreshes every two seconds. No simulated movement is generated.

On the responder dashboard, choose the correct fleet under **Fleet location**, then select **Share fleet GPS** from that fleet’s device and grant browser location permission. New GPS positions are uploaded at most once every ten seconds and recalculate routes. Stopping sharing retains the last known position and its timestamp. Until GPS is shared, existing seeded fleet coordinates remain labelled as demo positions. The reporter can add GPS to the reviewed incident address.

Set server-side `ROUTING_BASE_URL` to a compatible OSRM deployment; the default is `https://router.project-osrm.org`. Routes are cached for five minutes per exact coordinate pair and invalidated by movement; failures are cached for 30 seconds. Road ETA is route driving duration, without live traffic or mobilisation time. If routing fails, maps show positions without invented routes and fleet recommendations explicitly label approximate estimates. Unknown coordinates require a confirmed ETA.

The default public OSRM and OpenStreetMap services are suitable for local prototype validation, not a guaranteed emergency-service dependency. Configure a production routing/tile service for deployment and follow the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/). Routing sends fleet/incident coordinates to the configured server; map tiles request the displayed geographic area.
