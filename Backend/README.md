# Teevra incident and response API

Python 3.11+, FastAPI and SQLite back the reporter and responder dashboards. OpenRouter supplies the configured AI model; no local model weights are required.

## Setup

From the repository root:

```sh
python3 -m venv Backend/.venv
Backend/.venv/bin/python -m pip install -r Backend/requirements.txt
```

Create `Backend/.env` with your server-side configuration:

```dotenv
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=google/gemma-4-31b-it
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

The model ID is configurable and must be available to your provider account. Never expose the key in a `VITE_` variable. With no key or a failing triage provider, reports use a labelled rules assessment and require operator review. Chat returns an explicit error instead of a preset reply.

```sh
Backend/.venv/bin/python -m uvicorn Backend.main:app --reload --reload-dir Backend --reload-exclude '**/.venv/**' --host 127.0.0.1 --port 8000
```

Then run `npm run dev` in another terminal. Open `/` for reporters and `/responder` for dispatch. Vite proxies `/api` and `/uploads`. API documentation is at `http://127.0.0.1:8000/docs`.

## Incident operations

| Endpoint | Purpose |
| --- | --- |
| `POST /api/incidents` | Create a report with callback number, address, optional GPS coordinates/accuracy, text and uploaded attachment references. Run initial triage. |
| `GET /api/incidents` | List incidents in priority/severity/age order; supports status, priority, category and search filters. |
| `GET /api/incidents/{id}` | Read saved incident, assessment, updates, attachments, fleet assignments and status. |
| `POST /api/incidents/{id}/updates` | Persist new text/media and optional updated incident coordinates, then assess the full timestamped history. |
| `POST /api/incidents/{id}/triage` | Reassess the incident with all situation updates and media. |
| `GET /api/incidents/{id}/recommendations` | Suggest every relevant department and its available fleets, ordered by estimated arrival and distance. |
| `POST /api/incidents/{id}/dispatch` | Assign an available fleet. Multiple units/departments may serve one incident. |
| `PATCH /api/incidents/{id}/status` | Advance assigned → en route → on scene → resolved, or cancel. Release all assigned fleets on closure. |
| `GET /api/responders` | Read fleet readiness and stored coordinates. |
| `PATCH /api/responders/{id}/location` | Supply `lat`, `lng` and `current_location`; mark coordinates as telemetry with a server timestamp. |
| `PATCH /api/responders/{id}/status?status=Available` | Change unassigned fleet readiness to Available or Off Duty. |
| `GET /api/department/stats` | Active incidents, priority counts and fleet availability. |
| `POST /api/upload` | Upload image/audio files up to 20 MB each; return a durable `/uploads/...` reference. |
| `POST /api/chat` | Generate guidance from bounded user/assistant message history. |
| `GET /api/health` | Process/configuration and department status; not a provider connectivity check. |

## Evaluation and updates

Text and supported local uploaded media use [OpenRouter multimodal chat content](https://openrouter.ai/docs/guides/overview/multimodal/overview). Images use data URLs and audio uses base64 `input_audio`; model and provider support for audio formats varies. Up to the latest six attachments and 24 MB of source bytes are included per evaluation. Skipped/unsupported attachments require operator review. Original uploads remain accessible to the responder. External attachment URLs are not fetched by the model bridge.

Updates are stored before inference and serialize per incident within the API process, so a later update cannot be overwritten by an earlier assessment. Reassessment includes the original report and every timestamped update. The response indicates when a newer update is awaiting assessment. Fresh assessments replace the previous score and priority. Explicit reported improvement can lower the fallback score, with operator review required; escalation updates priority, classification, queue order and department recommendations. Provider failure uses a labelled rules fallback with zero model confidence rather than claiming an AI result.

The queue score uses priority bands (P1=200, P2=100, P3=0), severity × 0.7, and capped waiting time × 0.25 (maximum 120 minutes), followed by original report time. Fleet ETAs use stored coordinates, a 1.3 distance multiplier, 30 km/h and two minutes of mobilisation. They are estimates without live traffic; demo coordinates are labelled and unknown coordinates produce no ETA.

SQLite additive migrations preserve existing records, reconcile legacy dispatches with fleet readiness, and store continuing updates and multiple assignments. Runtime files are `Backend/teevra.db` and the repository's `uploads/` directory; both are ignored by Git. The existing demo data is retained.

## Tests

```sh
Backend/.venv/bin/python -m unittest discover -s Backend/tests -v
```

Tests use isolated temporary databases and mock inference; they do not consume provider credits. The frontend checks are `npm run lint` and `npm run build`.

## Integration boundaries

This remains a prototype. UI separation does not enforce role authorization. Before public use, integrate authentication and incident ownership checks, responder roles, authenticated fleet telemetry and real dispatch services. Multi-worker deployment needs cross-process coordination for serial assessment. Serve frontend deep links through an SPA fallback and proxy `/api` and `/uploads` in production. GPS and microphone permission require a secure browser context. Mobile numbers are entered by the reporter because web browsers cannot read the device's phone number.
