-- Stretch A: vendor profiles and off-chain sponsorship offer text.
-- Same access model as 0001: service role only (RLS on, no policies).

create table if not exists vendors (
  wallet text primary key,
  name text not null,
  logo_url text,
  description text not null default '',
  updated_at timestamptz not null default now()
);

-- Offer text for a sponsorship; offer_hash mirrors Sponsorship.offer_hash on chain.
create table if not exists sponsorship_offers (
  event_pda text not null,
  vendor_wallet text not null,
  text text not null,
  offer_hash text not null,
  updated_at timestamptz not null default now(),
  primary key (event_pda, vendor_wallet)
);

alter table vendors enable row level security;
alter table sponsorship_offers enable row level security;
-- No policies on purpose: only the service role (server) can access these tables.
