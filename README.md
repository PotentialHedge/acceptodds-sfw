# acceptodds — Safe for work edition

**Live at https://acceptodds.com.**

A place to read, search and follow conference papers: the submissions of a
venue (ICLR 2027 first), a full-text search with its own query syntax, a map
of the field, related papers, citations, reading groups, emoji reactions and
a discussion under each paper, and recommendations built from what you have
followed and read.

Anyone can browse. Signing in takes an address on an institutional email
domain (below); it adds following, reading lists, groups, reactions,
comments and recommendations.

The public brand is **acceptodds**; the code, package and database keep the
name papermarket.

## Where it came from

This repo is a fork of the acceptodds platform (remote `upstream`), on the
same database schema, so it can run against a copy of that edition's data
and pull its fixes:

```sh
git fetch upstream && git merge upstream/master
```

Some code this edition never runs is still in the tree, unused, so that
those merges stay small. Nothing reachable here calls it, and `src/proxy.ts`
answers its pages and API paths with a 404 (`src/lib/sfw.ts`). This fork's
own migrations start at `drizzle/0045`: merging an upstream migration
numbered 0045 or later needs renumbering.

## What this is not

**The platform does not fetch papers.** There is no scraper and no arXiv or
OpenReview client here. Listings (title, authors, abstract, keywords, links,
references, full text), related-paper lists and the map layout are supplied
by separate services over the admin API (`POST /listings`,
`PUT /listings/{id}/related`, `PUT /map`, …), and stored and shown as given.

## Stack

TypeScript, Next.js 16 (App Router), Drizzle on Postgres 16, Better Auth,
Tailwind v4, deck.gl for the map, Vitest + fast-check, Node 26. Production is
one app container and one Postgres behind Traefik and Cloudflare.

## Layout

```
src/
  proxy.ts             the first-visit gate, and 404s for paths this edition doesn't serve
  lib/                 pure helpers: formatting, search syntax, map maths, links
  db/schema.ts         Drizzle tables (db/auth-schema.ts is Better Auth's, generated)
  db/migrate.ts        migration runner
  db/seed.ts           loads the real ICLR 2027 submissions (data/iclr2027.sqlite)
  server/views.ts      read models for pages and the API (never writes)
  server/auth.ts       request -> account: API key or session cookie, scopes
  server/better-auth.ts sign-in, mail confirmation, API keys
  server/api/          the /api/v1 contract (Zod), handlers, OpenAPI, error codes
  server/              what writes: listings, follows, groups, reading, reactions, discussion, …
  app/                 pages, and app/api/v1 route files that only re-export handlers
  components/          the UI's shared pieces (ui.ts holds the class lists)
config/                institution-domains.json, the sign-in allowlist
scripts/               token:mint, users:prune, institutions:build, pg-backup.sh
drizzle/               generated migrations, checked in
tests/unit/            no database, fast
tests/integration/     real Postgres
```

`AGENTS.md` is the reference for how and why things are the way they are.

## What a visitor sees

- **A first page, once per browser.** `src/proxy.ts` shows every page as
  the gate (`app/gate/route.ts`, with a "Take me to the Safe for work
  edition →" button) until the browser has the `sfw_entered` cookie. The
  button posts to `app/enter/route.ts`, which sets the cookie for a year
  and goes on to the page first asked for. The API, `/healthz` and the
  machine-read files (`robots.txt`, the sitemap, `llms.txt`) are never gated.
- **The home list** sorts by `newest` (listing order) or `popular` (views),
  plus `rating` (mean review rating) within a venue, `relevance` while
  searching and `recommended` when signed in. Each row shows its paper's mean rating,
  and the search bar filters on it (`rating>=3.5`, also `score:`).
- **A paper's page** is its title block and abstract, quick actions
  (follow, reading list), emoji reactions, related papers with the minimap,
  its citations, and a discussion.
- **A paper's share card** (`/papers/<slug>/card.png`) shows its title, authors and
  where its mean rating sits at its venue, led by a large "Top 1%" or
  "Bottom 12%". The gate carries the same preview
  tags, since a crawler has no cookie to get past it.
- **The map** (`/map`) lays out a venue's papers as the map service sent
  them, with the home page's search lighting up matches.
- **Reading groups** have their own pages: `/groups`, linked from the
  navbar, and `/groups/<id>`, with the group's shared reading list.
- **Reactions** (`listing_reactions`, `server/reactions.ts`) are anonymous:
  a count per emoji, GitHub's eight suggested, any single emoji allowed.
- **Comments** live on the listing (`comments.listing_id`,
  `server/discussion.ts`), pseudonymous per paper ("Reviewer k3xm"), in
  Markdown with TeX math; posting needs a confirmed institutional address.

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
npm run db:seed             # resets accounts; keeps existing papers, related lists and the map
# On an empty database, loads data/iclr2027.sqlite (copy it from ../research).
# To also wipe paper data and reload SQLite: npm run db:seed -- --reset-listings
npm run dev                 # http://localhost:3000, /healthz checks the database
```

Without `RESEND_API_KEY`, mail (sign-in links and codes) is printed to the
server log.

## Deploying

`Dockerfile` builds two targets: `app` (the standalone Next.js server) and
`tools` (full source, for migrations and the scripts).
`docker-compose.prod.yml` runs them as the compose project `acceptodds-sfw`;
its header has the deploy steps. Commit first: the image is tagged with
HEAD's commit (`GIT_COMMIT`). First time on a host:

```sh
scripts/init-env-production.sh https://acceptodds.com   # writes .env.production, generates secrets
```

Migrations are their own step and never run at app start.

Production's database was made once from a copy of the original edition's,
with `scripts/strip-markets.sql` applied to the copy (the compose file's
header has the commands). Never run that script against a database you mean
to keep whole.

## Signing in and the API

`/api/v1` is documented at `/docs` (Scalar), from the OpenAPI 3.1 document at
`/api/v1/openapi.json`, which is generated from the same Zod schemas the
handlers validate with.

People sign up and sign in on `/signin` with an emailed link or code, **only
from an email domain on the institution allowlist** (below); anything else is
refused with `422 EMAIL_DOMAIN_NOT_ALLOWED` before a user exists or a mail is
sent. Confirming the address is the institutional verification. Signed-in
users mint their own read-only API keys on `/profile`. A signed-in user whose
email is in `ADMIN_EMAILS` (comma-separated) also gets the `admin` scope.

Admin tokens, for the services that supply listings, related papers and the
map, are minted by an operator:

```sh
npm run token:mint -- --handle research-bot --scopes admin --name ops
```

The token is printed once and stored only as a hash.

## Pruning unconfirmed sign-ups

Anyone can start a sign-up for any allowlisted address, which makes a Better
Auth user before the address is confirmed. `npm run users:prune` deletes those
never confirmed after a week (`--older-than-days` overrides). Run it weekly
from the host's cron:

```cron
0 4 * * 0  cd /srv/papermarket && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm tools npm run users:prune
```

## Backups

`scripts/pg-backup.sh` dumps the production database (`pg_dump -Fc`, zstd)
and keeps the newest 6 hourly dumps and 14 days of dailies in
`~/backups/acceptodds`, mode 600. With `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`
and the bucket's `AWS_*` keys in `~/.config/acceptodds/backup.env`, every run
also goes to that restic repository, encrypted before it leaves the host;
24 hourly, 30 daily and 12 monthly snapshots are kept. Keep a copy of
`RESTIC_PASSWORD` off the host: without it the off-site copies cannot be read.
Run it hourly:

```cron
17 * * * *  /srv/papermarket/scripts/pg-backup.sh >> ~/logs/acceptodds/backup.log 2>&1
```

Restore into an empty database with
`pg_restore --no-owner -d <db> < acceptodds-<stamp>.dump`;
`restic dump latest acceptodds.dump` fetches the newest off-site copy.

## Page analytics

Umami, from the host-wide instance in `~/ops`. Set `UMAMI_URL` and
`UMAMI_WEBSITE_ID` in `.env.production` and restart; either empty turns it
off. It counts page views only on `APP_URL`'s host, is cookieless, and records
URLs through an allowlist of query parameters (`lib/analytics.ts`), so
`/verify-email?email=…` is recorded as `/verify-email`.

## Who can sign in: `config/institution-domains.json`

```json
{ "domains": { "ethz.ch": "ETH Zurich", "ox.ac.uk": "University of Oxford" } }
```

Each listed domain also admits its subdomains (`inf.ethz.ch`). The name is
what appears as the person's institution. The file is **generated**, about
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
npm test                 # unit tests, no database needed
npm run test:integration # API and view tests against real Postgres ($TEST_DATABASE_URL)
npm run test:all
npm run lint && npm run format:check
```

Only what this edition serves is tested. `npm run test:integration`
**truncates every table** in `$TEST_DATABASE_URL`, so never point that at a
database you care about.
