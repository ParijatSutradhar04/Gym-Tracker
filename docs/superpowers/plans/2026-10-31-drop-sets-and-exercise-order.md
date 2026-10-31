# Drop Sets and Exercise Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the order a day's exercises were actually done (`day_exercises.performed_order`) and let a set be logged as a drop (`sets.is_drop`), offline and synced, with both in the CSV.

**Architecture:** Two new row fields travel through the existing whole-row last-write-wins sync. The device works out `performedOrder` inside the same engine command that saves or deletes sets (one helper, `orderChanges`), so it is queued in the same outbox commit. Drops are a flag on positional set rows; one numbering helper (`numberSets`) drives the editor labels, set counts and the CSV `set_number`.

**Tech Stack:** Expo SDK 57 / React Native + TypeScript (vitest), FastAPI + pydantic + asyncpg (pytest), Supabase Postgres, Vercel, EAS Update.

**Spec:** `docs/superpowers/specs/2026-10-31-drop-sets-and-exercise-order-design.md` (base: `docs/superpowers/specs/2026-10-19-gym-tracker-design.md`).

## Global Constraints

- Columns: `day_exercises.performed_order int NULL CHECK (performed_order >= 1)`; `sets.is_drop boolean NOT NULL DEFAULT false`. Wire names `performedOrder`, `isDrop`.
- Server accepts both fields optional, defaults `null` / `false`; a missing field is stored as its default, also on update.
- On the device, rows without the fields read as `performedOrder: null`, `isDrop: false`.
- CSV columns, in order: `date, weekday, routine, exercise, exercise_order, set_number, is_drop, reps, weight_kg, volume_kg, status`.
- A normal set row stays exactly: `Set N`, reps, kg, ×. The performed order is never shown in the app.
- Days logged before this ships keep `performed_order` null; nothing is backfilled or guessed.
- Branch `feat/drop-sets-order`, cut from `feat/cloud-sync` (main lacks 2e50506). Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never print `app/.env` / `api/.env` values. The owner runs the Supabase migration, the deploy and the EAS publish.
- Commands: app `cd app && npm test --silent && npm run typecheck --silent`; API `cd api && .venv/bin/pytest -q` (needs `docker start gym-db`).

## Review Focus

1. **EAS Update built with the local `app/.env`** points the phone at the local API. The published bundle must hold the Vercel URL (Task 7, step 3 check).
2. **Migration after the API deploy** makes every push fail and the outbox stall. The migration lands first, checked before the deploy (Task 7, steps 1–2).
3. **Tapping the label on an untouched prefilled row** saves only that row, at once, like typing; other prefilled rows wait for Done (Task 4 `toggling_an_untouched_row_saves_only_that_row`).
4. **× on Set 1 that has drops** never leaves a drop as the first row (Task 4 `removalEnd_takes_a_sets_drops_and_only_the_drop`).
5. **A day partly logged before the update**: a new set on a pre-update exercise doesn't number it, and a fresh exercise gets 1 (Task 3 `exercise_logged_before_the_update_stays_unnumbered`).

## File Structure

- `migrations/001_drop_sets_and_exercise_order.sql` (new): the two `ALTER TABLE … ADD COLUMN`s.
- `api/app/rows.py`: the two model fields and spec columns. Tests in `api/tests/{test_schema,test_push,test_pull}.py` and `samples.py`.
- `app/src/engine/types.ts`: the fields. `state.ts`: `withRowDefaults`.
- `app/src/engine/order.ts` (new): `isLogged` (moved here from `summary.ts`) and `orderChanges`. Tests in `__tests__/order.test.ts` (new).
- `app/src/engine/sets.ts`: `SetDraft.isDrop`, `numberSets`, `removalEnd`, plus `syncSets` changes.
- `scheduleEdits.ts`: delete clears and closes the order. `summary.ts`, `csv.ts`.
- `app/src/data/LocalStore.ts`, `app/src/sync/api.ts`: apply `withRowDefaults` on load and pull.
- `app/src/components/SetsEditor.tsx`: + Drop, label toggle, × cascade.

---

### Task 1: Schema migration and API fields

**Files:** Create `migrations/001_drop_sets_and_exercise_order.sql`. Modify `api/app/rows.py`, `api/tests/samples.py`, `api/tests/test_schema.py`, `api/tests/test_push.py`, `api/tests/test_pull.py`.

**Interfaces:** Produces wire fields `performedOrder: int ≥ 1 | null` (day_exercises) and `isDrop: bool` (sets) on push and pull.

- [ ] **Step 1: Failing tests.**
  - `test_schema.py`:
    - `test_migration_001_adds_performed_order_and_is_drop`. Checks `information_schema.columns`: `day_exercises.performed_order` is `integer` and nullable; `sets.is_drop` is `boolean`, `is_nullable = 'NO'`, `column_default = 'false'`. Also `schema_migrations` contains `'001_drop_sets_and_exercise_order.sql'`. The session fixture already builds the DB from the current `init.sql` and then runs migrations, so this also proves the migration applies on top of it.
    - Add `("day_exercises", "performed_order", 0)` to `test_check_constraints_reject_bad_enum_and_ranges`.
  - `samples.py`: defaults gain `"performedOrder": None` (day_exercises) and `"isDrop": False` (sets).
  - `test_push.py`:
    - `test_new_fields_round_trip`: push `sample_row("day_exercises", performedOrder=2)` and `sample_row("sets", isDrop=True)`; the pulled rows equal what was pushed.
    - `test_missing_new_fields_are_stored_as_defaults_even_on_update`: push a day exercise with `performedOrder=2` at T1, then the same id at T2 with the key deleted; push a set with the `isDrop` key deleted. The DB holds `performed_order IS NULL` and `is_drop = false`.
    - `test_invalid_rows_are_rejected` params gain `("day_exercises", {"performedOrder": 0})`, `("day_exercises", {"performedOrder": -1})`, `("day_exercises", {"performedOrder": 1.5})` and `("sets", {"isDrop": "true"})`.
  - `test_pull.py` `test_wire_shape_is_camelCase_without_user_id_or_seq`: the sets key set gains `"isDrop"`.
- [ ] **Step 2: Run** `cd api && .venv/bin/pytest -q`. Expected: the new and changed tests FAIL (missing column / unknown field), everything else passes.
- [ ] **Step 3: Implement.**
  - The migration body:
    `ALTER TABLE day_exercises ADD COLUMN IF NOT EXISTS performed_order int NULL CHECK (performed_order >= 1);`
    `ALTER TABLE sets ADD COLUMN IF NOT EXISTS is_drop boolean NOT NULL DEFAULT false;`
  - `rows.py`:
    - `DayExercise.performed_order: Annotated[int, Field(strict=True, ge=1, le=_INT4_MAX)] | None = None`;
    - `SetRow.is_drop: StrictBool = False`;
    - spec tuples gain `("performed_order", "int")` and `("is_drop", "boolean")`, last in each table.
  - No change to `services/sync.py`: the upsert already writes every spec column.
- [ ] **Step 4: Run** `cd api && .venv/bin/pytest -q`. Expected: all pass (93 + new).
- [ ] **Step 5: Commit** `feat(api): performed_order and is_drop columns, optional on the wire`

### Task 2: Engine row fields and defaults for older rows

**Files:** Modify `app/src/engine/types.ts`, `state.ts`, `dayLog.ts` (`ensureDayLog` rows), `scheduleEdits.ts` (`editLog` add), `sets.ts` (new set row), `app/src/data/LocalStore.ts` (`load`), `app/src/sync/api.ts` (`pull`). Update test row literals wherever `npm run typecheck` flags them. Tests: `engine/__tests__/state.test.ts`, `data/__tests__/LocalStore.test.ts`, `sync/__tests__/api.test.ts`.

**Interfaces:**
- Produces `DayExercise.performedOrder: number | null` and `SetRow.isDrop: boolean`, both required.
- Produces `withRowDefaults(change: Change): Change` in `state.ts`. It fills `performedOrder: null` on a day_exercises row and `isDrop: false` on a sets row only when the key is absent (`=== undefined`). It returns other tables unchanged.

- [ ] **Step 1: Failing tests.**
  - `state.test.ts` `withRowDefaults_fills_only_missing_fields`: an old-shape day exercise gets `performedOrder: null`; one with `performedOrder: 2` keeps 2; an old-shape set gets `isDrop: false`; a set with `isDrop: true` keeps it; a `days` change comes back equal.
  - `LocalStore.test.ts` `rows_saved_before_the_new_fields_load_with_defaults`: commit old-shape rows (cast through `unknown`), reload a new `LocalStore` on the same storage, and the rows read `performedOrder: null` / `isDrop: false`.
  - `api.test.ts` `pull_fills_defaults_for_rows_without_the_new_fields`: a page holding an old-shape set and day exercise resolves with both defaults filled.
- [ ] **Step 2: Run** `cd app && npm test --silent`. Expected: the 3 new tests FAIL.
- [ ] **Step 3: Implement.**
  - Add the two fields to `types.ts`.
  - Write `withRowDefaults`.
  - New rows carry `performedOrder: null` in `ensureDayLog` and `editLog` add, and `isDrop: false` in the `syncSets` new-row branch until Task 4 replaces it.
  - `LocalStore.load` maps bucket rows through `withRowDefaults` before `applyChanges`.
  - `createSyncApi().pull` maps `changes` through it after the table filter. This covers the phone's pull and `RemoteStore`.
  - Fix every typecheck error in test literals by adding `performedOrder: null` / `isDrop: false`.
- [ ] **Step 4: Run** `cd app && npm test --silent && npm run typecheck --silent`. Expected: all pass, no type errors.
- [ ] **Step 5: Commit** `feat(app): performedOrder and isDrop on rows, defaults for rows saved or pulled without them`

### Task 3: Recording the exercise order

**Files:** Create `app/src/engine/order.ts`, `app/src/engine/__tests__/order.test.ts`. Modify `sets.ts` (`syncSets`), `scheduleEdits.ts` (`editLog` delete), `summary.ts` (import `isLogged` from `./order`), `shift.test.ts`, `data/__tests__/GymStore.test.ts`.

**Interfaces:**
- Consumes `performedOrder` (Task 2).
- Produces `isLogged(set: SetRow): boolean` (moved, same body) and `orderChanges(state: DataState, date: DateStr, now: string, firstLogged?: string): Change[]` in `order.ts`. `orderChanges` reads the state *after* the command's other writes and returns day_exercises rows (`{ ...x, performedOrder, updatedAt: now }`) only for exercises whose number changes:
  1. Over the date's live exercises (`getIndex().exercisesByDate`), *kept* = those with a number and at least one live logged set.
  2. Each kept number becomes its dense rank among the distinct kept numbers (closes gaps; keeps merge duplicates equal).
  3. Exercises with a number and no logged set get `null`.
  4. If `firstLogged` names a live exercise with logged sets and no number, it gets 1 + the number of distinct kept numbers.
  It never numbers any other exercise.
- `syncSets` computes `wasLogged` from the persisted sets *before* the command. After applying the set writes, it applies `orderChanges(rec.state(), date, now, wasLogged ? undefined : dayExerciseId)`.
- `editLog` delete writes the tombstone with `performedOrder: null` and appends `orderChanges(applyChanges(state, changes), date, now)`.
- **Ruling recorded here:** `restoreShift` needs no change. A shift is only offered with no sets on today, and restore tombstones day rows only when today still has no sets (`keepLog`), so it never removes a logged set. Rename spreads the row, so it keeps the number.

- [ ] **Step 1: Failing tests** in `order.test.ts`. Helper: `orders(s, date)` maps the date's live exercise name to `performedOrder`. Routine: `['Preacher curl', 'Hammer curl', 'Cable curl']`, logged with `logSets`.
  - `first_logged_set_gets_the_next_number`: log Hammer then Preacher → `{Preacher: 2, Hammer: 1, Cable: null}`.
  - `later_sets_never_change_the_number`: log Hammer, Preacher, then Hammer again with two rows → Hammer 1, Preacher 2.
  - `weight_only_row_gets_no_number_until_reps`: `[[null, 20]]` → null; then `[[10, 20]]` → 1.
  - `done_on_prefilled_rows_assigns_the_number`: an earlier session exists; `syncSets` with `prefillRows(...)` and `includeUntouched: true` → 1.
  - `clearing_the_last_logged_set_removes_the_number_and_closes_the_gap`: Preacher, Hammer, Cable logged in that order (1, 2, 3). Sync Hammer with `[draft(null, null)]` → `{Preacher: 1, Hammer: null, Cable: 2}`.
  - `deleting_every_row_removes_the_number`: sync Hammer with `rows: []` gives the same result as above.
  - `order_change_is_in_the_same_change_set_as_the_set`: one `syncSets` result holds the `sets` row and the `day_exercises` row with `performedOrder: 1`.
  - `exercise_logged_before_the_update_stays_unnumbered`: log Preacher, then reset its row to `performedOrder: null` via `run`. Log Preacher again with two rows → still null. Log Hammer → 1.
  - `duplicate_numbers_from_a_merge_are_kept`: set Preacher and Hammer both to 1 via `run`; log Cable → 2; both stay 1.
  - `scheduleEdits.test.ts`:
    - `deleting_an_exercise_removes_its_number_and_closes_the_gap`: on a past day and on today, Preacher 1, Hammer 2, Cable 3; delete Hammer → Preacher 1, Cable 2.
    - `rename_keeps_the_number`.
  - `shift.test.ts` `restore_after_logging_keeps_performed_order`: skip today, log a set, restore → that exercise still 1.
  - `GymStore.test.ts` `set_save_queues_the_order_change_in_the_same_commit`: through `createActions`, add a schedule, then `syncSets` one row. After `whenIdle()`, `local.peek(100)` holds both a `sets` change and a `day_exercises` change with `performedOrder: 1`.
- [ ] **Step 2: Run** `cd app && npm test --silent`. Expected: the new tests FAIL (`orderChanges` missing or the number stays null); rename and restore may already pass.
- [ ] **Step 3: Implement** `order.ts` and the `syncSets` and `editLog` wiring above.
- [ ] **Step 4: Run** `cd app && npm test --silent && npm run typecheck --silent`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(engine): record the order exercises are performed`

### Task 4: Drop sets in the engine

**Files:** Modify `app/src/engine/sets.ts`, `summary.ts`, `engine/__tests__/fixtures.ts` (`logSets` rows become `[reps, kg, isDrop?]`), `sets.test.ts` (the `empty` and `draft` helpers gain `isDrop`), `summary.test.ts`.

**Interfaces:**
- Produces `SetDraft.isDrop: boolean`.
- Produces `numberSets(rows: readonly { isDrop: boolean }[]): { number: number; isDrop: boolean }[]`. Example: `[set, drop, drop, set]` → `[{1,false},{1,true},{1,true},{2,false}]`. A drop as the first row comes back `{1, false}` (the orphan rule).
- Produces `removalEnd(rows: readonly { isDrop: boolean }[], i: number): number`: the exclusive end index of what × on row i removes. That is row i, plus the drops directly under it when `numberSets` says row i is a set.
- `historyRows`, `getSetsSheet` and the empty prefill carry `isDrop` (copied from the set row; `false` for empty rows).
- `syncSets`:
  - the unchanged check also compares `isDrop`;
  - new and updated rows write `isDrop`;
  - row 1 is always written `isDrop: false`.
- `exerciseSummary`:
  - `setCount` = normal rows in `numberSets(logged)`;
  - an unlogged exercise counts normal rows of `numberSets(prefillRows(...))`;
  - the heaviest-row text is unchanged;
  - `dayVolume` is unchanged (drops included).

- [ ] **Step 1: Failing tests.**
  - `sets.test.ts`:
    - `numberSets_numbers_drops_under_their_set_and_treats_a_first_row_drop_as_a_set`.
    - `removalEnd_takes_a_sets_drops_and_only_the_drop`: on `[set, drop, drop, set]`, `removalEnd(rows, 0) === 3`, `removalEnd(rows, 1) === 2`, `removalEnd(rows, 3) === 4`.
    - `toggling_a_row_to_a_drop_saves_it`: same reps and kg, `isDrop` flipped → one sets change with `isDrop: true`.
    - `toggling_an_untouched_row_saves_only_that_row`: prefilled rows, only row 2 `touched: true, isDrop: true` → only setNumber 2 written.
    - `first_row_is_never_saved_as_a_drop`.
    - `prefill_copies_drops`: last session `[[10,60],[8,45,true]]` → prefill rows carry `isDrop` false, true.
    - `sheet_rows_carry_isDrop`.
  - `summary.test.ts`:
    - `drops_count_toward_volume_not_sets`: `[[10,60],[8,45,true],[6,30,true]]` → `{ setCount: 1, text: '1 set · 10 reps · 60 kg' }`, volume 1140.
    - `prefill_count_excludes_drops`.
    - `orphan_first_row_drop_counts_as_a_set`: a lone persisted row with `isDrop: true` → `setCount: 1`.
- [ ] **Step 2: Run** `cd app && npm test --silent`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** `cd app && npm test --silent && npm run typecheck --silent`. Expected: all pass. `SetsEditor.tsx` may fail typecheck on `isDrop` in `addSet`: add `isDrop: false` there so the tree stays green until Task 6.
- [ ] **Step 5: Commit** `feat(engine): drop sets: numbering, counts, prefill and save`

### Task 5: CSV columns and sort

**Files:** Modify `app/src/engine/csv.ts`, `engine/__tests__/csv.test.ts`.

**Interfaces:**
- Consumes `performedOrder` (Task 3), `numberSets` and `isDrop` (Task 4).
- `CSV_COLUMNS` = the Global Constraints list.
- Exercises on a date sort by `performedOrder` ascending, nulls after, then `position`, then `id`.
- Each logged row writes:
  - `exercise_order` = `performedOrder` (blank when null);
  - `set_number` = `numberSets(all live sets of the exercise)[i].number`, so a drop repeats its parent's number;
  - `is_drop` = `'true'` / `'false'`.
- Status rows leave all three blank.

- [ ] **Step 1: Failing tests.**
  - Update `HEADER` and every expected line for the new columns. Logging order now numbers exercises: the fixture's Bench press is 1 and Pull-up 2 on 2026-09-07, e.g. `'2026-09-07,Mon,Chest & Tricep,Bench press,1,1,false,10,60,600,logged'` and `'2026-09-14,Mon,Chest & Tricep,,,,,,,,skipped'`.
  - `sorted_by_date_exercise_order_then_set` now expects Pull-up (logged first on 09-14) before Bench press.
  - New:
    - `drop_rows_repeat_their_parents_set_number`: `[[10,60],[8,45,true],[10,60]]` → set_number `1,1,2`, is_drop `false,true,false`.
    - `unnumbered_exercises_come_after_numbered_ones_by_position`: reset Bench press to `performedOrder: null` via `run`; Pull-up (1) comes first and exports `exercise_order` blank for Bench.
- [ ] **Step 2: Run** `cd app && npm test --silent -- csv`. Expected: FAIL on header and lines.
- [ ] **Step 3: Implement** in `buildCsv`.
- [ ] **Step 4: Run** `cd app && npm test --silent && npm run typecheck --silent`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(export): exercise_order and is_drop columns, sort by performed order`

### Task 6: Sets editor UI (dispatch to a UI subagent; the owner tests it, no visual checks)

**Files:** Modify `app/src/components/SetsEditor.tsx` only.

**Interfaces:** Consumes `SetDraft.isDrop`, `numberSets` and `removalEnd` (Task 4).

**Behaviour:**
- **Labels** come from `numberSets(rows.map((r) => r.draft))`: `Set N` for a set, `↳ Drop` for a drop. Drop rows are visibly indented; the exact look is the builder's call within the theme.
- **Label tap** (not locked, rows after the first): flips `isDrop` with `touched: true` and saves through `commit`. The first row's label is plain text.
  - Accessibility: `accessibilityRole="button"`, label `Set N` or `Drop of set N`, `accessibilityHint="Switches between set and drop"`.
  - The hit area is at least 44 px tall.
- **×**: removes rows `i … removalEnd(drafts, i) - 1` through `commit`. `accessibilityLabel` is `Delete set N` or `Delete drop of set N`.
- **Footer**: `+ Add Set` and `+ Drop` side by side, same style as today's `+ Add Set`.
  - `+ Add Set` copies reps and kg from the last *set* row (skipping drops), `isDrop: false`, untouched.
  - `+ Drop` appends `{ reps: null, weightKg: null, touched: false, isDrop: true }`. It is disabled (dimmed, `accessibilityState={{ disabled: true }}`) when there are no rows.
- **Unchanged**: a normal set row's layout, the locked and read-only states, Done, and the "Invalid" note.

- [ ] **Step 1: Implement** the behaviour above.
- [ ] **Step 2: Run** `cd app && npm test --silent && npm run typecheck --silent && npx expo export --platform web --output-dir /tmp/gt-web-export`. Expected: all pass, the export succeeds.
- [ ] **Step 3: Commit** `feat(app): + Drop, tap a label to switch set/drop, × takes a set's drops`

### Task 7: Release (each step needs the owner's go-ahead; the owner runs it)

**Prerequisite:** The preview APK from build 7659f92e is installed (Plan 2 Task 15).

- [ ] **Step 1: Migrate Supabase.** `DATABASE_URL='<session pooler URI>' api/.venv/bin/python api/scripts/migrate.py`. Expected: `migrations: 001_drop_sets_and_exercise_order.sql.`; a second run prints `none new`.
- [ ] **Step 2: Deploy API and web together**, the same way Plan 2 did. Expected:
  - `curl -s https://gymtracker-kappa-gules.vercel.app/api/health` → `{"status":"ok"}`;
  - on the website, logging a set and reloading keeps it.
- [ ] **Step 3: Check the update bundle's API URL.** `app/.env` points at the local API, and `eas update` bundles with local env (the eas.json build env doesn't apply).
  - Run `cd app && EXPO_PUBLIC_API_URL=https://gymtracker-kappa-gules.vercel.app npx expo export --platform android --output-dir /tmp/gt-update-check`.
  - Expected: `rg -a -l 'gymtracker-kappa-gules.vercel.app' /tmp/gt-update-check` matches, and `rg -a -l 'localhost' /tmp/gt-update-check` doesn't.
- [ ] **Step 4: Publish.** `cd app && EXPO_PUBLIC_API_URL=https://gymtracker-kappa-gules.vercel.app npx eas-cli update --channel preview --message "Drop sets and exercise order"`. Expected: the update is published to branch `preview`.
- [ ] **Step 5: Phone check (owner).**
  - Restart the app twice to take the update.
  - Log a set with drops offline, then reconnect.
  - Export a CSV on the website: it shows `exercise_order` and `is_drop`.
