/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { retrieveAccount } from "@convex-dev/auth/server";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

// The password provider's own check: does this email + password match the stored hash?
const signsIn = (t: ReturnType<typeof convexTest>, password: string) =>
  t.action(async (ctx) => {
    try {
      await retrieveAccount(ctx, { provider: "password", account: { id: "awa@daust.sg", secret: password } });
      return true;
    } catch {
      return false;
    }
  });

describe("seed:resetPassword", () => {
  test("the new password works, the old one no longer does, and sessions are ended", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.action(internal.seed.addOfficer, { email: "Awa@daust.sg", name: "Awa", password: "old-password" });
    await t.run((ctx) => ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 60_000 }));
    expect(await signsIn(t, "old-password")).toBe(true);

    await t.action(internal.seed.resetPassword, { email: " AWA@daust.sg ", password: "new-password" });

    expect(await signsIn(t, "new-password")).toBe(true);
    expect(await signsIn(t, "old-password")).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toHaveLength(0);
  });

  test("an unknown email or a short password is refused", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.seed.addOfficer, { email: "awa@daust.sg", name: "Awa", password: "old-password" });
    await expect(t.action(internal.seed.resetPassword, { email: "nobody@daust.sg", password: "new-password" })).rejects.toThrow(/No officer/);
    await expect(t.action(internal.seed.resetPassword, { email: "awa@daust.sg", password: "short" })).rejects.toThrow(/at least 8/);
  });
});
