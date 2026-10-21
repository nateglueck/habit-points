-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Every table is scoped to its owner by row level security, so each signed-in
-- person only ever reads and writes their own rows.

create table public.habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  points      int  not null check (points between 1 and 100),
  -- Can be completed up to max_count times per calendar day, week (Mon-Sun) or month.
  max_count   int  not null default 1 check (max_count between 1 and 50),
  period      text not null default 'day' check (period in ('day', 'week', 'month')),
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.completions (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  -- Habits are archived, never deleted, so history keeps its names.
  habit_id  uuid not null references public.habits on delete restrict,
  -- Copied from the habit so changing a habit's value doesn't rewrite history.
  points    int  not null check (points > 0),
  -- The person's local calendar day; the habit's period limit counts against it.
  day       date not null,
  earned_at timestamptz not null default now()
);

create table public.spends (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  points   int  not null check (points > 0),
  euros    int  not null check (euros > 0),
  note     text check (char_length(note) <= 120),
  spent_at timestamptz not null default now()
);

create index on public.habits (user_id);
create index on public.completions (user_id, earned_at);
create index on public.spends (user_id, spent_at);

-- Newer Supabase projects don't expose new tables to the API automatically.
-- Signed-in users get table access; the policies below narrow it to their own rows.
grant select, insert, update, delete on public.habits, public.completions, public.spends to authenticated;

alter table public.habits      enable row level security;
alter table public.completions enable row level security;
alter table public.spends      enable row level security;

create policy "own habits" on public.habits for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own completions" on public.completions for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.habits h where h.id = habit_id and h.user_id = auth.uid())
  );

create policy "own spends" on public.spends for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
