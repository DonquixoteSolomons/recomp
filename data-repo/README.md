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
