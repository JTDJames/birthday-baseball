# Agent instructions

## Cursor Cloud specific instructions

This repo is a static site plus Node scripts (`firebase-admin`). Cloud agents should use the environment from [`.cursor/environment.json`](.cursor/environment.json) (`npm install` on startup).

- **Validate setup**: After `npm install`, `node -c` is not needed for ESM; confirm `node_modules` exists. Running `npm run seed:trivia` requires `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service account JSON with Firestore write access (see `scripts/seed-trivia.mjs`).
- **Firebase / secrets**: Do not commit service account JSON files. For Cloud Agents, add required env vars and paths via [Cursor Cloud Agent secrets](https://cursor.com/dashboard/cloud-agents) (and complete [onboarding](https://cursor.com/onboard) for this repository). Local dev may use ignored `*firebase-adminsdk*.json` files per `.gitignore`.
- **Testing**: There is no `npm test` script. Prefer manual verification of changed HTML/JS in a browser or describe what to check.

## One-time setup (account and phone)

Complete these in the Cursor dashboard (cannot be automated in-repo):

1. **Plan and usage**: Confirm your subscription allows Cloud Agents and enable [on-demand usage](https://cursor.com/docs/account/teams/pricing.md#on-demand-usage) if prompted. Settings: [cursor.com dashboard](https://www.cursor.com/dashboard/settings).
2. **Git access**: Connect GitHub and grant this repo under [Integrations](https://cursor.com/dashboard/integrations).
3. **Cloud environment**: Run [cursor.com/onboard](https://cursor.com/onboard), select `JTDJames/birthday-baseball`, add secrets, then save a VM snapshot when installs succeed.
4. **Phone**: Open [cursor.com/agents](https://cursor.com/agents), sign in. Optional PWA: iOS Safari → Share → **Add to Home Screen**; Android Chrome → **Install App**.
