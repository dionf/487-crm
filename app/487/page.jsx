"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { useOrg } from "@/lib/org-context";

function RedirectToDashboard() {
  const { isLoggedIn } = useOrg();
  const router = useRouter();

  useEffect(() => {
    if (isLoggedIn) {
      router.replace("/");
    }
  }, [isLoggedIn, router]);

  return null;
}

export default function Page487LoginPage() {
  return (
    <AppShell tenantSlug="48-7">
      <RedirectToDashboard />
    </AppShell>
  );
}
