// The slop machine: a URL goes in, a screenshot and a verdict come out.
//
// - Cloudflare Browser Rendering (the BROWSER binding) photographs the page.
// - A very cheap model, routed through the "slopbin" AI Gateway, explains
//   why the page is slop.
//
// Each part can fail: the page can be slow, the model can be asleep. The
// bin accepts the slop anyway, with a placeholder photograph and a stock
// verdict. A thrown link must always land in the bin.

export interface BrowserRunBinding {
  quickAction(action: "screenshot", options: Record<string, unknown>): Promise<Response>;
}

export interface SlopEnv {
  BROWSER?: BrowserRunBinding;
  AI?: Ai;
  SHOTS?: R2Bucket;
  AI_GATEWAY_ID?: string;
}

/** Cheap on purpose. The bin does not pay for a large model's opinion. */
const SLOP_MODEL = "@cf/meta/llama-3.2-3b-instruct";

const STOCK_VERDICT =
  "the model looked at it, sighed, and said nothing. it is slop. into the bin with it.";

/**
 * Accept only a public http(s) URL. Returns the normalized URL, or null.
 * The screenshot runs on Cloudflare's browsers, not in our network, but we
 * still refuse the obvious non-public addresses.
 */
export function checkSlopUrl(raw: string): string | null {
  const s = raw.trim();
  if (s.length === 0 || s.length > 300) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".")) return null; // no "localhost", no bare names
  if (host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)) return null;
    if ((a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return null;
  }
  if (host.startsWith("[")) return null; // no IPv6 literals
  return u.toString();
}

/** Photograph the page. Returns JPEG bytes, or null if the camera failed. */
export async function screenshotSlop(env: SlopEnv, url: string): Promise<ArrayBuffer | null> {
  if (!env.BROWSER) return null;
  try {
    const res = await env.BROWSER.quickAction("screenshot", {
      url,
      viewport: { width: 1024, height: 768 },
      screenshotOptions: { type: "jpeg", quality: 70 },
      gotoOptions: { waitUntil: "domcontentloaded", timeout: 15000 },
    });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    return bytes.byteLength > 0 ? bytes : null;
  } catch {
    return null;
  }
}

/** Ask a very cheap model why the page is slop. Always returns a verdict. */
export async function judgeSlop(env: SlopEnv, url: string): Promise<string> {
  if (!env.AI) return STOCK_VERDICT;
  try {
    const out = (await env.AI.run(
      SLOP_MODEL,
      {
        messages: [
          {
            role: "system",
            content:
              "You are the bin on slopbin, a small website where users throw " +
              "links to internet slop into a bin. A user throws a link in. In " +
              "at most 40 words, give the bin's verdict: a short, playful, " +
              "family-friendly roast of why this page is slop. Judge only from " +
              "the URL. Roast the page, never a person or a group. No preamble, " +
              "no quotation marks, lowercase.",
          },
          { role: "user", content: `the link: ${url}` },
        ],
        max_tokens: 120,
      },
      env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined
    )) as { response?: string };
    const verdict = (out.response ?? "").trim();
    return verdict ? verdict.slice(0, 400) : STOCK_VERDICT;
  } catch {
    return STOCK_VERDICT;
  }
}
