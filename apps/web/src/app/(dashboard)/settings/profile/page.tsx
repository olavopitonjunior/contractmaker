import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ProfileClient } from "@/components/settings/ProfileClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Meu perfil",
};

export default async function SettingsProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [user, twoFA] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        phone: true,
        cpf: true,
        birthDate: true,
        incomeValueCents: true,
        postalCode: true,
        addressStreet: true,
        addressNumber: true,
        addressComplement: true,
        addressNeighborhood: true,
        addressCity: true,
        addressState: true,
        passwordHash: true,
      },
    }),
    prisma.twoFactorSecret.findUnique({
      where: { userId: session.user.id },
      select: { enabled: true },
    }),
  ]);

  if (!user) redirect("/login");

  // `passwordHash` nunca cruza a fronteira server→client: só o booleano.
  const { passwordHash, ...profile } = user;

  return (
    <ProfileClient
      initial={{
        ...profile,
        birthDate: user.birthDate
          ? user.birthDate.toISOString().slice(0, 10)
          : null,
        hasPassword: passwordHash != null,
      }}
      twoFAStatus={{ enabled: twoFA?.enabled ?? false }}
    />
  );
}
