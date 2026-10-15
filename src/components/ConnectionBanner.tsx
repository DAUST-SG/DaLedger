import { useEffect, useState } from "react";
import { useConvexConnectionState } from "convex/react";

/**
 * Convex queues changes across short connection drops and sends them on reconnect.
 * This banner just tells the officer it is happening. (A full offline outbox that
 * survives closing the app is out of v1, per the feasibility report.)
 */
export default function ConnectionBanner() {
  const state = useConvexConnectionState();
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  const offline = !online || (state.hasEverConnected && !state.isWebSocketConnected);
  if (!offline) return null;
  return (
    <p role="status" className="sticky top-[env(safe-area-inset-top,0px)] z-20 bg-warn text-white text-sm text-center px-4 py-2 print:hidden">
      Offline. {state.hasInflightRequests ? "Your changes will be sent when you reconnect." : "Balances will update when you reconnect."}
    </p>
  );
}
