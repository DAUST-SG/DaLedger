import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./routes/Login";
import Home from "./routes/Home";
import AddTransaction from "./routes/AddTransaction";
import Review from "./routes/Review";
import Transactions from "./routes/Transactions";
import Events from "./routes/Events";
import EventView from "./routes/EventView";
import Reconcile from "./routes/Reconcile";
import Report from "./routes/Report";
import ErrorBoundary from "./components/ErrorBoundary";
import ConnectionBanner from "./components/ConnectionBanner";
import Loading from "./components/Loading";

export default function App() {
  return (
    <>
      <AuthLoading>
        <div className="p-6"><Loading label="Signing you in…" rows={2} /></div>
      </AuthLoading>
      <Unauthenticated>
        <Login />
      </Unauthenticated>
      <Authenticated>
        <ConnectionBanner />
        <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/add" element={<AddTransaction />} />
          <Route path="/review" element={<Review />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/:id" element={<EventView />} />
          <Route path="/reconcile" element={<Reconcile />} />
          <Route path="/report" element={<Report />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </Authenticated>
    </>
  );
}
