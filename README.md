# experiment

A very small social website. Invite-only, text posts, blue links. Built on
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

Auth is ~100 lines of hand-rolled PBKDF2 + session cookies (`src/auth.ts`).
Deliberately boring; easy to read, easy to replace.

## Run it locally

```sh
npm install
npm run db:migrate        # applies migrations to a local D1
npm run dev               # http://localhost:8787
```

The first migration seeds a single invite code: `genesis`. Sign up with it.
Every user gets 3 invite codes at signup, visible at `/invites`.

## Deploy

```sh
wrangler d1 create experiment      # paste the id into wrangler.toml
npm run db:migrate:remote
wrangler secret put GITHUB_WEBHOOK_SECRET
npm run deploy
```

### Leaderboard webhook

The leaderboard counts merged PRs. Add a GitHub webhook on this repo:

- URL: `https://<your-worker>/webhooks/github`
- Content type: `application/json`
- Secret: the `GITHUB_WEBHOOK_SECRET` you set above
- Events: pull requests only

When a PR merges, the author's `merged_prs` count is incremented — matched by
the GitHub username users set at `/settings`.

## Contributing

That's the whole idea. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Map

```
migrations/       D1 schema (SQL, numbered)
src/index.ts      all routes
src/auth.ts       passwords + sessions
src/html.ts       layout + escaping helpers
src/style.ts      the one stylesheet
```
