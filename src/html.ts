// Tiny server-side HTML helpers. No framework, no client JS.

import { binfaceVisit } from "./binface";

export const REPO = "https://github.com/chickencoder/slopbin";

/** The bin's own address. Permalinks and social cards use this domain. */
export const ORIGIN = "https://slopbin.com";

/** The whole brand: a bin. */
export const LOGO = "🗑️";

// Favicon without a binary asset: the same bin, drawn as an inline SVG data
// URI. Structural characters are percent-encoded so the URL survives the
// attribute; the emoji itself is fine as UTF-8.
const FAVICON =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20" +
  "viewBox%3D%220%200%20100%20100%22%3E%3Ctext%20y%3D%22.9em%22%20font-size%3D%2290%22%3E" +
  LOGO +
  "%3C%2Ftext%3E%3C%2Fsvg%3E";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The stamp for the datetime attribute of a <time> element. */
export function isoTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

export function timeAgo(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** A length of time, with no "ago". Example: "3h", "2d", "45m". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function layout(opts: {
  title: string;
  body: string;
  username?: string | null;
  /** Social metadata. `path` becomes the canonical slopbin.com permalink. */
  og?: { path: string; image?: string; description?: string };
}): string {
  const { title, body, username, og } = opts;

  const description =
    og?.description ??
    "slopbin: put the slop in the bin. An AI agent builds this website, and you can build it too.";

  const social = og
    ? `<link rel="canonical" href="${ORIGIN}${esc(og.path)}">
<meta property="og:site_name" content="slopbin">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${ORIGIN}${esc(og.path)}">
${
  og.image
    ? `<meta property="og:image" content="${ORIGIN}${esc(og.image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">`
    : `<meta name="twitter:card" content="summary">`
}`
    : "";
  const nav = username
    ? `<nav>
        <a href="/leaderboard">leaderboard</a>
        <a href="/u/${esc(username)}">${esc(username)}</a>
        <a href="/settings">settings</a>
      </nav>`
    : `<nav>
        <a href="/leaderboard">leaderboard</a>
        <a href="/login">log in</a>
      </nav>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${social}
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
  <a class="site" href="/"><span class="logo">${LOGO}</span> slopbin</a>
  ${nav}
</header>
${body}
${binfaceVisit()}
<footer>
  an agent builds slopbin in public. the code is
  <a href="${REPO}">open source</a>. <a href="/how">open a pull request</a> to
  build it too. the <a href="/changelog">changelog</a> shows each change.
</footer>
</body>
</html>`;
}
