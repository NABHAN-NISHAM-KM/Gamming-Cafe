-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BookingResourceType" AS ENUM ('PC', 'VIP_PC', 'CONSOLE', 'VR', 'SIMULATOR', 'PRIVATE_ROOM', 'BOOTCAMP', 'RESTAURANT_TABLE');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('STAFF', 'CUSTOMER_WEB', 'CUSTOMER_APP', 'SHELL', 'PHONE', 'API');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'RESTRICTED', 'BANNED', 'PENDING_VERIFICATION', 'DELETED');

-- CreateEnum
CREATE TYPE "RestrictionType" AS ENUM ('BAN', 'ZONE_BLOCK', 'GAME_BLOCK', 'AGE_LIMIT', 'TIME_LIMIT', 'RESTAURANT_BLOCK');

-- CreateEnum
CREATE TYPE "LoginChannel" AS ENUM ('SHELL', 'WEB', 'MOBILE', 'KIOSK', 'POS');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "WalletBucket" AS ENUM ('CASH', 'BONUS', 'PROMO', 'REFUND', 'TIME');

-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('TOPUP', 'SPEND', 'REFUND', 'ADJUSTMENT', 'BONUS_GRANT', 'BONUS_EXPIRE', 'TRANSFER_IN', 'TRANSFER_OUT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "LoyaltySource" AS ENUM ('GAMING', 'RESTAURANT', 'BOOKING', 'TOURNAMENT', 'TOPUP', 'REFERRAL', 'ACHIEVEMENT', 'BIRTHDAY', 'MANUAL');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('FREE_MINUTES', 'PRODUCT', 'DISCOUNT_PERCENT', 'DISCOUNT_AMOUNT', 'TIER_UPGRADE', 'TOURNAMENT_ENTRY', 'WALLET_CREDIT');

-- CreateEnum
CREATE TYPE "LoyaltyTxType" AS ENUM ('EARN', 'REDEEM', 'EXPIRE', 'ADJUST', 'REVERSAL');

-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('GAMING_PC', 'INTERNET_PC', 'CONSOLE', 'VR_HEADSET', 'SIMULATOR', 'KIOSK', 'POS_TERMINAL', 'KDS_SCREEN', 'PRINTER', 'SMART_TV');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('WINDOWS', 'PS5', 'PS4', 'XBOX_SERIES', 'XBOX_ONE', 'SWITCH', 'META_QUEST', 'PICO', 'VALVE_INDEX', 'HTC_VIVE', 'RACING_RIG', 'FLIGHT_SIM', 'MOTION_SIM', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE', 'OFFLINE', 'CLEANING', 'STARTING', 'SESSION_ENDING');

-- CreateEnum
CREATE TYPE "PostSessionAction" AS ENUM ('LOCK', 'LOGOUT_WINDOWS', 'RESTART_SHELL', 'RESTART_PC', 'SHUTDOWN_PC', 'RESTORE_REBOOT');

-- CreateEnum
CREATE TYPE "AccessoryType" AS ENUM ('CONTROLLER', 'HEADSET', 'VR_CONTROLLER', 'STEERING_WHEEL', 'PEDALS', 'SHIFTER', 'JOYSTICK', 'KEYBOARD', 'MOUSE', 'WEBCAM', 'MICROPHONE', 'OTHER');

-- CreateEnum
CREATE TYPE "AccessoryStatus" AS ENUM ('OK', 'NEEDS_CHARGE', 'NEEDS_CLEANING', 'FAULTY', 'MISSING', 'RETIRED');

-- CreateEnum
CREATE TYPE "DeviceCommandType" AS ENUM ('LOCK', 'UNLOCK', 'START_SESSION', 'END_SESSION', 'EXTEND_SESSION', 'MOVE_SESSION', 'RESTART', 'SHUTDOWN', 'WAKE_ON_LAN', 'LOGOUT', 'OPEN_GAME', 'CLOSE_GAME', 'LAUNCH_APP', 'SEND_MESSAGE', 'MAINTENANCE_MODE', 'REFRESH_CONFIG', 'UPDATE_CLIENT', 'RUN_REPAIR', 'SCREENSHOT');

-- CreateEnum
CREATE TYPE "DeviceCommandStatus" AS ENUM ('PENDING', 'SENT', 'RECEIVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaintenanceAuthMethod" AS ENUM ('PIN', 'RFID', 'ADMIN_ACCOUNT', 'REMOTE_GRANT');

-- CreateEnum
CREATE TYPE "RemoteSupportProvider" AS ENUM ('BUILTIN_VNC', 'RUSTDESK', 'ANYDESK', 'TEAMVIEWER', 'OTHER');

-- CreateEnum
CREATE TYPE "DisklessProvider" AS ENUM ('CCBOOT', 'ISCSI_PXE', 'GGROCK', 'NATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "BootStatus" AS ENUM ('UNKNOWN', 'PXE', 'BOOTING', 'BOOTED', 'FAILED', 'LOCAL_DISK');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'LEAGUE', 'SWISS');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('REGISTERED', 'PAYMENT_PENDING', 'CONFIRMED', 'CHECKED_IN', 'ELIMINATED', 'WITHDRAWN', 'DISQUALIFIED', 'WINNER');

-- CreateEnum
CREATE TYPE "BracketSide" AS ENUM ('WINNERS', 'LOSERS', 'GRAND_FINAL', 'GROUP', 'LEAGUE');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'SCHEDULED', 'READY', 'LIVE', 'AWAITING_CONFIRMATION', 'COMPLETED', 'DISPUTED', 'WALKOVER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'WALLET', 'ONLINE', 'QR', 'BANK_TRANSFER', 'GIFT_CARD', 'LOYALTY_POINTS');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'REQUIRES_ACTION', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'VOIDED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RefundDestination" AS ENUM ('ORIGINAL_METHOD', 'WALLET', 'CASH');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED', 'PENDING_APPROVAL', 'APPROVED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('OPENING_FLOAT', 'CASH_SALE', 'CASH_REFUND', 'PAY_IN', 'PAY_OUT', 'EXPENSE', 'SAFE_DROP', 'CHANGE_CORRECTION');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "GameCategory" AS ENUM ('FPS', 'MOBA', 'SPORTS', 'RACING', 'BATTLE_ROYALE', 'STORY', 'MULTIPLAYER', 'COMPETITIVE', 'KIDS', 'VR', 'STRATEGY', 'RPG', 'FIGHTING', 'CASUAL', 'SIMULATION');

-- CreateEnum
CREATE TYPE "InstallStatus" AS ENUM ('NOT_INSTALLED', 'INSTALLED', 'UPDATE_REQUIRED', 'QUEUED', 'DOWNLOADING', 'UPDATING', 'VERIFYING', 'CORRUPTED', 'FAILED');

-- CreateEnum
CREATE TYPE "UpdateJobStatus" AS ENUM ('SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'COOLDOWN', 'DISABLED', 'LOCKED_BY_PROVIDER');

-- CreateEnum
CREATE TYPE "ShellAppKind" AS ENUM ('BROWSER', 'OFFICE', 'COMMUNICATION', 'MEDIA', 'UTILITY', 'PERIPHERAL_UTILITY', 'PLATFORM_LAUNCHER');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('ORGANIZATION', 'BRAND', 'BRANCH');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('CENTRAL', 'BRANCH_STORE', 'KITCHEN', 'BAR', 'TECH_STORE');

-- CreateEnum
CREATE TYPE "InventoryCategory" AS ENUM ('FOOD', 'DRINK', 'INGREDIENT', 'GAMING_ACCESSORY', 'CONTROLLER', 'HEADSET', 'MERCHANDISE', 'PC_PART', 'CONSUMABLE', 'PACKAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE_RECEIPT', 'SALE', 'RECIPE_CONSUMPTION', 'ADJUSTMENT', 'WASTE', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN_TO_SUPPLIER', 'CUSTOMER_RETURN', 'STOCK_COUNT', 'ISSUE_TO_STATION');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'DISPUTED', 'VOID');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PROMO_CODE', 'HAPPY_HOUR', 'BUY_X_GET_Y', 'BUNDLE', 'PACKAGE', 'BIRTHDAY', 'WEEKEND', 'REFERRAL', 'FIRST_VISIT', 'AUTOMATIC_DISCOUNT');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SegmentKind" AS ENUM ('STATIC', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PlanInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ReleaseChannel" AS ENUM ('STABLE', 'BETA', 'CANARY');

-- CreateEnum
CREATE TYPE "ReleaseComponent" AS ENUM ('WINDOWS_SHELL', 'WINDOWS_AGENT', 'EDGE_SERVER', 'KDS', 'POS');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'CHECKOUT_COM', 'NETWORK_INTERNATIONAL', 'TELR', 'PAYTABS', 'OTTU', 'MANUAL');

-- CreateEnum
CREATE TYPE "MfaType" AS ENUM ('TOTP', 'WEBAUTHN', 'RECOVERY_CODE');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'PLATFORM_SUPPORT', 'PLATFORM_BILLING', 'PLATFORM_READONLY');

-- CreateEnum
CREATE TYPE "TokenSubject" AS ENUM ('USER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('STOCK_ITEM', 'RECIPE_ITEM', 'COMBO', 'SERVICE', 'GAMING_TIME', 'MEMBERSHIP', 'WALLET_TOPUP', 'PRINTING', 'BOOKING_FEE', 'TOURNAMENT_ENTRY', 'GIFT_CARD');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('POS', 'SHELL', 'WAITER', 'QR_TABLE', 'WEB', 'MOBILE', 'KIOSK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'GAMING_SEAT', 'TAKEAWAY', 'DELIVERY', 'PICKUP', 'COUNTER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PLACED', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'ON_BILL', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED', 'VOIDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "KitchenTicketStatus" AS ENUM ('NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'BILL_REQUESTED', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('PER_MINUTE', 'PER_HOUR', 'FIXED_DURATION', 'DAY_PASS', 'NIGHT_PASS', 'PACKAGE');

-- CreateEnum
CREATE TYPE "PaymentTiming" AS ENUM ('PREPAID', 'POSTPAID');

-- CreateEnum
CREATE TYPE "StationClass" AS ENUM ('PC', 'CONSOLE', 'VR', 'SIMULATOR', 'INTERNET', 'PRIVATE_ROOM');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'ENDING', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionEndReason" AS ENUM ('EXPIRED', 'STAFF_ENDED', 'CUSTOMER_LOGOUT', 'MOVED', 'DEVICE_FAILURE', 'BALANCE_EXHAUSTED', 'ADMIN_FORCE');

-- CreateEnum
CREATE TYPE "ExtensionSource" AS ENUM ('STAFF', 'CUSTOMER_SHELL', 'CUSTOMER_APP', 'PROMOTION', 'COMPENSATION');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('QUEUED', 'HELD', 'PRINTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SHELL', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP', 'KDS', 'STAFF_CONSOLE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('CUSTOMER', 'EMPLOYEE', 'DEVICE', 'BRANCH_STAFF');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('PLATFORM_ADMIN', 'EMPLOYEE', 'CUSTOMER', 'DEVICE', 'SYSTEM', 'API_KEY');

-- CreateEnum
CREATE TYPE "EdgeNodeStatus" AS ENUM ('PROVISIONING', 'ONLINE', 'DEGRADED', 'OFFLINE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "SyncBatchStatus" AS ENUM ('RECEIVED', 'APPLIED', 'PARTIALLY_APPLIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'FAILED', 'VOID');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('SETUP', 'OPEN', 'TEMPORARILY_CLOSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('PC_STANDARD', 'PC_VIP', 'BOOTCAMP', 'STREAMING', 'CONSOLE', 'VR', 'SIMULATOR', 'INTERNET', 'RESTAURANT', 'PRIVATE_ROOM', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxAppliesTo" AS ENUM ('ALL', 'GAMING', 'FOOD', 'BEVERAGE', 'MERCHANDISE', 'SERVICE');

-- CreateEnum
CREATE TYPE "GatewayMode" AS ENUM ('TEST', 'LIVE');

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "zoneId" UUID,
    "customerId" UUID,
    "reference" TEXT NOT NULL,
    "resourceType" "BookingResourceType" NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "players" INTEGER NOT NULL DEFAULT 1,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "source" "BookingSource" NOT NULL DEFAULT 'STAFF',
    "contactName" TEXT,
    "contactPhone" TEXT,
    "estimatedTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "depositAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "promoCode" TEXT,
    "notes" TEXT,
    "holdExpiresAt" TIMESTAMPTZ(3),
    "checkedInAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdById" UUID,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingResource" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "deviceId" UUID,
    "tableId" UUID,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "isLive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BookingResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "dateOfBirth" DATE,
    "avatarUrl" TEXT,
    "passwordHash" TEXT,
    "pinHash" TEXT,
    "qrLoginSecretRef" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "membershipTierId" UUID,
    "homeBranchId" UUID,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "referralCode" TEXT,
    "referredById" UUID,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "totalGamingMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalSpend" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "lastVisitAt" TIMESTAMPTZ(3),
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "phoneVerifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRestriction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "RestrictionType" NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "liftedAt" TIMESTAMPTZ(3),
    "liftedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "channel" "LoginChannel" NOT NULL,
    "deviceId" UUID,
    "gamingSessionId" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFavoriteGame" (
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFavoriteGame_pkey" PRIMARY KEY ("customerId","gameId")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT,
    "criteria" JSONB NOT NULL,
    "rewardPoints" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAchievement" (
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "achievementId" UUID NOT NULL,
    "earnedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAchievement_pkey" PRIMARY KEY ("customerId","achievementId")
);

-- CreateTable
CREATE TABLE "MembershipTier" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "color" TEXT,
    "price" DECIMAL(19,4),
    "durationDays" INTEGER,
    "gamingDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "restaurantDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tournamentDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "loyaltyMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "bonusMinutesMonthly" INTEGER NOT NULL DEFAULT 0,
    "priorityBooking" BOOLEAN NOT NULL DEFAULT false,
    "bookingWindowDays" INTEGER NOT NULL DEFAULT 7,
    "birthdayReward" JSONB,
    "autoQualifyRules" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MembershipTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "tierId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "orderItemId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "cashBalance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "bonusBalance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "promoBalance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "refundBalance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "timeBalanceMin" INTEGER NOT NULL DEFAULT 0,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "branchId" UUID,
    "type" "WalletTxType" NOT NULL,
    "bucket" "WalletBucket" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "balanceAfter" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "referenceType" TEXT,
    "referenceId" UUID,
    "paymentId" UUID,
    "employeeId" UUID,
    "reason" TEXT,
    "reversesId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "source" "LoyaltySource" NOT NULL,
    "pointsPerUnit" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "branchIds" UUID[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoyaltyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyReward" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "costPoints" INTEGER NOT NULL,
    "rewardType" "RewardType" NOT NULL,
    "value" JSONB NOT NULL,
    "stock" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoyaltyReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "LoyaltyTxType" NOT NULL,
    "source" "LoyaltySource" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "rewardId" UUID,
    "referenceType" TEXT,
    "referenceId" UUID,
    "employeeId" UUID,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DeviceKind" NOT NULL,
    "platform" "DevicePlatform" NOT NULL DEFAULT 'WINDOWS',
    "status" "DeviceStatus" NOT NULL DEFAULT 'OFFLINE',
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mapX" INTEGER NOT NULL DEFAULT 0,
    "mapY" INTEGER NOT NULL DEFAULT 0,
    "mapW" INTEGER NOT NULL DEFAULT 1,
    "mapH" INTEGER NOT NULL DEFAULT 1,
    "mapRotation" INTEGER NOT NULL DEFAULT 0,
    "macAddress" TEXT,
    "ipAddress" TEXT,
    "hostname" TEXT,
    "controllerCount" INTEGER,
    "linkedDisplayId" UUID,
    "agentVersion" TEXT,
    "shellVersion" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3),
    "postSessionAction" "PostSessionAction" NOT NULL DEFAULT 'LOCK',
    "cleaningRequired" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAccessory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "type" "AccessoryType" NOT NULL,
    "label" TEXT,
    "vendor" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "status" "AccessoryStatus" NOT NULL DEFAULT 'OK',
    "inventoryItemId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeviceAccessory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceEnrollmentToken" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "zoneId" UUID,
    "tokenHash" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "usedByDeviceId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceEnrollmentToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCredential" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "certSerial" TEXT NOT NULL,
    "certThumbprint" TEXT NOT NULL,
    "publicKeyPem" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,

    CONSTRAINT "DeviceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceHardware" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "hardwareHash" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "cpu" TEXT,
    "cpuCores" INTEGER,
    "gpu" TEXT,
    "gpuVramMb" INTEGER,
    "ramMb" INTEGER,
    "motherboard" TEXT,
    "biosVersion" TEXT,
    "osVersion" TEXT,
    "disks" JSONB NOT NULL DEFAULT '[]',
    "nics" JSONB NOT NULL DEFAULT '[]',
    "monitors" JSONB NOT NULL DEFAULT '[]',
    "peripherals" JSONB NOT NULL DEFAULT '[]',
    "collectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceHardware_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceHeartbeat" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuPct" DOUBLE PRECISION,
    "gpuPct" DOUBLE PRECISION,
    "ramPct" DOUBLE PRECISION,
    "diskPct" DOUBLE PRECISION,
    "cpuTempC" DOUBLE PRECISION,
    "gpuTempC" DOUBLE PRECISION,
    "pingMs" DOUBLE PRECISION,
    "packetLossPct" DOUBLE PRECISION,
    "fps" DOUBLE PRECISION,
    "uptimeSec" INTEGER,
    "foregroundApp" TEXT,
    "shellState" TEXT,

    CONSTRAINT "DeviceHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCommand" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "type" "DeviceCommandType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "DeviceCommandStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID,
    "batchId" UUID,
    "nonce" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "sentAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3),
    "executingAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "DeviceCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "authMethod" "MaintenanceAuthMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedTools" TEXT[],
    "actions" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "endReason" TEXT,

    CONSTRAINT "MaintenanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemoteSupportSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "provider" "RemoteSupportProvider" NOT NULL DEFAULT 'BUILTIN_VNC',
    "viewOnly" BOOLEAN NOT NULL DEFAULT true,
    "customerConsented" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RemoteSupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisklessIntegration" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "provider" "DisklessProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint" TEXT,
    "credentialsRef" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DisklessIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceBootInfo" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "integrationId" UUID,
    "imageName" TEXT,
    "imageVersion" TEXT,
    "bootServer" TEXT,
    "gameDisk" TEXT,
    "writebackPath" TEXT,
    "writebackUsedMb" INTEGER,
    "cacheSizeMb" INTEGER,
    "cacheHitPct" DOUBLE PRECISION,
    "bootStatus" "BootStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastBootAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeviceBootInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "deviceId" UUID,
    "type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMPTZ(3),
    "acknowledgedById" UUID,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeripheralProfile" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "category" "AccessoryType" NOT NULL,
    "vendor" TEXT,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "vendorUtility" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PeripheralProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "gameId" UUID,
    "customGameName" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "bannerUrl" TEXT,
    "format" "TournamentFormat" NOT NULL,
    "teamSize" INTEGER NOT NULL DEFAULT 1,
    "maxTeams" INTEGER NOT NULL,
    "minTeams" INTEGER NOT NULL DEFAULT 2,
    "entryFee" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "entryFeeProductId" UUID,
    "prizePool" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "prizeDistribution" JSONB NOT NULL DEFAULT '[]',
    "currency" CHAR(3) NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "rules" TEXT,
    "sponsors" JSONB NOT NULL DEFAULT '[]',
    "registrationOpensAt" TIMESTAMPTZ(3),
    "registrationClosesAt" TIMESTAMPTZ(3),
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3),
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT,
    "logoUrl" TEXT,
    "captainId" UUID,
    "seed" INTEGER,
    "status" "EntryStatus" NOT NULL DEFAULT 'REGISTERED',
    "paymentId" UUID,
    "finalPlacement" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentPlayer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "inGameName" TEXT,
    "role" TEXT,
    "isSubstitute" BOOLEAN NOT NULL DEFAULT false,
    "checkedInAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "bracket" "BracketSide" NOT NULL DEFAULT 'WINNERS',
    "round" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "bestOf" INTEGER NOT NULL DEFAULT 1,
    "teamAId" UUID,
    "teamBId" UUID,
    "scoreA" INTEGER,
    "scoreB" INTEGER,
    "winnerTeamId" UUID,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "nextMatchId" UUID,
    "loserNextMatchId" UUID,
    "scheduledAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "stationIds" UUID[],
    "games" JSONB NOT NULL DEFAULT '[]',
    "reportedById" UUID,
    "confirmedById" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "billId" UUID,
    "orderId" UUID,
    "bookingId" UUID,
    "customerId" UUID,
    "shiftId" UUID,
    "employeeId" UUID,
    "method" "PaymentMethod" NOT NULL,
    "provider" "PaymentProvider",
    "gatewayConfigId" UUID,
    "providerRef" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(19,4) NOT NULL,
    "tipAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "cashTendered" DECIMAL(19,4),
    "changeGiven" DECIMAL(19,4),
    "cardLast4" TEXT,
    "cardBrand" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "offlineOrigin" BOOLEAN NOT NULL DEFAULT false,
    "authorizedAt" TIMESTAMPTZ(3),
    "capturedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "destination" "RefundDestination" NOT NULL DEFAULT 'ORIGINAL_METHOD',
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "providerRef" TEXT,
    "orderItemIds" UUID[],
    "requestedById" UUID NOT NULL,
    "approvedById" UUID,
    "shiftId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDrawer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "posDeviceId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CashDrawer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "cashDrawerId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "currency" CHAR(3) NOT NULL,
    "openingCash" DECIMAL(19,4) NOT NULL,
    "expectedCash" DECIMAL(19,4),
    "countedCash" DECIMAL(19,4),
    "variance" DECIMAL(19,4),
    "denominations" JSONB,
    "totals" JSONB,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "paymentId" UUID,
    "refundId" UUID,
    "expenseId" UUID,
    "employeeId" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" UUID,
    "customerName" TEXT,
    "customerTaxNo" TEXT,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL(19,4) NOT NULL,
    "discountTotal" DECIMAL(19,4) NOT NULL,
    "taxTotal" DECIMAL(19,4) NOT NULL,
    "total" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "taxBreakdown" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "pdfUrl" TEXT,
    "fiscalRef" TEXT,
    "isCreditNote" BOOLEAN NOT NULL DEFAULT false,
    "originalId" UUID,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" UUID,
    "systemKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "entryDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID,
    "currency" CHAR(3) NOT NULL,
    "postedById" UUID,
    "reversesId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "debit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "paidVia" "PaymentMethod" NOT NULL,
    "shiftId" UUID,
    "supplierId" UUID,
    "receiptUrl" TEXT,
    "incurredAt" DATE NOT NULL,
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Launcher" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "executablePath" TEXT,
    "arguments" TEXT,
    "processNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "iconUrl" TEXT,
    "requiresAccount" BOOLEAN NOT NULL DEFAULT true,
    "logoutScript" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Launcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "developer" TEXT,
    "publisher" TEXT,
    "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categories" "GameCategory"[] DEFAULT ARRAY[]::"GameCategory"[],
    "platform" "DevicePlatform" NOT NULL DEFAULT 'WINDOWS',
    "launcherId" UUID,
    "launcherGameId" TEXT,
    "executablePath" TEXT,
    "arguments" TEXT,
    "workingDirectory" TEXT,
    "processNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coverUrl" TEXT,
    "bannerUrl" TEXT,
    "iconUrl" TEXT,
    "trailerUrl" TEXT,
    "ageRating" TEXT,
    "minAge" INTEGER,
    "requiresAccount" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgGameSetting" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "minAgeOverride" INTEGER,
    "allowedZoneIds" UUID[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrgGameSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameInstallation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "version" TEXT,
    "buildId" TEXT,
    "installPath" TEXT,
    "sizeBytes" BIGINT,
    "status" "InstallStatus" NOT NULL DEFAULT 'NOT_INSTALLED',
    "progressPct" DOUBLE PRECISION,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "lastPlayedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GameInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameUpdateJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "targetVersion" TEXT,
    "status" "UpdateJobStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledFor" TIMESTAMPTZ(3) NOT NULL,
    "bandwidthLimitKbps" INTEGER,
    "progressPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "devicesTotal" INTEGER NOT NULL DEFAULT 0,
    "devicesDone" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "error" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GameUpdateJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameLicense" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "launcherId" UUID NOT NULL,
    "gameId" UUID,
    "accountLabel" TEXT NOT NULL,
    "accountUsername" TEXT NOT NULL,
    "secretRef" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'AVAILABLE',
    "assignedSessionId" UUID,
    "assignedDeviceId" UUID,
    "assignedAt" TIMESTAMPTZ(3),
    "releasedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GameLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShellApp" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "name" TEXT NOT NULL,
    "kind" "ShellAppKind" NOT NULL,
    "executablePath" TEXT NOT NULL,
    "arguments" TEXT,
    "iconUrl" TEXT,
    "allowedZoneIds" UUID[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShellApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'INVITED',
    "pinHash" TEXT,
    "rfidTagHash" TEXT,
    "homeBranchId" UUID,
    "hourlyRate" DECIMAL(19,4),
    "hiredAt" DATE,
    "terminatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionKey" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionKey")
);

-- CreateTable
CREATE TABLE "EmployeeRoleAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "scope" "RoleScope" NOT NULL,
    "brandId" UUID,
    "branchId" UUID,
    "grantedById" UUID,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "name" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "category" "InventoryCategory" NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "purchaseUnit" TEXT,
    "purchaseUnitQty" DECIMAL(14,4),
    "averageCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "lastPurchaseCost" DECIMAL(19,4),
    "minStock" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "reorderQty" DECIMAL(14,4),
    "trackExpiry" BOOLEAN NOT NULL DEFAULT false,
    "trackSerial" BOOLEAN NOT NULL DEFAULT false,
    "defaultSupplierId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "lotCode" TEXT,
    "serialNumber" TEXT,
    "expiresAt" DATE,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(19,4) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "lotId" UUID,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(19,4) NOT NULL,
    "quantityAfter" DECIMAL(14,4) NOT NULL,
    "referenceType" TEXT,
    "referenceId" UUID,
    "transferId" UUID,
    "employeeId" UUID,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "taxNumber" TEXT,
    "address" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "currency" CHAR(3) NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "warehouseId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "expectedAt" DATE,
    "orderedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantityOrdered" DECIMAL(14,4) NOT NULL,
    "quantityReceived" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(19,4) NOT NULL,
    "taxRatePercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "purchaseOrderId" UUID,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "documentUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "PromotionType" NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "effects" JSONB NOT NULL DEFAULT '[]',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isStackable" BOOLEAN NOT NULL DEFAULT false,
    "requiresCode" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "totalUsageLimit" INTEGER,
    "perCustomerLimit" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "budgetAmount" DECIMAL(19,4),
    "budgetUsed" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "promotionId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "customerId" UUID,
    "expiresAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRedemption" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "promotionId" UUID NOT NULL,
    "promoCodeId" UUID,
    "customerId" UUID,
    "orderId" UUID,
    "gamingSessionId" UUID,
    "bookingId" UUID,
    "discountAmount" DECIMAL(19,4) NOT NULL,
    "bonusMinutes" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "reversedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSegment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "kind" "SegmentKind" NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "lastEvaluatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomerSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSegmentMember" (
    "organizationId" UUID NOT NULL,
    "segmentId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSegmentMember_pkey" PRIMARY KEY ("segmentId","customerId")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "segmentId" UUID,
    "promotionId" UUID,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "templateKey" TEXT,
    "scheduledAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "stats" JSONB NOT NULL DEFAULT '{}',
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCurrency" CHAR(3) NOT NULL,
    "defaultTimezone" TEXT NOT NULL,
    "defaultLocale" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Currency" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "minorUnit" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "interval" "PlanInterval" NOT NULL DEFAULT 'MONTHLY',
    "maxBranches" INTEGER,
    "maxDevices" INTEGER,
    "maxEmployees" INTEGER,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limitValue" INTEGER,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRelease" (
    "id" UUID NOT NULL,
    "component" "ReleaseComponent" NOT NULL,
    "channel" "ReleaseChannel" NOT NULL DEFAULT 'STABLE',
    "version" TEXT NOT NULL,
    "artifactUrl" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "releaseNotes" TEXT,
    "minVersion" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClientRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMPTZ(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaFactor" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "MfaType" NOT NULL,
    "label" TEXT,
    "secretEnc" TEXT NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformRoleAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "subjectType" "TokenSubject" NOT NULL,
    "userId" UUID,
    "customerId" UUID,
    "organizationId" UUID,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "rotatedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationSession" (
    "id" UUID NOT NULL,
    "platformUserId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "targetEmployeeId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "ticketRef" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "showInShell" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "type" "ProductType" NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "price" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "taxAppliesTo" "TaxAppliesTo" NOT NULL DEFAULT 'ALL',
    "inventoryItemId" UUID,
    "kitchenStationId" UUID,
    "prepTimeMinutes" INTEGER,
    "availableInShell" BOOLEAN NOT NULL DEFAULT true,
    "availableOnline" BOOLEAN NOT NULL DEFAULT true,
    "requiresAgeCheck" BOOLEAN NOT NULL DEFAULT false,
    "pricingPackageId" UUID,
    "membershipTierId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBranchPrice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "price" DECIMAL(19,4),
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductBranchPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modifier" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "inventoryItemId" UUID,
    "inventoryQty" DECIMAL(14,4),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductModifierGroup" (
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "modifierGroupId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductModifierGroup_pkey" PRIMARY KEY ("productId","modifierGroupId")
);

-- CreateTable
CREATE TABLE "ComboItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "comboId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ComboItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "wastePct" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" UUID,
    "tableId" UUID,
    "status" "BillStatus" NOT NULL DEFAULT 'OPEN',
    "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "tipTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "paidTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "openedById" UUID,
    "closedById" UUID,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "channel" "OrderChannel" NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentState" "PaymentState" NOT NULL DEFAULT 'UNPAID',
    "billId" UUID,
    "customerId" UUID,
    "deviceId" UUID,
    "gamingSessionId" UUID,
    "tableId" UUID,
    "employeeId" UUID,
    "shiftId" UUID,
    "deliverTo" TEXT,
    "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "tipTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "notes" TEXT,
    "placedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "cancelledById" UUID,
    "idempotencyKey" TEXT,
    "offlineOrigin" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "kitchenTicketId" UUID,
    "nameSnapshot" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "modifiers" JSONB NOT NULL DEFAULT '[]',
    "modifiersTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(19,4) NOT NULL,
    "taxBreakdown" JSONB NOT NULL DEFAULT '[]',
    "promotionId" UUID,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "gamingSessionId" UUID,
    "bookingId" UUID,
    "seatLabel" TEXT,
    "voidedById" UUID,
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenStation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "displayDeviceId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KitchenStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenTicket" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "status" "KitchenTicketStatus" NOT NULL DEFAULT 'NEW',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "deliverTo" TEXT,
    "customerLabel" TEXT,
    "notes" TEXT,
    "acceptedAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "readyAt" TIMESTAMPTZ(3),
    "servedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "bumpedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantTable" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "zoneId" UUID,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "shape" TEXT NOT NULL DEFAULT 'rect',
    "mapX" INTEGER NOT NULL DEFAULT 0,
    "mapY" INTEGER NOT NULL DEFAULT 0,
    "mapW" INTEGER NOT NULL DEFAULT 1,
    "mapH" INTEGER NOT NULL DEFAULT 1,
    "qrToken" TEXT NOT NULL,
    "mergedIntoId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RestaurantTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingPlan" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "zoneId" UUID,
    "membershipTierId" UUID,
    "name" TEXT NOT NULL,
    "stationClass" "StationClass" NOT NULL,
    "billingMode" "BillingMode" NOT NULL,
    "paymentTiming" "PaymentTiming" NOT NULL DEFAULT 'PREPAID',
    "rate" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "minMinutes" INTEGER NOT NULL DEFAULT 0,
    "roundingMinutes" INTEGER NOT NULL DEFAULT 1,
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "schedule" JSONB NOT NULL DEFAULT '[]',
    "passStartTime" TEXT,
    "passEndTime" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMPTZ(3),
    "validTo" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PricingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingPackage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "pricingPlanId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "price" DECIMAL(19,4) NOT NULL,
    "bonusMinutes" INTEGER NOT NULL DEFAULT 0,
    "expiresAfterDays" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PricingPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamingSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "customerId" UUID,
    "guestLabel" TEXT,
    "bookingId" UUID,
    "billId" UUID,
    "stationClass" "StationClass" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING',
    "pricingPlanId" UUID,
    "pricingPackageId" UUID,
    "billingMode" "BillingMode" NOT NULL,
    "paymentTiming" "PaymentTiming" NOT NULL,
    "rateSnapshot" JSONB NOT NULL,
    "allocatedMinutes" INTEGER,
    "startedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "pausedAt" TIMESTAMPTZ(3),
    "totalPausedSeconds" INTEGER NOT NULL DEFAULT 0,
    "endedAt" TIMESTAMPTZ(3),
    "endReason" "SessionEndReason",
    "billedSeconds" INTEGER NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "warningsSent" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "postSessionAction" "PostSessionAction" NOT NULL,
    "startedById" UUID,
    "endedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "offlineOrigin" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GamingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionExtension" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "minutes" INTEGER NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "source" "ExtensionSource" NOT NULL,
    "employeeId" UUID,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionTransfer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "fromDeviceId" UUID NOT NULL,
    "toDeviceId" UUID NOT NULL,
    "employeeId" UUID,
    "reason" TEXT,
    "priceDelta" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "printerId" UUID,
    "customerId" UUID,
    "sessionId" UUID,
    "documentName" TEXT,
    "pages" INTEGER NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "isColor" BOOLEAN NOT NULL DEFAULT false,
    "isScan" BOOLEAN NOT NULL DEFAULT false,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "total" DECIMAL(19,4) NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'QUEUED',
    "orderItemId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "event" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "providerTemplateId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "recipientType" "RecipientType" NOT NULL,
    "customerId" UUID,
    "employeeId" UUID,
    "deviceId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "event" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "providerRef" TEXT,
    "error" TEXT,
    "dedupeKey" TEXT,
    "scheduledFor" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID,
    "employeeId" UUID,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "branchId" UUID,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "actorRole" TEXT,
    "impersonatorId" UUID,
    "deviceId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "prevHash" TEXT,
    "chainSeq" BIGINT NOT NULL DEFAULT 0,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditChainHead" (
    "chainKey" UUID NOT NULL,
    "lastHash" TEXT NOT NULL,
    "length" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditChainHead_pkey" PRIMARY KEY ("chainKey")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EdgeNode" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "status" "EdgeNodeStatus" NOT NULL DEFAULT 'PROVISIONING',
    "certThumbprint" TEXT,
    "lanAddress" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3),
    "lastSyncAt" TIMESTAMPTZ(3),
    "syncCursor" BIGINT NOT NULL DEFAULT 0,
    "pendingUpload" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EdgeNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncBatch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "edgeNodeId" UUID NOT NULL,
    "batchKey" TEXT NOT NULL,
    "mutationCount" INTEGER NOT NULL,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "status" "SyncBatchStatus" NOT NULL DEFAULT 'RECEIVED',
    "conflicts" JSONB NOT NULL DEFAULT '[]',
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SyncBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "branchIds" UUID[],
    "allowedIps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secretRef" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "deviceId" UUID,
    "customerId" UUID,
    "assigneeId" UUID,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'TRIAL',
    "countryCode" CHAR(2) NOT NULL,
    "defaultCurrency" CHAR(3) NOT NULL,
    "defaultTimezone" TEXT NOT NULL,
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "supportedLocales" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "taxNumber" TEXT,
    "billingEmail" TEXT NOT NULL,
    "suspendedAt" TIMESTAMPTZ(3),
    "suspendReason" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currentPeriodStart" TIMESTAMPTZ(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMPTZ(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "maxBranches" INTEGER,
    "maxDevices" INTEGER,
    "maxEmployees" INTEGER,
    "externalRef" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationFeature" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "limitValue" INTEGER,
    "reason" TEXT,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrganizationFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "shellTheme" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BranchStatus" NOT NULL DEFAULT 'SETUP',
    "countryCode" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "phone" TEXT,
    "email" TEXT,
    "taxProfileId" UUID,
    "openingHours" JSONB NOT NULL DEFAULT '{}',
    "allowedIpCidrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ZoneType" NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "minAge" INTEGER,
    "openingHours" JSONB,
    "bookingRules" JSONB NOT NULL DEFAULT '{}',
    "floorMap" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxProfile" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "taxProfileId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ratePercent" DECIMAL(7,4) NOT NULL,
    "appliesTo" "TaxAppliesTo" NOT NULL DEFAULT 'ALL',
    "isCompound" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentGatewayConfig" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "provider" "PaymentProvider" NOT NULL,
    "mode" "GatewayMode" NOT NULL DEFAULT 'TEST',
    "credentialsRef" TEXT NOT NULL,
    "webhookSecretRef" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Booking_organizationId_branchId_startsAt_idx" ON "Booking"("organizationId", "branchId", "startsAt");

-- CreateIndex
CREATE INDEX "Booking_organizationId_customerId_idx" ON "Booking"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_id_organizationId_key" ON "Booking"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_organizationId_reference_key" ON "Booking"("organizationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_organizationId_idempotencyKey_key" ON "Booking"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BookingResource_organizationId_bookingId_idx" ON "BookingResource"("organizationId", "bookingId");

-- CreateIndex
CREATE INDEX "BookingResource_deviceId_startsAt_idx" ON "BookingResource"("deviceId", "startsAt");

-- CreateIndex
CREATE INDEX "BookingResource_tableId_startsAt_idx" ON "BookingResource"("tableId", "startsAt");

-- CreateIndex
CREATE INDEX "Customer_organizationId_status_idx" ON "Customer"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_organizationId_key" ON "Customer"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_username_key" ON "Customer"("organizationId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_email_key" ON "Customer"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_phone_key" ON "Customer"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_referralCode_key" ON "Customer"("organizationId", "referralCode");

-- CreateIndex
CREATE INDEX "CustomerRestriction_organizationId_customerId_idx" ON "CustomerRestriction"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "CustomerSession_organizationId_customerId_startedAt_idx" ON "CustomerSession"("organizationId", "customerId", "startedAt");

-- CreateIndex
CREATE INDEX "CustomerFavoriteGame_organizationId_idx" ON "CustomerFavoriteGame"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_id_organizationId_key" ON "Achievement"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_organizationId_key_key" ON "Achievement"("organizationId", "key");

-- CreateIndex
CREATE INDEX "CustomerAchievement_organizationId_idx" ON "CustomerAchievement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipTier_id_organizationId_key" ON "MembershipTier"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipTier_organizationId_code_key" ON "MembershipTier"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Membership_organizationId_customerId_status_idx" ON "Membership"("organizationId", "customerId", "status");

-- CreateIndex
CREATE INDEX "Wallet_organizationId_idx" ON "Wallet"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_id_organizationId_key" ON "Wallet"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_customerId_currency_key" ON "Wallet"("customerId", "currency");

-- CreateIndex
CREATE INDEX "WalletTransaction_organizationId_walletId_createdAt_idx" ON "WalletTransaction"("organizationId", "walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_id_organizationId_key" ON "WalletTransaction"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_reversesId_organizationId_key" ON "WalletTransaction"("reversesId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_organizationId_idempotencyKey_key" ON "WalletTransaction"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LoyaltyRule_organizationId_source_idx" ON "LoyaltyRule"("organizationId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyReward_id_organizationId_key" ON "LoyaltyReward"("id", "organizationId");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_organizationId_customerId_createdAt_idx" ON "LoyaltyTransaction"("organizationId", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyTransaction_organizationId_idempotencyKey_key" ON "LoyaltyTransaction"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Device_organizationId_branchId_status_idx" ON "Device"("organizationId", "branchId", "status");

-- CreateIndex
CREATE INDEX "Device_organizationId_zoneId_idx" ON "Device"("organizationId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_id_organizationId_key" ON "Device"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_branchId_name_key" ON "Device"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Device_organizationId_macAddress_key" ON "Device"("organizationId", "macAddress");

-- CreateIndex
CREATE INDEX "DeviceAccessory_organizationId_deviceId_idx" ON "DeviceAccessory"("organizationId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceEnrollmentToken_tokenHash_key" ON "DeviceEnrollmentToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DeviceEnrollmentToken_organizationId_idx" ON "DeviceEnrollmentToken"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCredential_certSerial_key" ON "DeviceCredential"("certSerial");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCredential_certThumbprint_key" ON "DeviceCredential"("certThumbprint");

-- CreateIndex
CREATE INDEX "DeviceCredential_organizationId_deviceId_idx" ON "DeviceCredential"("organizationId", "deviceId");

-- CreateIndex
CREATE INDEX "DeviceHardware_organizationId_deviceId_isCurrent_idx" ON "DeviceHardware"("organizationId", "deviceId", "isCurrent");

-- CreateIndex
CREATE INDEX "DeviceHeartbeat_organizationId_deviceId_at_idx" ON "DeviceHeartbeat"("organizationId", "deviceId", "at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCommand_nonce_key" ON "DeviceCommand"("nonce");

-- CreateIndex
CREATE INDEX "DeviceCommand_organizationId_deviceId_status_idx" ON "DeviceCommand"("organizationId", "deviceId", "status");

-- CreateIndex
CREATE INDEX "DeviceCommand_organizationId_batchId_idx" ON "DeviceCommand"("organizationId", "batchId");

-- CreateIndex
CREATE INDEX "MaintenanceSession_organizationId_deviceId_startedAt_idx" ON "MaintenanceSession"("organizationId", "deviceId", "startedAt");

-- CreateIndex
CREATE INDEX "RemoteSupportSession_organizationId_deviceId_idx" ON "RemoteSupportSession"("organizationId", "deviceId");

-- CreateIndex
CREATE INDEX "DisklessIntegration_organizationId_branchId_idx" ON "DisklessIntegration"("organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "DisklessIntegration_id_organizationId_key" ON "DisklessIntegration"("id", "organizationId");

-- CreateIndex
CREATE INDEX "DeviceBootInfo_organizationId_idx" ON "DeviceBootInfo"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceBootInfo_deviceId_key" ON "DeviceBootInfo"("deviceId");

-- CreateIndex
CREATE INDEX "Alert_organizationId_status_severity_idx" ON "Alert"("organizationId", "status", "severity");

-- CreateIndex
CREATE INDEX "Alert_organizationId_dedupeKey_status_idx" ON "Alert"("organizationId", "dedupeKey", "status");

-- CreateIndex
CREATE INDEX "PeripheralProfile_organizationId_category_idx" ON "PeripheralProfile"("organizationId", "category");

-- CreateIndex
CREATE INDEX "Tournament_organizationId_status_startsAt_idx" ON "Tournament"("organizationId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_id_organizationId_key" ON "Tournament"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_organizationId_slug_key" ON "Tournament"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Team_id_organizationId_key" ON "Team"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_tournamentId_name_key" ON "Team"("tournamentId", "name");

-- CreateIndex
CREATE INDEX "TournamentPlayer_organizationId_teamId_idx" ON "TournamentPlayer"("organizationId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentPlayer_tournamentId_customerId_key" ON "TournamentPlayer"("tournamentId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_id_organizationId_key" ON "Match"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_tournamentId_bracket_round_position_key" ON "Match"("tournamentId", "bracket", "round", "position");

-- CreateIndex
CREATE INDEX "Payment_organizationId_branchId_createdAt_idx" ON "Payment"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_provider_providerRef_idx" ON "Payment"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_id_organizationId_key" ON "Payment"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_organizationId_idempotencyKey_key" ON "Payment"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Refund_organizationId_paymentId_idx" ON "Refund"("organizationId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_organizationId_idempotencyKey_key" ON "Refund"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashDrawer_id_organizationId_key" ON "CashDrawer"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Shift_organizationId_branchId_status_idx" ON "Shift"("organizationId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_id_organizationId_key" ON "Shift"("id", "organizationId");

-- CreateIndex
CREATE INDEX "CashMovement_organizationId_shiftId_idx" ON "CashMovement"("organizationId", "shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_branchId_number_key" ON "Invoice"("organizationId", "branchId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_id_organizationId_key" ON "LedgerAccount"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_organizationId_code_key" ON "LedgerAccount"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_organizationId_systemKey_key" ON "LedgerAccount"("organizationId", "systemKey");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_entryDate_idx" ON "JournalEntry"("organizationId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_id_organizationId_key" ON "JournalEntry"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_organizationId_sourceType_sourceId_key" ON "JournalEntry"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalLine_organizationId_accountId_idx" ON "JournalLine"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "JournalLine_organizationId_entryId_idx" ON "JournalLine"("organizationId", "entryId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_branchId_incurredAt_idx" ON "Expense"("organizationId", "branchId", "incurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Launcher_organizationId_key_key" ON "Launcher"("organizationId", "key");

-- CreateIndex
CREATE INDEX "Game_title_idx" ON "Game"("title");

-- CreateIndex
CREATE UNIQUE INDEX "Game_organizationId_slug_key" ON "Game"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "OrgGameSetting_organizationId_gameId_key" ON "OrgGameSetting"("organizationId", "gameId");

-- CreateIndex
CREATE INDEX "GameInstallation_organizationId_gameId_status_idx" ON "GameInstallation"("organizationId", "gameId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GameInstallation_deviceId_gameId_key" ON "GameInstallation"("deviceId", "gameId");

-- CreateIndex
CREATE INDEX "GameUpdateJob_organizationId_branchId_status_idx" ON "GameUpdateJob"("organizationId", "branchId", "status");

-- CreateIndex
CREATE INDEX "GameLicense_organizationId_launcherId_status_idx" ON "GameLicense"("organizationId", "launcherId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GameLicense_organizationId_launcherId_accountUsername_key" ON "GameLicense"("organizationId", "launcherId", "accountUsername");

-- CreateIndex
CREATE INDEX "ShellApp_organizationId_idx" ON "ShellApp"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_id_organizationId_key" ON "Employee"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_userId_key" ON "Employee"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_employeeCode_key" ON "Employee"("organizationId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_rfidTagHash_key" ON "Employee"("organizationId", "rfidTagHash");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_key_key" ON "Role"("organizationId", "key");

-- CreateIndex
CREATE INDEX "EmployeeRoleAssignment_organizationId_employeeId_idx" ON "EmployeeRoleAssignment"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeRoleAssignment_employeeId_roleId_scope_brandId_bran_key" ON "EmployeeRoleAssignment"("employeeId", "roleId", "scope", "brandId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_id_organizationId_key" ON "Warehouse"("id", "organizationId");

-- CreateIndex
CREATE INDEX "InventoryItem_organizationId_barcode_idx" ON "InventoryItem"("organizationId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_id_organizationId_key" ON "InventoryItem"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_organizationId_sku_key" ON "InventoryItem"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "StockLevel_organizationId_warehouseId_idx" ON "StockLevel"("organizationId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_itemId_warehouseId_key" ON "StockLevel"("itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockLot_organizationId_itemId_expiresAt_idx" ON "StockLot"("organizationId", "itemId", "expiresAt");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_itemId_createdAt_idx" ON "StockMovement"("organizationId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_warehouseId_createdAt_idx" ON "StockMovement"("organizationId", "warehouseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_organizationId_idempotencyKey_key" ON "StockMovement"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_organizationId_key" ON "Supplier"("id", "organizationId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_organizationId_supplierId_status_idx" ON "PurchaseOrder"("organizationId", "supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_id_organizationId_key" ON "PurchaseOrder"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_number_key" ON "PurchaseOrder"("organizationId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_organizationId_purchaseOrderId_idx" ON "PurchaseOrderLine"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_organizationId_status_dueDate_idx" ON "SupplierInvoice"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_organizationId_supplierId_invoiceNumber_key" ON "SupplierInvoice"("organizationId", "supplierId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "Promotion_organizationId_status_startsAt_idx" ON "Promotion"("organizationId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_id_organizationId_key" ON "Promotion"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_id_organizationId_key" ON "PromoCode"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_organizationId_code_key" ON "PromoCode"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PromotionRedemption_organizationId_promotionId_idx" ON "PromotionRedemption"("organizationId", "promotionId");

-- CreateIndex
CREATE INDEX "PromotionRedemption_organizationId_customerId_idx" ON "PromotionRedemption"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSegment_id_organizationId_key" ON "CustomerSegment"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSegment_organizationId_key_key" ON "CustomerSegment"("organizationId", "key");

-- CreateIndex
CREATE INDEX "CustomerSegmentMember_organizationId_customerId_idx" ON "CustomerSegmentMember"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_status_idx" ON "Campaign"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PlanFeature_planId_featureKey_key" ON "PlanFeature"("planId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRelease_component_channel_version_key" ON "ClientRelease"("component", "channel", "version");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "MfaFactor_userId_idx" ON "MfaFactor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformRoleAssignment_userId_role_key" ON "PlatformRoleAssignment"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_customerId_idx" ON "RefreshToken"("customerId");

-- CreateIndex
CREATE INDEX "ImpersonationSession_organizationId_idx" ON "ImpersonationSession"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_id_organizationId_key" ON "ProductCategory"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Product_organizationId_categoryId_idx" ON "Product"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "Product_organizationId_barcode_idx" ON "Product"("organizationId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_organizationId_key" ON "Product"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_sku_key" ON "Product"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "ProductBranchPrice_organizationId_idx" ON "ProductBranchPrice"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBranchPrice_productId_branchId_key" ON "ProductBranchPrice"("productId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierGroup_id_organizationId_key" ON "ModifierGroup"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Modifier_organizationId_groupId_idx" ON "Modifier"("organizationId", "groupId");

-- CreateIndex
CREATE INDEX "ProductModifierGroup_organizationId_idx" ON "ProductModifierGroup"("organizationId");

-- CreateIndex
CREATE INDEX "ComboItem_organizationId_comboId_idx" ON "ComboItem"("organizationId", "comboId");

-- CreateIndex
CREATE INDEX "RecipeLine_organizationId_idx" ON "RecipeLine"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeLine_productId_inventoryItemId_key" ON "RecipeLine"("productId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "Bill_organizationId_branchId_status_idx" ON "Bill"("organizationId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_id_organizationId_key" ON "Bill"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_organizationId_number_key" ON "Bill"("organizationId", "number");

-- CreateIndex
CREATE INDEX "Order_organizationId_branchId_status_createdAt_idx" ON "Order"("organizationId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_organizationId_gamingSessionId_idx" ON "Order"("organizationId", "gamingSessionId");

-- CreateIndex
CREATE INDEX "Order_organizationId_billId_idx" ON "Order"("organizationId", "billId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_organizationId_key" ON "Order"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_organizationId_idempotencyKey_key" ON "Order"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderItem_organizationId_orderId_idx" ON "OrderItem"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "OrderItem_organizationId_productId_createdAt_idx" ON "OrderItem"("organizationId", "productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_id_organizationId_key" ON "OrderItem"("id", "organizationId");

-- CreateIndex
CREATE INDEX "KitchenStation_organizationId_branchId_idx" ON "KitchenStation"("organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenStation_id_organizationId_key" ON "KitchenStation"("id", "organizationId");

-- CreateIndex
CREATE INDEX "KitchenTicket_organizationId_stationId_status_idx" ON "KitchenTicket"("organizationId", "stationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenTicket_id_organizationId_key" ON "KitchenTicket"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantTable_qrToken_key" ON "RestaurantTable"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantTable_id_organizationId_key" ON "RestaurantTable"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantTable_branchId_name_key" ON "RestaurantTable"("branchId", "name");

-- CreateIndex
CREATE INDEX "PricingPlan_organizationId_branchId_zoneId_isActive_idx" ON "PricingPlan"("organizationId", "branchId", "zoneId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PricingPlan_id_organizationId_key" ON "PricingPlan"("id", "organizationId");

-- CreateIndex
CREATE INDEX "PricingPackage_organizationId_pricingPlanId_idx" ON "PricingPackage"("organizationId", "pricingPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingPackage_id_organizationId_key" ON "PricingPackage"("id", "organizationId");

-- CreateIndex
CREATE INDEX "GamingSession_organizationId_branchId_status_idx" ON "GamingSession"("organizationId", "branchId", "status");

-- CreateIndex
CREATE INDEX "GamingSession_organizationId_customerId_idx" ON "GamingSession"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "GamingSession_status_expiresAt_idx" ON "GamingSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GamingSession_id_organizationId_key" ON "GamingSession"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GamingSession_organizationId_idempotencyKey_key" ON "GamingSession"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SessionExtension_organizationId_sessionId_idx" ON "SessionExtension"("organizationId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionExtension_organizationId_idempotencyKey_key" ON "SessionExtension"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SessionTransfer_organizationId_sessionId_idx" ON "SessionTransfer"("organizationId", "sessionId");

-- CreateIndex
CREATE INDEX "PrintJob_organizationId_branchId_createdAt_idx" ON "PrintJob"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_organizationId_event_channel_locale_key" ON "NotificationTemplate"("organizationId", "event", "channel", "locale");

-- CreateIndex
CREATE INDEX "Notification_organizationId_customerId_createdAt_idx" ON "Notification"("organizationId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_scheduledFor_idx" ON "Notification"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_organizationId_dedupeKey_key" ON "Notification"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "PushSubscription_organizationId_idx" ON "PushSubscription"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_platform_token_key" ON "PushSubscription"("platform", "token");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_entityType_entityId_idx" ON "AuditLog"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_actorId_createdAt_idx" ON "AuditLog"("organizationId", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_chainSeq_idx" ON "AuditLog"("organizationId", "chainSeq");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_scope_key_key" ON "IdempotencyRecord"("organizationId", "scope", "key");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_organizationId_branchId_createdAt_idx" ON "OutboxEvent"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EdgeNode_certThumbprint_key" ON "EdgeNode"("certThumbprint");

-- CreateIndex
CREATE INDEX "EdgeNode_organizationId_branchId_idx" ON "EdgeNode"("organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "EdgeNode_id_organizationId_key" ON "EdgeNode"("id", "organizationId");

-- CreateIndex
CREATE INDEX "SyncBatch_organizationId_receivedAt_idx" ON "SyncBatch"("organizationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncBatch_edgeNodeId_batchKey_key" ON "SyncBatch"("edgeNodeId", "batchKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_organizationId_idx" ON "WebhookEndpoint"("organizationId");

-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_branchId_status_idx" ON "SupportTicket"("organizationId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Subscription_organizationId_idx" ON "Subscription"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_id_organizationId_key" ON "Subscription"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_number_key" ON "SubscriptionInvoice"("number");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_organizationId_idx" ON "SubscriptionInvoice"("organizationId");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_status_idx" ON "SubscriptionInvoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationFeature_organizationId_featureKey_key" ON "OrganizationFeature"("organizationId", "featureKey");

-- CreateIndex
CREATE INDEX "Brand_organizationId_idx" ON "Brand"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_id_organizationId_key" ON "Brand"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Branch_organizationId_brandId_idx" ON "Branch"("organizationId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_id_organizationId_key" ON "Branch"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_organizationId_code_key" ON "Branch"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Zone_organizationId_branchId_idx" ON "Zone"("organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_id_organizationId_key" ON "Zone"("id", "organizationId");

-- CreateIndex
CREATE INDEX "TaxProfile_organizationId_idx" ON "TaxProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxProfile_id_organizationId_key" ON "TaxProfile"("id", "organizationId");

-- CreateIndex
CREATE INDEX "TaxRate_organizationId_taxProfileId_idx" ON "TaxRate"("organizationId", "taxProfileId");

-- CreateIndex
CREATE INDEX "PaymentGatewayConfig_organizationId_idx" ON "PaymentGatewayConfig"("organizationId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_zoneId_organizationId_fkey" FOREIGN KEY ("zoneId", "organizationId") REFERENCES "Zone"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingResource" ADD CONSTRAINT "BookingResource_bookingId_organizationId_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "Booking"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingResource" ADD CONSTRAINT "BookingResource_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingResource" ADD CONSTRAINT "BookingResource_tableId_organizationId_fkey" FOREIGN KEY ("tableId", "organizationId") REFERENCES "RestaurantTable"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_membershipTierId_organizationId_fkey" FOREIGN KEY ("membershipTierId", "organizationId") REFERENCES "MembershipTier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_homeBranchId_organizationId_fkey" FOREIGN KEY ("homeBranchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_referredById_organizationId_fkey" FOREIGN KEY ("referredById", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRestriction" ADD CONSTRAINT "CustomerRestriction_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRestriction" ADD CONSTRAINT "CustomerRestriction_createdById_organizationId_fkey" FOREIGN KEY ("createdById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_gamingSessionId_organizationId_fkey" FOREIGN KEY ("gamingSessionId", "organizationId") REFERENCES "GamingSession"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFavoriteGame" ADD CONSTRAINT "CustomerFavoriteGame_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFavoriteGame" ADD CONSTRAINT "CustomerFavoriteGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAchievement" ADD CONSTRAINT "CustomerAchievement_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAchievement" ADD CONSTRAINT "CustomerAchievement_achievementId_organizationId_fkey" FOREIGN KEY ("achievementId", "organizationId") REFERENCES "Achievement"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTier" ADD CONSTRAINT "MembershipTier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tierId_organizationId_fkey" FOREIGN KEY ("tierId", "organizationId") REFERENCES "MembershipTier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_organizationId_fkey" FOREIGN KEY ("walletId", "organizationId") REFERENCES "Wallet"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_paymentId_organizationId_fkey" FOREIGN KEY ("paymentId", "organizationId") REFERENCES "Payment"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_reversesId_organizationId_fkey" FOREIGN KEY ("reversesId", "organizationId") REFERENCES "WalletTransaction"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRule" ADD CONSTRAINT "LoyaltyRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_rewardId_organizationId_fkey" FOREIGN KEY ("rewardId", "organizationId") REFERENCES "LoyaltyReward"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_zoneId_organizationId_fkey" FOREIGN KEY ("zoneId", "organizationId") REFERENCES "Zone"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_linkedDisplayId_organizationId_fkey" FOREIGN KEY ("linkedDisplayId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAccessory" ADD CONSTRAINT "DeviceAccessory_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEnrollmentToken" ADD CONSTRAINT "DeviceEnrollmentToken_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEnrollmentToken" ADD CONSTRAINT "DeviceEnrollmentToken_createdById_organizationId_fkey" FOREIGN KEY ("createdById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCredential" ADD CONSTRAINT "DeviceCredential_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceHardware" ADD CONSTRAINT "DeviceHardware_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceHeartbeat" ADD CONSTRAINT "DeviceHeartbeat_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_requestedById_organizationId_fkey" FOREIGN KEY ("requestedById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSession" ADD CONSTRAINT "MaintenanceSession_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSession" ADD CONSTRAINT "MaintenanceSession_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteSupportSession" ADD CONSTRAINT "RemoteSupportSession_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteSupportSession" ADD CONSTRAINT "RemoteSupportSession_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisklessIntegration" ADD CONSTRAINT "DisklessIntegration_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceBootInfo" ADD CONSTRAINT "DeviceBootInfo_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceBootInfo" ADD CONSTRAINT "DeviceBootInfo_integrationId_organizationId_fkey" FOREIGN KEY ("integrationId", "organizationId") REFERENCES "DisklessIntegration"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeripheralProfile" ADD CONSTRAINT "PeripheralProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_createdById_organizationId_fkey" FOREIGN KEY ("createdById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_tournamentId_organizationId_fkey" FOREIGN KEY ("tournamentId", "organizationId") REFERENCES "Tournament"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_captainId_organizationId_fkey" FOREIGN KEY ("captainId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_paymentId_organizationId_fkey" FOREIGN KEY ("paymentId", "organizationId") REFERENCES "Payment"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPlayer" ADD CONSTRAINT "TournamentPlayer_tournamentId_organizationId_fkey" FOREIGN KEY ("tournamentId", "organizationId") REFERENCES "Tournament"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPlayer" ADD CONSTRAINT "TournamentPlayer_teamId_organizationId_fkey" FOREIGN KEY ("teamId", "organizationId") REFERENCES "Team"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPlayer" ADD CONSTRAINT "TournamentPlayer_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_tournamentId_organizationId_fkey" FOREIGN KEY ("tournamentId", "organizationId") REFERENCES "Tournament"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamAId_organizationId_fkey" FOREIGN KEY ("teamAId", "organizationId") REFERENCES "Team"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamBId_organizationId_fkey" FOREIGN KEY ("teamBId", "organizationId") REFERENCES "Team"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_winnerTeamId_organizationId_fkey" FOREIGN KEY ("winnerTeamId", "organizationId") REFERENCES "Team"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_nextMatchId_organizationId_fkey" FOREIGN KEY ("nextMatchId", "organizationId") REFERENCES "Match"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_loserNextMatchId_organizationId_fkey" FOREIGN KEY ("loserNextMatchId", "organizationId") REFERENCES "Match"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billId_organizationId_fkey" FOREIGN KEY ("billId", "organizationId") REFERENCES "Bill"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_organizationId_fkey" FOREIGN KEY ("orderId", "organizationId") REFERENCES "Order"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_organizationId_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "Booking"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shiftId_organizationId_fkey" FOREIGN KEY ("shiftId", "organizationId") REFERENCES "Shift"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_organizationId_fkey" FOREIGN KEY ("paymentId", "organizationId") REFERENCES "Payment"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedById_organizationId_fkey" FOREIGN KEY ("requestedById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedById_organizationId_fkey" FOREIGN KEY ("approvedById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_shiftId_organizationId_fkey" FOREIGN KEY ("shiftId", "organizationId") REFERENCES "Shift"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawer" ADD CONSTRAINT "CashDrawer_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawer" ADD CONSTRAINT "CashDrawer_posDeviceId_organizationId_fkey" FOREIGN KEY ("posDeviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_cashDrawerId_organizationId_fkey" FOREIGN KEY ("cashDrawerId", "organizationId") REFERENCES "CashDrawer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_approvedById_organizationId_fkey" FOREIGN KEY ("approvedById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_organizationId_fkey" FOREIGN KEY ("shiftId", "organizationId") REFERENCES "Shift"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billId_organizationId_fkey" FOREIGN KEY ("billId", "organizationId") REFERENCES "Bill"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_parentId_organizationId_fkey" FOREIGN KEY ("parentId", "organizationId") REFERENCES "LedgerAccount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_organizationId_fkey" FOREIGN KEY ("entryId", "organizationId") REFERENCES "JournalEntry"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_organizationId_fkey" FOREIGN KEY ("accountId", "organizationId") REFERENCES "LedgerAccount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_shiftId_organizationId_fkey" FOREIGN KEY ("shiftId", "organizationId") REFERENCES "Shift"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_supplierId_organizationId_fkey" FOREIGN KEY ("supplierId", "organizationId") REFERENCES "Supplier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_organizationId_fkey" FOREIGN KEY ("createdById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_approvedById_organizationId_fkey" FOREIGN KEY ("approvedById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Launcher" ADD CONSTRAINT "Launcher_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_launcherId_fkey" FOREIGN KEY ("launcherId") REFERENCES "Launcher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgGameSetting" ADD CONSTRAINT "OrgGameSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgGameSetting" ADD CONSTRAINT "OrgGameSetting_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameInstallation" ADD CONSTRAINT "GameInstallation_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameInstallation" ADD CONSTRAINT "GameInstallation_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameUpdateJob" ADD CONSTRAINT "GameUpdateJob_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameUpdateJob" ADD CONSTRAINT "GameUpdateJob_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLicense" ADD CONSTRAINT "GameLicense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLicense" ADD CONSTRAINT "GameLicense_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLicense" ADD CONSTRAINT "GameLicense_launcherId_fkey" FOREIGN KEY ("launcherId") REFERENCES "Launcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLicense" ADD CONSTRAINT "GameLicense_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLicense" ADD CONSTRAINT "GameLicense_assignedSessionId_organizationId_fkey" FOREIGN KEY ("assignedSessionId", "organizationId") REFERENCES "GamingSession"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShellApp" ADD CONSTRAINT "ShellApp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_homeBranchId_organizationId_fkey" FOREIGN KEY ("homeBranchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRoleAssignment" ADD CONSTRAINT "EmployeeRoleAssignment_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRoleAssignment" ADD CONSTRAINT "EmployeeRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRoleAssignment" ADD CONSTRAINT "EmployeeRoleAssignment_brandId_organizationId_fkey" FOREIGN KEY ("brandId", "organizationId") REFERENCES "Brand"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRoleAssignment" ADD CONSTRAINT "EmployeeRoleAssignment_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_defaultSupplierId_organizationId_fkey" FOREIGN KEY ("defaultSupplierId", "organizationId") REFERENCES "Supplier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_itemId_organizationId_fkey" FOREIGN KEY ("itemId", "organizationId") REFERENCES "InventoryItem"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_warehouseId_organizationId_fkey" FOREIGN KEY ("warehouseId", "organizationId") REFERENCES "Warehouse"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_itemId_organizationId_fkey" FOREIGN KEY ("itemId", "organizationId") REFERENCES "InventoryItem"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_warehouseId_organizationId_fkey" FOREIGN KEY ("warehouseId", "organizationId") REFERENCES "Warehouse"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_organizationId_fkey" FOREIGN KEY ("itemId", "organizationId") REFERENCES "InventoryItem"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_organizationId_fkey" FOREIGN KEY ("warehouseId", "organizationId") REFERENCES "Warehouse"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_warehouseId_organizationId_fkey" FOREIGN KEY ("warehouseId", "organizationId") REFERENCES "Warehouse"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_organizationId_fkey" FOREIGN KEY ("supplierId", "organizationId") REFERENCES "Supplier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_organizationId_fkey" FOREIGN KEY ("createdById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approvedById_organizationId_fkey" FOREIGN KEY ("approvedById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_organizationId_fkey" FOREIGN KEY ("purchaseOrderId", "organizationId") REFERENCES "PurchaseOrder"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_organizationId_fkey" FOREIGN KEY ("itemId", "organizationId") REFERENCES "InventoryItem"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_organizationId_fkey" FOREIGN KEY ("supplierId", "organizationId") REFERENCES "Supplier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_purchaseOrderId_organizationId_fkey" FOREIGN KEY ("purchaseOrderId", "organizationId") REFERENCES "PurchaseOrder"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_promotionId_organizationId_fkey" FOREIGN KEY ("promotionId", "organizationId") REFERENCES "Promotion"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_promotionId_organizationId_fkey" FOREIGN KEY ("promotionId", "organizationId") REFERENCES "Promotion"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_promoCodeId_organizationId_fkey" FOREIGN KEY ("promoCodeId", "organizationId") REFERENCES "PromoCode"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_orderId_organizationId_fkey" FOREIGN KEY ("orderId", "organizationId") REFERENCES "Order"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_gamingSessionId_organizationId_fkey" FOREIGN KEY ("gamingSessionId", "organizationId") REFERENCES "GamingSession"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSegment" ADD CONSTRAINT "CustomerSegment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSegmentMember" ADD CONSTRAINT "CustomerSegmentMember_segmentId_organizationId_fkey" FOREIGN KEY ("segmentId", "organizationId") REFERENCES "CustomerSegment"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSegmentMember" ADD CONSTRAINT "CustomerSegmentMember_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_organizationId_fkey" FOREIGN KEY ("segmentId", "organizationId") REFERENCES "CustomerSegment"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_promotionId_organizationId_fkey" FOREIGN KEY ("promotionId", "organizationId") REFERENCES "Promotion"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaFactor" ADD CONSTRAINT "MfaFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformRoleAssignment" ADD CONSTRAINT "PlatformRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_targetEmployeeId_organizationId_fkey" FOREIGN KEY ("targetEmployeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_parentId_organizationId_fkey" FOREIGN KEY ("parentId", "organizationId") REFERENCES "ProductCategory"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_organizationId_fkey" FOREIGN KEY ("categoryId", "organizationId") REFERENCES "ProductCategory"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_inventoryItemId_organizationId_fkey" FOREIGN KEY ("inventoryItemId", "organizationId") REFERENCES "InventoryItem"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_kitchenStationId_organizationId_fkey" FOREIGN KEY ("kitchenStationId", "organizationId") REFERENCES "KitchenStation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_pricingPackageId_organizationId_fkey" FOREIGN KEY ("pricingPackageId", "organizationId") REFERENCES "PricingPackage"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_membershipTierId_organizationId_fkey" FOREIGN KEY ("membershipTierId", "organizationId") REFERENCES "MembershipTier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBranchPrice" ADD CONSTRAINT "ProductBranchPrice_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBranchPrice" ADD CONSTRAINT "ProductBranchPrice_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_groupId_organizationId_fkey" FOREIGN KEY ("groupId", "organizationId") REFERENCES "ModifierGroup"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_inventoryItemId_organizationId_fkey" FOREIGN KEY ("inventoryItemId", "organizationId") REFERENCES "InventoryItem"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_modifierGroupId_organizationId_fkey" FOREIGN KEY ("modifierGroupId", "organizationId") REFERENCES "ModifierGroup"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_comboId_organizationId_fkey" FOREIGN KEY ("comboId", "organizationId") REFERENCES "Product"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_inventoryItemId_organizationId_fkey" FOREIGN KEY ("inventoryItemId", "organizationId") REFERENCES "InventoryItem"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_tableId_organizationId_fkey" FOREIGN KEY ("tableId", "organizationId") REFERENCES "RestaurantTable"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_billId_organizationId_fkey" FOREIGN KEY ("billId", "organizationId") REFERENCES "Bill"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_gamingSessionId_organizationId_fkey" FOREIGN KEY ("gamingSessionId", "organizationId") REFERENCES "GamingSession"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_organizationId_fkey" FOREIGN KEY ("tableId", "organizationId") REFERENCES "RestaurantTable"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cancelledById_organizationId_fkey" FOREIGN KEY ("cancelledById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shiftId_organizationId_fkey" FOREIGN KEY ("shiftId", "organizationId") REFERENCES "Shift"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_organizationId_fkey" FOREIGN KEY ("orderId", "organizationId") REFERENCES "Order"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_kitchenTicketId_organizationId_fkey" FOREIGN KEY ("kitchenTicketId", "organizationId") REFERENCES "KitchenTicket"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_gamingSessionId_organizationId_fkey" FOREIGN KEY ("gamingSessionId", "organizationId") REFERENCES "GamingSession"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_bookingId_organizationId_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "Booking"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenStation" ADD CONSTRAINT "KitchenStation_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenStation" ADD CONSTRAINT "KitchenStation_displayDeviceId_organizationId_fkey" FOREIGN KEY ("displayDeviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_orderId_organizationId_fkey" FOREIGN KEY ("orderId", "organizationId") REFERENCES "Order"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_stationId_organizationId_fkey" FOREIGN KEY ("stationId", "organizationId") REFERENCES "KitchenStation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "RestaurantTable_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "RestaurantTable_zoneId_organizationId_fkey" FOREIGN KEY ("zoneId", "organizationId") REFERENCES "Zone"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "RestaurantTable_mergedIntoId_organizationId_fkey" FOREIGN KEY ("mergedIntoId", "organizationId") REFERENCES "RestaurantTable"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingPlan" ADD CONSTRAINT "PricingPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingPlan" ADD CONSTRAINT "PricingPlan_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingPlan" ADD CONSTRAINT "PricingPlan_zoneId_organizationId_fkey" FOREIGN KEY ("zoneId", "organizationId") REFERENCES "Zone"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingPlan" ADD CONSTRAINT "PricingPlan_membershipTierId_organizationId_fkey" FOREIGN KEY ("membershipTierId", "organizationId") REFERENCES "MembershipTier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingPackage" ADD CONSTRAINT "PricingPackage_pricingPlanId_organizationId_fkey" FOREIGN KEY ("pricingPlanId", "organizationId") REFERENCES "PricingPlan"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamingSession" ADD CONSTRAINT "GamingSession_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamingSession" ADD CONSTRAINT "GamingSession_zoneId_organizationId_fkey" FOREIGN KEY ("zoneId", "organizationId") REFERENCES "Zone"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamingSession" ADD CONSTRAINT "GamingSession_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamingSession" ADD CONSTRAINT "GamingSession_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamingSession" ADD CONSTRAINT "GamingSession_bookingId_organizationId_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "Booking"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamingSession" ADD CONSTRAINT "GamingSession_billId_organizationId_fkey" FOREIGN KEY ("billId", "organizationId") REFERENCES "Bill"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamingSession" ADD CONSTRAINT "GamingSession_pricingPlanId_organizationId_fkey" FOREIGN KEY ("pricingPlanId", "organizationId") REFERENCES "PricingPlan"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamingSession" ADD CONSTRAINT "GamingSession_pricingPackageId_organizationId_fkey" FOREIGN KEY ("pricingPackageId", "organizationId") REFERENCES "PricingPackage"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamingSession" ADD CONSTRAINT "GamingSession_startedById_organizationId_fkey" FOREIGN KEY ("startedById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamingSession" ADD CONSTRAINT "GamingSession_endedById_organizationId_fkey" FOREIGN KEY ("endedById", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExtension" ADD CONSTRAINT "SessionExtension_sessionId_organizationId_fkey" FOREIGN KEY ("sessionId", "organizationId") REFERENCES "GamingSession"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExtension" ADD CONSTRAINT "SessionExtension_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTransfer" ADD CONSTRAINT "SessionTransfer_sessionId_organizationId_fkey" FOREIGN KEY ("sessionId", "organizationId") REFERENCES "GamingSession"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTransfer" ADD CONSTRAINT "SessionTransfer_fromDeviceId_organizationId_fkey" FOREIGN KEY ("fromDeviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTransfer" ADD CONSTRAINT "SessionTransfer_toDeviceId_organizationId_fkey" FOREIGN KEY ("toDeviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTransfer" ADD CONSTRAINT "SessionTransfer_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_organizationId_fkey" FOREIGN KEY ("printerId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_sessionId_organizationId_fkey" FOREIGN KEY ("sessionId", "organizationId") REFERENCES "GamingSession"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeNode" ADD CONSTRAINT "EdgeNode_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncBatch" ADD CONSTRAINT "SyncBatch_edgeNodeId_organizationId_fkey" FOREIGN KEY ("edgeNodeId", "organizationId") REFERENCES "EdgeNode"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assigneeId_organizationId_fkey" FOREIGN KEY ("assigneeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_subscriptionId_organizationId_fkey" FOREIGN KEY ("subscriptionId", "organizationId") REFERENCES "Subscription"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationFeature" ADD CONSTRAINT "OrganizationFeature_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_brandId_organizationId_fkey" FOREIGN KEY ("brandId", "organizationId") REFERENCES "Brand"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_taxProfileId_organizationId_fkey" FOREIGN KEY ("taxProfileId", "organizationId") REFERENCES "TaxProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_taxProfileId_organizationId_fkey" FOREIGN KEY ("taxProfileId", "organizationId") REFERENCES "TaxProfile"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentGatewayConfig" ADD CONSTRAINT "PaymentGatewayConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentGatewayConfig" ADD CONSTRAINT "PaymentGatewayConfig_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
