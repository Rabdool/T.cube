# T.cube

A wooden-board tic-tac-toe game for the browser, with accounts, a leaderboard, online multiplayer and an admin panel.

**Live:** https://t-cube3.vercel.app

## Features

- **Single player** against the CPU at 5 difficulty levels, from random moves (Very Easy) to perfect play with minimax (Very Hard). Harder levels unlock as each player wins:
  - Normal: 3 Easy wins
  - Hard: 3 Normal wins
  - Very Hard: 5 Normal wins or 3 Hard wins
- **Local two-player** on one device. These games don't count toward account stats.
- **Online multiplayer**, peer-to-peer with [PeerJS](https://peerjs.com/). Host or join with a 5-character room code, or use Auto Match.
- **Leaderboard** ranked by points:

  | Result | Points |
  |---|---|
  | Beat the CPU: Very Easy / Easy / Normal / Hard / Very Hard | 1 / 2 / 3 / 4 / 5 |
  | Win an online match | 3 |
  | Loss, draw, local two-player game | 0 |

- **Accounts:**
  - Sign up and log in with a username or email
  - Change your username and password in Settings
  - Light and dark themes, and sound effects you can turn off
- **Admin panel** (`/admin.html`):
  - Dashboard stats
  - Manage users: rename, delete, view stats, reset a password
  - Reset all stats
  - Export and import backups

## Tech stack

- **Frontend:** plain HTML, CSS and JavaScript, with no framework or build step.
- **Backend:** one Vercel serverless function, `api/db.js`.
- **Database:** MongoDB, for example a MongoDB Atlas cluster.

## Project structure

| Path | What it is |
|---|---|
| `tictactoe.html` / `.js` / `.css` | The game: auth screens, menus, board, leaderboard, rules |
| `settings.html` | Change username, password, theme and sound |
| `admin.html` / `.js` / `.css` | Admin dashboard |
| `apiClient.js` | Shared fetch helper: adds the session token to API calls |
| `sound.js` | Sound effects, generated with the Web Audio API |
| `api/db.js` | The API: auth, stats, admin, matchmaking |
| `api/_auth.js` | Password hashing, session tokens, admin list. Vercel doesn't expose `_` files as routes. |
| `resetStats.mjs` | Command-line script that resets all game stats |
| `vercel.json` | Serves `tictactoe.html` at `/` |

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables, for **Production** and, if you use preview deploys, **Preview**. Redeploy after changing them.

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` (or `STORAGE_URL`) | Yes | MongoDB connection string |
| `AUTH_SECRET` | Yes | Random string of **at least 32 characters**, used to sign login sessions. Generate one with `openssl rand -base64 48`. Changing it logs everyone out. |
| `MONGODB_DB` | No | Database name. Defaults to `tcube`. |
| `ADMIN_EMAILS` | No | Comma-separated emails of admin accounts. If unset, the default list in `api/_auth.js` is used. |

Never commit secrets. `.env` is in `.gitignore`.

## Running locally

```bash
npm install
npx vercel dev   # serves the site and /api on http://localhost:3000
```

`vercel dev` reads environment variables from a local `.env` file. Use a separate database for local testing, not production.

## Deploying

Vercel deploys automatically:

- **Push to `main`:** production
- **Pull request:** a preview deployment

If a free MongoDB Atlas cluster goes unused for a long time, Atlas **pauses** it, and every API call fails with "Server error". To fix it, resume the cluster in the Atlas dashboard.

## Admin tasks

- **Reset a forgotten password:** admin panel → Users → Edit → **Reset Password**.
  - A one-time temporary password is shown. Give it to the player.
  - After logging in with it, they must choose a new password.
  - There is no email-based reset.
- **Reset all game stats** from the command line:

  ```bash
  MONGODB_URI='your_connection_string' node resetStats.mjs
  ```

  This does the same as admin panel → System → Reset Stats.

## Security notes

- **Passwords:** hashed with scrypt.
- **Sessions:** HMAC-signed tokens that expire after 30 days. Changing your password logs out your other devices.
- **Checks:** every write and every admin action is checked on the server.
- **Public data:** only usernames, stats and points.
- **Login limits:** 10 wrong passwords lock an account for 15 minutes, and 30 failures from one IP block that IP.
- **Known limitation:** games run in the browser and report their own results, so a determined player could fake wins for their own account.
