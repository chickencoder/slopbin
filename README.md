# slopbin

A tiny social website. Invite-only, text posts, blue links. Built on
Cloudflare Workers with as little as possible: [Hono](https://hono.dev) for
routing, D1 for storage, server-rendered HTML, one pure-CSS stylesheet, zero
client-side JavaScript.

**The point:** the site starts deliberately basic, but it's open source and
anyone who uses it can change it. Send a pull request — a new page, a new
feature, new realms, new communities, anything. Claude reviews every PR and
merges the ones that are safe and interesting. The
[leaderboard](/leaderboard) tracks who has shipped the most merged PRs.

## Stack

- **Cloudflare Workers** — the whole app is one worker
- **D1** (SQLite) — users, sessions, invites, posts
- **Hono** — tiny router
- No frontend framework, no build step for CSS, no client JS

Identity is GitHub: you log in with GitHub OAuth, and your slopbin username
is your GitHub login. Sessions are tokens in D1 (`src/auth.ts`). New accounts
still need an invite code — the migrations seed a single `genesis` code.

The `/changelog` page is generated from git history at deploy time
(`scripts/changelog.mjs`, wired up as the wrangler `[build]` command), so it
always shows exactly what's deployed.

## Run it locally

```sh
npm install
npm run db:migrate        # applies migrations to a local D1
npm run dev               # http://localhost:8787
```

For GitHub login locally, create a GitHub OAuth app with callback
`http://localhost:8787/auth/github/callback` and put its credentials in
`.dev.vars`:

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Sign up with the seeded invite code `genesis`. Every user gets 3 invite
codes at signup, visible at `/invites`.

## Deploy

```sh
wrangler d1 create experiment      # paste the id into wrangler.toml
npm run db:migrate:remote
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GITHUB_WEBHOOK_SECRET
npm run deploy
```

The production GitHub OAuth app's callback URL must be
`https://slopbin.com/auth/github/callback`.

### Leaderboard webhook

The leaderboard counts merged PRs. Add a GitHub webhook on this repo:

- URL: `https://<your-worker>/webhooks/github`
- Content type: `application/json`
- Secret: the `GITHUB_WEBHOOK_SECRET` you set above
- Events: pull requests only

When a PR merges, the author's `merged_prs` count is incremented — matched by
GitHub user id, since slopbin accounts are GitHub accounts.

## Contributing

That's the whole idea. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Map

```
migrations/       D1 schema (SQL, numbered)
scripts/          changelog generator (runs at build time)
src/index.ts      all routes
src/auth.ts       github oauth + sessions
src/html.ts       layout + escaping helpers
src/style.ts      the one stylesheet
src/changelog.json  generated from git log; don't edit by hand
```
