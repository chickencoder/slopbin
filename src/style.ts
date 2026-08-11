// One stylesheet. Pure CSS, no build step. 2005 at heart, 2025 in font.
export const CSS = `
:root {
  --link: #0000ee;
  --visited: #551a8b;
  --ink: #111;
  --faint: #666;
  --rule: #ddd;
}

* { box-sizing: border-box; }

body {
  font-family: -apple-system, "Helvetica Neue", "Segoe UI", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink);
  background: #fff;
  max-width: 40rem;
  margin: 0 auto;
  padding: 1rem;
}

a { color: var(--link); }
a:visited { color: var(--visited); }

header {
  border-bottom: 1px solid var(--rule);
  padding-bottom: 0.5rem;
  margin-bottom: 1.5rem;
}

header .site { font-weight: 700; text-decoration: none; color: var(--ink); }
header .site:visited { color: var(--ink); }
header nav { display: inline; }
header nav a { margin-left: 0.75rem; }

h1 { font-size: 1.3rem; }
h2 { font-size: 1.1rem; }

/* homepage gets a little extra air */
.home h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
.home .tagline { margin-top: 0; color: var(--faint); }
.home h2 { margin-top: 2rem; }
.home p, .home ul { margin-top: 0.9rem; margin-bottom: 0.9rem; }
.home li { margin-bottom: 0.4rem; }

small, .faint { color: var(--faint); }

hr { border: none; border-top: 1px solid var(--rule); }

.post { margin-bottom: 1.25rem; }
.post .meta { color: var(--faint); font-size: 0.85rem; }
.post .body { margin: 0.15rem 0 0 0; white-space: pre-wrap; word-wrap: break-word; }

form.stack label { display: block; margin-top: 0.75rem; }
input[type=text], input[type=password], textarea {
  font: inherit;
  width: 100%;
  max-width: 24rem;
  padding: 0.3rem;
  border: 1px solid #aaa;
}
textarea { max-width: 100%; height: 5rem; }
button {
  font: inherit;
  margin-top: 0.75rem;
  padding: 0.3rem 0.9rem;
  border: 1px solid #888;
  background: #f4f4f4;
  cursor: pointer;
}
button:hover { background: #eaeaea; }

table { border-collapse: collapse; }
th, td { text-align: left; padding: 0.25rem 1.25rem 0.25rem 0; }
th { border-bottom: 1px solid var(--rule); }

.error { color: #b00020; }
.notice { color: #0a6b2d; }

code, pre { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }

footer {
  margin-top: 3rem;
  border-top: 1px solid var(--rule);
  padding-top: 0.5rem;
  font-size: 0.85rem;
  color: var(--faint);
}
`;
