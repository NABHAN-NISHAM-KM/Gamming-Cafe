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
import { CommandsService } from "./devices/commands.service.js";
import { DeviceGateway } from "./devices/device-gateway.js";
import { DeviceRuntimeService } from "./devices/device-runtime.service.js";
import { DevicesController } from "./devices/devices.controller.js";
import { DeviceEnrollController, EnrollmentService } from "./devices/enrollment.js";
import { DeviceHub, LiveBus } from "./devices/live.js";
import { SigningKeysService } from "./devices/signing-keys.service.js";
import { CustomersController } from "./customers/customers.controller.js";
import { PricingController } from "./sessions/pricing.controller.js";
import { SessionTimerService } from "./sessions/session-timer.service.js";
import { SessionsController } from "./sessions/sessions.controller.js";
import { SessionsService } from "./sessions/sessions.service.js";
import { ShellAuthService } from "./sessions/shell-auth.service.js";
import { GameUpdatesService } from "./games/game-updates.service.js";
import { GamesController } from "./games/games.controller.js";
import { InventoryService } from "./games/inventory.service.js";
import { StationConfigService } from "./games/station-config.service.js";
import { StationReportsService } from "./stations/station-reports.service.js";
import { BookingsController } from "./bookings/bookings.controller.js";
import { BookingsService } from "./bookings/bookings.service.js";
import { CommerceService } from "./customers/commerce.service.js";
import { MembershipExpiryService } from "./customers/membership-expiry.service.js";
import { TiersController } from "./customers/tiers.controller.js";
import { CustomerAppController } from "./customer-app/customer-app.controller.js";
import { KitchenService } from "./pos/kitchen.service.js";
import { OrdersService } from "./pos/orders.service.js";
import { PosController } from "./pos/pos.controller.js";
import { SeatOrderingService } from "./pos/seat-ordering.service.js";
import { ShiftsService } from "./pos/shifts.service.js";

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
        EmployeesController,
        RolesController,
        DevicesController,
        DeviceEnrollController,
        SessionsController,
        PricingController,
        CustomersController,
        GamesController,
        TiersController,
        BookingsController,
        CustomerAppController,
        PosController,
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
        GameUpdatesService,
        StationReportsService,
        CommerceService,
        MembershipExpiryService,
        BookingsService,
        OrdersService,
        KitchenService,
        ShiftsService,
        SeatOrderingService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
        { provide: APP_FILTER, useClass: ErrorsFilter },
      ],
    };
  }
}
