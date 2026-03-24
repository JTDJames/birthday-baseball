# Full Automation Setup (Mini Game Dev)

This setup sends prompts to `Mini Game Dev` automatically, waits for repo changes, and runs the next cycle without manual Enter presses.

## 1) Create your UI config
Copy `mini-game-dev-ui-config.example.json` to `mini-game-dev-ui-config.json`.

Example:

```powershell
Copy-Item .\mini-game-dev-ui-config.example.json .\mini-game-dev-ui-config.json
```

Edit `mini-game-dev-ui-config.json` with your actual screen coordinates:
- `agentListX`, `agentListY`: a click point on the `Mini Game Dev` entry in the left agent list
- `chatInputX`, `chatInputY`: a click point inside the message input box for that agent

Tip: in PowerShell, run `[System.Windows.Forms.Cursor]::Position` (after `Add-Type -AssemblyName System.Windows.Forms`) to read mouse coordinates.

## 2) Keep Cursor layout stable
- Keep Cursor on the same monitor/resolution/zoom
- Keep the `Mini Game Dev` agent visible in the left panel
- Keep the chat input area visible
- Do not move/resize Cursor while automation runs

## 3) Run automation
If script policy blocks execution:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

Then run:

```powershell
.\mini-game-dev-full-automation.ps1
```

Optional tuning:

```powershell
.\mini-game-dev-full-automation.ps1 -MaxCycles 8 -CycleTimeoutSeconds 1200 -StableSeconds 20 -PollSeconds 3
```

## 4) What it does
- Cycle 1 sends kickoff prompt
- Cycle 2+ sends fixed follow-up prompt
- After each send, it polls git content fingerprint for changes
- When changes are detected and stable, it starts the next cycle
- Stops on timeout

## Notes
- This is UI automation and depends on screen coordinates.
- If it clicks wrong places, adjust coordinates in `mini-game-dev-ui-config.json`.
