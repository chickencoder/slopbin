// One stylesheet. Pure CSS, no build step. 2005 at heart, 2025 in font.
export const CSS = `
:root {
  color-scheme: light; /* the site is white-on-purpose; stops dark-mode UA styles */
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
header .logo { font-size: 1.05em; }
header nav { display: inline; }
header nav a { margin-left: 0.75rem; }

h1 { font-size: 1.3rem; }
h2 { font-size: 1.1rem; }

/* homepage gets a little extra air */
.home h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
.home .tagline { margin-top: 0; font-size: 1.1rem; font-weight: 600; color: var(--ink); }
.home .lede { color: var(--faint); }
.home h2 { margin-top: 2rem; }
.home p, .home ul { margin-top: 0.9rem; margin-bottom: 0.9rem; }
.home li { margin-bottom: 0.4rem; }

small, .faint { color: var(--faint); }

hr { border: none; border-top: 1px solid var(--rule); }

.post { margin-bottom: 1.25rem; }
.post .meta { color: var(--faint); font-size: 0.85rem; }
.post .body { margin: 0.15rem 0 0 0; white-space: pre-wrap; word-wrap: break-word; }

form.stack label { display: block; margin-top: 0.75rem; }
input[type=text], input[type=password] {
  font: inherit;
  color: var(--ink);
  background: #fff;
  width: 100%;
  max-width: 24rem;
  padding: 0.3rem;
  border: 1px solid #aaa;
}
button {
  font: inherit;
  color: var(--ink);
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

/* the bin: slop goes in, verdicts come out */
.throw { margin: 1.5rem 0; }
.home .throw input[type=url] { max-width: 28rem; padding: 0.5rem; font-size: 1rem; }
.home .throw button { padding: 0.5rem 1.4rem; font-size: 1rem; }
input[type=url] {
  font: inherit;
  color: var(--ink);
  background: #fff;
  width: 100%;
  max-width: 24rem;
  padding: 0.3rem;
  border: 1px solid #aaa;
}
.slop { margin-bottom: 1.75rem; }
.slop .shot, .slop .noshot { margin-top: 0.35rem; }
img.shot {
  display: block;
  width: 100%;
  max-width: 26rem;
  border: 1px solid var(--rule);
}
.noshot {
  width: 100%;
  max-width: 26rem;
  border: 1px dashed var(--rule);
  color: var(--faint);
  text-align: center;
  padding: 2.5rem 1rem;
}
.slop .body { margin-top: 0.4rem; }

/* the slop theatre on /slop/:id */
#stage { margin: 1rem 0 0.5rem 0; }
#stage canvas { display: block; max-width: 100%; }
.verdict { transition: opacity 0.9s; }
.verdict.wait { opacity: 0; }
.verdict blockquote {
  margin: 0.35rem 0;
  padding: 0.5rem 0.9rem;
  border-left: 3px solid var(--rule);
  font-style: italic;
}

/* count binface: he appears in a corner, says one thing, and can be sent away */
.binface {
  position: fixed;
  bottom: 0.75rem;
  z-index: 10;
  display: flex;
  align-items: flex-end;
  gap: 0.4rem;
  max-width: 18rem;
  animation: binface-rise 0.6s ease-out;
}
.binface.right { right: 0.75rem; }
.binface.left { left: 0.75rem; flex-direction: row-reverse; }
.binface-head { font-size: 3rem; line-height: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.25)); }
.binface-bubble {
  background: #fff;
  border: 1px solid #888;
  border-radius: 6px;
  padding: 0.5rem 0.7rem;
  font-size: 0.85rem;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}
.binface-bubble p { margin: 0.25rem 0 0 0; }
.binface-bubble button { margin-top: 0.5rem; font-size: 0.8rem; padding: 0.15rem 0.6rem; }
@keyframes binface-rise {
  from { transform: translateY(120%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .binface { animation: none; }
}

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
