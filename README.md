# Class Attendance App

QR + GPS based class attendance system built with Next.js (App Router),
Tailwind CSS, and Supabase (Postgres + Auth + Realtime).

## Stack

- **Next.js 14** (App Router, Server Components + Route Handlers)
- **Tailwind CSS** for styling
- **Supabase**: Postgres database, Auth, Row Level Security, Realtime
- **html5-qrcode** for in-browser camera QR scanning (student side)
- **react-qr-code** for rendering the rotating QR (teacher side)

## Project structure

```
src/
  app/
    login/page.tsx                         # Sign in
    unauthorized/page.tsx                  # Role mismatch fallback
    teacher/
      dashboard/page.tsx                   # Start a class session (captures GPS anchor)
      session/[id]/page.tsx                # Dynamic QR + realtime attendance feed
    student/
      check-in/page.tsx                    # Camera scanner + geolocation check-in
      history/page.tsx                     # Past attendance
    admin/
      dashboard/page.tsx                   # User role management + analytics
    api/
      qr-token/[classId]/route.ts          # Returns current rotating QR token (teacher-only)
      attendance/check-in/route.ts         # Validates + records a check-in (core security)
      attendance/export/[classId]/route.ts # CSV export
  lib/
    supabase/
      client.ts                            # Browser client
      server.ts                            # Server client + service-role client
      middleware.ts                        # Session refresh + route protection
      types.ts                             # Hand-written DB types
    utils/
      geolocation.ts                       # Haversine distance
      device-session.ts                    # localStorage device token
      qr-token.ts                          # HMAC-signed rotating token sign/verify
middleware.ts                              # Wires up lib/supabase/middleware.ts
supabase/schema.sql                        # Tables, enums, RLS policies, triggers
```

## Setup

1. **Create a Supabase project**, then run `supabase/schema.sql` in the SQL editor
   (or `supabase db push` if you're using the CLI locally).

2. **Environment variables** — copy `.env.example` to `.env.local` and fill in
   your project URL, anon key, and service role key from
   Project Settings → API.

3. **Install & run**

   ```bash
   npm install
   npm run dev
   ```

4. **Create your first users.** Sign up through Supabase Auth (or the
   `/login` page after inserting a test user), then promote a user to
   `teacher` or `admin` via the `admin/dashboard` page or directly in
   the `users` table — new signups default to `student`.

5. **Create a course row** (via SQL editor or a small admin form you can
   add) linking a `teacher_id` before that teacher can start a session.

## How the anti-proxy layers work together

| Layer | What it stops | What it doesn't stop |
|---|---|---|
| **Rotating QR token** (HMAC, 10s window, server-signed) | Screenshotting a code and sending it to a friend later; sharing a static code | Someone standing next to you scanning it live within the window |
| **GPS radius check** | Checking in from off-campus or another building | Spoofed GPS on a rooted/jailbroken device (no browser-only fix is airtight) |
| **Device fingerprint (localStorage)** | Casual "pass the phone around" sharing; gives teachers an audit signal | Determined users clearing storage or using multiple devices |

None of these is bulletproof alone — that's why they're layered. The
`deviceReuseWarning` flag returned from check-in surfaces suspicious
patterns to the teacher rather than silently blocking, since shared
devices sometimes have legitimate explanations.

## Security notes

- All attendance validation (QR token, GPS distance, duplicate check)
  happens **server-side** in `api/attendance/check-in/route.ts` using
  the service-role client — the client only supplies raw scan data,
  never a "yes this is valid" flag.
- `qr_secret` per class never leaves the server; only the derived,
  time-limited token is sent to the browser.
- RLS policies in `schema.sql` are a defense-in-depth backstop in case
  a client ever talks to Supabase directly with the anon key.
- Row uniqueness on `(class_id, student_id)` in `attendance_logs`
  prevents duplicate check-ins at the database level, not just in
  application code.

## Extending this

- Add a `courses` management UI for admins (currently SQL-only).
- Add push/email notifications on absence.
- Add a `class_status` cron/Edge Function to auto-close sessions after
  `ends_at`.
- Swap the hand-written `types.ts` for generated types once your
  schema stabilizes: `npx supabase gen types typescript`.
