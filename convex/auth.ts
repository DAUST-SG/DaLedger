import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import type { QueryCtx } from "./_generated/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import { ConvexError } from "convex/values";

// Closed officer set (SECURITY.md, ADR 0023): nobody signs themselves up.
// Officers are created with `npx convex run seed:addOfficer`.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      profile(params) {
        if (params.flow === "signUp") throw new ConvexError("Sign-up is closed. Ask the Treasurer for an account.");
        return { email: String(params.email).trim().toLowerCase() };
      },
    }),
  ],
  // SECURITY.md §2: signed out after 7 idle days, and after 30 days at most.
  session: { inactiveDurationMs: 7 * 24 * 60 * 60 * 1000, totalDurationMs: 30 * 24 * 60 * 60 * 1000 },
  callbacks: {
    // A deactivated officer cannot sign in (ADR 0023).
    async beforeSessionCreation(ctx, { userId }) {
      const user = await ctx.db.get(userId);
      if (user?.active !== true) throw new ConvexError("This account is not active.");
    },
  },
});

/** The signed-in, active officer, or throw. Every officer function starts here. */
export async function currentOfficer(ctx: QueryCtx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  const user = await ctx.db.get(userId);
  if (user?.active !== true) throw new ConvexError("This account is not active.");
  return user;
}
