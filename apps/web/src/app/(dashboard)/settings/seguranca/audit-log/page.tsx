import { AuditLogTable } from "@/components/security/AuditLogTable";

export const metadata = {
  title: "Registro de atividade",
};

export default function AuditLogPage() {
  return <AuditLogTable />;
}
