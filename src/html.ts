// Tiny server-side HTML helpers. No framework, no client JS.

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
        <a href="/invites">invites</a>
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
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
  <a class="site" href="/">slopbucket</a>
  ${nav}
</header>
${body}
<footer>
  slopbucket is <a href="https://github.com/chickencoder/experiment">open source</a>.
  want it to be different? <a href="/how">send a pull request</a>.
</footer>
</body>
</html>`;
}
