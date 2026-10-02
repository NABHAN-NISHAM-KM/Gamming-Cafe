# 21 · Website: sales, trials and venue pages

`apps/website` is the public marketing site. It is static HTML, CSS and a little JavaScript, served by `serve.mjs` (Node, no dependencies) on port 5180. It also hosts the live demos (`/live/`, see [18](18-live-demos.md)) and the downloads.

```bash
npm run dev -w @arena/website        # http://localhost:5180
npm run build:help -w @arena/website # rebuild the help centre after editing docs/
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
| `help.html` | Searchable help centre built from the docs |
| `venue.html` | A venue's public page, served at `/v/<venue code>` |
| `ar/index.html`, `ar/contact.html`, `ar/signup.html` | Arabic, right to left. The nav's **العربية / English** button switches between a page and its counterpart |

The nav and footer come from `assets/site.js`. Pages under `ar/` get Arabic labels automatically (`lang="ar"`, `data-base="../"`).

## What `serve.mjs` does besides serving files

| Path | Behaviour |
|---|---|
| `/v1/public/*` | Forwarded to the platform service (`PLATFORM_URL`, default `http://localhost:4100`) |
| `/v1/app/*` | Forwarded to the API (`API_URL`, default `http://localhost:4000`) |
| `/v/<code>` | Serves `venue.html` |
| `/downloads/manifest.json` | Name, size and SHA-256 of each file in `downloads/`. Each file is hashed once per change |
| `/config.json` | `{ adminUrl }` (`ADMIN_URL`): where "Sign in" points after a trial sign-up |
| `/sitemap.xml`, `/robots.txt` | Generated: every page except `venue.html`. `/v1/`, `/live/` and `/demo/` are disallowed |
| `%SITE%` in HTML | Replaced with `SITE_URL`, or with the address the visitor used. Feeds the canonical link and the Open Graph and Twitter tags |

Forwarding means the browser never needs CORS. Behind Nginx, forward `/v1/public/` and `/v1/app/` the same way and keep `X-Forwarded-For`, because both services throttle per IP.

## Leads, calls and trials (platform service)

Public routes, under `http://localhost:4100/v1/public`. No sign-in is needed. Each form has a hidden honeypot field (`website`); a request that fills it is rejected.

| Method | Path | What it does |
|---|---|---|
| POST | /leads | Saves a walkthrough request (`CONTACT` lead): name, email, venue, country, venue type, plan, branches, stations, notes. Limit: 5 per hour per IP |
| GET | /demo-slots?days=14 | Free 30-minute call slots: Sunday–Thursday, 10:00–17:30 in `SALES_TIMEZONE` (default `Asia/Dubai`), at least 2 hours ahead, booked ones removed |
| POST | /demo | Books a slot (`DEMO` lead). Same limit as `/leads`. A slot can't be taken twice: the database has an exclusion constraint, and a clash answers `409 slot_taken` |
| POST | /trial | Opens a venue (see below) and saves a `TRIAL` lead. Limit: 3 per day per IP. `409 email_taken`, `409 slug_taken`; `503 trials_closed` if the trial plan is retired |
| GET | /releases | The newest stable, published, non-revoked client release per component, for the downloads page |

**A trial** creates the organization (status `TRIAL`), its brand and a 14-day `TRIALING` subscription on `TRIAL_PLAN_CODE` (default `PRO`). It also creates the owner with the password they chose (two-step sign-in is required at first sign-in) and a starting point: a **Main branch** in setup, **Regular PCs** and **VIP PCs** zones, and a **Regular PC** rate at 15 per hour with 1-, 3- and 5-hour packages. The Super Admin's **New organization** uses the same code (`apps/api/src/platform/provision.ts`), without the starter venue.

**New leads** are written to the platform log. If `LEADS_WEBHOOK_URL` is set, they are also POSTed there as `{ "type": "lead", "lead": {…} }` (Slack, an e-mail relay, a CRM). Nothing sends e-mail by itself: the call-booking confirmation promises an invite, so someone has to send it.

Leads live in the platform table `Lead`, migration `0026_website`. The tenant API role has no access to it.

**Super Admin → Leads** lists them newest first, filtered by type and status, with a link to a trial's organization. Super admin, support and billing can move a lead through New → Contacted → Won / Lost; each change is audited (`platform.lead.status`).

## Public venue pages

`GET http://localhost:4000/v1/app/<code>/public` (no sign-in) returns what `/v/<code>` shows:

- the venue's name, logo, colour and app link;
- each open branch: address, phone, opening hours, and per zone how many stations there are and how many are free right now;
- active rates (not membership-only ones) with their packages;
- up to 6 public tournaments that are open or running.

It answers `404 venue_not_found` unless the venue has switched it on. The switch is in **Settings → Public venue page** and needs `org.manage`. As with the customer app, only `ACTIVE` organizations have one, so trials don't. The page shows counts and prices only, never customers or who is playing. It refreshes every minute while open.

## Help centre

`scripts/build-help.mjs` reads `docs/08`–`15` and `17`–`21` (architecture, API and test-guide docs are left out) and splits each one at its `##` headings. It renders the Markdown to HTML and writes `assets/help.json`, which is committed so the site stays static. `help.html` searches titles and text in the browser, and `help.html?q=refund` opens with a search. Run `npm run build:help -w @arena/website` after editing the docs.

## SEO

Every page has a canonical link, Open Graph and Twitter tags (image `assets/og.png`, 1200×630), and an inline favicon. The English and Arabic pairs have `hreflang` links. `index.html` carries `SoftwareApplication` JSON-LD with the three plans as offers, and `help.html` carries a `SearchAction`. Set `SITE_URL` in production so the absolute links are right.

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

Tests: `apps/api/test/website.e2e.test.ts` covers the honeypot, validation and per-IP limit, slots within hours, double booking, a trial whose owner can sign in, duplicate email and address, Super Admin leads, releases, and the venue page off and on, with no customer data.
