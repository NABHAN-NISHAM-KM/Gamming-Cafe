# 14 · Consoles, VR, simulators, station displays & printing (Phase 9)

Migration `0013_stations_printing`:

- **Device:** `agentless`, `minAge`, `powerPlug`, `isBridge`, and the TV
  display token and pairing-code hashes.
- **Pricing:** `PricingPlan.includedPlayers` / `extraPlayerRate`, and
  `GamingSession.players`.
- **Printing:** print-job columns.
- **Commands:** `POWER`, `PRINT_RELEASE` and `PRINT_CANCEL`.
- **Guards:** CHECK constraints.
- **Definer functions** for TV tokens and the print sweep.

## Agentless stations

Consoles, VR headsets and sim rigs run no ArenaOS agent, so the **server's
session timer is the only clock**. It already was for PCs; the agent just
mirrored it.

- **Selling time:** exactly like a PC, with the same rates, packages,
  bookings, bills and wallet. Agentless stations are always "online"; their
  stored status (available / occupied / cleaning) is the truth.
- **Sessions:** start, extend, move and end skip the signed agent commands.
  Moves work between agentless and agent stations in either direction.
- **Players:** a console plan includes N players (`includedPlayers`), and each
  extra player adds `extraPlayerRate` for the same time.
  - This applies to minutes, packages and pay-at-the-end.
  - Demo: PS5 AED 20/h for 2, +AED 5/h per extra controller.
  - The count can't exceed the station's controllers.
- **Minimum age** (VR, motion sims):
  - A known customer under the age is refused (`age_restricted`).
  - For a guest, or a customer with no birth date, staff confirm the age
    (`ageConfirmed`).
- **Cleaning:** stations marked "clean between players" (VR) go to
  **CLEANING** when a session ends. They can't be sold until staff tap
  **Mark cleaned**, which also resets gear flagged "needs cleaning".
- **Gear (accessories):** controllers, headsets, wheels, pedals, each with a
  status.
  - After a session, staff run a **gear check**.
  - Anything **missing** (critical) or **faulty** raises an
    `ACCESSORY_ISSUE` alert on the Live Floor, until a later check finds it OK.

## Ending time without an agent

1. **TV station display** (`/display.html` in the customer app):
   - The TV next to the console runs it full-screen.
   - It **pairs once**: staff get an 8-character one-time code (10 minutes,
     single use), then the TV holds its own random token (stored hashed).
   - It shows only its linked stations: the player's **first name**, a
     countdown (server time), warnings at 5 and 1 minutes, and a pulsing
     **"Time's up — hand back the controllers"** for 90 seconds after the
     end, then "Free" or "Being cleaned".
   - It polls every 5 s.
   - Unpairing in the admin revokes it at once.
2. **Smart plug through the branch bridge** (optional):
   - Each agentless station can have a plug: Shelly (Gen 2+), Shelly Gen 1
     or Tasmota, with a LAN address, channel and "off after" delay.
   - One ordinary PC per branch is the **bridge**.
   - At session start the server sends it a signed `POWER on`. At the end it
     sends `POWER off` with the delay, so the TV shows "time's up" first.
   - A later command for the same plug supersedes a pending one: a new
     session in that minute keeps the console on.
   - **The bridge only calls LAN addresses.** The server validates the plug,
     and the agent re-checks (private IPv4 / .local / .lan only), so even a
     validly signed command can't make it reach the internet.
   - No bridge → an alert; staff enforce it.

## Internet-café printing

```
Customer prints ─▶ agent pauses the job (spooler, WMI) ─▶ print_job {pages, colour}
server prices it (PRINT-BW / PRINT-COLOR products: branch price + VAT) ─▶ print_quote ─▶ Shell dialog
customer: "Add to my bill" / "Pay from wallet" / cancel ─▶ print_confirm
server: charges (session bill, or wallet) ─▶ signed PRINT_RELEASE ─▶ agent resumes the job ─▶ print_done
```

- **Nothing prints unpaid.** Every new job is paused at once. It resumes only
  on a signed `PRINT_RELEASE`, and is deleted on `PRINT_CANCEL`.
  - A job un-paused by hand in Windows is paused again.
  - A job the customer deletes is reported, and the server cancels it.
- **Charging:**
  - A charge is an order line on the session bill (`GAMING_SEAT`, a hidden
    SERVICE product), or paid from the wallet.
  - The wallet balance is checked first; if it's short, the customer is asked
    again with a notice.
  - A job reported twice (after a reconnect) is never charged twice: it's
    unique per station and job key.
- **Refused:** no session ("Sign in to print"), printing not set up, or more
  than the branch's `maxPages`.
- **Staff approval** (optional, per branch): after the customer confirms, the
  job waits in **Printing** until someone releases it (on the bill or wallet).
- **Timeouts:** unconfirmed after 3 minutes, or not released by staff within
  15 → cancelled by a sweep, and the station deletes it.
- **Failed prints:** a `PRINT_FAILED` alert tells staff to check the printer
  and refund if needed.
- **Safe mode:** print control is **off** in safe mode, so an office PC
  trying the agent keeps printing normally.
- **Agent:**
  - `PrintTracker` (pure, unit-tested state machine) and `PrintSpooler`
    (WMI `Win32_PrintJob`: list, pause, resume, delete).
  - `PrintMonitor` polls every 0.7 s.

## Admin

- **Consoles & VR:**
  - Stations with their gear, TV, plug and minimum age; add or edit
    stations and gear.
  - Gear checks, mark cleaned, power on/off, choosing the bridge PC.
  - TV displays: pair (code), re-pair, unpair.
- **Live Floor:** the start form adds **Players** (with the extra-player
  price) and the age check. Stations waiting to be cleaned show **Mark
  cleaned**.
- **Rates:** console plans set players included and the extra-player price.
- **Printing:** the live queue (customer deciding / needs release / printing
  / done), release or cancel, and branch rules (staff approval, maximum
  pages).

## Permissions

| Permission | Use |
|---|---|
| `print.view`, `print.release` | New. Module feature `INTERNET_CAFE`. Cashiers and gaming/branch managers have them. |
| `station.manage` | Stations, gear, TV pairing, bridge |
| `station.start_session` | Gear checks, mark cleaned |
| `station.shutdown` | Manual power |
| `settings.manage` | Print rules |

## Demo data (DXB1)

| Zone | Stations |
|---|---|
| PS5 Lounge | PS5-01..03 (4 controllers + headset, Shelly plugs), each with its TV (TV-01..03) |
| VR Zone | VR-01, VR-02 (Meta Quest, 13+, cleaned between players), sharing TV-VR |
| Racing Sims | SIM-01 (wheel, pedals, shifter, Tasmota plug, 10+), "Racing sim" rate |

- **Printing:** 0.50 per B/W page and 2.00 per colour page.
- **Plugs:** the plug addresses are examples; pick a bridge PC in the admin.

## Tests

| Suite | Count | Covers |
|---|---|---|
| `test/pricing.test.ts` | +6 | Extra players on minutes, packages and postpaid; with membership discount |
| `test/stations.e2e.test.ts` | 15 | See below |
| .NET | +23 | `PrintTracker`, `PlugControl` (LAN-only), Shell print messages |

`stations.e2e` covers:
- seeded stations;
- a console with no agent, player pricing, bridge power on/off with delay;
- a LAN-only plug;
- VR age rules and cleaning;
- gear-check alerts;
- TV pairing, state, privacy and unpairing;
- printing: bill, retry-safety, wallet, staff approval, timeout sweep, no
  session;
- tenant isolation.
