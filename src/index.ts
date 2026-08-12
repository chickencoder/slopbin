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
import { duration, esc, isoTime, layout, LOGO, ORIGIN, REPO, timeAgo } from "./html";
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

// ---- homepage: the bin itself ----
app.get("/", async (c) => {
  const user = c.get("user");

  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.url, s.verdict, s.has_shot, s.created_at, u.username
     FROM slops s JOIN users u ON u.id = s.user_id
     ORDER BY s.created_at DESC, s.id DESC LIMIT 24`
  ).all<SlopRow>();

  const err = SLOP_MESSAGES[c.req.query("e") ?? ""];

  const form = user
    ? `<form class="stack throw" method="post" action="/slop">
  <input type="url" name="url" placeholder="paste a link to slop" maxlength="300" required>
  <button type="submit">bin it</button>
</form>`
    : `<p class="throw"><a href="/login">log in with github</a> to throw slop in.</p>`;

  const items = results.length
    ? results.map(slopCard).join("\n")
    : `<p class="faint">the bin is empty. fix that.</p>`;

  const body = `
<div class="home">
<h1>${LOGO} slopbin</h1>
<p class="tagline">put the slop in the bin.</p>
<p class="lede">paste a link. a browser photographs it, a very cheap model judges it,
and it is thrown into the bin.</p>
${err ? `<p class="error">${esc(err)}</p>` : ""}
${form}
<hr>
${items}
<p class="faint">🤿 the bin is deeper than this page. <a href="/dive">dive in</a> and
your hand finds one random exhibit.</p>
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
  <li>do not break the login or the slop that the users binned.</li>
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
  if (c.get("user")) return c.redirect("/");
  const body = `
<h1>log in</h1>
<p>a slopbin account is a github account. the first log in makes your account.</p>
<p><a href="/auth/github">log in with github &raquo;</a></p>
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
  return c.redirect("/");
});

app.post("/logout", async (c) => {
  const token = getCookie(c, "session");
  if (token) await deleteSession(c.env.DB, token);
  c.header("Set-Cookie", sessionCookie("", 0));
  return c.redirect("/");
});

// The old text feed and the post permalinks are retired. Old links go home.
app.get("/feed", (c) => c.redirect("/"));
app.get("/p/:id", (c) => c.redirect("/"));

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

/** One binned slop in a list: who, what, when, the photograph, the verdict. */
function slopCard(s: SlopRow): string {
  return `
<div class="slop">
  <span class="meta"><a href="/u/${esc(s.username)}">${esc(s.username)}</a> binned
  <a href="${esc(s.url)}" rel="nofollow noreferrer">${esc(slopHost(s.url))}</a> &middot;
  <a href="/slop/${s.id}"><time datetime="${isoTime(s.created_at)}">${timeAgo(s.created_at)}</time></a></span>
  <a href="/slop/${s.id}">${slopShot(s)}</a>
  <p class="body">${esc(s.verdict)}</p>
</div>`;
}

// The bin is the homepage now.
app.get("/bin", (c) => c.redirect("/"));

app.post("/slop", async (c) => {
  const user = requireUser(c);
  if (!user) return c.redirect("/login");

  const form = await c.req.parseBody();
  const url = checkSlopUrl(String(form.url ?? ""));
  if (!url) return c.redirect("/?e=url");

  // One throw per user per minute. Each throw runs a real browser and a
  // real model, and the bin is not made of money.
  const last = await c.env.DB.prepare(
    "SELECT created_at FROM slops WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(user.id)
    .first<{ created_at: number }>();
  if (last && now() - last.created_at < 60) return c.redirect("/?e=slow");

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

// The social card: a 1200x630 page that exists only to be photographed.
// Link crawlers never see it; they see /slop/:id/og.jpg, which is a
// screenshot of this page.
app.get("/slop/:id/card", async (c) => {
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
  if (!slop) return c.notFound();

  const shot = slop.has_shot
    ? `<img class="cardshot" src="/slop/${slop.id}/shot.jpg" alt="">`
    : `<div class="cardshot cardnoshot">no photograph.<br>the page ran from the camera.</div>`;

  return c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
* { margin: 0; box-sizing: border-box; }
body {
  width: 1200px; height: 630px; overflow: hidden;
  background: #cfd3d7;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  display: flex; align-items: center; gap: 48px; padding: 48px;
}
.cardshot {
  width: 560px; height: 420px; object-fit: cover; object-position: top;
  background: #fff; border: 1px solid #999;
  transform: rotate(-2deg);
  box-shadow: 8px 10px 0 rgba(0,0,0,.15);
  flex: none;
}
.cardnoshot {
  display: flex; align-items: center; justify-content: center;
  text-align: center; color: #666; font-size: 28px;
}
.side { min-width: 0; }
h1 { font-size: 44px; margin-bottom: 8px; }
.who { font-size: 26px; color: #444; margin-bottom: 28px; }
blockquote {
  font-size: 30px; line-height: 1.35; color: #111;
  border-left: 6px solid #555; padding-left: 20px;
  display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical;
  overflow: hidden;
}
.brand { position: fixed; right: 44px; bottom: 32px; font-size: 30px; color: #222; }
</style>
</head>
<body>
${shot}
<div class="side">
  <h1>${LOGO} exhibit #${slop.id}</h1>
  <p class="who">${esc(slop.username)} binned ${esc(slopHost(slop.url))}</p>
  <blockquote>${esc(slop.verdict)}</blockquote>
</div>
<div class="brand">${LOGO} slopbin.com</div>
</body>
</html>`);
});

// The dynamic og image: Browser Rendering photographs the card page one
// time, R2 keeps the photograph, and every crawler after that gets the
// copy from R2.
app.get("/slop/:id/og.jpg", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.notFound();

  const headers = {
    "Content-Type": "image/jpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  const key = `og/${id}.jpg`;
  if (c.env.SHOTS) {
    const cached = await c.env.SHOTS.get(key);
    if (cached) return c.body(cached.body, 200, headers);
  }

  const slop = await c.env.DB.prepare("SELECT id, has_shot FROM slops WHERE id = ?")
    .bind(id)
    .first<{ id: number; has_shot: number }>();
  if (!slop) return c.notFound();

  if (c.env.BROWSER) {
    try {
      const res = await c.env.BROWSER.quickAction("screenshot", {
        url: new URL(c.req.url).origin + `/slop/${id}/card`,
        viewport: { width: 1200, height: 630 },
        screenshotOptions: { type: "jpeg", quality: 80 },
        gotoOptions: { waitUntil: "networkidle0", timeout: 15000 },
      });
      if (res.ok) {
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength > 0) {
          if (c.env.SHOTS) await c.env.SHOTS.put(key, bytes);
          return c.body(bytes, 200, headers);
        }
      }
    } catch {
      // the camera failed. fall through to the plain screenshot.
    }
  }

  // No card photograph. The plain screenshot of the slop is the card.
  if (slop.has_shot && c.env.SHOTS) {
    const shotObj = await c.env.SHOTS.get(`shots/${id}.jpg`);
    if (shotObj) return c.body(shotObj.body, 200, headers);
  }
  return c.notFound();
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
<p>maybe it was too slop even for the bin. <a href="/">go to the bin</a>.</p>`,
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
  <p class="faint"><a href="/">back to the bin</a>
  <span id="replayrow" hidden>&middot; <a href="#" id="replay">throw it again</a></span>
  <span id="dlrow" hidden>&middot; <a href="#" id="dl">download the toss (video)</a></span>
  &middot; permalink: <a href="${ORIGIN}/slop/${slop.id}">slopbin.com/slop/${slop.id}</a>
  &middot; verdict by a very cheap model. the bin stands by it anyway.</p>
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
  // gray stage. most slop is a white page, and white on white is invisible.
  scene.background = new THREE.Color(0xb8bec4);
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

  // the address, painted on the stage floor. a downloaded video keeps it,
  // and the video tells its viewers where the bin is.
  const wmCanvas = document.createElement("canvas");
  wmCanvas.width = 512; wmCanvas.height = 128;
  const wg = wmCanvas.getContext("2d");
  wg.font = "bold 64px monospace";
  wg.textAlign = "left";
  wg.textBaseline = "middle";
  wg.fillStyle = "rgba(35, 40, 45, 0.8)";
  wg.fillText("slopbin.com", 8, 64);
  const wmTexture = new THREE.CanvasTexture(wmCanvas);
  const wm = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 0.425),
    new THREE.MeshBasicMaterial({ map: wmTexture, transparent: true })
  );
  wm.position.set(-1.9, -2.1, 0.5);
  scene.add(wm);

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
  let t0 = performance.now();
  let raf = 0;
  let revealed = false;
  let recorder = null;

  // the script of the play:
  //   0.0 - 1.2s  the page flutters, unaware
  //   1.2 - 2.6s  the hand scrunches it into a ball
  //   2.6 - 3.6s  the throw, a clean arc into the bin
  //   3.6s +      the bin wobbles, the verdict appears
  function animate() {
    const t = (performance.now() - t0) / 1000;

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
      paper.rotation.z = -7.8 * f;
      paper.rotation.x = -4.2 * f;
      paper.scale.setScalar(1 - 0.3 * f);
    }
    if (f >= 1) {
      paper.visible = false;
      bin.rotation.z = Math.sin((t - 3.6) * 12) * 0.06 * Math.max(0, 1 - (t - 3.6));
      if (!revealed) { revealed = true; reveal(); }
    }

    renderer.render(scene, camera);
    if (t < 6.5) {
      raf = requestAnimationFrame(animate);
    } else if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
  }

  /** Rewind the play to the first scene and run it again. */
  function play() {
    cancelAnimationFrame(raf);
    paper.visible = true;
    paper.rotation.set(0, 0, 0);
    paper.scale.setScalar(1);
    paper.position.set(-0.5, 0.35, 0);
    bin.rotation.z = 0;
    t0 = performance.now();
    raf = requestAnimationFrame(animate);
  }
  play();

  // throw it again, for free
  const replay = document.getElementById("replay");
  document.getElementById("replayrow").hidden = false;
  replay.addEventListener("click", (e) => { e.preventDefault(); if (!recorder) play(); });

  // download the toss: replay the play while MediaRecorder films the canvas
  const dl = document.getElementById("dl");
  const mime = ["video/webm;codecs=vp9", "video/webm", "video/mp4"].find(
    (m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)
  );
  if (mime && renderer.domElement.captureStream) {
    document.getElementById("dlrow").hidden = false;
    dl.addEventListener("click", (e) => {
      e.preventDefault();
      if (recorder) return; // one film at a time
      dl.textContent = "filming the toss...";
      const chunks = [];
      recorder = new MediaRecorder(renderer.domElement.captureStream(30), { mimeType: mime });
      recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      recorder.onstop = () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(chunks, { type: mime }));
        a.download = "slopbin-exhibit-${slop.id}." + (mime.startsWith("video/mp4") ? "mp4" : "webm");
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        recorder = null;
        dl.textContent = "download the toss (video)";
      };
      recorder.start();
      play();
    });
  }
} catch (e) {
  reveal(); // no WebGL, no theatre. the verdict works without the toss.
}
</script>
`;
  return c.html(
    layout({
      title: `exhibit #${slop.id} · slopbin`,
      body,
      username: viewer?.username,
      og: {
        path: `/slop/${slop.id}`,
        image: `/slop/${slop.id}/og.jpg`,
        description: slop.verdict,
      },
    })
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
<a href="/">throw the first slop in</a>.</p>`,
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
<p><a href="/dive">throw it back and dive again &raquo;</a> &middot; <a href="/">back to the bin</a></p>
`;
  return c.html(layout({ title: "the dive", body, username: viewer?.username }));
});

// The golden banana peel is retired. Its history stays in the database.
app.get("/peel", (c) => c.redirect("/"));

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
    `SELECT s.id, s.url, s.verdict, s.has_shot, s.created_at, u.username
     FROM slops s JOIN users u ON u.id = s.user_id
     WHERE s.user_id = ? ORDER BY s.created_at DESC, s.id DESC LIMIT 50`
  )
    .bind(profile.id)
    .all<SlopRow>();

  const body = `
<h1>${esc(profile.username)}</h1>
<p class="faint">joined ${timeAgo(profile.created_at)} &middot; ${results.length ? `${results.length} slop${results.length === 1 ? "" : "s"} binned &middot; ` : ""}${profile.merged_prs} merged PR${profile.merged_prs === 1 ? "" : "s"} &middot; <a href="https://github.com/${esc(profile.username)}">github</a></p>
<hr>
${results.length ? results.map(slopCard).join("\n") : `<p class="faint">${esc(profile.username)} has not binned any slop yet.</p>`}
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
