Here is an improvised, clear, and structured design prompt tailored for Figma (or UI design tools/AI generators) that captures all your specifications with polished UX patterns.

---

# UI Design Spec: Minimalist Fitness / Gym Tracker App

**Platform Priority:** Mobile-first (iOS/Android 390x844px frame) with a responsive grid layout supporting Desktop Web view.
**Design Style:** Clean, high-contrast, modern fitness aesthetic (dark mode compatible, legible typography for mid-workout use).

---

## Screen Layout & Component Breakdown

### 1. Top Global Navigation Bar

* **Top-Left:** **CSV Export Icon Button** (Download/File icon). Clicking opens the **Export Modal**.
* **Scrollable Date Carousel (Below Top Bar):**
* Horizontal scrolling pill/date cards.
* **Present date** aligned to the left; past dates scrollable to the right/back.
* Selected date features a prominent active fill state (accent color), while unselected dates appear muted.



### 2. Schedule Banner Section

* **Location:** Directly beneath the date carousel.
* **States:**
* **No Schedule Added:** A prominent centered primary button reading **"+ Add Schedule"**.
* **Schedule Added:** Displays the routine title (e.g., *"Chest & Tricep"*) with a secondary inline **"Change"** button beside it.


* **Recurrence Expansion Box (Accordion / Bottom Sheet):**
* Triggered when clicking "Add" or "Change".
* Contains a clean radio-button or pill selection list for frequency: `[ ] Once a week`, `[ ] Twice a week`, `[ ] Once every 2 weeks`, `[ ] Never`.



### 3. Exercise List Section

* **Card Container:** A clean vertical list of active exercises for the selected day.
* **Item Layout:** Each exercise card displays its name on the left, with small, touch-friendly **Edit (Pencil icon)** and **Delete (Cross/Trash icon)** icons aligned to the right.
* *Note:* Editing/Adding modifies the exercise name inline or via a quick text prompt.


* **Add Exercise Row:** Positioned at the very bottom of the exercise list as a persistent, dashed-border input box with placeholder text: `+ Type exercise name & press enter...` mimicking the list element style.

### 4. Exercise Set Detail View (Modal / Bottom Sheet)

* **Trigger:** Tapping any exercise tile opens a detailed configuration overlay/box.
* **Header:** Exercise Name + Close (`X`) button.
* **Set Rows:** Defaults to 3 rows (`Set 1`, `Set 2`, `Set 3`).
* Layout per row: `[Set Label]  ---  [Reps Input Field] Reps  ---  [Weight Input Field] kg  ---  [Delete Icon (Right)]`


* **Add Set Button:** Positioned at the bottom of the set list as a tile button reading `+ Add Set`.

### 5. "Gym Missed" Action

* **Placement:** Fixed floating button (FAB) or anchor button at the **bottom-right** of the day's main view, labeled **"Gym Missed"**.
* **Dialog Modal:** Clicking opens a confirmation popup with two distinct action buttons:
1. **"Shift Day"** (Subtext: *Pushes all subsequent exercises forward by 1 day*)
2. **"Skip"** (Subtext: *Dismisses workout for today without shifting*)



### 6. CSV Export Dialog Box

* **Trigger:** Tapping the Top-Left CSV Export button.
* **Modal Content:**
* Header: *Export Exercise Records*
* Radio options: `[ ] Last Month`, `[ ] Last 3 Months`, `[ ] Custom Range`.
* **Conditional Custom Section:** Selecting "Custom" smoothly expands two input fields: **From Date** and **To Date** pickers.
* Primary Action Button: **"Download CSV"**.