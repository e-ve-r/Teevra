# Teevra

**A mobile-first emergency reporting frontend.**

Teevra gives the person reporting an emergency a simple place to share photos, describe an incident, record a voice note, and follow the arrival of help. The interface uses blue and red, large headings, and a persistent bottom navigation bar with a central Report button.

The broader project aims to support AI-assisted emergency triage and response coordination, with a human operator approving dispatch decisions. This repository currently contains the reporter frontend demo.

> **Demo status:** No real emergency service is contacted. Map locations, response assignments, distances, and ETAs are simulated. The chatbot uses preset responses.

## Features

| Screen | Current functionality |
| --- | --- |
| Home | A prominent emergency-report action and shortcuts to tracking and chat. |
| Report | Camera/gallery image selection, a description of up to 500 characters, local microphone recording, and audio-file uploads. Attachments can be previewed and removed. |
| Live tracking | A six-minute simulated response, moving ambulance marker, countdown, distance, arrival status, and map zoom/recenter controls. A compact ETA also appears in the bottom navigation. |
| AI chat | A working conversation interface with local preset replies about reporting and demo tracking. |
| Profile | An editable demo name and a summary of the latest report submitted in the current session. |

A report requires a description or at least one attachment. Each file must be smaller than 20 MB. Submitting a report opens tracking and restarts the simulated response.

## Tech stack

- React 19 for the interface and session state.
- Vite 8 for development and production builds.
- Plain CSS for responsive layouts and styling.
- Browser `MediaRecorder` and File APIs for local audio and attachments.
- Inline SVG for icons and the illustrative map.
- ESLint for code checks.

## Getting started

### Requirements

- Node.js 20.19+ or 22.12+ and npm. A supported current Node.js LTS release is recommended.
- A browser with microphone support for voice reporting.

### Install and run

```sh
git clone https://github.com/e-ve-r/Teevra.git
cd Teevra
npm ci
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

No API keys, database, or environment variables are required for the current demo. Microphone recording requires permission and a supported browser running on localhost or HTTPS. On supported mobile devices, Open camera opens the native camera picker. Other devices may show a file picker.

### Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server. |
| `npm run build` | Create the production build in `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run lint` | Run ESLint. |

## Project structure

```text
Teevra/
├── public/                    # Static assets and favicon
├── src/
│   ├── components/
│   │   ├── Assistant.jsx      # Chat UI and preset demo replies
│   │   ├── Attachments.jsx    # Report form, file uploads, voice recording
│   │   ├── Icon.jsx           # Shared SVG icons
│   │   └── LiveMap.jsx        # Illustrative map and moving vehicle
│   ├── App.jsx                # Screens, navigation, report state, ETA timer
│   ├── App.css                # Component styles and responsive layouts
│   ├── index.css              # Global styles and design tokens
│   └── main.jsx               # React entry point
├── index.html
├── vite.config.js
├── eslint.config.js
├── package.json
└── package-lock.json
```

## Data and demo limitations

- Reports, attachments, profile changes, and chat messages live in browser memory and reset on refresh.
- Files are previewed with local object URLs. There is no upload endpoint or persistent storage.
- Voice reporting records audio locally. Speech-to-text is not connected.
- The destination and ambulance route are illustrative. The app does not obtain GPS coordinates or use a live map provider.
- The assistant makes no external AI requests and does not provide emergency or medical guidance.
- Authentication, real notifications, dispatch, and responder communication are not implemented.
- The stylesheet requests Google Fonts, with system fonts as fallbacks.

For an actual emergency, contact your local emergency service directly.

## Planned integrations

The project presentation describes the following future work. These capabilities are not implemented in this frontend:

- A FastAPI backend for incident intake, users, dispatch, and monitoring.
- Speech-to-text, image analysis, and AI-assisted incident and severity assessment.
- Resource recommendations and responder ranking by traffic-aware ETA.
- An operator dashboard for reviewing recommendations and approving dispatch.
- Live GPS and mapping, with WebSocket updates for response progress.
- PostgreSQL for persistent records and Redis for live state and ETA caching.
- Monitoring of response delays, with escalation recommendations for operator review.

## Development notes

Keep generated builds, dependencies, environment files, credentials, and local uploaded media out of Git. The included `.gitignore` covers these files. Commit `package-lock.json` so contributors can install the same dependency versions with `npm ci`.

The current Vite configuration includes a development tunnel hostname in `server.allowedHosts`. Adjust that entry if you use a different tunnel. This setting is only for the development server.
