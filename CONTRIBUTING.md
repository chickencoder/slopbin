# Contributing

This website is built by its users. Any change is on the table: new pages,
new features, new realms, new communities, visual tweaks, refactors, jokes
that are also features.

## How it works

1. Fork the repo, make your change, open a pull request.
2. Your slopbin account **is** your GitHub account, so merged PRs count
   toward the [leaderboard](/leaderboard) automatically.
3. Claude reviews every PR automatically. PRs that are **safe** and
   **interesting** get merged and deployed, and every deploy appears on the
   site's `/changelog`.

## What "safe" means

Your PR will not be merged if it:

- introduces security holes (XSS, auth bypass, SQL injection, leaked secrets)
- adds tracking, analytics, ads, or dark patterns
- exfiltrates or destroys user data, or reads data a user shouldn't see
- breaks login, signup, invites, or existing posts
- adds heavyweight dependencies without a very good reason

## What "interesting" means

It makes the site better, weirder in a good way, or more fun. Low bar,
honestly. Fixing a typo is interesting. A new realm is interesting. A
40-dependency rewrite in a frontend framework is not.

## Spirit of the codebase

- Server-rendered HTML, pure CSS, blue links. No client-side JS unless the
  feature truly needs it.
- Small, readable code. Someone's first PR should be readable in one sitting.
- Escape all user content with `esc()` from `src/html.ts`.
- Database changes go in a new numbered file in `migrations/` — never edit an
  existing migration.
- `npm run typecheck` must pass.

## Local setup

```sh
npm install
npm run db:migrate
npm run dev
```

Sign up locally with the seeded invite code `genesis`.
