import { useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { errorMessage } from "../lib/errors";

export default function Login() {
  const { signIn } = useAuthActions();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    try {
      await signIn("password", {
        email: String(form.get("email")),
        password: String(form.get("password")),
        flow: "signIn",
      });
    } catch (err) {
      setError(errorMessage(err, "Email or password is incorrect."));
      setPending(false);
    }
  }

  return (
    <main className="min-h-full flex flex-col">
      <header className="bg-brand text-white px-5 pt-10 pb-8">
        <p className="text-xs uppercase tracking-widest text-white/70">DAUST Student Government</p>
        <h1 className="mt-1 text-3xl font-bold">DaLedger</h1>
        <p className="mt-2 text-white/80">The SG's ledger. Finance officers only.</p>
      </header>
      <form onSubmit={onSubmit} className="px-5 py-6 flex flex-col gap-4 max-w-md w-full">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <input
            id="email" name="email" type="email" autoComplete="email" required
            className="h-12 rounded-lg border border-line bg-white px-3 text-base"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          <input
            id="password" name="password" type="password" autoComplete="current-password" required
            className="h-12 rounded-lg border border-line bg-white px-3 text-base"
          />
        </label>
        {error && <p role="alert" className="text-sm text-loss">{error}</p>}
        <button
          type="submit" disabled={pending}
          className="h-12 rounded-lg bg-brand text-white font-semibold disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-sm text-muted">No account? Ask the Treasurer to add you.</p>
      </form>
    </main>
  );
}
