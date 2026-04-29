import { Suspense } from "react";
import { MembersPageClient } from "@/components/security/MembersPageClient";

export const metadata = {
  title: "Membros — Contractmaker",
};

export default function MembersPage() {
  return (
    <Suspense fallback={null}>
      <MembersPageClient />
    </Suspense>
  );
}
