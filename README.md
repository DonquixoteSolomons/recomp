# Recomp

Personal nutrition + training tracker for a body recomposition. Replaces the
food log that lived in two claude.ai chats (Aug 14 – Sep 13, 2026) and died
at the attachment limit.

**The app is `docs/` — a single web page that runs entirely on your phone.**
No server, no laptop, nothing to keep running, $0.

- Data lives on the phone (IndexedDB) and is backed up to a private GitHub repo.
- Photos go from your phone to Gemini's free tier with your own key.
- Your Renpho weigh-ins are pulled nightly by a free GitHub Actions job.

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
   with your whole scale history. It then runs itself at 07:05 SGT daily.
5. GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained** → Generate: Repository access = only `recomp-data`,
   Permissions → Contents = **Read and write**. Copy the token.

### 2. The app page

1. Push this whole folder to a **public** repo, e.g. `recomp` (it contains
   no data or secrets — `.gitignore` keeps `.env`, `data/`, `seed.json` out).
2. Repo → Settings → Pages → Source: Deploy from a branch, Branch `main`,
   folder **`/docs`**. Save. Your URL is `https://<you>.github.io/recomp/`.

### 3. Gemini key

[aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Create API
key. Free tier, no card: ~1,500 requests/day on the Flash models, 500/day with
search grounding. Note: free-tier prompts (your food photos) may be used by
Google to improve their models.

### 4. On the phone

1. Open your Pages URL in Chrome → menu → **Add to Home screen**.
2. ⚙ Settings: paste the Gemini key, the GitHub token, and `you/recomp-data`.
3. Trend tab → **Import chat log** (once) → **Pull weigh-ins**.

That's it. From then on: weigh in each morning (the workflow fetches it),
photograph or describe what you eat, tap Add.

## What it does

**Photo or description → estimate.** Gemini identifies the dish and its
components and maps each to a row in the app's Singapore reference table
(`docs/js/foods.js`, ~70 hawker dishes and components). The **app** does the
arithmetic from that table — deterministic, same answer every time. The model
only supplies its own figures for things the table doesn't know, and those
are flagged. If you name a venue, a Google-grounded lookup runs first and its
notes are fed into the identification. "Refine" with a correction; "Add to
log" when it's right.

**Quick add** for the fixed set. **Shake calculator** with typed grams,
selectable whey/milk products; add a new tub or carton with the ＋.

**Verdict.** "Fine to end the day here" or "Protein first" — answered on
every load.

**Expenditure without a formula.** After ~7 complete days with weigh-ins,
the calorie band comes from your own intake vs. the least-squares slope of
your weight — never a BMR × multiplier (the thing that double-counted REVL
and produced the old 2,500 ceiling). Creatine settling days are excluded from
the weight side. Until then the target is the `provisional_kcal` setting.

**Backups.** Every change schedules a snapshot to `backup.json` in the private
repo a minute later. Restore from it on a new phone with one tap. Export/import
a file as a second option.

## Layout

```
docs/               the phone app (GitHub Pages)
  index.html · css/style.css · sw.js · manifest.webmanifest
  js/db.js          IndexedDB layer + settings + dump/restore
  js/foods.js       quick-add, reference table, products, shake(), computeFromIdentification()
  js/engine.js      weight trend (EMA display, OLS rate) + expenditure + verdict
  js/estimate.js    Gemini: optional grounded lookup, then structured identification
  js/sync.js        GitHub Contents API: body.json, seed.json, backup.json
  js/app.js         UI
  test/             node --test docs/test/engine.test.mjs
data-repo/          template for the private repo (workflow + renpho_pull.py + seed.json)
tools/export_seed.py  SQLite → seed.json
app.py, recomp/, static/, tests/   the laptop version (optional)
```

## Re-importing the chat later

If you export the claude.ai chats again, rebuild the seed on the PC with
`run_backfill.py --export <zip> --until <last chat-only day>` then
`tools/export_seed.py`, push `seed.json`, and use **Import chat log** — but
the app is the log now; the chat should be retired.
