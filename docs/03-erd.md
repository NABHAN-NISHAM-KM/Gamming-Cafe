# 03 · Entity-relationship model

**Source of truth:** `packages/db/prisma/schema/*.prisma`, which defines 129 tables across 15 bounded contexts. The diagrams below show relationships only, split by domain. Every tenant entity also has `organizationId`, and its relations are composite `(fk, organizationId)`. That column is omitted below for readability.

| Context file | Tables |
|---|---|
| `platform.prisma` | Country, Currency, SubscriptionPlan, PlanFeature, ClientRelease, User, MfaFactor, PlatformRoleAssignment, RefreshToken, ImpersonationSession |
| `tenancy.prisma` | Organization, Subscription, SubscriptionInvoice, OrganizationFeature, Brand, Branch, Zone, TaxProfile, TaxRate, PaymentGatewayConfig |
| `iam.prisma` | Employee, Permission, Role, RolePermission, EmployeeRoleAssignment |
| `devices.prisma` | Device, DeviceAccessory, DeviceEnrollmentToken, DeviceCredential, DeviceHardware, DeviceHeartbeat, DeviceCommand, MaintenanceSession, RemoteSupportSession, DisklessIntegration, DeviceBootInfo, Alert, PeripheralProfile, BranchSigningKey |
| `games.prisma` | Launcher, Game, OrgGameSetting, GameInstallation, GameUpdateJob, GameLicense, ShellApp, DetectedTitle |
| `sessions.prisma` | PricingPlan, PricingPackage, GamingSession, SessionExtension, SessionTransfer, PrintJob |
| `customers.prisma` | Customer, CustomerNote, CustomerRestriction, CustomerSession, CustomerFavoriteGame, Achievement, CustomerAchievement, MembershipTier, Membership, Wallet, WalletTransaction, LoyaltyRule, LoyaltyReward, LoyaltyTransaction, Screenshot |
| `bookings.prisma` | Booking, BookingResource |
| `pos.prisma` | ProductCategory, Product, ProductBranchPrice, ModifierGroup, Modifier, ProductModifierGroup, ComboItem, RecipeLine, Bill, Order, OrderItem, KitchenStation, KitchenTicket, RestaurantTable |
| `inventory.prisma` | Warehouse, InventoryItem, StockLevel, StockLot, StockMovement, Supplier, PurchaseOrder, PurchaseOrderLine, SupplierInvoice |
| `finance.prisma` | Payment, Refund, CashDrawer, Shift, CashMovement, Invoice, LedgerAccount, JournalEntry, JournalLine, Expense, PostingCursor |
| `esports.prisma` | Tournament, Team, TournamentPlayer, Match |
| `marketing.prisma` | Promotion, PromoCode, PromotionRedemption, CustomerSegment, CustomerSegmentMember, Campaign |
| `staff-ops.prisma` | TimeClockEntry, HandoverNote, SessionFeedback |
| `system.prisma` | NotificationTemplate, Notification, PushSubscription, AuditLog, AuditChainHead, IdempotencyRecord, OutboxEvent, EdgeNode, SyncBatch, ApiKey, WebhookEndpoint, SupportTicket |

## Tenancy & identity

```mermaid
erDiagram
  SubscriptionPlan ||--o{ PlanFeature : defaults
  SubscriptionPlan ||--o{ Subscription : "sold as"
  Organization ||--o{ Subscription : has
  Subscription ||--o{ SubscriptionInvoice : bills
  Organization ||--o{ OrganizationFeature : overrides
  Organization ||--o{ Brand : owns
  Brand ||--o{ Branch : operates
  Branch ||--o{ Zone : contains
  Zone ||--o{ Device : places
  TaxProfile ||--o{ TaxRate : has
  TaxProfile ||--o{ Branch : applies
  User ||--o{ Employee : "member of orgs"
  User ||--o{ PlatformRoleAssignment : "platform role"
  Employee ||--o{ EmployeeRoleAssignment : holds
  Role ||--o{ EmployeeRoleAssignment : granted
  Role ||--o{ RolePermission : includes
  Permission ||--o{ RolePermission : in
  User ||--o{ ImpersonationSession : impersonates
  Employee ||--o{ ImpersonationSession : "as"
```

## Stations, device agent & games

```mermaid
erDiagram
  Device ||--o{ DeviceAccessory : "controllers, wheels"
  Device ||--o{ DeviceCredential : "mTLS certs"
  Device ||--o{ DeviceHardware : snapshots
  Device ||--o{ DeviceHeartbeat : telemetry
  Device ||--o{ DeviceCommand : receives
  Employee ||--o{ DeviceCommand : requests
  Device ||--o{ MaintenanceSession : "maintenance mode"
  Device ||--o| DeviceBootInfo : boots
  DisklessIntegration ||--o{ DeviceBootInfo : serves
  Device ||--o{ Alert : raises
  Device |o--o{ Device : "console → linked TV"
  Launcher ||--o{ Game : launches
  Game ||--o{ GameInstallation : "installed on"
  Device ||--o{ GameInstallation : has
  Game ||--o{ GameUpdateJob : updates
  Launcher ||--o{ GameLicense : "account pool"
  GameLicense }o--o| GamingSession : "assigned to"
```

## Sessions, pricing, customers, wallet, bookings

```mermaid
erDiagram
  PricingPlan ||--o{ PricingPackage : bundles
  MembershipTier |o--o{ PricingPlan : "tier rate"
  Device ||--o{ GamingSession : hosts
  Customer |o--o{ GamingSession : plays
  PricingPlan |o--o{ GamingSession : priced
  GamingSession ||--o{ SessionExtension : extended
  GamingSession ||--o{ SessionTransfer : moved
  Bill |o--o{ GamingSession : "charged to"
  Booking |o--o{ GamingSession : "checks in to"
  Customer ||--o{ Wallet : owns
  Wallet ||--o{ WalletTransaction : ledger
  WalletTransaction |o--o| WalletTransaction : reverses
  Customer ||--o{ Membership : holds
  MembershipTier ||--o{ Membership : level
  Customer ||--o{ LoyaltyTransaction : points
  LoyaltyReward |o--o{ LoyaltyTransaction : redeemed
  Customer ||--o{ CustomerSession : "logins (shell/app)"
  Customer ||--o{ CustomerRestriction : "bans & limits"
  Customer ||--o{ CustomerNote : "staff notes"
  Employee ||--o{ CustomerNote : writes
  Customer |o--o{ Booking : books
  Booking ||--o{ BookingResource : reserves
  Device |o--o{ BookingResource : "station"
  RestaurantTable |o--o{ BookingResource : "table"
```

## Unified POS, restaurant & KDS

One **Bill** per visit aggregates gaming time, extensions, food and merchandise. Non-food items (gaming time, memberships, top-ups, printing, tournament entry) are **Products**, so everything prints on one invoice.

```mermaid
erDiagram
  ProductCategory ||--o{ Product : groups
  Product ||--o{ RecipeLine : "BOM"
  InventoryItem ||--o{ RecipeLine : ingredient
  Product ||--o{ ComboItem : "combo of"
  Product ||--o{ ProductModifierGroup : offers
  ModifierGroup ||--o{ Modifier : options
  Bill ||--o{ Order : "orders in visit"
  Order ||--o{ OrderItem : lines
  Product ||--o{ OrderItem : sold
  GamingSession |o--o{ Order : "in-seat order"
  Device |o--o{ Order : "deliver to seat"
  RestaurantTable |o--o{ Order : table
  KitchenStation ||--o{ KitchenTicket : "routes to"
  Order ||--o{ KitchenTicket : "split per station"
  KitchenTicket |o--o{ OrderItem : prepares
  Bill ||--o{ Payment : "settled by (mixed)"
  Payment ||--o{ Refund : refunded
  Bill ||--o{ Invoice : "fiscal doc"
  Shift ||--o{ Payment : "taken in"
  CashDrawer ||--o{ Shift : sessions
  Shift ||--o{ CashMovement : "drawer ledger"
```

## Inventory, purchasing, accounting

```mermaid
erDiagram
  InventoryItem ||--o{ StockLevel : "on hand"
  Warehouse ||--o{ StockLevel : holds
  InventoryItem ||--o{ StockMovement : ledger
  Warehouse ||--o{ StockMovement : at
  InventoryItem ||--o{ StockLot : "lots/expiry"
  Supplier ||--o{ PurchaseOrder : supplies
  PurchaseOrder ||--o{ PurchaseOrderLine : lines
  InventoryItem ||--o{ PurchaseOrderLine : ordered
  Supplier ||--o{ SupplierInvoice : invoices
  PurchaseOrder |o--o{ SupplierInvoice : matches
  LedgerAccount ||--o{ JournalLine : posts
  JournalEntry ||--o{ JournalLine : "Σdebit = Σcredit"
  Shift |o--o{ Expense : "paid from drawer"
```

## Esports, marketing, system

```mermaid
erDiagram
  Tournament ||--o{ Team : entrants
  Team ||--o{ TournamentPlayer : roster
  Customer ||--o{ TournamentPlayer : plays
  Tournament ||--o{ Match : bracket
  Match }o--o| Match : "winner → next"
  Team |o--o{ Match : "A / B / winner"
  Promotion ||--o{ PromoCode : codes
  Promotion ||--o{ PromotionRedemption : used
  CustomerSegment ||--o{ CustomerSegmentMember : members
  CustomerSegment |o--o{ Campaign : targets
  EdgeNode ||--o{ SyncBatch : uploads
  Customer |o--o{ Notification : receives
```

## Key invariants (enforced in the database)

These live in `prisma/migrations/0003_*` and `0004_*`.

| Invariant | Mechanism |
|---|---|
| No double booking of a station or table | GiST `EXCLUDE` on `(deviceId, tstzrange)` over live bookings |
| One live session per station | `EXCLUDE (deviceId)` where status is live |
| One open shift per cash drawer | `EXCLUDE (cashDrawerId)` where OPEN/CLOSING |
| A pooled account is used by at most one session | `EXCLUDE` + CHECK on `GameLicense` |
| Wallet and points never negative | CHECK on balances and `balanceAfter` |
| Journal entries balance | deferred constraint trigger |
| Ledgers are append-only | triggers + revoked privileges |
| Audit log is tamper-evident | per-org SHA-256 hash chain in a trigger + `app.verify_audit_chain()` |
| Retries never double-charge | `@@unique([organizationId, idempotencyKey])` on Payment, Refund, WalletTransaction, LoyaltyTransaction, StockMovement, SessionExtension, GamingSession, Order, Booking |
| Impersonation is justified and time-boxed | CHECK: reason of 10+ characters, 8 hours or less |
