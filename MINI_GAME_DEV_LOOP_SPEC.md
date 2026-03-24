# Mini Game Dev Improvement Loop Spec

## Goal
Run repeated improvement cycles where `Mini Game Dev` applies exactly two scoped upgrades per pass, then immediately starts the next pass with a fixed follow-up instruction.

## Fixed Follow-Up Prompt
Use this exact text after each successful pass:

`Run another review pass using looking up both classic baseball pinball games and well reviewed digital baseball minigames. Make the next 2 improvements`

## Loop Inputs
- **Target agent:** `Mini Game Dev`
- **Max cycles:** default `8`
- **Stop when no meaningful changes:** default `true`
- **Manual approval each cycle:** default `true`
- **Optional quality gate command:** e.g. `npm test` or a custom check

## Cycle Algorithm
1. Capture baseline working tree fingerprint (unstaged diff + staged diff + untracked file hashes).
2. Send kickoff prompt to `Mini Game Dev` for cycle 1.
3. For cycles 2+, send the fixed follow-up prompt.
4. Wait until the agent finishes.
5. Compare current working tree fingerprint to baseline.
6. If no file changes: stop (`no meaningful changes`).
7. If quality gate is configured, run it; if it fails, stop and review.
8. Record cycle summary:
   - files changed
   - insertions/deletions
   - short note of what improved
9. If max cycles reached: stop.
10. Otherwise start next cycle with the same fixed follow-up prompt.

## Recommended Stop Conditions
- No changed files vs baseline
- Repeated tiny churn only (for example, <= 3 lines changed in 2 consecutive cycles)
- Quality gate failure
- Max cycle limit reached
- Manual stop

## Safety Constraints
- Do not auto-commit unless explicitly requested.
- Never run destructive git commands.
- Keep each cycle scoped to exactly two improvements.

## Suggested Usage
Use the included script `run-mini-game-dev-loop.ps1` for a practical human-in-the-loop controller that:
- prepares/copies the fixed prompt each cycle
- tracks whether each cycle produced changes
- optionally runs a validation command
- stops automatically based on configured rules
