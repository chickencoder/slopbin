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
import { duration, esc, isoTime, layout, LOGO, REPO, timeAgo } from "./html";
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
  <li>each post has its own link. select the time of a post, then send that link to a different person.</li>
  <li>there is one <a href="/peel">golden banana peel</a>. one user holds it, and gives it to a different user.</li>
  <li>users write poems together on <a href="/compost">the compost heap</a>. you add one line, and you see only the line above your own.</li>
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

/** The author and the time of a post. The time is the permalink of the post. */
function postMeta(p: PostRow): string {
  return `<span class="meta"><a href="/u/${esc(p.username)}">${esc(p.username)}</a> &middot; <a href="/p/${p.id}"><time datetime="${isoTime(p.created_at)}">${timeAgo(p.created_at)}</time></a></span>`;
}

function renderPosts(posts: PostRow[]): string {
  if (!posts.length) return `<p class="faint">there are no posts here. write the first post.</p>`;
  return posts
    .map(
      (p) => `
<div class="post">
  ${postMeta(p)}
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

  const hold = await currentHold(c.env.DB);
  const peelLead = hold
    ? `<p class="faint">🍌 <a href="/peel">the golden banana peel</a> is in the hand of <a href="/u/${esc(hold.holder)}">${esc(hold.holder)}</a>.</p>`
    : `<p class="faint">🍌 <a href="/peel">the golden banana peel</a> is at the bottom of the bin. anybody can take it.</p>`;

  const { scraps } = await openHeap(c.env.DB);
  const compostLead = scraps.length
    ? `<p class="faint">🥬 <a href="/compost">the compost heap</a> has ${scraps.length} of ${HEAP_SIZE} lines. add the next line.</p>`
    : `<p class="faint">🥬 <a href="/compost">the compost heap</a> is empty. write the first line of the next poem.</p>`;

  const body = `
<h1>the bin</h1>
${peelLead}
${compostLead}
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

// ---- one post: a link that you can send to a different person ----
// The bin needs a log in, but a single post does not. Thus a link to a post
// operates for each person who receives it, in the same manner as a profile.
app.get("/p/:id", async (c) => {
  const viewer = c.get("user");
  const id = Number(c.req.param("id"));

  const post =
    Number.isSafeInteger(id) && id > 0
      ? await c.env.DB.prepare(
          `SELECT p.id, p.body, p.created_at, u.username
           FROM posts p JOIN users u ON u.id = p.user_id
           WHERE p.id = ?`
        )
          .bind(id)
          .first<PostRow>()
      : null;

  if (!post) {
    return c.html(
      layout({
        title: "not found",
        body: `<h1>this post does not exist</h1>
<p>the person deleted it, or the link is not correct. <a href="/feed">go to the bin</a>.</p>`,
        username: viewer?.username,
      }),
      404
    );
  }

  const body = `
<h1>a post by ${esc(post.username)}</h1>
<div class="post">
  ${postMeta(post)}
  <p class="body">${esc(post.body)}</p>
</div>
<hr>
<p class="faint">
  <a href="/u/${esc(post.username)}">more posts by ${esc(post.username)}</a> &middot;
  <a href="/feed">the bin</a>
</p>
`;
  return c.html(
    layout({ title: `post by ${post.username}`, body, username: viewer?.username })
  );
});

// ---- the golden banana peel ----
// There is exactly one peel. One user holds it, and gives it to a different
// user with a short note. If a user holds the peel for more than a day, the
// peel slips out of their hand and returns to the bin, and any user can take
// it. Thus the machine never stops, even if a user goes away.

const PEEL_TTL = 60 * 60 * 24; // one day in the hand, then it slips

interface PeelHold {
  id: number;
  note: string;
  taken_at: number;
  released_at: number | null;
  holder: string;
  giver: string | null;
}

const PEEL_HOLD_SQL = `SELECT h.id, h.note, h.taken_at, h.released_at,
         u.username AS holder, g.username AS giver
  FROM peel_holds h
  JOIN users u ON u.id = h.user_id
  LEFT JOIN users g ON g.id = h.from_user_id`;

/** The user who holds the peel now, or null if the peel is in the bin. */
async function currentHold(db: D1Database): Promise<PeelHold | null> {
  const hold = await db
    .prepare(`${PEEL_HOLD_SQL} WHERE h.released_at IS NULL ORDER BY h.taken_at DESC LIMIT 1`)
    .first<PeelHold>();
  if (!hold) return null;
  if (now() - hold.taken_at > PEEL_TTL) {
    // The hand was too slow. The peel slips back into the bin.
    await db
      .prepare("UPDATE peel_holds SET released_at = ? WHERE released_at IS NULL")
      .bind(hold.taken_at + PEEL_TTL)
      .run();
    return null;
  }
  return hold;
}

/** One line of the history of the peel. */
function peelLine(h: PeelHold): string {
  const end = h.released_at ?? now();
  const how = h.giver
    ? `${esc(h.giver)} gave it to <a href="/u/${esc(h.holder)}">${esc(h.holder)}</a>`
    : `<a href="/u/${esc(h.holder)}">${esc(h.holder)}</a> took it out of the bin`;
  const held = h.released_at ? `held it ${duration(end - h.taken_at)}` : `holds it now`;
  return `<p class="post"><span class="meta">${timeAgo(h.taken_at)} &middot; ${held}</span><br>
${how}${h.note ? ` &mdash; <i>&ldquo;${esc(h.note)}&rdquo;</i>` : ""}</p>`;
}

const PEEL_MESSAGES: Record<string, string> = {
  nouser: "there is no user with that name on slopbin. look at the bin for a name.",
  self: "you cannot give the peel to yourself. that is not how a peel operates.",
  gone: "you do not hold the peel any more. somebody else has it.",
  taken: "a different user took the peel first. wait for it to come back.",
};

app.get("/peel", async (c) => {
  const viewer = c.get("user");
  const hold = await currentHold(c.env.DB);

  const { results: history } = await c.env.DB.prepare(
    `${PEEL_HOLD_SQL} ORDER BY h.taken_at DESC, h.id DESC LIMIT 30`
  ).all<PeelHold>();

  const stats = await c.env.DB.prepare(
    "SELECT COUNT(*) AS hands, COUNT(DISTINCT user_id) AS people FROM peel_holds"
  ).first<{ hands: number; people: number }>();

  const holding = !!viewer && hold?.holder === viewer.username;

  const box = hold
    ? `<div class="peel-box">
  <div class="peel">🍌</div>
  <p><b><a href="/u/${esc(hold.holder)}">${esc(hold.holder)}</a></b> holds the golden banana peel.</p>
  <p class="faint">in that hand for ${duration(now() - hold.taken_at)}. it slips back into the bin in ${duration(hold.taken_at + PEEL_TTL - now())}.</p>
</div>`
    : `<div class="peel-box free">
  <div class="peel">🗑️</div>
  <p>the golden banana peel is at the bottom of the bin.</p>
  <p class="faint">nobody holds it. any user can take it.</p>
</div>`;

  const err = PEEL_MESSAGES[c.req.query("e") ?? ""];

  let action = "";
  if (!viewer) {
    action = `<p><a href="/login">log in with github</a> to hold the peel.</p>`;
  } else if (holding) {
    action = `<h2>give it away</h2>
<p>you hold the peel. you cannot keep it. write the name of a different user and
give the peel to them.</p>
<form class="stack" method="post" action="/peel/pass">
  <input type="text" name="to" placeholder="a slopbin username" maxlength="40" autocomplete="off" required>
  <input type="text" name="note" placeholder="a note, a maximum of 100 characters" maxlength="100" autocomplete="off">
  <button type="submit">give the peel away</button>
</form>`;
  } else if (!hold) {
    action = `<form method="post" action="/peel/take"><button type="submit">take the peel out of the bin</button></form>`;
  } else {
    action = `<p class="faint">wait. the peel comes to the people who wait.</p>`;
  }

  const body = `
<h1>the golden banana peel</h1>
<p>there is one peel on slopbin. one user holds it. the user who holds it gives
it to a different user, with a note. if a hand holds the peel for more than one
day, the peel slips and falls back into the bin, and any user can take it.</p>
${err ? `<p class="error">${esc(err)}</p>` : ""}
${box}
${action}
<hr>
<h2>where the peel has been</h2>
<p class="faint">${stats?.hands ?? 0} hand${stats?.hands === 1 ? "" : "s"} &middot; ${stats?.people ?? 0} user${stats?.people === 1 ? "" : "s"}</p>
${
  history.length
    ? history.map(peelLine).join("\n")
    : `<p class="faint">the peel has no history. nobody has taken it yet.</p>`
}
`;
  return c.html(layout({ title: "the golden banana peel", body, username: viewer?.username }));
});

app.post("/peel/take", async (c) => {
  const user = requireUser(c);
  if (!user) return c.redirect("/login");

  if (await currentHold(c.env.DB)) return c.redirect("/peel?e=taken");

  await c.env.DB.prepare(
    "INSERT INTO peel_holds (user_id, from_user_id, note, taken_at) VALUES (?, NULL, '', ?)"
  )
    .bind(user.id, now())
    .run();
  return c.redirect("/peel");
});

app.post("/peel/pass", async (c) => {
  const user = requireUser(c);
  if (!user) return c.redirect("/login");

  const form = await c.req.parseBody();
  const to = String(form.to ?? "").trim().replace(/^@/, "");
  const note = String(form.note ?? "").trim().slice(0, 100);

  const hold = await currentHold(c.env.DB);
  if (!hold || hold.holder !== user.username) return c.redirect("/peel?e=gone");

  const target = await c.env.DB.prepare("SELECT id, username FROM users WHERE username = ?")
    .bind(to)
    .first<{ id: number; username: string }>();
  if (!target) return c.redirect("/peel?e=nouser");
  if (target.id === user.id) return c.redirect("/peel?e=self");

  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE peel_holds SET released_at = ? WHERE id = ? AND released_at IS NULL")
      .bind(t, hold.id),
    c.env.DB.prepare(
      "INSERT INTO peel_holds (user_id, from_user_id, note, taken_at) VALUES (?, ?, ?, ?)"
    ).bind(target.id, user.id, note, t),
  ]);
  return c.redirect("/peel");
});

// ---- the compost heap ----
// A heap is a poem that many hands write together. Each user adds one scrap of
// text, and sees only the scrap above their own. Thus nobody knows the shape of
// the poem until the heap is full. Twelve scraps seal the heap, and then all
// users read it from the first scrap to the last one.

const HEAP_SIZE = 12; // scraps in a full heap
const HEAP_STALE = 60 * 60 * 24; // a heap with no new scrap for a day goes cold

interface Heap {
  id: number;
  started_at: number;
  sealed_at: number | null;
  reason: string | null;
}

interface Scrap {
  id: number;
  body: string;
  created_at: number;
  user_id: number;
  username: string;
}

const HEAP_SQL = "SELECT id, started_at, sealed_at, reason FROM compost_heaps";

async function heapScraps(db: D1Database, heapId: number): Promise<Scrap[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.body, s.created_at, s.user_id, u.username
       FROM compost_scraps s JOIN users u ON u.id = s.user_id
       WHERE s.heap_id = ? ORDER BY s.id`
    )
    .bind(heapId)
    .all<Scrap>();
  return results;
}

/**
 * The heap that takes scraps now, with the scraps that are on it. A heap that
 * nobody fed for a day is cold: the site seals it and starts a new heap. Thus
 * the machine never stops, in the same manner as the peel.
 */
async function openHeap(db: D1Database): Promise<{ heap: Heap; scraps: Scrap[] }> {
  const open = await db
    .prepare(`${HEAP_SQL} WHERE sealed_at IS NULL ORDER BY id DESC LIMIT 1`)
    .first<Heap>();

  if (open) {
    const scraps = await heapScraps(db, open.id);
    const last = scraps[scraps.length - 1];
    if (!last || now() - last.created_at <= HEAP_STALE) return { heap: open, scraps };
    await db
      .prepare("UPDATE compost_heaps SET sealed_at = ?, reason = 'cold' WHERE id = ? AND sealed_at IS NULL")
      .bind(last.created_at + HEAP_STALE, open.id)
      .run();
  }

  const fresh = await db
    .prepare(`INSERT INTO compost_heaps (started_at) VALUES (?) RETURNING id, started_at, sealed_at, reason`)
    .bind(now())
    .first<Heap>();
  return { heap: fresh!, scraps: [] };
}

/** The full poem of a sealed heap. */
function heapPoem(scraps: Scrap[]): string {
  return `<div class="poem">
${scraps
  .map(
    (s) =>
      `<p class="scrap">${esc(s.body)}<br><span class="meta"><a href="/u/${esc(s.username)}">${esc(s.username)}</a></span></p>`
  )
  .join("\n")}
</div>`;
}

function heapTitle(h: { id: number }): string {
  return `heap #${h.id}`;
}

const COMPOST_MESSAGES: Record<string, string> = {
  twice: "you put the last scrap on this heap. wait for a different user. a heap needs many hands.",
  empty: "a scrap with no text is not a scrap.",
};

app.get("/compost", async (c) => {
  const viewer = c.get("user");
  const { heap, scraps } = await openHeap(c.env.DB);
  const last = scraps[scraps.length - 1];
  const mine = !!viewer && last?.user_id === viewer.id;

  const { results: sealed } = await c.env.DB.prepare(
    `SELECT h.id, h.sealed_at, h.reason,
            COUNT(s.id) AS scraps, COUNT(DISTINCT s.user_id) AS hands
     FROM compost_heaps h JOIN compost_scraps s ON s.heap_id = h.id
     WHERE h.sealed_at IS NOT NULL
     GROUP BY h.id ORDER BY h.sealed_at DESC, h.id DESC LIMIT 20`
  ).all<{ id: number; sealed_at: number; reason: string; scraps: number; hands: number }>();

  const newest = sealed[0] ? await heapScraps(c.env.DB, sealed[0].id) : [];

  const box = last
    ? `<div class="heap-box">
  <p class="faint">the scrap on top of ${esc(heapTitle(heap))}, by <a href="/u/${esc(last.username)}">${esc(last.username)}</a>:</p>
  <p class="top-scrap">${esc(last.body)}</p>
  <p class="faint">${scraps.length} of ${HEAP_SIZE} scraps. the scraps below this one are covered.</p>
</div>`
    : `<div class="heap-box empty">
  <p class="top-scrap faint">🥬</p>
  <p>${esc(heapTitle(heap))} is empty. the first scrap is the first line of the poem.</p>
</div>`;

  let action: string;
  if (!viewer) {
    action = `<p><a href="/login">log in with github</a> to add a scrap.</p>`;
  } else if (mine) {
    action = `<p class="faint">your scrap is on top. wait for a different user to cover it.</p>`;
  } else {
    action = `<form class="stack" method="post" action="/compost">
  <input type="text" name="body" placeholder="one line, a maximum of 120 characters" maxlength="120" autocomplete="off" required>
  <button type="submit">put this scrap on the heap</button>
</form>`;
  }

  const err = COMPOST_MESSAGES[c.req.query("e") ?? ""];

  const body = `
<h1>the compost heap</h1>
<p>a heap is a poem that many users write together. you add one line, and you
see only the line above your own. at ${HEAP_SIZE} lines the heap is full, the
site seals it, and all users read the poem from the top to the bottom.</p>
${err ? `<p class="error">${esc(err)}</p>` : ""}
${c.req.query("ok") ? `<p class="notice">your scrap is on the heap. it is covered when the next user adds a line.</p>` : ""}
${box}
${action}
<p class="faint">rules of the heap: one line at a time, and no user puts two
scraps on a heap in sequence. a heap that nobody feeds for a day goes cold, and
the site seals it in the condition that it has.</p>
<hr>
<h2>the bags</h2>
${
  sealed.length
    ? `<p class="faint">${sealed.length} sealed heap${sealed.length === 1 ? "" : "s"}. this is the newest one.</p>
<h3><a href="/compost/${sealed[0].id}">${esc(heapTitle(sealed[0]))}</a></h3>
<p class="faint">${sealed[0].scraps} scraps by ${sealed[0].hands} user${sealed[0].hands === 1 ? "" : "s"} &middot; sealed ${timeAgo(sealed[0].sealed_at)}</p>
${heapPoem(newest)}
${
  sealed.length > 1
    ? `<p class="faint">older heaps: ${sealed
        .slice(1)
        .map((h) => `<a href="/compost/${h.id}">#${h.id}</a>`)
        .join(" &middot; ")}</p>`
    : ""
}`
    : `<p class="faint">no heap is sealed at this time. the first poem is in
progress now, and you can put a line in it.</p>`
}
`;
  return c.html(layout({ title: "the compost heap", body, username: viewer?.username }));
});

app.post("/compost", async (c) => {
  const user = requireUser(c);
  if (!user) return c.redirect("/login");

  const form = await c.req.parseBody();
  const scrap = String(form.body ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!scrap) return c.redirect("/compost?e=empty");

  const { heap, scraps } = await openHeap(c.env.DB);
  const last = scraps[scraps.length - 1];
  if (last && last.user_id === user.id) return c.redirect("/compost?e=twice");
  if (scraps.length >= HEAP_SIZE) return c.redirect("/compost");

  await c.env.DB.prepare(
    "INSERT INTO compost_scraps (heap_id, user_id, body, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(heap.id, user.id, scrap, now())
    .run();

  if (scraps.length + 1 >= HEAP_SIZE) {
    // This hand filled the heap. The site seals it, and this user is the first
    // person who reads the full poem.
    await c.env.DB.prepare(
      "UPDATE compost_heaps SET sealed_at = ?, reason = 'full' WHERE id = ? AND sealed_at IS NULL"
    )
      .bind(now(), heap.id)
      .run();
    return c.redirect(`/compost/${heap.id}`);
  }
  return c.redirect("/compost?ok=1");
});

// ---- one sealed heap: a poem that you can send to a different person ----
app.get("/compost/:id", async (c) => {
  const viewer = c.get("user");
  const id = Number(c.req.param("id"));

  const heap =
    Number.isSafeInteger(id) && id > 0
      ? await c.env.DB.prepare(`${HEAP_SQL} WHERE id = ?`).bind(id).first<Heap>()
      : null;

  if (!heap || heap.sealed_at === null) {
    // An open heap is not for reading. Its scraps are covered.
    if (heap) return c.redirect("/compost");
    return c.html(
      layout({
        title: "not found",
        body: `<h1>this heap does not exist</h1>
<p>look at <a href="/compost">the compost heap</a> for the heaps that do exist.</p>`,
        username: viewer?.username,
      }),
      404
    );
  }

  const scraps = await heapScraps(c.env.DB, heap.id);
  const hands = new Set(scraps.map((s) => s.user_id)).size;

  const body = `
<h1>${esc(heapTitle(heap))}</h1>
<p class="faint">${scraps.length} scrap${scraps.length === 1 ? "" : "s"} by ${hands} user${hands === 1 ? "" : "s"} &middot;
sealed ${timeAgo(heap.sealed_at)} &middot;
${heap.reason === "cold" ? "this heap went cold" : "this heap became full"}</p>
${scraps.length ? heapPoem(scraps) : `<p class="faint">this heap has no scraps.</p>`}
<hr>
<p class="faint"><a href="/compost">the compost heap</a> &middot; <a href="/feed">the bin</a></p>
`;
  return c.html(layout({ title: heapTitle(heap), body, username: viewer?.username }));
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
