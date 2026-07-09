/** Scan production rizance-profit static assets for POS app URL. */
const ORIGIN = "https://www.rizance.com";
const PATHS = ["/", "/login", "/home", "/pricing"];

const allChunks = new Set();

for (const path of PATHS) {
  const html = await fetch(ORIGIN + path, { redirect: "follow" }).then((r) => r.text());
  for (const m of html.matchAll(/\/_next\/static\/[^"'\s]+\.js/g)) allChunks.add(m[0]);
}

console.log("scanning", allChunks.size, "chunks...");

let posHits = [];
let localHits = [];

for (const chunk of allChunks) {
  const js = await fetch(ORIGIN + chunk).then((r) => r.text());
  if (js.includes("pos.rizance.com")) posHits.push({ chunk, snippet: js.match(/.{0,45}pos\.rizance\.com.{0,45}/)?.[0] });
  if (js.includes("localhost:3001")) localHits.push({ chunk, snippet: js.match(/.{0,45}localhost:3001.{0,45}/)?.[0] });
}

console.log("pos.rizance.com hits:", posHits.length);
for (const h of posHits) console.log(" ", h.chunk, "\n   ", h.snippet?.replace(/\s+/g, " "));

console.log("localhost:3001 hits:", localHits.length);
for (const h of localHits) console.log(" ", h.chunk, "\n   ", h.snippet?.replace(/\s+/g, " "));

process.exit(posHits.length && !localHits.length ? 0 : 1);
