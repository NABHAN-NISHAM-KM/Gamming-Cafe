# 21 · Website: sales, trials, venue pages and growth

`apps/website` is the public marketing site. It is static HTML, CSS and a little JavaScript, served by `serve.mjs` (Node; its one dependency is the Claude SDK for the help assistant) on port 5180. It also hosts the live demos (`/live/`, see [18](18-live-demos.md)) and the downloads.

```bash
npm run dev -w @arena/website        # http://localhost:5180
npm run build:help -w @arena/website # rebuild the help centre after editing docs/
npm run build:blog -w @arena/website # rebuild the blog after editing posts/
```

For the forms and venue pages to work, the API (4000) and the platform service (4100) must be running.

## Pages

| Page | What it is |
|---|---|
| `index.html`, `features.html`, `pricing.html`, `demos.html`, `guide.html`, `install.html` | Product, every module, plans, the live demos, how it works, the station install guide |
| `contact.html` | "Request a walkthrough", with an optional 30-minute call slot |
| `signup.html` | Self-serve 14-day free trial |
| `changelog.html` | What's new, newest first. Add an `<article class="log">` per release |
| `compare.html` | Why switch: ArenaOS against typical legacy café software (no competitor is named) |
| `for-gaming-cafes.html`, `for-esports-arenas.html`, `for-internet-cafes.html`, `for-console-vr-centres.html`, `for-gaming-restaurants.html` | One page per venue type |
| `downloads.html` | Each download with its size and SHA-256, plus the version and release notes of the current stable release |
| `help.html` | Searchable help centre built from the docs, with the help assistant |
| `venue.html` | A venue's public page, served at `/v/<venue code>`, with booking without the app |
| `wizard.html` | **Plan your venue**: PCs, consoles, VR, internet PCs, staff, kitchen, tournaments, printing → the plan that fits, a hardware and setup checklist, and a quote to print or send (a `CONTACT` lead with source `wizard`) |
| `finder.html` | **Find a venue**: every published venue on a map (Leaflet + OpenStreetMap) and in a list, filtered by city and by PCs / consoles / VR / simulators, with free stations per branch (refreshed every minute while the page is open) |
| `stories.html` | Customer stories from `assets/stories.json` (empty until real, approved stories are added) and a "share your story" form |
| `partners.html` | Installers and resellers apply (a `PARTNER` lead) |
| `status.html` | Live status and 90-day uptime per service, and recent outages (from `/status.json`) |
| `security.html` | How data is protected, the data-processing agreement (`assets/arenaos-dpa.html`, a template for legal review) and how to report a security problem |
| `blog/` | Guides for venue owners and an RSS feed (`blog/feed.xml`), generated from `posts/*.md` |
| `ar/…` | Arabic, right to left: home, contact, sign-up, features, pricing, downloads, compare, help, finder and the five venue-type pages. The nav's **العربية / English** button switches between a page and its counterpart |

The nav and footer come from `assets/site.js`. Pages under `ar/` get Arabic labels automatically (`lang="ar"`, `data-base="../"`).

## What `serve.mjs` does besides serving files

| Path | Behaviour |
|---|---|
| `/v1/public/*` | Forwarded to the platform service (`PLATFORM_URL`, default `http://localhost:4100`) |
| `/v1/app/*` | Forwarded to the API (`API_URL`, default `http://localhost:4000`) |
| `/v/<code>` | Serves `venue.html` |
| `/downloads/manifest.json` | Name, size and SHA-256 of each file in `downloads/`. Each file is hashed once per change |
| `/config.json` | `{ adminUrl, assistant }`: where "Sign in" points after a trial sign-up (`ADMIN_URL`), and whether the help assistant is on |
| `/status.json` | The status page's data (see below) |
| `POST /ask` | The help assistant (see below) |
| `/sitemap.xml`, `/robots.txt` | Generated: every page (including `ar/` and `blog/`) except `venue.html`. `/v1/`, `/live/` and `/demo/` are disallowed |
| `%SITE%` in HTML and XML | Replaced with `SITE_URL`, or with the address the visitor used. Feeds the canonical link, the Open Graph and Twitter tags and the RSS feed |

The server's own files (`serve.mjs`, `assistant.mjs`, `status.mjs`, `status-data.json`, `package*.json`, `scripts/`, `posts/`, `node_modules/`) are never served.

Forwarding means the browser never needs CORS. Behind Nginx, forward `/v1/public/` and `/v1/app/` the same way and keep `X-Forwarded-For`, because both services throttle per IP.

## Leads, calls and trials (platform service)

Public routes, under `http://localhost:4100/v1/public`. No sign-in is needed. Each form has a hidden honeypot field (`website`); a request that fills it is rejected.

| Method | Path | What it does |
|---|---|---|
| POST | /leads | Saves a walkthrough request (`CONTACT` lead), or a partner application with `kind: "PARTNER"`: name, email, venue, country, venue type, plan, branches, stations, notes, source, `ref`. Limit: 5 per hour per IP |
| GET | /demo-slots?days=14 | Free 30-minute call slots: Sunday–Thursday, 10:00–17:30 in `SALES_TIMEZONE` (default `Asia/Dubai`), at least 2 hours ahead, booked ones removed |
| POST | /demo | Books a slot (`DEMO` lead). Same limit as `/leads`. A slot can't be taken twice: the database has an exclusion constraint, and a clash answers `409 slot_taken` |
| POST | /trial | Opens a venue (see below) and saves a `TRIAL` lead. Limit: 3 per day per IP. `409 email_taken`, `409 slug_taken`; `503 trials_closed` if the trial plan is retired |
| GET | /releases | The newest stable, published, non-revoked client release per component, for the downloads page |
| POST | /events | One anonymous count for the site analytics (below). `204`. Limit: 120 a minute per IP |

**A trial** creates the organization (status `TRIAL`), its brand and a 14-day `TRIALING` subscription on `TRIAL_PLAN_CODE` (default `PRO`). It also creates the owner with the password they chose (two-step sign-in is required at first sign-in) and a starting point: a **Main branch** in setup, **Regular PCs** and **VIP PCs** zones, and a **Regular PC** rate at 15 per hour with 1-, 3- and 5-hour packages. The Super Admin's **New organization** uses the same code (`apps/api/src/platform/provision.ts`), without the starter venue.

**New leads** are written to the platform log. If `LEADS_WEBHOOK_URL` is set, they are also POSTed there as `{ "type": "lead", "lead": {…} }` (Slack, an e-mail relay, a CRM). Nothing sends e-mail by itself: the call-booking confirmation promises an invite, so someone has to send it.

Leads live in the platform table `Lead`, migration `0026_website`. The tenant API role has no access to it.

**Super Admin → Leads** lists them newest first, filtered by type (including Partner) and status, with a link to a trial's organization, the venue that referred the lead, and the form it came from. Super admin, support and billing can move a lead through New → Contacted → Won / Lost; each change is audited (`platform.lead.status`).

## Public venue pages

`GET http://localhost:4000/v1/app/<code>/public` (no sign-in) returns what `/v/<code>` shows:

- the venue's name, logo, colour and app link;
- each open branch: address, phone, opening hours, and per zone how many stations there are and how many are free right now;
- active rates (not membership-only ones) with their packages;
- up to 6 public tournaments that are open or running.

It answers `404 venue_not_found` unless the venue has switched it on. The switch is in **Settings → Public venue page** and needs `org.manage`. As with the customer app, only `ACTIVE` organizations have one, so trials don't. The page shows counts and prices only, never customers or who is playing. It refreshes every minute while open.

## Booking from the venue page

Under the venue's details, **Book a station** asks for a branch, a time (15 minutes to two weeks ahead), how long, how many players, an area, a name and a phone number — no app or account.

| Method | Path (API, no sign-in) | What it does |
|---|---|---|
| GET | /v1/app/venues | Every published venue with its open branches: address, city, map location, zone types (the finder) |
| GET | /v1/app/<code>/public-availability?branchId&startsAt&minutes | Free and total stations per bookable zone for that time — counts only |
| POST | /v1/app/<code>/book | Books through the normal booking service: `source CUSTOMER_WEB`, the guest's name and phone as the contact, note "Booked on the website", confirmed straight away and held 15 minutes past the start. Answers the reference, time, length, status and estimated total. Honeypot; 3 bookings per hour per IP |

All three only see venues with a published page. A branch's map location and address are set in **Branches → (branch) → Edit** (paste "latitude, longitude" from any map app).

## Venue referrals

Every venue has a referral link, `<WEBSITE_URL>/signup.html?ref=<venue code>`, shown in **Billing → Invite a venue, get a free month** with how many venues signed up, how many pay and how many free months it earned (`GET /organization/links`, `GET /organization/referrals`, which needs `org.billing`). The website remembers `?ref=` for the visit and sends it with the trial, contact and call forms; the lead keeps the referring organization (`Lead.referrerOrgId`). When the referred venue's **first invoice is paid** (by card or marked paid), the referrer's subscription is extended by 30 days, once per referred venue (`Lead.referralRewardedAt`).

## Printable posters

`/poster?kind=app` and `/poster?kind=page` in the admin console print an A4 poster with a large QR code, in English and Arabic: the app poster links to the Android app download on the website (`/downloads/ArenaOS-Customer.apk`) and shows the venue code to enter in it; the page poster links to the venue's public page. They're linked from **Settings → Public venue page**.

## Site analytics

`assets/site.js` sends one beacon per page view to `/v1/public/events`: the path, the referring site, and the event. Sign-up steps are events too: `trial_started` (first keystroke in the trial form), `trial_done`, `contact_sent`, `demo_booked`, `partner_sent`, `quote_made`, `venue_booked`, `help_asked`. Nothing else: no cookies, no IP address, no browser fingerprint, and nothing is sent when the browser asks not to be tracked or is automated. Bots are ignored by user agent, and links between the site's own pages don't count as referrals.

Counts are kept per day, path, referring host and event in the platform table `SiteStat` (migration `0028_website_growth`; the tenant API role has no access). **Super Admin → Website** shows views per day, top pages, referring sites, the trial funnel and the other actions over 7, 30, 90 or 365 days (`GET /v1/platform/site-stats?days=`).

## Status page

Every minute `serve.mjs` checks the venue API (`/health`), the admin console (`/login`) and the platform service (`/health`). An answer below 500 within 10 seconds counts as up. It keeps up/total checks per day for 90 days and a list of outages, saved to `status-data.json` every 5 checks (gitignored). `/status.json` gives each service's state now, uptime over 24 hours / 7 days / 90 days, a bar per day, and the latest 20 outages. `STATUS_MONITOR=off` turns the checks off.

## Blog

Posts are Markdown files in `posts/` starting with front matter:

```
---
title: …
date: 2026-10-01
description: …
---
```

`npm run build:blog -w @arena/website` writes `blog/<file>.html`, `blog/index.html` and `blog/feed.xml` (RSS 2.0), using the same Markdown renderer as the help centre (`scripts/markdown.mjs`). The output is committed.

## Help centre

`scripts/build-help.mjs` reads `docs/08`–`15` and `17` onwards (architecture, API and test-guide docs are left out) and splits each one at its `##` headings. It renders the Markdown to HTML and writes `assets/help.json`, which is committed so the site stays static. `help.html` searches titles and text in the browser, and `help.html?q=refund` opens with a search. Run `npm run build:help -w @arena/website` after editing the docs.

**The help assistant** (`assistant.mjs`) answers a question from the help articles only. It picks the 4 best-matching articles (rarer words count more, a word in the title counts double) and asks Claude (`claude-opus-5-5`, low effort, with server-side fallback) to answer from them in a few sentences, in the question's language. A question in Arabic is first turned into English search keywords, because the articles are in English. The answer links the articles it used and says it was written by AI. `POST /ask` with `{ question }` (3–500 characters); 10 questions per 10 minutes per IP. It needs `ANTHROPIC_API_KEY` on the website server; without it `/ask` answers `503` and the Ask box stays hidden.

## SEO

Every page (except `venue.html`) has a canonical link, Open Graph and Twitter tags (image `assets/og.png`, 1200×630), and an inline favicon. The English and Arabic pairs have `hreflang` links. `index.html` carries `SoftwareApplication` JSON-LD with the three plans as offers, and `help.html` carries a `SearchAction`. Set `SITE_URL` in production so the absolute links are right.

## Pricing calculator

`pricing.html` has two calculators. **Size your venue** recommends a plan. **What it pays back** estimates a monthly net gain from stations, price per hour, hours open, busy share, unbilled time recovered, extra food per busy hour, staff hours saved and current software cost, minus the plan the station count needs. Every assumption is an input with a modest default.

## Settings

| Variable | Used by | Default |
|---|---|---|
| `LEADS_WEBHOOK_URL` | platform | unset (log only) |
| `SALES_TIMEZONE` | platform | `Asia/Dubai` |
| `TRIAL_PLAN_CODE` | platform | `PRO` |
| `PLATFORM_URL`, `API_URL` | website | `http://localhost:4100`, `http://localhost:4000` |
| `ADMIN_URL` | website | `http://localhost:3000` |
| `SITE_URL` | website | the request's host |
| `ANTHROPIC_API_KEY` | website (help assistant) | unset (assistant off) |
| `STATUS_MONITOR` | website | on (`off` to stop the checks) |
| `WEBSITE_URL` | API (venue page, poster and referral links) | `http://localhost:5180` |

Tests: `apps/api/test/website.e2e.test.ts` covers the honeypot, validation and per-IP limit, slots within hours, double booking, a trial whose owner can sign in, duplicate email and address, Super Admin leads, releases, and the venue page off and on, with no customer data. `apps/api/test/website-growth.e2e.test.ts` covers partner leads, a referral rewarded once when the invoice is paid, site counts (bots ignored, nothing personal stored, the Super Admin report), and the venue finder and guest booking (honeypot, the booking row).
