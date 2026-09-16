# recomp-data (private)

Your data and the one automated job. Keep this repo **private**.

- `body.json` — every Renpho weigh-in, written nightly by the workflow.
- `backup.json` — a full snapshot of the app's data, written by the app.
- `seed.json` — your Aug 14 – Sep 13 chat log, imported once from the app.

## Setup (once)

1. Create a private repo, push this folder to it.
2. Repo → Settings → Secrets and variables → Actions → add
   `RENPHO_EMAIL` and `RENPHO_PASSWORD` (your Renpho Health login).
3. Actions tab → "Pull Renpho weigh-ins" → Run workflow. `body.json` appears.
4. GitHub → Settings → Developer settings → Fine-grained tokens → new token,
   Repository access: only this repo, Permissions: Contents = Read and write.
   Paste that token into the app's Settings along with `owner/repo`.

The workflow runs at 07:05 Singapore time. Scheduled workflows pause after
60 days without commits; the app's backups keep the repo active.

- `chat_fixes.json` — values for the chat rows the parser couldn't read, and
  deletions of rows that were never meals. The app applies it once on open
  (or Trend → **Apply chat estimates**). Regenerate on the PC with
  `tools/chat_fixes.py` if you ever re-import the chat.
