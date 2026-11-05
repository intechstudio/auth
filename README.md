# auth

The local identity provider for Intech Studio development. The website, the
shop, Grid Editor and Profile Cloud sign in through [Logto](https://logto.io);
this repo runs a Logto instance on your machine and configures it from code, so
each of those projects can be developed against real sign-in.

It holds no production configuration and no credentials. Keep it that way: never
commit a `.env` file, a user export, or anything taken from a hosted instance.

## Requirements

Docker with Compose, and Node 22 or newer.

## Services

| Service | URL |
|---|---|
| Logto (issuer `/oidc`) | http://localhost:3001 |
| Admin console | http://localhost:3002 |
| Mailpit inbox | http://localhost:8026 |
| Mailpit SMTP from the host | `localhost:1026` |

All four are published on `127.0.0.1` only.

## Start

```sh
npm install
cp .env.example .env
docker compose up -d --wait
```

The one-off `alteration` service seeds an empty database and applies pending
alterations, then Logto starts.

## Bootstrap the seed credential (once per database)

The seed script needs a Management API client to run, so the first one is
created by hand.

1. Open http://localhost:3002 and create the admin account.
2. Applications → Machine-to-machine → Start building, name it `seed`.
3. In "Assign roles to seed", tick `Logto Management API access` and assign.
4. Copy the app ID and app secret from the app's page into `LOGTO_M2M_APP_ID`
   and `LOGTO_M2M_APP_SECRET` in `.env`.

## Seed

```sh
npm run seed
```

Creates or updates, by name: the `website`, `discourse` and `grid-editor` apps,
the SMTP connector, the sign-in experience, the account center and the `hq-api`
API resource. `branding.css` styles the hosted sign-in and account pages, with
Inter Bold from `fonts/` (SIL Open Font License) embedded for the headings.
Turnstile is configured only when both `TURNSTILE_*` keys are set. A rerun with
the same env prints `No changes.`

It prints each app's id. Logto generates the ids, so every database has
different ones, and each project that signs in needs yours:

- **Grid Editor:** build with `VITE_AUTH_CLIENT_ID_DEV` set to the `grid-editor`
  id. `VITE_AUTH_ISSUER_DEV` defaults to `http://localhost:3001/oidc`.
- **Website and shop:** copy the `website` id and secret, and the accepted
  audiences, into their `.env` files. `npm run seed -- --show-secrets` prints
  the secret.

Every URI variable must be set, so a missing one cannot wipe an app's redirect
URIs. Only `DISCOURSE_*` may be empty. A redirect URI added in the console is
removed by the next seed, so add it in `.env`.

Removing the Turnstile keys does not disable a configured provider. Delete it
under Security in the console.

## Test accounts

Sign up on the hosted page with any address. Verification codes arrive in
Mailpit, and no mail leaves your machine.

## Reset

```sh
docker compose down -v
```

This deletes the database. Every id and secret changes, so repeat the bootstrap
and seed, then update the `.env` files that copied them.

## Public issuer

Some clients fetch the issuer's discovery document from their own servers, and
cannot reach `localhost`. For those, put the stack behind an https tunnel to
`http://localhost:3001`:

1. Set `LOGTO_ENDPOINT` in `.env` to the tunnel's https origin, then
   `docker compose up -d`. This recreates `logto` with the new issuer; users,
   apps and secrets are unchanged.
2. Point every client at the new issuer, `<origin>/oidc`. Clients left on
   `localhost:3001` fail on an issuer mismatch.

The seed reaches Logto through the same hostname, so it fails while the tunnel
is down. Stop the tunnel when done: while it runs, the sign-in and registration
pages are public. The admin console stays on `localhost:3002`.

## Upgrading Logto

Change the image tag and the `alteration deploy` version together in
`docker-compose.yml`, then `docker compose up -d --wait`.
