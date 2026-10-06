# Deployment

Ledger is three things: a PostgreSQL database, the API (Node), and static web files. Nothing is tied to one
host. This page covers the ready-made Docker setup, then what to do without it.

> The Docker files were written and reviewed carefully but **have not been built in the development
> environment** (no Docker there). The pieces that can be checked without Docker were: the API production
> bundle starts standalone and answers `/api/health`; the compose file parses; the entrypoint passes
> `sh -n`. Run the first build on a machine with Docker and treat any surprise as a bug to fix here.

## Quick start: one host with Docker Compose

```bash
cp .env.production.example .env.production      # then edit it
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
```

You get PostgreSQL, the API and an nginx container serving the web app (port 8080) and forwarding `/api`
to the API, so the browser sees one origin and cookies "just work". **Put TLS in front of port 8080** (your
host's load balancer, Caddy, Traefik, …). The app refuses to start in production without
`COOKIE_SECURE=true`, which is set for you, so it must be reached over HTTPS.

### Settings (`.env.production`)

| Variable            | What it is                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | Database password. Use URL-safe characters (the generator in the example file produces them), because it is embedded in a connection URL.                  |
| `SESSION_SECRET`    | 32+ random characters; signs the session cookie. Changing it signs everyone out. The example value is rejected in production.                              |
| `WEB_ORIGINS`       | The exact public origin, e.g. `https://ledger.example.com`. It is both the CORS allowlist and the CSRF origin check, so a mismatch makes every write fail. |
| `WEB_PORT`          | Host port for the web container (default 8080).                                                                                                            |
| `LOG_LEVEL`         | `info` by default. Passwords, tokens and cookies are redacted from logs regardless.                                                                        |

### Releases and migrations

The API container runs `prisma migrate deploy` on start (`RUN_MIGRATIONS=true`), which only applies
migrations that are not applied yet. That is fine for one API instance. With several replicas, or a
pipeline that migrates first, set `RUN_MIGRATIONS=false` on the replicas and run the migration once as a
release step:

```bash
docker compose -f docker-compose.production.yml run --rm -e RUN_MIGRATIONS=true api true
```

Migrations are forward-only SQL files in `apps/api/prisma/migrations`. Take a database backup before a
release that includes one (see below).

### Backups

Everything worth keeping is in PostgreSQL. A nightly dump is enough to start with:

```bash
docker compose -f docker-compose.production.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > ledger-$(date +%F).sql.gz
```

Test a restore at least once; an untested backup is a hope. People can also export their own transactions
as CSV from Settings → Your data.

## Without Docker

- **Database:** any PostgreSQL 14+ (managed is best). Create an empty database and user.
- **API:** `npm ci && npm run db:generate -w @pfm/api && npm run build -w @pfm/api`, then on release
  `npm run db:deploy -w @pfm/api` and run `node apps/api/dist/server.js` with the environment from
  `.env.example` (production needs `NODE_ENV=production`, `COOKIE_SECURE=true`, a real `SESSION_SECRET`).
  Run it under a process manager (systemd, pm2) that restarts it.
- **Web:** `npm run build -w @pfm/web`, then serve `apps/web/dist` from any static host with these rules,
  which `deploy/nginx.conf` shows in full: `/api/*` goes to the API on the same origin; every other path falls
  back to `index.html`; `/assets/*` is cached for a year (fingerprinted); `index.html` is never cached.

## Operating notes

- **Health:** `GET /api/health` returns `{"status":"ok"}`; both containers have health checks.
- **Background work:** the API records due recurring payments at start-up and every 10 minutes
  (idempotent, safe with several replicas). Notifications are created when someone opens the app.
- **Time zones:** each person's timezone decides where their day starts. Servers can run in UTC.
- **Reverse proxy headers:** in production the API trusts `X-Forwarded-*` (it expects to sit behind a
  proxy), so make sure the API port is not reachable from the internet directly.
- **Rate limits** are per process. Behind several replicas, put a shared limit at the edge as well.
- **Logs** are JSON on stdout; ship them with whatever your platform provides.
