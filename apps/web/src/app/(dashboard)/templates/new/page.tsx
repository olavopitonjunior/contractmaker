import { auth } from "@/lib/auth/auth";
import { TemplateEditor } from "@/components/templates/TemplateEditor";

export default async function NewTemplatePage() {
  const session = await auth();
  if (!session?.user) return null;

  return <TemplateEditor mode="create" />;
}
