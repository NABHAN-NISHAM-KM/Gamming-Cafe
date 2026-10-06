# 23 · Production

What has to be in place before real venues use ArenaOS, and how to run it. Dev setup is in the [README](../README.md); the security model is in [05-multi-tenancy](05-multi-tenancy.md).

## 1. Database roles

The dev bootstrap (`infra/postgres/init/001_roles.sql`) makes `arena_owner` a **superuser with known passwords**. Never use it in production.

Run [`infra/postgres/production-roles.sql`](../infra/postgres/production-roles.sql) once, as the cluster superuser, with passwords from your secret manager:

```bash
psql "postgresql://postgres@DB_HOST/postgres" -v ON_ERROR_STOP=1 -v owner_pw="$OWNER_PW" -v api_pw="$API_PW" -v reporting_pw="$REPORTING_PW" -v platform_pw="$PLATFORM_PW" -f infra/postgres/production-roles.sql
```

| Role | Used by | Can bypass RLS |
|---|---|---|
| `arena_owner` | `prisma migrate deploy` only (`DATABASE_URL`) | No (not a superuser; tables are FORCE RLS) |
| `arena_api` | API, `APP_DATABASE_URL` | No |
| `arena_platform_svc` | Super Admin service, `PLATFORM_DATABASE_URL` | Yes, by design |
| `arena_reporting` | read replica / BI | No |

Verified on a clean PostgreSQL 17: all migrations apply as this non-superuser owner, the 21 `SECURITY DEFINER` functions end up owned by `arena_definer`, and the RLS and invariant suites pass (184/184) with `arena_api` as the runtime role.

The DB integration tests seed with `row_security = off`, which the production owner correctly can't do. Run them with a superuser as `TEST_DATABASE_URL`.

## 2. Deploy

- **Environment:** `NODE_ENV=production` (turns off demo payments and makes cookies `Secure`). Set `CORS_ORIGINS`, `ADMIN_URL`, `WEBSITE_URL` and `CUSTOMER_APP_URL` to the real HTTPS addresses.
- **Secrets:** generate `JWT_*`, `MFA_ENCRYPTION_KEY_B64` and `COMMAND_KEK_B64` once and keep them in the secret manager. Losing the MFA or command keys locks out every authenticator and station.
- **Super Admin:** seed with `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` (12+ characters); the seed refuses anything weaker in production.
- **Processes:** run `pm2 reload ecosystem.config.cjs` (API and platform service) behind Nginx with TLS. The API trusts one proxy hop (`trust proxy 1`), so Nginx must set `X-Forwarded-For`. Sign-in throttles are per client address.
- **Headers:** set HSTS, `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` in Nginx for the admin console and website.

## 3. Backups and restore

**Point-in-time recovery is required.** Wallets, ledgers and bills can't be lost. Use managed Postgres with PITR enabled, or WAL archiving with pgBackRest / WAL-G to storage in another region.

On top of that, take a nightly logical dump with [`infra/backup.sh`](../infra/backup.sh). It dumps, checks the dump can be read, copies it off the server and prunes old local copies:

```bash
30 2 * * * BACKUP_DATABASE_URL=postgresql://postgres@DB_HOST/arena BACKUP_COPY_CMD='aws s3 cp' BACKUP_COPY_TO=s3://BUCKET/arena /srv/arena/infra/backup.sh >> /var/log/arena-backup.log 2>&1
```

`BACKUP_DATABASE_URL` must be a superuser or BYPASSRLS role. With any other role, RLS hides tenant rows and `pg_dump` refuses to run.

**Restore** (run a restore drill monthly, into a scratch database, never into production):

```bash
createdb -O arena_owner arena_restore
pg_restore --exit-on-error -d arena_restore arena-YYYYMMDDTHHMMSSZ.dump
```

The roles from §1 must exist on the target cluster first, because the dump keeps owners and grants.

## 4. Monitoring and alerts

- **Health:** `GET /health` on the API (`:4000`) and the platform service (`:4100`) checks the database.
- **Outage alerts:** the website server checks every service each minute (see [21-website](21-website.md)). Set `ALERT_WEBHOOK_URL` (Slack incoming webhook or any `{ text }` relay). It posts when a service fails two checks in a row, and again when it recovers.
- **External check:** that monitor runs on the same server, so it can't report the whole server going down. Also point an external uptime service at both `/health` URLs.
- **Logs:** unhandled errors are logged with a stack trace (clients only see `internal_error`). Install `pm2-logrotate` so the logs don't fill the disk.

## 5. Known limits

- **One API instance.** Live station connections, sign-in throttles and the background sweeps live in process memory. Running two instances would double the sweeps and split the throttles. Scale up the machine, not out, until these move to Redis.
- **No offline branch server yet** (Phase 13). Stations keep timing and locking sessions while offline; the POS, KDS and Live Floor need the internet.
- **Sign-in protection:** an account locks for `LOGIN_LOCK_MINUTES` after `LOGIN_MAX_FAILURES` (default 5) wrong passwords, PINs **or two-step codes** in a row. Only a complete sign-in resets the count, so re-entering the password does not reset code guesses. An address is refused after 30 failed staff sign-ins (10 for Super Admin) in 15 minutes.
