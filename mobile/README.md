# Teevra reporter mobile app

This directory contains the React Native / Expo version of the reporter interface. It uses the existing FastAPI backend and keeps the web responder dashboard separate.

The app supports iOS and Android: report text, camera/gallery images, recorded or selected audio, callback number, GPS or a map pin, continued situation updates, AI chat, response status and a fleet-to-incident road map. Report IDs and the reporter name are saved in the device's secure storage. Reports and attachments remain on the backend.

## Run with Expo Go

1. Install Node.js supported by [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/) and Expo Go on your phone.
2. Start the existing backend from the repository root. A physical phone must be able to reach it; for a development LAN you can run:

   ```sh
   Backend/.venv/bin/python -m uvicorn Backend.main:app --host 0.0.0.0 --port 8000
   ```

   This exposes the unauthenticated prototype API to devices on that network. Use a trusted development network.
3. Install the mobile dependencies and start Expo:

   ```sh
   cd mobile
   npm ci
   npx expo start
   ```

4. Open the QR code in Expo Go. The app uses the Expo development host on port 8000 by default. If the backend is elsewhere, set `EXPO_PUBLIC_API_BASE_URL` before starting Expo, or enter its URL under **Profile → Server connection**. Example: `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:8000 npx expo start`. An Android emulator reaches the computer at `http://10.0.2.2:8000`; an iOS simulator can use `http://127.0.0.1:8000`. A physical phone's `localhost` refers to the phone itself.

Use HTTPS for deployed services. Native Android builds disallow cleartext HTTP by default; for a local development build only, set `TEEVRA_ALLOW_HTTP=1` when generating/building native code. iOS permits local networking, but a remote service should use HTTPS. Expo Go has its own native networking configuration. Location, microphone, camera, and photo access are requested when their respective controls are used. Browser and mobile operating-system permission settings may need to be updated after denial.

## Maps and builds

Maps use `react-native-maps` with OpenStreetMap tiles and the backend's OSRM fleet-to-incident routes. Fleet positions are live only while a responder shares GPS; seeded fleet positions are labelled demo. ETA excludes live traffic. Android standalone/development builds of `react-native-maps` require a configured Google Maps SDK key even with OSM tile overlays. Provide `GOOGLE_MAPS_ANDROID_API_KEY` at native build time, restrict it in Google Cloud, and follow [Expo's Maps setup](https://docs.expo.dev/versions/v58.0.0/sdk/map-view/). Expo Go supplies its own maps setup; iOS uses Apple MapKit. Public OSM and OSRM services are prototype dependencies, not guaranteed emergency infrastructure.

The project uses Expo's managed workflow. `npx expo run:ios` and `npx expo run:android` generate native projects locally when the appropriate Xcode or Android toolchain is installed. Use EAS for cloud builds if preferred. This repository does not include signed installable binaries.

## Checks

```sh
npm test
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform ios --output-dir /tmp/teevra-ios
npx expo export --platform android --output-dir /tmp/teevra-android
```

Tests cover report/update validation and API request/error handling. Bundle export and static checks do not substitute for testing permissions, map rendering, native uploads and playback on actual devices. The existing backend is a prototype without authentication or real emergency dispatch; the mobile client does not add those capabilities.
