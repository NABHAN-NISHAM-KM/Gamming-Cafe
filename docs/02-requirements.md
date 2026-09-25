# 02 · Requirements & traceability

This document condenses the master brief into requirements. Each requirement is traced to its data model (built in Phase 1) and the phase that implements its behaviour.

## Actors

| Actor | Main surface |
|---|---|
| **Platform Super Admin** | Super Admin console. Creates, suspends and activates orgs; manages plans, limits, feature flags, client releases, countries, currencies, taxes and gateways; runs audited impersonation. |
| **Organization Owner / Admin** | Org console. Runs the business, compares branches, holds all roles. |
| **Branch Manager** | Branch console. Runs the venue: Live Floor, staff, approvals, local reports. |
| **Cashier / Receptionist** | Front desk. Handles sessions, sales, bookings and customers. |
| **Technician / System Admin** | Stations, maintenance mode, updates, diskless. |
| **Restaurant Manager / Waiter / Kitchen** | POS, tables, KDS. |
| **Inventory Manager / Accountant** | Stock and purchasing; finance and reconciliation. |
| **Tournament Manager** | Brackets, matches, results. |
| **Customer** | Gaming Shell, customer PWA/app. |
| **Device** | Windows Agent, console/TV bridge, KDS, POS terminal. Authenticates with a device certificate. |

## Functional scope → model → phase

| # | Capability | Core entities | Phase |
|---|---|---|---|
| 1–3 | SaaS hierarchy, Super Admin, Org admin | Organization, Brand, Branch, Subscription, PlanFeature, OrganizationFeature, ImpersonationSession | 1 (model) · 2 · 12 |
| 4 | Branches, zones, floor map | Branch, Zone (floorMap), Device (mapX/Y/W/H) | 2 · 3 |
| 5–7 | Windows client, locked shell, maintenance mode | Device, DeviceCredential, DeviceCommand, MaintenanceSession | 3 · 4 |
| 6, 52 | Session control & mandatory expiry flow | GamingSession, SessionExtension, SessionTransfer, PricingPlan | 4 |
| 8–10 | Launchers, game library, update orchestration | Launcher, Game, OrgGameSetting, GameInstallation, GameUpdateJob | 5 |
| 11 | Diskless integration layer | DisklessIntegration, DeviceBootInfo | 5 (adapters) |
| 12–14 | Peripherals, connectivity, self-repair | PeripheralProfile, DeviceAccessory, DeviceCommand(RUN_REPAIR) | 5 |
| 15–16 | Remote management, hardware monitoring, alerts | DeviceCommand, DeviceHeartbeat, DeviceHardware, Alert, RemoteSupportSession | 3 |
| 17 | Internet café: per-minute billing, printing | PricingPlan(PER_MINUTE), PrintJob | 4 · 9 |
| 18–19 | Consoles, VR, simulators | Device(kind/platform, linkedDisplay, cleaningRequired), DeviceAccessory | 9 |
| 20 | Bookings, no double booking | Booking, BookingResource + EXCLUDE | 6 |
| 21–23 | Customers, wallet (4 buckets + time), membership | Customer, CustomerRestriction, Wallet, WalletTransaction, MembershipTier, Membership | 6 |
| 24 | Pricing engine | PricingPlan(schedule, tier, zone, priority), PricingPackage, Promotion | 4 |
| 25–28, 31, 53 | Unified POS, in-seat ordering, KDS, tables, one combined bill | Product(type), Order(channel/type), OrderItem, Bill, KitchenTicket, RestaurantTable | 7 |
| 29–30 | Inventory, recipes, purchasing, suppliers | InventoryItem, StockLevel, StockLot, StockMovement, RecipeLine, PurchaseOrder, Supplier, SupplierInvoice | 8 |
| 32 | Shifts & cash drawer | CashDrawer, Shift, CashMovement | 7 |
| 33–34 | Staff roles & granular RBAC | Employee, Role, Permission, EmployeeRoleAssignment · `@arena/rbac` | **1** · 2 |
| 35 | Tournaments | Tournament, Team, TournamentPlayer, Match | 10 |
| 36–37 | Loyalty & promotions rules engine | LoyaltyRule, LoyaltyReward, LoyaltyTransaction, Promotion, PromoCode, PromotionRedemption | 10 |
| 38 | Payments (mixed, multi-gateway) | Payment, Refund, PaymentGatewayConfig | 7 |
| 39 | CRM segments & campaigns | CustomerSegment, Campaign | 10 |
| 40 | Customer web/PWA | (API surface over the above) | 6 → 10 |
| 41 | Notifications, all channels | NotificationTemplate, Notification, PushSubscription | 6 → |
| 42 | Reports & analytics | read models over ledgers + OutboxEvent projections | 11 |
| 43 | Live command system | DeviceCommand + `@arena/contracts` device protocol | **1** (protocol) · 3 |
| 44 | Offline mode | EdgeNode, SyncBatch, IdempotencyRecord, `offlineOrigin` flags | 13 |
| 45–46 | Security & audit | RefreshToken, MfaFactor, ApiKey, AuditLog (hash chain) | **1** · 2 · 13 |
| 30, accounting | General ledger | LedgerAccount, JournalEntry, JournalLine, Expense, Invoice | 11 |

## Non-functional requirements

| Area | Target |
|---|---|
| Tenant isolation | Three independent layers; CI tests at every layer (see 05) |
| Command latency | Staff click to PC unlocked: p95 < 1 s on LAN (edge), < 2 s via cloud |
| Session timer accuracy | Expiry within ±2 s of `expiresAt`; survives Shell, Agent, API and Redis restarts |
| Live Floor freshness | Status changes visible within 1 s; heartbeat every 10 s; offline after 30 s |
| Offline | A branch runs sessions, POS and KDS for 72 h+ with no internet and no data loss on reconnect |
| Financial correctness | No duplicate charges on retry or replay (idempotency keys); append-only ledgers; nightly ledger-vs-projection reconciliation |
| Scale (initial) | 2,000 orgs · 10,000 branches · 250,000 stations · 25k heartbeats/s at the edge-aggregated cloud |
| Availability | Cloud 99.9%; branch operation doesn't depend on the cloud |
| Security | MFA for admins; TLS 1.2+; mTLS for devices; secrets only in a secret manager; OWASP ASVS L2 |
| Localization | Multi-language (RTL for Arabic), multi-currency (minor units per currency), per-branch timezone and tax |
| Retention | Heartbeats 30–90 days (then rolled up); audit 7+ years in WORM archive; financial records per local law |
| Privacy | PII masked unless `customer.view_pii`; erasure keeps financial records with PII scrubbed; DOB only where lawful |

## Explicit non-goals (for now)

- A production diskless/PXE server. We build an adapter layer; a native service is a future option (`DisklessProvider.NATIVE`).
- Copying any existing product's UI, branding, assets or exact workflows.
- Automating third-party launchers or accounts beyond what their terms and APIs allow. `GameLicense` pooling is only for publishers that permit commercial or café use.
