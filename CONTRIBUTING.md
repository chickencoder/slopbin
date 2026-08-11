# Contributions

An agent builds this website again and again. You can build it too, with the
same procedure and the same status. Open a pull request. All changes are
possible: new pages, new functions, changes to the design, and improvements to
the code.

## The procedure

1. Copy the repository, make your change, and open a pull request.
2. Your slopbin account **is** your GitHub account. Thus the
   [leaderboard](https://slopbin.com/leaderboard) counts your merged pull
   requests automatically.
3. Claude reads each pull request. Claude does not ask if your idea is good
   sufficiently. Claude asks if the change is **safe**. Safe pull requests go
   into the site, and each new version is on the `/changelog` page.

There is no test of quality. Small changes and unusual changes are permitted.

## The meaning of "safe"

Claude will not merge your pull request if it does one of these things:

- it makes a security hole (XSS, an authentication bypass, SQL injection, or a
  leak of a secret)
- it adds trackers, analytics, advertisements, or dark patterns
- it sends user data to a different site, destroys user data, or shows a user
  the data of a different user
- it breaks the log in procedure or the existing posts
- it adds large dependencies
- it changes the infrastructure (read the next chapter)

## Do not change the infrastructure

A contributed pull request must not change how the site is built, deployed, or
reviewed. The reviewer rejects each pull request that changes these files:

- `wrangler.toml`: the deploy configuration, the bindings, and the variables
- `.github/`: the CI files, the workflows, and the review procedure
- `.claude/`: the agent skills, and the instructions of the reviewer
- `package.json` and `package-lock.json`: the dependencies and the scripts
- `scripts/`: the build-time scripts
- `tsconfig.json`
- all files that contain secrets, tokens, or environment variables

This rule is not a statement about you. A pull request that can change the
reviewer or the deploy procedure can do all other things. Thus the rule applies
to the files and not to the intention. If your change needs one of these files,
for example a new dependency or a new binding, make an issue. Tell us what you
want and why. Then a maintainer can make that change separately.

A database migration is **not** infrastructure. A new file with a number in
`migrations/` is permitted if it only adds tables, columns, or indexes. Do not
change an existing migration file. Do not delete or rename data that the users
need.

## The style of the code

- Make the HTML on the server. Use pure CSS and blue links. Do not add
  client-side JS if the function does not need it.
- Write small code that is easy to read. A first pull request must be legible
  in one session.
- Escape all user content with `esc()` from `src/html.ts`.
- Use parameters in all SQL. Bind the values. Do not put values in the SQL text.
- Put database changes in a new file with a number in `migrations/`. Do not
  change an existing migration.
- `npm run typecheck` must complete with no errors.

## Operate the site on your computer

```sh
npm install
npm run db:migrate
npm run dev
```

Log in with GitHub. The first log in makes the account.
