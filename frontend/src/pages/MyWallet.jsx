import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Loader2, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WalletView } from "@/components/wallet/WalletView";
import { useWallet, walletThisMonth } from "@/hooks/useWallet";

/**
 * My Wallet (2026-11-04) — the same wallet as in the HRMS: salary a day at a time, what came off and why, your
 * commission, and what finance has paid you. Your own only; a month at a time, back as far as you've been employed.
 */

const shift = (month, by) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const monthLabel = (month) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default function MyWallet() {
  const [month, setMonth] = useState(walletThisMonth);
  const { data: w, isLoading, isFetching, error } = useWallet(month);
  const first = w?.firstMonth ?? shift(walletThisMonth(), -12);

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <WalletCards className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground">My Wallet</h1>
              <p className="text-sm text-muted-foreground">Your pay a day at a time — what came off and why, your commission, and what finance has paid you</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-white">
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Previous month" disabled={month <= first} onClick={() => setMonth((m) => shift(m, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel(month)}</span>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Next month" disabled={month >= walletThisMonth()} onClick={() => setMonth((m) => shift(m, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </motion.div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error || !w ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">{error?.message || "Your wallet couldn't be loaded. Try again in a moment."}</Card>
        ) : (
          <WalletView w={w} />
        )}
      </div>
    </div>
  );
}
