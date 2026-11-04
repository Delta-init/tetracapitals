import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/*
 * My Wallet (2026-11-04): your month from the HRMS — salary a day at a time, what came off and why, commission, what
 * finance has paid (backend functions/myWallet.ts). The server asks the HRMS as whoever is signed in; never somebody
 * else's, and nothing while viewing as someone.
 */
export const useWallet = (month, { enabled = true } = {}) =>
  useQuery({
    queryKey: ["wallet", month],
    queryFn: async () => (await base44.functions.invoke("getMyWallet", { month })).data,
    // Finance is asked behind it on every load; a minute keeps flicking between months cheap.
    staleTime: 60_000,
    retry: false,
    enabled,
  });

/** This month where the company keeps its books. */
export const walletThisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date()).slice(0, 7);
