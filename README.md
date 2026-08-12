# 🗑️ slopbin

**Put the slop in the bin. An agent builds this website. You can build it too.**

slopbin is a small website where users throw internet slop into a bin. A user
logs in and pastes a link. Cloudflare Browser Rendering photographs the page, a
very cheap model (through Cloudflare AI Gateway) writes a verdict on why it is
slop, and three.js scrunches the photograph into a ball and throws it into a 3D
bin while the user watches. The bin keeps the evidence on a permanent page.

The website is not the important part. The important part is who writes it. A
Claude agent comes back to this repository, selects a task, writes the code,
and opens a pull request. You can do the same steps, with the same status.

Claude reads each pull request from an agent or a user. Claude asks one
question: is the change **safe**? Safe pull requests go into the site. The
[leaderboard](https://slopbin.com/leaderboard) counts each merged pull request.
Each new version of the site is in the
[changelog](https://slopbin.com/changelog).

The site operates on Cloudflare Workers with a minimum of parts:
[Hono](https://hono.dev) for the routes, D1 for the data, HTML from the server,
one pure CSS stylesheet, and no client-side JavaScript.

## The two agents

There are two skills in `.claude/skills/`. The difference between them is the
security model of this repository.

| | `slopbin-builder` | `slopbin-reviewer` |
|---|---|---|
| Function | selects a task, writes it, opens a pull request | reads an incoming pull request |
| Trust | operates for the maintainer, from this repository | reads contributions that you cannot trust |
| Infrastructure changes | permitted | **never permitted**, it rejects them |

Claude Code routines operate the two skills on a schedule. There is no CI in
this repository, and a pull request must not add one. The reviewer merges a safe
change that is small, and then deploys the site. It gives the label
`needs-human` to a safe change that is large or that touches `src/auth.ts` or
`migrations/`, and a maintainer does that merge:

```sh
gh pr list --label needs-human
```

"Infrastructure" is the set of files that control how the site is built,
deployed, and reviewed: `wrangler.toml`, `.github/`, `.claude/`, the
dependencies, the secrets, the bindings, and the build scripts. The reviewer
rejects a contributed pull request that changes any of these files. A pull
request that can change the reviewer or the deploy configuration can do all
other things. The builder can change these files because it operates with the
credentials of the maintainer, not from a copy of the repository.

## Parts

- **Cloudflare Workers**: the full application is one worker
- **D1** (SQLite): the users, the sessions, and the slop
- **Browser Rendering** (the `BROWSER` binding): photographs the slop
- **Workers AI + AI Gateway** (the `AI` binding, gateway `slopbin`): the verdicts
- **R2** (bucket `slopbin-shots`): the screenshots, one JPEG per slop
- **Hono**: a small router
- No frontend framework and no build step for the CSS. The one exception to
  the no-client-JS rule is the toss animation on `/slop/:id`, which loads
  three.js as a module from a CDN. Everything else is server HTML.

GitHub gives the identity. You log in with GitHub OAuth, and your slopbin name
is your GitHub login name. There is no different sign-up procedure. The first
log in makes the account. The sessions are tokens in D1 (`src/auth.ts`).

The deploy procedure makes the `/changelog` page from the git history
(`scripts/changelog.mjs`, connected as the wrangler `[build]` command). Thus the
page always shows the version that operates now.

## Operate the site on your computer

```sh
npm install
npm run db:migrate        # applies the migrations to a local D1
npm run dev               # http://localhost:8787
```

To use the GitHub log in on your computer, make a GitHub OAuth application with
the callback `http://localhost:8787/auth/github/callback`. Then put its
credentials in `.dev.vars`:

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Then log in with GitHub. The first log in makes your account.

## Deploy

```sh
wrangler d1 create experiment      # copy the id into wrangler.toml
wrangler r2 bucket create slopbin-shots
npm run db:migrate:remote
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GITHUB_WEBHOOK_SECRET
npm run deploy
```

The bin also needs an AI Gateway with the name `slopbin` (make it in the
dashboard or with the API; the name is in `wrangler.toml` as `AI_GATEWAY_ID`).
The Browser Rendering and Workers AI bindings need no secrets.

`GITHUB_CLIENT_ID` is a public identifier and stays in `wrangler.toml`. The
callback URL of the production GitHub OAuth application must be
`https://slopbin.com/auth/github/callback`.

### The leaderboard webhook

The leaderboard counts the merged pull requests. Add a GitHub webhook to this
repository:

- URL: `https://<your-worker>/webhooks/github`
- Content type: `application/json`
- Secret: the `GITHUB_WEBHOOK_SECRET` from the procedure above
- Events: pull requests only

When a pull request is merged, the site increases the `merged_prs` count of the
author. It finds the author with the GitHub user id, because each slopbin
account is a GitHub account.

## Contributions

This is the full idea of the site. Read [CONTRIBUTING.md](CONTRIBUTING.md).

## The files

```
migrations/       the D1 schema (SQL, with numbers)
scripts/          the changelog generator (operates at build time)
src/index.ts      all the routes
src/slop.ts       the slop machine: the screenshot and the verdict
src/auth.ts       the github oauth and the sessions
src/html.ts       the layout, the favicon, and the escape functions
src/style.ts      the one stylesheet
src/changelog.json  made from the git log. do not edit it manually.
.claude/skills/   the builder agent and the reviewer agent
```
