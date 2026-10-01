# 10 · Games, launchers & station tools (Phase 5)

## What a venue gets

| For | Feature |
|---|---|
| Customers (Gaming Shell) | Game library with search and category filters. One tap to play; age ratings enforced. Apps, Platforms (Steam/Epic/Riot…), Internet (private browsing). Connection screen with live ping. Peripherals screen: detected gear, mouse speed and presets. Support: call staff by topic, plus three safe self-fixes. |
| Staff (Admin → Games) | Platform catalog + custom games. Enable, feature, or limit to zones. Installed on how many PCs, and how many need an update. One-click branch-wide updates that never interrupt a customer. Scan PCs. Shell apps. |
| Staff (Live Floor) | Gamepad badge: what's being played. Bell badge: a customer asked for help ("On my way" acknowledges it). Station drawer: repairs, connection, peripherals (missing ones in red), games on the PC, boot mode. |
| Owners | Alerts for a missing mouse, keyboard or headset, and for internet loss or high latency. Everything is audited, including customers' self-repairs. |

## The station config is signed

The PC launches executables when a customer taps a tile. So the list of what
may be launched travels as a **signed `REFRESH_CONFIG` envelope**: the same
branch ES256 key, device binding, expiry and replay checks as a command
(`StationConfigService`).
- It is never persisted as a DeviceCommand and never acknowledged.
- The agent caches it in `station-config.json`, so the library works offline.
- It is re-pushed whenever something changes: game settings, zones, apps,
  presets, connectivity targets, or the PC's own inventory. Unchanged
  revisions are skipped.

The agent adds local rules on top (`LaunchPolicy`):
- A session must be running.
- The item must be in the signed library.
- The customer must be old enough (`START_SESSION.customer.age`, computed
  from the profile's date of birth, and lowered by an **age limit**
  restriction).
- The game must not be blocked for this customer
  (`START_SESSION.customer.blockedGameIds`, from **Block games** restrictions).
  Blocked and too-old games show as locked in the Shell's library.
- The game must be installed.
- Interpreters and system tools (`cmd`, `powershell`, `regedit`, `mshta`…)
  never run, whatever the catalog says.
- Steam games start as `steam.exe -applaunch <appid>`. Epic games start
  through its launcher URI. **Ids are re-validated; the server never sends a
  raw command line or URI.**

The Shell only ever sees titles, categories and flags. It never sees paths or
arguments.

## Detection

`GameScanner` runs on connect, every 30 minutes, on `SCAN_GAMES`, and **within
~2 s of any launcher manifest change** (a `FileSystemWatcher` on every Steam
library and the Epic manifest folder). While a launcher is downloading, it also
rescans every 5 s so progress keeps moving. Reports are only sent when
something changed.
- **Steam:** `libraryfolders.vdf` → every library → `appmanifest_*.acf`. It
  reads appid, build and size. An update is pending when `TargetBuildID` is
  set and differs from `buildid`, or `StateFlags` has bit 2/512; it is
  **running** with bit 256/1024. Progress comes from Steam's own byte counters
  (`BytesDownloaded/BytesToDownload` + `BytesStaged/BytesToStage`).
  Steam only learns about a new build while its client runs, so the **server
  also asks Steam** (`SteamBuildsService`): the public branch's build id per
  appid, from Steam's app info via the steamcmd PICS mirror
  (`STEAM_BUILDS_URL`, default `https://api.steamcmd.net/v1/info/`, `off` to
  disable; off in tests). Cached 15 min per game for the whole platform. A
  PC's report is checked against it (older build → update required), and a
  sweep every 15 min flags PCs that aren't reporting — Steam closed or PC
  off. If Steam's info can't be fetched, the PC's own manifest is trusted.
- **Epic:** `C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item`.
  Incomplete installs are skipped. The manifest never says "update
  available", so the server flags a PC when another PC in the organization
  reports a newer build (numeric-aware compare). No byte progress for Epic.
- **Catalog executables** (Riot, Battle.net, standalone): installed if the
  signed path exists.

- **Installed apps:** the registry `Uninstall` keys (64- and 32-bit), minus
  updates, system components and Steam's own entries. The main `.exe` is taken
  from `DisplayIcon` when it isn't an installer/uninstaller.

On the server, `InventoryService` matches these to the catalog by
launcher + store id. It keeps `GameInstallation` current: `INSTALLED`,
`UPDATE_REQUIRED`, `QUEUED`, `UPDATING` or `NOT_INSTALLED`. A PC can't create
catalog entries.

Everything a scan saw — catalog or not — is also kept in `DetectedTitle`
(replaced per PC on each scan). **Admin → Games → Found on PCs**
(`GET /detected-titles?branchId=`) lists it across PCs: how many PCs have it,
build(s), pending updates, and whether it's already in the library / Shell.
**Add to library** creates a custom Steam/Epic game (and marks it installed on
the PCs that reported it, without waiting for a rescan); **Add to Shell**
creates a Shell app from the detected `.exe`.

**Live:** every report publishes an `inventory` event (and jobs a
`game_update` event) on the branch's `/floor/events` stream. The Games page
listens and refreshes the Library, Found on PCs and Updates tabs as they
happen: `UPDATING` rows show the launcher's real progress, and a job's bar
counts finished PCs plus each downloading PC's partial progress. Without
access to that stream the page polls every 10 s.

## Updates (`GameUpdatesService`)

**Admin:** Games → **Update**. This calls `POST /branches/:id/game-updates`.

The orchestrator runs every 3 s for all tenants. It finds due jobs through
the definer function `app.update_jobs_due()`, then processes each job in its
own tenant transaction.
- **Targets:** only PCs whose last scan says "update required".
- **Idle only:** never a PC with a live session. It waits until the session
  ends.
- **Concurrency:** at most `maxConcurrent` PCs at a time. Each gets a signed
  `UPDATE_GAME`.
  - Steam: `steam.exe -silent steam://validate/<appid>`.
  - Epic: its launcher is opened, and it updates.
- **Done:** a PC counts as done when its next scan (every minute for up to 2 h)
  reports the game up to date.
- **Failures:**
  - A PC whose command failed, or that stalled for over 2 h, is reported and
    skipped.
  - If a PC was offline when its command was sent and the command expired, it
    is sent again when the PC is back.
  - PCs still offline 24 h after the job started are listed, and the job
    closes.
- Only Steam/Epic titles can be updated remotely. Other games live on the
  master or diskless image.

## Peripherals, connectivity, boot

- **Peripherals:** `PeripheralScanner` (WMI Plug-and-Play), every 20 s.
  - It classifies mice, keyboards, headsets, microphones, webcams,
    controllers, wheels and joysticks, and names the vendor by USB vendor id
    (Razer, Logitech, SteelSeries, HyperX, Corsair…).
  - Composite devices are de-duplicated. Onboard audio is ignored.
  - The server keeps `DeviceAccessory` rows keyed by PnP instance id.
    `PERIPHERAL_MISSING` opens when a mouse, keyboard or headset disappears
    (and no other of that kind is present), and clears when it is back.
- **Connectivity:** `NetworkProber`, every 60 s.
  - It sends 4 pings per target (router, Cloudflare, Google by default).
    Targets are set per branch with `PUT /branches/:id/connectivity-targets`
    (e.g. game-server regions).
  - It also reports DNS lookup time and link type/speed.
  - `NETWORK_DEGRADED` is raised as CRITICAL when the internet is unreachable,
    and as WARNING for ≥ 20 % loss or ≥ 150 ms best ping.
- **Boot mode:** `BootDetector`. An iSCSI session means diskless boot; known
  diskless client services (CCBoot, ggRock…) name the provider. The result is
  stored in `DeviceBootInfo` and linked to the branch's `DisklessIntegration`.
  The integrations themselves are managed through
  `/branches/:id/diskless` (feature `DISKLESS`, Enterprise plan). Talking to a
  provider's own API is left for when a venue needs it.

## Repairs

- **Allow-listed actions only:** `REPAIR_ACTIONS` = FLUSH_DNS, RENEW_IP,
  RESTART_AUDIO, CLEAR_TEMP (Windows temp files older than a day), SYNC_TIME,
  RESTART_SHELL, CLOSE_GAMES. Each maps to fixed steps in `RepairRunner`.
- **Staff:** signed `RUN_REPAIR`, which needs `station.restart`.
- **Customers:** the Support screen offers FLUSH_DNS, RESTART_AUDIO and
  RESTART_SHELL only. Anything else from the Shell is dropped by
  `ShellProtocol.Parse`. Each self-repair is written to the audit log as the
  DEVICE.
- **Safe mode:** everything is simulated except FLUSH_DNS and RESTART_SHELL.

## Session end

When the session ends, or the fail-safe locks the PC:
- The agent closes the library's game processes and the launchers (Steam,
  Epic, Riot, Battle.net, EA, Ubisoft), whose logins belong to the customer
  who just left. In safe mode it only counts them.
- The Shell host restores the venue's mouse speed and acceleration. The
  customer's changes are applied without `SPIF_UPDATEINIFILE`, so nothing is
  written to the Windows profile.

## Messages added

**Device → server:**
- `inventory`, `peripherals`, `network`, `boot`, `game_event`
  (started/exited), `help_request`, `self_repair`.

**Server → device:**
- `config` (a signed REFRESH_CONFIG) and `help_result`.

**Shell → agent** (over the pipe):
- `launch`, `launch_app`, `help`, `repair`.

**Agent → Shell:**
- `library`, `playing`, `network`, `peripherals`, `launch_result`,
  `help_result`, `repair_result`, `reload`.

**Shell ↔ host** (handled in the host):
- `pointer_get` / `pointer_apply` → `pointer`.

## Tests

- **API, `test/games.e2e.test.ts` (13 tests, real Postgres + simulated PCs):**
  - The signed library; detection and uninstall.
  - VIP-only zones; custom games (validation, and invisible to other orgs;
    the catalog is read-only); customer age sent to the PC; "now playing".
  - Branch update that waits for the customer and then completes;
    scan permissions.
  - Missing-mouse alert; internet-loss alert; help request de-duplicated;
    repair allow-list and permission; per-branch connectivity targets.
- **API, `test/games.test.ts`:** launch-spec validation and network health.
- **.NET, `StationTests.cs` (16 tests):**
  - Steam VDF/ACF parsing (both library formats, StateFlags).
  - Epic manifests.
  - Peripheral classification and de-duplication.
  - Launch policy: session, library, age, installed, interpreters refused,
    malformed ids refused.
  - Config payload shape.
  - Shell requests (self-service repairs only).
  - The library never leaks paths.
  - Ping summary.
  - Age in START_SESSION.
- **Verified on the developer laptop:**
  - The real agent verified the signed config (18 games, 10 apps) and
    reported local-disk boot.
  - It reported the real keyboard, mice and webcam, and live ping to the
    router, Cloudflare and Google.
  - Through the real pipe: login, then a not-installed game was refused, a
    staff-only repair was ignored, a help request reached the server, a real
    DNS flush ran, and logout worked.
