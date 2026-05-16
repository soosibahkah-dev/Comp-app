# Companion app build-ready package

This folder contains the React Native / Expo source for the companion app.

## What changed
- Updated the Gemini model reference from `gemini-1.5-flash` to `gemini-2.5-flash`.
- Kept the app architecture the same: chat, local storage, notifications, and background fetch.

## Notes
- This is source code, not a signed APK.
- To create an APK, it must be built with EAS Build (cloud build).
- Expo Go will not fully support background fetch the same way a standalone build does.

## Files
- `App.js`
- `package.json`
- `app.json`
- `eas.json`
- `babel.config.js`

## Build target
Android APK via EAS Build.
