# Habit Points

A habit tracker that pays: tick off habits, earn points, turn points into euros.

## Rules

- Each person defines their own habits: a name, a point value and how often it counts,
  as N times per day, week (Mon–Sun) or month.
- **10 points = €1.**
- **Points expire 30 days** after you earn them.
- **Spending unlocks at 250 active points.** Once unlocked you can spend down to 0;
  it relocks when your balance can no longer cover €1, and you have to climb back to 250.
- Spending always uses your **oldest points first**, so the ones closest to expiring go first.

The numbers live in `site/config.js`.

## How it is put together

```
GitHub Pages (static)                  Supabase (free tier)
---------------------                  --------------------
site/index.html, app.js   <-- login -->  Auth (email + password)
ledger.js: expiry + FIFO  <-- rows  -->  Postgres: habits, completions, spends
                                         row level security: own rows only
```

There is no server code. The browser loads your history and `site/ledger.js` replays
it to work out the balance, expiry and the spending gate. Each person signs in with
their own account and the database only ever returns their own rows.

## Setup

### 1. Supabase

1. Create a free project at <https://supabase.com>.
2. **SQL Editor → New query**, paste `supabase/schema.sql`, **Run**.
3. **Project Settings → API**: copy the project URL and the publishable (or anon) key
   into `site/config.js`. Both are safe to commit; row level security protects the data.
4. **Authentication → URL Configuration**: set the Site URL to your GitHub Pages URL
   (e.g. `https://<user>.github.io/habit-points/`) so confirmation emails link back to it.

### 2. GitHub Pages

1. Push this repo to GitHub (a public repo, for free Pages).
2. **Settings → Pages → Source: GitHub Actions.**
3. Every push to `main` that touches `site/` redeploys via `.github/workflows/publish.yml`.

### 3. Accounts

Open the site, enter an email and password and press **Create account**, then confirm the
email. Each new account starts with a set of starter habits, editable under
**Manage habits**.

Once everyone who should use it has an account, turn off
**Authentication → Sign In / Providers → Allow new users to sign up**, so strangers who
find the public URL can't create accounts.

On a phone, use **Add to Home Screen** to get an app icon.

## Run locally

Any static file server works, for example:

```powershell
python -m http.server 8000 -d site
```

Then open <http://localhost:8000>. It talks to the same Supabase project as the live site.
