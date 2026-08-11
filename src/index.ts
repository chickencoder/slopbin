import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  cookie,
  createSession,
  deleteSession,
  getSessionUser,
  newToken,
  sessionCookie,
  signValue,
  verifyValue,
  type SessionUser,
} from "./auth";
import changelog from "./changelog.json";
import { esc, layout, timeAgo } from "./html";
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
<h1>slopbin</h1>
<p class="tagline">a tiny social website. lovingly under-engineered.</p>

<p>here is everything slopbin does:</p>
<ul>
  <li>you post text into <a href="/feed">the bin</a>. other people read it.</li>
  <li>it is invite only. every user gets <b>3 invites</b>. choose wisely, their slop is on you.</li>
  <li>that's it. no likes, no follows, no algorithm. the feed is just time, going backwards.</li>
</ul>

<h2>the actual point</h2>
<p>
  slopbin ships embarrassingly basic — on purpose. but it's
  <a href="https://github.com/chickencoder/experiment">open source</a>, and anyone
  here can change it. want profiles? realms? communities? a dark theme? something
  no website has ever had? <a href="/how">send a pull request</a>.
</p>
<p>
  every PR gets reviewed by Claude. safe and interesting changes get merged and
  deployed for everyone. the <a href="/leaderboard">leaderboard</a> is the only
  scoreboard here: one point per merged PR. every deploy lands in
  <a href="/changelog">the changelog</a>.
</p>
<p>
  in other words: this is the worst slopbin will ever be.
  what it becomes is up to the people in it.
</p>

${
  user
    ? `<p><a href="/feed">go to the bin &raquo;</a></p>`
    : `<p><a href="/login">log in with github</a> &middot; <a href="/signup">sign up with an invite code</a></p>`
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
<ol>
  <li>fork <a href="https://github.com/chickencoder/experiment">the repository</a>.</li>
  <li>make any change you want. a page, a feature, a realm, a community, a fix. anything.</li>
  <li>open a pull request. your slopbin account <i>is</i> your github account, so merged PRs count toward the <a href="/leaderboard">leaderboard</a> automatically.</li>
  <li>Claude reviews every PR. changes that are <b>safe</b> (no security holes, no data loss, no spying on users) and <b>interesting</b> (make the site better or weirder in a good way) get merged and deployed. every deploy shows up in the <a href="/changelog">changelog</a>.</li>
</ol>
<h2>ground rules for PRs</h2>
<ul>
  <li>no tracking, ads, or dark patterns.</li>
  <li>don't break login, invites, or existing posts.</li>
  <li>keep the spirit: fast, small, readable code. pure CSS. blue links.</li>
  <li>everything else is fair game.</li>
</ul>
<p>see <a href="https://github.com/chickencoder/experiment/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a> for the details.</p>
`;
  return c.html(layout({ title: "how it works", body, username: user?.username }));
});

// ---- auth: github oauth ----

app.get("/login", (c) => {
  if (c.get("user")) return c.redirect("/feed");
  const body = `
<h1>log in</h1>
<p>slopbin accounts are github accounts.</p>
<p><a href="/auth/github">log in with github &raquo;</a></p>
<p><small>new here? you'll need an invite code after github says hello. <a href="/signup">details</a>.</small></p>
`;
  return c.html(layout({ title: "log in", body }));
});

app.get("/signup", (c) => {
  if (c.get("user")) return c.redirect("/feed");
  const invite = c.req.query("invite");
  if (invite) c.header("Set-Cookie", cookie("invite_hint", encodeURIComponent(invite), 600));
  const body = `
<h1>sign up</h1>
<p>two things get you in:</p>
<ol>
  <li>a github account (that's your identity here)</li>
  <li>an invite code (ask someone who's already in)</li>
</ol>
<p><a href="/auth/github">continue with github &raquo;</a></p>
`;
  return c.html(layout({ title: "sign up", body }));
});

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

  if (existing) {
    if (existing.username !== gh.login) {
      // GitHub login changed since last visit; follow it.
      await c.env.DB.prepare("UPDATE users SET username = ? WHERE id = ?")
        .bind(gh.login, existing.id)
        .run();
    }
    const token = await createSession(c.env.DB, existing.id);
    c.header("Set-Cookie", sessionCookie(token), { append: true });
    c.header("Set-Cookie", cookie("gh_state", "", 0), { append: true });
    return c.redirect("/feed");
  }

  // New face: park their github identity in a signed cookie and ask for an invite.
  const pending = await signValue(secret, { id: gh.id, login: gh.login, exp: now() + 600 });
  c.header("Set-Cookie", cookie("pending", pending, 600), { append: true });
  c.header("Set-Cookie", cookie("gh_state", "", 0), { append: true });
  return c.redirect("/signup/complete");
});

interface Pending {
  id: number;
  login: string;
  exp: number;
}

async function readPending(secret: string, raw: string | undefined): Promise<Pending | null> {
  if (!raw) return null;
  const p = await verifyValue<Pending>(secret, raw);
  if (!p || p.exp < now()) return null;
  return p;
}

app.get("/signup/complete", async (c) => {
  const secret = c.env.GITHUB_CLIENT_SECRET;
  if (!secret) return c.text("not configured", 503);
  const pending = await readPending(secret, getCookie(c, "pending"));
  if (!pending) return c.redirect("/signup");

  const hint = getCookie(c, "invite_hint") ?? "";
  const error = c.req.query("error");
  const body = `
<h1>almost in</h1>
<p>hello, <b>${esc(pending.login)}</b>. one more thing: an invite code.</p>
${error ? `<p class="error">${esc(error)}</p>` : ""}
<form class="stack" method="post" action="/signup/complete">
  <label>invite code <input type="text" name="invite" value="${esc(decodeURIComponent(hint))}" required></label>
  <button type="submit">join slopbin</button>
</form>
`;
  return c.html(layout({ title: "sign up", body }));
});

app.post("/signup/complete", async (c) => {
  const secret = c.env.GITHUB_CLIENT_SECRET;
  if (!secret) return c.text("not configured", 503);
  const pending = await readPending(secret, getCookie(c, "pending"));
  if (!pending) return c.redirect("/signup");

  const form = await c.req.parseBody();
  const invite = String(form.invite ?? "").trim();
  const fail = (msg: string) =>
    c.redirect(`/signup/complete?error=${encodeURIComponent(msg)}`);

  const inviteRow = await c.env.DB.prepare(
    "SELECT code, created_by, used_by FROM invites WHERE code = ?"
  )
    .bind(invite)
    .first<{ code: string; created_by: number | null; used_by: number | null }>();
  if (!inviteRow) return fail("that invite code doesn't exist.");
  if (inviteRow.used_by !== null) return fail("that invite code has already been used.");

  // Another tab may have finished signup already.
  const dupe = await c.env.DB.prepare("SELECT id FROM users WHERE github_id = ?")
    .bind(pending.id)
    .first<{ id: number }>();
  if (dupe) {
    const token = await createSession(c.env.DB, dupe.id);
    c.header("Set-Cookie", sessionCookie(token), { append: true });
    c.header("Set-Cookie", cookie("pending", "", 0), { append: true });
    return c.redirect("/feed");
  }

  const ts = now();
  const inserted = await c.env.DB.prepare(
    "INSERT INTO users (github_id, username, invited_by, created_at) VALUES (?, ?, ?, ?) RETURNING id"
  )
    .bind(pending.id, pending.login, inviteRow.created_by, ts)
    .first<{ id: number }>();
  const userId = inserted!.id;

  // Claim the invite atomically: the WHERE used_by IS NULL guard means two
  // people racing on the same code can't both get in.
  const claim = await c.env.DB.prepare(
    "UPDATE invites SET used_by = ? WHERE code = ? AND used_by IS NULL"
  )
    .bind(userId, invite)
    .run();
  if (!claim.meta.changes) {
    await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    return fail("that invite code has already been used.");
  }

  // Mint the new user's 3 invites.
  const statements = [];
  for (let i = 0; i < 3; i++) {
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?)"
      ).bind(newToken().slice(0, 12), userId, ts)
    );
  }
  await c.env.DB.batch(statements);

  const token = await createSession(c.env.DB, userId);
  c.header("Set-Cookie", sessionCookie(token), { append: true });
  c.header("Set-Cookie", cookie("pending", "", 0), { append: true });
  c.header("Set-Cookie", cookie("invite_hint", "", 0), { append: true });
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
  if (!posts.length) return `<p class="faint">nothing here yet. say something.</p>`;
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
  <textarea name="body" maxlength="500" placeholder="up to 500 characters" required></textarea>
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
      layout({ title: "not found", body: "<h1>no such user</h1>", username: viewer?.username }),
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

// ---- invites ----
app.get("/invites", async (c) => {
  const user = requireUser(c);
  if (!user) return c.redirect("/login");

  const { results } = await c.env.DB.prepare(
    `SELECT i.code, i.used_by, u.username AS used_by_name
     FROM invites i LEFT JOIN users u ON u.id = i.used_by
     WHERE i.created_by = ? ORDER BY i.created_at`
  )
    .bind(user.id)
    .all<{ code: string; used_by: number | null; used_by_name: string | null }>();

  const origin = new URL(c.req.url).origin;
  const rows = results
    .map((i) =>
      i.used_by
        ? `<tr><td><s>${esc(i.code)}</s></td><td>used by <a href="/u/${esc(i.used_by_name!)}">${esc(i.used_by_name!)}</a></td></tr>`
        : `<tr><td><code>${esc(i.code)}</code></td><td><a href="${esc(origin)}/signup?invite=${esc(i.code)}">invite link</a></td></tr>`
    )
    .join("\n");

  const body = `
<h1>your invites</h1>
<p>you got 3. spend them well — whoever joins is on you.</p>
<table>
  <tr><th>code</th><th>status</th></tr>
  ${rows}
</table>
`;
  return c.html(layout({ title: "invites", body, username: user.username }));
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
<p>who has changed this website the most. one point per merged pull request.</p>
${
  results.length
    ? `<table><tr><th></th><th>user</th><th>merged PRs</th></tr>${rows}</table>`
    : `<p class="faint">nobody has merged a PR yet. <a href="/how">the board is wide open</a>.</p>`
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
<p class="post"><code><a href="https://github.com/chickencoder/experiment/commit/${esc(e.hash)}">${esc(e.hash)}</a></code> ${esc(e.subject)}</p>`;
    })
    .join("\n");

  const body = `
<h1>changelog</h1>
<p>every deploy, in public. this list is generated from git history at deploy
time, so it's exactly what's running right now.</p>
${items || `<p class="faint">no history yet, somehow.</p>`}
`;
  return c.html(layout({ title: "changelog", body, username: viewer?.username }));
});

// ---- settings ----
app.get("/settings", async (c) => {
  const user = requireUser(c);
  if (!user) return c.redirect("/login");

  const body = `
<h1>settings</h1>
<p>you are <b>${esc(user.username)}</b>, which is to say
<a href="https://github.com/${esc(user.username)}">github.com/${esc(user.username)}</a>.
merged PRs are credited to you automatically.</p>
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
      body: `<h1>404</h1><p>this page doesn't exist. <a href="/how">yet.</a></p>`,
      username: c.get("user")?.username,
    }),
    404
  )
);

export default app;
