import { createFileRoute, Outlet } from "@tanstack/react-router";

// Auth gate disabled — dashboard is open to anyone.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: () => <Outlet />,
});
