# 16 · Full test guide: server, physical PCs, every role, every feature

This is a hands-on acceptance test for everything built in Phases 1–10. Work
through it top to bottom. Tick each box as you go. When a result doesn't match
the **Expect** column, note the step number and what you saw.

| Part | What | Time |
|---|---|---|
| [0](#0--quick-tour-no-install) | Quick tour: live demos + downloads, nothing to install | 30 min |
| [A](#a--what-you-need) | Hardware, network and accounts you need | read once |
| [B](#b--set-up-the-server-pc) | Set up the server PC (database, API, admin, apps) | 45 min |
| [C](#c--automated-tests-first) | Automated tests | 15 min |
| [D](#d--set-up-each-gaming-pc-physically) | Set up each gaming PC physically | 30 min per PC |
| [E](#e--consoles-vr-tvs-smart-plugs-printer) | Consoles, VR, TVs, smart plugs, printer | 30 min |
| [F](#f--role-by-role-test-scripts) | Role-by-role test scripts (all 14 roles + customers) | 4–6 h |
| [G](#g--security-and-isolation-tests) | Security and tenant-isolation tests | 1 h |
| [H](#h--failure-and-recovery-tests) | Failure and recovery (unplug, reboot, restart) | 1 h |
| [I](#i--troubleshooting) | Troubleshooting | as needed |
| [J](#j--not-built-yet-dont-test) | What isn't built yet (don't test) | read once |
| [K](#k--super-admin-platform) | Super Admin (platform) | 45 min |
| [L](#l--downloads-desktop-exes-apk-installer) | Downloads: desktop EXEs, Android APK, station installer | 45 min |

---

## 0 · Quick tour (no install)

The fastest way to see everything working. It uses the **live demos**: the real apps running a simulated venue in the browser. Nothing here touches a server or a database. Build them once (see [18 · Live demos](18-live-demos.md)), then:

```bash
npm run build:demos
npm run dev -w @arena/website
```

Open `http://localhost:5180`.

| # | Do | Expect |
|---|---|---|
| - [ ] 0.1 | Look at the homepage | A 3D arena animates behind the headline; screens change colour; moving the mouse tilts the camera |
| - [ ] 0.2 | Scroll to **Live, not a video** → **Launch all three** | Admin (Live Floor), Gaming Shell and customer app load inside the laptop, monitor and phone |
| - [ ] 0.3 | In the Shell (monitor), sign in **ahmed / ahmed123** | Shell shows the countdown. In the admin, **PC-01** turns "in use" with Ahmed |
| - [ ] 0.4 | Shell → **Food** → order a burger | Admin → **Kitchen** shows the ticket. Within about a minute the Shell says the order is being prepared, then ready |
| - [ ] 0.5 | Admin → click **PC-01** → **Message** → send "hello" | The message pops up on the Shell |
| - [ ] 0.6 | Admin → PC-01 → **End session** | The Shell goes back to its lock screen |
| - [ ] 0.7 | Phone app: sign in ahmed / ahmed123 → **Book** a VIP PC tomorrow | Admin → **Bookings** lists it |
| - [ ] 0.8 | Open `/live/admin/login/`, pick **Super Admin**, Sign in, type any 6 digits | The platform console opens at /platform |
| - [ ] 0.9 | Bottom-left **Live demo → Reset** | The venue starts fresh |

Then install the downloads from the **Download** section and follow [L](#l--downloads-desktop-exes-apk-installer).

---

## A · What you need

### Hardware

| # | Item | Minimum | Used for |
|---|---|---|---|
| 1 | **Server PC** | Windows 10/11, 16 GB RAM, SSD, wired Ethernet | Postgres, API, admin console, customer app |
| 2 | **Gaming PCs** | 2 or more, Windows 10 (19041+) or 11, wired Ethernet | Agent + Gaming Shell. Two lets you test *move session* and Wake-on-LAN |
| 3 | **Network switch / router** | All PCs on the **same LAN** (same subnet) | Wake-on-LAN needs the same broadcast domain |
| 4 | **Staff tablet or 2nd screen** | Any browser | Kitchen display, POS at the same time as the Live Floor |
| 5 | **A phone** | Any browser on the venue Wi-Fi | Customer app |
| 6 | **A TV or monitor + any browser device** (optional) | Smart TV browser, Fire Stick, old laptop | TV station display for consoles/VR |
| 7 | **Printer** (optional) | Any printer installed on one gaming PC | Internet-café print control |
| 8 | **Smart plug** (optional) | Shelly Gen 2+, Shelly Gen 1, or Tasmota | Console power on/off at session start/end |
| 9 | **USB mouse, keyboard, headset** on each gaming PC | — | Peripheral detection + "missing mouse" alert |
| 10 | **Steam and/or Epic** installed on at least one gaming PC with 1–2 small games | — | Game detection, launch, updates |

No hardware? You can still test almost everything with the **simulator**
(section [D.9](#d9--no-spare-pcs-use-the-simulator)).

### Network plan (write yours down)

| Machine | Example IP | Notes |
|---|---|---|
| Router | 192.168.1.1 | |
| Server PC | **192.168.1.10** (static, or a DHCP reservation) | Everything points here. Replace `SERVER` below with this IP |
| PC-01 | 192.168.1.101 | |
| PC-02 | 192.168.1.102 | |
| Smart plug | 192.168.1.50 | Must be a private LAN address |

> Throughout this guide, **`SERVER`** means your server's LAN IP, e.g. `192.168.1.10`.

### Demo accounts (created by the seed)

Every staff password: **`ArenaDemo!2026`**

| Login | Role | Scope |
|---|---|---|
| owner@demo.test | Org Owner | Demo Arena (Pro plan), everything |
| manager@demo.test | Branch Manager | DXB1 (Dubai Marina) |
| cashier@demo.test | Cashier | DXB1 |
| tech@demo.test | Technician | DXB1 |
| waiter@demo.test | Waiter | DXB1 |
| kitchen@demo.test | Kitchen Staff | DXB1 |
| inventory@demo.test | Inventory Manager | whole organization |
| owner@rival.test | Org Owner | **Rival Gaming** (a different tenant, Starter plan) |
| super@arenaos.test | **Super Admin** | The whole platform. Two-step sign-in: the first sign-in shows a QR code to scan with an authenticator app |

Everyone signs in at the same page, `http://SERVER:3000/login`. Staff land in the venue console; the Super Admin lands in `/platform`.

| Customer | Password | PIN | Notes |
|---|---|---|---|
| ahmed | ahmed123 | 1234 | Adult; 120 min prepaid, AED 150 + 20 bonus in wallet |
| sara | sara1234 | — | Born 2013 (age-restricted games hidden), no time |

The other 7 role templates (Org Admin, Gaming Manager, System Admin,
Receptionist, Restaurant Manager, Accountant, Tournament Manager) aren't
seeded. You create them in [F.1](#f1--org-owner-owner-demotest).

---

## B · Set up the server PC

### B.1 Install software

- [ ] **Node.js 22+** — https://nodejs.org (LTS). Check: `node -v`
- [ ] **Docker Desktop** — https://docker.com (runs Postgres + Redis)
- [ ] **Git**
- [ ] **.NET 8 SDK** — only on the machine where you *build* the Windows client (can be the server)

### B.2 Give the server a fixed IP

Windows Settings → Network → Ethernet → **IP assignment: Manual**, or reserve
the IP in your router's DHCP page. Gaming PCs store this address at
enrolment, so it must not change.

### B.3 Open the firewall (PowerShell as Administrator)

```powershell
New-NetFirewallRule -DisplayName "ArenaOS API"      -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private,Domain
New-NetFirewallRule -DisplayName "ArenaOS Admin"    -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private,Domain
New-NetFirewallRule -DisplayName "ArenaOS Customer" -Direction Inbound -Protocol TCP -LocalPort 5175 -Action Allow -Profile Private,Domain
New-NetFirewallRule -DisplayName "ArenaOS Website"  -Direction Inbound -Protocol TCP -LocalPort 5180 -Action Allow -Profile Private,Domain
```

The Super Admin service (port 4100) is only called by the admin server on the same PC, so it needs no firewall rule.

Also make sure the Ethernet network is set to **Private** (Settings → Network
→ Ethernet → Network profile type), otherwise the rules don't apply.

### B.4 Install and start everything

From the repo root (`D:\Projects\Gamming`):

```bash
npm install
npm run codegen -w @arena/db
docker compose -f infra/docker-compose.yml up -d
```

- [ ] `docker ps` shows **postgres** and **redis** running.

```bash
copy .env.example .env          # only if .env doesn't exist yet
cd packages/db && npx prisma migrate deploy && cd ../..
npm run keys -w @arena/api
npm run seed -w @arena/api
```

- [ ] Seed ends by printing the demo logins.

Start the apps, **each in its own terminal** (or use the Code tab's
preview, which reads `.claude/launch.json`):

```bash
npm run dev -w @arena/api
```
```bash
npm run dev:platform -w @arena/api
```
```bash
npm run dev -w @arena/admin
```
```bash
npm run dev -w @arena/customer
```
```bash
npm run dev -w @arena/shell
```

| Check | Expect |
|---|---|
| - [ ] Open `http://SERVER:4000/health` **from another PC** | a JSON "ok" response (proves the firewall and LAN work) |
| - [ ] Open `http://SERVER:3000` | Admin login page |
| - [ ] Open `http://SERVER:5175/demo` on your phone | Customer app for "Demo Arena" |
| - [ ] Open `http://localhost:5174` on the server | Gaming Shell preview (mock agent) |
| - [ ] Open `http://localhost:4100/health` on the server | `{"ok":true,"service":"arena-platform"}` |

> If the admin login says **"Something went wrong on the server"**, the API isn't running. If Super Admin sign-in says it **can't reach the platform service**, start `npm run dev:platform -w @arena/api`.

---

## C · Automated tests first

Run these before any manual testing. If they fail, fix that first.

```bash
npm test
```

- [ ] All packages pass (schema, RBAC, contracts, pricing, and every API e2e
      suite against real Postgres: auth, sessions, games, customers, POS,
      stations, inventory, loyalty…).

On the build PC (needs the .NET 8 SDK):

```bash
dotnet test clients/windows/ArenaOS.Windows.sln -c Release
```

- [ ] All .NET tests pass (command signing, session manager, shell protocol,
      Steam/Epic parsing, launch policy, print tracker, LAN-only plug).

---

## D · Set up each gaming PC physically

### D.1 Build the Windows client (once, on the build PC)

```powershell
.\clients\windows\package.ps1
```

This builds the Shell UI and publishes both programs **self-contained**, so
gaming PCs don't need .NET installed. Copy the whole
`clients\windows\dist\ArenaOS-Station\` folder (about 270 MB) to every gaming
PC, e.g. to `C:\ArenaSetup\` (USB stick or network share):

```
C:\ArenaSetup\
  Agent\   ArenaAgent.exe, install-agent.ps1, uninstall-agent.ps1
  Shell\   ArenaShell.exe, wwwroot\
```

> Keep `Agent` and `Shell` side by side: the installer picks the Shell up from
> `..\Shell`. For a smaller package, `package.ps1 -FrameworkDependent` needs
> the .NET 8 Desktop Runtime on each PC instead.

### D.2 Hardware and BIOS (per PC)

- [ ] Plug in **wired Ethernet** to the same switch as the server.
- [ ] Plug in mouse, keyboard, headset (all USB).
- [ ] **BIOS/UEFI:** enable **Wake-on-LAN** (often "Power On by PCI-E", "Resume by LAN", or "WOL"). Disable **ErP / Deep Sleep** (it cuts power to the network card).
- [ ] **Windows:** Device Manager → Network adapters → your Ethernet → Properties:
  - Power Management: tick **Allow this device to wake the computer** and **Only allow a magic packet**.
  - Advanced: **Wake on Magic Packet = Enabled**.
- [ ] Control Panel → Power Options → *Choose what the power buttons do* → untick **Turn on fast startup** (fast startup often breaks WOL).
- [ ] Power plan: sleep **Never** (a sleeping PC shows as Offline).

### D.3 Windows prerequisites (per PC)

- [ ] Windows Update fully installed.
- [ ] **Microsoft Edge WebView2 Runtime** (already on Windows 11; on Windows 10 install the *Evergreen* runtime). The installer warns if it's missing.
- [ ] .NET 8 Desktop Runtime x64: **only** if you built with `-FrameworkDependent`.
- [ ] For GPU temperature: NVIDIA driver installed (the agent uses `nvidia-smi`).
- [ ] Optional: Steam and/or Epic Games Launcher with 1–2 small games installed.
- [ ] Optional (one PC): a printer installed and a test page printed normally.
- [ ] Create a **standard (non-admin) Windows account**, e.g. `Player`, that customers use. Your own admin account stays for setup.

### D.4 Create an enrolment code (admin console)

1. Log in to `http://SERVER:3000` as **owner@demo.test**.
2. **Computers → Add stations.**
3. Zone: **Regular PCs** (DXB1). How many PCs: the number of gaming PCs you have. Valid for: 24 h.
4. Copy the code `ARENA-XXXXX-XXXXX-XXXXX-XXXXX`. **It's shown only once.**

- [ ] The page shows the ready-made enrol command with your server's address.

### D.5 Enrol and install the agent (per PC, as Administrator)

Open **PowerShell as Administrator** on the gaming PC:

```powershell
cd C:\ArenaSetup\Agent
.\ArenaAgent.exe enroll --api http://SERVER:4000 --code ARENA-XXXXX-XXXXX-XXXXX-XXXXX --safe-mode on
.\install-agent.ps1
```

> **Start with `--safe-mode on`** for your first PC. Restart, shutdown, lock
> and app launch are *simulated*, and print control is off. Messages and
> Wake-on-LAN are real. When everything checks out, switch it off:
> `.\ArenaAgent.exe safe-mode off` then `Restart-Service ArenaAgent`.

| Check | Expect |
|---|---|
| - [ ] Enrol output | Station name like **PC-01** |
| - [ ] Installer output | "ArenaAgent installed and running" and "Gaming Shell installed" (in safe mode it says the Shell won't start automatically) |
| - [ ] `Get-Service ArenaAgent` | Running, startup type Automatic |
| - [ ] `& "C:\Program Files\ArenaOS\Agent\ArenaAgent.exe" status` | Station name, device id, API URL, safe mode |
| - [ ] Admin → **Live Floor** | PC-01 appears **green (Available)** within seconds |
| - [ ] Click PC-01 → drawer | CPU/GPU/RAM/disk meters moving, hardware inventory, network, peripherals |

Repeat for every PC. The same code works until its PC count or time runs out.

### D.6 Gaming Shell autostart (per PC)

`install-agent.ps1` already installed the Shell to
`C:\Program Files\ArenaOS\Shell`. The agent service starts it full-screen
(`--kiosk`) whenever a **standard** Windows user signs in, and restarts it
within about 3 seconds if it's closed. It doesn't start:
- for **administrator** accounts, so staff can sign in with an admin account for maintenance;
- in **safe mode**. Turn safe mode off for a real gaming PC:
  ```powershell
  & "C:\Program Files\ArenaOS\Agent\ArenaAgent.exe" safe-mode off
  Restart-Service ArenaAgent
  ```

| Check | Expect |
|---|---|
| - [ ] Sign in to Windows as **Player** | Within a few seconds the Shell opens **full-screen** on the **lock screen**: venue name, clock, station name, sign-in box, EN/العربية switch |
| - [ ] Alt+F4 | Nothing happens |
| - [ ] Ctrl+Shift+Esc → Task Manager → end **ArenaShell** | The Shell comes back within ~3 s |
| - [ ] Sign out, sign in with your **admin** account | Normal Windows desktop, no Shell |
| - [ ] Admin Live Floor drawer | Shell state **LOCKED** |

> If the Shell crashes 5 times in 2 minutes, the agent pauses autostart for
> 5 minutes and logs an error (Event Viewer → Application → ArenaAgent).
>
> The Shell refuses to trust a pipe that isn't served by a Windows service. If
> you're running the agent in a console (`ArenaAgent.exe run`), there's no
> autostart: start the Shell yourself with `--dev`.

### D.7 Enable Wake-on-LAN test prerequisites

You need **at least two** enrolled PCs on the same LAN: the server asks
another *online* PC to broadcast the wake packet.

### D.8 Per-PC acceptance checklist

| # | Test | How | Expect |
|---|---|---|---|
| - [ ] 1 | Heartbeat | Watch the drawer 30 s | Meters update every ~10 s |
| - [ ] 2 | Message | Drawer → Send message "Hello" | Appears on the PC (inside the Shell, or a Windows box) |
| - [ ] 3 | Lock | Drawer → Lock | Windows session locks (simulated in safe mode) |
| - [ ] 4 | Peripherals | Unplug the **mouse** | Within ~20 s: `PERIPHERAL_MISSING` alert; peripherals list shows mouse in red. Plug back → alert clears |
| - [ ] 5 | Network | Unplug Ethernet for 3 min | After 2 min: **Offline** (black) + `CLIENT_OFFLINE` alert. Plug back → green, alert resolves |
| - [ ] 6 | Hardware | Drawer → Hardware | CPU, GPU, RAM, board, disks, NICs listed |
| - [ ] 7 | Games detected | Admin → Games | Your installed Steam/Epic titles show "installed on 1 PC" |
| - [ ] 8 | Restart | Drawer → Restart (safe mode off) | PC restarts with 5 s notice, reconnects, Shell returns to lock screen |
| - [ ] 9 | Shutdown + Wake | Drawer → Shut down; then **Wake** | PC powers off; Wake turns it back on (via another online PC) |
| - [ ] 10 | Layout | Live Floor → Edit layout, drag PCs to match the room, Save | Positions persist after refresh |

### D.9 No spare PCs? Use the simulator

```bash
npm run sim -w @arena/api -- --code ARENA-XXXXX-XXXXX-XXXXX-XXXXX --count 10
```

- [ ] 10 virtual PCs appear on the Live Floor, report metrics and obey signed commands.

You can also run the real agent on your own dev PC in safe mode without installing it:

```powershell
.\ArenaAgent.exe enroll --api http://localhost:4000 --code ARENA-… --safe-mode on --data-dir C:\ArenaDev
.\ArenaAgent.exe run --data-dir C:\ArenaDev
..\Shell\ArenaShell.exe --dev
```

---

## E · Consoles, VR, TVs, smart plugs, printer

The seed already created agentless stations at DXB1: **PS5-01..03** (with
TV-01..03), **VR-01/02** (with TV-VR, age 13+, cleaning required) and
**SIM-01** (racing rig, age 10+).

### E.1 TV station display

1. On the TV's browser open `http://SERVER:5175/display.html`. It shows a pairing screen.
2. Admin → **Consoles & VR** → TV-01 → **Pair**. You get an 8-character code (valid 10 min, single use).
3. Enter the code on the TV.

- [ ] TV shows its linked station(s) as **Free**.
- [ ] Re-using the same code on another device fails.
- [ ] Admin → **Unpair** → the TV loses access at once.

### E.2 Smart plug (optional)

1. Put the plug on the LAN with a fixed IP (e.g. `192.168.1.50`). Plug the console (or a lamp for testing) into it.
2. Admin → **Consoles & VR** → PS5-01 → edit: plug type (Shelly Gen 2 / Gen 1 / Tasmota), address, channel, "off after" delay.
3. Choose a **bridge PC** (any enrolled, online gaming PC with safe mode off).

- [ ] Power on/off buttons switch the plug.
- [ ] Entering a public address (e.g. `8.8.8.8`) is refused.
- [ ] Session start → plug turns on. Session end → TV shows "Time's up", plug turns off after the delay.

### E.3 Printer (optional, safe mode must be **off** on that PC)

1. Admin → **Printing** → rules: set max pages, optionally tick **staff approval**.
2. Sign a customer into the Shell on the printer PC, print a 2-page document.

- [ ] The job is **paused** in Windows immediately; the Shell shows a price (B/W 0.50/page, colour 2.00/page) with *Add to my bill* / *Pay from wallet* / Cancel.
- [ ] *Add to my bill* → prints; the line appears on the session bill.
- [ ] With staff approval on → job waits in Admin → Printing until **Release**.
- [ ] Un-pausing the job manually in Windows → it's paused again.
- [ ] Printing with **no customer signed in** → "Sign in to print".
- [ ] Leave the price dialog for 3 min → job cancelled and deleted.

---

## F · Role-by-role test scripts

Use a **separate browser profile or private window per role**, so you can stay
signed in as several people at once. Admin URL: `http://SERVER:3000`.

A **sensitive** action asks for a *reason*. That's expected; type one.

### F.1 · Org Owner (`owner@demo.test`)

**Organization, branches, zones**

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | Log in | Dashboard; every menu item visible |
| - [ ] 2 | Settings → set up **authenticator (TOTP)**, log out, log in | Asks for the 6-digit code; the same code can't be reused |
| - [ ] 3 | Branches & zones → open DXB1 → edit opening hours | Saved (asks for a reason) |
| - [ ] 4 | Add a zone "Test Zone" to DXB1, then archive it | Appears, then disappears from lists |
| - [ ] 5 | Add a new branch | Created (Pro plan allows it); keep adding until the plan limit → **402** message |

**Employees and roles (create the 7 unseeded roles)**

| # | Do | Expect |
|---|---|---|
| - [ ] 6 | Employees → invite `orgadmin@demo.test` as **Org Admin** (organization) | Created |
| - [ ] 7 | Invite `gaming@demo.test` **Gaming Manager** @ DXB1 | Created |
| - [ ] 8 | Invite `sysadmin@demo.test` **System Admin** @ DXB1 | Created |
| - [ ] 9 | Invite `reception@demo.test` **Receptionist** @ DXB1 | Created |
| - [ ] 10 | Invite `restmgr@demo.test` **Restaurant Manager** @ DXB1 | Created |
| - [ ] 11 | Invite `accounts@demo.test` **Accountant** (organization) | Created |
| - [ ] 12 | Invite `tourney@demo.test` **Tournament Manager** @ DXB1 | Created |
| - [ ] 13 | Set a **PIN** for cashier@demo.test | Saved |
| - [ ] 14 | Give one person two roles (e.g. Cashier @ DXB1 + Gaming Manager @ AUH1) | Both appear on their profile |
| - [ ] 15 | Try to remove your own **Org Owner** role (the only owner) | Refused: last owner can't be removed |
| - [ ] 16 | Roles → create a custom role "Night Cashier" from a few permissions | Saved; template roles are read-only |

> For each invite, fill **Initial password** (12+ characters). Using
> `ArenaDemo!2026` for all of them keeps things simple. You'll log in as each
> one in [F.8](#f8--roles-you-created-in-f1).

**Rates / pricing**

| # | Do | Expect |
|---|---|---|
| - [ ] 17 | Rates → view plans (Standard PC, VIP PC, PS5, Racing sim, Night pass…) | Listed with packages |
| - [ ] 18 | Edit the VIP hourly rate (reason required) | Saved. A **running** session keeps its old price (snapshot) |
| - [ ] 19 | PS5 plan: included players 2, extra player rate 5 | Saved |

**Games**

| # | Do | Expect |
|---|---|---|
| - [ ] 20 | Games → toggle a game off | Disappears from the Shell library within seconds |
| - [ ] 21 | Mark a game **featured**, limit another to **VIP** zone only | Featured on top; VIP-only game hidden on Regular PCs |
| - [ ] 22 | Add a **custom game** with a bad path | Validation error |
| - [ ] 23 | **Scan PCs** | Install counts refresh |
| - [ ] 24 | **Update** (branch-wide) with a Steam game needing an update | Job runs only on idle PCs; a PC in session waits until it ends |
| - [ ] 25 | Shell apps → add an app (e.g. Discord) | Shows in Shell → Apps |

**Marketing (promotions, loyalty, CRM)**

| # | Do | Expect |
|---|---|---|
| - [ ] 26 | Create promotion "HAPPY20": 20 % off gaming time, weekdays 14–18, code-based | Saved (reason) |
| - [ ] 27 | Generate a **batch of 5 personal codes** for it | 5 unique codes |
| - [ ] 28 | Loyalty → rules: check GAMING 1 pt/AED, BOOKING 20, TOURNAMENT 50, REFERRAL 200, BIRTHDAY 100 | Present and editable |
| - [ ] 29 | Loyalty → rewards: add "30 free minutes" for 300 pts | Saved |
| - [ ] 30 | Segments → refresh; open **VIP** / **NEW** | Member lists fill |
| - [ ] 31 | Campaign → IN_APP to a segment with `{{firstName}}` and an attached promo → preview audience → **Send** | Only opted-in customers receive it; ahmed sees it in the app Inbox with his own code |
| - [ ] 32 | Send the same campaign again | Nobody gets a duplicate |
| - [ ] 33 | Campaign on **SHELL** channel | Shown on the customer's PC at their next session start |

**Owner-only powers**

| # | Do | Expect |
|---|---|---|
| - [ ] 34 | Customers → ahmed → **adjust wallet** +10 (reason) | Balance changes; ledger row shows reason |
| - [ ] 35 | Customers → adjust loyalty points (reason) | Balance changes |
| - [ ] 36 | Customers → **freeze** a wallet, then try to pay with it | `wallet_frozen` |

**The customer file**

| # | Do | Expect |
|---|---|---|
| - [ ] 37 | Customers → status chips **Banned** / **Restricted**, tag box, sort **Top spend** | List filters and re-orders; **Spend** column filled for customers who have paid |
| - [ ] 38 | ahmed → **Profile** → date of birth, home branch DXB1, tags `VIP, regular` → **Save** | Tags show next to his name in the list; the **Tag** box with `VIP` finds him |
| - [ ] 39 | ahmed → **Restrictions** → **Restrict** → *Ban*, 1 day, reason → **Apply** | Status **banned**; Shell sign-in and the app refuse him; starting a session for him → "This customer is banned" |
| - [ ] 40 | Same tab → **Lift** (reason) | Back to active; he can sign in again |
| - [ ] 41 | sara → *Block games* → pick a game → start a session for her on a real PC | The game shows **locked** on the Shell and won't launch (needs the updated agent) |
| - [ ] 42 | sara → *Daily play limit* 30 min → try to sell her 1 hour on a PC | "Daily play limit: only 30 min left today" |
| - [ ] 43 | sara → *No food & drink* → POS order with sara as the customer | "This customer can't order food & drink"; lift both afterwards |
| - [ ] 44 | ahmed → **Overview** | Spend, played, visits, per visit, last visit; any warning flags (frozen wallet from #36) |
| - [ ] 45 | ahmed → **Activity** → **Show older** | Sessions, orders, wallet, bookings, points in one list, older ones load |
| - [ ] 46 | Create customer "ahmed2" with display name `Ahmed`, top up 20 → open ahmed → **Merge duplicate** | ahmed2 is offered as "looks similar"; after merging (reason) ahmed's wallet is 20 higher and ahmed2 is gone from the list |
| - [ ] 47 | **Export** → keep "only customers who agreed" → **Download CSV** (reason) | CSV with the filtered customers and tags; formula-like names start with `'` |
| - [ ] 48 | Tick sara and ahmed → **Bonus credit** 5 (reason) | Both get 5 bonus, one ledger row each |
| - [ ] 49 | Tick both → **Add to segment / message** → new segment `Test picks` | Marketing → Segments shows it with 2 members |
| - [ ] 50 | ahmed → **Print card** | A card with his name and a QR code; scanning the QR into the Customers search finds him |

### F.2 · Branch Manager (`manager@demo.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | Log in | Sees **DXB1 only**; AUH1 not listed anywhere |
| - [ ] 2 | Purchasing → the headset PO raised by the inventory manager → **Approve** (reason) | APPROVED |
| - [ ] 3 | POS → refund a paid bill (reason) | Refund works (cash / original method / wallet credit) |
| - [ ] 4 | POS → My shift → view all shifts → approve a cashier's shift with variance > 5.00 | Approved; can't approve **their own** |
| - [ ] 5 | Live Floor → start/extend/move/end a session | All work |
| - [ ] 6 | Grant free time on a session | Allowed with a reason |
| - [ ] 7 | Try to open anything for AUH1 by URL | 404 / not visible |
| - [ ] 8 | Employees → try to give someone **Org Owner** | Refused (can't grant what you don't hold) |

### F.3 · Cashier (`cashier@demo.test`) — the main front-desk flow

**Shift**

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | POS → take a **cash** sale **before** opening a shift | `no_open_shift` |
| - [ ] 2 | My shift → **Open** on "Front desk" drawer, float 200 | Open |
| - [ ] 3 | Another cashier opens the same drawer | `drawer_in_use` |

**Walk-in gaming (a real PC from part D)**

| # | Do | Expect |
|---|---|---|
| - [ ] 4 | Live Floor → PC-01 → **Start session**: guest, 1 hour, cash 20 (if 15 due) | Quote shown first; change calculated; PC-01 turns **red**; the Shell **unlocks** and shows the countdown |
| - [ ] 5 | Press Start twice fast / refresh during start | Charged **once** |
| - [ ] 6 | **Extend** 30 min, pay card | Countdown on the PC jumps up |
| - [ ] 7 | **Move** session to PC-02 | PC-01 locks, PC-02 unlocks with the **same** end time |
| - [ ] 8 | Start a 6-minute session; wait | Warnings on the PC at 5 and 1 min; tile turns **orange** (ending soon) at ≤ 5 min; at 0 the PC **locks** and the tile goes green |
| - [ ] 9 | Start a **pay-at-the-end** (open) session, play 10 min, end it | Bill calculated at the end with rounding |
| - [ ] 10 | Start a session with promo code **HAPPY20** (inside its hours) | 20 % off; outside hours → `promo_not_applicable` |
| - [ ] 11 | **Night pass** after midnight | Ends at 06:00 |
| - [ ] 12 | Try **Restart PC** on a station | **Refused** (cashiers can lock, not restart) |
| - [ ] 13 | Try to **refund** | **Refused** (manager only) |

**Customers and wallet**

| # | Do | Expect |
|---|---|---|
| - [ ] 14 | Customers → register a new customer "testuser" with phone and DOB | Created; phone is **masked** in lists |
| - [ ] 15 | Top up testuser 100 cash | Wallet 100 |
| - [ ] 16 | Top up **with bonus** | Refused (needs `customer.adjust_wallet`) |
| - [ ] 17 | Sell **Silver** membership from the wallet | Tier set; 60 bonus minutes; next quote −10 % |
| - [ ] 18 | Sell prepaid time (2-hour package) to testuser | TIME balance +120 |
| - [ ] 19 | Start a session paid by **WALLET** with too little credit | `insufficient_funds`, nothing charged |
| - [ ] 19b | testuser → **Notes** → add `Prefers PC 12` | Note shows your name and time; the manager sees it too, but can't delete it |
| - [ ] 19c | testuser → **Tickets** → **Open a ticket** (Payment, `Charged twice`) → **Resolve** | Ticket goes from open to resolved |
| - [ ] 19d | testuser → **Profile** → phone → **Mark verified** | "verified" badge with today's date |
| - [ ] 19e | Try **Restrictions → Restrict**, **Merge duplicate**, **Export** | Not offered to a cashier |

**POS (counter)**

| # | Do | Expect |
|---|---|---|
| - [ ] 20 | POS → Burger + extra cheese + Cola, counter, cash | Price includes modifiers + 5 % VAT; change shown |
| - [ ] 21 | Split payment: part cash, part card, part wallet | Bill settled; totals match |
| - [ ] 22 | Order **to a PC** (GAMING_SEAT) for PC-01 | Goes on the running session's bill |
| - [ ] 23 | Discount 10 % | Allowed up to the cashier's limit |
| - [ ] 24 | Void an item **before** the kitchen starts | Works |
| - [ ] 25 | X-report | Sales by method, expected cash |
| - [ ] 26 | Pay-out 50 "ice", then **close** with a count 10 short | Shift goes to **PENDING_APPROVAL** (manager approves in F.2 #4) |

**Bookings**

| # | Do | Expect |
|---|---|---|
| - [ ] 27 | Bookings → new booking for 2 PCs tomorrow 18:00, 2 h, ahmed | Confirmed; the day timeline shows it |
| - [ ] 28 | Book the same PC and time again | Refused (no double booking) |
| - [ ] 29 | Book a PC 30 min from now, then try a **walk-in** on it for 1 h | `device_booked` with the minutes still free |
| - [ ] 30 | Check-in 15 min before start, pay from wallet | Sessions start on both booked PCs |
| - [ ] 31 | Leave a booking 15 min late | Auto **NO_SHOW**, PC released |

**Consoles & VR** (agentless, part E)

| # | Do | Expect |
|---|---|---|
| - [ ] 32 | PS5-01 → start 1 h, **3 players** | 20 + 5 (extra player); can't exceed 4 controllers |
| - [ ] 33 | TV-01 | Shows the player's first name and countdown; at the end "Time's up — hand back the controllers" |
| - [ ] 34 | VR-01 for **sara** (13) → allowed; guest with age unknown | Must tick **age confirmed** |
| - [ ] 35 | End VR-01 session | Goes to **CLEANING**; can't be sold until **Mark cleaned** |
| - [ ] 36 | Gear check: mark a controller **missing** | `ACCESSORY_ISSUE` alert on Live Floor until a later check says OK |

**Printing:** Admin → Printing → release/cancel queued jobs (E.3).

### F.4 · Technician (`tech@demo.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | Live Floor → PC drawer → **Repairs**: Flush DNS, Renew IP, Restart audio, Clear temp, Sync time, Restart shell, Close games | Each runs and reports success (simulated in safe mode except DNS/Shell) |
| - [ ] 2 | Restart / shut down / wake a PC | Allowed |
| - [ ] 3 | View hardware, network, peripherals, boot mode | Visible |
| - [ ] 4 | Try to start a session, sell, or touch a wallet | **Refused** / not shown |
| - [ ] 5 | Ack a `CLIENT_OFFLINE` alert | Acknowledged |

### F.5 · Waiter (`waiter@demo.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | Restaurant → tables T1–T6 | Status map |
| - [ ] 2 | Add order to **T3**: pizza + coffee (oat milk) | T3 → OCCUPIED; tickets go to Kitchen and Bar |
| - [ ] 3 | Pay T3's bill | T3 → CLEANING; mark free |
| - [ ] 4 | Try to mark a table free while its bill is open | Refused |
| - [ ] 5 | Try refunds / wallets | Refused |

### F.6 · Kitchen Staff (`kitchen@demo.test`) — use a tablet

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | Open **Kitchen**, go full-screen, pick station filter "Kitchen" | Filter remembered on reload |
| - [ ] 2 | Waiter/cashier places an order | Chime; ticket appears in **New** instantly |
| - [ ] 3 | Bump → Cooking → Ready → Served | Order status follows; for an in-seat order the **PC shows a toast** at each step |
| - [ ] 4 | Leave a ticket 12+ min | Turns red |
| - [ ] 5 | Mark a product **sold out (86)** | Disappears from POS and the Shell food menu |

### F.7 · Inventory Manager (`inventory@demo.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | Inventory → overview | Stock value per store; **energy drink low**; **milk batch expiring** |
| - [ ] 2 | Sell a burger at POS, then check stock | Buns, patty, cheese decreased by the recipe |
| - [ ] 3 | Record **waste** of 2 buns (reason) | Stock down; can't go below zero |
| - [ ] 4 | **Transfer** 10 colas Main → Bar | Both stores updated |
| - [ ] 5 | **Stock count**: enter a different quantity | Variance recorded |
| - [ ] 6 | Issue a spare headset to PC-01 (serial) | Recorded against the device |
| - [ ] 7 | Purchasing → **Reorder** | One draft PO per supplier for low items |
| - [ ] 8 | Submit a PO over 2,000 | PENDING_APPROVAL; **can't approve own** |
| - [ ] 9 | Receive the "on its way" PO partially, then fully; try to receive more than ordered | Partial → full; over-receipt refused |
| - [ ] 10 | Supplier invoice: record, match to PO (MATCHED/OVER/UNDER), pay in two parts | Can't pay more than the invoice |
| - [ ] 11 | Restaurant → Menu → costing | Food cost % and margin per item |

### F.8 · Roles you created in F.1

| Role | Must be able to | Must NOT be able to |
|---|---|---|
| - [ ] **Org Admin** | Everything operational across branches | Change payment gateways, API keys, customer erasure, disable the shell |
| - [ ] **Gaming Manager** | Sessions, rates (view), games, tournaments, bookings | Restaurant menu, purchasing |
| - [ ] **System Admin** | Stations, shell config, diskless, games, notifications, audit | Wallets, POS, refunds |
| - [ ] **Receptionist** | Customers, bookings, start sessions, memberships (sell) | Refunds, rates, inventory |
| - [ ] **Restaurant Manager** | Menu, tables, KDS, cancel cooked orders (reason), shifts | Stations, wallets |
| - [ ] **Accountant** | View shifts, wallets ledger, purchasing, audit | Selling, stations |
| - [ ] **Tournament Manager** | Create/run tournaments, enter scores | POS, wallets |

For each, log in, confirm the menu shows only allowed pages, and try one
forbidden action by URL — you should get a **403** with the permission name,
never a crash.

### F.9 · Tournaments (`owner` or `tourney@demo.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | Create "Valorant Cup", single elimination, team size 1, entry fee 10, prizes to wallet | Draft |
| - [ ] 2 | Open entries; register 5 teams (some from the customer app) | Fee charged; a player can't join two teams |
| - [ ] 3 | Check-in, **Start** | Bracket built; top seeds get byes |
| - [ ] 4 | Enter scores round by round; assign stations to a match | Winners advance automatically |
| - [ ] 5 | Finish | Placements; prize in the captain's wallet; every player +50 pts |
| - [ ] 6 | Repeat quickly with **double elimination**, **round robin** (a draw allowed), **Swiss** (odd count → bye) | Correct standings (3/1/0 pts) |
| - [ ] 7 | Withdraw a team / cancel a tournament | Entry fees refunded |

### F.10 · Customer at the gaming PC (Gaming Shell)

On a real PC signed in as the Windows `Player` account:

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | Sign in `ahmed` / `ahmed123` | Unlocks with his prepaid time; Live Floor shows him on the PC |
| - [ ] 2 | Sign in with **PIN** 1234 instead | Works |
| - [ ] 3 | Wrong password 9 times fast | Throttled |
| - [ ] 4 | ahmed tries a second PC while playing | `already_playing` |
| - [ ] 5 | `sara` (no time) | `no_time` |
| - [ ] 6 | **Games**: search, filter, launch a game | Starts; Live Floor shows the gamepad badge "now playing" |
| - [ ] 7 | As **sara** with time: PEGI 16/18 games | Hidden / refused |
| - [ ] 8 | **Platforms** (Steam/Epic) and **Internet** | Open |
| - [ ] 9 | **Connection** screen | Live ping to router/Cloudflare/Google |
| - [ ] 10 | **Peripherals**: change mouse speed | Applies; restored after logout |
| - [ ] 11 | **Support** → call staff | Bell badge on the Live Floor; staff "On my way" shows on the PC |
| - [ ] 12 | Support self-fixes: Flush DNS, Restart audio, Restart shell | Each works; audited |
| - [ ] 13 | **Food** → order a burger, pay "on my bill" and then "from wallet" | Ticket in Kitchen; status toasts on the PC |
| - [ ] 14 | Switch language to **العربية** | Right-to-left Arabic UI |
| - [ ] 15 | **Log out** | Unused minutes go back to his balance; games and launchers closed; PC locks |

Browser-only version (no PC): `http://localhost:5174` (mock agent), and
`http://localhost:5174/?session=90` to start with 90 s left.

### F.11 · Customer app (phone: `http://SERVER:5175/demo`)

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | **Sign up** "phoneuser" with ahmed's invite code, DOB, marketing opt-in | Account created |
| - [ ] 2 | Add to home screen | Installs as an app (PWA) |
| - [ ] 3 | Home | Wallet, prepaid time, membership, playing now, next booking |
| - [ ] 4 | **Book**: zone → day → pick PCs → length → time → **Pay now** (demo card) | Booking confirmed; money credited to wallet, used at check-in |
| - [ ] 5 | Book → **Pay at venue** | Confirmed, unpaid |
| - [ ] 6 | Cancel a booking > 60 min before start; try < 60 min | First works, second refused |
| - [ ] 7 | **Shop**: buy time package and a membership from the wallet | Balances update; insufficient funds refused |
| - [ ] 8 | **Wallet** history | Every movement listed |
| - [ ] 9 | **Rewards**: redeem "30 free minutes" | Minutes added; personal codes shown for discount rewards |
| - [ ] 10 | **Tournaments**: register a team with a friend's username | Fee from wallet |
| - [ ] 11 | **Inbox** | Campaign messages with personal code; unread badge clears |
| - [ ] 12 | After phoneuser's first paid bill | ahmed gets **+200** referral points (once) |
| - [ ] 13 | Log out; reuse the old tab | Token dead, sent to login |
| - [ ] 14 | **Me → Profile & settings**: change name, set birth date, language **العربية** | Saved; the whole app switches to Arabic, right to left; birth date can't be changed again |
| - [ ] 15 | Change password; open the app on a second phone first | Second phone is signed out |
| - [ ] 16 | Set a PC PIN, then sign in at a PC with username + PIN | Works |
| - [ ] 17 | Staff: Customers → phoneuser → **Password / PIN → Give a reset code**; app: **Forgot password?** with the code | New password works; the code doesn't work twice |
| - [ ] 18 | At a free PC, scan the QR on the sign-in screen with the phone → **Sign in on PC-xx** | The PC unlocks with your saved time; the same QR can't be used again |
| - [ ] 19 | While playing: Home → **Add time** (package) and **Order food** (pay with bill) | Countdown on the PC jumps; the order reaches the kitchen and its status shows in the app |
| - [ ] 20 | Home: **Free right now** | Free stations per zone match the Live Floor |
| - [ ] 21 | **Games**: star a game | It moves to the top; shows how many PCs have it |
| - [ ] 22 | **Wallet → Send a gift** 10 to ahmed; **Wallet → Top up** 50 (demo card) | ahmed gets the money and an inbox message; your wallet +50 |
| - [ ] 23 | **My bookings → Split with friends** (ahmed); ahmed: Inbox → **Pay my share** | ahmed's share moves into your wallet; the booking shows "paid" |
| - [ ] 24 | Owner: Marketing → Loyalty → **Challenges** → "First visit: 1 day visited, 25 points"; play once | The challenge shows done in **Rewards** and the points arrive |
| - [ ] 25 | **Rewards → Show my first name on the board** | You appear in "Top players this month" |
| - [ ] 26 | **Help**: send "Charged twice" | Staff see it in the customer's Tickets tab |
| - [ ] 27 | **Notifications → On** (browser, not the APK); start a short session for yourself | "10 minutes left" arrives on the phone; tapping it opens the app |
| - [ ] 28 | **Delete my account** with money in the wallet; then empty it and try again | First refused; then erased and sign-in fails |

---

## G · Security and isolation tests

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | Log in as **owner@rival.test** | Sees only "Rival Gaming": no Demo Arena branches, PCs, customers |
| - [ ] 2 | As rival, paste a Demo Arena URL (e.g. a customer or device id from the other browser) | **404**, never the data |
| - [ ] 3 | As rival, open Purchasing | `FEATURE_DISABLED` (Starter plan) |
| - [ ] 4 | Wrong password for an existing email vs an unknown email | **Same** error message |
| - [ ] 5 | 5 wrong passwords in a row | Account locked (423) |
| - [ ] 6 | Reuse an enrolment code after its PC count is used up | "invalid, expired, revoked or used up" |
| - [ ] 7 | Admin → Computers → **Retire** a PC | It disconnects at once; the agent gets 401 on reconnect. Re-enrol with a new code → **same station** comes back (same MAC) |
| - [ ] 8 | Customer app login for `ahmed` on a different venue slug | Refused |
| - [ ] 9 | Every sensitive action you did in F | Has an audit row with your reason |
| - [ ] 10 | On a gaming PC, as `Player`, try to stop the ArenaAgent service or edit `C:\ProgramData\ArenaOS\Agent` | Access denied |

---

## H · Failure and recovery tests

| # | Do | Expect |
|---|---|---|
| - [ ] 1 | Start a 10-min session on PC-01, then **unplug its Ethernet** until past the end time | The PC **locks by itself** ~20 s after expiry (fail-safe); server closes the bill on time |
| - [ ] 2 | Start a session, **reboot the PC** | It comes back **still locked or still in the same session** — a reboot never unlocks it |
| - [ ] 3 | Start a session, **stop the API** (Ctrl+C) past the session's end, start the API again | First sweep closes the expired session; PC locks |
| - [ ] 4 | End a session in admin while the PC is offline, then reconnect it | PC receives END and locks (resync) |
| - [ ] 5 | Send a message to an offline PC, bring it back within 5 min | Delivered on reconnect; after expiry it shows EXPIRED |
| - [ ] 6 | Game library with the network unplugged | Library still shows (cached, signed config) |
| - [ ] 7 | Restart Docker (`docker compose restart`) | API recovers; no data lost |

---

## I · Troubleshooting

| Symptom | Check |
|---|---|
| Gaming PC can't reach `http://SERVER:4000/health` | Firewall rules (B.3), network profile **Private**, same subnet, server IP unchanged |
| Enrol: "code invalid…" | Code expired, used up, or typed wrong. Make a new one |
| Enrol: 402 | Plan's device limit; retire an old station |
| PC shows Offline | `Get-Service ArenaAgent`; logs in **Event Viewer → Windows Logs → Application** (source ArenaAgent); run in console to see errors: stop the service, `ArenaAgent.exe run` |
| Shell window blank | WebView2 runtime missing (the installer warns); rebuild with `package.ps1`, which builds the Shell UI first |
| Shell doesn't appear after Windows sign-in | Safe mode on (`ArenaAgent.exe status`), the account is an administrator, or `C:\Program Files\ArenaOS\Shell\ArenaShell.exe` is missing (re-run `install-agent.ps1` from the full package). The agent logs the reason at startup in Event Viewer |
| Shell says it can't reach the agent | Agent must run as the **service** for `--kiosk`; use `--dev` with a console agent |
| Restart/lock "does nothing" | The PC is in **safe mode**: `ArenaAgent.exe status`; `ArenaAgent.exe safe-mode off` then `Restart-Service ArenaAgent` |
| Wake-on-LAN fails | BIOS WOL on, ErP off, fast startup off, **another PC online on the same LAN** |
| No GPU temp | Only NVIDIA via `nvidia-smi` |
| No CPU temp | Many consumer boards don't expose it; expected |
| Prints go straight through | Safe mode is on (print control is off in safe mode) or printing isn't set up for the branch |
| Customer app on phone shows no data | Phone must be on the same LAN; open via `SERVER` IP, not `localhost` |
| Need a clean start | `docker compose -f infra/docker-compose.yml down -v`, then B.4 again (deletes all data) |

Uninstall from a PC: run `uninstall-agent.ps1` as Administrator in the agent
folder. It removes the service and the Shell (add `-Purge` to also delete the
station identity).

---

## J · Not built yet (don't test)

| Area | Status |
|---|---|
| **Finance** and **Reports** pages | Phase 11 (greyed out in the menu) |
| **Super Admin impersonation, client releases** | Platform roles, organizations, plans and audit are built ([K](#k--super-admin-platform)); impersonating a venue's staff and pushing client releases aren't |
| **Full kiosk lockdown** (Explorer replacement, key filtering, staff exit, maintenance-mode PIN unlock) | Phase 13. The Shell autostarts and is restarted if killed, but Windows keys and Ctrl+Alt+Del still work today |
| **Real online payments** | "Pay now" and the app's wallet top-up use a demo card; both are off in production |
| **SMS / e-mail / WhatsApp delivery** | Goes to the dev outbox until a provider is connected. Customer phone/email verification is a staff **Mark verified** button for the same reason |
| **Diskless providers' own APIs** | Boot mode is detected; provider integration later |
| **Multiple API servers** | In-memory live bus; one API node per venue for now |

---

## K · Super Admin (platform)

Needs the platform service running (`npm run dev:platform -w @arena/api`). Details: [17 · Super Admin](17-super-admin.md).

| # | Do | Expect |
|---|---|---|
| - [ ] K.1 | `http://SERVER:3000/login` → `super@arenaos.test` / `ArenaDemo!2026` | The same page switches to **"ArenaOS platform · Super Admin sign-in"** and shows a QR code |
| - [ ] K.2 | Scan the QR with Google Authenticator / 1Password / Authy, type the 6-digit code | Lands on `/platform` → **Overview** with organizations, revenue, stations, plan mix |
| - [ ] K.3 | Sign out, sign in again | Asks only for the code (no QR) |
| - [ ] K.4 | Wrong password 5 times | "Too many failed attempts" (locked for 15 min) |
| - [ ] K.5 | **Organizations** → search "demo", filter **Active** | Demo Arena listed with branches, stations, staff, customers |
| - [ ] K.6 | **New organization**: name "Test Arena", plan Starter, 14-day trial, owner `you@test.local` | Shows a temporary password once. Sign in at `/login` with it: you're that venue's owner, asked to set up two-step sign-in |
| - [ ] K.7 | Open Test Arena → **Suspend** without a reason | Refused: a reason is required |
| - [ ] K.8 | Suspend with a reason | In another browser, the Test Arena owner is signed out and can't sign in ("no access") |
| - [ ] K.9 | **Reactivate** | The owner can sign in again |
| - [ ] K.10 | **Subscription** tab → change plan, set Max stations 5, **+30 days** | Saved; the venue's limits change (adding a 6th station is refused) |
| - [ ] K.11 | **Features** tab → turn **Tournaments** off with a reason | The venue's admin loses the Tournaments module |
| - [ ] K.12 | **Plans & features** → edit Starter's price; tick a module on a plan | Saved; organizations on that plan follow it |
| - [ ] K.13 | **Audit log** | Every action above, with who, when and the reason |
| - [ ] K.14 | Signed in as `owner@demo.test` (venue staff), open `/platform` | Sent to sign-in: staff sessions don't work on the platform |
| - [ ] K.15 | Ctrl+K on any platform page | Search jumps to pages and "New organization" |

---

## L · Downloads (desktop EXEs, APK, installer)

Build them with the commands in [18 · Live demos](18-live-demos.md), or download them from the website's **Download** section (`http://SERVER:5180/#downloads`).

### L.1 · ArenaOS-Console.exe (admin + Super Admin)

| # | Do | Expect |
|---|---|---|
| - [ ] L.1.1 | Double-click it. If Windows SmartScreen appears: **More info → Run anyway** (the demo isn't code-signed) | A start screen: **Explore the demo venue** or **Connect to your ArenaOS** |
| - [ ] L.1.2 | **Open the live demo** → pick Owner → Sign in | The venue console with the live floor, everything clickable |
| - [ ] L.1.3 | **Ctrl+Shift+H** | Back to the start screen. **F11** toggles full screen |
| - [ ] L.1.4 | **Connect** → `http://SERVER:3000` | Your real admin sign-in page (needs the server from [B](#b--set-up-the-server-pc)) |
| - [ ] L.1.5 | Close and reopen | It remembers your last choice |

### L.2 · ArenaOS-Shell-Demo.exe

| # | Do | Expect |
|---|---|---|
| - [ ] L.2.1 | Run it (while the Console is open too) | The Gaming Shell in a normal window, station **PC-01** |
| - [ ] L.2.2 | Sign in ahmed / ahmed123 | Countdown starts; the Console's Live Floor shows PC-01 in use |
| - [ ] L.2.3 | In the Console, message or end PC-01 | The Shell shows the message / locks |

### L.3 · ArenaOS-Customer.apk (Android)

| # | Do | Expect |
|---|---|---|
| - [ ] L.3.1 | Copy the APK to the phone (or open the website's download link on the phone) and tap it. Allow **Install unknown apps** when asked | An app called **Arena** with the ArenaOS icon |
| - [ ] L.3.2 | Open it, sign in ahmed / ahmed123 (works in flight mode) | Wallet AED 170, 2 h prepaid time |
| - [ ] L.3.3 | Book, Shop → buy a time package, Rewards → redeem, Tournaments → join | Each works; wallet and points change |

### L.4 · ArenaOS-Station-Setup.exe (real station, on a gaming PC)

This is the real installer: it installs the agent service and the kiosk Shell and changes the PC. Use a gaming PC, not your own computer. It replaces the manual steps in [D.5](#d5--enrol-and-install-the-agent-per-pc-as-administrator)–[D.6](#d6--gaming-shell-autostart-per-pc).

| # | Do | Expect |
|---|---|---|
| - [ ] L.4.1 | Admin → **Computers → Add stations** → create a code | A code like `ARENA-XXXXX-…` |
| - [ ] L.4.2 | On the gaming PC, run the installer as Administrator; enter the server address `http://SERVER:4000` and the code | Installs without errors |
| - [ ] L.4.3 | Restart the PC | The Gaming Shell starts on its own; the PC appears on the Live Floor within seconds |
| - [ ] L.4.4 | Continue with the per-PC checklist [D.8](#d8--per-pc-acceptance-checklist) | |

---

### Sign-off

| Part | Tester | Date | Pass / issues |
|---|---|---|---|
| 0 Quick tour | | | |
| B Server | | | |
| C Automated | | | |
| D Gaming PCs | | | |
| E Consoles / TV / plug / printer | | | |
| F Roles | | | |
| G Security | | | |
| H Recovery | | | |
| K Super Admin | | | |
| L Downloads | | | |
