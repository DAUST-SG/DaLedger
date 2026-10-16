import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/** id → name maps for accounts, categories and events (closed events included). */
export function useNames() {
  const names = useQuery(api.catalog.names);
  return {
    loaded: names !== undefined,
    account: new Map(names?.accounts.map((a) => [a._id as string, a.name])),
    accountKey: new Map(names?.accounts.map((a) => [a._id as string, a.key])),
    category: new Map(names?.categories.map((c) => [c._id as string, c.name])),
    event: new Map(names?.events.map((e) => [e._id as string, e.name])),
  };
}
