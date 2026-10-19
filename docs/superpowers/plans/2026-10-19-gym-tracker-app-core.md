# Gym Tracker App Core Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Gym Tracker Expo app (Android + web) with every screen of the spec, a unit-tested pure schedule engine, and all data stored on the device behind a storage interface plus a persistent outbox, with no backend and no login.

**Architecture:** `app/src/engine/` is pure TypeScript (no React, no React Native imports). Every user action is a *command*, `(state, ctx, args) => Change[]`, where a `Change` is a full row for one table (soft deletes are rows with `deletedAt` set). A `GymStore` applies changes to in-memory state synchronously (UI never waits), then persists rows and outbox entries atomically through a `DataStore` interface. `LocalStore` implements it over AsyncStorage; Plan 2 swaps in a remote implementation for web and adds sync on top of the outbox. Screens read state through `useSyncExternalStore` hooks and call bound commands.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / React 19.2, NativeWind 4 + Tailwind 3, react-native-web, `@expo-google-fonts/inter` + `@expo-google-fonts/roboto-mono`, `react-native-svg` + `lucide-react-native`, `@react-native-async-storage/async-storage`, `expo-crypto`, `expo-file-system`, `expo-sharing`, TypeScript, Vitest (engine tests).

**Spec:** `docs/superpowers/specs/2026-10-19-gym-tracker-design.md` (this is **Plan 1 of 2**: app core, local-only. Plan 2 covers Supabase, FastAPI, login, sync, deploy). Design PNGs are in `design/`; `design/guideline.md` is the original UX brief.

## Global Constraints

Every task's requirements include this section. Plan decisions are marked *(plan)*; the rest is verbatim from the spec.

- **Stack:** Expo SDK 57, React Native + NativeWind, `react-native-web` for web; npm with `package-lock.json`; install Expo packages with `npx expo install`. Android + web only, no iOS. Per Financial Tracker `app/AGENTS.md`, read https://docs.expo.dev/versions/v57.0.0/ before writing Expo code.
- **Expo APIs verified against the v57.0.0 docs while writing this plan** *(plan)*:
  - `expo-file-system`: `import { File, Paths } from 'expo-file-system'`; `const f = new File(Paths.cache, name); f.create({ overwrite: true }); f.write(text)` (sync, string). `writeAsStringAsync` from the main import throws at runtime (only `expo-file-system/legacy`); do not use it.
  - `expo-sharing`: `Sharing.isAvailableAsync()`, `Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle })` (`mimeType` Android, `dialogTitle` Android/Web). Web sharing of local files is unsupported, so web uses a Blob download instead.
  - `expo-crypto`: `randomUUID(): string`, synchronous, works on web (HTTPS or localhost).
  - `expo-sqlite` web support is alpha and needs wasm + COOP/COEP headers, which is why it is not used.
  - Package versions seen on npm: `vitest@5.0.5` (Node `^22.12 || ^24 || >=26`; this machine runs Node v26.7.0), `lucide-react-native@1.59.0` (peer `react-native-svg ^15`, matches the pinned 15.15.4). `npx expo install` picks SDK-matched versions for Expo packages; record the resolved versions in the Task 1 commit message.
- **Pinned from Financial Tracker `app/package.json`:** `expo ~57.0.14`, `expo-font ~57.0.1`, `expo-status-bar ~57.0.1`, `nativewind ^4.2.6`, `react 19.2.3`, `react-dom 19.2.3`, `react-native 0.86.2`, `react-native-reanimated 4.5.1`, `react-native-safe-area-context ~5.7.0`, `react-native-svg 15.15.4`, `react-native-web ^0.21.2`, `@react-native-async-storage/async-storage 2.2.0`, `tailwindcss ^3.4.19`, `babel-preset-expo ^57.0.7`, `typescript ~6.0.3`, `@types/react ~19.2.2`, `@expo-google-fonts/inter ^0.4.2`.
- **Identity:** app name "Gym Tracker", slug `gym-tracker`, owner `parijatsutradhars-team`, Android package `com.parijat.gymtracker`.
- **Design tokens (hex exact):** bg `#101211`, surface `#1B1E1C`, surface-2 `#252925`, border `#323732`, text `#F4F6F1`, text-muted `#9BA39A`, text-faint `#697268`, accent `#C5F76B`, on-accent `#17200D`, scrim `rgba(0,0,0,0.72)`. Radii 8/10/16/24/100. Icon buttons 44px. Page padding 20px. Sheet: surface bg, 24px top radius, 36x4 handle `#697268`. Fonts: Inter (UI), Roboto Mono (numbers, dates, counts). Icons: Lucide.
- **Units:** kg only. Reps are whole numbers. Weight allows decimals (2.5, 22.5); blank weight = bodyweight.
- **"Today" is the device's local calendar date.** All dates in the engine are `YYYY-MM-DD` strings; engine date math never builds local-time `Date` objects (DST-safe).
- **Anti-goals:** no save spinner or blocking call while logging a set; a set must never be lost to a lock screen or no signal; the schedule never changes without a user tap (no auto-missed, no auto-shift, no edit rewriting earlier days); Skip/Shift can always be undone.
- **Every stored row** has client-generated UUID `id`, `updatedAt` (ISO string), `deletedAt` (ISO string or null). No `user_id` locally (Plan 2 stamps it from the JWT). Every mutation appends to the outbox.
- **Table names** (match the spec's suggested backend tables): `routines`, `routine_versions`, `days`, `shifts`, `occurrence_moves`, `day_exercises`, `sets`.
- **Copy:** exact strings from the PNGs and spec are in the tasks; do not paraphrase them.
- **UI tasks run in fresh subagents:** each UI task lists its PNG, tokens, components and engine calls and must not depend on conversation context.
- **Commits:** use the attribution trailer the executing harness specifies; never commit on `main`; one commit per task.

## Review Focus

Failure modes the spec implies but no spec test list covers; each has a pinning test in the owning task.

1. **Numeric input on a phone keyboard:** `22,5` (comma decimal), `10.5` reps, `-5`, `abc`, empty. Expect: comma accepted as decimal for kg, reps must be a whole number, negatives/garbage rejected without losing the other field. *(Task 4: `parseRepsInput`, `parseWeightInput`)*
2. **App left open past midnight:** "today" changes while the app is open. Expect: the date bar, Gym Missed availability and Restore all re-evaluate, and a stale "today" never allows logging sets into the wrong day. *(Task 2: `msUntilNextMidnight`; Task 10: `useToday`)*
3. **Month ends and DST:** "Last Month" from Mar 31 / Mar 30 / Aug 31, and date math across DST changes (2026-03-08 US, 2026-10-25 EU). Expect: clamp to the last day of the shorter month; no off-by-one days. *(Task 2, Task 8)*
4. **Blank or whitespace names:** an exercise name, routine title or backfill title of `"   "`. Expect: rejected with `EMPTY_NAME`, nothing saved, names stored trimmed. *(Task 5)*
5. **Unreadable stored data:** a corrupt/partial JSON bucket after a crash or a newer schema version. Expect: a clear "can't read saved data" screen; the store never overwrites or wipes what it could not parse. *(Task 9, Task 10)*

---

## File Structure

All paths under `app/` unless noted.

**Config / scaffold (Task 1):** `package.json`, `app.json`, `eas.json`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`, `global.css`, `global.css.d.ts`, `nativewind-env.d.ts`, `tsconfig.json`, `vitest.config.ts`, `AGENTS.md`, `CLAUDE.md`, `index.ts`, `App.tsx`, `assets/*`; repo-root `.gitignore`.

**Engine (pure, no RN/React imports), `src/engine/`:**
- `dates.ts` date-string math, weekday/month helpers, formatters, `msUntilNextMidnight`.
- `types.ts` row types, `DataState`, `Change`, `Ctx`, `EngineError`.
- `state.ts` `emptyState`, `applyChanges`, `mergeRemote` (last-write-wins), `createRecorder`, `getIndex`.
- `repeat.ts` `occursOn` for the four repeat rules.
- `schedule.ts` version lookup, occurrence moves, clash resolution, `scheduleOn`, `scheduleBetween`, `droppedOccurrences`, `nextOccurrence`.
- `dayLog.ts` `ensureDayLog`, `startBackfill`.
- `sets.ts` `prefillRows`, `syncSets`, `getSetsSheet`, `parseRepsInput`, `parseWeightInput`.
- `summary.ts` `exerciseSummary`, `dayVolume`, `dayTotals`.
- `scheduleEdits.ts` `addSchedule`, `changeSchedule`, `stopRoutine`, `addExercise`, `renameExercise`, `deleteExercise`, `routineTitleSuggestions`, `lockTodaysShift`.
- `clash.ts` `previewClashes`, `clashWarning`.
- `shift.ts` `gymMissedAvailable`, `skipToday`, `shiftToday`, `previewShift`, `restorableShift`, `restoreShift`.
- `dayView.ts` `getDay`, `earliestDataDate`.
- `csv.ts` `exportRange`, `buildCsv`, `csvFileName`.
- `*.test.ts` next to each file (`src/engine/__tests__/*.test.ts`, plus `__tests__/fixtures.ts` shared builders).

**Persistence, `src/data/` (no React imports except `GymProvider.tsx`/`hooks.ts`):**
- `storage.ts` `KeyValueStorage` interface, `MemoryStorage`, `asyncStorageAdapter`.
- `DataStore.ts` `DataStore`, `OutboxApi`, `OutboxEntry`, `StoreCorruptError`.
- `LocalStore.ts` bucketed AsyncStorage implementation + outbox.
- `GymStore.ts` in-memory optimistic store with serialized persistence.
- `ids.ts` `newId` (expo-crypto), `nowIso`.
- `GymProvider.tsx`, `hooks.ts` (`useGymState`, `useCtx`, `useToday`, `useActions`, `useLayout`).
- `index.ts` `createDataStore()`: the **one place** Plan 2 swaps the web store.

**UI, `src/`:** `theme.ts`, `components/` (`Sheet`, `Dialog`, `Button`, `IconButton`, `Badge`, `RadioRow`, `icons`, `TopBar`, `SyncStatusSlot`, `DateBar`, `DayBody`, `ScheduleBanner`, `ScheduleSheet`, `ExerciseList`, `ExerciseTile`, `SetsEditor`, `SetsSheet`, `GymMissedFab`, `GymMissedDialog`, `UndoBar`, `ExportSheet`, `BackfillSheet`, `StatsCard`), `screens/HomeScreen.tsx`, `screens/DesktopHome.tsx`, `export/saveCsv.ts` + `saveCsv.web.ts`.

---

### Task 1: Scaffold the Expo app, tokens, fonts, test runner

**Files:**
- Create: `app/` config files listed in File Structure, `.gitignore` (repo root), `app/src/theme.ts`, `app/src/engine/__tests__/smoke.test.ts`
- Reference (read, copy structure): `/Users/parijat.sutradhar/Projects/Financial_Tracker/app/{package.json,babel.config.js,metro.config.js,tailwind.config.js,app.json,eas.json,AGENTS.md,CLAUDE.md,global.css,global.css.d.ts,nativewind-env.d.ts,tsconfig.json,index.ts,assets/}`

**Interfaces:**
- Produces: `npm test` (= `vitest run`), `npm run typecheck` (= `tsc --noEmit`), `npm run web`, `npm run android`; `colors` export in `src/theme.ts` (hex tokens from Global Constraints); Tailwind color names `bg`, `surface`, `surface-2`, `border`, `ink` (#F4F6F1), `muted`, `faint`, `accent`, `on-accent`; font classes `font-sans`, `font-sans-medium`, `font-sans-semibold`, `font-mono`, `font-mono-medium` mapping to `Inter_400Regular/500Medium/600SemiBold`, `RobotoMono_400Regular/500Medium`.

Test runner: **Vitest**, because the engine is pure TS so it needs no Babel/React Native transform, starts in under a second, and runs TypeScript directly (jest-expo would add the RN preset for no benefit).

- [ ] **Step 1: Write the failing smoke test** `src/engine/__tests__/smoke.test.ts`: `import { expect, test } from 'vitest'; test('runner works', () => expect(1 + 1).toBe(2));`
- [ ] **Step 2: Run it** `cd app && npm test`. Expected: FAIL (no `package.json` yet).
- [ ] **Step 3: Write `package.json`** with the pinned dependencies from Global Constraints (name `gym-tracker-app`, `main: index.ts`, scripts above plus `start`, `ios` omitted), then `npm install`. Then `npx expo install expo-crypto expo-file-system expo-sharing`, `npm install lucide-react-native @expo-google-fonts/roboto-mono`, `npm install -D vitest@5.0.5`. Run `npx expo install --check` and fix any mismatch it reports.
- [ ] **Step 4: Mirror the Financial Tracker config files** with these differences: `app.json` name/slug/scheme `gym-tracker`, `userInterfaceStyle: "dark"`, Android `package: com.parijat.gymtracker`, adaptive-icon `backgroundColor: "#101211"`, `owner: parijatsutradhars-team`, `runtimeVersion.policy: appVersion`, plugins `["expo-font"]`; **omit** `updates.url` and `extra.eas.projectId` (Plan 2). `eas.json`: `cli.appVersionSource: local`; `build.preview` (`distribution: internal`, `channel: preview`, `android.buildType: apk`) and `build.production` (`autoIncrement: true`, `channel: production`), no env block. Copy `assets/` from Financial Tracker as placeholders (note it in the commit message). `tailwind.config.js` uses the tokens and font families above. `tsconfig.json` extends `expo/tsconfig.base`, `strict: true`. `vitest.config.ts`: `include: ['src/**/*.test.ts']`, `environment: 'node'`. `App.tsx`: import `./global.css`, load fonts with `useFonts` (Inter 400/500/600, Roboto Mono 400/500), render `null` until loaded, then a placeholder `<View className="flex-1 bg-bg items-center justify-center"><Text className="font-sans-semibold text-ink">Gym Tracker</Text></View>`, `StatusBar style="light"`. Root `.gitignore` copies Financial Tracker's (node_modules, .expo, dist, `.env*` except `.env.example`).
- [ ] **Step 5: Run** `npm test` → PASS; `npm run typecheck` → no errors; `npx expo export --platform web` → completes without error (this proves NativeWind + fonts + babel config load).
- [ ] **Step 6: Commit** `git add app .gitignore && git commit -m "feat(app): scaffold Expo SDK 57 app with NativeWind tokens, fonts, vitest"`

---

### Task 2: Dates, row types, state application, last-write-wins merge

**Files:**
- Create: `src/engine/dates.ts`, `src/engine/types.ts`, `src/engine/state.ts`
- Test: `src/engine/__tests__/dates.test.ts`, `src/engine/__tests__/state.test.ts`, `src/engine/__tests__/fixtures.ts`

**Interfaces:**
- Produces (`dates.ts`): `type DateStr = string`; `isValidDate(s: string): boolean`; `addDays(d: DateStr, n: number): DateStr`; `diffDays(a: DateStr, b: DateStr): number` (b minus a); `weekdayIndex(d: DateStr): 0|1|2|3|4|5|6` (0=Mon…6=Sun); `WEEKDAY_SHORT = ['Mon',…,'Sun']`; `WEEKDAY_FULL = ['Monday',…]`; `MONTH_NAMES`; `addMonthsClamped(d: DateStr, n: number): DateStr` (clamps to month end); `eachDay(from: DateStr, to: DateStr): DateStr[]` (inclusive, empty if from>to); `todayLocal(now: Date): DateStr` (uses local getters); `msUntilNextMidnight(now: Date): number`; `formatCount(n: number): string` (`4` → `"04"`); `formatKg(n: number): string` (`60`→`"60"`, `22.5`→`"22.5"`, max 2 decimals, no trailing zeros).
- Produces (`types.ts`):
  - `TableName = 'routines'|'routine_versions'|'days'|'shifts'|'occurrence_moves'|'day_exercises'|'sets'`; `BaseRow {id: string; updatedAt: string; deletedAt: string|null}`.
  - `RepeatRule = 'weekly'|'twice_weekly'|'biweekly'|'never'`.
  - `Routine {createdAt: string}`; `RoutineVersion {routineId; effectiveFrom: DateStr; title: string; repeatRule: RepeatRule; startDate: DateStr; exercises: string[]; ended: boolean}`.
  - `Day {date: DateStr; status: 'missed'|'skipped'|null; shiftId: string|null; routineId: string|null; title: string|null; hasLog: boolean}`.
  - `RowRef {table: TableName; id: string}`; `Shift {date: DateStr; mode: 'skip'|'catch_up'|'permanent'; locked: boolean; created: RowRef[]; before: Change[]}` (`before` = full prior rows to re-upsert on restore).
  - `OccurrenceMove {routineId; fromDate; toDate; shiftId}`; `DayExercise {date; position: number; name: string}`; `SetRow {dayExerciseId; setNumber: number; reps: number|null; weightKg: number|null}`.
  - `RowOf<T extends TableName>`; `Change = {[T in TableName]: {table: T; row: RowOf<T>}}[TableName]`; `DataState = {[T in TableName]: Map<string, RowOf<T>>}`; `Ctx {now(): string; newId(): string; today: DateStr}`; `class EngineError extends Error {code: 'EMPTY_NAME'|'READ_ONLY_FUTURE'|'NOT_EDITABLE_PAST'|'NO_ROUTINE'|'NOT_AVAILABLE'|'INVALID_RANGE'|'NOT_FOUND'}`.
- Produces (`state.ts`): `emptyState(): DataState`; `applyChanges(state, changes): DataState` (immutable; replaces rows by id, keeps tombstones); `mergeRemote(state, changes): {state: DataState; accepted: Change[]}` (a remote row wins only if its `updatedAt` is strictly newer than the local row's, or the row is absent); `createRecorder(state): {state(): DataState; apply(c: Change[]): void; changes(): Change[]}` (commands use it to read their own intermediate writes); `liveRows<T>(state, table: T): RowOf<T>[]` (excludes tombstones); `getIndex(state): Index` memoized per state object via `WeakMap` (live rows grouped: versions by routine sorted by `effectiveFrom`; day by date, lowest `id` wins on duplicates; day exercises by date sorted by `position` then `id`; sets by day-exercise sorted by `setNumber`; moves sorted by `updatedAt` then `id`).
- `fixtures.ts` exports `makeCtx(today: DateStr, startSeq?: number): Ctx` (deterministic ids `id-1`, `id-2`…, `now()` returns `today + 'T12:00:00.000Z'` plus a monotonically increasing millisecond), `run(state, changes)` = `applyChanges`, and builders added by later tasks.

- [ ] **Step 1: Write failing tests** in `dates.test.ts`:
  - `addDays_crosses_month_year_and_leap`: `addDays('2026-10-31', 1) === '2026-11-01'`, `addDays('2026-12-31', 1) === '2027-01-01'`, `addDays('2028-02-28', 1) === '2028-02-29'`, `addDays('2026-10-19', -19) === '2026-09-30'`.
  - `addDays_is_dst_safe`: `addDays('2026-03-07', 2) === '2026-03-09'`, `addDays('2026-10-24', 2) === '2026-10-26'`, `diffDays('2026-10-24', '2026-10-26') === 2`.
  - `weekdayIndex`: `2026-10-19` → 0 (Monday), `2026-10-25` → 6.
  - `addMonthsClamped_clamps`: `('2026-03-31', -1) → '2026-02-28'`, `('2028-03-31', -1) → '2028-02-29'`, `('2026-08-31', -3) → '2026-05-31'`, `('2026-05-31', -3) → '2026-02-28'`, `('2026-10-19', -1) → '2026-09-19'`.
  - `todayLocal_uses_local_calendar_date`: `todayLocal(new Date(2026, 9, 19, 23, 59)) === '2026-10-19'`; `msUntilNextMidnight(new Date(2026, 9, 19, 23, 59, 0)) === 60000`.
  - `formatCount_and_formatKg`: `formatCount(4)==='04'`, `formatCount(12)==='12'`; `formatKg(60)==='60'`, `formatKg(22.5)==='22.5'`, `formatKg(62.50)==='62.5'`, `formatKg(0.1+0.2)==='0.3'`.
  - `eachDay_inclusive`.
  In `state.test.ts`: `applyChanges_is_immutable_and_keeps_tombstones`; `mergeRemote_newer_updatedAt_wins`; `mergeRemote_older_or_equal_is_rejected`; `mergeRemote_tombstone_propagates` (remote row with `deletedAt` and newer `updatedAt` replaces a live local row); `getIndex_is_memoized_per_state`; `getIndex_picks_lowest_id_when_two_days_share_a_date`; `createRecorder_exposes_intermediate_state`.
- [ ] **Step 2: Run** `npm test -- dates state` → FAIL (modules missing).
- [ ] **Step 3: Implement** the files with the signatures above. Date math via `Date.UTC` only.
- [ ] **Step 4: Run** `npm test -- dates state` → PASS. `npm run typecheck` clean.
- [ ] **Step 5: Commit** `feat(engine): date helpers, row types, state application and LWW merge`

---

### Task 3: Repeat rules and schedule resolution (versions, moves, clashes)

**Files:**
- Create: `src/engine/repeat.ts`, `src/engine/schedule.ts`
- Test: `src/engine/__tests__/repeat.test.ts`, `src/engine/__tests__/schedule.test.ts`; extend `fixtures.ts` with `seedRoutine(state, ctx, {title, repeatRule, startDate, exercises?, createdAt?}): DataState` (creates a `routines` row and one `routine_versions` row with `effectiveFrom = startDate`).

**Interfaces:**
- Consumes: Task 2 `DateStr`, `addDays`, `diffDays`, `weekdayIndex`, `getIndex`, `RoutineVersion`, `OccurrenceMove`.
- Produces (`repeat.ts`): `occursOn(v: Pick<RoutineVersion,'repeatRule'|'startDate'|'effectiveFrom'|'ended'>, date: DateStr): boolean` — false if `v.ended`, if `date < v.effectiveFrom` or `date < v.startDate`; `weekly`: `diffDays(startDate,date) % 7 === 0`; `biweekly`: `% 14 === 0`; `twice_weekly`: `d % 7 === 0 || d % 7 === 3`; `never`: `date === startDate`. `REPEAT_LABELS: Record<RepeatRule,string>` = `{weekly:'Once a week', twice_weekly:'Twice a week', biweekly:'Once every 2 weeks', never:'Never'}`.
- Produces (`schedule.ts`): `interface Scheduled {routineId: string; versionId: string; title: string; repeatRule: RepeatRule; startDate: DateStr; exercises: string[]}`; `versionAt(state, routineId, date): RoutineVersion|null` (latest live version with `effectiveFrom <= date`); `scheduleBetween(state, from, to): Map<DateStr, Scheduled>`; `scheduleOn(state, date): Scheduled|null`; `droppedOccurrences(state, routineId, from, to): DateStr[]` (dates where this routine had an occurrence that lost a clash); `nextOccurrence(state, routineId, after: DateStr): DateStr|null` (scans up to 400 days, `null` if none).
- Resolution algorithm (decided here, since several tasks rely on it): per routine, for each day in the window, the version in effect (`versionAt`) yields a base occurrence if `occursOn`. Then apply live `occurrence_moves` in `updatedAt` order: a move re-dates the entry `(routineId, fromDate)` to `toDate` (no-op if no such entry, so chains Fri→Sat→Sun compose). The base window starts at `min(from, earliest live move.fromDate)`. A routine appears at most once per date. If two different routines land on a date, the one with the earlier `routines.createdAt` (tie: lower `id`) wins and the other's occurrence is dropped.

- [ ] **Step 1: Write failing tests.** `repeat.test.ts`, all with start `S = 2026-10-19` (Monday) unless noted:
  - `weekly_lands_on_S_plus_multiples_of_7`: true for `10-19`, `10-26`, `11-02`; false for `10-20`, `10-12` (before start).
  - `biweekly`: true `10-19`, `11-02`, `11-16`; false `10-26`.
  - `never_only_start`: true `10-19`; false `10-26`.
  - `twice_weekly_from_every_weekday` (table, expected occurrence offsets within the first 14 days are `{0,3,7,10}` from S): starts `10-19`→Mon+Thu, `10-20`→Tue+Fri, `10-21`→Wed+Sat, `10-22`→Thu+Sun, `10-23`→Fri+Mon, `10-24`→Sat+Tue, `10-25`→Sun+Wed. Assert the exact set of true dates in `[S, S+13]` for each, and that nothing before S is true.
  - `weekly_across_leap_day`: start `2028-02-22` lands `2028-02-29`.
  - `ended_version_never_occurs`.
  `schedule.test.ts`:
  - `clash_earlier_created_routine_keeps_the_day`: Chest & Tricep weekly start Mon `10-19` created first; Legs `twice_weekly` start Fri `10-23` created second. `scheduleOn('10-26').title === 'Chest & Tricep'`, `scheduleOn('10-30').title === 'Legs'`, `scheduleOn('11-02').title === 'Chest & Tricep'`, `scheduleOn('10-27') === null`; `droppedOccurrences(state, legsId, '10-19', '11-09')` equals `['2026-10-26','2026-11-02','2026-11-09']`.
  - `clash_tie_on_createdAt_uses_lower_id`.
  - `same_routine_never_duplicates_on_a_date`.
  - `version_in_effect_is_latest_not_after_date`: v1 from `10-19` title "Chest & Tricep", v2 from `11-02` title "Push" → `scheduleOn('10-26')` is Chest, `scheduleOn('11-02')` is Push.
  - `unlogged_past_day_keeps_planned_routine`: same setup, `scheduleOn('10-19')` still Chest & Tricep.
  - `moves_redate_an_occurrence`: weekly Arms start Fri `10-23` plus move `{fromDate:'10-23', toDate:'10-24'}` → `scheduleOn('10-24').title==='Arms'`, `scheduleOn('10-23')===null`, `scheduleOn('10-30')` is Arms.
  - `moves_chain_in_updatedAt_order`: moves Fri→Sat then Sat→Sun give Arms on Sun only.
  - `deleted_move_is_ignored`.
  - `ended_routine_releases_its_days_to_the_clashing_routine`: stopping the Monday-holding routine (new version `ended:true` from `10-26`) makes Legs appear on `10-26`.
  - `nextOccurrence`: weekly Sunday routine start `10-18` → `nextOccurrence(state, id, '2026-10-18') === '2026-10-25'`; never routine in the past → `null`.
- [ ] **Step 2: Run** `npm test -- repeat schedule` → FAIL.
- [ ] **Step 3: Implement** `repeat.ts` and `schedule.ts` per the algorithm above. `scheduleBetween` computes the whole window in one pass so the date bar and CSV stay cheap.
- [ ] **Step 4: Run** `npm test -- repeat schedule` → PASS.
- [ ] **Step 5: Commit** `feat(engine): repeat rules and schedule resolution with moves and clashes`

---

### Task 4: Day logs, sets, pre-fill, tile summary, volume, input parsing

**Files:**
- Create: `src/engine/dayLog.ts`, `src/engine/sets.ts`, `src/engine/summary.ts`
- Test: `src/engine/__tests__/dayLog.test.ts`, `sets.test.ts`, `summary.test.ts`; extend fixtures with `logSets(state, ctx, date, exerciseName, rows: [reps, kg|null][]): DataState` (uses `syncSets` with `includeUntouched: true`).

**Interfaces:**
- Consumes: Task 3 `scheduleOn`; Task 2 `Ctx`, `Change`, `createRecorder`, `getIndex`, `EngineError`.
- Produces (`dayLog.ts`): `ensureDayLog(state, ctx, date): Change[]` — if the date has no `Day` with `hasLog`, upserts the `Day` (`hasLog: true`, `routineId`/`title` snapshotted from `scheduleOn(date)` or kept from an existing status-only `Day`, status preserved) and one `DayExercise` per scheduled exercise (`position` 0..n-1); returns `[]` if already logged. If there is neither a log nor a scheduled routine, throws `NO_ROUTINE`. `startBackfill(state, ctx, {date, title}): Change[]` — only for `date < ctx.today` with no routine on that date and no log, else `NOT_AVAILABLE`; creates `Day {routineId:null, title: trimmed, hasLog:true}`; blank title → `EMPTY_NAME`.
- Produces (`sets.ts`): `interface SetDraft {reps: number|null; weightKg: number|null; touched: boolean}`; `normalizeName(s: string): string` (trim + lowercase); `prefillRows(state, date, exerciseName): SetDraft[]` (rows from the most recent *earlier* date (`< date`) that has logged sets for a day exercise of the same normalized name across all routines, else 3 empty rows; all `touched:false`); `getSetsSheet(state, ctx, date, position): {routineTitle: string; exerciseName: string; rows: SetDraft[]; prefilled: boolean; readOnly: boolean}` (persisted sets of that exercise as `touched:true` rows if any, else `prefillRows`; `readOnly` = `date > ctx.today`); `syncSets(state, ctx, {date, position, rows: SetDraft[], includeUntouched: boolean}): Change[]`; `parseRepsInput(text: string): number|null|'invalid'`; `parseWeightInput(text: string): number|null|'invalid'`.
  - `syncSets` semantics: row `i` maps to `setNumber i+1`. A row is *written* if `(row.touched || includeUntouched)` and it has `reps` or `weightKg`. Written rows upsert the set (creating the day log lazily via `ensureDayLog` only if at least one row is written or a persisted set must be deleted); non-written rows and persisted sets numbered above `rows.length` are soft-deleted if a persisted set exists at that number. If nothing needs to change it returns `[]` and creates no day log (peeking logs nothing). `date > ctx.today` → `READ_ONLY_FUTURE`. `position` outside the day's exercises → `NOT_FOUND`.
- Produces (`summary.ts`): `isLogged(set: SetRow): boolean` (= `reps !== null`); `exerciseSummary(state, date, position): {setCount: number; text: string}`; `dayVolume(state, date): number`; `dayTotals(state, date): {exercises: number; sets: number; volumeKg: number}`.
  - Summary text: logged sets exist → `"N sets · R reps · W kg"` using the heaviest logged set (highest `weightKg`, tie → more reps, then lowest set number), kg via `formatKg`; if no logged set has a weight → `"N sets · R reps"` with the highest reps; nothing logged → `"N sets"` where N is `prefillRows(...).length`. Singular: `"1 set"`. Volume = Σ reps × weightKg over logged sets with a weight (bodyweight excluded).

- [ ] **Step 1: Write failing tests.**
  `dayLog.test.ts`: `ensureDayLog_snapshots_title_and_exercises` (weekly Chest & Tricep with Bench press, Cable fly; log for `2026-10-19`: Day has `title 'Chest & Tricep'`, two day exercises at positions 0 and 1); `ensureDayLog_noop_when_logged` (returns `[]`); `ensureDayLog_without_routine_throws_NO_ROUTINE`; `startBackfill_creates_titled_empty_log_on_past_day`; `startBackfill_rejects_today_future_and_scheduled_days` (`NOT_AVAILABLE`); `startBackfill_blank_title_throws_EMPTY_NAME` and a padded title is stored trimmed.
  `sets.test.ts`:
  - `first_time_exercise_gets_three_empty_rows`: `prefillRows` → 3 rows, all `{reps:null, weightKg:null, touched:false}`.
  - `prefill_uses_most_recent_earlier_session_by_name_across_routines`: Bench press logged `10-12` in routine A as `[10,60],[8,62.5]`, and on `10-15` in routine B as `' bench PRESS'` with `[12,65]` → `prefillRows(state,'2026-10-19','Bench press')` equals `[{reps:12,weightKg:65,touched:false}]`; for date `10-15` it uses `10-12` (earlier only); a session dated after the date is ignored; a session whose sets all have `reps:null` is skipped.
  - `renamed_exercise_starts_fresh_history`.
  - `close_does_not_save_untouched_prefill`: `syncSets(..., includeUntouched:false)` with untouched pre-filled rows → `[]`, and no `days` row exists afterwards.
  - `done_saves_all_rows_as_shown`: `includeUntouched:true` writes 2 sets with the pre-filled values; the second call is idempotent in effect (same set ids reused, not duplicated).
  - `typing_one_value_saves_only_that_row`: rows `[untouched, touched{reps:8}, untouched]` → one set at `setNumber 2`.
  - `clearing_a_touched_row_deletes_the_set`; `shrinking_rows_tombstones_extra_sets`; `deleting_all_rows_tombstones_all_sets`.
  - `future_day_is_read_only`: `syncSets` on `2026-10-26` with `today 10-19` throws `READ_ONLY_FUTURE`; `getSetsSheet(...).readOnly === true`.
  - `past_day_is_editable`; `position_out_of_range_throws_NOT_FOUND`; `bodyweight_row_saves_reps_with_null_kg`.
  - Review Focus 1: `parseRepsInput`: `'10'→10`, `' 12 '→12`, `''→null`, `'10.5'→'invalid'`, `'-5'→'invalid'`, `'abc'→'invalid'`, `'1000'→'invalid'` (max 999). `parseWeightInput`: `'60'→60`, `'22,5'→22.5`, `'22.5'→22.5`, `''→null`, `'-1'→'invalid'`, `'1e3'→'invalid'`, `'1.2.3'→'invalid'`, `'1001'→'invalid'` (max 1000).
  `summary.test.ts`: `summary_uses_heaviest_set` (`[10,60],[12,62.5],[8,62.5]` → `"3 sets · 12 reps · 62.5 kg"`); `summary_bodyweight_only` (`[15,null],[12,null]` → `"2 sets · 15 reps"`); `summary_nothing_logged_uses_prefill_count` (`"3 sets"`; with a 4-row last session `"4 sets"`); `summary_singular`; `volume_excludes_bodyweight` (`[10,60],[12,62.5],[8,62.5],[9,null]` → `1850`); `totals_count_exercises_and_logged_sets`.
- [ ] **Step 2: Run** `npm test -- dayLog sets summary` → FAIL.
- [ ] **Step 3: Implement** the three files. Commands build on `createRecorder` so `syncSets` can read the day exercises `ensureDayLog` just wrote.
- [ ] **Step 4: Run** `npm test -- dayLog sets summary` → PASS.
- [ ] **Step 5: Commit** `feat(engine): day logs, set sync with pre-fill, summaries and input parsing`

---

### Task 5: Schedule edit commands (edit-forward), exercise edits, clash preview, suggestions

**Files:**
- Create: `src/engine/scheduleEdits.ts`, `src/engine/clash.ts`
- Test: `src/engine/__tests__/scheduleEdits.test.ts`, `src/engine/__tests__/clash.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4 (`versionAt`, `scheduleOn`, `droppedOccurrences`, `ensureDayLog`, `createRecorder`).
- Produces (`scheduleEdits.ts`), all `(state, ctx, args) => Change[]`:
  - `addSchedule(state, ctx, {date, title, repeatRule, exercises?: string[]}): Change[]` — `date >= ctx.today` else `NOT_EDITABLE_PAST`; creates `routines` row (`createdAt = ctx.now()`) and a version `{effectiveFrom: date, startDate: date, exercises: exercises ?? []}`. Blank title → `EMPTY_NAME`; title stored trimmed.
  - `changeSchedule(state, ctx, {routineId, date, title, repeatRule}): Change[]` — `date >= today`; requires a non-ended version in effect at `date` (else `NOT_FOUND`); creates (or updates in place if one exists with `effectiveFrom === date`) a version at `date` copying the exercises of the version in effect, with the new title; **re-anchors** (`startDate = date`) only when `repeatRule` differs from the previous rule, otherwise keeps `startDate`; tombstones all later versions of that routine.
  - `stopRoutine(state, ctx, {routineId, date}): Change[]` — version at `date` with `ended: true`, later versions tombstoned.
  - `addExercise(state, ctx, {date, name})`, `renameExercise(state, ctx, {date, position, name})`, `deleteExercise(state, ctx, {date, position})` — `position` is the 0-based index in `getDay(...).exercises` (the day's displayed list). Name trimmed; blank → `EMPTY_NAME`; no routine on the date and no log → `NO_ROUTINE`; out-of-range position → `NOT_FOUND`. Behavior by date: **future** → routine versions only; **today** → routine versions *and*, if the day has a log, today's day exercises (delete also tombstones that exercise's sets; rename keeps its sets); **past** → `ensureDayLog` then the day log only, never the routine. Version edits create/update a version at `date` and apply the same change by case-insensitive name to every later version of the routine (add appends if absent). Duplicate names are allowed.
  - `routineTitleSuggestions(state, query: string): {title: string; exercises: string[]}[]` — distinct by case-insensitive title across all routines including ended, most recently created first, filtered by case-insensitive substring of `query` (empty query → all); `exercises` = the routine's latest live version.
  - `lockTodaysShift(state, ctx): Change[]` — upserts `locked: true` on every live, unlocked shift with `date === ctx.today`. Called by every command above when `date >= ctx.today` (all except past-day edits), so a restore never has to untangle later edits. `syncSets` and `startBackfill` must **not** lock.
- Produces (`clash.ts`): `type ScheduleCommand = {kind:'add'; args: Parameters<typeof addSchedule>[2]} | {kind:'change'; args: Parameters<typeof changeSchedule>[2]}`; `interface ClashInfo {weekday: string; holderTitle: string; dates: DateStr[]}`; `previewClashes(state, ctx, cmd: ScheduleCommand, horizonDays = 182): ClashInfo[]` (applies the command to a scratch state and returns the routine's `droppedOccurrences` for `[date, date+horizon]`, grouped by weekday and holding routine); `clashWarning(clashes: ClashInfo[]): string|null` → e.g. `"Mondays are taken by Chest & Tricep."`; several clashes join with a space; none → `null`.

- [ ] **Step 1: Write failing tests** (`scheduleEdits.test.ts`; Chest & Tricep weekly Monday start `2026-10-19`, today `2026-10-19` unless stated):
  - `edit_forward_rename_and_repeat_leaves_earlier_dates_untouched`: with today `11-02`, `changeSchedule({date:'2026-11-02', title:'Push', repeatRule:'twice_weekly'})` → `scheduleOn('10-19')` and `'10-26'` are "Chest & Tricep"; `11-02` Push; `11-05` Push; `11-09` Push; `11-03` null.
  - `rename_only_keeps_the_anchor`: change on Wed `2026-11-04` title only → `scheduleOn('11-09')` is the new title and `scheduleOn('11-04')` is null.
  - `repeat_change_reanchors_to_the_chosen_date`: change on Wed `11-04` weekly→biweekly → `11-04` and `11-18` occur; `11-09` does not.
  - `change_on_same_effective_date_updates_in_place` (still one version at that date).
  - `change_tombstones_later_versions`.
  - `change_in_the_past_throws_NOT_EDITABLE_PAST`; `change_on_ended_routine_throws_NOT_FOUND`.
  - `stop_routine_ends_from_date`: stop on `11-02` → `scheduleOn('10-26')` present, `11-02` and later null; today's log of earlier days unaffected.
  - `deleting_exercise_today_does_not_touch_past_logs`: Bench press + Cable fly in the routine; a `2026-10-12` log exists with Cable fly sets; `deleteExercise` today on Cable fly → `getDay`-independent check: the `10-12` day exercise and its sets are still live; `scheduleOn('10-26').exercises` lacks Cable fly; an *unlogged* past day `10-05` still lists Cable fly via its older version.
  - `exercise_edit_today_updates_todays_log_too`: with a log for today, rename Bench press → "Flat bench" renames today's day exercise and keeps its sets; delete tombstones sets.
  - `exercise_edit_propagates_to_later_versions`: later version from `11-16` also receives the rename/add/delete.
  - `exercise_edit_on_past_day_changes_only_that_log`: routine versions unchanged (row count and `updatedAt` equal); the log has the change.
  - `exercise_edit_on_past_day_without_routine_or_log_throws_NO_ROUTINE`.
  - `blank_names_rejected_and_names_trimmed` (Review Focus 4: for `addSchedule`, `addExercise`, `renameExercise`; `"  Squat  "` stored as `"Squat"`).
  - `suggestions_are_distinct_recent_first_and_include_ended`: titles `Legs` (twice, different case), `Chest & Tricep`; query `'leg'` → one `Legs`; its `exercises` come from the latest version.
  - `schedule_edits_lock_todays_shift` (use Task 6's fixture-free construction: insert a `shifts` row `{date: today, locked:false}` directly): `addSchedule`, `changeSchedule`, `stopRoutine`, `addExercise`, `renameExercise`, `deleteExercise` on today/future each emit the locked shift; a past-day exercise edit does not.
  `clash.test.ts`: `legs_twice_weekly_from_friday_vs_chest_weekly_monday_warns` (add Legs `twice_weekly` on Fri `10-23`: `previewClashes` returns one entry `{weekday:'Mon', holderTitle:'Chest & Tricep'}`; `clashWarning` is exactly `"Mondays are taken by Chest & Tricep."`); `no_clash_returns_null`; `routine_that_wins_its_day_gets_no_warning` (changing the older Chest routine onto the newer Legs routine's day yields no clash for Chest); `warning_uses_the_candidate_horizon_only`.
- [ ] **Step 2: Run** `npm test -- scheduleEdits clash` → FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** `npm test -- scheduleEdits clash` → PASS; run full `npm test` to confirm no regression.
- [ ] **Step 5: Commit** `feat(engine): edit-forward schedule commands, exercise edits and clash warning`

---

### Task 6: Gym Missed: Skip, catch-up and permanent Shift Day, Restore

**Files:**
- Create: `src/engine/shift.ts`
- Test: `src/engine/__tests__/shift.test.ts`; extend fixtures with `seedWeek(state, ctx): DataState` (five weekly routines, one per Mon–Fri starting `2026-10-19`, created in order: Chest, Back, Legs, Shoulders, Arms; weekend rest) and `scheduleSnapshot(state, from, to): [DateStr, string|null][]` (date → title).

**Interfaces:**
- Consumes: `scheduleOn`, `scheduleBetween`, `ensureDayLog`, `versionAt`, `createRecorder`, `previewClashes` not needed.
- Produces (`shift.ts`):
  - `gymMissedAvailable(state, ctx): boolean` — today has a routine (`scheduleOn(today)`), no `Day.status` for today, and no logged sets today.
  - `skipToday(state, ctx): Change[]`; `shiftToday(state, ctx, mode: 'catch_up'|'permanent'): Change[]`; both throw `NOT_AVAILABLE` unless `gymMissedAvailable`.
  - `previewShift(state, ctx, mode): {text: string}` — catch-up: `"<Last routine in the run> moves to <WeekdayShort of the rest day>. Back to your usual days next <WeekdayFull of today>."` (e.g. `"Arms moves to Sat. Back to your usual days next Monday."`); permanent: `"<Today's routine title> moves to <WeekdayFull of tomorrow>s from now on."` (e.g. `"Chest & Tricep moves to Tuesdays from now on."`). If catch-up falls back to permanent (no rest day) the catch-up text equals the permanent text.
  - `restorableShift(state, ctx): Shift|null` — a live shift with `date === ctx.today`, `!locked`, whose day status is still set.
  - `restoreShift(state, ctx, shiftId): Change[]` — throws `NOT_AVAILABLE` unless that shift is the `restorableShift`; tombstones every row in `shift.created`, re-upserts every row in `shift.before`, clears today's status (the `Day` is tombstoned if the shift created it, otherwise its `status`/`shiftId` are cleared), tombstones the shift.
  - Used by the UI both for the 6-second Undo bar and the later Restore action (same command).
- Shift semantics (all modes): create a `shifts` row; `ensureDayLog(today)` so the day keeps its title and exercise snapshot (the day row and snapshot exercises, if newly created, go in `shift.created`; an already-existing `Day` goes in `shift.before`); set `Day.status` to `'skipped'` (skip) or `'missed'` (shifts) with `shiftId`. **Skip** changes nothing else.
  - **Catch-up:** `run` = consecutive days from today whose resolved schedule is non-empty, stopping before the first rest day among `today+1 … today+7`; each routine in the run gets an `occurrence_moves` row `{fromDate: d, toDate: d+1}` (the rest day absorbs the last). If none of `today+1 … today+7` is a rest day, behave exactly as permanent.
  - **Permanent:** for each live routine whose version in effect at `tomorrow` is non-ended (and, for `never`, whose `startDate >= today`): create a version `{effectiveFrom: tomorrow, startDate: oldStart+1 day}` copying that version; every *later* version of the routine is shifted (`effectiveFrom` and `startDate` +1 day) with its prior row in `shift.before`; every existing live move with `toDate > today` gets `toDate +1` (prior row in `before`); and if a routine occurs today only by a move (so it has no occurrence tomorrow after the above), add a move `today → tomorrow`.

- [ ] **Step 1: Write failing tests** (today `2026-10-19`, `seedWeek` unless stated):
  - `gym_missed_availability`: true with a routine, no status, no sets; false with no routine, after Skip, after a logged set, back to true after the only set is deleted (`syncSets` with `rows: []`), false on a past/future ctx.today mismatch is covered by constructing `ctx.today` elsewhere (e.g. a Tuesday with no routine).
  - `skip_marks_today_skipped_and_moves_nothing`: status `'skipped'`, `scheduleSnapshot` for 4 weeks equals the pre-skip snapshot, today's `Day.title === 'Chest'`.
  - `catch_up_example_split`: after shift, today status `'missed'`; titles for `10-19…10-26`: `[null→(Day keeps Chest), 'Chest','Back','Legs','Shoulders','Arms', null, 'Chest']` i.e. `10-20 Chest, 10-21 Back, 10-22 Legs, 10-23 Shoulders, 10-24 Arms, 10-25 null, 10-26 Chest, 10-27 Back`, and `scheduleOn('10-19') === null`.
  - `catch_up_with_no_rest_day_equals_permanent`: add weekly Cardio (Sat `10-24`) and Stretch (Sun `10-25`) so no rest day exists; two separate runs from the same state (`catch_up` vs `permanent`) give identical `scheduleSnapshot` for `10-19…11-30`.
  - `catch_up_shifts_compose_in_one_week`: first shift on `10-19`, then with `ctx.today = '10-20'` a second catch-up: `10-20` missed; `10-21 Chest, 10-22 Back, 10-23 Legs, 10-24 Shoulders, 10-25 Arms`, `10-26 Chest` (back to usual).
  - `permanent_moves_twice_weekly_and_never`: Chest `twice_weekly` Mon start `10-19` plus a `never` routine Arms on `10-21`; permanent on `10-19` → Chest on `10-20, 10-23, 10-27, 10-30` and not on `10-22`; Arms on `10-22` only.
  - `permanent_moves_weekly_biweekly_and_later_versions`: weekly routine with a later version from `11-02` → the later version now starts `11-03`; `10-26`'s occurrence is `10-27`.
  - `occurrence_present_only_via_a_move_moves_to_tomorrow`: single weekly routine Mon `10-19`; catch-up on `10-19` (→ Tue `10-20`); then permanent with `ctx.today='10-20'` → routine on `10-21` and `10-27`; none on `10-26`.
  - `restore_returns_the_exact_prior_schedule` (table over `skip`, `catch_up`, `permanent`): `scheduleSnapshot(10-19…12-31)` equals the pre-shift snapshot; `Day.status` null (and the Day tombstoned when the shift created it); the shift is tombstoned.
  - `restore_not_offered_after_a_schedule_edit`: after `addExercise` today (Task 5 lock) `restorableShift === null` and `restoreShift` throws `NOT_AVAILABLE`.
  - `logging_a_set_does_not_block_restore`.
  - `restore_not_offered_the_next_day` (`ctx.today = '10-20'`).
  - `preview_text_uses_real_names`: catch-up `"Arms moves to Sat. Back to your usual days next Monday."`; permanent `"Chest moves to Tuesdays from now on."`; no-rest-day catch-up text equals permanent text.
- [ ] **Step 2: Run** `npm test -- shift` → FAIL.
- [ ] **Step 3: Implement** `shift.ts` per the semantics above.
- [ ] **Step 4: Run** `npm test -- shift` → PASS; full `npm test` PASS.
- [ ] **Step 5: Commit** `feat(engine): Gym Missed skip, catch-up and permanent shift with restore`

---

### Task 7: DayView selector

**Files:**
- Create: `src/engine/dayView.ts`
- Test: `src/engine/__tests__/dayView.test.ts`

**Interfaces:**
- Consumes: Tasks 3–6.
- Produces:
  - `interface ExerciseView {position: number; name: string; setCount: number; summary: string}`.
  - `interface DayView {date: DateStr; kind: 'past'|'today'|'future'; status: 'missed'|'skipped'|null; routine: {routineId: string|null; title: string; repeatRule: RepeatRule|null; startDate: DateStr|null; source: 'log'|'schedule'|'backfill'}|null; exercises: ExerciseView[]; hasLog: boolean; canEditSchedule: boolean; canLogSets: boolean; canBackfill: boolean; canGymMissed: boolean; restoreShiftId: string|null; totals: {exercises: number; sets: number; volumeKg: number}; nextUp: DateStr|null}`.
  - `getDay(state, ctx, date): DayView`; `earliestDataDate(state, ctx): DateStr` (earliest of live `days` dates and routine version `effectiveFrom`s, else `ctx.today`).
- Rules: routine/title/exercises come from the day log when `hasLog` (titles "as they were"), else from `scheduleOn(date)`. A day with status but whose routine moved away still shows the title from its `Day`. `canEditSchedule = date >= today`; `canLogSets = date <= today && routine !== null`; `canBackfill = date < today && !routine && !hasLog`; `canGymMissed = date === today && gymMissedAvailable`; `restoreShiftId = date === today ? restorableShift(...)?.id : null`; `repeatRule`/`startDate` for a logged day come from `scheduleOn` or the routine's version in effect (null for backfill days). `nextUp = nextOccurrence(routineId, date)` when a live routine exists.

- [ ] **Step 1: Write failing tests:** `today_with_routine_lists_scheduled_exercises_and_summary` (Chest & Tricep four exercises, `exercises[0].summary === '3 sets'`, totals `{exercises:4,sets:12,volumeKg:0}`); `logged_day_uses_log_values_after_routine_rename` (past log keeps the old title and exercise names); `future_day_is_schedule_editable_but_not_loggable_flags` (`canEditSchedule true`, `canLogSets false`, `kind 'future'`); `past_unlogged_scheduled_day_lists_exercises_without_sets_and_cannot_edit_schedule`; `empty_past_day_can_backfill`; `backfilled_day_has_source_backfill_and_no_schedule_controls`; `missed_today_after_catch_up_shows_title_badge_status_and_restoreShiftId`; `restoreShiftId_null_after_edit`; `earliestDataDate`; `nextUp_for_weekly_routine`.
- [ ] **Step 2: Run** `npm test -- dayView` → FAIL.
- [ ] **Step 3: Implement** `getDay` and `earliestDataDate`.
- [ ] **Step 4: Run** `npm test -- dayView` → PASS.
- [ ] **Step 5: Commit** `feat(engine): day view selector for UI`

---

### Task 8: CSV generator and export ranges

**Files:**
- Create: `src/engine/csv.ts`
- Test: `src/engine/__tests__/csv.test.ts`

**Interfaces:**
- Consumes: `getIndex`, `scheduleBetween`, `addMonthsClamped`, `eachDay`, `formatKg`.
- Produces: `type ExportRangeKind = 'last_month'|'last_3_months'|'custom'`; `exportRange(kind, today: DateStr, custom?: {from: DateStr; to: DateStr}): {from: DateStr; to: DateStr}` (last month = `addMonthsClamped(today,-1)`→today; 3 months = `-3`; custom `to` is clamped to `today` because future dates are never exported; `from > to` → `EngineError('INVALID_RANGE')`); `buildCsv(state, from, to, today): string`; `csvFileName(from, to): string` = `gym-log_<from>_to_<to>.csv`; `CSV_COLUMNS = ['date','weekday','routine','exercise','set_number','reps','weight_kg','volume_kg','status']`.
- Rules (spec Section 4): header row then one row per logged set (`status` `logged`); `weekday` is `Mon…Sun`; blank `weight_kg` for bodyweight and blank `volume_kg` (else reps × kg via `formatKg`); `routine` and `exercise` are the day-log values; sorted by date, exercise order, set number. A day with no logged sets gets one row with empty exercise columns (`exercise,set_number,reps,weight_kg,volume_kg` blank): `missed` or `skipped` if it has that status; else `not_logged` if `date < today` and it has a scheduled routine (or a log with a routine) — not for today, never for rest days, never for future dates. RFC 4180 quoting (fields with comma, quote or newline quoted, quotes doubled), lines end with `\n`, file ends with a trailing newline. Sets with `reps === null` are not rows.

- [ ] **Step 1: Write failing tests** (Chest & Tricep weekly Monday from `2026-09-07`, today `2026-10-19`; logs: `09-07` Bench press `[10,60],[8,62.5]` and Pull-up `[12,null]`; `09-14` skipped; `09-21` missed; `09-28` nothing):
  - `header_and_columns_in_order`: first line is exactly `date,weekday,routine,exercise,set_number,reps,weight_kg,volume_kg,status`.
  - `set_rows`: lines `2026-09-07,Mon,Chest & Tricep,Bench press,1,10,60,600,logged`, `…,2,8,62.5,500,logged`, `…,Pull-up,1,12,,,logged`.
  - `status_rows`: `2026-09-14,Mon,Chest & Tricep,,,,,,skipped`, `2026-09-21,…,missed`, `2026-09-28,…,not_logged`.
  - `range_edges_are_inclusive`: `from 09-14, to 09-21` includes both days and excludes `09-07` and `09-28`.
  - `future_and_today_and_rest_days_produce_no_rows`: range through `2026-11-30` contains no row dated `10-19` (today, unlogged) or later, and none for non-Monday dates.
  - `names_are_as_logged_that_day`: rename the routine afterwards via `changeSchedule`; old rows keep the old title.
  - `quoting`: routine title `Legs, core` → `"Legs, core"`; exercise `5" plate` → `"5"" plate"`.
  - `sorted_by_date_exercise_order_then_set`: exercises logged in reverse still sort by position.
  - `ranges`: `exportRange('last_month','2026-10-19')` → `09-19…10-19`; `'last_3_months'` → `07-19…10-19`; Review Focus 3: `('last_month','2026-03-31')` → from `2026-02-28`; `('last_month','2028-03-31')` → `2028-02-29`; `('last_3_months','2026-08-31')` → `2026-05-31`; custom `to` in the future clamps to today; custom `from > to` throws `INVALID_RANGE`.
  - `empty_range_returns_header_only`; `csvFileName('2026-09-01','2026-10-18') === 'gym-log_2026-09-01_to_2026-10-18.csv'`.
  - `backfilled_day_exports_with_its_title`; `deleted_sets_and_exercises_are_not_exported`.
- [ ] **Step 2: Run** `npm test -- csv` → FAIL.
- [ ] **Step 3: Implement** `csv.ts`.
- [ ] **Step 4: Run** `npm test -- csv` → PASS.
- [ ] **Step 5: Commit** `feat(engine): CSV export generator and range helpers`

---

### Task 9: Local persistence and outbox

**Files:**
- Create: `src/data/storage.ts`, `src/data/DataStore.ts`, `src/data/LocalStore.ts`
- Test: `src/data/__tests__/LocalStore.test.ts` (covered by the existing `src/**/*.test.ts` include)

**Storage engine decision:** **AsyncStorage**, already proven in Financial Tracker, works on Android and on web (localStorage) with one API, atomic `multiSet`, and the data is small (one user, thousands of rows). SQLite was rejected: its web support is alpha and needs wasm and COOP/COEP headers, which would complicate the Vercel deploy in Plan 2. To stay under AsyncStorage's per-value read limit on Android, rows are split into 16 buckets per table keyed by the first hex character of the row `id`, and each outbox entry gets its own key.

**Interfaces:**
- Consumes: Task 2 types (`DataState`, `Change`, `applyChanges`, `mergeRemote`, `emptyState`).
- Produces (`storage.ts`): `interface KeyValueStorage {getAllKeys(): Promise<readonly string[]>; multiGet(keys: string[]): Promise<readonly [string, string|null][]>; multiSet(pairs: [string, string][]): Promise<void>; multiRemove(keys: string[]): Promise<void>}`; `class MemoryStorage implements KeyValueStorage` (with `snapshot(): Record<string,string>` and a `failNextWrite()` test hook); `asyncStorageAdapter: KeyValueStorage` (wraps `@react-native-async-storage/async-storage`; this is the only file importing it).
- Produces (`DataStore.ts`):
  - `interface OutboxEntry {seq: number; id: string; table: TableName; rowId: string; change: Change; at: string}`.
  - `interface DataStore {load(): Promise<DataState>; commit(changes: Change[]): Promise<void>; applyRemote(changes: Change[]): Promise<void>}` — `commit` persists rows **and** appends one outbox entry per change in a single `multiSet`; `applyRemote` merges last-write-wins and does **not** touch the outbox.
  - `interface OutboxApi {peek(limit: number): Promise<OutboxEntry[]>; ack(ids: string[]): Promise<void>; count(): Promise<number>; subscribe(fn: () => void): () => void}`.
  - `class StoreCorruptError extends Error`.
- Produces (`LocalStore.ts`): `class LocalStore implements DataStore, OutboxApi { constructor(storage: KeyValueStorage, deps: {newId(): string; now(): string}) }`. Keys: `gt:v1:meta` (`{schemaVersion: 1, outboxSeq: number}`), `gt:v1:row:<table>:<bucket>` (JSON array of rows), `gt:v1:ob:<seq zero-padded to 12>`. `load` reads everything, tolerates empty storage, and throws `StoreCorruptError` (writing nothing) if any value is unparseable or `schemaVersion` is newer than 1.

- [ ] **Step 1: Write failing tests** (`LocalStore.test.ts`, using `MemoryStorage` and a deterministic `deps`):
  - `empty_storage_loads_empty_state`.
  - `committed_rows_survive_restart`: `commit` two changes with store A; a *new* `LocalStore` on the same storage `load()`s state equal to `applyChanges(emptyState(), changes)`.
  - `commit_appends_one_outbox_entry_per_change_in_order`: `peek(10)` returns seq-ordered entries with the full change; `count() === 2`.
  - `outbox_survives_restart_and_keeps_sequence`: after restart a new commit continues from the previous `seq`.
  - `ack_removes_only_acked_entries`; `subscribe_fires_on_commit_and_ack`.
  - `commit_is_atomic`: `failNextWrite()` makes `commit` reject; storage is unchanged and `count()` is still the old value.
  - `soft_delete_is_stored_as_a_tombstone_and_enqueued`: a change with `deletedAt` is persisted and appears in the outbox (Plan 2 relies on this for delete sync).
  - `applyRemote_is_last_write_wins_and_skips_outbox`: remote older row rejected, newer accepted, `count()` unchanged.
  - `rows_spread_across_buckets_and_reload_identically` (60 sets with random-looking ids).
  - Review Focus 5: `corrupt_bucket_throws_StoreCorruptError_without_writing` (inject `'{not json'` under a row key; `load` rejects; `snapshot()` unchanged) and `newer_schema_version_throws_StoreCorruptError`.
- [ ] **Step 2: Run** `npm test -- LocalStore` → FAIL.
- [ ] **Step 3: Implement** the three files. `LocalStore` keeps the loaded buckets in memory so `commit` rewrites only touched buckets plus meta plus new outbox keys in one `multiSet`.
- [ ] **Step 4: Run** `npm test -- LocalStore` → PASS; full `npm test` and `npm run typecheck` PASS.
- [ ] **Step 5: Commit** `feat(data): bucketed AsyncStorage store with persistent outbox`

---

### Task 10: Store runtime, provider, hooks

**Files:**
- Create: `src/data/GymStore.ts`, `src/data/ids.ts`, `src/data/index.ts`, `src/data/GymProvider.tsx`, `src/data/hooks.ts`
- Modify: `App.tsx` (wrap in `GymProvider`; show a "Can't read saved data" screen on `StoreCorruptError` with the message and no destructive action)
- Test: `src/data/__tests__/GymStore.test.ts`

**Interfaces:**
- Consumes: Task 9 `DataStore`, `OutboxApi`; all engine commands.
- Produces:
  - `class GymStore { constructor(store: DataStore, deps: {newId(): string; now(): string}); init(): Promise<void>; getState(): DataState; subscribe(fn: () => void): () => void; dispatch(changes: Change[]): void; whenIdle(): Promise<void>; lastError: Error|null }` — `dispatch` updates in-memory state and notifies subscribers **synchronously**, then queues `store.commit(changes)` on a serial promise chain (writes persist in dispatch order; a failed write sets `lastError`, logs, and does not roll back the UI).
  - `ids.ts`: `newId(): string` (`expo-crypto` `randomUUID`), `nowIso(): string`.
  - `index.ts`: `createDataStore(): DataStore & OutboxApi` returning `new LocalStore(asyncStorageAdapter, {newId, now: nowIso})`. **This is the single place Plan 2 swaps the web implementation.**
  - `hooks.ts`: `useGymState(): DataState` (via `useSyncExternalStore`); `useToday(): DateStr` (`todayLocal(new Date())`, refreshed by a timeout of `msUntilNextMidnight` and on app foreground via `AppState`); `useCtx(): Ctx` (`{now: nowIso, newId, today}`); `useActions(): Actions`; `useLayout(): {isDesktop: boolean}` (`useWindowDimensions().width >= 900`).
  - `type Actions = {addSchedule(a): void; changeSchedule(a): void; stopRoutine(a): void; addExercise(a): void; renameExercise(a): void; deleteExercise(a): void; startBackfill(a): void; syncSets(a): void; skipToday(): void; shiftToday(mode): void; restoreShift(shiftId): void}` — each runs the engine command on `getState()` with a fresh `Ctx`, appends `lockTodaysShift` changes where the engine specifies, and dispatches. Engine `EngineError`s propagate to the caller.

- [ ] **Step 1: Write failing tests** (`GymStore.test.ts` with `LocalStore` over `MemoryStorage`): `dispatch_updates_state_and_notifies_synchronously` (listener called before `whenIdle` resolves); `writes_persist_in_dispatch_order` (50 rapid dispatches, then a new store loads all of them); `change_made_before_restart_is_present_after_restart_and_in_outbox` (create store, `addSchedule` + `syncSets`, `whenIdle`, build a second `GymStore` on the same storage, `init`, assert `getDay(...)` shows the logged set and `count() > 0`); `failed_write_keeps_ui_state_and_sets_lastError`; `init_propagates_StoreCorruptError`.
- [ ] **Step 2: Run** `npm test -- GymStore` → FAIL.
- [ ] **Step 3: Implement** `GymStore.ts`, `ids.ts`, `index.ts`; then `GymProvider.tsx` (holds one `GymStore`, renders nothing until `init` resolves, error screen on corrupt data), `hooks.ts`, and wire `App.tsx`. `Actions` should be a small table mapping action names to engine commands rather than 11 hand-written wrappers.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` clean; `npx expo export --platform web` builds.
- [ ] **Step 5: Commit** `feat(data): optimistic GymStore, provider and hooks`

---

### Task 11: UI foundation (theme, icons, primitives)

**Files:**
- Create: `src/components/{Sheet,Dialog,Button,IconButton,Badge,RadioRow,icons}.tsx`; modify `src/theme.ts`
- Reference: Financial Tracker `app/src/components/Overlay.tsx` (modal structure), `icons.tsx` (SVG icon style); `design/Gym Tracker · Recurrence selector.png`, `· Exercise sets.png`, `· Gym Missed.png`; `style.css` layers `/* Sheet handle */`, `/* Drag handle */`, `/* CSV export sheet */`, `/* Icon button */`, `/* Radio */`, `/* Range choice */`, `/* Modal scrim */`, `/* Gym Missed */` (`rg -n "layer name" style.css` then read ~40 lines).

**Interfaces:**
- Consumes: Tailwind tokens from Task 1.
- Produces:
  - `Sheet({visible, onClose, children, title?})` — mobile: RN `Modal` (transparent, `animationType="slide"`), scrim `rgba(0,0,0,0.72)`, bottom-anchored panel `bg-surface`, `rounded-t-[24px]`, padding `12px 20px 34px`, 36x4 handle `#697268`; when `useLayout().isDesktop`, the same content renders as a centered card (max width 440, `rounded-[24px]`, no handle). Tapping the scrim calls `onClose`.
  - `Dialog({visible, onClose, children})` — centered card, `bg-surface`, `rounded-[24px]`, scrim as above (Gym Missed dialog).
  - `Button({variant: 'primary'|'secondary'|'outline', label, onPress, icon?, disabled?})` — primary: accent fill, on-accent text, `rounded-[10px]`, height 52 (Done/Save/Download); secondary: surface-2; outline: 1px border. `IconButton({icon, onPress, accessibilityLabel})` — 44x44, `rounded-[10px]`, `bg-surface-2`. `Badge({tone: 'missed'|'skipped', label})`. `RadioRow({label, selected, onPress})` — row `bg-surface-2` `rounded-[10px]`; selected: accent 1px border, tinted background, accent label, filled accent radio dot (see Recurrence selector PNG).
  - `icons.tsx` re-exports Lucide icons used app-wide with token defaults: `Dumbbell`, `FileDown` (CSV top-bar button), `Download`, `Pencil`, `X`, `Repeat2`, `ChevronDown`, `CalendarDays`, `CalendarX`, `CalendarPlus`, `ArrowRight`, `ArrowLeft`, `Check`, `ArrowUpRight`. Wrapper `Icon({name, size = 20, color = colors.text})`.
- UI tasks cannot be unit-tested in Vitest; verification is typecheck plus a web export plus a visual check (below).

- [ ] **Step 1: Read** the listed PNGs (view them) and the `style.css` layers; note exact padding, radii, font sizes (Inter 600 14px names, Roboto Mono for numbers).
- [ ] **Step 2: Implement** the files above with NativeWind classes; no hard-coded hex outside `theme.ts`.
- [ ] **Step 3: Verify** `npm run typecheck`; temporarily render each primitive in `App.tsx`, run `npx expo start --web`, open at a 390x844 viewport, compare the Sheet/RadioRow/Button/Dialog against the PNGs; remove the temporary render. If no browser tool is available, record "visual check pending" in the commit body.
- [ ] **Step 4: Commit** `feat(ui): theme, Lucide icons, sheet, dialog and button primitives`

---

### Task 12: Home shell: top bar, date bar, month label, empty states

**Files:**
- Create: `src/components/{TopBar,SyncStatusSlot,DateBar,DayBody}.tsx`, `src/screens/HomeScreen.tsx`; modify `App.tsx` to render `HomeScreen`.
- Match: `design/Gym Tracker · Active workout.png` (top area), `· Empty schedule.png` (full), layers `/* Top bar */`, `/* Date navigation */`, `/* Scrollable dates */`, `/* Date */`, `/* Date number */`, `/* Day */`, `/* Month label */`, `/* Scroll hint */`, `/* Workout schedule */`.

**Interfaces:**
- Consumes: Task 10 hooks `useGymState`, `useCtx`, `useToday`; engine `getDay`, `earliestDataDate`, `addDays`, `eachDay`, `WEEKDAY_SHORT`, `MONTH_NAMES`; Task 11 primitives.
- Produces:
  - `TopBar()` — row height 60, padding 0 16: left `IconButton` (FileDown) opening the export sheet via prop `onExport`, centered "Gym Tracker" (Inter 600 ~20px), right Dumbbell mark in accent; renders `<SyncStatusSlot />` next to the mark (returns `null` now; **Plan 2 puts the unsynced dot / offline banner here**).
  - `DateBar({selected, onSelect})` — horizontal `FlatList`, chronological **left to right** (past ← today → future), items 58x68, gap 8, `rounded-[10px]`; selected card accent fill with on-accent text, unselected `bg-surface` with muted day (Inter 9px, e.g. `SAT`) and Roboto Mono 500 22px number; today's day label reads `TODAY`. Range `earliestDataDate` … today + 84 days. On open and when `today` changes, `scrollToIndex` puts today at the **left edge** (`initialScrollIndex` + `getItemLayout`). Month label above, left: uppercase `OCTOBER 2026` (Roboto Mono? use Inter 12px muted per PNG), updated from `onViewableItemsChanged` using the first fully visible date; scroll hint on the right reads `← Past days` (flipped from the PNG's `Past days →`).
  - `DayBody({date})` — vertical column below the date bar with page padding 20. This task renders only the empty state: for `canEditSchedule && !routine` a banner card (`bg-surface`, `rounded-[16px]`, height ~104, centered accent text `+ Add Schedule`; the `onPress` is wired in Task 13) followed by the "Make room for progress." empty state (CalendarPlus icon in a 72px `bg-surface` rounded tile, title `Make room for progress.` Inter 500 ~20px, body `Add a schedule to plan your routine. Your exercises and sets will live here.`, caption `YOUR NEXT REP STARTS WITH A PLAN` faint 10px uppercase). Later tasks add the other states to this file.
  - `HomeScreen()` — `SafeAreaView` bg `#101211`; owns `selected` state (default today; when `today` rolls over and `selected` equaled the old today, move it to the new today); renders `TopBar`, `DateBar`, `ScrollView` with `DayBody`.
- [ ] **Step 1: View** the PNGs and read the `style.css` layers for exact sizes.
- [ ] **Step 2: Implement** the components.
- [ ] **Step 3: Verify:** `npm run typecheck`; `npx expo start --web` at 390x844 shows today selected at the left edge with future days to the right and scrolling left reveals nothing earlier than today on a fresh install; the screen matches Empty schedule.png apart from the flipped date bar and hint. (Also confirm on Android via `npm run android` if a device/emulator is available.)
- [ ] **Step 4: Commit** `feat(ui): home shell with top bar, chronological date bar and empty state`

---

### Task 13: Schedule banner and Add/Change sheet

**Files:**
- Create: `src/components/{ScheduleBanner,ScheduleSheet}.tsx`; modify `DayBody.tsx`
- Match: `design/Gym Tracker · Active workout.png` (banner), `· Recurrence selector.png` (sheet), `· Empty schedule.png`; layers `/* Routine */`, `/* Routine title */`, `/* Change routine */`, `/* Recurrence control */`, `/* repeat-2 */`, `/* chevron-down */`, `/* Frequency */`, `/* Title */`, `/* Action */`.

**Interfaces:**
- Consumes: `getDay` (`DayView`), `useActions().addSchedule/changeSchedule/stopRoutine`, `routineTitleSuggestions`, `previewClashes`, `clashWarning`, `REPEAT_LABELS`, `Sheet`, `RadioRow`, `Button`, `Badge`; `EngineError`.
- Produces:
  - `ScheduleBanner({day, onAdd, onChange})` — set state: card `bg-surface` `rounded-[16px]` with routine title (Inter ~22px), `Change` button (secondary, right), and the repeat control row `↻ Once a week ⌄` (Repeat2 icon accent, label muted, ChevronDown; tapping it also opens the Change sheet). Empty future/today: `+ Add Schedule` card (Task 12 content moved here). Past days (`!canEditSchedule`): title read-only, no Change/repeat control, Missed/Skipped `Badge` if `day.status` (Task 16 adds Restore).
  - `ScheduleSheet({mode: 'add'|'change', date, day, visible, onClose})`: heading `Repeat schedule` (Inter ~22px) with close `X`; subtitle `<Title> · Starts today` when `date === today`, else `<Title> · Starts <Mon DD>` (Roboto Mono date); title `TextInput` (placeholder `Routine name`) above the options, pre-filled when changing; in **add** mode, typing shows tappable suggestions from `routineTitleSuggestions` (picking one fills the title and keeps its `exercises` for the save); four `RadioRow`s from `REPEAT_LABELS`, default `Once a week`; clash warning text (orange-ish: use `text-muted` with a warning icon; no new color tokens) from `clashWarning(previewClashes(...))`, recomputed on every title/rule change; `Save recurrence` primary button (disabled when the title is blank); in **change** mode a text button `Stop this routine from <Mon DD>` that calls `stopRoutine`. Save calls `addSchedule` (with `exercises` from a picked suggestion) or `changeSchedule` and closes. Engine `EMPTY_NAME` shows an inline message instead of throwing.
  - `DayBody` now renders `ScheduleBanner` plus the sheet.
- [ ] **Step 1: View** the PNGs; read the layers.
- [ ] **Step 2: Implement** the components and wire `DayBody`.
- [ ] **Step 3: Verify** in the web build at 390x844: Add Schedule on today with title `Chest & Tricep` shows the banner like Active workout.png; add a second routine twice-weekly starting a day that collides and see `Mondays are taken by ...`; Change on a future date, then browse back to today and see the old title; typecheck passes.
- [ ] **Step 4: Commit** `feat(ui): schedule banner and add/change schedule sheet`

---

### Task 14: Exercise list, tiles, quick add

**Files:**
- Create: `src/components/{ExerciseList,ExerciseTile}.tsx`; modify `DayBody.tsx`
- Match: `design/Gym Tracker · Active workout.png`; layers `/* Exercises */`, `/* Exercise heading */`, `/* Workout count */`, `/* Exercise tile */`, `/* Exercise information */`, `/* Exercise name */`, `/* Set summary */`, `/* Exercise input */`, `/* Placeholder */`.

**Interfaces:**
- Consumes: `DayView.exercises/totals/routine`, `useActions().addExercise/renameExercise/deleteExercise`, `formatCount`, icons `Pencil`, `X`.
- Produces: `ExerciseList({day, selectedPosition?, onSelect(position), hint?})`:
  - Heading row: `Exercises` (Inter 600 16px) and, right, the count in Roboto Mono: `04 exercises / 12 sets` from `day.totals` (`formatCount(exercises)`, sets plain); hidden when `!day.routine`.
  - `ExerciseTile` — height 64, `bg-surface`, `rounded-[10px]`, padding `0 4 0 14`; name (Inter 600 14px) over summary (Roboto Mono 10px muted) from `exercise.summary`; right side `Pencil` (inline rename: tile name becomes a `TextInput`, Enter/blur commits via `renameExercise`, Escape/empty cancels) and `X` (delete via `deleteExercise`), both 44x44 hit areas. Selected tile (desktop): accent 1px border and tinted background.
  - Quick-add row at the bottom: bordered `rounded-[10px]` field, placeholder `+ Type exercise name…`; Enter (`onSubmitEditing`) calls `addExercise` and clears the field, blank input does nothing.
  - Shown for today, future and past days that have a routine or a log. Edit controls respect `day.kind` automatically (engine routes edits to the right store); rename/delete/add errors from the engine (`EMPTY_NAME`) are ignored silently.
  - `DayBody` renders the list under the banner, with tap on a tile calling a prop `onOpenExercise(position)` (wired in Task 15).
- [ ] **Step 1: View** the PNG; read layers.
- [ ] **Step 2: Implement** and wire `DayBody`.
- [ ] **Step 3: Verify** (web 390x844): add four exercises, heading shows `04 exercises / 12 sets`; rename inline; delete; navigate to another future day and back, edits persist; reload the page and confirm everything survives; typecheck passes.
- [ ] **Step 4: Commit** `feat(ui): exercise list with inline rename, delete and quick add`

---

### Task 15: Sets editor and sheet

**Files:**
- Create: `src/components/{SetsEditor,SetsSheet}.tsx`; modify `DayBody.tsx`
- Match: `design/Gym Tracker · Exercise sets.png` (mobile sheet) and the right-hand "SET DETAILS" card of `· Desktop workout.png` (reused in Task 19); layers `/* Set row */`-like rows (grep `Reps`, `kg`), `/* Label */`, `/* Sheet handle */`.

**Interfaces:**
- Consumes: `getSetsSheet`, `useActions().syncSets`, `parseRepsInput`, `parseWeightInput`, `SetDraft`, `Sheet`, `Button`, icons.
- Produces:
  - `SetsEditor({date, position, onDone?, showDone, readOnly})` — the shared body used by the mobile sheet and the desktop panel. Local state `rows: SetDraft[]` initialised once from `getSetsSheet(state, ctx, date, position)` when mounted (key it by `date+position`). Header: eyebrow `CHEST & TRICEP` (routine title uppercase, accent, 10px), exercise name (Inter ~28px), subtitle `Dial in your reps. Build on your last set.`. Each row: `Set N` label (Inter 12px muted), reps field (Roboto Mono 22px, suffix `Reps`), kg field (suffix `kg`, `keyboardType="decimal-pad"`; reps `number-pad`), `X` delete icon. Fields are 48px tall, `bg-bg`, 1px `border`, `rounded-[10px]`.
  - Behaviour: every change updates `rows` (row `touched: true`) and immediately calls `syncSets({date, position, rows, includeUntouched: false})` — no debounce, no spinner. Invalid text (`'invalid'` from the parsers) keeps the typed text visible with a small `Invalid` caption under the row (no new color tokens) and does **not** overwrite the other field's saved value. `+ Add Set` (outline button, accent label) appends an untouched copy of the last row's values (or empty). Delete `X` removes the row and syncs. `Done` (primary, shown when `showDone`) calls `syncSets({... includeUntouched: true})` then `onDone`. When `readOnly` (future day) all inputs are disabled, `Done`/`+ Add Set` hidden, and a caption `Sets can be logged on the day.` is shown.
  - `SetsSheet({date, position, visible, onClose})` — `Sheet` wrapper around `SetsEditor` with a close `X` (top right); the `X` calls `onClose` **without** another sync (typed values are already saved; untouched pre-fills stay unsaved).
  - `DayBody` opens `SetsSheet` for the tapped tile on mobile.
- [ ] **Step 1: View** the PNGs; read the layers.
- [ ] **Step 2: Implement** and wire `DayBody`.
- [ ] **Step 3: Verify** (web 390x844): open an exercise for the first time: 3 empty rows; type reps/kg, close with `X`, reopen, values kept; log Bench press 10x60 x3 today with `Done`; tomorrow (future) shows read-only; after adding the same exercise name on a later day via Done the next week's sheet is pre-filled (use a past-day correction to simulate: log on yesterday, open today); close a pre-filled sheet with `X` and confirm today's summary still shows no sets; type `22,5` kg and see `22.5` saved; reload the page and confirm persistence; typecheck passes.
- [ ] **Step 4: Commit** `feat(ui): sets editor and sheet with pre-fill, instant save and Done`

---

### Task 16: Gym Missed FAB, dialog, Undo bar, badges, Restore

**Files:**
- Create: `src/components/{GymMissedFab,GymMissedDialog,UndoBar}.tsx`; modify `ScheduleBanner.tsx` (Restore), `DayBody.tsx`/`HomeScreen.tsx` (mount FAB and UndoBar)
- Match: `design/Gym Tracker · Gym Missed.png`; layers `/* Gym Missed */` (FAB: 134x48, `bottom 44`, `right 20`, accent, `rounded-[100px]`, CalendarX icon + `Gym Missed` Inter 600 14px on-accent), `/* Dialog heading */`, `/* Modal scrim */`.

**Interfaces:**
- Consumes: `day.canGymMissed`, `day.status`, `day.restoreShiftId`, `previewShift`, `useActions().skipToday/shiftToday/restoreShift`, `Dialog`, `Badge`, `Button`.
- Produces:
  - `GymMissedFab({visible, onPress})` — absolute bottom-right; rendered only when `day.canGymMissed`.
  - `GymMissedDialog({visible, onClose, day})` — step 1 (matches the PNG): CalendarX icon tile, close `X`, heading `Missed the gym?`, body `Life happens. Choose what to do with today's <Title> routine.`; **Shift Day** card (accent fill, ArrowRight icon on the right): title `Shift Day`, body `Move today's routine forward by 1 day, to <Weekday, Mon DD of tomorrow>.` (e.g. `Monday, Oct 19.`); **Skip** card (surface-2): `Skip` / `Mark today inactive. Keep the rest of your schedule as it is.`. Tapping **Skip** calls `skipToday()` and closes. Tapping the Shift Day card (its arrow) goes to step 2 **in the same dialog**: back arrow (`ArrowLeft`, returns to step 1), heading `Shift Day`, two selectable `RadioRow`-style cards, **`Catch up this week`** (listed first, selected by default) and **`Move my split for good`**, each with its `previewShift(...).text` below the label, and a primary `Shift` button calling `shiftToday(mode)` then closing.
  - `UndoBar({message, onUndo, onExpire})` — bottom bar `bg-surface-2` `rounded-[10px]`, text `Today skipped` (after Skip) or `Routine shifted` (after Shift) and an `Undo` text button (accent); auto-dismisses after 6 seconds; Undo calls `restoreShift(shiftId)`. Mounted in `HomeScreen`, driven by the id of the shift just created (read from `restorableShift`).
  - Badges and Restore in `ScheduleBanner`: when `day.status` is set, show `Badge` `Missed` or `Skipped` next to the title; when `day.restoreShiftId` is non-null also show a `Restore` secondary button calling `restoreShift`. After a schedule edit the engine returns `restoreShiftId = null`, so Restore disappears without any UI logic.
- [ ] **Step 1: View** the PNG; read the layers.
- [ ] **Step 2: Implement** and mount.
- [ ] **Step 3: Verify** (web 390x844 with Mon–Fri routines created on the right dates): Skip shows the Undo bar for ~6 s then the badge + Restore; Restore returns the day to normal; Shift Day → `Catch up this week` with Arms preview text → Shift moves routines (check tomorrow and the weekend); logging a set hides the FAB; deleting it brings it back; editing an exercise after a shift removes Restore; typecheck passes.
- [ ] **Step 4: Commit** `feat(ui): Gym Missed FAB, two-step dialog, undo bar, badges and restore`

---

### Task 17: CSV export sheet and save/share

**Files:**
- Create: `src/components/ExportSheet.tsx`, `src/export/saveCsv.ts`, `src/export/saveCsv.web.ts`; modify `HomeScreen.tsx` (open from the top-bar button)
- Match: `design/Gym Tracker · CSV export.png`; layers `/* CSV export sheet */`, `/* Date range options */`, `/* Range choice */`, `/* Radio */`, `/* Custom date range */`, `/* Date input */`, `/* Date value */`, `/* Export note */`, `/* download */`. Reference for date fields: Financial Tracker `app/src/components/DateField.tsx` and `DateField.web.tsx` (native picker + web `<input type="date">` split by platform extension); `@react-native-community/datetimepicker 9.1.0` (add with `npx expo install @react-native-community/datetimepicker` and its config plugin in `app.json`).

**Interfaces:**
- Consumes: engine `exportRange`, `buildCsv`, `csvFileName`, `useGymState`, `useToday`.
- Produces:
  - `saveCsv(csv: string, filename: string): Promise<void>` — native (`saveCsv.ts`): `const file = new File(Paths.cache, filename); file.create({ overwrite: true }); file.write(csv);` then, if `await Sharing.isAvailableAsync()`, `await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export your training' })` (Android share sheet: save to Downloads/Drive); web (`saveCsv.web.ts`): Blob (`text/csv;charset=utf-8`) + temporary `<a download>` click + `URL.revokeObjectURL`. Offline works since nothing leaves the device.
  - `DateField({value, onChange, maxDate})` in `src/components/DateField.tsx` / `DateField.web.tsx` styled as the PNG's `From Date`/`To Date` inputs (label Inter 10px muted, value Roboto Mono `Sep 01, 2026`, CalendarDays icon right).
  - `ExportSheet({visible, onClose})` — title `Export your training`, subtitle `Your workouts, sets and weights. In CSV.`, `RadioRow`s `Last Month`, `Last 3 Months`, `Custom` (expands `From Date` and `To Date` fields, default `From` = 30 days ago, `To` = today), primary `Download CSV` (Download icon), note `Includes all logged workouts in your selected range.` In Custom mode with `from > to` the button is disabled and an inline message `From date must be before To date.` shows. Download builds the CSV with the current state and calls `saveCsv`; success closes the sheet; a thrown error shows `Couldn't export. Try again.` inline.
- [ ] **Step 1: View** the PNG; read the layers; check https://docs.expo.dev/versions/v57.0.0/sdk/sharing/ for any Android config-plugin requirement and add it to `app.json` if listed.
- [ ] **Step 2: Implement**.
- [ ] **Step 3: Verify:** web: Custom range with some logged data downloads `gym-log_<from>_to_<to>.csv` whose contents match Task 8's format (open it); Android (emulator/device via `npm run android`): the share sheet appears; typecheck passes. If no Android device is available, state that this step is unverified on-device.
- [ ] **Step 4: Commit** `feat(ui): CSV export sheet with Android share sheet and web download`

---

### Task 18: Past days and backfill

**Files:**
- Create: `src/components/BackfillSheet.tsx`; modify `ScheduleBanner.tsx`, `DayBody.tsx`
- Match: `design/Gym Tracker · Empty schedule.png` (banner style reused for "Log a workout") and `design/Gym Tracker · Recurrence selector.png` (sheet style); spec Section 2 "Past days".

**Interfaces:**
- Consumes: `day.canBackfill`, `day.kind`, `useActions().startBackfill`, `Sheet`, `Button`.
- Produces:
  - Empty past day (`canBackfill`): the banner card reads `Log a workout` (accent text, same card as `+ Add Schedule`) and the empty-state copy beneath is replaced by `Nothing logged for this day.` (muted). Tapping opens `BackfillSheet`.
  - `BackfillSheet({date, visible, onClose})` — heading `Log a workout`, subtitle `<Mon DD> · One-off`, title `TextInput` (placeholder `Workout name`), primary `Start logging` button, disabled for blank titles; calls `startBackfill({date, title})`; afterwards the day renders with the title read-only and the normal exercise list/quick-add (so the owner adds exercises and sets as on any past day).
  - Past day with a routine: banner shows the routine title read-only, no `Change`, no repeat control, no Gym Missed; exercises are editable and sets loggable (engine already routes edits to that day's log); a never-opened scheduled past day shows its exercises with `N sets` (no logged values) and is never badged by the UI on its own.
  - Verify these flags are honored everywhere: `Add Schedule`, `Change`, Gym Missed and `Stop this routine` are absent on past days.
- [ ] **Step 1: View** the PNGs.
- [ ] **Step 2: Implement**.
- [ ] **Step 3: Verify** (web 390x844): create today's routine, browse to an earlier date: `Log a workout` → title → add `Squat`, log a set → the date is persisted and appears in the CSV; browse to a past day inside a routine's range (create a routine then use the date bar's earliest date): read-only title, editable sets; typecheck passes.
- [ ] **Step 4: Commit** `feat(ui): past-day correction and backfill`

---

### Task 19: Desktop layout

**Files:**
- Create: `src/components/StatsCard.tsx`, `src/screens/DesktopHome.tsx`; modify `src/screens/HomeScreen.tsx` (render `DesktopHome` when `useLayout().isDesktop`), `SetsEditor.tsx` only if a prop is missing
- Match: `design/Gym Tracker · Desktop workout.png` (1440x1000 reference); layers: grep the desktop frame section of `style.css` (`rg -n "Desktop" style.css`) for `/* Top bar */` (second occurrence), headings, `/* Workout count */`.

**Interfaces:**
- Consumes: `TopBar` parts, `DateBar`, `ScheduleBanner`, `ExerciseList` (with `selectedPosition`, `onSelect`, `hint`), `SetsEditor` (`showDone`), `GymMissedDialog`, `ExportSheet`, `ScheduleSheet`, `UndoBar`, `getDay`, `dayVolume`, `formatCount`, `formatKg`, `nextOccurrence`.
- Produces: `DesktopHome()` with a header bar (CSV `IconButton`, Dumbbell + `Gym Tracker`, nav label `Workout` accent, tagline `Your training, one day at a time.`, right-aligned date in Roboto Mono uppercase e.g. `SUN, OCT 18, 2026`), eyebrow `THE DAILY PRACTICE` (accent, 11px), heading `Today's workout` (or `Workout` plus the date for other days), top-right `Gym Missed` button (accent pill with CalendarX, same visibility rule as the mobile FAB, opens `GymMissedDialog`), two columns (max content width ~1280, gap 32):
  - **Left (≈50%):** `DateBar` (flipped direction as mobile; hint `← Past days`), `ScheduleBanner`, `ExerciseList` with hint `Select an exercise to edit its sets ↗`; the first exercise is selected by default and the selected tile is highlighted.
  - **Right:** `StatsCard` with three cells `EXERCISES` (`04`), `TOTAL SETS` (`12`), `VOLUME` (`1,850 kg`, total kg x reps from `dayVolume`; this replaces the PNG's "Focus: Push"; `—` when 0); then the sets panel card `SET DETAILS` (accent eyebrow), exercise name with a Pencil that renames inline, `SetsEditor` inline with its **`Done` button** (`showDone`), and the caption `All changes saved automatically` with a Check icon; below the panel `↻ Repeats every <Weekday> · Next up: <Month DD>` from the routine's repeat rule and `nextUp` (`Repeats every Sunday` for weekly, `twice a week`/`every 2 weeks`/`one-off` wording for the others: `Repeats twice a week`, `Repeats every 2 weeks`, `One-off`).
  - Footer: left `CONSISTENCY OVER EVERYTHING.`, right `METRIC / KG` (Roboto Mono, faint). Sheets (`ScheduleSheet`, `ExportSheet`, backfill) render as centered cards via `Sheet`'s desktop mode.
- [ ] **Step 1: View** the desktop PNG; read the layers.
- [ ] **Step 2: Implement**.
- [ ] **Step 3: Verify** (web at 1440x1000): the layout matches Desktop workout.png except the flipped date bar, the added Done button, and Volume instead of Focus; resizing below 900px switches to the mobile layout; selecting another exercise swaps the right panel; Done saves what is shown; typecheck passes.
- [ ] **Step 4: Commit** `feat(ui): desktop two-column layout with stats, inline sets panel and Done`

---

### Task 20: End-to-end verification and EAS preview check

**Files:**
- Modify: nothing expected (fix defects found, each with a regression test where the engine is involved)

- [ ] **Step 1:** `cd app && npm test && npm run typecheck && npx expo export --platform web` all pass.
- [ ] **Step 2: Manual walkthrough on web (390x844, then 1440x1000)**, offline-capable behaviour included: add a routine, log sets, Skip + Undo, Shift catch-up + Restore, edit an exercise after a shift (Restore disappears), backfill a past day, export CSV; reload the page after each group and confirm nothing was lost; open DevTools Application storage and confirm `gt:v1:ob:*` outbox keys exist and grow.
- [ ] **Step 3: Android:** `npm run android` (dev client/Expo Go as available): same walkthrough in airplane mode, kill and reopen the app and confirm data is intact, export CSV via the share sheet.
- [ ] **Step 4:** `npx eas-cli build --platform android --profile preview --non-interactive` is **owner-run** (needs `eas login` and project init); only confirm `eas.json` is valid with `npx eas-cli config --platform android --profile preview` if logged in, otherwise skip and list it in the report.
- [ ] **Step 5: Commit** any fixes `fix(app): issues found in end-to-end pass`

---

## Hand-off to Plan 2

Plan 2 (Supabase, FastAPI, login, sync, deploy) consumes exactly these:

- **Row types:** `src/engine/types.ts` (`Routine`, `RoutineVersion`, `Day`, `Shift`, `OccurrenceMove`, `DayExercise`, `SetRow`, each with `id`, `updatedAt` ISO string, `deletedAt`). Table names equal the `TableName` union; Plan 2's SQL tables use the same names, snake_case columns of these camelCase fields, plus `user_id` stamped server-side. `routine_versions.exercises` is a JSON/text array; `shifts.created` and `shifts.before` are JSON.
- **Change:** `{table, row}` full-row upserts; deletes are tombstones. Server push accepts a batch of `Change`s and applies last-write-wins by `updatedAt`.
- **Outbox API** (`OutboxApi` in `src/data/DataStore.ts`, implemented by `LocalStore`): `peek(limit)` returns `OutboxEntry[]` ordered by `seq`; push them, then `ack(ids)`; `count()` and `subscribe()` drive the unsynced indicator. Entries are not coalesced; Plan 2 may coalesce by `(table, rowId)` keeping the newest.
- **Pull:** `DataStore.applyRemote(changes)` merges last-write-wins without touching the outbox (backed by `mergeRemote`). The sync cursor is not stored yet; Plan 2 adds it (suggested key `gt:v1:meta`, field `syncCursor`).
- **Storage swap point:** `createDataStore()` in `src/data/index.ts`. Plan 2's online-only web returns a `RemoteStore implements DataStore` (load from API, `commit` posts changes, offline banner pauses `GymStore.dispatch`); the app keeps `LocalStore`. `GymStore` and everything above it stay unchanged.
- **Sync status hook point:** `src/components/SyncStatusSlot.tsx` (renders `null` now, mounted in `TopBar`): Plan 2 renders the unsynced dot from `OutboxApi.count()`/`subscribe()` there, and the web offline banner in `HomeScreen`/`DesktopHome` above `TopBar`.
- **Known sync caveats for Plan 2:** two devices that each create a `days` row (or `day_exercises`) for the same date offline produce two live rows; the engine deterministically uses the lowest `id` (`getIndex`), so Plan 2 should either keep both and rely on that, or add a unique `(user_id, date)` rule server-side with last-write-wins on collision. `Shift.locked` is a plain boolean synced like any row.
- **Not done here (Plan 2):** `.env.example`, `EXPO_PUBLIC_*` env vars in `eas.json`, `updates.url`/`extra.eas.projectId` in `app.json`, EAS Update, Vercel, `scripts/dev.sh`, login screen and session, owner setup checklist.
