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

## Status

The Keycloak stack is being built. `docker-compose.yml` runs Keycloak at an
exact image tag with its own Postgres and Mailpit, published on `127.0.0.1`
only:

```sh
docker compose up -d
```

| Service | URL |
|---|---|
| Keycloak (admin console: `admin` / `admin` unless set in `.env`) | http://localhost:3001 |
| Mailpit | http://localhost:8026 (SMTP on port 1026) |

Still to come:

- The `intechstudio` realm as a file, applied idempotently: open sign-up with
  email verification, forgot password, brute-force detection, SMTP to
  Mailpit, and the clients below.
- A login theme: CSS and message overrides on the default theme, set in Inter.
  No font files are kept in this repo.

## Clients

Client ids are fixed strings, the same in every database, so no project has
to copy generated ids.

| Client | Type | Used by |
|---|---|---|
| `website` | confidential | the website (server-side code flow) |
| `grid-editor` | public, PKCE | Grid Editor desktop (loopback redirect) and web builds |
| `discourse` | confidential | the forum |

Local issuer: `http://localhost:3001/realms/intechstudio`.

## Sample export

`fixtures/firebase-export.sample.json` is a Firebase `auth:export` file with
fake users, for testing the importer:

| Email | Firebase uid | Case |
|---|---|---|
| `password.google@example.com` | `fixtureUidPasswordGoogle0001` | Password and Google link |
| `google.only@example.com` | `fixtureUidGoogleOnly00000002` | Google only |
| `unverified@example.com` | `fixtureUidUnverifiedEmail003` | Unverified email |
| `unverified.claim@example.com` | `fixtureUidUnverifiedGoogle04` | Unverified email, Google link with another address |
| none | `fixtureUidAnonymous000000005` | Anonymous, not imported |
