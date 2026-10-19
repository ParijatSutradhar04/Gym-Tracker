# Gym Tracker — design

Status: approved 2026-10-19, not yet planned/implemented. Next step: an
implementation plan in `docs/superpowers/plans/`.

## Context

A personal workout logger, designed by the owner in Figma. Design inputs
live in this repo and are the visual source of truth unless this document
says otherwise (Section 9 lists the deliberate deviations):

- `design/guideline.md` — the original UX spec.
- `design/Gym Tracker · *.png` — seven frames: Active workout, Empty
  schedule, Recurrence selector, Exercise sets, Gym Missed, CSV export,
  Desktop workout.
- `style.css` — Figma "Copy as CSS (all layers)" export. Not valid CSS
  (no selectors, absolute sizes). Use only as a token source: grep it for
  layer-name comments (`/* Exercise tile */`, `/* CSV export sheet */` …)
  to lift exact colors, type sizes, radii and spacing.

The technical setup mirrors the owner's other project,
`../Financial_Tracker` (read it for conventions): an Expo app in `app/`
that ships to Android via EAS and to the web via Vercel, a FastAPI backend
in `api/` on Vercel, Supabase Postgres + Supabase Auth, schema in
`supabase/init.sql` plus numbered `migrations/`.

### How it gets used

The owner walks into the gym, opens the app on an Android phone, and sees
today's routine (e.g. "Chest & Tricep") and its exercises. Tapping an
exercise opens a sheet pre-filled with last session's sets; they adjust
reps/kg between sets with tired hands. If they miss a day, one button
either shifts the plan forward or skips the day. Occasionally they export a
CSV and hand it to an AI agent to analyse their training. On a PC they use
the website for a bigger, multi-column view of the same data.

## Goals

- **Fast logging on the gym floor.** Big touch targets, inline edits, no
  spinners between sets. Every tap saves instantly.
- **Works with no signal in the phone app.** Gym connectivity is poor.
- **A plan that keeps itself.** Routines repeat on their own; a missed day
  is handled in one tap without re-entering anything.
- **One log across phone and PC.**
- **Export that an AI agent can analyse without explanation.**

## Non-goals

- Multi-user now. It's for the owner only. *But* every owned table carries
  `user_id` from day one so multi-user is a sign-up screen and query
  filters later, not a migration (lesson from Financial Tracker's
  multi-user design doc).
- Social features, sharing, search, exercise libraries, charts/analytics
  in-app (analysis happens outside via CSV).
- iOS builds. Android app + website only.
- Offline support on the website.
- Importing CSV back in. The database is the backup; CSV is a copy out.
- Importing existing workout history. The app starts fresh (owner
  confirmed); no seed data.
- Reordering exercises (new ones append to the end).
- Units other than kg.

## Anti-goals (would make it a failure even if it "works")

- A save spinner or blocking network call while logging a set.
- Losing a logged set because the phone had no signal or the screen
  locked.
- The schedule changing behind the owner's back (auto-marking days missed,
  auto-shifting, or an edit on one day silently rewriting earlier days).
- A mis-tap on Skip/Shift that can't be undone.

## Constraints

- **Stack (owner's decision):** follow Financial Tracker's current stack:
  Expo SDK 57 / React Native + NativeWind, `react-native-web` for the web
  build, FastAPI (Python) on Vercel, Supabase Postgres + Auth. Per
  Financial Tracker's `app/AGENTS.md`, read the versioned Expo docs before
  writing Expo code and install Expo packages with `npx expo install`.
- **Repo layout (owner's decision):** `app/`, `api/`, `supabase/`,
  `migrations/`, `docs/superpowers/{specs,plans}/`, `scripts/`.
- **Hosting (owner's decision):** all new projects under the owner's
  existing accounts: GitHub repo `Gym-Tracker`, Vercel project
  `gym-tracker`, Expo project `gym-tracker` (owner
  `parijatsutradhars-team`), Android package `com.parijat.gymtracker`, a
  new separate Supabase project. EAS build profiles and EAS Update as in
  Financial Tracker.
- **Login is cached (owner's decision):** sign in once; the session
  persists on both app and website.
- **`user_id` on every owned row (owner's decision).**
- **Fonts:** Inter (UI) and Roboto Mono (numbers, dates, counts), as in
  the designs.
- **"Today" is the device's local calendar date.**

## 1. Concepts

- **Routine** — a named workout (e.g. "Chest & Tricep") with an ordered
  exercise list and a repeat rule, starting on a date. Routines change over
  time; each change takes effect from a given date onward (see Section 2),
  so a routine is a series of dated versions.
- **Day** — a calendar date. A day shows at most one routine. A day may
  have a status: `missed` (via Shift Day) or `skipped`.
- **Day log** — what was actually done on a date: that day's exercise list
  and logged sets (reps, kg). Once a day has a log, its exercise list
  belongs to that day and no longer follows the routine. A day log is
  created lazily on the first write for that date (first set saved, or a
  past-day exercise edit), not on merely opening the day. A day without a
  log renders from the routine version effective on that date. Since
  routine edits only ever take effect from today forward, unlogged past
  days keep showing what was planned then (*my call*).
- **Set** — set number, reps (whole number), weight in kg (decimals
  allowed, e.g. 2.5, 22.5; blank = bodyweight).

## 2. Schedule rules

### Repeat rules (owner-confirmed)

From the routine's start date S:

| Option | Lands on |
|---|---|
| Once a week | S, S+7, S+14 … |
| Twice a week | S's weekday and the weekday 3 days later, every week (Mon start → Mon + Thu; Sat start → Sat + Tue) |
| Once every 2 weeks | S, S+14, S+28 … |
| Never | S only |

The recurrence sheet shows "‹Routine› · Starts ‹date›" (as in the design).

### Clashes (owner-confirmed)

A day shows one routine. If two routines land on the same day, the routine
that already had that day keeps it (the earlier-created routine wins) and
the other skips that occurrence. Before saving a repeat rule that would
lose days to a clash, the sheet warns, e.g. "Mondays are taken by Chest &
Tricep."

### Edits carry forward from the day you make them (owner-confirmed)

On **today or a future date**, these all take effect from that date onward
and never affect earlier dates:

- Add Schedule (creates a routine starting that date).
- Change: title and/or repeat rule. Changing the repeat rule re-anchors it:
  the chosen date becomes the new start date S.
- Adding, renaming, deleting an exercise.

Example: today is Oct 19; Chest & Tricep repeats Mondays. On Mon Nov 2 the
owner renames it "Push" and sets Twice a week. Oct 19 and Oct 26 stay Chest
& Tricep; from Nov 2 it's Push on Mondays and Thursdays.

Today's exercise edits also update today's day log. Past day logs are never
touched by routine edits: deleting Cable fly today does not remove last
week's Cable fly sets.

Ending a routine: the Change sheet offers "Stop this routine from ‹date›",
which ends it from that date on (*my call*; the owner didn't specify how a
routine is removed). Removing a single future occurrence without ending the
routine is not supported. Skip on the day covers that.

### Reusing a routine (owner-confirmed)

When typing a title in Add Schedule, previously used routine titles appear
as suggestions. Picking one copies that routine's current exercise list as
the starting list; the new routine is independent from then on.

### Past days (owner-confirmed)

- A past day is a correctable log: edit reps/kg, add/remove sets, add,
  rename or delete exercises. These affect only that day and never touch the
  routine.
- Schedule controls (Add Schedule, Change, repeat) and Gym Missed are not
  available on past days. The routine title is read-only, with a
  Missed/Skipped badge if applicable.
- **Backfill:** an empty past day offers "Log a workout": give it a title,
  add exercises and sets. It is a one-off for that date (repeat = Never).
- **Nothing is automatic:** a scheduled past day that was never opened just
  looks unlogged (exercises listed, no sets). It is never auto-marked
  missed or auto-shifted.

### Future days

Schedule controls and exercise edits are available (carry forward, above).
Logging sets is not (*my call*): the sets sheet is read-only on future
days. Gym Missed is today-only.

### Gym Missed (owner-confirmed)

Available only on today, when today has a routine, no status yet, and no
sets logged today (if you've logged a set, you didn't miss the gym; deleting
all of today's sets brings the button back; *my call*). Opens
the "Missed the gym?" dialog with two cards:

- **Skip** (one tap): marks today `skipped`. Nothing else moves.
- **Shift Day** → second step in the same dialog (the card's → arrow) with
  two choices, a back arrow and a "Shift" confirm button:
  1. **Catch up this week**: listed first, selected by default.
  2. **Move my split for good.**

  Each choice previews what will move using real routine names, e.g.
  "Arms moves to Sat. Back to your usual days next Monday." vs. "Chest &
  Tricep moves to Tuesdays from now on."

In both shift modes, today is marked `missed` and today's routine moves to
tomorrow.

**Catch up (option B):** take the run of consecutive scheduled days starting
today up to (not including) the first rest day — a day with no routine
— after today. Each routine in that run moves forward one day; the
rest day absorbs the last one. Nothing after that rest day changes; next
week is back to the usual weekdays.

Example: Mon Chest, Tue Back, Wed Legs, Thu Shoulders, Fri Arms, weekend
rest. Miss Monday → Tue Chest, Wed Back, Thu Legs, Fri Shoulders, Sat Arms;
next Monday is Chest.

If there is no rest day within the next 7 days, catch up behaves exactly
like option A.

A catch-up shift is a set of one-off moves ("Arms: Fri → Sat"), not a
change to any routine's repeat rule; store it as per-date overrides. Edits
on a moved occurrence follow the normal edit-forward rule from the date
it now sits on (*my call*): an exercise edit on the moved Sat carries
forward from Sat; changing the repeat rule on Sat re-anchors the routine
to Sat, as it would on any date.

**Permanent (option A):** every routine occurrence from today onward moves
one day later, permanently: weekly anchors move a weekday later (Chest on
Tuesdays from now on). Implementable as a new version of each active routine
effective tomorrow with its start date moved +1 day.

### Undo (owner-confirmed)

- After Skip or Shift, a bottom bar shows "Today skipped · Undo" /
  "Routine shifted · Undo" for ~6 seconds.
- After that, today's card shows the Missed/Skipped badge with a "Restore"
  action, which fully reverts the action (including every moved routine)
  until the end of that day.
- Restore (and Undo) stop being offered once any schedule edit is made
  after the shift (Add Schedule, Change, exercise add/rename/delete on
  today or a future date), so a restore never has to untangle later edits.
  Logging sets doesn't count as a schedule edit (*my call*).
- After the day ends, it's history and can't be restored.

## 3. Screens (mobile, 390×844 reference)

Visual layout follows the PNGs except where Section 9 says otherwise.

- **Top bar:** CSV export icon button (left), "Gym Tracker" title, dumbbell
  mark (right). An "unsynced changes" dot appears here in the app when the
  outbox is non-empty (Section 5).
- **Date bar:** horizontal scrolling date cards in chronological order left
  → right (past ← today → future). On open, today is scrolled to the
  left edge, so today and upcoming days are visible; scrolling left reveals
  the past. Range: back to the first day with data, forward ~12 weeks (*my
  call*). Month label tracks the visible dates. Selected date uses the
  accent fill; today is labelled "TODAY".
- **Schedule banner:**
  - Empty (today/future): "+ Add Schedule" (Empty schedule PNG, with its
    "Make room for progress." empty state).
  - Empty (past): "Log a workout" (backfill).
  - Set: routine title, "Change" button, repeat control (e.g. "↻ Once a
    week ⌄").
- **Add/Change sheet:** title field (with suggestions on Add), the four
  repeat options as in the Recurrence selector PNG, clash warning, "Save",
  and on Change "Stop this routine from ‹date›".
- **Exercises:** heading with count ("04 exercises / 12 sets"); tiles with
  name, set summary in Roboto Mono, pencil (inline rename) and × (delete);
  quick-add row at the bottom: "+ Type exercise name…", Enter adds. Hidden
  when the day has no routine.
- **Sets sheet** (Exercise sets PNG): routine name eyebrow, exercise name,
  close ×, set rows (Set N · reps · kg · delete), "+ Add Set", "Done".
  - First time this exercise name is ever logged: 3 empty rows.
  - Otherwise: as many rows as the last session for that exercise name,
    pre-filled with last session's reps and kg. "Last session" = the most
    recent earlier date with logged sets for an exercise of the same name,
    case-insensitive and trimmed, across all routines (owner-confirmed).
  - **Done** saves all rows as shown (two taps if matching last week).
  - **×** closes; typed values are kept, untouched pre-filled values are
    not saved (peeking doesn't log).
  - Every typed value saves immediately (no data lost if the phone locks).
  - Renaming an exercise starts fresh pre-fill history for the new name
    (*my call*; simple name matching).
- **Tile summary** (*my call*): "N sets · R reps · W kg", using the
  heaviest logged set's reps and kg; "N sets" only if nothing is logged.
- **Gym Missed** FAB at bottom-right: today only, as in Section 2.
- **CSV export sheet** (CSV export PNG): Last Month, Last 3 Months, Custom
  (expands From/To date pickers), "Download CSV".
- **Login:** email + password sign-in only (no sign-up screen yet; the
  owner's user is created in the Supabase dashboard), styled with the app's
  palette (*my call*; no PNG exists). Session persists.

### Desktop (Desktop workout PNG)

Two columns. Left: date bar, schedule banner, exercise list. Right: a stats
card and the sets panel, inline instead of a sheet, for the selected
exercise, plus a line like "↻ Repeats every Sunday · Next up: October 25".
"Gym Missed" sits top-right. Same rules as mobile. Changes from the PNG:

- Date bar direction flipped (Section 9).
- The sets panel gets a "Done" button, so "Done saves what's shown" works on
  desktop too (*my call*).
- The stats card's "Focus: Push" is replaced by **Volume** (total kg × reps
  logged on the selected day). Nothing in the app defines "focus" (*my
  call*).

## 4. CSV export (owner delegated the format)

Purpose: the owner downloads it and gives it to an AI agent for analysis, so
it's a tidy, self-describing, one-row-per-observation file.

- One row per logged set. Columns, in order:
  `date, weekday, routine, exercise, set_number, reps, weight_kg, volume_kg, status`
- `date` is ISO `YYYY-MM-DD`; `weekday` is `Mon`…`Sun`.
- `weight_kg` blank = bodyweight; `volume_kg` = reps × weight_kg (blank if
  bodyweight).
- `status`: `logged` for set rows. Days with no sets also get one row with
  empty exercise columns: `missed`, `skipped`, or `not_logged` (a scheduled
  routine day in the past with nothing logged), so adherence is visible.
  Unscheduled rest days produce no rows. Future dates are never exported.
- Names are as they were on that day (day log values).
- Ranges count back from today: Last Month = same date last month → today;
  Last 3 Months = same date three months ago → today; Custom = From…To,
  inclusive. Sorted by date, then exercise order, then set number.
- Filename: `gym-log_<from>_to_<to>.csv`.
- Generated from the data on the device. In the app it works offline and
  opens the Android share sheet (save to Downloads/Drive); on the website
  it's a normal browser download.

## 5. Offline and sync

### Phone app: offline-first (owner-confirmed)

- The app keeps a full local copy of the owner's data and renders entirely
  from it; all schedule computation (repeat rules, clashes, shifts,
  pre-fill) runs on the device. This is the main architectural consequence:
  **the schedule logic lives in the app (TypeScript), not the backend.**
- Every change is applied locally first, then queued in a persistent outbox
  and pushed when online. The app opens and works fully with no signal.
- Pull: fetch rows changed since the last sync cursor on app start,
  foreground, and after pushes.
- Conflicts: last write wins per row (by client timestamp). Acceptable
  for a single user.
- A small dot in the top bar indicates unsynced changes.

### Website: online-only (owner-confirmed)

- No service worker, no persistent offline store.
- Still optimistic: taps update the UI immediately and save in the
  background, no spinners.
- If the connection drops: a banner "You're offline. Changes won't save",
  and editing is paused until reconnected (*my call*).
- Shares the app's codebase (Expo web export), so it uses the same
  in-app schedule logic.

## 6. Backend and data

- FastAPI on Vercel, Supabase JWT auth as in Financial Tracker; every query
  filtered by the caller's `user_id` (application-level, like Financial
  Tracker; RLS is a later option).
- The backend is a thin, authenticated sync store: push a batch of row
  changes, pull rows changed since a cursor. It does not compute schedules.
- Every row: client-generated UUID `id`, `user_id`, `updated_at`, and a
  soft-delete `deleted_at` (tombstones are needed for sync).
- Suggested tables (builder may refine): `routines` (series, `created_at`
  for clash precedence), `routine_versions` (`routine_id`,
  `effective_from`, `title`, `repeat_rule`, `start_date`, ordered exercise
  names, `ended`), `days` (`date`, `status`, link to the shift that caused
  it), `shifts` (`date`, `mode`, enough to undo), `occurrence_moves`
  (catch-up overrides: `routine_id`, `from_date`, `to_date`, `shift_id`),
  `day_exercises`
  (`date`, `position`, `name`), `sets` (`day_exercise_id`, `set_number`,
  `reps`, `weight_kg`).
- Schema in `supabase/init.sql` and numbered `migrations/`, as in Financial
  Tracker.

## 7. Setup tasks for the owner

These need the owner signed in; the plan should list them as manual
checklist steps and do all the wiring around them:

- Create the GitHub repo, Supabase project, Vercel project and Expo/EAS
  project; create the owner's Supabase Auth user.
- Paste keys into the env files (`.env.example` templates provided).
- First `eas login` / build.

## 8. Testing focus

The risky logic is the on-device schedule engine; it must be pure and
unit-tested. Pin at least:

1. Each repeat rule, including Twice a week from every weekday.
2. Clash: Legs Twice a week started Friday vs. Chest weekly Monday →
   Mondays stay Chest; the warning fires.
3. Edit-forward: rename + repeat change on a future date leaves earlier
   dates untouched; deleting an exercise today doesn't touch past logs.
4. Catch-up shift with the example split; with no rest day in 7 days it
   equals permanent; multiple shifts in one week compose correctly.
5. Permanent shift moves Twice-a-week and Never routines correctly.
6. Undo/Restore restores the exact prior schedule.
7. Pre-fill picks the most recent earlier session by name across routines;
   × doesn't save untouched pre-fills; Done does.
8. Offline: changes made with no connection survive an app restart and
   sync once online; tombstones propagate deletes.
9. CSV: columns, statuses (`missed`/`skipped`/`not_logged`), range edges
   (inclusive), bodyweight rows.
10. Backend: every route rejects or scopes rows for a second user (the
    `user_id` filter is actually applied).

## 9. Deliberate deviations from the PNGs

- **Date bar direction:** PNGs show today on the left with past days to the
  right ("Past days →"). Final: chronological left → right, today on the
  left edge at open, future to the right, scroll left for the past.
- **Gym Missed dialog:** Shift Day gains a second step (catch up / for
  good).
- **Desktop:** Done button in the sets panel; "Focus" stat → Volume.
- **Status bar / home indicator** in the PNGs are device chrome, not app
  UI.
- Added states not in the PNGs: Missed/Skipped badges + Restore, Undo bar,
  backfill on past days, clash warning, "Stop this routine", offline
  banner (web), unsynced dot (app), login screen.

## 10. Left to the builder

Local storage engine in the app (AsyncStorage vs. SQLite); sync protocol
details; exact table/column names; whether shifts are stored as events and
projected or materialized into rows (either is fine if Section 8 passes);
breakpoints; animation details; icon set (the designs use Lucide icons;
`react-native-svg` is available); local dev scripts (mirror Financial
Tracker's `scripts/dev.sh`).
