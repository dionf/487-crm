"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { useOrg } from "@/lib/org-context";

function HipHotRedirect() {
  const { isLoggedIn } = useOrg();
  const router = useRouter();

  useEffect(() => {
    if (isLoggedIn) {
      router.replace("/");
    }
  }, [isLoggedIn, router]);

  // While not logged in, PinGate (via AppShell) handles the login UI
  // Once logged in, redirect to dashboard
  return null;
}

export default function HipHotLoginPage() {
  return (
    <AppShell tenantSlug="hiphot">
      <HipHotRedirect />
    </AppShell>
  );
}
