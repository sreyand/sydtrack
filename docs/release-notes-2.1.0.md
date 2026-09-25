# sydtrack v2.1.0

SydTrack now starts with Windows by default and lets you choose how quickly it notices app switches.

## New

- **Open at login** is enabled by default on supported desktop builds and can be turned off in Settings.
- Login launches open quietly in the tray instead of interrupting your desktop.
- Added three live polling modes under Settings:
  - **Low** — checks every 5 seconds for lower processor use.
  - **Med** — checks every 3 seconds and is the new default.
  - **Max** — checks every second for the fastest app-switch detection.
- Polling changes apply immediately without restarting SydTrack. Live tracked-time and session timers still advance once per second in every mode.

## Performance

- Replaced the previous 750 ms foreground polling default with the more efficient 3-second Med mode.
- Existing installs using the old default migrate to Med automatically; intentional Low or Max choices are preserved.
- Added measured minimum and recommended system requirements to the README.

## Reliability

- A duplicate hidden startup launch no longer surfaces an already-running SydTrack window.
- Startup registration supports installed and portable Windows builds and macOS login items; unsupported Linux builds hide the setting.
- Corrected cross-platform security checks so macOS and Ubuntu CI validate platform-appropriate application identity behavior.
- Resetting the bundled Focus profiles now keeps General active instead of unexpectedly switching to Coding.
- Removed unused demo media and wordmark assets from packaged builds, reducing each Windows download by about 7 MB.

## Upgrade note

Quit SydTrack from the tray before installing v2.1.0. Existing activity, profiles, sessions, and settings are preserved.

**Full changelog:** `v2.0.1...v2.1.0`
