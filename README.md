# Recomp

Personal nutrition + training tracker for a body recomposition. Replaces the
food log that lived in two claude.ai chats (Aug 14 – Sep 13, 2026) and died
at the attachment limit.

**The app is `docs/` — a single web page that runs entirely on your phone.**
No server, no laptop, nothing to keep running, $0.

- Data lives on the phone (IndexedDB) and is backed up to a private GitHub repo.
- Photos go from your phone to Gemini's free tier with your own key.
- Your Renpho weigh-ins are pulled by a free GitHub Actions job every 3 hours,
  or on demand from the app.

`app.py` and `recomp/` are the earlier laptop version (FastAPI + SQLite). They
still work but are not the primary app any more; `tools/export_seed.py`
turned that database into `data-repo/seed.json` for the phone app.

## What the MyFitnessPal reviews taught it

MyFitnessPal is the most-installed tracker on Google Play. In its 300 most
recent US reviews (July 2026) 202 were 1–3 stars, and the complaints are
unusually consistent. Each one is a design decision here:

| What people leave MFP over | Recomp |
| --- | --- |
| Barcode scanner moved behind Premium (29% of low reviews mention the paywall) | **Scan** reads the barcode on the phone itself and looks it up in Open Food Facts — open data, no key, no account — and falls back to reading the printed panel. Nothing is paywalled; there is no Premium. |
| The 2026 redesign made logging "4–5 taps", a "scavenger hunt through menus" | A regular is two taps (Meal → chip). A shake is two. The one primary action sits pinned at the bottom of every sheet. Nothing moves between versions to sell you something. |
| Random logouts, two years of history lost | No account, no login. Data lives on the phone; back up to your own GitHub repo, or *Save a copy* to Drive / a file, or export CSV. |
| Ads, full-screen upsells, $19.99/month | None. Free, open source. |
| Crowd-sourced database: three calorie counts for one product, duplicates, "no results" | No crowd database. Photos and descriptions are identified against a curated reference table with honest ranges; packaged food comes from the label or Open Food Facts; the confidence is shown on every card and the model's own guesses are flagged. |
| Wearable sync that double-counts or drops exercise | Sessions are counted once and move calories between days; they never inflate the week. The expenditure figure is measured from your own intake and weight, not a formula. |
| A calorie goal that is too low (the "1200" complaint) | First-week targets come from your own facts and are floored at resting needs; after a week the app measures your real expenditure and takes over. |
| Nag notifications | None. The streak is on screen, not in your notification tray. |

Across the whole category — a 50,217-review analysis of MyFitnessPal, Yazio,
Lose It!, Cronometer and Lifesum (Jan 2024 – Mar 2026), and a six-app ranking
of 1–3 star reviews — the same list comes back with a few more items:

| Category-wide complaint | Recomp |
| --- | --- |
| Ads (27% of all complaints; 34% at MFP) and price (26%) | None. |
| Inaccurate data (16%), database gaps and missing regional food (10%) | Regional food is exactly what the photo-and-description route is for; every card shows its confidence and range. |
| Shame mechanics (12%): colour-coded foods, red screens, guilt copy | No food is colour-coded. A day over the band is orange, never red, and the card says what actually matters: the week's average. |
| Streak anxiety (6%): "missed one day and lost a 47-day streak", "made me lie in the log" | One missed day in any seven doesn't break the streak, and the app never mentions losing one. |
| "Doesn't retain foods you've entered before", "have to search for everything" | Type two letters and your own past entries appear as one-tap chips. Regulars (eaten 3+ times) stay one tap without typing. |
| Data export and deletion locked away (5%) | Save a copy, Export CSV, and **Delete everything** are all in Settings, all free. |
| Wearable sync that double-counts (11%, Android twice iOS) | No wearable sync yet — and no double counting. |

Sources: Unstar, *Is MyFitnessPal Premium worth it? 202 reviews* (July 2026);
Unstar, *6 calorie tracking apps ranked by 1-star reviews* (2026); Nutrola,
*50,000 calorie tracker reviews analysed* (2026); Trustpilot MyFitnessPal 1-star
reviews (Jul–Sep 2026); Bento Bunny on the 2026 MFP redesign; PissedConsumer.

Set-up asks for a minute of facts (units, sex, age, height, weight, activity,
goal, and body fat if you have a number) and derives the first week's targets.
With body fat known: Cunningham resting rate on fat-free mass, protein
2.8–3.3 g per kg of fat-free mass for recomp or a cut (Helms 2014; the recomp
trials sit near 2.4–2.5 g/kg body mass). Without: Mifflin-St Jeor and 2.0–2.4
g/kg body mass. Maintain or gain: 1.6–2.0 g/kg. Recomp is 250 kcal under
maintenance on a rest day, sessions on top; the base is never below resting
needs. Targets already on the phone are the person's: redoing setup
shows both and asks — Keep my targets, or Use suggested. Workout kinds are your own
(Settings), weight shows in kg or lb, and the log never depends on the AI
being up — a meal that can't be valued is parked in the log and valued later
on its own.

## Set up once (about 20 minutes, all free)

### 1. Private data repo

1. On GitHub create a **private** repo, e.g. `recomp-data`.
2. Push the contents of `data-repo/` to it (`renpho_pull.py`, the workflow,
   `README.md`, and `seed.json`).
3. Repo → Settings → Secrets and variables → Actions → **New repository secret**:
   `RENPHO_EMAIL` and `RENPHO_PASSWORD` (your Renpho Health login).
4. Actions tab → **Pull Renpho weigh-ins** → Run workflow. `body.json` appears
   with your whole scale history. It then runs itself **every 3 hours**, and
   the app's *Pull weigh-ins* button asks it to run right now.
5. GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Generate new token:
   - **Expiration:** pick the longest you're offered (custom, up to a year)
     and note the date. When it lapses, backups and weigh-in pulls stop; the
     app shows a red banner on the Today screen, so you'll know — but you
     have to come back here and make a new one.
   - **Repository access:** Only select repositories → `recomp-data`.
   - **Permissions → Repository permissions:** the list starts nearly empty.
     Click **+ Add permissions** (or the dropdown) and set two:
     **Contents → Read and write** (data), and **Actions → Read and write**
     (lets *Pull weigh-ins* run the Renpho job on demand instead of waiting
     for the schedule). Leave **Metadata** at the Read-only it forces on.
     Nothing else. Without Actions the app still works — the button just
     reads whatever the last scheduled run fetched.
   - Generate, copy the token now (it's shown once).

### 2. The app page

1. Push this whole folder to a **public** repo, e.g. `recomp` (it contains
   no data or secrets — `.gitignore` keeps `.env`, `data/`, `seed.json` out).
2. Repo → Settings → Pages → Source: Deploy from a branch, Branch `main`,
   folder **`/docs`**. Save. Your URL is `https://<you>.github.io/recomp/`.

### 3. Gemini key

[aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Create API
key. The app uses `gemini-3.6-flash` (Google closed 2.5 Flash to new keys); if
Google retires a model it names the replacement in the error, and the app
switches to it automatically. Free tier, no card: ~1,500 requests/day on the Flash models, 500/day with
search grounding. Note: free-tier prompts (your food photos) may be used by
Google to improve their models.

### 4. On the phone

1. Open your Pages URL in Chrome → menu ⋮ → **Install app** (on some
   versions: "Install and create shortcut" → **Install**). Choose *Install*,
   not *Create shortcut* — a shortcut just opens Chrome; the installed app
   runs full-screen and offline.
2. Settings (the gear, top right): paste the Gemini key, the GitHub token, and `you/recomp-data`.
3. Trend tab → **Advanced → Import file** with `seed.json` (once; it also
   restores your targets) → **Fetch scale now**.
4. Check Settings once: the public source ships with placeholder targets; the
   import overwrites them with yours, but confirm they look right.

That's it. From then on: weigh in each morning (the workflow fetches it),
photograph or describe what you eat, tap Add.

## What it does

The look and the interaction borrow from Duolingo: one heavy rounded face,
2 px-bordered cards, chunky buttons that press down, thick rounded progress
bars, tinted option cards, a bottom nav with big icons, a haptic tick on every
press, and a streak. Green is protein and done, blue is calories, purple is
training, orange is attention, red is over.

**Today** is your status and your log. The top strip shows the logging streak
(lit once today counts as a complete day — 60% of your rest-day base, at most
1,000 kcal — and forgiving of one missed day a week) and the latest weigh-in. The status
card has the verdict ("Day complete" / "Protein first" / "Over the calorie
band"), protein and calorie bars, and four daily goals with check marks
(protein floor, calories, weigh-in, session). Then everything logged today,
then a week card. The bottom nav is Today, Trend, and the three inputs, which
open as sheets with the one primary action pinned at the bottom:

- **Meal** — *Regulars* are learned from your own log (eaten 3+ times,
  frequency with recency decay), one tap to repeat, × to hide. **Photo of
  food** and **Scan packages** both open the phone's own chooser (camera or
  gallery, several at once). Each scanned package becomes an *item* with its
  own servings / grams — a can of tuna, four slices of bread and two of cheese
  are three items with three quantities — and one Add logs them as their own
  rows. Items are counted in the unit you think in — slices, cans, eggs —
  from the pack's own serving text, or a typical weight when the base has no
  serving size (said so on the card, with a **Read the label** button that takes
  the real serving, and the numbers, from a photo of the panel). Photos and text
  go to the model with the packaged items named as already counted, so nothing
  is counted twice. **Camera**, **Gallery** (pick existing
  photos), or **Label** (a nutrition panel → exact values, then how much you
  had). A scan is a barcode (Open Food Facts, no key) with the printed panel
  as the fallback. Describe it, set your share (All / ½ / ⅓ / ¼), **Estimate**.
  Refine with a correction; Add to log. "Type it in" for the rare manual entry.
- **Shake** — typed grams, product pickers, exact arithmetic; opens on what
  you made last time. **＋ New tub or carton** opens the product form with
  **Read the label**: photo → per-100ml or per-gram values filled in.
- **Workout** — your own kinds (Settings; classes, run, swim, cycle, walk…) take
  minutes, km, and kcal if your watch or Strava shows it — or **From
  screenshot**, which reads those off a Strava/Garmin/REVL summary. A kcal
  figure overrides the per-kind default. **Strength** is anything with sets —
  weights, calisthenics, core: an exercise (free text, with suggestions), sets,
  reps (`15`, `30s` for a hold, `10/side`) and kg (blank = bodyweight). Or paste
  a whole session written the usual way (`Push-ups: 3 x 15`,
  `Side planks: 3 x 30 sec per side`); a heading with a weight in it
  (`Calf work with 10kg vest:`) applies to the lines under it. The Trend tab's
  Training card tracks barbell lifts by estimated 1RM and everything else by
  best set.

Weigh-in by hand and backups live under **Trend → Scale**.

Tap any logged row to **edit** it (label, numbers, time), **log it again**,
value it with AI, or delete it.

**Photo or description → estimate.** Gemini identifies the dish and its
components and maps each to a row in the app's Singapore reference table
(`docs/js/foods.js`, ~70 hawker dishes and components). The **app** does the
arithmetic from that table — deterministic, same answer every time. The model
only supplies its own figures for things the table doesn't know, and those
are flagged. Name the venue and the model uses the published figures it knows
for chains; Google-grounded search is not on the free tier for the 3.x models.
Free-tier quotas are per model per day: when one is used up, or a model is
overloaded (503), the app tries the next Flash model and remembers which one
answered. If none does, the meal still goes into the log at once as an
row with a **rough guess** — from your own past meals of the same dish, else
the reference table — marked "~" and "rough guess", with its text and photos
kept; the app replaces it with a proper estimate on its own
when Gemini is back (on open, on return to the app, every 2 min while open),
or you tap the row and type it in. A logged meal is never lost to an outage.

**Sessions move calories between days; they never inflate the week.** Each
logged workout raises *that day's* target by its burn — measured kcal when you
have it, else a per-kind default (Settings). Before the engine has data,
`provisional_kcal` is the **rest-day base**. Once measured, the engine takes
the sessions you actually logged in the window back out of the measured
average to get a rest-day base, then adds each session back on the day it
happens — a 3-day week is told to eat less than a 5-day week by exactly the
sessions skipped. No session count is ever assumed.

**Expenditure without a formula.** After ~7 complete days with weigh-ins
outside the creatine window, the calorie band comes from your own intake vs.
the least-squares slope of your weight — never BMR × multiplier (the thing
that double-counted REVL and produced the old 2,500 ceiling).

**Trend tab.** Weight readings, trend line, body-fat % (dashed), your target
band, creatine settling window; the expenditure estimate; **Lifts** (appears
once you've logged a strength set) — best estimated 1RM per exercise against
the 100 kg goals; **Scale** — how old the newest weigh-in is and a *Fetch scale
now* button. Backups, restore and file export live under *Advanced* because
they run on their own or are for a new phone.

**The chat import.** `data-repo/chat_fixes.json` carries hand-checked values
and corrections for the imported rows, applied automatically whenever a new
version lands in the private repo. Anything still marked `?` can be valued by
tapping the row; a **Value ? rows with AI** button appears only while such rows
exist.

**Weigh-ins.** The scale talks to Renpho's cloud, not to your phone, so a
GitHub Actions job fetches it. It runs every 3 hours; *Pull weigh-ins* on the
Trend tab dispatches it immediately and waits (~40 s) for the result. The Data
section always shows how old the newest weigh-in is, so a stale number is
never a mystery.

**Backups.** Every change marks the data dirty; a snapshot goes to
`backup.json` in the private repo a few seconds later, when the app is
hidden, or on next open if it didn't get out. Restore on a new phone with one
tap (after entering the token, which is deliberately *not* in the backup). If
GitHub rejects the token, a red banner appears on Today until the next success.

## Privacy note on this public repo

Nothing personal is in the source: targets in `docs/js/db.js` are neutral
placeholders, your real ones live in settings on the phone and in the private
repo's `seed.json` / `backup.json`. `.gitignore` keeps `.env`, `data/`
and the seed out of git.

## Layout

```
docs/               the phone app (GitHub Pages)
  index.html · css/style.css · sw.js · manifest.webmanifest
  js/db.js          IndexedDB layer + settings + dump/restore
  js/foods.js       quick-add, reference table, products, shake(), computeFromIdentification()
  js/engine.js      weight trend (EMA display, OLS rate) + expenditure + verdict
  js/estimate.js    Gemini: one structured identification call, free-tier limit handling
  js/sync.js        GitHub Contents API: body.json, seed.json, backup.json
  js/barcode.js     BarcodeDetector + Open Food Facts → the label-reader shape
  js/app.js         UI
  test/             node --test "docs/test/*.test.mjs"
data-repo/          template for the private repo (workflow + renpho_pull.py + seed.json)
tools/export_seed.py  SQLite → seed.json
app.py, recomp/, static/, tests/   the laptop version (optional)
```

## Re-importing the chat later

If you export the claude.ai chats again, rebuild the seed on the PC with
`run_backfill.py --export <zip> --until <last chat-only day>` then
`tools/export_seed.py`, push `seed.json`, and use **Import chat log** — but
the app is the log now; the chat should be retired.
