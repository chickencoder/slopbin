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
import { checkSlopUrl, judgeSlop, screenshotSlop, type SlopEnv } from "./slop";
import { CSS } from "./style";

type Env = SlopEnv & {
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
<p class="tagline">put the slop in the bin.</p>

<p class="lede">
  the internet is full of slop. slopbin is where it goes. an AI agent builds
  this website again and again, and you can build it too.
</p>

<h2>what the site does today</h2>
<ul>
  <li>you find slop on the internet. you paste the link into <a href="/bin">the bin</a>.</li>
  <li>a cloudflare browser photographs the page. a very cheap model explains why it is slop.</li>
  <li>then the photograph is scrunched up and thrown into the bin, in 3D, while you watch.</li>
  <li>the bin keeps the evidence. every verdict has its own page.</li>
  <li>you can also write short text posts in <a href="/feed">the chatter</a>, and there is one <a href="/peel">golden banana peel</a>.</li>
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
    ? `<p><a href="/bin">go to the bin &raquo;</a> &middot; <a href="/how">change this site &raquo;</a></p>`
    : `<p><a href="/bin">look into the bin &raquo;</a> &middot; <a href="/login">log in with github &raquo;</a></p>`
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
  if (c.get("user")) return c.redirect("/bin");
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
  return c.redirect("/bin");
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

  const body = `
<h1>the chatter</h1>
<p class="faint">short text posts, next to <a href="/bin">the bin</a>. newest first. no algorithm.</p>
${peelLead}
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

// ---- the bin: throw slop into it ----
// A user pastes a link. Browser Rendering photographs the page, a very
// cheap model explains why it is slop, and the photograph is scrunched up
// and thrown into a 3D bin while the user watches. The bin keeps the
// evidence forever on /slop/:id.

interface SlopRow {
  id: number;
  url: string;
  verdict: string;
  has_shot: number;
  created_at: number;
  username: string;
}

const SLOP_MESSAGES: Record<string, string> = {
  url: "that is not a public http(s) link. the bin has standards, somehow.",
  slow: "one throw per minute. the bin is still chewing your last one.",
};

/** JSON for inline <script> use. < stops a </script> escape. */
const forScript = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c");

function slopHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}

function slopShot(s: SlopRow): string {
  return s.has_shot
    ? `<img class="shot" src="/slop/${s.id}/shot.jpg" alt="a photograph of the slop" loading="lazy">`
    : `<div class="noshot">no photograph. the page ran from the camera.</div>`;
}

app.get("/bin", async (c) => {
  const viewer = c.get("user");

  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.url, s.verdict, s.has_shot, s.created_at, u.username
     FROM slops s JOIN users u ON u.id = s.user_id
     ORDER BY s.created_at DESC, s.id DESC LIMIT 24`
  ).all<SlopRow>();

  const err = SLOP_MESSAGES[c.req.query("e") ?? ""];

  const form = viewer
    ? `<form class="stack" method="post" action="/slop">
  <input type="url" name="url" placeholder="https://a-link-to-slop.example" maxlength="300" required>
  <button type="submit">put it in the bin</button>
</form>
<p class="faint">the site photographs the page, a very cheap model writes the verdict, and
the photograph is thrown into the bin. one throw per minute.</p>`
    : `<p><a href="/login">log in with github</a> to throw slop into the bin.</p>`;

  const items = results.length
    ? results
        .map(
          (s) => `
<div class="slop">
  <span class="meta"><a href="/u/${esc(s.username)}">${esc(s.username)}</a> binned
  <a href="${esc(s.url)}" rel="nofollow noreferrer">${esc(slopHost(s.url))}</a> &middot;
  <a href="/slop/${s.id}"><time datetime="${isoTime(s.created_at)}">${timeAgo(s.created_at)}</time></a></span>
  <a href="/slop/${s.id}">${slopShot(s)}</a>
  <p class="body">${esc(s.verdict)}</p>
</div>`
        )
        .join("\n")
    : `<p class="faint">the bin is empty. the internet is somehow full of slop and the bin is empty. fix that.</p>`;

  const body = `
<h1>${LOGO} the bin</h1>
<p>the internet makes slop faster than anybody can read it. when you find some,
throw it in here. the bin keeps the evidence.</p>
${err ? `<p class="error">${esc(err)}</p>` : ""}
${form}
<hr>
<h2>freshly binned</h2>
${items}
<p class="faint">🤿 the bin is deeper than this page. <a href="/dive">dive in</a> and
your hand finds one random exhibit.</p>
`;
  return c.html(layout({ title: "the bin", body, username: viewer?.username }));
});

app.post("/slop", async (c) => {
  const user = requireUser(c);
  if (!user) return c.redirect("/login");

  const form = await c.req.parseBody();
  const url = checkSlopUrl(String(form.url ?? ""));
  if (!url) return c.redirect("/bin?e=url");

  // One throw per user per minute. Each throw runs a real browser and a
  // real model, and the bin is not made of money.
  const last = await c.env.DB.prepare(
    "SELECT created_at FROM slops WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(user.id)
    .first<{ created_at: number }>();
  if (last && now() - last.created_at < 60) return c.redirect("/bin?e=slow");

  const [shot, verdict] = await Promise.all([
    screenshotSlop(c.env, url),
    judgeSlop(c.env, url),
  ]);

  const row = await c.env.DB.prepare(
    "INSERT INTO slops (user_id, url, verdict, has_shot, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id"
  )
    .bind(user.id, url, verdict, shot ? 1 : 0, now())
    .first<{ id: number }>();

  if (shot && c.env.SHOTS) await c.env.SHOTS.put(`shots/${row!.id}.jpg`, shot);

  return c.redirect(`/slop/${row!.id}`);
});

// The photograph of one slop, straight from R2.
app.get("/slop/:id/shot.jpg", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0 || !c.env.SHOTS) return c.notFound();
  const obj = await c.env.SHOTS.get(`shots/${id}.jpg`);
  if (!obj) return c.notFound();
  return c.body(obj.body, 200, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});

// The theatre: every visit replays the scrunch and the throw, then the
// verdict appears. Without JavaScript or WebGL the verdict is simply there.
app.get("/slop/:id", async (c) => {
  const viewer = c.get("user");
  const id = Number(c.req.param("id"));

  const slop =
    Number.isSafeInteger(id) && id > 0
      ? await c.env.DB.prepare(
          `SELECT s.id, s.url, s.verdict, s.has_shot, s.created_at, u.username
           FROM slops s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
        )
          .bind(id)
          .first<SlopRow>()
      : null;

  if (!slop) {
    return c.html(
      layout({
        title: "not found",
        body: `<h1>this slop does not exist</h1>
<p>maybe it was too slop even for the bin. <a href="/bin">go to the bin</a>.</p>`,
        username: viewer?.username,
      }),
      404
    );
  }

  const shotUrl = slop.has_shot ? `/slop/${slop.id}/shot.jpg` : "";

  const body = `
<h1>exhibit #${slop.id}</h1>
<span class="meta"><a href="/u/${esc(slop.username)}">${esc(slop.username)}</a> threw
<a href="${esc(slop.url)}" rel="nofollow noreferrer">${esc(slopHost(slop.url))}</a> into the bin
<time datetime="${isoTime(slop.created_at)}">${timeAgo(slop.created_at)}</time></span>
<div id="stage">
  <noscript>${slopShot(slop)}</noscript>
</div>
<div id="verdict" class="verdict">
  <p class="faint">the bin says:</p>
  <blockquote>${esc(slop.verdict)}</blockquote>
  <p class="faint"><a href="/bin">back to the bin</a> &middot; verdict by a very cheap model. the bin stands by it anyway.</p>
</div>
<script type="module">
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

const SHOT = ${forScript(shotUrl)};
const PAGE_URL = ${forScript(slop.url)};

const stage = document.getElementById("stage");
const verdict = document.getElementById("verdict");
const reveal = () => verdict.classList.remove("wait");
verdict.classList.add("wait");
setTimeout(reveal, 7000); // whatever happens, the verdict appears

try {
  const W = Math.min(stage.clientWidth || 600, 640);
  const H = Math.round(W * 0.66);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
  camera.position.set(0, 0.6, 6);
  camera.lookAt(0, -0.5, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x999999, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  // the bin. gray, municipal, patient.
  const bin = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({
    color: 0x9aa3ab, metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide,
  });
  const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 1.1, 24, 1, true), steel);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), steel);
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -0.55;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 8, 32), steel);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.55;
  bin.add(bodyM, bottom, rim);
  bin.position.set(1.7, -1.5, 0);
  scene.add(bin);

  // the sheet of slop: a plane that will regret being printed
  const geo = new THREE.PlaneGeometry(2.8, 1.85, 28, 20);
  const pos = geo.attributes.position;
  const base = pos.array.slice();
  const ball = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(base[i * 3], base[i * 3 + 1], Math.random() - 0.5)
      .normalize()
      .multiplyScalar(0.45 + Math.random() * 0.35);
    ball[i * 3] = v.x; ball[i * 3 + 1] = v.y; ball[i * 3 + 2] = v.z;
  }
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const paper = new THREE.Mesh(geo, mat);
  paper.position.set(-0.5, 0.35, 0);
  scene.add(paper);

  // texture: the photograph, or the bare URL when the camera failed
  const fallbackTexture = () => {
    const cv = document.createElement("canvas");
    cv.width = 1024; cv.height = 676;
    const g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = "#ccc"; g.strokeRect(10, 10, cv.width - 20, cv.height - 20);
    g.fillStyle = "#111"; g.font = "30px monospace"; g.textAlign = "center";
    g.fillText("no photograph. imagine the slop.", cv.width / 2, 140);
    g.fillStyle = "#0000ee"; g.font = "24px monospace";
    g.fillText(PAGE_URL.slice(0, 64), cv.width / 2, cv.height / 2);
    return new THREE.CanvasTexture(cv);
  };
  const useTexture = (t) => { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.needsUpdate = true; };
  if (SHOT) {
    new THREE.TextureLoader().load(SHOT, useTexture, undefined, () => useTexture(fallbackTexture()));
  } else {
    useTexture(fallbackTexture());
  }

  const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
  const clock = new THREE.Clock();
  let revealed = false;

  // the script of the play:
  //   0.0 - 1.2s  the page flutters, unaware
  //   1.2 - 2.6s  the hand scrunches it into a ball
  //   2.6 - 3.6s  the throw, a clean arc into the bin
  //   3.6s +      the bin wobbles, the verdict appears
  function animate() {
    const t = clock.getElapsedTime();

    const k = ease((t - 1.2) / 1.4);
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1];
      pos.array[i * 3] = bx + (ball[i * 3] - bx) * k;
      pos.array[i * 3 + 1] = by + (ball[i * 3 + 1] - by) * k;
      pos.array[i * 3 + 2] = Math.sin(bx * 2.5 + t * 3) * 0.05 * (1 - k) + ball[i * 3 + 2] * k;
    }
    pos.needsUpdate = true;

    const f = ease((t - 2.6) / 1.0);
    if (f > 0 && paper.visible) {
      paper.position.x = -0.5 + (bin.position.x + 0.5) * f;
      paper.position.y = 0.35 + (-1.1 - 0.35) * f + Math.sin(f * Math.PI) * 1.2;
      paper.rotation.z -= 0.13;
      paper.rotation.x -= 0.07;
      paper.scale.setScalar(1 - 0.3 * f);
    }
    if (f >= 1) {
      paper.visible = false;
      bin.rotation.z = Math.sin((t - 3.6) * 12) * 0.06 * Math.max(0, 1 - (t - 3.6));
      if (!revealed) { revealed = true; reveal(); }
    }

    renderer.render(scene, camera);
    if (t < 6.5) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
} catch (e) {
  reveal(); // no WebGL, no theatre. the verdict works without the toss.
}
</script>
`;
  return c.html(
    layout({ title: `exhibit #${slop.id}`, body, username: viewer?.username })
  );
});

// ---- the dive ----
// The bin is deep, and the page of the bin shows only the top of it. A dive
// reaches past the fresh slop and takes one random exhibit out, from any
// time. You look at it, and you throw it back. Thus an old exhibit gets a
// second viewer, and the bottom of the bin stays alive.
app.get("/dive", async (c) => {
  const viewer = c.get("user");

  const slop = await c.env.DB.prepare(
    `SELECT s.id, s.url, s.verdict, s.has_shot, s.created_at, u.username
     FROM slops s JOIN users u ON u.id = s.user_id
     ORDER BY RANDOM() LIMIT 1`
  ).first<SlopRow>();

  if (!slop) {
    return c.html(
      layout({
        title: "the dive",
        body: `<h1>🤿 the dive</h1>
<p>you reach into the bin and your hand finds nothing. the bin is empty.
<a href="/bin">throw the first slop in</a>.</p>`,
        username: viewer?.username,
      })
    );
  }

  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM slops").first<{ n: number }>();
  const n = total?.n ?? 0;

  const body = `
<h1>🤿 the dive</h1>
<p>you reach into the bin, past ${n} exhibit${n === 1 ? "" : "s"}, and your hand
finds <a href="/slop/${slop.id}">exhibit #${slop.id}</a>. it has been in the bin
for ${duration(now() - slop.created_at)}.</p>
<div class="slop">
  <span class="meta"><a href="/u/${esc(slop.username)}">${esc(slop.username)}</a> binned
  <a href="${esc(slop.url)}" rel="nofollow noreferrer">${esc(slopHost(slop.url))}</a> &middot;
  <a href="/slop/${slop.id}"><time datetime="${isoTime(slop.created_at)}">${timeAgo(slop.created_at)}</time></a></span>
  <a href="/slop/${slop.id}">${slopShot(slop)}</a>
  <p class="body">${esc(slop.verdict)}</p>
</div>
<p><a href="/dive">throw it back and dive again &raquo;</a> &middot; <a href="/bin">back to the bin</a></p>
`;
  return c.html(layout({ title: "the dive", body, username: viewer?.username }));
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
