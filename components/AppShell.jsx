"use client";

import { OrgProvider } from "@/lib/org-context";
import PinGate from "./PinGate";
import Navbar from "./Navbar";

export default function AppShell({ children, tenantSlug }) {
  return (
    <OrgProvider>
      <PinGate tenantSlug={tenantSlug}>
        <div className="min-h-screen bg-white">
          <Navbar />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </main>
        </div>
      </PinGate>
    </OrgProvider>
  );
}
