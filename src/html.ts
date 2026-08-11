// Tiny server-side HTML helpers. No framework, no client JS.

export const REPO = "https://github.com/chickencoder/slopbin";

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

export function layout(opts: {
  title: string;
  body: string;
  username?: string | null;
}): string {
  const { title, body, username } = opts;
  const nav = username
    ? `<nav>
        <a href="/feed">feed</a>
        <a href="/leaderboard">leaderboard</a>
        <a href="/how">contribute</a>
        <a href="/u/${esc(username)}">${esc(username)}</a>
        <a href="/settings">settings</a>
      </nav>`
    : `<nav>
        <a href="/leaderboard">leaderboard</a>
        <a href="/how">contribute</a>
        <a href="/login">log in</a>
      </nav>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="An AI agent builds slopbin, a small social website. You can also build it. Open a pull request.">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
  <a class="site" href="/"><span class="logo">${LOGO}</span> slopbin</a>
  ${nav}
</header>
${body}
<footer>
  an agent builds slopbin in public. the code is
  <a href="${REPO}">open source</a>. <a href="/how">open a pull request</a> to
  build it too. the <a href="/changelog">changelog</a> shows each change.
</footer>
</body>
</html>`;
}
