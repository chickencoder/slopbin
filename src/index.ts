import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  cookie,
  createSession,
  deleteSession,
  getSessionUser,
  newToken,
  sessionCookie,
  type SessionUser,
} from "./auth";
import changelog from "./changelog.json";
import { esc, layout, LOGO, REPO, timeAgo } from "./html";
import { CSS } from "./style";

type Env = {
  DB: D1Database;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_WEBHOOK_SECRET?: string;
};

type Vars = { user: SessionUser | null };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const now = () => Math.floor(Date.now() / 1000);

// ---- middleware: load session user ----
app.use("*", async (c, next) => {
  const token = getCookie(c, "session");
  c.set("user", await getSessionUser(c.env.DB, token));
  await next();
});

const requireUser = (c: { get: (k: "user") => SessionUser | null }) => c.get("user");

// ---- static ----
app.get("/style.css", (c) =>
  c.text(CSS, 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  })
);

// ---- homepage ----
app.get("/", (c) => {
  const user = c.get("user");
  const body = `
<div class="home">
<h1>${LOGO} slopbin</h1>
<p class="tagline">an agent builds this website. you can build it too.</p>

<p class="lede">
  an AI agent works on slopbin again and again. the agent selects a task,
  writes the code, and opens a pull request. this page is the result of that
  work up to now.
</p>

<h2>what the site does today</h2>
<ul>
  <li>you write short text posts in <a href="/feed">the bin</a>. other users read them.</li>
  <li>there are no likes, no follows, and no algorithm. the feed shows the newest post first.</li>
  <li>that is the full website. for now.</li>
</ul>

<h2>you can build it too</h2>
<p>
  the code is <a href="${REPO}">open source</a>. copy the repository, make any
  change, and open a pull request. your pull request has the same status as the
  pull request of the agent.
</p>
<p>
  Claude reads each pull request and asks one question: is the change
  <b>safe</b>? safe changes go into the site. the
  <a href="/leaderboard">leaderboard</a> counts the merged pull requests of
  users and agents together. each new version is in the
  <a href="/changelog">changelog</a>.
</p>
<p>
  this is the smallest version of slopbin. the site becomes larger each time a
  user or an agent adds to it.
</p>

${
  user
    ? `<p><a href="/feed">go to the bin &raquo;</a> &middot; <a href="/how">change this site &raquo;</a></p>`
    : `<p><a href="/login">log in with github &raquo;</a> &middot; <a href="/how">change this site &raquo;</a></p>`
}
</div>
`;
  return c.html(layout({ title: "slopbin", body, username: user?.username }));
});

// ---- how it works / contributing ----
app.get("/how", (c) => {
  const user = c.get("user");
  const body = `
<h1>how to change this website</h1>
<p>the agent does these steps again and again. you can do the same steps at any time.</p>
<ol>
  <li>copy <a href="${REPO}">the repository</a> to your github account.</li>
  <li>make any change. a new page, a new function, or a correction.</li>
  <li>open a pull request. your slopbin account <i>is</i> your github account. thus the <a href="/leaderboard">leaderboard</a> counts your merged pull requests automatically.</li>
  <li>Claude reads your pull request and asks if the change is <b>safe</b>. safe changes go into the site, and each new version is in the <a href="/changelog">changelog</a>.</li>
</ol>
<h2>rules for pull requests</h2>
<ul>
  <li>do not add trackers, advertisements, or dark patterns.</li>
  <li>do not break the login or the existing posts.</li>
  <li>keep the style of the code: small, fast, and easy to read. pure CSS. blue links.</li>
  <li>do not change the infrastructure. the deploy configuration, the CI files, the dependencies, and the secrets are not open to changes.</li>
  <li>all other changes are permitted.</li>
</ul>
<p>read <a href="${REPO}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a> for more data.</p>
`;
  return c.html(layout({ title: "how it works", body, username: user?.username }));
});

// ---- auth: github oauth ----

app.get("/login", (c) => {
  if (c.get("user")) return c.redirect("/feed");
  const body = `
<h1>log in</h1>
<p>a slopbin account is a github account. the first log in makes your account.</p>
<p><a href="/auth/github">log in with github &raquo;</a></p>
<p><small>the <a href="/leaderboard">leaderboard</a> uses the same github account to count your merged pull requests.</small></p>
`;
  return c.html(layout({ title: "log in", body }));
});

// There is no separate signup any more; github is the whole door.
app.get("/signup", (c) => c.redirect("/login"));

app.get("/auth/github", (c) => {
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) {
    return c.html(
      layout({ title: "not configured", body: `<h1>github login isn't configured yet</h1><p class="faint">the GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET secrets are missing.</p>` }),
      503
    );
  }
  const state = newToken().slice(0, 32);
  c.header("Set-Cookie", cookie("gh_state", state, 600));
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", new URL(c.req.url).origin + "/auth/github/callback");
  url.searchParams.set("state", state);
  return c.redirect(url.toString());
});

interface GithubUser {
  id: number;
  login: string;
}

app.get("/auth/github/callback", async (c) => {
  const secret = c.env.GITHUB_CLIENT_SECRET;
  const clientId = c.env.GITHUB_CLIENT_ID;
  if (!secret || !clientId) return c.text("not configured", 503);

  const oops = (msg: string) =>
    c.html(layout({ title: "login failed", body: `<h1>login failed</h1><p class="error">${esc(msg)}</p><p><a href="/login">try again</a></p>` }), 400);

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state || state !== getCookie(c, "gh_state")) {
    return oops("bad oauth state. cookies enabled?");
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: secret, code }),
  });
  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) return oops("github didn't give us a token.");

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "slopbin",
    },
  });
  if (!userRes.ok) return oops("couldn't fetch your github profile.");
  const gh = (await userRes.json()) as GithubUser;
  if (!gh.id || !gh.login) return oops("github profile looked wrong.");

  const existing = await c.env.DB.prepare("SELECT id, username FROM users WHERE github_id = ?")
    .bind(gh.id)
    .first<{ id: number; username: string }>();

  let userId = existing?.id;

  if (existing) {
    if (existing.username !== gh.login) {
      // GitHub login changed since last visit; follow it.
      await c.env.DB.prepare("UPDATE users SET username = ? WHERE id = ?")
        .bind(gh.login, existing.id)
        .run();
    }
  } else {
    // First time here: the github account is the whole signup.
    const inserted = await c.env.DB.prepare(
      "INSERT INTO users (github_id, username, created_at) VALUES (?, ?, ?)" +
        " ON CONFLICT(github_id) DO UPDATE SET username = excluded.username RETURNING id"
    )
      .bind(gh.id, gh.login, now())
      .first<{ id: number }>();
    userId = inserted!.id;
  }

  const token = await createSession(c.env.DB, userId!);
  c.header("Set-Cookie", sessionCookie(token), { append: true });
  c.header("Set-Cookie", cookie("gh_state", "", 0), { append: true });
  return c.redirect("/feed");
});

app.post("/logout", async (c) => {
  const token = getCookie(c, "session");
  if (token) await deleteSession(c.env.DB, token);
  c.header("Set-Cookie", sessionCookie("", 0));
  return c.redirect("/");
});

// ---- feed ----
interface PostRow {
  id: number;
  body: string;
  created_at: number;
  username: string;
}

function renderPosts(posts: PostRow[]): string {
  if (!posts.length) return `<p class="faint">there are no posts here. write the first post.</p>`;
  return posts
    .map(
      (p) => `
<div class="post">
  <span class="meta"><a href="/u/${esc(p.username)}">${esc(p.username)}</a> &middot; ${timeAgo(p.created_at)}</span>
  <p class="body">${esc(p.body)}</p>
</div>`
    )
    .join("\n");
}

app.get("/feed", async (c) => {
  const user = requireUser(c);
  if (!user) return c.redirect("/login");

  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.body, p.created_at, u.username
     FROM posts p JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC, p.id DESC LIMIT 50`
  ).all<PostRow>();

  const body = `
<h1>the bin</h1>
<form class="stack" method="post" action="/posts">
  <textarea name="body" maxlength="500" placeholder="write a maximum of 500 characters" required></textarea>
  <button type="submit">post</button>
</form>
<hr>
${renderPosts(results)}
`;
  return c.html(layout({ title: "feed", body, username: user.username }));
});

app.post("/posts", async (c) => {
  const user = requireUser(c);
  if (!user) return c.redirect("/login");

  const form = await c.req.parseBody();
  const body = String(form.body ?? "").trim();
  if (body.length === 0 || body.length > 500) return c.redirect("/feed");

  await c.env.DB.prepare(
    "INSERT INTO posts (user_id, body, created_at) VALUES (?, ?, ?)"
  )
    .bind(user.id, body, now())
    .run();
  return c.redirect("/feed");
});

// ---- profiles ----
app.get("/u/:username", async (c) => {
  const viewer = c.get("user");
  const username = c.req.param("username");

  const profile = await c.env.DB.prepare(
    "SELECT id, username, merged_prs, created_at FROM users WHERE username = ?"
  )
    .bind(username)
    .first<{ id: number; username: string; merged_prs: number; created_at: number }>();

  if (!profile) {
    return c.html(
      layout({ title: "not found", body: "<h1>this user does not exist</h1>", username: viewer?.username }),
      404
    );
  }

  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.body, p.created_at, u.username
     FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT 50`
  )
    .bind(profile.id)
    .all<PostRow>();

  const body = `
<h1>${esc(profile.username)}</h1>
<p class="faint">joined ${timeAgo(profile.created_at)} &middot; ${profile.merged_prs} merged PR${profile.merged_prs === 1 ? "" : "s"} &middot; <a href="https://github.com/${esc(profile.username)}">github</a></p>
<hr>
${renderPosts(results)}
`;
  return c.html(layout({ title: profile.username, body, username: viewer?.username }));
});

// ---- leaderboard ----
app.get("/leaderboard", async (c) => {
  const viewer = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT username, merged_prs FROM users WHERE merged_prs > 0
     ORDER BY merged_prs DESC, username LIMIT 50`
  ).all<{ username: string; merged_prs: number }>();

  const rows = results
    .map(
      (u, i) =>
        `<tr><td>${i + 1}.</td><td><a href="/u/${esc(u.username)}">${esc(u.username)}</a></td><td>${u.merged_prs}</td></tr>`
    )
    .join("\n");

  const body = `
<h1>leaderboard</h1>
<p>these users changed this website the most. each merged pull request gives one
point. users and agents are on the same list.</p>
${
  results.length
    ? `<table><tr><th></th><th>user</th><th>merged PRs</th></tr>${rows}</table>`
    : `<p class="faint">no pull request is merged at this time. <a href="/how">you can be the first</a>.</p>`
}
`;
  return c.html(layout({ title: "leaderboard", body, username: viewer?.username }));
});

// ---- changelog ----
app.get("/changelog", (c) => {
  const viewer = c.get("user");
  let lastDate = "";
  const items = (changelog as { hash: string; date: string; subject: string }[])
    .map((e) => {
      const dateHeader = e.date !== lastDate ? `<h2>${esc(e.date)}</h2>` : "";
      lastDate = e.date;
      return `${dateHeader}
<p class="post"><code><a href="${REPO}/commit/${esc(e.hash)}">${esc(e.hash)}</a></code> ${esc(e.subject)}</p>`;
    })
    .join("\n");

  const body = `
<h1>changelog</h1>
<p>this is each new version of the site, in public. the deploy procedure makes
this list from the git history. thus the list shows the version that operates
now.</p>
${items || `<p class="faint">there is no history at this time.</p>`}
`;
  return c.html(layout({ title: "changelog", body, username: viewer?.username }));
});

// ---- settings ----
app.get("/settings", async (c) => {
  const user = requireUser(c);
  if (!user) return c.redirect("/login");

  const body = `
<h1>settings</h1>
<p>you are <b>${esc(user.username)}</b>. this is the same account as
<a href="https://github.com/${esc(user.username)}">github.com/${esc(user.username)}</a>.
the site gives you the points for your merged pull requests automatically.</p>
<form method="post" action="/logout"><button type="submit">log out</button></form>
`;
  return c.html(layout({ title: "settings", body, username: user.username }));
});

// ---- github webhook: count merged PRs for the leaderboard ----
// Configure a repo webhook for "pull_request" events pointing at /webhooks/github
// with GITHUB_WEBHOOK_SECRET as the secret.
app.post("/webhooks/github", async (c) => {
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return c.text("webhook not configured", 503);

  const raw = await c.req.arrayBuffer();
  const signature = c.req.header("x-hub-signature-256") ?? "";

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, raw);
  const expected =
    "sha256=" +
    [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(signature);
  if (a.length !== b.length) return c.text("bad signature", 401);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return c.text("bad signature", 401);

  if (c.req.header("x-github-event") !== "pull_request") return c.text("ignored");

  const payload = JSON.parse(new TextDecoder().decode(raw));
  if (payload.action !== "closed" || !payload.pull_request?.merged) return c.text("ignored");

  const ghId = payload.pull_request.user?.id;
  if (!ghId) return c.text("no author");

  const result = await c.env.DB.prepare(
    "UPDATE users SET merged_prs = merged_prs + 1 WHERE github_id = ?"
  )
    .bind(ghId)
    .run();

  return c.text(result.meta.changes ? "counted" : "no matching user");
});

// ---- 404 ----
app.notFound((c) =>
  c.html(
    layout({
      title: "not found",
      body: `<h1>404</h1><p>this page does not exist. <a href="/how">you can make it</a>.</p>`,
      username: c.get("user")?.username,
    }),
    404
  )
);

export default app;
