-- Manawib shared database: public read, approved-editor writes.
-- Run once in Supabase Dashboard > SQL Editor.
-- Create editor accounts in Authentication > Users, then add their lowercase emails
-- to public.manawib_editors. The website intentionally has no public sign-up form.

create table if not exists public.employees (
  id text primary key,
  name text not null,
  number text not null,
  phone text not null default '',
  start_date date not null,
  leave_balance numeric(7,2) not null default 30,
  leave_used jsonb not null default '{}'::jsonb,
  credit_years jsonb not null default '[]'::jsonb,
  accrual_anchor date,
  updated_at timestamptz not null default now()
);

create unique index if not exists employees_number_lower_unique
  on public.employees (lower(number));

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
alter table public.holidays enable row level security;
alter table public.manawib_editors enable row level security;

-- The allowlist is only readable inside the privileged function below.
revoke all on table public.manawib_editors from public, anon, authenticated;

create or replace function public.can_edit_manawib()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.manawib_editors e
    where e.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.can_edit_manawib() from public, anon, authenticated;
grant execute on function public.can_edit_manawib() to authenticated;

revoke all on table public.employees from anon, authenticated;
revoke all on table public.holidays from anon, authenticated;
grant select on table public.employees, public.holidays to anon, authenticated;
grant insert, update, delete on table public.employees, public.holidays to authenticated;

drop policy if exists "Anyone can view employees" on public.employees;
drop policy if exists "Editors can manage employees" on public.employees;
drop policy if exists "Signed-in team can manage employees" on public.employees;
create policy "Anyone can view employees"
  on public.employees for select to anon, authenticated
  using (true);
create policy "Editors can manage employees"
  on public.employees for all to authenticated
  using (public.can_edit_manawib())
  with check (public.can_edit_manawib());

drop policy if exists "Anyone can view holidays" on public.holidays;
drop policy if exists "Editors can manage holidays" on public.holidays;
drop policy if exists "Signed-in team can manage holidays" on public.holidays;
create policy "Anyone can view holidays"
  on public.holidays for select to anon, authenticated
  using (true);
create policy "Editors can manage holidays"
  on public.holidays for all to authenticated
  using (public.can_edit_manawib())
  with check (public.can_edit_manawib());

-- Example editor entry; replace the value with the editor's lowercase email:
-- insert into public.manawib_editors(email) values (lower('editor@example.com'))
-- on conflict (email) do nothing;
