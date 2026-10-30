import { Component, type ReactNode } from "react";

/** One error screen for anything a page can't recover from (a failed query, a bug). */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="min-h-full flex flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-muted max-w-sm">Reload the page. Your saved entries are safe; nothing was lost.</p>
        <button type="button" onClick={() => window.location.reload()} className="h-11 px-5 rounded-lg bg-brand text-white font-medium">
          Reload
        </button>
      </main>
    );
  }
}
