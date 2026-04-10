import { auth, getUserOrg } from "@/lib/auth/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Configuracoes</h1>

      <Card>
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">
            <span className="text-muted-foreground">Nome:</span>{" "}
            {session.user.name || "—"}
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">Email:</span>{" "}
            {session.user.email}
          </p>
        </CardContent>
      </Card>

      {org && (
        <Card>
          <CardHeader>
            <CardTitle>Organizacao</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Nome:</span> {org.name}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Slug:</span> {org.slug}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
