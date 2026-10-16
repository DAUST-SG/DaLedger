import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Naboopay safety net + payout capture (ADR 0008, 0026). Read-only; well under
// Naboopay's 100 requests / 60 s.
crons.interval("naboopay sweep", { minutes: 15 }, internal.sweep.run, {});

// Recurring expense drafts (ADR 0012): once a day, early morning in Dakar (UTC+0).
crons.daily("recurring drafts", { hourUTC: 5, minuteUTC: 0 }, internal.recurring.generate, {});

export default crons;
