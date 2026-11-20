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
local values. URLs are base URLs (`WEBSITE_URL`, `GRID_EDITOR_WEB_URLS`,
`DISCOURSE_URL`), and the realm file adds the paths.
`GRID_EDITOR_WEB_URLS` is a comma-separated list, expanded by a
`$${javascript: ...}` expression in the realm file.

| Service | URL |
|---|---|
| Keycloak admin console (`admin` / `admin` unless set in `.env`) | http://localhost:3001/admin |
| Mailpit, where every email the realm sends lands | http://localhost:8026 (SMTP on port 1026) |

The realm has open sign-up with email verification, forgot password,
sign-in with email, brute-force detection and the clients below. Google
sign-in is off unless `GOOGLE_ENABLED=true`, with a Google OAuth client
whose redirect URI is
`http://localhost:3001/realms/intechstudio/broker/google/endpoint` (add the
same path on your tunnel hostname to sign in with Google through it).

## Login theme

`themes/intechstudio/login` puts the Intech logo and the website's black
buttons on Keycloak's default sign-in page (`keycloak.v2`): a logo and one
stylesheet, no copied templates and no changed texts, so Keycloak upgrades
leave it working. System fonts for now. Compose mounts `themes/` and
`start-dev` does not cache themes, so an edit shows on a reload. The realm
file selects it (`loginTheme`); the logo comes from the realm's
`displayNameHtml`.

`themes/intechstudio/email` frames every HTML email like the shop's emails
(logo, bordered card, help line and address; Inter, then Roboto). The texts
stay Keycloak's, except the recovery email's: Keycloak's invite step sends
the "execute actions" email, whose subject and body
`email/messages/messages_en.properties` replaces. An update-password email
sent from the admin console reads the same. The logos are the website's hosted PNGs under
`https://intech.studio/email/`. Mail goes out as "Intech Studio"
`system@intech.studio`, replies to `support@intech.studio`.

## Localhost and an optional tunnel

Keycloak has no fixed hostname: it builds its URLs, the issuer among them,
from each request. Everything on this machine (the website, the shop, Grid
Editor, end-to-end tests and the scripts here) uses
`http://localhost:3001/realms/intechstudio`.

A public issuer is only needed by something that cannot reach this machine.
For that, each developer can run their own Cloudflare Tunnel to this
Keycloak, under their own hostname. Localhost and the tunnel work at the same time, without
switching anything. To set one up:

1. In Cloudflare Zero Trust, create a tunnel (cloudflared) and copy its token.
2. Give it a public hostname, say `auth-<name>.example.com`, with the service
   `http://keycloak:8080`.
3. In `.env`, set `TUNNEL_TOKEN`.
4. Start the stack with the tunnel:

   ```sh
   docker compose --profile tunnel up -d
   curl -s https://auth-<name>.example.com/realms/intechstudio/.well-known/openid-configuration | jq .issuer
   # "https://auth-<name>.example.com/realms/intechstudio"
   ```

5. Point the client, for example Grid Editor's `VITE_AUTH_ISSUER_DEV`, at
   `https://auth-<name>.example.com/realms/intechstudio`.

Plain `docker compose up -d` leaves the tunnel off, and
`docker compose stop cloudflared` stops it. Keycloak trusts `X-Forwarded-*` headers
(`KC_PROXY_HEADERS`); cloudflared sends the tunnel hostname as `Host` and
`X-Forwarded-Proto: https`, so the tunnel's URLs are `https`.

## Clients

Client ids are fixed strings, the same in every database, so no project has
to copy generated ids.

| Client | Type | Used by |
|---|---|---|
| `website` | confidential | the website (server-side code flow) |
| `grid-editor` | public, PKCE | Grid Editor desktop (loopback redirect) and web builds |
| `discourse` | confidential | the forum |

Local issuer: `http://localhost:3001/realms/intechstudio`; through a tunnel,
`https://<hostname>/realms/intechstudio`.

The website changes a customer's email or password through Keycloak's
"Update email" and "Update password" pages (`kc_action`), not the account
console. The `website` client's base URL, `/auth?action=refresh&redirect=/account`,
is the "Back to application" link on Keycloak's info pages. Customers set up
no second factor: TOTP, passkeys and recovery codes are off; email
verification is the only check.

## Importing Firebase users

Needs Node 24 or later; no packages to install. Users from a
`firebase auth:export --format=json` file get a Keycloak id like every other
user, no password, and keep their Google link. Their Firebase uid goes into
the admin-only attribute `firebaseUid`. Users who had a password also get
`recoveryEmail=pending`, which the recovery workflow below acts on. Users
without an email are skipped, and so are users whose email (ignoring case)
appears more than once; both are listed.

```sh
node importer/convert.ts export.json                                  # dry run: counts only
node importer/convert.ts export.json --write exports/users.json
node importer/load.ts exports/users.json
node importer/uid-map.ts exports/uid-map.json                         # Firebase uid -> Keycloak id
```

`load.ts` uses the Admin API's partial import into the running realm. A user
that already exists is skipped, not overwritten, so loading again is safe.
`uid-map.ts` reads the ids Keycloak assigned back from `firebaseUid`; apps
that keyed data on the Firebase uid remap with that file. Keep exports,
users files and maps in `exports/`, which git ignores.

## Recovery email

`workflows/recovery-email.json` is a Keycloak workflow: every
`RECOVERY_EMAIL_INTERVAL` it sends up to `RECOVERY_EMAIL_BATCH_SIZE` users
with `recoveryEmail=pending` a link to set a password (and verify the email),
then removes the attribute, so nobody gets it twice. The link is valid for 7
days (the realm's admin-initiated action lifespan) and ends with a link back
to `WEBSITE_URL`.

```sh
node workflows/apply.ts                                # create (disabled) or update
node workflows/apply.ts --enable recovery-email        # start sending
node workflows/apply.ts --disable recovery-email       # pause
```

Applying creates the workflow disabled and otherwise leaves its enabled state
alone; only `--enable` and `--disable`, or the toggle under Workflows in the
admin console, change it. keycloak-config-cli does not manage it: its
workflow support does not work against Keycloak 26.8.

The workflow sends without a request, so Keycloak has no host to build the
link from: creating it fails, and a running one sends nothing (users stay
pending). To test it, give Keycloak a fixed URL first, and take it away when
done:

```sh
# .env: AUTH_FRONTEND_URL=http://localhost:3001
docker compose run --rm keycloak-config-cli
```

Meanwhile every issuer is `http://localhost:3001/realms/intechstudio`, the
tunnel's too. Clear `AUTH_FRONTEND_URL` and apply the realm again to get the
tunnel back.

The scripts read `.env` and always talk to the Keycloak on
`http://localhost:3001`.

## Test users for end-to-end tests

Other repos' end-to-end tests get users and ID tokens from this helper, so
none of them depends on Keycloak's API:

```sh
node e2e/test-user.ts create --first-name Ana --last-name Lopez   # {"id","email","password"}
node e2e/test-user.ts token <email> <password>                    # ID token for grid-editor
node e2e/test-user.ts delete <id>
```

`create` makes a verified user with a random `e2e-…@example.com` email and
password. `token` signs in on the hosted login page with the code flow and
PKCE, as the `grid-editor` client with a loopback redirect, so it needs no
extra client or grant. Only JSON or the token goes to stdout. Like the other
scripts, it uses the Keycloak on `http://localhost:3001` unless `AUTH_URL`
names another, and prints which one to stderr.

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

## Hosted

`docker-compose.hosted.yml` is the hosted stack, built from this repository:

| Service | Image | Does |
|---|---|---|
| `keycloak` | `Dockerfile`: Keycloak with `themes/` inside | Runs in production mode against an external Postgres |
| `keycloak-config-cli` | `Dockerfile.realm`: keycloak-config-cli with `realm/` inside | Applies the realm on every deploy, then exits |

Every value comes from the host's environment. A variable written as
`${NAME:?}` in the file must be set; the others have a default. The names are
the ones in `.env.example`, plus `KC_HOSTNAME` (Keycloak's public URL) and
`KC_DB_URL_HOST`. `KC_ADMIN_USERNAME` and `KC_ADMIN_PASSWORD` are a permanent
admin of the master realm; on a new database, `KC_BOOTSTRAP_ADMIN_PASSWORD`
creates `temp-admin` to make one with.

A theme or realm change reaches the host by a deploy. The realm apply's log
ends with `keycloak-config-cli ran in …`; an unchanged realm file and
environment are skipped by checksum.
