-- Atomic account creation and consent granting.
--
-- Both run as SECURITY DEFINER because they write across tables that RLS
-- protects. A profile without a family, or a family without constraints, is a
-- broken account — so the three inserts must succeed or fail together.

-- ------------------------------------------------------------------
-- create_family_account
-- ------------------------------------------------------------------
create or replace function create_family_account(
  p_user_id   uuid,
  p_full_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid;
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'no such auth user: %', p_user_id using errcode = 'foreign_key_violation';
  end if;

  if exists (select 1 from profiles where id = p_user_id) then
    raise exception 'profile already exists for user %', p_user_id using errcode = 'unique_violation';
  end if;

  insert into families default values returning id into v_family;
  insert into profiles (id, family_id, full_name) values (p_user_id, v_family, p_full_name);
  insert into family_constraints (family_id) values (v_family);

  return v_family;
end;
$$;

-- ------------------------------------------------------------------
-- grant_child_consent
-- ------------------------------------------------------------------
-- family_id is derived from the child rather than accepted from the caller.
-- The consent policy checks for a family mismatch; this makes one impossible
-- to create in the first place.
create or replace function grant_child_consent(
  p_child_id   uuid,
  p_granted_by uuid,
  p_method     text,
  p_purposes   text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family  uuid;
  v_consent uuid;
begin
  select family_id into v_family from children where id = p_child_id;
  if v_family is null then
    raise exception 'no such child: %', p_child_id using errcode = 'foreign_key_violation';
  end if;

  -- The granting adult must belong to the child's own family.
  if not exists (
    select 1 from profiles where id = p_granted_by and family_id = v_family
  ) then
    raise exception 'granting user % is not in the child''s family', p_granted_by
      using errcode = 'insufficient_privilege';
  end if;

  if array_length(p_purposes, 1) is null then
    raise exception 'at least one purpose is required' using errcode = 'check_violation';
  end if;

  insert into consents (family_id, child_id, granted_by, method, purposes, verified_at)
  values (v_family, p_child_id, p_granted_by, p_method, p_purposes, now())
  returning id into v_consent;

  return v_consent;
end;
$$;

-- ------------------------------------------------------------------
-- revoke_child_consent
-- ------------------------------------------------------------------
create or replace function revoke_child_consent(p_consent_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update consents set revoked_at = now()
  where id = p_consent_id and revoked_at is null;
$$;

revoke all on function create_family_account(uuid, text) from public;
revoke all on function grant_child_consent(uuid, uuid, text, text[]) from public;
revoke all on function revoke_child_consent(uuid) from public;

grant execute on function create_family_account(uuid, text) to service_role;
grant execute on function grant_child_consent(uuid, uuid, text, text[]) to service_role;
grant execute on function revoke_child_consent(uuid) to service_role;
