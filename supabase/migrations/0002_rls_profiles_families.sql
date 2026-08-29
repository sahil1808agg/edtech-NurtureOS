-- Fix: profiles and families were created without RLS, so any authenticated
-- user could read every family's rows. Found by scripts/test-rls.mjs.
--
-- current_family_id() and is_ops() are SECURITY DEFINER, so they bypass RLS
-- when reading profiles. That is what stops the profiles policy recursing
-- into itself.

alter table profiles enable row level security;
alter table families enable row level security;

-- A parent sees profiles in their own family — co-parents included — and ops
-- sees all. Nobody else.
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select
  using (family_id = current_family_id() or is_ops());

-- A user may only edit their own profile row.
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists families_read on families;
create policy families_read on families for select
  using (id = current_family_id() or is_ops());

-- Inserts into profiles and families happen during signup via the service
-- role, which bypasses RLS. No insert policy for authenticated users is
-- needed, and adding one would let a user attach themselves to any family.
