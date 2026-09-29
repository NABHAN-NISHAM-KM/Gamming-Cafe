# 20 · End-to-end walkthrough: every role, every feature, on the real system

One story from start to finish, on the **real** system (not the demo):

1. **Super Admin** opens a brand-new venue on the platform.
2. The **Owner** builds that venue from zero: branch, zones, prices, stations, menu, stock, staff.
3. A **Customer** signs up, books, plays at a real PC, orders food.
4. Each **staff role** does their job: cashier, waiter, kitchen, technician, inventory, manager, accountant.
5. The **Owner** reads reports and the books; the **Super Admin** manages the account.

Work top to bottom and tick each box. When something doesn't match **Expect**, write down the step number (e.g. "3.4") and what you saw.

**Time:** about 5–6 hours in total; you can stop after any act.

---

## Before you start

### What you need

| | |
|---|---|
| Your laptop | Runs the server **and** acts as gaming PC "PC-01" |
| An **authenticator app** on your phone | Google Authenticator, Microsoft Authenticator, 1Password or Authy (for two-step sign-in) |
| Your **phone** on the same Wi-Fi | Customer app and staff screens |
| **Several browser windows** | Each role in its own window: a normal window, an **InPrivate/Incognito** window, and a second browser (Edge + Chrome). Each keeps its own sign-in |
| Steam or Epic with a small game (optional) | Game detection and launching |

### Start the system (every time)

Open **Docker Desktop** and wait until it's running, then open 5 terminals in `D:\Projects\Gamming`:

```bash
docker compose -f infra/docker-compose.yml up -d
```

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

First time only (or after pulling new code), in another terminal:

```bash
cd packages/db && npx prisma migrate deploy && cd ../.. && npm run seed -w @arena/api
```

- [ ] **0.1** `http://localhost:3000/login` shows the sign-in page.
- [ ] **0.2** `http://localhost:4100/health` shows `{"ok":true,...}`.

For the phone: run `ipconfig`, note your laptop's **IPv4 address** (e.g. `192.168.1.5`), and open the firewall once (PowerShell as Administrator):

```powershell
New-NetFirewallRule -DisplayName "ArenaOS dev" -Direction Inbound -Protocol TCP -LocalPort 3000,4000,5175 -Action Allow -Profile Private
```

In this guide, **`LAPTOP`** means that IP address.

---

## Act 1 · Super Admin: open a new venue

**Window A** (normal browser window).

| # | Do | Expect |
|---|---|---|
| - [ ] 1.1 | Open `http://localhost:3000/login`, sign in `super@arenaos.test` / `ArenaDemo!2026` | The page switches to **ArenaOS platform · Super Admin sign-in** and shows a **QR code** |
| - [ ] 1.2 | Scan the QR with your authenticator app, type the 6-digit code, **Turn on & sign in** | **Overview**: organizations, recurring revenue, stations online, people, sign-ups chart, plan mix, activity |
| - [ ] 1.3 | Press **Ctrl+K**, type "plans", Enter | Jumps to **Plans & features** |
| - [ ] 1.4 | Look at the 3 plans and the **Modules by plan** table | Starter / Pro / Enterprise with limits and ticks |
| - [ ] 1.5 | **Organizations → New organization**: name **My Arena**, slug `my-arena`, country UAE, plan **Pro**, free trial 14 days, owner **your name**, email `owner@myarena.test` → **Create** | "Organization created" with a **temporary password** shown once. **Copy it** |
| - [ ] 1.6 | **Open organization** | My Arena, status **trial**, 0 branches, you as owner |
| - [ ] 1.7 | **Subscription** tab | Plan Pro, trialing, end date in 14 days, limits from the plan |
| - [ ] 1.8 | **Features** tab | Every module and whether the plan includes it |
| - [ ] 1.9 | **Audit log** | Your sign-in and "created the organization" |

Leave window A open; you'll come back in Act 6.

---

## Act 2 · Owner: build the venue from zero

**Window B** (InPrivate/Incognito).

### 2A · First sign-in

| # | Do | Expect |
|---|---|---|
| - [ ] 2.1 | `http://localhost:3000/login` → `owner@myarena.test` + the temporary password | Lands on the **Dashboard** of *My Arena*. Header shows **Enable 2-step sign-in** |
| - [ ] 2.2 | **Settings** → turn on 2-step sign-in: scan the QR, enter the code | 2-step sign-in **On** |
| - [ ] 2.3 | Sign out and in again | Asks for the 6-digit code after the password |
| - [ ] 2.4 | Look around: sidebar, **Ctrl+K** search, empty states | Every page loads; empty pages explain what to do next |

### 2B · Branch and zones

| # | Do | Expect |
|---|---|---|
| - [ ] 2.5 | **Branches & zones → New branch**: code `MH1`, name **Main Hall**, time zone Asia/Dubai | Branch listed |
| - [ ] 2.6 | Open **Main Hall** → add zones: **Regular PCs** (PC standard), **VIP** (PC VIP), **PS5 Lounge** (console), **Restaurant** (restaurant) | 4 zones |

### 2C · Prices

| # | Do | Expect |
|---|---|---|
| - [ ] 2.7 | **Rates → New rate**: "Regular PC", PCs, per hour, **15**, prepaid | Listed |
| - [ ] 2.8 | On it, **Add package**: "1 hour" 60 min AED 15; "3 hours" 180 min AED 40 | Packages under the rate |
| - [ ] 2.9 | **New rate** "VIP PC", 25/hour, zone **VIP** | The VIP zone uses this rate |
| - [ ] 2.10 | **New rate** "Pay as you go", 18/hour, **postpaid** | For open sessions (pay at the end) |
| - [ ] 2.11 | **New rate** "PS5", consoles, 20/hour | |

### 2D · Stations

| # | Do | Expect |
|---|---|---|
| - [ ] 2.12 | **Computers → Add stations**: zone Regular PCs, 1 PC, 24 h → copy the code | Code `ARENA-XXXXX-…` (shown once) |
| - [ ] 2.13 | Run `apps\website\downloads\ArenaOS-Station-Setup.exe` **as administrator**. Server `http://localhost:4000`, the code, name `PC-01`, **tick Test mode** | Installs |
| - [ ] 2.14 | **Live Floor** | **PC-01** green. Click it: CPU/GPU/RAM, hardware, network, peripherals |
| - [ ] 2.15 | **Games** | Games installed on your laptop show "installed on 1 PC". Open one: set an age rating, mark it featured |
| - [ ] 2.16 | **Consoles & VR** → add a **PS5** in PS5 Lounge | Shows on the Live Floor as a console |
| - [ ] 2.17 | Live Floor → **Edit layout**, drag stations, **Save** | Layout kept after refresh |

### 2E · Food and drink

| # | Do | Expect |
|---|---|---|
| - [ ] 2.18 | **Restaurant → Menu → + Kitchen station**: add **Kitchen**, then **Bar** | Both stations exist |
| - [ ] 2.19 | **+ Category**: Burgers, Drinks | |
| - [ ] 2.20 | **+ Options group**: "Extras" (0–3): Cheese +3, Bacon +5 | |
| - [ ] 2.21 | **+ Product**: "Smash burger" AED 32, category Burgers, station **Kitchen**, options Extras, show on PCs. "Cola" AED 8, Drinks, station **Bar** | On the menu |
| - [ ] 2.22 | **Restaurant → Tables → Add table**: T1–T4 | Tables shown, all available |
| - [ ] 2.23 | **POS → My shift** | "No cash drawer yet" → **Add cash drawer** "Front desk" |

### 2F · Stock and suppliers

| # | Do | Expect |
|---|---|---|
| - [ ] 2.24 | **Inventory → Add store**: "Main store" (branch store), "Kitchen" (kitchen) | Two stores |
| - [ ] 2.25 | **Inventory → Items → Add**: Cola can (piece), Burger bun (piece), Beef patty (piece) | Items listed |
| - [ ] 2.26 | **Restaurant → Menu** → recipe icon on Smash burger: 1 bun + 1 patty. On Cola: link the Cola can stock item | Food cost shows a margin |
| - [ ] 2.27 | **Purchasing → Suppliers**: add "Metro Foods" | |
| - [ ] 2.28 | **Purchasing → New order** from Metro Foods to Kitchen: 50 buns, 50 patties; 48 colas to Main store → **Submit → Approve → Mark ordered** | PO status moves along |
| - [ ] 2.29 | **Receive** the delivery (all of it) | Inventory shows the stock in each store |
| - [ ] 2.30 | Record the **supplier invoice** and **Record payment** | Invoice paid |

### 2G · Customers, loyalty and marketing

| # | Do | Expect |
|---|---|---|
| - [ ] 2.31 | **Customers → Membership tiers**: "Gold" AED 199/30 days, 20% off gaming, 180 min free monthly | Tier listed |
| - [ ] 2.32 | **Marketing → Points rules**: 1 point per AED 1. **Rewards**: "Free cola" for 100 points | |
| - [ ] 2.33 | **Marketing → New promotion**: 10% off food, activate it | Active |
| - [ ] 2.34 | **New segment** (e.g. "All customers") → **New campaign** to the app: "Welcome to My Arena!" | Campaign draft, then sent |
| - [ ] 2.35 | **Tournaments → New tournament**: "FIFA Friday", 1v1, 8 teams, entry AED 20 → **Open registration** | Registration open |

### 2H · Staff

**Employees → Add employee** for each person below: full name, code, email, home branch **Main Hall**, role, and an initial password of 12+ characters (note them down).

| # | Email | Role |
|---|---|---|
| - [ ] 2.36 | manager@myarena.test | Branch Manager |
| - [ ] 2.37 | cashier@myarena.test | Cashier |
| - [ ] 2.38 | waiter@myarena.test | Waiter |
| - [ ] 2.39 | kitchen@myarena.test | Kitchen Staff |
| - [ ] 2.40 | tech@myarena.test | Technician |
| - [ ] 2.41 | stock@myarena.test | Inventory Manager (leave home branch empty = all branches) |
| - [ ] 2.42 | accounts@myarena.test | Accountant (no home branch) |

- [ ] **2.43** **Roles → New custom role** "Night desk": a few cashier permissions only. The editor won't let you add permissions you don't have yourself.

---

## Act 3 · Customer: sign up, book, play, order

### 3A · Customer app (phone)

| # | Do | Expect |
|---|---|---|
| - [ ] 3.1 | On the phone: `http://LAPTOP:5175/my-arena` | **My Arena** sign-in |
| - [ ] 3.2 | **Create an account**: username `sam`, password `player1234` | Home: wallet AED 0, no time |
| - [ ] 3.3 | Owner (window B) → **Customers** → find **sam** → **Top up** AED 100 (cash or card) | Sam's app shows AED 100 (pull to refresh or reopen) |
| - [ ] 3.4 | App → **Shop** → buy "3 hours" (Regular PC) from the wallet | Wallet −40, **3 h prepaid time** |
| - [ ] 3.5 | App → **Book** → Regular PCs, tomorrow 18:00, 2 h, PC-01 | Booking reference; **Bookings** in the admin lists it |
| - [ ] 3.6 | App → **Tournaments** → FIFA Friday → register a team | Entered; wallet −20 |
| - [ ] 3.7 | App → **Inbox** | The welcome campaign |

### 3B · At the gaming PC (your laptop as PC-01)

Turn Test mode off first (PowerShell as Administrator), then create a standard Windows account for players:

```powershell
& "C:\Program Files\ArenaOS\Agent\ArenaAgent.exe" safe-mode off; Restart-Service ArenaAgent
```

Windows **Settings → Accounts → Other users → Add account → "I don't have this person's sign-in info" → Add a user without a Microsoft account**, name `Player`, leave it as a standard user.

| # | Do | Expect |
|---|---|---|
| - [ ] 3.8 | Sign out of Windows, sign in as **Player** | The Gaming Shell opens **full-screen** on its lock screen: My Arena, clock, PC-01 |
| - [ ] 3.9 | Try **Alt+F4** | Nothing happens |
| - [ ] 3.10 | Sign in to the Shell as **sam / player1234** | Countdown **3:00:00**. Admin Live Floor: PC-01 **in use by sam** |
| - [ ] 3.11 | **Games** → launch a game | It starts; the admin shows what's being played |
| - [ ] 3.12 | **Food** → Smash burger + cheese, Cola → pay to bill | Order number shown |
| - [ ] 3.13 | **Peripherals**, **Connection**, **Support → Call staff** | Your devices listed; ping shown; staff get a help alert |
| - [ ] 3.14 | Switch the Shell to **العربية** on the lock screen (after sign-out) | Right-to-left Arabic layout |

Leave sam playing; the staff acts below work with this session. To get back to your own desktop at any time: Ctrl+Alt+Del → Sign out → sign in with your account.

⚠️ With Test mode off, **Restart / Shut down / Lock** from the admin really do that to your laptop. Save your work first.

---

## Act 4 · Staff: every role does its job

Sign each role in at `http://localhost:3000/login` (or `http://LAPTOP:3000/login` on the phone), each in its own window.

### 4A · Cashier (`cashier@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4.1 | **POS → My shift → Open shift** with AED 200 float | Shift open |
| - [ ] 4.2 | **Customers → New customer** "Walk-in Ali" → **Sell prepaid time** 1 h, cash | Ali has 60 min |
| - [ ] 4.3 | **Live Floor** → PC-01 drawer | sam's session: time left, plan, bill |
| - [ ] 4.4 | **Extend** PC-01 by 30 min (cash) | The Shell's countdown jumps +30 min |
| - [ ] 4.5 | **Message** PC-01 "Your burger is coming" | Pops up in the Shell |
| - [ ] 4.6 | **POS**: counter sale 2 × Cola, cash, tender AED 20 | Change AED 4, receipt/bill settled |
| - [ ] 4.7 | Open sam's bill → **Take payment** for the food | Bill settled; the 10% food promotion applied |
| - [ ] 4.8 | Refund one Cola (reason required) | Refund recorded |
| - [ ] 4.9 | Try **Roles** or **Settings → branches** | Not in the menu / "Your role doesn't allow this" |

### 4B · Kitchen (`kitchen@myarena.test`, a tablet or second screen)

| # | Do | Expect |
|---|---|---|
| - [ ] 4.10 | **Kitchen** | sam's burger on **Kitchen**, the Cola on **Bar** |
| - [ ] 4.11 | Tap the burger ticket: Accept → Preparing → Ready | Each tap moves it. The Shell tells sam "being prepared", then "ready" |

### 4C · Waiter (`waiter@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4.12 | **Restaurant → Tables → T2 → Order**: 2 burgers | T2 **occupied**, ticket in the kitchen |
| - [ ] 4.13 | Add a drink to T2, then **Bill requested** | T2 shows the bill total |
| - [ ] 4.14 | Cashier takes payment for T2 (split: half card, half cash) | T2 → **cleaning** → mark **available** |

### 4D · Technician (`tech@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4.15 | Live Floor → PC-01 → **Tools**: run a repair (e.g. Flush DNS) | Command succeeds |
| - [ ] 4.16 | Unplug your mouse for 20 s | **Peripheral missing** alert; acknowledge it |
| - [ ] 4.17 | **Games → Scan PCs**, schedule an update | Scan and update jobs listed |
| - [ ] 4.18 | Put the PS5 into **maintenance**, then back | Floor colour changes |

### 4E · Inventory manager (`stock@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4.19 | **Inventory → Stock (Kitchen)** | Buns and patties down by the burgers sold |
| - [ ] 4.20 | Record **waste**: 2 buns | Movement listed |
| - [ ] 4.21 | **Transfer** 10 colas Main store → Kitchen | Both stores updated |
| - [ ] 4.22 | **Count** the kitchen, enter a different number for one item | Variance shown and posted |
| - [ ] 4.23 | **Purchasing → Reorder** | Low items suggested |

### 4F · Branch manager (`manager@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4.24 | **Bookings** → sam's booking → **Check in** at start time (or **No-show**) | Session starts on PC-01 / booking released |
| - [ ] 4.25 | **Sessions** | Live and recent sessions with what was paid |
| - [ ] 4.26 | Cashier: **Close shift** counting AED 10 less than expected | Goes to **pending approval** |
| - [ ] 4.27 | Manager: approve the shift | Closed, variance recorded |
| - [ ] 4.28 | **Tournaments** → FIFA Friday: seed, start, enter a result | Bracket advances; prize paid to the winner's wallet at the end |
| - [ ] 4.29 | Live Floor → PC-01 → **End session** | The Shell locks. Unused prepaid time goes back to sam |

### 4G · Accountant (`accounts@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4.30 | **Finance → Post now** → **Overview** | Profit & loss (gaming and food revenue, cost of stock) and a balance sheet that balances |
| - [ ] 4.31 | **Journal** | Every sale, payment, refund, top-up, stock movement and supplier bill posted automatically |
| - [ ] 4.32 | **Expenses** → record rent AED 5,000 | Appears in P&L |
| - [ ] 4.33 | **Reports → VAT** and **Cash & shifts** | VAT on sales/purchases; the shift with its variance |
| - [ ] 4.34 | **Close** the period up to yesterday | Earlier dates can't be changed any more |

---

## Act 5 · Owner: the day in numbers

Back in **window B** as the owner.

| # | Do | Expect |
|---|---|---|
| - [ ] 5.1 | **Dashboard** | Revenue today vs last week, bills, sessions, hours played, charts |
| - [ ] 5.2 | **Reports → Sales** | Takings by day, by what was sold, by payment method; **CSV** export works |
| - [ ] 5.3 | **Reports → Gaming utilization** | Occupancy by zone, busiest/quietest stations, when people play |
| - [ ] 5.4 | **Reports → Staff** | Each person's orders, payments, refunds, voids, shift variance |
| - [ ] 5.5 | **Customers → sam** | Wallet history, sessions, loyalty points earned, membership |
| - [ ] 5.6 | Sell sam the **Gold** membership | Next session quote shows the 20% member discount |

---

## Act 6 · Super Admin: manage the account

Back in **window A**.

| # | Do | Expect |
|---|---|---|
| - [ ] 6.1 | **Overview** | My Arena counted: branches, stations, staff, customers |
| - [ ] 6.2 | **Organizations → My Arena → Features**: turn **Tournaments** off (reason "test") | The owner's menu loses Tournaments after a refresh |
| - [ ] 6.3 | **Subscription**: max stations 1, **Save** | Adding a 2nd station is refused ("plan limit") |
| - [ ] 6.4 | **Suspend** (reason "unpaid test") | The owner, cashier… are all signed out and can't sign in |
| - [ ] 6.5 | **Reactivate**, turn Tournaments back on, reset max stations | Everything works again |
| - [ ] 6.6 | **Audit log → Everyone** | The platform actions and the venue's staff actions |

---

## Act 7 · Safety checks

| # | Do | Expect |
|---|---|---|
| - [ ] 7.1 | Sign in as `owner@demo.test` (the seeded Demo Arena) | You never see My Arena's customers, stations or money |
| - [ ] 7.2 | Wrong password 5 times for any account | Locked for 15 minutes |
| - [ ] 7.3 | As the cashier, open `http://localhost:3000/platform` | Sent to sign-in: staff can't reach the platform |
| - [ ] 7.4 | Unplug the network cable during sam's session for 3 min | Shell keeps counting; admin shows PC-01 offline, then back |
| - [ ] 7.5 | Stop the API for 1 min while the Shell is open, start it again | The Shell and floor reconnect on their own |

---

## Cleaning up

- **Settings → Apps → Installed apps → ArenaOS Station → Uninstall** (removes the agent service and the Shell).
- Delete the `Player` Windows account.
- To start over with fresh data: `npm run seed -w @arena/api` (seeded venues), or reset Docker: `docker compose -f infra/docker-compose.yml down -v` then redo "First time only".

Found a problem? Send the step number and what you saw.
