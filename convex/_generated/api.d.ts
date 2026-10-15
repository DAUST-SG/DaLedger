/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as balances from "../balances.js";
import type * as catalog from "../catalog.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as intake from "../intake.js";
import type * as intakeKeys from "../intakeKeys.js";
import type * as ledger from "../ledger.js";
import type * as reports from "../reports.js";
import type * as review from "../review.js";
import type * as seed from "../seed.js";
import type * as transactions from "../transactions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audit: typeof audit;
  auth: typeof auth;
  balances: typeof balances;
  catalog: typeof catalog;
  events: typeof events;
  http: typeof http;
  intake: typeof intake;
  intakeKeys: typeof intakeKeys;
  ledger: typeof ledger;
  reports: typeof reports;
  review: typeof review;
  seed: typeof seed;
  transactions: typeof transactions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
