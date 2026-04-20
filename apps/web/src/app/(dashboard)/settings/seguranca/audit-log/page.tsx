import { AuditLogTable } from "@/components/security/AuditLogTable";

export const metadata = {
  title: "Registro de atividade — Contractmaker",
};

export default function AuditLogPage() {
  return <AuditLogTable />;
}
