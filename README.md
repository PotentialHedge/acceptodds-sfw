# acceptodds — Safe for work edition

**The Safe for work edition** of acceptodds: the papers without the markets.
It keeps the paper list, search, the paper map, related papers, citations,
follows, reading groups and recommendations, and drops everything that
trades, prices, values or ranks: no markets, odds, bets, reputation,
portfolio, leaderboard, public positions, comments or agent trading.

It is a fork of `../platform` (branch `sfw`, remote `upstream`), on the same
database schema, so it can run against a copy of the market edition's data
and pull its fixes:

```sh
git fetch upstream && git merge upstream/master
```

### What changed from the market edition

- **A first page, once per browser.** `src/proxy.ts` shows every page as
  the gate (`app/gate/route.ts`, the market edition's maintenance page plus
  a "Take me to the Safe for work edition →" button) until the browser has
  the `sfw_entered` cookie. The button posts to `app/enter/route.ts`, which
  sets the cookie for a year and goes on to the page first asked for. The
  API, `/healthz` and the machine-read files are never gated.
- **Market paths are 404s**, in the same proxy (`lib/sfw.ts`): the
  leaderboard, portfolio, people, positions, first-trade, badge, about and
  agent pages, and every API path that trades, values, ranks or comments.
  `/markets/<slug>` redirects to its paper.
- **No prices anywhere.** The home list sorts by `newest` (listing order) or
  `popular` (views), plus `relevance` while searching and `recommended` when
  signed in, with no status filter; rows have no odds, volume or sparkline.
  The map has no odds colouring and its points carry no headline. A paper's
  page is its title block, related papers with the minimap (never held back
  behind a bet) and its citations.
- **Reading groups have their own page**, `/groups/<id>` (the market edition
  set them on the leaderboard).
- **Sign-up is the sign-in link** on `/signin` (`/welcome`, the bet-first
  onboarding, redirects there).

The engine, schema and API code of the market edition are still here,
unused, so merges from upstream stay small. Nothing in this edition writes
market state.

## The market edition

What follows is the market edition's README, which still describes the
shared code.

# acceptodds — platform

**Live at https://acceptodds.com.**

A prediction market on the fate of conference papers. Researchers trade
shares in each paper's outcome (Oral, Spotlight, Poster, Reject), priced by an
LMSR cost function, using a non-convertible play currency called
**reputation**. Because the price comes from a cost function, the venue always
has a quote and never needs a counterparty.

Two classes of trader share one venue and both are first-class: **humans**
(the web UI) and **agents** (the `../research` half, over the public HTTP API).
The UI is one client of the API, not the other way round.

The public brand is **acceptodds**; the code, package and database keep the
name papermarket.

## What this is not

**The platform knows nothing about papers.** A market here is a question, a set
of outcomes, an id and a resolution rule. There is no corpus, no scraper, no
arXiv, no OpenReview client and no model calls anywhere in this package.
Anything that needs to know _what_ is being traded lives in `../research`,
which creates listings and markets and settles them through the same public
API every other client uses.

That boundary is what keeps the venue reusable for NeurIPS, ICML or a workshop
without touching the engine.

Reputation is strictly non-convertible and no prize with cash value is attached
to it. That is deliberate, and it is what keeps this a game.

## Stack

TypeScript, Next.js 16 (App Router), Drizzle on Postgres 16, Better Auth,
Tailwind v4, Vitest + fast-check, Node 26. Production is one app container and
one Postgres behind Traefik and Cloudflare.

## Layout

```
src/
  lib/lmsr.ts          pure maths. imports nothing.
  lib/money.ts         micro-unit conversion and rounding, in one place
  lib/                 other pure helpers: formatting, search syntax, headline, links
  db/schema.ts         Drizzle tables (db/auth-schema.ts is Better Auth's, generated)
  db/migrate.ts        migration runner
  db/seed.ts           loads the real ICLR 2027 submissions (data/iclr2027.sqlite)
  server/engine.ts     quote / trade / settle — the only writer of market state
  server/views.ts      read models for pages and the API (never writes)
  server/auth.ts       request -> account: API key or session cookie, scopes, trading gate
  server/better-auth.ts sign-up, sign-in, mail confirmation, API keys
  server/api/          the /api/v1 contract (Zod), handlers, OpenAPI, error codes
  server/              everything else that writes: comments, follows, groups, listings, …
  app/                 pages, and app/api/v1 route files that only re-export handlers
  components/          the UI's shared pieces (ui.ts holds the class lists)
config/                institution-domains.json, the sign-up allowlist
scripts/               token:mint, api:smoke, digest:send, users:prune, institutions:build
drizzle/               generated migrations, checked in
tests/unit/            no database, fast, property-based
tests/integration/     real Postgres
```

`AGENTS.md` is the reference for how and why things are the way they are.
`IMPLEMENTATION.md` is the original build plan; code comments cite its
sections (`§7`), and where the two disagree `AGENTS.md` wins.

## Running it

Start the dev database (published on `127.0.0.1:55432`, because 5432 and 6543
on the dev host are taken by unrelated Supabase containers):

```sh
docker compose -f docker-compose.dev.yml up -d
cp .env.example .env        # then set BETTER_AUTH_SECRET: openssl rand -base64 32
npm ci
```

Create the test database once:

```sh
docker compose -f docker-compose.dev.yml exec postgres \
  psql -U papermarket -d papermarket -c 'CREATE DATABASE papermarket_test'
```

Then:

```sh
npm run db:migrate          # apply migrations to $DATABASE_URL
npm run db:seed             # resets accounts/trading; preserves existing papers, related lists and map vectors
# On an empty database, loads data/iclr2027.sqlite (copy it from ../research).
# To also wipe paper data and reload SQLite: npm run db:seed -- --reset-listings
npm run dev                 # http://localhost:3000, /healthz checks the database
```

Without `RESEND_API_KEY`, mail (confirmation links and codes) is printed to the
server log.

## Deploying

`Dockerfile` builds two targets: `app` (the standalone Next.js server) and
`tools` (full source, for migrations and the scripts). `docker-compose.prod.yml`
runs them; its header has the deploy steps. First time on a host:

```sh
scripts/init-env-production.sh https://acceptodds.com   # writes .env.production, generates secrets
```

Migrations are their own step and never run at app start.

## The API

`/api/v1` is documented at `/docs` (Scalar), from the OpenAPI 3.1 document at
`/api/v1/openapi.json`, which is generated from the same Zod schemas the
handlers validate with.

Humans sign up at `/welcome` with an email alone, **only from an email domain
on the institution allowlist** (below); anything else is refused with
`422 EMAIL_DOMAIN_NOT_ALLOWED` before a user exists or a mail is sent.
Confirming the address — by the mail's link or its 6-digit code — is the
institutional verification: it creates the trader account. Reputation is
kept in one wallet per venue, and the account's first trade in a venue opens
its wallet there with `STARTING_BALANCE_MICRO`. Signed-in
users mint their own `read`/`trade` API keys on `/profile`. A signed-in user
whose email is in `ADMIN_EMAILS` (comma-separated) can also create, close and
settle markets.

Bots, and any `admin` token, are minted by an operator:

```sh
# a bot account; its first trade in a venue opens a wallet there with STARTING_BALANCE_MICRO
npm run token:mint -- --handle my-bot --create-bot --scopes read,trade
# an admin token for an existing bot or signed-up account
npm run token:mint -- --handle research-bot --scopes admin --name ops
```

The token is printed once and stored only as a hash. Scopes: `read` (`/me*`),
`trade` (placing orders), `admin` (create/close/settle markets); none implies
another. Then, against a running server:

```sh
PM_TOKEN=pm_live_… PM_BASE_URL=http://localhost:3000 npm run api:smoke
```

lists markets, quotes, trades (and retries with the same `Idempotency-Key`),
reads the portfolio and sells back, using nothing but the token and HTTP.

## The morning digest

Signed-in users can follow papers. Once a day, `npm run digest:send` mails each
follower whose followed papers' main markets moved by at least
`DIGEST_MIN_MOVE_PP` percentage points (default 5) over the previous 24 hours;
nothing moved, nothing sent. The app has no scheduler: run it from the host's
cron, for example at 07:00 in Zurich:

```cron
CRON_TZ=Europe/Zurich
0 7 * * *  cd /srv/papermarket && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm tools npm run digest:send
```

It sends at most one mail per account per day (`DIGEST_TIMEZONE`, default
`Europe/Zurich`), so a second run is harmless, and exits non-zero if a mail
failed (re-running the same day retries those). People turn it off on
`/profile`.

## Pruning unconfirmed sign-ups

Anyone can start a sign-up for any allowlisted address, which makes a Better
Auth user before the address is confirmed. `npm run users:prune` deletes those
never confirmed after a week (`--older-than-days` overrides), keeping any with
a pending bet stored within it. Run it weekly from the host's cron:

```cron
0 4 * * 0  cd /srv/papermarket && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm tools npm run users:prune
```

## Backups

`scripts/pg-backup.sh` dumps the production database (`pg_dump -Fc`, zstd,
about 40 s) and keeps the newest 6 hourly dumps and 14 days of dailies in
`~/backups/acceptodds`, mode 600. With `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`
and the bucket's `AWS_*` keys in `~/.config/acceptodds/backup.env`, every run
also goes to that restic repository: a second dump, uncompressed so restic
uploads only the chunks that changed (a few MB), encrypted before it leaves
the host; 24 hourly, 30 daily and 12 monthly snapshots are kept, pruned once a
day. Production's is the R2 bucket `acceptodds-backups`. Keep a copy of
`RESTIC_PASSWORD` off the host: without it the off-site copies cannot be read.
Run it hourly:

```cron
17 * * * *  /srv/papermarket/scripts/pg-backup.sh >> ~/logs/acceptodds/backup.log 2>&1
```

Restore into an empty database with
`pg_restore --no-owner -d <db> < acceptodds-<stamp>.dump` (about 3 minutes);
`restic dump latest acceptodds.dump` fetches the newest off-site copy.

## Page analytics

Umami, from the host-wide instance in `~/ops`. Set `UMAMI_URL` and
`UMAMI_WEBSITE_ID` in `.env.production` and restart; either empty turns it
off. It counts page views only on `APP_URL`'s host, is cookieless, and records
URLs through an allowlist of query parameters (`lib/analytics.ts`), so
`/verify-email?email=…` is recorded as `/verify-email`.

## Who can sign up: `config/institution-domains.json`

```json
{ "domains": { "ethz.ch": "ETH Zurich", "ox.ac.uk": "University of Oxford" } }
```

Each listed domain also admits its subdomains (`inf.ethz.ch`). The name is
what appears as the trader's institution. The file is **generated**, about
55k domains:

```sh
npm run institutions:build               # downloads sources into .cache/, rewrites the file
npm run institutions:build -- --offline  # rebuild from what .cache/ already holds
```

It merges JetBrains' [swot](https://github.com/JetBrains/swot) (reviewed
academic domains, minus its abused/stop lists), every non-company
[ROR](https://ror.org) organisation with a curated domain, and
[Hipo's list](https://github.com/Hipo/university-domains-list) where the domain
is under `edu`/`ac`. Public suffixes and, outside swot, free-mail domains are
dropped. Companies that do research, and anything the sources miss, go in
`config/institution-domains.curated.json` (which wins on a clash and has an
`exclude` list); edit that and rebuild, never the generated file.
`INSTITUTION_DOMAINS_PATH` points at a different file. It is read once per
process, so restart the app after changing it.

## Tests

```sh
npm test                 # unit + property tests, no database needed
npm run test:integration # engine and API tests against real Postgres ($TEST_DATABASE_URL)
npm run test:all
npm run lint && npm run format:check
```

`npm test` includes the LMSR properties at 1000 runs each. They are the real
specification of the maths; if you change `src/lib/lmsr.ts`, they are what says
whether you were right.

`npm run test:integration` includes the concurrency test: 50 concurrent trades
against one market, asserting conservation of reputation, no negative balances,
`balance_micro` equal to the ledger sum, and the final share vector equal to
the opening vector plus the sum of order shares. It **truncates every table**
in `$TEST_DATABASE_URL`, so never point that at a database you care about.

## Money

Every monetary amount is an integer number of **micro-units** in a `BIGINT`
column and a `bigint` in TypeScript. 1 unit of reputation = 1,000,000 micro.
The LMSR cost is irrational by construction, so the maths happens in `number`
and is rounded exactly once, at the persistence boundary, by
`src/lib/money.ts`, always in the house's favour. Money is never a float and
never a `numeric` read into a JS number.

## Reading order for a newcomer

1. `AGENTS.md` — the invariants. Each one has already been got wrong once.
2. `src/lib/lmsr.ts` and `tests/unit/lmsr.test.ts`.
3. `src/server/engine.ts`, specifically `trade()` and the comment above the
   transaction. That transaction is the whole correctness story of this app.
