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

The Keycloak stack is being built. Until it lands, this repo has no runnable
stack. Planned contents:

- `docker-compose.yml`: Keycloak at an exact image tag, its own Postgres and
  Mailpit, published on `127.0.0.1` only.
- The `intech` realm as a file, applied idempotently by
  [keycloak-config-cli](https://github.com/adorsys/keycloak-config-cli):
  open sign-up with email verification, forgot password, brute-force
  detection, SMTP to Mailpit, and the clients below.
- A login theme: CSS and message overrides on the default theme, with Inter
  Bold from `fonts/` (SIL Open Font License).

## Clients

Client ids are fixed strings, the same in every database, so no project has
to copy generated ids.

| Client | Type | Used by |
|---|---|---|
| `website` | confidential | the website (server-side code flow) |
| `grid-editor` | public, PKCE | Grid Editor desktop (loopback redirect) and web builds |
| `discourse` | confidential | the forum |

Local issuer: `http://localhost:3001/realms/intech`.
