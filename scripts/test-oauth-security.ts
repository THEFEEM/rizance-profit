/**
 * A-3.SEC — OAuth state · safeReturnTo · reauth proof (no DB, no network)
 *
 * ขอบเขตที่ถูกจำลอง (mock boundary): **ไม่เรียก Google เลย** — เราทดสอบเฉพาะ
 * primitive ฝั่งเราที่ตัดสินว่า callback จะถูกยอมรับหรือไม่ · การแลก code และ
 * การ verify ID token เป็นหน้าที่ของ google-auth-library ซึ่งไม่ได้ทดสอบที่นี่
 *
 * Usage: npx tsx scripts/test-oauth-security.ts
 */
import { SignJWT } from "jose";

process.env.JWT_SECRET ??= "a3sec-test-secret-value-32-characters";

import {
  createOAuthState,
  verifyOAuthState,
  safeReturnTo,
  issueReauthProof,
  verifyReauthProof,
  clearOAuthStateCookie,
  clearReauthProofCookie,
  OAUTH_STATE_COOKIE,
  REAUTH_COOKIE,
  REAUTH_COOKIE_PATH,
  REAUTH_DEFAULT_RETURN_TO,
} from "../lib/oauth-state";
import { verifySession } from "../lib/jwt";
import { authorizeGoogleReauth, resolveVerifiedGoogleEmail } from "../lib/google-oauth";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const head = (t: string) => console.log(`\n== ${t} ${"=".repeat(Math.max(0, 58 - t.length))}`);

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

async function main(): Promise<void> {
  // ════════════════════════════════════════════════════════════════════
  head("1 · OAUTH STATE");

  const login = await createOAuthState({ purpose: "login" });

  check(
    "1.1 state >= 128 bits",
    Buffer.from(login.state, "base64url").length >= 16,
    `${Buffer.from(login.state, "base64url").length} bytes`,
  );
  check("1.2 state opaque (base64url only, no user data)", /^[A-Za-z0-9_-]+$/.test(login.state));
  check("1.3 cookie httpOnly", login.cookieOptions.httpOnly === true);
  check("1.4 cookie sameSite=lax (callback is a cross-site top-level GET)", login.cookieOptions.sameSite === "lax");
  check("1.5 cookie path scoped", login.cookieOptions.path === "/api/auth/google");
  check("1.6 cookie TTL <= 15 min", login.cookieOptions.maxAge <= 900, `${login.cookieOptions.maxAge}s`);
  check("1.7 cookie name", login.cookieName === OAUTH_STATE_COOKIE);
  check("1.8 two flows produce different state", (await createOAuthState({ purpose: "login" })).state !== login.state);

  check("1.9 (T1) valid state accepted", (await verifyOAuthState(login.cookieValue, login.state))?.purpose === "login");
  check("1.10 (T2) missing state rejected", (await verifyOAuthState(login.cookieValue, null)) === null);
  check("1.11 (T2) missing cookie rejected", (await verifyOAuthState(undefined, login.state)) === null);
  check("1.12 (T3) wrong state rejected", (await verifyOAuthState(login.cookieValue, "wrong-state-value")) === null);

  const other = await createOAuthState({ purpose: "login" });
  check("1.13 (T6) state from another browser/flow rejected", (await verifyOAuthState(login.cookieValue, other.state)) === null);

  const nowSec = Math.floor(Date.now() / 1000);
  const expired = await new SignJWT({ purpose: "login", nonce: login.state })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSec - 3600)
    .setExpirationTime(nowSec - 60)
    .sign(secret);
  check("1.14 (T4) expired state rejected", (await verifyOAuthState(expired, login.state)) === null);

  check("1.15 (T7) tampered signature rejected", (await verifyOAuthState(login.cookieValue.slice(0, -3) + "AAA", login.state)) === null);

  const wrongSecret = await new SignJWT({ purpose: "login", nonce: login.state })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m")
    .sign(new TextEncoder().encode("a-completely-different-secret-value"));
  check("1.16 (T7) foreign-signed cookie rejected", (await verifyOAuthState(wrongSecret, login.state)) === null);

  const badPurpose = await new SignJWT({ purpose: "evil", nonce: login.state })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(secret);
  check("1.17 (T7) unknown purpose rejected", (await verifyOAuthState(badPurpose, login.state)) === null);

  const cleared = clearOAuthStateCookie();
  check("1.18 (T5) clear sets maxAge=0 (single use enforced by route)", cleared.options.maxAge === 0 && cleared.name === OAUTH_STATE_COOKIE);
  check("1.19 (T5) replay after clear has no cookie -> rejected", (await verifyOAuthState(cleared.value || undefined, login.state)) === null);

  const reauthState = await createOAuthState({ purpose: "reauth", uid: "u-1", returnTo: "/settings/account" });
  const reauthClaims = await verifyOAuthState(reauthState.cookieValue, reauthState.state);
  check("1.20 reauth purpose round-trips", reauthClaims?.purpose === "reauth");
  check("1.21 uid carried in signed cookie, not in state param", reauthClaims?.uid === "u-1" && !reauthState.state.includes("u-1"));

  const forgedUid = await new SignJWT({ purpose: "reauth", nonce: reauthState.state, uid: "someone-else" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m")
    .sign(new TextEncoder().encode("attacker-secret-value-not-ours!!"));
  check("1.22 (T7) forged uid in unsigned-by-us cookie rejected", (await verifyOAuthState(forgedUid, reauthState.state)) === null);

  // ════════════════════════════════════════════════════════════════════
  head("2 · SAFE RETURN TO");

  const bad: Array<[string | null | undefined, string]> = [
    ["https://evil.example", "T8 absolute URL"],
    ["http://evil.example/x", "T8 absolute URL"],
    ["//evil.example", "T9 protocol-relative"],
    ["//evil.example/path", "T9 protocol-relative"],
    ["/\\evil.example", "backslash trick"],
    ["javascript:alert(1)", "javascript:"],
    ["JavaScript:alert(1)", "javascript: mixed case"],
    ["data:text/html,<script>", "data:"],
    ["/home\r\nSet-Cookie: x=1", "CRLF injection"],
    ["", "empty"],
    [null, "null"],
    [undefined, "undefined"],
  ];
  for (const [value, why] of bad) {
    check(`2.x reject ${why}: ${JSON.stringify(value)}`, safeReturnTo(value, "/home") === "/home", `got ${safeReturnTo(value, "/home")}`);
  }

  for (const value of ["/home", "/settings/account", "/settings/account?tab=security", "/home#top"]) {
    check(`2.y (T10) accept internal path: ${value}`, safeReturnTo(value, "/home") === value, `got ${safeReturnTo(value, "/home")}`);
  }

  // ════════════════════════════════════════════════════════════════════
  head("3 · REAUTH PROOF");

  const USER_A = "11111111-1111-4111-8111-111111111111";
  const USER_B = "22222222-2222-4222-8222-222222222222";

  const proof = await issueReauthProof(USER_A);
  check("3.1 cookie httpOnly", proof.options.httpOnly === true);
  check("3.2 sameSite=lax", proof.options.sameSite === "lax");
  check("3.3 path scoped to /api/account", proof.options.path === REAUTH_COOKIE_PATH);
  check("3.4 TTL <= 10 min", proof.options.maxAge > 0 && proof.options.maxAge <= 600, `${proof.options.maxAge}s`);
  check("3.5 cookie name", proof.name === REAUTH_COOKIE);

  check("3.6 (T11) same user -> accepted", (await verifyReauthProof(proof.value, USER_A)) === true);
  check("3.7 (T12) proof of A used for B -> rejected", (await verifyReauthProof(proof.value, USER_B)) === false);
  check("3.8 (T13) no current user -> rejected", (await verifyReauthProof(proof.value, "")) === false);
  check("3.9 (T13) no cookie -> rejected", (await verifyReauthProof(undefined, USER_A)) === false);

  const expiredProof = await new SignJWT({ purpose: "account_destructive_reauth", uid: USER_A })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSec - 3600)
    .setExpirationTime(nowSec - 60)
    .sign(secret);
  check("3.10 (T14) expired proof rejected", (await verifyReauthProof(expiredProof, USER_A)) === false);
  check("3.11 (T15) tampered proof rejected", (await verifyReauthProof(proof.value.slice(0, -3) + "AAA", USER_A)) === false);

  const wrongPurpose = await new SignJWT({ purpose: "login", uid: USER_A })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(secret);
  check("3.12 (T15) wrong purpose rejected", (await verifyReauthProof(wrongPurpose, USER_A)) === false);

  const sessionLike = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" }).setSubject(USER_A).setIssuedAt().setExpirationTime("7d").sign(secret);
  check("3.13 ordinary 7-day session JWT is NOT valid reauth proof", (await verifyReauthProof(sessionLike, USER_A)) === false);

  check("3.14 reauth proof cannot be used as a session cookie (no sub)", (await verifySession(proof.value)) === null);
  check("3.15 oauth state cookie cannot be used as a session cookie", (await verifySession(login.cookieValue)) === null);

  check("3.16 clearReauthProofCookie sets maxAge=0", clearReauthProofCookie().options.maxAge === 0);

  // ════════════════════════════════════════════════════════════════════
  head("4 · GOOGLE email_verified (A-3.SEC-4)");

  // A · verified -> allowed through the email-binding decision
  const okBinding = resolveVerifiedGoogleEmail({ email: "Owner@Example.com ", email_verified: true });
  check("4.1 (A) email_verified=true -> allowed", okBinding.ok === true);
  check("4.2 (A) email normalised (trim + lowercase)", okBinding.ok === true && okBinding.email === "owner@example.com");

  // B · unverified -> rejected
  const unverified = resolveVerifiedGoogleEmail({ email: "victim@example.com", email_verified: false });
  check("4.3 (B) email_verified=false -> rejected", unverified.ok === false);
  check("4.4 (B) reason is email_unverified", unverified.ok === false && unverified.reason === "email_unverified");

  // C · missing claim -> rejected (fail-closed)
  check("4.5 (C) email_verified missing -> rejected", resolveVerifiedGoogleEmail({ email: "a@b.com" }).ok === false);
  check("4.6 (C) email_verified=undefined -> rejected", resolveVerifiedGoogleEmail({ email: "a@b.com", email_verified: undefined }).ok === false);
  check("4.7 (C) email_verified=null -> rejected", resolveVerifiedGoogleEmail({ email: "a@b.com", email_verified: null }).ok === false);

  // fail-closed on non-boolean truthy values — we accept boolean true only
  check('4.8 email_verified="true" (string) -> rejected', resolveVerifiedGoogleEmail({ email: "a@b.com", email_verified: "true" }).ok === false);
  check("4.9 email_verified=1 -> rejected", resolveVerifiedGoogleEmail({ email: "a@b.com", email_verified: 1 }).ok === false);
  check('4.10 email_verified="TRUE" -> rejected', resolveVerifiedGoogleEmail({ email: "a@b.com", email_verified: "TRUE" }).ok === false);

  // D · email missing -> rejected where email is required
  check("4.11 (D) email missing -> rejected", resolveVerifiedGoogleEmail({ email_verified: true }).ok === false);
  check("4.12 (D) email empty -> rejected", resolveVerifiedGoogleEmail({ email: "", email_verified: true }).ok === false);
  check("4.13 (D) email whitespace only -> rejected", resolveVerifiedGoogleEmail({ email: "   ", email_verified: true }).ok === false);
  check("4.14 (D) email null -> rejected", resolveVerifiedGoogleEmail({ email: null, email_verified: true }).ok === false);
  const noEmail = resolveVerifiedGoogleEmail({ email_verified: true });
  check("4.15 (D) reason is no_email", noEmail.ok === false && noEmail.reason === "no_email");

  // E + F · structural proof that the route cannot reach link/create when rejected.
  // Source is read with comments stripped so a mention inside a comment can never
  // satisfy an ordering assertion (lesson from the 0098 harness).
  // npm script รันจาก package root เสมอ
  const routePath = join(process.cwd(), "app", "api", "auth", "google", "callback", "route.ts");
  const src = readFileSync(routePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

  const iResolve = src.indexOf("resolveVerifiedGoogleEmail(payload)");
  const iLink = src.indexOf("linkGoogleAccount(");
  const iCreate = src.indexOf("createGoogleUser(");
  const iReject = src.indexOf('loginRedirect(req, "google_unverified_email")');

  check("4.16 route calls resolveVerifiedGoogleEmail(payload)", iResolve > -1);
  check("4.17 route has an unverified-email rejection path", iReject > -1);
  check("4.18 (E) verification happens BEFORE linkGoogleAccount", iResolve > -1 && iLink > -1 && iResolve < iLink);
  check("4.19 (F) verification happens BEFORE createGoogleUser", iResolve > -1 && iCreate > -1 && iResolve < iCreate);
  check("4.20 (E/F) rejection returns before linkGoogleAccount", iReject > -1 && iLink > -1 && iReject < iLink);
  check("4.21 (E/F) rejection returns before createGoogleUser", iReject > -1 && iCreate > -1 && iReject < iCreate);
  check(
    "4.22 rejection is a return (cannot fall through)",
    /return\s+loginRedirect\(req,\s*"google_unverified_email"\)/.test(src),
  );
  check(
    "4.23 google_id match still runs before any email binding (unchanged behaviour)",
    src.indexOf("findUserByGoogleId(googleId)") > -1 &&
      src.lastIndexOf("findUserByGoogleId(googleId)") < iResolve,
  );
  check(
    "4.24 error message does not leak account existence",
    (src.match(/google_unverified_email/g) ?? []).length === 1,
  );

  // ════════════════════════════════════════════════════════════════════
  head("5 · CROSS-ACCOUNT REAUTH DECISION (A-3.SEC-5)");

  // ชุดเทสนี้เรียก "การตัดสินใจจริง" ที่ควบคุม issueReauthProof() ตรง ๆ
  // ไม่ใช่การส่องลำดับในซอร์สแบบหมวด 4 — บทเรียนจาก M6 ที่หลุดออกไปได้
  const A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

  // ALLOW — state / current / google-linked เป็นคนเดียวกันทั้งหมด
  check("5.1 same state+current+google-linked -> ALLOW",
    authorizeGoogleReauth({ stateUserId: A, currentUserId: A, googleLinkedUserId: A }).ok === true);

  // DENY — google-linked ต่างจาก current  ← เคสที่ M6 ควรจับได้
  const crossAccount = authorizeGoogleReauth({ stateUserId: A, currentUserId: A, googleLinkedUserId: B });
  check("5.2 google-linked user != current -> DENY", crossAccount.ok === false);
  check("5.3 reason = google_user_mismatch",
    crossAccount.ok === false && crossAccount.reason === "google_user_mismatch");

  // DENY — ไม่มีใครผูก google_id นี้ (บัญชี Google ที่ไม่รู้จักเลย)
  const notLinked = authorizeGoogleReauth({ stateUserId: A, currentUserId: A, googleLinkedUserId: null });
  check("5.4 google-linked user missing (null) -> DENY", notLinked.ok === false);
  check("5.5 reason = google_not_linked", notLinked.ok === false && notLinked.reason === "google_not_linked");
  check("5.6 google-linked user missing (undefined) -> DENY",
    authorizeGoogleReauth({ stateUserId: A, currentUserId: A, googleLinkedUserId: undefined }).ok === false);
  check("5.7 google-linked user missing (empty string) -> DENY",
    authorizeGoogleReauth({ stateUserId: A, currentUserId: A, googleLinkedUserId: "" }).ok === false);

  // DENY — state ไม่ตรงกับผู้ใช้ที่ล็อกอินอยู่ (session ถูกสลับระหว่างอยู่หน้า Google)
  const stateMismatch = authorizeGoogleReauth({ stateUserId: B, currentUserId: A, googleLinkedUserId: A });
  check("5.8 state user != current user -> DENY", stateMismatch.ok === false);
  check("5.9 reason = state_user_mismatch",
    stateMismatch.ok === false && stateMismatch.reason === "state_user_mismatch");
  check("5.10 state uid missing -> DENY",
    authorizeGoogleReauth({ stateUserId: null, currentUserId: A, googleLinkedUserId: A }).ok === false);

  // DENY — ไม่มี session จริง (ผู้ใช้ถูกลบ / cookie หมดอายุระหว่างอยู่หน้า Google)
  const noUser = authorizeGoogleReauth({ stateUserId: A, currentUserId: null, googleLinkedUserId: A });
  check("5.11 no live current user -> DENY", noUser.ok === false);
  check("5.12 reason = no_current_user", noUser.ok === false && noUser.reason === "no_current_user");
  check("5.13 current user empty string -> DENY",
    authorizeGoogleReauth({ stateUserId: A, currentUserId: "", googleLinkedUserId: A }).ok === false);

  // DENY — ทุกอย่างว่างหมด (กันเคส "" === "" ที่จะกลายเป็นผ่านโดยบังเอิญ)
  check("5.14 all empty -> DENY (no accidental equality)",
    authorizeGoogleReauth({ stateUserId: "", currentUserId: "", googleLinkedUserId: "" }).ok === false);
  check("5.15 all null -> DENY",
    authorizeGoogleReauth({ stateUserId: null, currentUserId: null, googleLinkedUserId: null }).ok === false);

  // ALLOW ต้องเกิดได้ก็ต่อเมื่อ "ครบทั้งสามตรงกัน" เท่านั้น — ตรวจแบบละเอียดทุกชุดค่า
  const ids = [A, B, null] as const;
  let allowCount = 0;
  let wrongAllow = 0;
  for (const s of ids) {
    for (const c of ids) {
      for (const g of ids) {
        const ok = authorizeGoogleReauth({ stateUserId: s, currentUserId: c, googleLinkedUserId: g }).ok;
        if (ok) {
          allowCount++;
          if (!(s !== null && s === c && c === g)) wrongAllow++;
        }
      }
    }
  }
  check("5.16 exhaustive 27 combos: exactly 2 ALLOW (A,A,A และ B,B,B)", allowCount === 2, `got ${allowCount}`);
  check("5.17 exhaustive: no ALLOW where the three differ", wrongAllow === 0, `got ${wrongAllow}`);

  // proof ต้องออกได้ก็ต่อเมื่อ decision ผ่าน — พิสูจน์เชิงพฤติกรรม
  const gatedProof = authorizeGoogleReauth({ stateUserId: A, currentUserId: A, googleLinkedUserId: B }).ok
    ? await issueReauthProof(A)
    : null;
  check("5.18 cross-account decision yields NO proof at all", gatedProof === null);

  const allowedProof = authorizeGoogleReauth({ stateUserId: A, currentUserId: A, googleLinkedUserId: A }).ok
    ? await issueReauthProof(A)
    : null;
  check("5.19 allowed decision yields a proof", allowedProof !== null);
  check("5.20 that proof validates for A", allowedProof !== null && (await verifyReauthProof(allowedProof.value, A)) === true);
  check("5.21 that proof does NOT validate for B", allowedProof !== null && (await verifyReauthProof(allowedProof.value, B)) === false);

  // returnTo ที่เคยทำให้เกิด 404 ต้องเป็น path ที่มีอยู่จริง
  check("5.22 REAUTH_DEFAULT_RETURN_TO is /profile (route ที่มีอยู่จริง)", REAUTH_DEFAULT_RETURN_TO === "/profile");
  check("5.23 default returnTo ผ่าน safeReturnTo", safeReturnTo(REAUTH_DEFAULT_RETURN_TO, "/home") === "/profile");

  head("SUMMARY");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("harness error:", e);
  process.exit(3);
});
