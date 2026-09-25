# 08 · Stations, Windows agent & Live Floor (Phase 3)

## Parts

| Part | Where | What it does |
|---|---|---|
| **ArenaAgent** (.NET 8 Windows service) | `clients/windows/src/Arena.Agent` | Runs on each gaming PC as LocalSystem. Connects to the branch, reports health and hardware, and executes **verified** commands. |
| **Agent core** (platform-neutral, unit-tested) | `clients/windows/src/Arena.Agent.Core` | Protocol, command verification, replay store, device sign-in assertion |
| **Device gateway** | `apps/api/src/devices/*` | WebSocket endpoint `/v1/device/ws`, enrolment, commands, alerts, Live Floor stream |
| **Live Floor & Computers** | `apps/admin/src/app/(app)/floor`, `/computers` | Station map, control drawer, mass actions, layout editor, enrolment codes |
| **Simulator** | `apps/api/scripts/sim-agent.ts` | The same protocol in Node, used by the tests and demos (`npm run sim`) |

## Adding a PC (enrolment)

1. **Admin → Computers → Add stations.** Choose the zone and how many PCs one code may add (1–500), and how long it's valid (1–72 h). You get a code like `ARENA-XXXXX-XXXXX-XXXXX-XXXXX`. It's shown once; only its hash is stored.
2. **On the PC, as Administrator:**
   ```
   ArenaAgent.exe enroll --api https://api.yourvenue.com --code ARENA-… --safe-mode off
   .\install-agent.ps1
   ```
   - The PC generates its **own ECDSA P-256 key** and sends only the public half. The private key is DPAPI-encrypted to this machine, and the file is readable only by SYSTEM and Administrators.
   - The server returns the station's identity and the branch **command-signing public key**, which the agent pins.
   - Names are automatic: `PC-01`, `VIP-03`, `CON-02`, and so on.
   - Reinstalling Windows on the same PC (same MAC address) re-enrols the **same** station, keeping its history.
   - Plan limits apply: `MAX_DEVICES` → 402.
3. The service starts automatically, restarts if it fails, and the PC appears on the Live Floor within seconds.

**Safe mode** (the default for `enroll` unless you pass `--safe-mode off`):
- Restart, shutdown, logout, lock and app launch/close are **simulated**.
- Messages and Wake-on-LAN are real.
- It's for trying the agent on an office PC. Switch it off with `ArenaAgent safe-mode off`.

**Dev run without installing:** `ArenaAgent.exe run --data-dir <folder>`.

## Security model

| Threat | Defence |
|---|---|
| Someone forges "unlock / free time" commands | Every command is **signed** with the branch key (ES256). The PC only has the public key, so a compromised PC can verify but never forge. |
| Tampering in transit (e.g. editing the expiry) | The signature covers the **exact bytes**; the agent verifies before parsing. |
| Replay of an old command | A single-use `commandId` is persisted across reboots, and there's a short expiry (1–5 min). |
| A command meant for another PC or tenant | The org, branch and device ids bound at enrolment must match. |
| A stolen PC identity | Connecting requires a fresh **proof-of-possession** JWT (ES256, ≤ 2 min, single-use `jti`) signed by the DPAPI-protected device key. |
| Cloud compromise → remote code execution | Remote launch refuses interpreters and "living off the land" binaries (cmd, powershell, mshta, rundll32…), and requires an absolute path that exists. |
| Retired or stolen PC | **Retire** revokes the credential and disconnects it immediately; reconnecting gets 401. |
| Wrong staff member | Each command type has its own permission, checked against the station's branch (e.g. a cashier can lock but not restart). |

All of this is covered by tests. The Node end-to-end tests use the simulator. The .NET tests verify fixtures **signed by the real server code**, which CI regenerates on every run.

## Commands in this phase

| Command | Permission | Agent action |
|---|---|---|
| SEND_MESSAGE | station.message | Message box on the user's screen (`WTSSendMessage`) |
| LOCK | station.lock | Lock the Windows session (runs in the user's session) |
| RESTART / SHUTDOWN | station.restart / station.shutdown | `shutdown.exe` with a 5-second notice |
| LOGOUT | station.restart | `WTSLogoffSession` |
| WAKE_ON_LAN | station.shutdown | The server picks **another online PC on the same LAN** to broadcast the magic packet (the cloud can't reach a sleeping PC) |
| LAUNCH_APP / CLOSE_GAME | station.launch_app | Start on the user's desktop / close by process name (system processes protected) |
| REFRESH_CONFIG | station.manage | Reload settings |
| *Zone mass action* | station.mass_action + the command's own permission | "Message zone", "Restart zone" |

- **Delivery:** commands to an offline PC wait (PENDING) and are delivered when it reconnects, unless they've expired.
- **Status updates:** `PENDING → SENT → RECEIVED → EXECUTING → SUCCEEDED / FAILED / EXPIRED`, streamed live to the drawer.
- **Coming with the Gaming Shell (phase 4):** UNLOCK, session start/end/extend, maintenance mode, repair tools and screenshots.

## Health monitoring

Heartbeats arrive every 10 seconds and carry:
- CPU, GPU, RAM and system-disk usage;
- GPU temperature and load (via `nvidia-smi` on NVIDIA cards);
- CPU temperature (ACPI, where the board exposes it);
- ping to the router, and uptime.

Alerts are evaluated on **every** heartbeat, in memory. The database is touched only when an alert opens, changes or resolves.

| Alert | Rule |
|---|---|
| HIGH_CPU_TEMP | ≥ 90 °C warning, ≥ 97 °C critical (clears 5 °C below) |
| HIGH_GPU_TEMP | ≥ 88 °C warning, ≥ 95 °C critical |
| LOW_DISK | system disk ≥ 92 % |
| HARDWARE_CHANGED | CPU, GPU, RAM, board, disk serials or network cards differ from the stored inventory |
| CLIENT_OFFLINE | disconnected for more than 2 minutes (auto-resolves on reconnect) |

Heartbeats are stored every 30 seconds (time-series, for reports later). Live values are streamed only.

## Live Floor

- **Status colours** follow the brief:
  - 🟢 Available
  - 🔴 In use
  - 🟡 Reserved
  - 🟠 Ending soon
  - ⚫ Offline
  - 🔧 Maintenance
  - Cleaning and Starting
- **Live updates** use Server-Sent Events relayed through the admin's server, so tokens never reach the browser. A reconnect re-syncs the full snapshot.
- **The station drawer** shows actions, alerts, live meters, network, hardware and recent commands.
- **Edit layout:** drag stations to match the room, then save (audited).

## Try it without PCs

1. Admin → Computers → **Add stations** (e.g. 10 PCs).
2. Run:
   ```bash
   npm run sim -w @arena/api -- --code ARENA-… --count 10
   ```
3. Open the **Live Floor**. The virtual PCs report metrics and obey (and verify) commands.

## Operational notes and next steps

- **Scaling out:** the device registry, live bus and assertion-replay cache are in-memory, which is right for one API node or branch edge server. Several nodes need Redis for these (Phase 13).
- **Signing-key rotation:** retiring keys stay verifiable, and at most one ACTIVE key per branch is enforced by the database. Re-pinning on the agent is on the roadmap.
- **CPU temperature** isn't exposed on many consumer boards. An optional vendor-sensor integration can come later.
