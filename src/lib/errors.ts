import { ConvexError } from "convex/values";

/** The readable message from a ConvexError, or a generic fallback. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Try again."): string {
  if (err instanceof ConvexError && typeof err.data === "string") return err.data;
  return fallback;
}
