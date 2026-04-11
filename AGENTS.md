# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Static birthday party event website (San Francisco Giants baseball theme). No build step, no bundler, no backend server — the frontend is vanilla HTML/CSS/JS with Firebase (Firestore, Auth, Storage) as the cloud backend.

### Running the dev server

Serve the repo root with any static HTTP server. Example:

```sh
npx serve -l 3000 /workspace
```

All pages (`index.html`, `host-alerts.html`, `photo-moderation.html`, `photo-submit.html`) load from the root.

### Key notes

- **No lint or test scripts** are defined in `package.json`. The only npm script is `seed:trivia` (seeds Firestore via `firebase-admin`).
- **No build step** — files are served as-is. JS uses ES modules loaded from CDN (`firebase`, `matter-js`).
- **Firebase config** is public (checked into `firebase-config.js`). The Firebase project is `giants-trivia`.
- The `firebase-admin` dependency (the only npm dep) is only used by `scripts/seed-trivia.mjs` and requires a service account key to run — it is not needed for the dev server.
- The PowerShell `.ps1` scripts are Windows-only automation tooling for iterating on the pinball mini-game; they are not relevant for Cloud Agent workflows.
