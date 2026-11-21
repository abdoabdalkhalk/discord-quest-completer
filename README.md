Environment variables (all optional):

- `SOLVE_MAX_SECONDS` default 270, must stay below the `maxDuration` of `api/solve.js` in `vercel.json`
- `SOLVE_HEARTBEAT_INTERVAL_MS` default 20000
- `SOLVE_GATEWAY_SETTLE_MS` default 2000
- `GATEWAY_CAPABILITIES` integer, omitted from IDENTIFY when unset

Super Properties must come from the Discord desktop app (`browser` field must be `"Discord Client"`). Browser SP values are rejected by both `/api/connect` and `/api/solve`.

Quests whose task is `ACHIEVEMENT_IN_ACTIVITY` are displayed in the UI but marked as `Not supported` and cannot be selected or run.

## Enabling DevTools (required before extracting Token + SP)

The UI modal shows a single PowerShell line that fetches the setup script
from this deployment and runs it in one shot:

    powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr https://www.quests.zorohex.com/static/enable-devtools.ps1 -UseBasicParsing | iex"

The script is served at `/static/enable-devtools.ps1`. It targets **Stable**
(`%AppData%\Discord\settings.json`). For Canary / PTB, download the script
from `/static/enable-devtools.ps1`, edit the first line, and run it locally.