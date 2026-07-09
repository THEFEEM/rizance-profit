/**
 * Production smoke: session cookie domain + POS CORS + login next flow.
 * Usage: node scripts/prod-pos-auth-smoke.mjs
 */
const PROFIT = "https://rizance.com";
const POS_ORIGINS = ["https://rizance-pos.vercel.app", "https://pos.rizance.com"];

const stamp = Date.now();
const email = `pos-prod-smoke-${stamp}@rizance.test`;
const password = `Smoke${stamp}!`;

function parseSetCookie(headers) {
  const raw = headers.getSetCookie?.() ?? [];
  if (raw.length) return raw;
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function cookieDomain(setCookies) {
  for (const c of setCookies) {
    const m = /;\s*Domain=([^;]+)/i.exec(c);
    if (m) return m[1].trim();
  }
  return null;
}

function sessionValue(setCookies) {
  for (const c of setCookies) {
    const m = /^rizance_session=([^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

async function register() {
  const res = await fetch(`${PROFIT}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, shopName: "POS Smoke Shop" }),
  });
  const setCookies = parseSetCookie(res.headers);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, setCookies, body, session: sessionValue(setCookies) };
}

async function posSession(session, origin) {
  const res = await fetch(`${PROFIT}/api/pos/session`, {
    headers: {
      Cookie: `rizance_session=${session}`,
      Origin: origin,
    },
  });
  const acao = res.headers.get("access-control-allow-origin");
  const body = await res.json().catch(() => ({}));
  return { status: res.status, acao, body };
}

async function loginPageHasNext(nextUrl) {
  const res = await fetch(`${PROFIT}/login?next=${encodeURIComponent(nextUrl)}`);
  const html = await res.text();
  return res.status === 200 && html.includes("login");
}

async function main() {
  const results = [];
  const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL ${name}: ${detail}`);
  };
  const pass = (name, detail = "") => {
    results.push({ name, ok: true, detail });
    console.log(`PASS ${name}${detail ? `: ${detail}` : ""}`);
  };

  console.log(`Registering ${email}...`);
  const reg = await register();
  if (reg.status !== 200 && reg.status !== 201) {
    fail("register", `status ${reg.status} ${JSON.stringify(reg.body)}`);
    process.exit(1);
  }
  pass("register", `status ${reg.status}`);

  const domain = cookieDomain(reg.setCookies);
  if (domain === ".rizance.com") pass("cookie_domain", domain);
  else fail("cookie_domain", domain ? `got ${domain}, want .rizance.com` : "no Domain attribute on session cookie");

  if (!reg.session) {
    fail("session_cookie", "missing rizance_session");
    process.exit(1);
  }
  pass("session_cookie", "present");

  for (const origin of POS_ORIGINS) {
    const ps = await posSession(reg.session, origin);
    if (ps.status === 200 && ps.body?.data?.user?.id) {
      if (ps.acao === origin) pass(`pos_session_cors_${new URL(origin).host}`, `200 acao=${ps.acao}`);
      else fail(`pos_session_cors_${new URL(origin).host}`, `status 200 but acao=${ps.acao ?? "null"} (expected ${origin})`);
    } else {
      fail(`pos_session_cors_${new URL(origin).host}`, `status ${ps.status} acao=${ps.acao ?? "null"}`);
    }
  }

  const posUrl = POS_ORIGINS[0];
  const loginOk = await loginPageHasNext(posUrl);
  if (loginOk) pass("login_next_page", `accepts next=${posUrl}`);
  else fail("login_next_page", "login page not reachable with next param");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
