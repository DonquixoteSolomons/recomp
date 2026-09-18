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
2. ⚙ Settings: paste the Gemini key, the GitHub token, and `you/recomp-data`.
3. Trend tab → **Advanced → Import file** with `seed.json` (once; it also
   restores your targets) → **Fetch scale now**.
4. Check ⚙ once: the public source ships with placeholder targets; the
   import overwrites them with yours, but confirm they look right.

That's it. From then on: weigh in each morning (the workflow fetches it),
photograph or describe what you eat, tap Add.

## What it does

**Today** is your status and your log. Protein and calorie meters, the verdict
("Fine to end the day here" / "Protein first"), then everything logged today,
then a week card. Inputs come up from the bar at the bottom:

- **Meal** — *Recent* chips are learned from your own log (frequency with
  recency decay), one tap to repeat. **Camera**, **Gallery** (pick existing
  photos), or **Label** (a nutrition panel → exact values, then how much you
  had). Describe it, set your share (All / ½ / ⅓ / ¼), the time, **Estimate**.
  Refine with a correction; Add to log. "Type it in" for the rare manual entry.
- **Shake** — typed grams, product pickers, exact arithmetic. **＋ New tub or
  carton** opens the product form with **Read the label**: photo → per-100ml
  or per-gram values filled in.
- **Workout** — classes and cardio (REVL Move/Sweat/Perform, Run, Swim) take
  minutes, km, and kcal if your watch or Strava shows it — or **From
  screenshot**, which reads those off a Strava/Garmin/REVL summary. A kcal
  figure overrides the per-kind default. **Strength** takes exercise × sets
  (kg × reps) and feeds the Lifts card.
- **More** — weigh-in by hand, products, backup.

Tap any logged row to **edit** it (label, numbers, time), **log it again**,
value it with AI, or delete it.

**Photo or description → estimate.** Gemini identifies the dish and its
components and maps each to a row in the app's Singapore reference table
(`docs/js/foods.js`, ~70 hawker dishes and components). The **app** does the
arithmetic from that table — deterministic, same answer every time. The model
only supplies its own figures for things the table doesn't know, and those
are flagged. Name the venue and the model uses the published figures it knows
for chains; Google-grounded search is not on the free tier for the 3.x models.
Free-tier quotas are per model per day: when one is used up the app tries the
next Flash model, and it waits out a per-minute limit on its own.

**Sessions move calories between days; they never inflate the week.** Each
logged workout raises *that day's* target by its burn — measured kcal when you
have it, else a per-kind default (⚙). Before the engine has data,
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
