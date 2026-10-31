# Drop sets and exercise order — design

Two additions to the Gym Tracker (base design:
`docs/superpowers/specs/2026-10-19-gym-tracker-design.md`). Everything there
still holds unless this document says otherwise.

## Context

- **Exercise order.** The owner wants the database to record the order they
  actually did a day's exercises in. Monday might be preacher curl then
  hammer curl, Tuesday hammer then preacher. `day_exercises.position` is the
  routine's planned order, not this. The order must be captured offline and
  sync later like every other change.
- **Drop sets.** The owner wants to log a drop set (the same exercise
  continued straight away at a lower weight) without making the sets editor
  any harder to use.

The CSV export feeds an AI agent for analysis (base design §4), so both
additions must come through in it clearly.

## Goals

- Every logged day records which exercise was done 1st, 2nd, 3rd, …, with
  nothing extra to tap.
- A drop set can be logged in one tap, with its own reps and weight per drop.
- Both work offline on the phone and sync to the website, like the rest of
  the data.
- Both appear in the CSV export.

## Non-goals

- Showing the performed order anywhere in the app. Owner: "no need to have
  the order in the app, the database and export is fine." The exercise list
  keeps its routine order.
- Manually reordering a day's exercises (dragging and the like). Rejected in
  favour of recording the order automatically.
- Other set types (supersets, warm-ups, rest-pause, failure tags).
- Working out the order for days logged before this ships.

## Anti-goals

- A busier sets editor. A normal set row stays exactly as it is today: Set N,
  reps, kg, ×.
- Guessed data. Days logged before this ships keep a blank order; the
  routine's order is never written in as if it were performed.

## 1. Exercise order (owner-confirmed)

### Recording
- New nullable integer on each day exercise: `performed_order` (1, 2, 3, …).
- An exercise gets the next number when the day's log first gives it a
  *logged* set. A logged set is one with reps, the existing `isLogged`
  meaning used by totals and the CSV. This covers typing a set and tapping
  Done on "last time" prefilled rows.
- A row with only a weight is saved but isn't logged, the same as in totals
  and the CSV today. So the number arrives when reps are entered, and goes
  when the last logged row's reps are cleared. *(my call)*
- "Next number" = 1 + the highest `performed_order` among that date's live
  exercises; 1 when none have one.
- Worked out on the device as part of the same change that saves the set, so
  it is queued and synced with that save, offline included.
- Exercises with no logged sets that day have no number (null).

### Corrections
- An exercise loses its number when its last logged set is removed (cleared,
  or deleted with ×) or when the exercise is deleted from the day. Every
  exercise on that date with a higher number moves down by one, so the
  numbers stay 1…n with no gaps.
- A later logged set on an exercise that already has a number never changes
  it.
- Renaming an exercise keeps its number.
- Past days filled in later get numbers in the order they are entered.
- Every engine path that changes whether an exercise has logged sets must
  keep this rule. Known paths: saving sets, deleting an exercise, and any
  shift Undo/Restore that tombstones sets. *(builder: find and cover them all)*

### Existing data
- Days logged before this ships keep `performed_order` null.

### Two devices on the same day *(my call)*
- If two devices log the same date offline, each numbers from what it knows,
  and the merge can leave two exercises with the same number. This is
  accepted for a single owner: rows stay last-write-wins and nothing is
  renumbered on merge. The export breaks ties by `position`.

## 2. Drop sets (owner-confirmed)

### The editor (phone sheet and desktop "Set details" panel; they share `SetsEditor`)
```
Set 1    [10] reps  [60] kg   ×
Set 2    [10] reps  [60] kg   ×
 ↳ Drop  [ 8] reps  [45] kg   ×
 ↳ Drop  [ 6] reps  [30] kg   ×
         + Add Set     + Drop
```
- **+ Drop** sits next to **+ Add Set**. It adds an indented "↳ Drop" row at
  the end of the list, with the same reps and kg inputs and the same ×.
  Pressing it again adds another drop, so a set can be followed by a chain of
  drops.
- **+ Drop** is unavailable when there are no rows: a drop needs a set above
  it.
- A new drop row starts with both fields empty, because a drop always changes
  the weight. *(my call: + Add Set copies the last row, + Drop doesn't)*
- Tapping a row's label ("Set N" or "↳ Drop") switches the row between a
  normal set and a drop, so a mis-tap is easy to fix. The first row can never
  become a drop.
- Drops take no set number. Labels run Set 1, Set 2, ↳ Drop, ↳ Drop, Set 3.
- × on a normal set deletes that set and the drops under it. × on a drop
  deletes only that drop.
- Read-only future days and the existing save rules (untouched prefilled rows
  are saved only on Done) are unchanged.

### Data
- New boolean on each set: `is_drop`, default false.
- `set_number` keeps its current meaning, the row's position in the list
  (1…n, drops included). The set's id derivation (`dayExerciseId|setNumber`)
  is unchanged.
- A drop belongs to the nearest normal set above it.
- `isDrop` travels with the row in the editor's drafts and is part of the
  "unchanged row" check when saving, so toggling a row's type saves it.
- × shifts the later rows up a position, as it does for plain sets today.
  Their `isDrop` moves with them, because rows are rewritten by position.
- Two devices editing the same exercise offline can merge so that a drop
  sits under a different set. This is accepted, the same as today's
  positional merge of plain sets. *(my call)*
- If a merge ever leaves a drop with no normal set above it (the first row),
  it is shown and counted as a normal set. *(my call)*

### Numbers
- **Volume** includes drops: reps × kg on every logged row.
- **Set counts** count only normal sets. This covers the stats card, the
  exercise tile's "N sets", and an unlogged exercise's prefill count. Set 2
  plus two drops counts as one set.
- The tile's "reps · kg" figure still comes from the heaviest logged row
  (drops are lighter, so in practice it is a normal set).
- "Last time" prefill copies drops too, so last week's dropset comes back in
  the same shape.

## 3. CSV export

- Columns, in order:
  `date, weekday, routine, exercise, exercise_order, set_number, is_drop, reps, weight_kg, volume_kg, status`
- `exercise_order`: the exercise's `performed_order`; blank when null, and on
  status rows.
- `set_number`: the set number the editor shows, so a drop row repeats its
  parent's number. With `is_drop` this reads "drop of set 2"; repeated drops
  keep their row order. *(my call)*
- `is_drop`: `true` or `false` on set rows; blank on status rows. *(my call)*
- Sort: date, then `exercise_order` (exercises without one come after, by
  `position`), then row order. *(my call: replaces "then exercise order"
  meaning routine position)*
- Everything else in base design §4 is unchanged.

## 4. Sync and backend

- `day_exercises.performed_order int NULL CHECK (performed_order >= 1)`.
- `sets.is_drop boolean NOT NULL DEFAULT false`.
- Added by the first numbered migration, `migrations/001_<name>.sql`, which
  `api/scripts/migrate.py` already looks for. `init.sql` is
  `CREATE TABLE IF NOT EXISTS`, so editing it would not change the live
  tables.
- Wire names: `performedOrder`, `isDrop`. The server accepts them optional,
  with defaults (null and false), so a client that doesn't send them yet is
  not rejected. A missing field is stored as its default, even on an update.
  This stays whole-row last-write-wins with no "column absent" path.
  *(my call)*
- That is safe for the app already installed. The app keeps every field of
  the rows it stores and copies them when it edits (`{ ...prev, … }` in
  `syncSets`, rename, delete and restamp). So an old app re-saving a row it
  has pulled sends the new fields back unchanged.
- An old app only drops the fields on rows it creates itself, or on rows it
  edits from a copy older than the write that set them. That is the same as
  any last-write-wins conflict, and it lasts only until the phone takes the
  update.
- On the device, rows already stored (LocalStore) or pulled without the
  fields read as `performedOrder: null` and `isDrop: false`.
- Release: deploy the API and web together, then publish the app change as an
  EAS Update to the `preview` channel. The change is JavaScript only, so no
  new APK is needed. Until the phone takes the update, an old app saving a
  set sends no `isDrop`, and the server stores false. This is acceptable:
  only the new app can create drops. *(my call)*
- Run the migration against Supabase (session pooler, as in Plan 2 Task 1)
  before the API deploy that reads the new columns.

## 5. Testing focus

- Order: first logged set assigns n+1. Clearing the last logged set, ×, and
  deleting the exercise each remove the number and close the gap. Rename
  keeps it. Done on prefilled rows assigns it. A day logged in the order B, A
  gets B=1, A=2. Every set-tombstoning path keeps the numbers gapless.
- Drops: first row can't be a drop; toggle both ways; × on a set takes its
  drops; prefill copies `isDrop`; counts exclude drops, volume includes them;
  an orphan first-row drop counts as a set.
- CSV: new columns and their values, a drop repeating its parent's set
  number, sorting by `exercise_order`.
- API: both fields round-trip; rows without them are accepted and stored
  with defaults; the migration applies to a database built by the current
  `init.sql`; `performed_order` 0 or negative is rejected.
- Offline: an offline set save queues the exercise's order change in the same
  outbox flush.

## 6. Left to the builder

- The visual detail of the drop row (indent, label style) and **+ Drop**
  placement, within the existing theme.
- How the order rule is shared across every engine path (one helper is
  expected).
- The migration's file name, and branch and commit layout.
