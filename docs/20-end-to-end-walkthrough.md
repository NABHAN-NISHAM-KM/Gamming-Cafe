# 20 · End-to-end walkthrough: every role, every feature, on the real system

One story from start to finish, on the **real** system (not the demo), with every click spelled out:

1. **Super Admin** opens a brand-new venue on the platform.
2. The **Owner** builds that venue from zero: branch, zones, prices, stations, games, menu, stock, marketing, staff.
3. A **Customer** signs up, books, plays at a real PC, orders food.
4. Each **staff role** does their job: cashier, kitchen, waiter, technician, inventory, manager, accountant.
5. The **Owner** reads reports and the books; the **Super Admin** manages the account.

Tick each box as you go. When something doesn't match **Expect**, write down the step number (e.g. "2D.4") and what you saw.

**Time:** about 5–6 hours in total; you can stop after any part.

**Reading the steps:** **Bold** words are menu items, buttons or field names you'll see on screen. "Sidebar → **Rates**" means click *Rates* in the left menu. Every form ends with a purple button (e.g. **Create rate**); press it after filling the fields.

---

## Part 0 · Before you start

### 0.1 What you need

| | |
|---|---|
| Your laptop | Runs the server **and** acts as gaming PC "PC-01" |
| An **authenticator app** on your phone | Google Authenticator, Microsoft Authenticator, 1Password or Authy (for two-step sign-in) |
| Your **phone** on the same Wi-Fi | Customer app; you can also use it as a staff screen |
| **Several browser windows** | Each role in its own window so the sign-ins don't mix: a normal window, an **InPrivate/Incognito** window (Ctrl+Shift+N), and a second browser (Edge + Chrome). Close an InPrivate window to "log out" that role completely |
| Steam or Epic with a game installed (optional) | Game detection and launching |

### 0.2 Start the system (every time)

1. Open **Docker Desktop** and wait until the whale icon says it's running.
2. Open 5 terminals in `D:\Projects\Gamming` and run one command in each. Leave them running.

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

3. **First time only** (or after pulling new code), in another terminal:

```bash
cd packages/db && npx prisma migrate deploy && cd ../.. && npm run seed -w @arena/api
```

- [ ] **0.2a** `http://localhost:3000/login` shows the sign-in page.
- [ ] **0.2b** `http://localhost:4100/health` shows `{"ok":true,...}`.

### 0.3 Let your phone reach the laptop

1. Run `ipconfig` and note the **IPv4 Address** of your Wi-Fi adapter, e.g. `192.168.1.5`. In this guide **`LAPTOP`** means that address.
2. Windows **Settings → Network & internet → Wi-Fi → (your network) → Network profile type: Private**.
3. Open PowerShell **as Administrator** and run:

```powershell
New-NetFirewallRule -DisplayName "ArenaOS dev" -Direction Inbound -Protocol TCP -LocalPort 3000,4000,5175 -Action Allow -Profile Private
```

- [ ] **0.3a** On the phone, `http://LAPTOP:3000/login` opens the sign-in page.

---

## Part 1 · Super Admin: open a new venue

Use **window A** (normal browser window) for the whole Super Admin part.

### 1A · Sign in with two-step verification

1. Go to `http://localhost:3000/login`.
2. **Email** `super@arenaos.test`, **Password** `ArenaDemo!2026` → **Sign in**.
3. The page changes to **ArenaOS platform · Super Admin sign-in** with a QR code.
4. On your phone, open the authenticator app → **+** / **Add account** → **Scan a QR code** → scan it. It shows "ArenaOS Platform" with a 6-digit code that changes every 30 s.
5. Type the code into **Code** → **Turn on & sign in**.

- [ ] **1A.1** You land on **Overview**: organizations, recurring revenue, stations, people, a sign-ups chart, plan mix, platform activity.
- [ ] **1A.2** Sign out (bottom-left arrow) and sign in again: this time it only asks for the 6-digit code (no QR).

### 1B · Look around

1. Press **Ctrl+K**, type `plans`, press **Enter** → **Plans & features**.
   - [ ] **1B.1** Three plans (Starter, Pro, Enterprise) with price, limits (branches, stations, staff) and subscribers. Below, **Modules by plan**: a tick per module per plan.
2. Sidebar → **Platform admins**.
   - [ ] **1B.2** Sam Super Admin, role Super admin, Two-step **On**.

### 1C · Create your venue

1. Sidebar → **Organizations** → **New organization** (top right).
2. Fill in:
   - **Venue name:** `My Arena` (the **Slug** fills itself: `my-arena`; this is also the customer app's link)
   - **Country:** United Arab Emirates
   - **Plan:** Pro
   - **Free trial:** 14 days
   - **Owner name:** your name
   - **Owner email:** `owner@myarena.test`
3. **Create organization**.

- [ ] **1C.1** "Organization created" with a yellow box: **Sign in at /login · Email · Temporary password**. Press **Copy** and paste it somewhere safe (Notepad). It's shown only once.
- [ ] **1C.2** **Open organization**: My Arena, status **trial**, 0 branches, 0 stations, you listed under **Owners & billing**.
- [ ] **1C.3** **Subscription** tab: Plan **Pro**, status trialing, end date in 14 days, limits "Blank = Plan: 5 / 250 / 100".
- [ ] **1C.4** **Features** tab: every module with **On/Off** from the plan.
- [ ] **1C.5** Sidebar → **Audit log**: "signed in to the platform" and "created the organization · My Arena".

Leave window A open; you come back in Part 6.

---

## Part 2 · Owner: build the venue from zero

Use **window B** (InPrivate, Ctrl+Shift+N) for the owner.

### 2A · First sign-in and two-step

1. `http://localhost:3000/login` → **Email** `owner@myarena.test`, **Password** = the temporary password from 1C.1 → **Sign in**.
   - [ ] **2A.1** Dashboard: "Welcome, (your name)" · My Arena · AED · Asia/Dubai. Top right: a yellow **Enable 2-step sign-in** badge.
2. Click **Enable 2-step sign-in** (or Sidebar → **Settings**) → **Turn on** → scan the new QR with your authenticator app → type the code → confirm.
   - [ ] **2A.2** Settings shows 2-step sign-in **On**; the yellow badge is gone.
3. Sign out (bottom-left) and sign in again.
   - [ ] **2A.3** After the password it asks for the 6-digit code.
4. Press **Ctrl+K** and type a few page names; click around the empty pages.
   - [ ] **2A.4** Every page loads; empty pages say what to do next.

### 2B · Branch and zones

1. Sidebar → **Branches & zones** → **New branch**.
   - **Code:** `MH1` · **Name:** `Main Hall` · **City:** Dubai · **Country / Currency / Time zone:** UAE · AED · Asia/Dubai → create.
   - [ ] **2B.1** Main Hall listed.
2. Click **Main Hall** to open it. Under **Zones**, add four zones (**Add zone** each time):

| Name | Type | Minimum age |
|---|---|---|
| Regular PCs | Regular PCs | (empty) |
| VIP | VIP PCs | (empty) |
| PS5 Lounge | Consoles | (empty) |
| Restaurant | Restaurant | (empty) |

   - [ ] **2B.2** Four zones, each with its map colour.

### 2C · Prices (rates)

Sidebar → **Rates** → **New rate** for each:

| # | Name | For | Charged | Price | Paid | Applies to | Zone |
|---|---|---|---|---|---|---|---|
| 1 | Regular PC | PCs | Per hour | 15 | Up front | MH1 · Main Hall | Whole branch |
| 2 | VIP PC | PCs | Per hour | 25 | Up front | MH1 · Main Hall | VIP |
| 3 | Pay as you go | PCs | Per hour | 18 | At the end (open session) | MH1 · Main Hall | Whole branch |
| 4 | PS5 | Consoles | Per hour | 20 | Up front | MH1 · Main Hall | Whole branch |

For the PS5 rate also set **Players included** `2` and **Each extra player** `5`.

Then add time packages to **Regular PC**: on its card press **Add package**:
- **Hours** `1`, **Price** `15` → **Add package**
- **Hours** `3`, **Price** `40`, **Bonus minutes** `15` → **Add package**

Optional: **New rate** "Happy hour", PCs, per hour, 10, tick **Only at certain times**, choose Mon–Thu, 14:00–18:00.

- [ ] **2C.1** Four (or five) rate cards; Regular PC shows its two packages; VIP PC shows the VIP zone.

### 2D · Your laptop becomes PC-01

**2D.1 · Get an enrolment code**

1. Sidebar → **Computers** → **Add stations**.
2. **Zone:** Regular PCs · **PCs this code can add:** `1` · **Valid for (hours):** `24` · **Label:** `My laptop` → create.
3. Copy the code `ARENA-XXXXX-XXXXX-XXXXX-XXXXX`. **It's shown only once.** The screen also shows the enrol command for reference.

- [ ] **2D.1a** Under **Active enrolment codes**: your code, 0 of 1 used.

**2D.2 · Install the station**

1. Open File Explorer → `D:\Projects\Gamming\apps\website\downloads\`.
2. Right-click **ArenaOS-Station-Setup.exe** → **Run as administrator** → **Yes**.
   - If a blue **Windows protected your PC** box appears: **More info → Run anyway** (the test build isn't code-signed).
3. **Welcome** → **Next**. If asked what to do, choose **Connect it again with a new enrolment code** (only appears on a PC that was installed before).
4. Fill in:
   - **Server address:** `http://localhost:4000`
   - **Enrolment code:** paste the code
   - **Station name:** `PC-01`
   - ✅ Tick **Test mode: only simulate restart, shutdown and lock** (keeps your laptop safe while you test)
5. **Next → Install → Finish**.

- [ ] **2D.2a** The final page says the PC is connected and should appear on the Live Floor within a few seconds.
- [ ] **2D.2b** (Optional) PowerShell: `Get-Service ArenaAgent` → **Running**.

**2D.3 · Check it in the admin**

1. Sidebar → **Live Floor** (branch **MH1 · Main Hall**).
   - [ ] **2D.3a** **PC-01** tile in **Regular PCs**, green (**Available**).
2. Click **PC-01**. A drawer opens on the right.
   - [ ] **2D.3b** CPU, GPU, RAM, disk and temperatures move every ~10 seconds.
   - [ ] **2D.3c** Hardware (CPU, GPU, RAM, disks), network (IP, MAC, link speed), and your USB mouse/keyboard/headset under peripherals.
3. In the drawer, **Message** → type `Hello from the admin` → send.
   - [ ] **2D.3d** A message box appears on your laptop.
4. Sidebar → **Computers**.
   - [ ] **2D.3e** PC-01 listed with its agent version, IP and health; the enrolment code now shows 1 of 1 used.

**2D.4 · Add a PS5 (a console has no agent: the server keeps its time)**

1. Sidebar → **Consoles & VR** → **+ Station**.
2. **Name** `PS5-01` · **Kind** Console · **Model** PS5 · **Zone** PS5 Lounge · **Controllers** `4` · **Minimum age** (empty) · **TV display** none → save.
   - The smart-plug fields (**Plug type**, **Address**, **Channel**, **Off after time's up**) are optional; skip them unless you own a Shelly/Tasmota plug.
3. (Optional) Add its controllers: open PS5-01 → accessories → **Type** Controller, **Label** "Pad 1" (repeat for Pad 2).

- [ ] **2D.4a** PS5-01 card: **available**, PS5 · PS5 Lounge.
- [ ] **2D.4b** Live Floor → **PS5 Lounge** shows PS5-01.

**2D.5 · Games**

The game list comes from the platform catalog plus anything found on your PCs. **In a new venue every game starts hidden from the Shell**; you choose what customers see.

1. Sidebar → **Games** → **Scan PCs**. Wait ~30 seconds, then refresh.
   - [ ] **2D.5a** Games installed on your laptop (Steam/Epic) show **Installed (of 1): 1**.
2. For each game you want customers to see:
   - Tick **Shown in Shell** (the column changes to **Yes**).
   - Click the **☆ star** next to 2–3 favourites to feature them on the Shell home screen (the star turns yellow).
   - (Optional) Click **All zones** → tick only **VIP** to make a game VIP-only → save.
3. Add a game the scan didn't find: **Add game** → **Title** (e.g. `Minecraft`) · **Started through** (Its own executable) · **Executable** (full path, e.g. `C:\Games\Minecraft\Minecraft.exe`) · **Game process names** (e.g. `javaw.exe`, closed when the session ends) · **Minimum age** → **Add game**.
4. Tab **Apps**: tick the browsers/launchers/apps players may open (Chrome, Steam, Discord…).
5. Tab **Updates**: if a game shows **N need update**, press **Update** next to it in the library; the job appears here with progress. PCs with a customer on them are never interrupted.

- [ ] **2D.5b** Library shows your chosen games **Shown in Shell: Yes**, featured ones starred.

**2D.6 · Arrange the floor**

1. Sidebar → **Live Floor** → **Edit layout** → drag PC-01 and PS5-01 to where they are in the room → **Save**.
   - [ ] **2D.6a** Positions stay after refreshing the page.

### 2E · Food and drink

Sidebar → **Restaurant** → **Menu** tab (branch **MH1**).

1. **+ Kitchen station** → **Name** `Kitchen` → **Add station**. Again: `Bar` → **Add station**.
2. **+ Category**:
   - **Name** `Burgers`, **Position** `1`, ✅ **Show on customers' PCs** → **Add category**
   - **Name** `Drinks`, **Position** `2` → **Add category**
3. **+ Options group**: **Name** `Extras`, **Must choose at least** `0`, **Can choose up to** `3`, options: `Cheese` +3, `Bacon` +5 → save.
4. **+ Product** (twice):

| Field | Smash burger | Cola |
|---|---|---|
| Name | Smash burger | Cola |
| Category | Burgers | Drinks |
| Price (incl. VAT) | 32 | 8 |
| Kind | Made to order | Ready item (can, snack) |
| Tax class | food | beverage |
| Kitchen station | Kitchen | Bar |
| Prep time (min) | 10 | (empty) |
| Orderable from customers' PCs | ✅ | ✅ |
| Options | Extras | — |

   - [ ] **2E.1** Both products listed with price, kitchen station, "On PCs" ✓, **in stock**.
5. **Tables** tab → **Add table**: `T1` 2 seats, `T2` 4 seats, `T3` 4 seats, `T4` 6 seats.
   - [ ] **2E.2** Four tables, all **available**.
6. Sidebar → **POS** → **My shift**: "This branch has no cash drawer yet" → **Drawer name** `Front desk` → **Add cash drawer**.
   - [ ] **2E.3** The page changes to **Open shift** (don't open one yet; the cashier does in Part 4).

### 2F · Stock and suppliers

1. Sidebar → **Inventory** → **Add store**:
   - **Name** `Main store`, **Type** Branch store, **Branch** MH1 → **Add store**
   - **Name** `Kitchen`, **Type** Kitchen, **Branch** MH1 → **Add store**
   - [ ] **2F.1** Overview: 2 stores, stock value 0.
2. **Items** tab → **Add** (three times): `Cola can` (unit: piece), `Burger bun` (piece), `Beef patty` (piece). Set a **reorder level** of 10 where offered.
3. Back to **Restaurant → Menu**:
   - Chef-hat icon on **Smash burger** (recipe): 1 × Burger bun, 1 × Beef patty → save.
   - Chef-hat icon on **Cola**: **Sold straight from stock item** → Cola can → save.
   - **Food cost** button: - [ ] **2F.2** shows each product's cost and margin (0 cost until stock arrives with a price).
4. Sidebar → **Purchasing** → **suppliers** tab → add supplier: **Name** `Metro Foods`, **Contact** Ahmed, **Phone** any, **Payment terms (days)** `30` → save.
5. **orders** tab → **+ Purchase order** → **Supplier** Metro Foods, **Deliver to** Kitchen → **+ Add an item…** Burger bun (**Qty** 50, **Cost each** 1.00, **Tax %** 5), again Beef patty (50, 4.00, 5) → **Create draft**.
6. Open the order → **Submit**.
   - Total under the approval limit: approved at once ("Under the limit").
   - Over the limit: "Waiting for another manager to approve". You can't approve your own order; finish 2H, then Mona Manager opens it → **Approve**.
7. **Mark as sent to supplier** → **Receive delivery** → quantities are pre-filled (optional **Batch**, **Expires**, **Delivery note**) → confirm.
   - [ ] **2F.3** Status: draft → approved → sent → received.
   - [ ] **2F.4** Inventory → **Stock** (store Kitchen): 50 buns, 50 patties, with value.
8. Repeat 5–7: 48 × Cola can @ 2.00, **Deliver to** Main store.
9. **invoices** tab → **Record supplier invoice** → **Supplier** Metro Foods, **For order** the first PO, **Invoice number** `INV-1001`, **Invoice date** today, **Amount (before tax)** 250, **Tax** 12.50, **Due date** +30 days → save. On the invoice row → **Pay** → **Amount** 262.50, **Paid by** Bank transfer → **Record payment**.
   - [ ] **2F.5** Invoice **paid**. Restaurant → Menu → **Food cost** now shows real margins.

### 2G · Membership, loyalty, marketing, tournament

1. Sidebar → **Customers** → **Membership tiers** → add:
   - **Code** `GOLD` · **Name** Gold · **Price** 199 · **Days** 30 · **Gaming discount %** 20 · **Bonus minutes** 180 · **Book ahead (days)** 14 · **Rank** 20 → save.
   - [ ] **2G.1** Gold tier listed.
2. Sidebar → **Marketing**:
   - **loyalty** tab → **+ Rule** → **For** Food & drinks, **Points** 1 → **Add rule**. Again **For** Gaming, **Per** AED spent, **Points** 1.
   - **+ Reward** → **Name** `Free cola`, **Type** Wallet credit, **Amount** 8, **Points** 100 → **Add reward**.
   - **promotions** tab → **+ Promotion** → **Name** `10% off food`, **Kind** Automatic discount, **Effect** % off, **On** Food & drink orders, **Percent** 10 → **Create** → on its row **Activate**.
   - **segments** tab → **+ Segment** → **Name** `Regulars`, **Kind** Automatic, **Visits in 30 days (at least)** 1 → **Create**.
   - **campaigns** tab → **+ Campaign** → **Name** `Welcome`, **Channel** Customer app inbox, **To** All customers, **Title** `Welcome to My Arena!`, **Message** `Hi {{firstName}}! 10% off food this month.` → **Save as draft**. Don't send yet: it goes only to customers who exist and agreed to marketing, so send it in 3A.
   - [ ] **2G.2** Two rules, a reward, an **active** promotion, a segment and a **draft** campaign are listed.
3. Sidebar → **Tournaments** → **+ Tournament** → **Name** `FIFA Friday`, **Branch** MH1, **Game** EA SPORTS FC, **Format** Single elimination, **Players per team** 1, **Starts** next Friday 20:00, **Most teams** 8, **Fewest teams** 2, **Entry fee (per team)** 20, **Prize pool** 100, **Prizes by place** 1st 70 · 2nd 30 → **Create (as a draft)** → open it → **Open registration**.
   - [ ] **2G.3** FIFA Friday: **Registration open**.

### 2H · Staff

Sidebar → **Employees** → **Add employee**, once for each row. Always: **Home branch** = MH1 · Main Hall (except where the table says *empty*), **Initial password** at least 12 characters (e.g. `ArenaStaff!2026`; write it down).

| # | Full name | Employee code | Email | Role | Home branch |
|---|---|---|---|---|---|
| - [ ] 2H.1 | Mona Manager | M01 | manager@myarena.test | Branch Manager | MH1 |
| - [ ] 2H.2 | Carl Cashier | C01 | cashier@myarena.test | Cashier | MH1 |
| - [ ] 2H.3 | Wendy Waiter | W01 | waiter@myarena.test | Waiter | MH1 |
| - [ ] 2H.4 | Ken Kitchen | K01 | kitchen@myarena.test | Kitchen Staff | MH1 |
| - [ ] 2H.5 | Tom Tech | T01 | tech@myarena.test | Technician | MH1 |
| - [ ] 2H.6 | Ivy Inventory | I01 | stock@myarena.test | Inventory Manager | *empty* (all branches) |
| - [ ] 2H.7 | Andy Accounts | A01 | accounts@myarena.test | Accountant | *empty* (all branches) |

Then:
- [ ] **2H.8** Sidebar → **Roles** → **New custom role** `Night desk`: tick a few cashier permissions. Try to tick a permission you don't have: the editor refuses ("You can't grant permissions you don't hold yourself").
- [ ] **2H.9** Open **Carl Cashier** → set a **PIN** (for quick POS sign-in).

✅ **The venue is ready.** Everything a real café needs before opening day is set up.

---

## Part 3 · Customer: sign up, pay, book, play, order

### 3A · Customer app on the phone

1. On the phone open `http://LAPTOP:5175/my-arena`.
   - [ ] **3A.1** Sign-in screen for **My Arena**.
2. **New here? Create an account** → **Your name** Sam · **Username** `sam` · **Password** `player1234` · date of birth (adult) · ✅ **Tell me about tournaments and offers** → **Create account**.
   - [ ] **3A.2** Home: "Hi, Sam", wallet AED 0, no prepaid time.
   - Owner → **Marketing → campaigns** → Welcome → **Send** → "Sent to 1". Sam's **Inbox** now shows it.
3. Owner (window B) → Sidebar → **Customers** → search `sam` → open → **Top up wallet** → **Amount** 100 · **Paid by** Card → save.
   - [ ] **3A.3** Sam's app (pull down / reopen): wallet **AED 100**.
4. App → **Shop** → **Play time** → "3 hours · Regular PC" → pay from wallet → confirm.
   - [ ] **3A.4** Wallet AED 60, **3 h 15 min** prepaid time (3 h + 15 bonus).
5. App → **Book** → branch Main Hall, zone Regular PCs, tomorrow, 18:00, 2 hours → pick **PC-01** → **Pay at the venue**.
   - [ ] **3A.5** "Booked! BK-…"; Owner → **Bookings** (tomorrow) lists it.
6. App → **Tournaments** → FIFA Friday → team name `Sam FC` → register (entry from wallet).
   - [ ] **3A.6** Entered; wallet −20.
7. App → **Rewards**: points from the purchases; **Free cola** shows how many points are still needed.

### 3B · At the gaming PC (your laptop as PC-01)

**Prepare Windows once:**

1. Turn Test mode off so the kiosk Shell runs (PowerShell **as Administrator**):

```powershell
& "C:\Program Files\ArenaOS\Agent\ArenaAgent.exe" safe-mode off; Restart-Service ArenaAgent
```

2. Create the `Player` account, sign Windows in to it automatically, and give it the Gaming Shell instead of Explorer (no Start menu or taskbar). Same Administrator PowerShell:

```powershell
& "C:\Program Files\ArenaOS\Agent\setup-player.ps1" -Password <a password for Player>
```

Administrator accounts always keep the normal desktop, which is how staff do maintenance. Undo with `setup-player.ps1 -Off`; hold **Shift** while Windows starts to skip the automatic sign-in once.

⚠️ With Test mode off, **Restart / Shut down / Lock** from the admin really do that to your laptop. Save your work first.

**Play:**

| # | Do | Expect |
|---|---|---|
| - [ ] 3B.1 | Restart Windows | It signs in to **Player** by itself and the Gaming Shell opens **full-screen** with no taskbar (the Windows key does nothing) on its lock screen: My Arena, Main Hall, big clock, **Station PC-01**, sign-in box |
| - [ ] 3B.2 | Press **Alt+F4** | Nothing happens |
| - [ ] 3B.3 | Sign in: **sam** / **player1234** | Countdown starts at about **3:15:00** (Sam's prepaid time). Owner → Live Floor: PC-01 turns **in use** by Sam |
| - [ ] 3B.4 | **Home** | Welcome, Sam; featured games from 2D.5 |
| - [ ] 3B.5 | **Games** → click a game | It launches; the admin drawer shows what's being played |
| - [ ] 3B.6 | **Food** → Smash burger + Cheese, Cola → **Add to bill** → send | Order number shown; the admin **Kitchen** gets the tickets |
| - [ ] 3B.7 | **Peripherals** | Your mouse/keyboard/headset; pointer speed slider |
| - [ ] 3B.8 | **Connection** | Ping to router/internet |
| - [ ] 3B.9 | **Support** → "Mouse, keyboard or headset" | "Help is on the way"; an alert appears on the admin Live Floor |
| - [ ] 3B.10 | **Log out** (top-right door icon) | Confirm → back to the lock screen; unused time goes back to Sam's balance |
| - [ ] 3B.11 | On the lock screen press **العربية** | Right-to-left Arabic layout; switch back to English |

Sign in as sam again and leave the session running for Part 4. To reach your own desktop at any time: **Ctrl+Alt+Del → Sign out**, then sign in with your own account.

---

## Part 4 · Staff: every role does its job

Sign each role in at `http://localhost:3000/login` (or `http://LAPTOP:3000/login` on the phone), each in its own InPrivate window or browser.

### 4A · Cashier (`cashier@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4A.1 | Sidebar → **POS** → **My shift** → **Drawer** Front desk, **Opening cash** 200 → **Open shift** | Shift open; the X-report shows opening float 200 |
| - [ ] 4A.2 | **Customers** → **New customer**: Username `ali`, Display name Ali, Password `ali12345` → save | Ali's page opens |
| - [ ] 4A.3 | On Ali: **Sell prepaid time** → **Sold at** MH1 · **Package** 1 hour · **Payment** Cash | Ali has 60 min; the shift shows AED 15 cash |
| - [ ] 4A.4 | **Live Floor** → click **PC-01** | Sam's session: time left, rate, bill |
| - [ ] 4A.5 | **Extend** → 30 min → Cash | The Shell's countdown jumps +30 min |
| - [ ] 4A.6 | **Message** → `Your burger is coming` | Pops up on the Shell |
| - [ ] 4A.7 | **POS** → **Sell** → **Counter** → tap Cola twice → **Charge** → Cash, **Cash received** 20 → **Charge & send** | "Give change: AED 4" (the 10% promotion is food-only, Cola is a drink) |
| - [ ] 4A.8 | POS → **Open bills** → Sam's bill → **Take payment** → Card | Bill settled; points added to Sam |
| - [ ] 4A.9 | On that bill: refund one Cola (reason `spilled`) | Refund recorded |
| - [ ] 4A.10 | Try Sidebar → **Roles** / **Branches & zones** / **Finance** | Missing from the menu, or "Your role doesn't allow this" |

### 4B · Kitchen (`kitchen@myarena.test`; phone, tablet or second window)

| # | Do | Expect |
|---|---|---|
| - [ ] 4B.1 | Sidebar → **Kitchen** | Sam's **Smash burger** under **Kitchen**, the **Cola** under **Bar**, with PC-01 as the delivery point |
| - [ ] 4B.2 | Tap the burger ticket's button: **Start** → **Ready** → **Served** | Each tap moves it along. The Shell tells Sam "being prepared", then "ready — on its way" |
| - [ ] 4B.3 | Fullscreen icon | Kitchen-display mode for a wall screen |

### 4C · Waiter (`waiter@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4C.1 | Sidebar → **Restaurant** → **Tables** → **T2** → order 2 × Smash burger | T2 **occupied** with a bill; tickets appear in the kitchen |
| - [ ] 4C.2 | Add a Cola to T2; set status **Bill requested** | T2 shows the bill total |
| - [ ] 4C.3 | Cashier: **POS → Open bills → Table T2** → Cash, **Amount** half → **Split payment** → Card (the rest) → **Take payment** | T2 → **Needs clearing**; waiter sets it **Free** |

### 4D · Technician (`tech@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4D.1 | **Live Floor** → PC-01 → **Tools** → run **Flush DNS** | Command succeeds |
| - [ ] 4D.2 | Unplug your USB mouse for 30 s | **Peripheral missing** alert on the floor → **Acknowledge** |
| - [ ] 4D.3 | **Games** → **Scan PCs**; if something needs an update, **Update** | Scan result / update job on the **Updates** tab |
| - [ ] 4D.4 | **Consoles & VR** → PS5-01 → switch to maintenance, then back | Its floor tile turns maintenance, then available |

### 4E · Inventory manager (`stock@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4E.1 | **Inventory** → **Stock** (store Kitchen) | Buns and patties reduced by the burgers sold |
| - [ ] 4E.2 | On Burger bun: adjust → **Waste**, 2, reason `stale` | Movement listed; stock −2 |
| - [ ] 4E.3 | **Transfer stock**: 10 × Cola can, Main store → Kitchen | Both stores updated |
| - [ ] 4E.4 | **Count** the Kitchen: enter one number different from the system | Variance shown and posted |
| - [ ] 4E.5 | **Purchasing** → **Reorder** | Items under their reorder level are suggested |

### 4F · Branch manager (`manager@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4F.1 | **Bookings** → tomorrow → Sam's booking → **Check in** (at start time) or **No-show** | Session starts on PC-01 / booking released |
| - [ ] 4F.2 | **Sessions** | Live and recent sessions with what was paid |
| - [ ] 4F.3 | Cashier: **POS → My shift → Close shift**, count AED 10 less than expected | "Pending approval" |
| - [ ] 4F.4 | Manager: **POS → My shift** → all shifts → **Approve** the cashier's shift | Closed, variance −10 recorded |
| - [ ] 4F.5 | **Tournaments** → FIFA Friday: start check-in, seed, start, **Save result** for a match | Bracket advances; at the end the prize goes to the winner's wallet |
| - [ ] 4F.6 | **Live Floor** → PC-01 → **End session** | The Shell locks; remaining prepaid time returns to Sam |

### 4G · Accountant (`accounts@myarena.test`)

| # | Do | Expect |
|---|---|---|
| - [ ] 4G.1 | **Finance** → **Post now** → **Overview** | Profit & loss (gaming and food revenue, cost of stock) and a balance sheet that balances |
| - [ ] 4G.2 | **Journal** | Each sale, payment, refund, top-up, stock movement and supplier bill as a double entry |
| - [ ] 4G.3 | **Expenses** → **Record** rent AED 5,000 | Appears in P&L |
| - [ ] 4G.4 | **Reports** → **VAT** and **Cash & shifts** | VAT on sales and purchases; Carl's shift with its −10 variance |
| - [ ] 4G.5 | **Finance** → **Close** up to yesterday | Earlier dates can no longer be changed |

---

## Part 5 · Owner: the day in numbers (window B)

| # | Do | Expect |
|---|---|---|
| - [ ] 5.1 | **Dashboard** | Revenue today vs last week, bills, sessions, hours played; "Revenue per day" and "Hours played per day" charts |
| - [ ] 5.2 | **Reports → Sales** (From: first of the month) | Takings by day, by what was sold, by payment method; **CSV** downloads a file |
| - [ ] 5.3 | **Reports → Gaming utilization** | Occupancy per zone, busiest and quietest stations, "when people play" heat map |
| - [ ] 5.4 | **Reports → Staff** | Each person's orders, payments, refunds, voids, shift variance |
| - [ ] 5.5 | **Customers → sam** | Wallet history, sessions, loyalty points, bookings |
| - [ ] 5.6 | On Sam: **Sell membership** → Gold → Card | Sam is Gold; the next quote on the floor shows the 20% member discount |

---

## Part 6 · Super Admin: manage the account (window A)

| # | Do | Expect |
|---|---|---|
| - [ ] 6.1 | **Overview** | My Arena counted: branches, stations, staff, customers; new sign-up this month |
| - [ ] 6.2 | **Organizations → My Arena → Features** → Tournaments → **Turn off**, reason `test` | Owner refreshes: **Tournaments** gone from the menu |
| - [ ] 6.3 | **Subscription** → **Max stations** 1 → **Save changes** | Owner → Computers → Add stations for a 2nd PC is refused ("plan limit") |
| - [ ] 6.4 | **Suspend**, reason `unpaid test` | Every My Arena user is signed out and can't sign in |
| - [ ] 6.5 | **Reactivate**; Features → Tournaments → **Plan default**; clear Max stations | Everything works again |
| - [ ] 6.6 | **Audit log** → **Everyone** | Platform actions and My Arena's staff actions, newest first |

---

## Part 7 · Safety checks

| # | Do | Expect |
|---|---|---|
| - [ ] 7.1 | Sign in as `owner@demo.test` / `ArenaDemo!2026` (the seeded Demo Arena) | You never see My Arena's customers, stations or money |
| - [ ] 7.2 | Wrong password 5 times for any account | "Too many failed attempts", locked 15 minutes |
| - [ ] 7.3 | As the cashier, open `http://localhost:3000/platform` | Sent to sign-in: staff can't reach the platform |
| - [ ] 7.4 | During a session, turn Wi-Fi/Ethernet off for 3 min | The Shell keeps counting; admin shows PC-01 offline, then online again |
| - [ ] 7.5 | Stop the API terminal (Ctrl+C) for 1 min, start it again | The Shell and Live Floor reconnect on their own |

---

## Cleaning up

- **Settings → Apps → Installed apps → ArenaOS Station → Uninstall** (removes the agent service and the Shell).
- **Settings → Accounts → Other users → Player → Remove**.
- To start over with fresh data: `docker compose -f infra/docker-compose.yml down -v`, then redo "First time only" in 0.2.

Found a problem? Send the step number and what you saw.
