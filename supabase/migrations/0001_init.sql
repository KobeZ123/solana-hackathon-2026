-- Event Pool: initial schema. Applied manually (not auto-provisioned):
--   supabase db push   (or paste this file into the Supabase SQL editor)
-- The API uses the service-role key, which bypasses RLS. RLS is enabled with NO policies,
-- so the anon/authenticated roles can read and write nothing.

create table if not exists events (
  event_pda text primary key,
  host_wallet text not null,
  title text not null,
  summary text not null default '',
  cover_url text,
  details jsonb not null,            -- gated: location, full description, links
  metadata_hash text not null,       -- hex sha256, mirrors Event.metadata_hash on chain
  visibility text not null default 'public' check (visibility in ('public', 'network')),
  created_at timestamptz not null default now()
);
create index if not exists events_host_wallet_idx on events (host_wallet);
create index if not exists events_created_at_idx on events (created_at desc);

-- One outstanding sign-in nonce per wallet; consumed with DELETE ... RETURNING.
create table if not exists auth_nonces (
  wallet text primary key,
  nonce text not null,
  expires_at timestamptz not null
);

-- Stretch B: attendance index (rebuilt from Ticket accounts).
create table if not exists attendance (
  event_pda text not null,
  wallet text not null,
  checked_in boolean not null default false,
  checked_in_at timestamptz,
  primary key (event_pda, wallet)
);
create index if not exists attendance_wallet_idx on attendance (wallet);

-- 1-hop connections for a viewer; strong = both checked in.
create or replace view connections as
select a.wallet as viewer, b.wallet as peer,
       (a.checked_in and b.checked_in) as strong
from attendance a
join attendance b on a.event_pda = b.event_pda and a.wallet <> b.wallet;

alter table events enable row level security;
alter table auth_nonces enable row level security;
alter table attendance enable row level security;
-- No policies on purpose: only the service role (server) can access these tables.
revoke all on connections from anon, authenticated;
