-- The Data API requires table grants even for a role that bypasses RLS.
grant usage on schema public to service_role;
grant select, insert on table public.events to service_role;
grant select, insert, update, delete on table public.auth_nonces to service_role;
grant select, insert, update on table public.attendance, public.vendors, public.sponsorship_offers to service_role;
grant select on table public.connections to service_role;
