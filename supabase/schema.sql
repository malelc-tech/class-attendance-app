-- =====================================================================
-- CLASS ATTENDANCE APP — DATABASE SCHEMA
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- =====================================================================

-- ---------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type user_role as enum ('student', 'teacher', 'admin');
create type attendance_status as enum ('present', 'late', 'rejected');
create type class_status as enum ('scheduled', 'active', 'closed');

-- ---------------------------------------------------------------------
-- USERS
-- Mirrors auth.users (1:1). Row is created automatically via trigger
-- on signup (see handle_new_user() below).
-- ---------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role user_role not null default 'student',
  student_id text unique,              -- school-issued ID, students only
  device_fingerprint text,             -- device this student is permanently locked to (anti-proxy)
  created_at timestamptz not null default now()
);

-- One physical device can only ever be bound to one student account.
-- Ignores NULLs (students who haven't checked in yet), enforced at the
-- DB level as a backstop to the same check already done in application
-- code (src/app/api/attendance/check-in/route.ts).
create unique index idx_users_device_fingerprint_unique
  on public.users (device_fingerprint)
  where device_fingerprint is not null;

-- ---------------------------------------------------------------------
-- COURSES
-- ---------------------------------------------------------------------
create table public.courses (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,           -- e.g. "CS101"
  title text not null,
  teacher_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- CLASSES (individual sessions / meetings of a course)
-- ---------------------------------------------------------------------
create table public.classes (
  id uuid primary key default uuid_generate_v4(),
  course_id uuid not null references public.courses (id) on delete cascade,
  teacher_id uuid not null references public.users (id) on delete cascade,
  title text not null,                          -- e.g. "Lecture 5 - Arrays"
  status class_status not null default 'scheduled',
  latitude double precision not null,            -- classroom GPS anchor
  longitude double precision not null,
  allowed_radius_meters integer not null default 60,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  qr_secret text not null default encode(gen_random_bytes(32), 'hex'),
  -- ^ per-class secret used to HMAC-sign rotating QR tokens server-side
  late_after_minutes integer not null default 10,
  -- When the teacher starts the end-of-class "closing check-in" window
  -- (see attendance_logs.closing_scanned_at below). Null = not started
  -- yet. This is the lightweight alternative to continuous GPS
  -- tracking: instead of trying to monitor location throughout class
  -- (which browsers block once a tab is backgrounded anyway), students
  -- rescan the same QR near the end; anyone who checked in at the
  -- start but never rescans is flagged as possibly having left early.
  closing_window_started_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_classes_course on public.classes (course_id);
create index idx_classes_status on public.classes (status);

-- ---------------------------------------------------------------------
-- COURSE ENROLLMENTS (which students belong to which course)
-- Needed so the teacher's live session page can show a "not yet
-- checked in" list — without this, the app has no concept of who's
-- actually expected to be in a given class.
-- ---------------------------------------------------------------------
create table public.course_enrollments (
  course_id uuid not null references public.courses (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (course_id, student_id)
);

create index idx_enrollments_course on public.course_enrollments (course_id);
create index idx_enrollments_student on public.course_enrollments (student_id);

-- ---------------------------------------------------------------------
-- ATTENDANCE LOGS
-- ---------------------------------------------------------------------
create table public.attendance_logs (
  id uuid primary key default uuid_generate_v4(),
  class_id uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  status attendance_status not null default 'present',
  scanned_at timestamptz not null default now(),
  latitude double precision not null,
  longitude double precision not null,
  distance_meters numeric(8, 2) not null,
  device_fingerprint text not null,
  qr_token_used text not null,        -- token value at scan time (audit trail)
  ip_address text,
  is_manual boolean not null default false, -- true = teacher marked present manually (no phone)
  closing_scanned_at timestamptz,     -- set when student rescans during the closing window (null = never rescanned / may have left early)
  unique (class_id, student_id)       -- one check-in per student per class
);

create index idx_attendance_class on public.attendance_logs (class_id);
create index idx_attendance_student on public.attendance_logs (student_id);

-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- Auto-create a public.users row whenever a new auth.users row appears.
-- Role defaults to 'student'; promote via the admin dashboard.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'student')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.users enable row level security;
alter table public.courses enable row level security;
alter table public.classes enable row level security;
alter table public.attendance_logs enable row level security;

-- Helper: fetch the caller's role without recursive RLS lookups.
create or replace function public.current_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

-- ---------------- USERS ----------------
create policy "Users can view their own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Admins can view all users"
  on public.users for select
  using (public.current_role() = 'admin');

create policy "Teachers can view their students' basic info"
  on public.users for select
  using (
    public.current_role() = 'teacher'
    and role = 'student'
  );

create policy "Users can update their own profile"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = (select role from public.users where id = auth.uid()));
  -- students/teachers cannot self-promote their own role

create policy "Admins can update any user"
  on public.users for update
  using (public.current_role() = 'admin');

-- ---------------- COURSES ----------------
create policy "Anyone authenticated can view courses"
  on public.courses for select
  using (auth.role() = 'authenticated');

create policy "Teachers manage their own courses"
  on public.courses for all
  using (teacher_id = auth.uid() or public.current_role() = 'admin')
  with check (teacher_id = auth.uid() or public.current_role() = 'admin');

-- ---------------- CLASSES ----------------
create policy "Anyone authenticated can view classes"
  on public.classes for select
  using (auth.role() = 'authenticated');

create policy "Teachers manage their own class sessions"
  on public.classes for all
  using (teacher_id = auth.uid() or public.current_role() = 'admin')
  with check (teacher_id = auth.uid() or public.current_role() = 'admin');

-- ---------------- COURSE ENROLLMENTS ----------------
alter table public.course_enrollments enable row level security;

create policy "Students view their own enrollments"
  on public.course_enrollments for select
  using (student_id = auth.uid());

create policy "Teachers view enrollments for their own courses"
  on public.course_enrollments for select
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.teacher_id = auth.uid()
    )
    or public.current_role() = 'admin'
  );

create policy "Teachers manage enrollments for their own courses"
  on public.course_enrollments for all
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.teacher_id = auth.uid()
    )
    or public.current_role() = 'admin'
  )
  with check (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.teacher_id = auth.uid()
    )
    or public.current_role() = 'admin'
  );

-- ---------------- ATTENDANCE LOGS ----------------
create policy "Students view their own attendance"
  on public.attendance_logs for select
  using (student_id = auth.uid());

create policy "Teachers view attendance for their own classes"
  on public.attendance_logs for select
  using (
    exists (
      select 1 from public.classes c
      where c.id = class_id and c.teacher_id = auth.uid()
    )
  );

create policy "Admins view all attendance"
  on public.attendance_logs for select
  using (public.current_role() = 'admin');

-- Students insert their own attendance row (actual validation of
-- geolocation/token happens server-side in the API route using the
-- service role key — this policy is a defense-in-depth backstop).
create policy "Students insert their own attendance"
  on public.attendance_logs for insert
  with check (student_id = auth.uid());

-- =====================================================================
-- REALTIME
-- Enable realtime on attendance_logs so the teacher's session page
-- gets live INSERT events via Supabase Realtime.
-- =====================================================================
alter publication supabase_realtime add table public.attendance_logs;
