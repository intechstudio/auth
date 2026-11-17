# auth

The local identity provider for Intech Studio development. The website, the
shop, Grid Editor and Profile Cloud sign in through
[Keycloak](https://www.keycloak.org); this repo runs a Keycloak instance on
your machine and configures it from code, so each of those projects can be
developed against real sign-in.

The projects speak standard OpenID Connect only (discovery, code + PKCE, ID
token verification against JWKS, RP-initiated logout). Nothing in them is
specific to Keycloak; everything that is lives here.

It holds no production configuration and no credentials. Keep it that way: never
commit a `.env` file, a user export, or anything taken from a hosted instance.

## Running it

```sh
cp .env.example .env
docker compose up -d
```

This starts Keycloak, its Postgres and Mailpit, published on `127.0.0.1`
only. Once Keycloak is healthy, the one-off `keycloak-config-cli` service
applies `realm/intechstudio.json` and exits. After editing the realm file
or `.env`, apply it again:

```sh
docker compose run --rm keycloak-config-cli
```

Applying is idempotent; an unchanged result is skipped.

Every URL and secret comes from `.env`; `.env.example` lists them all with
local values. URLs are base URLs (`AUTH_URL`, `WEBSITE_URL`,
`GRID_EDITOR_WEB_URLS`, `DISCOURSE_URL`), and the realm file adds the paths.
`GRID_EDITOR_WEB_URLS` is a comma-separated list, expanded by a
`$${javascript: ...}` expression in the realm file.

| Service | URL |
|---|---|
| Keycloak admin console (`admin` / `admin` unless set in `.env`) | http://localhost:3001/admin |
| Mailpit, where every email the realm sends lands | http://localhost:8026 (SMTP on port 1026) |

The realm has open sign-up with email verification, forgot password,
sign-in with email, brute-force detection and the clients below. Google
sign-in is off unless `GOOGLE_ENABLED=true`, with a Google OAuth client
whose redirect URI is `<AUTH_URL>/realms/intechstudio/broker/google/endpoint`.

Still to come: a login theme (message overrides on the default theme, system
fonts for now).

## Clients

Client ids are fixed strings, the same in every database, so no project has
to copy generated ids.

| Client | Type | Used by |
|---|---|---|
| `website` | confidential | the website (server-side code flow) |
| `grid-editor` | public, PKCE | Grid Editor desktop (loopback redirect) and web builds |
| `discourse` | confidential | the forum |

Local issuer: `http://localhost:3001/realms/intechstudio`.

## Importing Firebase users

Needs Node 24 or later; no packages to install. Users from a
`firebase auth:export --format=json` file keep their Firebase uid as Keycloak
id (so `sub` is unchanged), get no password, and keep their Google link. Users
who had a password get the admin-only attribute `recoveryEmail=pending`,
which the recovery workflow below acts on. Users without an email are skipped,
and so are users whose email (ignoring case) appears more than once; both are
listed.

```sh
node importer/convert.ts export.json                                  # dry run: counts only
node importer/convert.ts export.json --write exports/users.json
node importer/load.ts exports/users.json
```

`load.ts` uses the Admin API's partial import into the running realm. A user
that already exists is skipped, not overwritten, so loading again is safe.
Keep exports and users files in `exports/`, which git ignores.

## Recovery email

`workflows/recovery-email.json` is a Keycloak workflow: every
`RECOVERY_EMAIL_INTERVAL` it sends up to `RECOVERY_EMAIL_BATCH_SIZE` users
with `recoveryEmail=pending` a link to set a password (and verify the email),
then removes the attribute, so nobody gets it twice. The link is valid for 24
hours and ends with a link back to `WEBSITE_URL`.

```sh
node workflows/apply.ts                                # create (disabled) or update
node workflows/apply.ts --enable recovery-email        # start sending
node workflows/apply.ts --disable recovery-email       # pause
```

Applying creates the workflow disabled and otherwise leaves its enabled state
alone; only `--enable` and `--disable`, or the toggle under Workflows in the
admin console, change it. keycloak-config-cli does not manage it: its
workflow support does not work against Keycloak 26.8.

The scripts read `.env` and refuse a Keycloak that is not on this machine
unless `--target-host <host>` names its host.

## Sample export

`fixtures/firebase-export.sample.json` is a Firebase `auth:export` file with
fake users, for testing the importer:

| Email | Firebase uid | Case |
|---|---|---|
| `password.google@example.com` | `fixtureUidPasswordGoogle0001` | Password and Google link |
| `google.only@example.com` | `fixtureUidGoogleOnly00000002` | Google only |
| `unverified@example.com` | `fixtureUidUnverifiedEmail003` | Unverified email |
| `unverified.claim@example.com` | `fixtureUidUnverifiedClaim004` | Unverified email, recovered through "Forgot password" |
| none | `fixtureUidAnonymous000000005` | Anonymous, not imported |
