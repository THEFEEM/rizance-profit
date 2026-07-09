/**
 * Post-migration verify: cookie domains + CORS + cross-origin POS session.
 * Usage: node scripts/prod-pos-app-migration-verify.mjs
 */
const PROFIT_APP = "https://rizance.app";
const PROFIT_COM = "https://www.rizance.com";
const POS_ORIGIN = "https://pos.rizance.app";

const stamp = Date.now();
const emailApp = `pos-app-mig-${stamp}@rizance.test`;
const emailCom = `pos-com-mig-${stamp}@rizance.test`;
const password = `Migrate${stamp}!`;

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

async function register(origin, email) {
  const res = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, shopName: "POS Mig Shop" }),
  });
  const setCookies = parseSetCookie(res.headers);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, setCookies, body, session: sessionValue(setCookies) };
}

async function login(origin, email) {
  const res = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookies = parseSetCookie(res.headers);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, setCookies, body, session: sessionValue(setCookies) };
}

async function posSession(session, origin) {
  const res = await fetch(`${PROFIT_APP}/api/pos/session`, {
    headers: { Cookie: `rizance_session=${session}`, Origin: origin },
  });
  const acao = res.headers.get("access-control-allow-origin");
  const body = await res.json().catch(() => ({}));
  return { status: res.status, acao, body };
}

const results = [];
const pass = (n, d = "") => { results.push({ n, ok: true, d }); console.log(`PASS ${n}${d ? `: ${d}` : ""}`); };
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log(`FAIL ${n}: ${d}`); };

console.log("=== D3: login rizance.app cookie domain ===");
const regApp = await register(PROFIT_APP, emailApp);
if (regApp.status !== 200 && regApp.status !== 201) fail("register_app", `status ${regApp.status}`);
else pass("register_app", `status ${regApp.status}`);

const domApp = cookieDomain(regApp.setCookies);
if (domApp === ".rizance.app") pass("cookie_domain_app", domApp);
else fail("cookie_domain_app", domApp ? `got ${domApp}` : "no Domain (want .rizance.app)");

console.log("\n=== D4: login www.rizance.com no Domain ===");
const regCom = await register(PROFIT_COM, emailCom);
if (regCom.status !== 200 && regCom.status !== 201) fail("register_com", `status ${regCom.status}`);
else pass("register_com", `status ${regCom.status}`);

const domCom = cookieDomain(regCom.setCookies);
if (!domCom) pass("cookie_domain_com", "host-only (no Domain)");
else fail("cookie_domain_com", `unexpected Domain=${domCom}`);

console.log("\n=== CORS pos.rizance.app ===");
if (regApp.session) {
  const ps = await posSession(regApp.session, POS_ORIGIN);
  if (ps.status === 200 && ps.acao === POS_ORIGIN) pass("pos_cors", `200 acao=${ps.acao}`);
  else fail("pos_cors", `status ${ps.status} acao=${ps.acao ?? "null"}`);
} else {
  fail("pos_cors", "no session from app register");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
