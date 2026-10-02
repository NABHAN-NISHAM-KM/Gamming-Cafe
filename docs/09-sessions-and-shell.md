# 09 · Gaming sessions, pricing & the Gaming Shell (Phase 4)

## The rule everything follows

**The server owns the clock.** A session's `expiresAt` is set by the API and
changed only by the API (extend / move / end). The PC is told through signed
commands (`START_SESSION`, `EXTEND_SESSION`, `END_SESSION`). The PC shows the
countdown and locks when told to. It also locks by itself as a fail-safe if the
server goes quiet. Nothing on the PC can grant time.

```
Cashier (admin)  ──POST /devices/:id/sessions──►  API ──signed START_SESSION──►  Agent ──pipe──► Shell unlocks
Customer (Shell) ──login──► Agent ──shell_login (WS)──► API ─┘
                                                     │
                     SessionTimerService (every 2 s) ├─ warnings 30/15/10/5/1 min
                                                     ├─ station "Ending soon" at ≤ 5 min
                                                     └─ expiry → bill final → signed END_SESSION → PC locks
```

## Pricing engine (`apps/api/src/sessions/pricing.ts`)

A pure module with no database access. It is unit-tested in `test/pricing.test.ts` (17 tests).

- **Money:** integer minor units throughout (fils, cents); formatted only at the edge.
- **Plan selection:** zone > branch > organization. The plan must match the
  station class, the membership tier, and the day/time window in the **branch's
  timezone**. Ties go to higher priority, then the cheaper plan.
- **Request kinds:**
  - `minutes`: per-minute or per-hour rate with a minimum charge and rounding.
  - `package`: fixed price and duration, plus bonus minutes.
  - `pass`: e.g. the Night pass 00:00–06:00, which ends at the window's end.
  - `open`: postpaid ("pay at the end"), with a grace period and rounding.
- **Discounts:** membership % and an optional staff discount. A staff discount
  needs `pos.discount`.
- **Quotes are snapshotted** onto the session (`rateSnapshot`). Later rate edits
  never change a running session's price.

## Sessions (`sessions.service.ts`)

| Action | What is written (one transaction) |
|---|---|
| Start | GamingSession, Bill + Order + OrderItem (`SYS-GAMING-TIME`), Payment (CASH/CARD) or a TIME_BALANCE ledger debit, station → IN_USE, audit, signed START_SESSION (sent after commit) |
| Extend | SessionExtension + charge/payment, new `expiresAt`, signed EXTEND_SESSION |
| Move | Old PC gets END (lock), new PC gets START with the **same** end time |
| End / expire | Billing finalised (postpaid charge; unused prepaid minutes refunded to the balance), bill settled, station → AVAILABLE/CLEANING, signed END_SESSION |

- **Idempotency:** start, extend and time sales take an `Idempotency-Key`. A
  retry returns the first result and charges once.
- **Integrity:** the database refuses two live sessions on one PC (an EXCLUDE constraint).

### Automatic expiry (`session-timer.service.ts`)

- **Sweep:** every `SESSION_SWEEP_MS` (default 2 s) the service reads
  `app.session_timers()`. This is a SECURITY DEFINER function that lists live
  timers across tenants. Each session is then handled inside **its own tenant's
  transaction**.
- **Survives an API restart:** the first sweep after boot closes anything that
  expired while the API was down.
- **Reconnect resync:** when a PC connects, its `hello.activeSessionId` is compared with
  the server's view. A stale session gets END; a lost one gets START again.

## Customer login at the PC (`shell-auth.service.ts`)

- **Channel:** the request travels over the agent's authenticated WebSocket, so the
  device, organization and branch are already proven.
- **Customer check:** the customer proves who they are with a username, email or
  phone, plus a password or PIN.
- **Throttles:** 8 attempts per minute per PC, and 10 per 15 minutes per account.
  An unknown user gets a constant-time "burn" verify, so timing doesn't reveal
  which accounts exist.
- **Refusals:** `station_in_use`, `already_playing` (logged in on another PC),
  `no_time`, `account_blocked`, and `duplicate_request` (a replayed requestId).
- **On success:** a TIME_BALANCE session is started for the whole balance. Logout
  refunds the unused minutes.
- **By phone:** the sign-in screen also shows a QR code. The Shell asks for a
  one-time code (`qr_login` → `qr_login_code`, 3 minutes, single use); the player
  scans it with the customer app, confirms, and the same session starts as
  if they had typed their password. See
  [11 · Signing in at a PC with the phone](11-customers-wallet-bookings.md#signing-in-at-a-pc-with-the-phone).

## The Gaming Shell

Three pieces, each trusting the next one less:

| Piece | Runs as | Role |
|---|---|---|
| `ArenaAgent.exe` (service) | LocalSystem | Holds the device key, verifies commands, owns `SessionManager`, serves `\\.\pipe\ArenaOS.Shell` |
| `ArenaShell.exe` (WPF + WebView2) | the desktop user | Full-screen window; relays messages between page and pipe |
| `apps/shell` (React, built into `wwwroot`) | inside WebView2 | Lock screen, sign-in, countdown, warnings, menus |

### Agent (`clients/windows/src/Arena.Agent`)

- **`SessionManager`:**
  - Applies verified START/EXTEND/END commands.
  - Persists them to `session.json`, so a reboot never unlocks the PC.
  - Learns the server clock offset from `welcome` and from each command.
  - `SessionWatchdog` ticks every second. It locks locally at expiry + 20 s if
    the server's END never came (for example, the network is down).
- **`ShellHub`:** the named-pipe server.
  - Created with `FirstPipeInstance`, so no user process can take the name first.
  - Access: SYSTEM and Administrators get full control; the interactive user can
    read and write only.
  - It accepts **only** `ready`, `login` and `logout`. Input is validated
    (`ShellProtocol.Parse`), lines are capped at 8 KB, and logins are rate-limited
    locally.
  - The Shell can never tell the agent what the session is.
- **Relay:**
  - Shell login becomes `shell_login` over the WebSocket. The reply (`shell_result`)
    is passed back as `login_result`.
  - **The unlock itself only ever comes from the signed START_SESSION.**
  - Logout while offline is refused politely, because the server owns billing.
- **`SEND_MESSAGE`:** shown inside the Shell when it is running; otherwise a
  Windows message box is used.
- **Post-session action:**
  - `LOCK` and `RESTART_SHELL` return to the lock screen.
  - `LOGOUT_WINDOWS`, `RESTART_PC`, `SHUTDOWN_PC` and `RESTORE_REBOOT` run 10 s
    after the end (simulated in safe mode), unless a new session has started.
- **Heartbeat:** reports `shellState` as `NO_SHELL`, `LOCKED` or `IN_SESSION`.

### Host (`clients/windows/src/Arena.Shell`)

- **Content:** the page is served from local files under `https://shell.arena/`.
  Any other navigation, pop-ups, downloads and permission prompts are denied.
  The page's CSP is `connect-src 'none'`, so it has no network access.
- **Pipe check:** before trusting the pipe, the host checks that the server
  process is in **Session 0** (a Windows service), so a fake pipe can't feed it
  "session running".
  - `--dev` skips this check, so the agent can run in a console.
- **Modes:**
  - `--kiosk`: full screen, topmost, and Alt+F4 is ignored.
  - `--dev`: a normal window with DevTools.
  - Deeper lockdown is Phase 13: an Explorer replacement, key filtering, and a staff exit.

### Autostart (`ShellSupervisor`)

The agent service keeps the Shell running on the customer's desktop. Every
3 s it looks at the console session and, when the rules in
`ShellAutostartPolicy` (Agent.Core, unit-tested) allow, starts
`ArenaShell.exe --kiosk` in that session with `CreateProcessAsUser`.
- **Where:** `%ProgramFiles%\ArenaOS\Shell\ArenaShell.exe` (next to the agent,
  installed by `install-agent.ps1`), or `ARENA_SHELL_EXE`.
- **Who:** standard Windows users only. Administrators (UAC limited/full
  tokens, or members of Administrators with UAC off) get the normal desktop,
  so staff can do maintenance.
- **When not:** safe mode, the Shell isn't installed, or the agent is running in
  a console (`run`), where it isn't SYSTEM.
- **Killed or crashed:** it's back on the next tick. 5 launches within 2
  minutes → autostart pauses for 5 minutes and an error is logged, instead of
  spinning.
- Replaces the earlier manual logon task; the installer removes an old
  `ArenaShell` scheduled task if it finds one.

### UI (`apps/shell`)

- **Lock screen:** venue, clock, station name, sign-in, EN/العربية, and an offline banner.
- **Session screen:**
  - Countdown ring and top-bar timer, computed from the server offset.
  - Warnings at 30/15/10/5/1 minutes, and a pulsing final-minute banner.
  - A "Time's up" overlay and staff messages.
  - Menus for Games, Platforms, Internet, Food and Support. They are placeholders
    until Phases 5 and 7.
- **Browser preview:** `npm run dev -w @arena/shell` → http://localhost:5174.
  - A mock agent is used (`ahmed` / `ahmed123` or PIN `1234`).
  - `?session=90` starts logged in with 90 s left.

## Try it on a Windows PC

```bash
npm run build -w @arena/shell                                   # UI → Arena.Shell/wwwroot
dotnet build clients/windows/ArenaOS.Windows.sln -c Release
# agent (already enrolled, see 08): console mode
clients/windows/src/Arena.Agent/bin/Release/net8.0-windows10.0.19041.0/ArenaAgent.exe run --data-dir clients/windows/.dev-agent
# shell window (dev mode accepts the console agent)
clients/windows/src/Arena.Shell/bin/Release/net8.0-windows10.0.19041.0/ArenaShell.exe --dev
```

Sign in as `ahmed` / `ahmed123` (PIN `1234`). The session appears on the Live
Floor. Extend it or end it from the admin console, and watch the Shell follow.

## Tests

- **API, `test/sessions.e2e.test.ts` (19 tests, real Postgres + simulated PCs):**
  - The brief's prices.
  - A signed START with a server-set expiry.
  - Retry charges once.
  - Busy/offline refusals and permissions/tenant isolation.
  - Extend, move and end; pay-later billing.
  - **Expiry at 00:00, even with the PC disconnected.**
  - "Ending soon" and warnings.
  - A restarted PC is resynced.
  - Shell login/logout with refund; wrong password, no time, brute force and replayed login.
  - Selling prepaid time once.
  - PII masking.
  - Branch-scoped rates.
  - **Expiry survives an API restart.**
- **API, `test/pricing.test.ts`:** 17 pure pricing tests.
- **.NET (34 tests):**
  - SessionManager: lifecycle, a stale END, persistence across restart, and the fail-safe lock.
  - ShellProtocol: only ready/login/logout are accepted; forged state, bad request ids and oversized lines are rejected.
  - Plus the Phase 3 command-signing fixtures.
- **Verified on this PC:**
  - A PowerShell client acting as the Shell signed in over the real pipe → the
    server issued a signed START_SESSION → the agent pushed the session to the Shell.
  - A forged `state` message was ignored.
  - Logout → END_SESSION → locked.
  - `ArenaShell.exe --dev` launched and connected to the agent.
