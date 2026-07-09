/** Verify NEXT_PUBLIC_POS_APP_URL at runtime via rendered /home HTML (server component). */
const ORIGIN = "https://www.rizance.com";
const EXPECT = "pos.rizance.com";

const stamp = Date.now();
const email = `pos-url-verify-${stamp}@rizance.test`;
const password = `Verify${stamp}!`;

await fetch(`${ORIGIN}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, shopName: "Verify", mode: "personal" }),
});

const login = await fetch(`${ORIGIN}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});

const setCookies = login.headers.getSetCookie?.() ?? [];
const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");

const homeRes = await fetch(`${ORIGIN}/home`, {
  headers: { Cookie: cookie, Accept: "text/html" },
  redirect: "manual",
});

console.log("GET /home status:", homeRes.status);
const html = await homeRes.text();

if (html.includes(EXPECT)) {
  const snippet = html.match(/.{0,60}pos\.rizance\.com.{0,60}/)?.[0];
  console.log("PASS: pos.rizance.com found in /home HTML");
  if (snippet) console.log("snippet:", snippet.replace(/\s+/g, " ").trim());
  process.exit(0);
}

if (html.includes("localhost:3001")) {
  const snippet = html.match(/.{0,60}localhost:3001.{0,60}/)?.[0];
  console.log("FAIL: fallback localhost:3001 in /home HTML");
  if (snippet) console.log("snippet:", snippet.replace(/\s+/g, " ").trim());
  process.exit(1);
}

// Also scan linked JS chunks (client-side references)
const chunks = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\s]+\.js/g)].map((m) => m[0]))];
for (const chunk of chunks) {
  const js = await fetch(ORIGIN + chunk).then((r) => r.text());
  if (js.includes(EXPECT)) {
    console.log("PASS: pos.rizance.com in chunk", chunk);
    process.exit(0);
  }
}

console.log("FAIL: pos.rizance.com not in /home HTML or chunks");
console.log("HTML length:", html.length, "chunks:", chunks.length);
if (html.includes("เปิดหน้าร้าน")) console.log("(POS card text present but URL missing)");
process.exit(1);
