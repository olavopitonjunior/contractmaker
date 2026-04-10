import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { FormPageClient } from "./form-client";

export default async function PublicFormPage({
  params,
}: {
  params: { token: string };
}) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
  });

  if (!form) {
    notFound();
  }

  return (
    <FormPageClient
      token={form.token}
      initialData={(form.dataJson as Record<string, unknown>) || {}}
    />
  );
}
