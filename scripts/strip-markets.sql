-- Safe for work edition: strips the market edition's trading data from a COPY
-- of its database. Never run it against the market edition's own database.
--
--   docker exec -i <sfw postgres container> sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < scripts/strip-markets.sql
--
-- One transaction: all of it, or nothing. Kept: listings and everything about
-- them (texts, references, related papers, the map, views, transitions),
-- people (users, accounts, affiliations, sessions, API keys), follows, groups,
-- reading lists and read markers, announcements, and `usd_costs` (real money
-- spent, an operating record rather than trading). Gone: markets and all that
-- hangs off them, reputation, comments, pending bets, agent codes, the house
-- and its market makers, the AI trader bots, and the log of market reads.

begin;

-- Trading itself, and everything that only made sense beside it.
truncate table
  ledger_entries,
  wallets,
  public_positions,
  positions,
  orders,
  comment_backings,
  comment_mentions,
  comments,
  comment_aliases,
  pending_bets,
  outcomes,
  markets,
  field_snapshots,
  agent_codes;

-- The house: its treasury and one maker account per market.
delete from accounts where is_house;

-- The AI trader bots: their API keys, accounts (and with them any follows or
-- groups) and their login-less users.
delete from apikey
 where reference_id in (select id from "user" where email like '%@bots.papermarket.invalid');
delete from accounts where is_bot;
delete from "user" where email like '%@bots.papermarket.invalid';

-- The log of market reads and trades (no payload, no foreign keys).
delete from events
 where market_id is not null
    or kind like 'market.%'
    or kind like 'order.%'
    or kind like 'quote.%'
    or kind like 'portfolio.%'
    or kind like 'leaderboard.%'
    or kind like 'comment%'
    or kind like 'badge.%'
    or kind like 'position%'
    or kind like 'backing%'
    or kind like 'mention%'
    or kind like 'onboarding.%';

-- Rate-limit buckets for opening markets and placing bets.
delete from rate_limit_buckets where key like 'market-open:%' or key like 'mention-mail:%';

commit;
