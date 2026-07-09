/** curl-equivalent D3/D4 Set-Cookie checks */
const stamp = Date.now();
const pw = `Curl${stamp}!`;

async function check(origin, label) {
  const email = `curl-${label}-${stamp}@rizance.test`;
  const reg = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw, shopName: "Curl Shop" }),
  });
  console.log(`\n=== ${label} register HTTP ${reg.status} ===`);
  for (const c of reg.headers.getSetCookie?.() ?? []) console.log("Set-Cookie:", c);

  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  console.log(`=== ${label} login HTTP ${login.status} ===`);
  const cookies = login.headers.getSetCookie?.() ?? [];
  for (const c of cookies) console.log("Set-Cookie:", c);
  const hasDomain = cookies.some((c) => /;\s*Domain=/i.test(c));
  const domainVal = cookies.map((c) => /;\s*Domain=([^;]+)/i.exec(c)?.[1]).find(Boolean);
  if (label === "rizance.app") {
    if (domainVal === ".rizance.app") console.log("PASS D3: Domain=.rizance.app");
    else console.log("FAIL D3: Domain=", domainVal ?? "missing");
  } else {
    if (!hasDomain) console.log("PASS D4: no Domain attribute (host-only)");
    else console.log("FAIL D4: unexpected Domain=", domainVal);
  }
}

await check("https://rizance.app", "rizance.app");
await check("https://www.rizance.com", "www.rizance.com");
