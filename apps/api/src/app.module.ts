import { Controller, Get, Inject, Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import type { Db } from "@arena/db";
import { CONFIG, type AppConfig } from "./config.js";
import { AuthController, PermissionsController } from "./auth/auth.controller.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthService } from "./auth/auth.service.js";
import { PrincipalService } from "./auth/principal.service.js";
import { TokensService } from "./auth/tokens.service.js";
import { AuditService } from "./common/audit.service.js";
import { DB, DbModule } from "./common/db.module.js";
import { Public } from "./common/decorators.js";
import { ErrorsFilter } from "./common/errors.filter.js";
import { TargetResolver } from "./common/target.resolver.js";
import { RequestAuthorizer } from "./common/request-authorizer.js";
import { TenantInterceptor } from "./common/tenant.interceptor.js";
import { BranchesController } from "./branches/branches.controller.js";
import { EmployeesController } from "./employees/employees.controller.js";
import { OrganizationsController } from "./organizations/organizations.controller.js";
import { RolesController } from "./roles/roles.controller.js";
import { ZonesController } from "./zones/zones.controller.js";
import { RecordsController } from "./common/records.controller.js";
import { CommandsService } from "./devices/commands.service.js";
import { DeviceGateway } from "./devices/device-gateway.js";
import { DeviceRuntimeService } from "./devices/device-runtime.service.js";
import { DevicesController } from "./devices/devices.controller.js";
import { DeviceEnrollController, EnrollmentService } from "./devices/enrollment.js";
import { DeviceHub, LiveBus } from "./devices/live.js";
import { SigningKeysService } from "./devices/signing-keys.service.js";
import { CustomersController } from "./customers/customers.controller.js";
import { CustomerRecordsController } from "./customers/customer-records.controller.js";
import { PricingController } from "./sessions/pricing.controller.js";
import { SessionTimerService } from "./sessions/session-timer.service.js";
import { SessionsController } from "./sessions/sessions.controller.js";
import { SessionsService } from "./sessions/sessions.service.js";
import { ShellAuthService } from "./sessions/shell-auth.service.js";
import { GameUpdatesService } from "./games/game-updates.service.js";
import { GamesController } from "./games/games.controller.js";
import { InventoryService } from "./games/inventory.service.js";
import { SteamBuildsService } from "./games/steam-builds.service.js";
import { StationConfigService } from "./games/station-config.service.js";
import { StationReportsService } from "./stations/station-reports.service.js";
import { BookingsController } from "./bookings/bookings.controller.js";
import { BookingsService } from "./bookings/bookings.service.js";
import { CommerceService } from "./customers/commerce.service.js";
import { MembershipExpiryService } from "./customers/membership-expiry.service.js";
import { TiersController } from "./customers/tiers.controller.js";
import { CustomerAppController } from "./customer-app/customer-app.controller.js";
import { CustomerAuth } from "./customer-app/customer-auth.js";
import { SelfServiceController } from "./customer-app/self-service.controller.js";
import { InventoryController } from "./inventory/inventory.controller.js";
import { StockService } from "./inventory/stock.service.js";
import { PurchasingController } from "./inventory/purchasing.controller.js";
import { PurchasingService } from "./inventory/purchasing.service.js";
import { KitchenService } from "./pos/kitchen.service.js";
import { CrmController } from "./crm/crm.controller.js";
import { CrmService } from "./crm/crm.service.js";
import { PushService } from "./push/push.service.js";
import { PlayerService } from "./sessions/player.service.js";
import { LoyaltyController } from "./loyalty/loyalty.controller.js";
import { LoyaltyService } from "./loyalty/loyalty.service.js";
import { PromotionsController } from "./promotions/promotions.controller.js";
import { PromotionsService } from "./promotions/promotions.service.js";
import { TournamentsController } from "./tournaments/tournaments.controller.js";
import { TournamentsService } from "./tournaments/tournaments.service.js";
import { DisplayController } from "./devices/display.controller.js";
import { StationControlService } from "./devices/station-control.service.js";
import { StationsController } from "./devices/stations.controller.js";
import { PrintController } from "./printing/print.controller.js";
import { PrintService } from "./printing/print.service.js";
import { OrdersService } from "./pos/orders.service.js";
import { PosController } from "./pos/pos.controller.js";
import { SeatOrderingService } from "./pos/seat-ordering.service.js";
import { ShellTimeService } from "./sessions/shell-time.service.js";
import { ScreenshotsService } from "./stations/screenshots.service.js";
import { ShiftsService } from "./pos/shifts.service.js";
import { AccountingController } from "./accounting/accounting.controller.js";
import { AccountingPosterService } from "./accounting/poster.service.js";
import { ReportsController } from "./reports/reports.controller.js";
import { AnalyticsController } from "./reports/analytics.controller.js";
import { StaffController } from "./staff/staff.controller.js";

@Controller()
class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Friendly landing for people who open the API in a browser. */
  @Public()
  @Get()
  root() {
    return {
      name: "ArenaOS API",
      status: "running",
      note: "This is the backend API (JSON only). The admin web app is a separate site.",
      health: "/health",
      apiBase: "/v1",
      login: "POST /v1/auth/login  { email, password }",
    };
  }

  @Public()
  @Get("health")
  async health() {
    await this.db.global.$queryRaw`SELECT 1`;
    return { status: "ok", time: new Date().toISOString() };
  }
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [{ module: class ConfigModule {}, global: true, providers: [{ provide: CONFIG, useValue: config }], exports: [CONFIG] }, DbModule],
      controllers: [
        HealthController,
        AuthController,
        PermissionsController,
        OrganizationsController,
        BranchesController,
        ZonesController,
        RecordsController,
        EmployeesController,
        RolesController,
        DevicesController,
        DeviceEnrollController,
        SessionsController,
        PricingController,
        CustomersController,
    CustomerRecordsController,
        GamesController,
        TiersController,
        BookingsController,
        CustomerAppController,
        SelfServiceController,
        PosController,
        PromotionsController,
        LoyaltyController,
        TournamentsController,
        CrmController,
        StationsController,
        DisplayController,
        PrintController,
        InventoryController,
        PurchasingController,
        AccountingController,
        ReportsController,
        AnalyticsController,
        StaffController,
      ],
      providers: [
        TokensService,
        AuthService,
        PrincipalService,
        TargetResolver,
        RequestAuthorizer,
        AuditService,
        LiveBus,
        DeviceHub,
        SigningKeysService,
        CommandsService,
        DeviceRuntimeService,
        EnrollmentService,
        DeviceGateway,
        SessionsService,
        SessionTimerService,
        ShellAuthService,
        StationConfigService,
        InventoryService,
        SteamBuildsService,
        GameUpdatesService,
        StationReportsService,
        CommerceService,
        MembershipExpiryService,
        BookingsService,
        OrdersService,
        KitchenService,
        ShiftsService,
        SeatOrderingService,
        ShellTimeService,
        ScreenshotsService,
        PromotionsService,
        LoyaltyService,
        TournamentsService,
        CrmService,
        PushService,
        PlayerService,
        CustomerAuth,
        StationControlService,
        PrintService,
        StockService,
        PurchasingService,
        AccountingPosterService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
        { provide: APP_FILTER, useClass: ErrorsFilter },
      ],
    };
  }
}
