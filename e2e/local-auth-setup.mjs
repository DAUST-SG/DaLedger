// Local-only helper: set Convex Auth env vars on the LOCAL deployment, replacing
// `npx @convex-dev/auth` which crashes on Windows + Node 24 (libuv assertion on a
// failing `env get`). Generates the keypair exactly like @convex-dev/auth and
// sets SITE_URL / JWT_PRIVATE_KEY / JWKS via the Convex CLI (argv, no shell quoting).
//   Run from the repo root:  node e2e/local-auth-setup.mjs
import { generateKeyPair, exportPKCS8, exportJWK } from "jose";
import { execFileSync } from "node:child_process";

const keys = await generateKeyPair("RS256", { extractable: true });
const JWT_PRIVATE_KEY = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " ");
const jwk = await exportJWK(keys.publicKey);
const JWKS = JSON.stringify({ keys: [{ use: "sig", ...jwk }] });

const CONVEX = "node_modules/convex/bin/main.js";
function set(name, value) {
  try {
    // `--` stops commander option parsing — the PEM value begins with "-----".
    execFileSync(process.execPath, [CONVEX, "env", "set", "--", name, value], { stdio: ["ignore", "inherit", "inherit"] });
  } catch (e) {
    // The CLI exits non-zero via a cosmetic Windows/Node24 libuv assertion AFTER
    // the var is set over the network. Show stderr so a REAL failure is visible.
    const err = String(e?.stderr ?? e?.message ?? e);
    if (!/UV_HANDLE_CLOSING|Assertion failed/.test(err)) console.error(`  ${name} error:`, err.slice(0, 300));
  }
  console.log(`set ${name} (len ${value.length})`);
}

set("SITE_URL", process.env.E2E_SITE_URL ?? "http://localhost:3000");
set("JWT_PRIVATE_KEY", JWT_PRIVATE_KEY);
set("JWKS", JWKS);
console.log("auth env configured");
