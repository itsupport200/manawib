-- Manawib: public employee-name directory, private employee records,
-- employee-specific access codes, and allowlisted administrator access.
-- Run in Supabase Dashboard > SQL Editor. Safe to re-run for this schema.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- The public directory deliberately contains names only.
create table if not exists public.employees (
  id text primary key,
  name text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_private (
  id text primary key references public.employees(id) on delete cascade,
  number text not null,
  phone text not null default '',
  start_date date not null,
  leave_balance numeric(7,2) not null default 30,
  leave_used jsonb not null default '{}'::jsonb,
  credit_years jsonb not null default '[]'::jsonb,
  accrual_anchor date,
  access_code_hash text,
  has_access_code boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Migrate private columns from the previous employees table if present.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees' and column_name = 'number'
  ) then
    execute $migration$
      insert into public.employee_private
        (id, number, phone, start_date, leave_balance, leave_used, credit_years, accrual_anchor)
      select id, number, coalesce(phone, ''), start_date, coalesce(leave_balance, 30),
             coalesce(leave_used, '{}'::jsonb), coalesce(credit_years, '[]'::jsonb), accrual_anchor
      from public.employees
      on conflict (id) do nothing
    $migration$;
  end if;
end;
$$;

-- Older deployments have private columns here. Keep the values intact, but the
-- API grants below expose only id and name. New directory-only inserts need
-- nullable legacy fields while private values are written to employee_private.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees' and column_name = 'number'
  ) then
    execute 'alter table public.employees alter column number drop not null';
    execute 'alter table public.employees alter column start_date drop not null';
  end if;
end;
$$;

create unique index if not exists employee_private_number_lower_unique
  on public.employee_private (lower(number));

create table if not exists public.holidays (
  id text primary key,
  name text not null,
  start_date date not null,
  end_date date not null,
  source text not null default '',
  updated_at timestamptz not null default now(),
  constraint holidays_valid_date_range check (end_date >= start_date)
);

create table if not exists public.manawib_editors (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

alter table public.employees enable row level security;
alter table public.employee_private enable row level security;
alter table public.holidays enable row level security;
alter table public.manawib_editors enable row level security;

revoke all on table public.manawib_editors from public, anon, authenticated;

create or replace function public.can_edit_manawib()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.manawib_editors e
    where e.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.can_edit_manawib() from public, anon, authenticated;
grant execute on function public.can_edit_manawib() to authenticated;

-- Remove previous grants and policies before applying the restricted model.
revoke all on table public.employees from public, anon, authenticated;
revoke all on table public.employee_private from public, anon, authenticated;
revoke all on table public.holidays from public, anon, authenticated;
grant select (id, name) on public.employees to anon, authenticated;
grant insert, update, delete on public.employees to authenticated;
grant select (id, number, phone, start_date, leave_balance, leave_used, credit_years,
              accrual_anchor, has_access_code, updated_at)
  on public.employee_private to authenticated;
grant insert (id, number, phone, start_date, leave_balance, leave_used, credit_years,
              accrual_anchor, updated_at)
  on public.employee_private to authenticated;
grant update (id, number, phone, start_date, leave_balance, leave_used, credit_years,
              accrual_anchor, updated_at)
  on public.employee_private to authenticated;
grant delete on public.employee_private to authenticated;
grant select on public.holidays to anon, authenticated;
grant insert, update, delete on public.holidays to authenticated;

drop policy if exists "Anyone can view employees" on public.employees;
drop policy if exists "Anyone can view employee names" on public.employees;
drop policy if exists "Editors can manage employees" on public.employees;
drop policy if exists "Signed-in team can manage employees" on public.employees;
drop policy if exists "Editors can manage employee directory" on public.employees;
create policy "Anyone can view employee names"
  on public.employees for select to anon, authenticated using (true);
create policy "Editors can manage employee directory"
  on public.employees for all to authenticated
  using (public.can_edit_manawib()) with check (public.can_edit_manawib());

drop policy if exists "Editors can manage private employee records" on public.employee_private;
create policy "Editors can manage private employee records"
  on public.employee_private for all to authenticated
  using (public.can_edit_manawib()) with check (public.can_edit_manawib());

drop policy if exists "Anyone can view holidays" on public.holidays;
drop policy if exists "Editors can manage holidays" on public.holidays;
drop policy if exists "Signed-in team can manage holidays" on public.holidays;
create policy "Anyone can view holidays"
  on public.holidays for select to anon, authenticated using (true);
create policy "Editors can manage holidays"
  on public.holidays for all to authenticated
  using (public.can_edit_manawib()) with check (public.can_edit_manawib());

-- Employee codes are verified by Postgres; only that employee's record is returned.
create or replace function public.verify_employee_access_code(
  p_employee_id text,
  p_access_code text
)
returns table (
  id text,
  name text,
  number text,
  phone text,
  start_date date,
  leave_balance numeric,
  leave_used jsonb,
  credit_years jsonb,
  accrual_anchor date
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.name, p.number, p.phone, p.start_date, p.leave_balance,
         p.leave_used, p.credit_years, p.accrual_anchor
  from public.employee_private p
  join public.employees e on e.id = p.id
  where p.id = p_employee_id
    and p.has_access_code
    and p.access_code_hash is not null
    and p.access_code_hash = extensions.crypt(upper(trim(coalesce(p_access_code, ''))), p.access_code_hash);
$$;
revoke all on function public.verify_employee_access_code(text, text) from public;
grant execute on function public.verify_employee_access_code(text, text) to anon, authenticated;

-- Admins supply a one-time generated code. Only its bcrypt hash is persisted.
create or replace function public.set_employee_access_code(
  p_employee_id text,
  p_access_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_manawib() then
    raise exception 'not authorized';
  end if;
  if p_access_code is null or upper(trim(p_access_code)) !~ '^[A-HJ-NP-Z2-9]{16}$' then
    raise exception 'invalid access code format';
  end if;
  update public.employee_private
     set access_code_hash = extensions.crypt(upper(trim(p_access_code)), extensions.gen_salt('bf', 12)),
         has_access_code = true,
         updated_at = now()
   where id = p_employee_id;
  if not found then
    raise exception 'employee record not found';
  end if;
  return true;
end;
$$;
revoke all on function public.set_employee_access_code(text, text) from public, anon;
grant execute on function public.set_employee_access_code(text, text) to authenticated;

-- Example: authorize an administrator using their lowercase Supabase email.
-- insert into public.manawib_editors(email) values (lower('admin@example.com'))
-- on conflict (email) do nothing;
