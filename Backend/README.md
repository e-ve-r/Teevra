# Teevra chat API

Python 3.11+ and an OpenRouter account are required. This backend calls hosted models through [OpenRouter's chat completion API](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request); no model weights or GPU are needed locally.

## Setup

Run from the repository root:

```sh
python3 -m venv Backend/.venv
Backend/.venv/bin/python -m pip install -r Backend/requirements.txt
cp Backend/.env.example Backend/.env
```

Edit `Backend/.env` and set `OPENROUTER_API_KEY` to a key from [OpenRouter settings](https://openrouter.ai/settings/keys). Keep it server-side; never put it in a `VITE_` variable or commit it. The environment file is ignored by Git. The app resolves this file relative to the backend directory regardless of your working directory.

`OPENROUTER_MODEL` defaults to `google/gemma-4-31b-it` ([Google Gemma 4 31B](https://openrouter.ai/google/gemma-4-31b-it)). To use a different model, copy its model ID from the [OpenRouter model catalog](https://openrouter.ai/models). Availability, rate limits, account access, and pricing depend on the model/provider. Restart the backend after configuration changes.

## Run

From the repository root, in one terminal:

```sh
Backend/.venv/bin/python -m uvicorn Backend.main:app --reload --reload-dir Backend --reload-exclude '**/.venv/**' --host 127.0.0.1 --port 8000
```

In another terminal:

```sh
npm run dev
```

Open the frontend URL printed by Vite. Vite proxies `/api` to port 8000. API docs are at <http://127.0.0.1:8000/docs>.

## Endpoints

- `GET /api/health`: process health and whether a token is configured. This does not verify provider connectivity or token validity.
- `POST /api/chat`: accepts `messages` and optional `context`, returns `{"reply":"..."}`. Only user and assistant roles are accepted; the system prompt and model are controlled by the server.

```sh
curl http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"How do I add a photo?"}]}'
```

The API accepts up to 20 messages, 2,000 characters per message, and 16,000 characters total. The UI sends the last eight messages and clips each to 2,000 characters. History remains in browser memory; the server does not persist conversations. Provider timeouts, rate limits, missing credentials, and invalid replies produce explicit errors with a retry option in the UI. There is no preset-response fallback.

Only tracking state, simulated seconds remaining, report presence, and attachment count are automatically shared as context. Photos, audio, report descriptions, and reporter names are not sent to the model. Chat text itself goes to OpenRouter and its provider; their processing policies apply.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | empty | Server-side OpenRouter API key; chat returns 503 until set. |
| `OPENROUTER_MODEL` | `google/gemma-4-31b-it` | OpenRouter chat model ID. |
| `OPENROUTER_TIMEOUT_SECONDS` | `45` | Provider timeout, up to 120 seconds. UI requests time out after 60 seconds. |
| `OPENROUTER_MAX_TOKENS` | `512` | Maximum generated tokens, up to 2,048. |
| `CORS_ORIGINS` | localhost/127.0.0.1 port 5173 | Comma-separated allowed frontend origins. |

For a separately hosted frontend, set `VITE_API_BASE_URL` using the root `.env.example` and add the frontend origin to `CORS_ORIGINS`. Vite's proxy applies only during development. In production, route `/api` to FastAPI through your reverse proxy or set the API base URL at build time.

This is a local development API. Before exposing it publicly, add authentication and rate limiting at the API gateway to control access to paid inference. CORS is not authentication. The API does not dispatch responders or implement incident storage, uploads, speech transcription, image analysis, or live tracking.

## First-aid response guidance

The system prompt asks the model to provide brief, practical steps while waiting for professional help, prioritize emergency calls and dispatcher instructions, ask focused follow-up questions, and distinguish simulated tracking from real dispatch. It includes basic bleeding and adult CPR guidance, with separate cautions for children and infants. It prohibits diagnoses, medication recommendations, and invented treatments. Model output remains generative; these instructions do not establish clinical reliability or replace trained responders.

Reference material: [Red Cross first-aid steps](https://www.redcross.org/take-a-class/first-aid/performing-first-aid/first-aid-steps), [AHA/Red Cross first-aid guidelines](https://cpr.heart.org/en/resuscitation-science/2024-first-aid-guidelines), and [St John Ambulance CPR guidance](https://www.sja.org.uk/first-aid-advice/cpr/).

## Tests

From the repository root:

```sh
Backend/.venv/bin/python -m unittest discover -s Backend/tests -v
```

Tests mock provider HTTP requests. They check request forwarding, input validation, missing credentials, provider errors, timeouts, malformed replies, and CORS without consuming inference credits.
