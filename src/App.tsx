import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./routes/Login";
import Home from "./routes/Home";
import AddTransaction from "./routes/AddTransaction";

export default function App() {
  return (
    <>
      <AuthLoading>
        <p className="p-6 text-muted">Loading…</p>
      </AuthLoading>
      <Unauthenticated>
        <Login />
      </Unauthenticated>
      <Authenticated>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/add" element={<AddTransaction />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Authenticated>
    </>
  );
}
