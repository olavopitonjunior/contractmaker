import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sendEmail } from "@/lib/email/client";
import { MagicLinkEmail } from "@/lib/email/templates/magic-link";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const MAGIC_LINK_EXPIRY_MINUTES = 15;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Mantém JWT para credentials. Resend provider exige database session
  // só pra finalizar a verificação (NextAuth cria a session no DB e depois
  // emite o JWT no cookie). Em v5 beta o provider Resend já lida com isso.
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    verifyRequest: "/login?check-email=1",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });

        if (!user || !user.passwordHash) return null;

        // LGPD: bloqueia login se conta está em janela de exclusão pendente.
        if (user.deletedAt) return null;

        const valid = await bcrypt.compare(
          parsed.data.password,
          user.passwordHash
        );
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    // Magic link passwordless. Convidado aprovado entra só via email.
    // Olavo/admin podem usar este OU credentials.
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM ?? "no-reply@contractmaker.local",
      maxAge: MAGIC_LINK_EXPIRY_MINUTES * 60,
      async sendVerificationRequest({ identifier, url }) {
        await sendEmail({
          to: identifier,
          subject: "Seu link de acesso ao Contractmaker",
          react: MagicLinkEmail({
            signInUrl: url,
            expiresInMinutes: MAGIC_LINK_EXPIRY_MINUTES,
          }) as React.ReactElement,
        });
      },
    }),
  ],
  callbacks: {
    /**
     * Bloqueia magic link para usuários sem OrgMembership ativa OU em
     * janela de exclusão LGPD. Credentials já fazem essa verificação no
     * authorize(); aqui é a defesa extra para magic link, que de outra
     * forma logaria qualquer email registrado no User table.
     */
    async signIn({ user, account }) {
      if (!user?.email) return false;

      const dbUser = await prisma.user.findUnique({
        where: { email: user.email },
        select: {
          id: true,
          deletedAt: true,
          orgMemberships: { select: { id: true }, take: 1 },
        },
      });

      // Magic link cria User automaticamente (PrismaAdapter); se acabou de
      // ser criado e não tem membership, bloqueia.
      if (!dbUser) return false;
      if (dbUser.deletedAt) return false;
      if (account?.provider === "resend" && dbUser.orgMemberships.length === 0) {
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // Marca o acesso no login: limpa o label "convite pendente" (derivado de
        // lastActiveAt === null) e registra o último acesso. Fire-and-forget —
        // nunca bloqueia/quebra o login. Cobre credentials e magic link.
        prisma.orgMembership
          .updateMany({
            where: { userId: user.id },
            data: { lastActiveAt: new Date() },
          })
          .catch(() => {});
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});

// Helper to get current user's org.
// Fase 1a: com subdomainHint (vindo do header x-org-subdomain via middleware),
// resolve a org pelo subdomínio E valida que o user é membro dela — se não for,
// retorna null (sem acesso àquele tenant). Sem hint (apex), mantém o
// comportamento legado: primeira membership.
export async function getUserOrg(
  userId: string,
  opts?: { subdomainHint?: string | null }
) {
  const subdomain = opts?.subdomainHint;
  if (subdomain) {
    const scoped = await prisma.orgMembership.findFirst({
      where: { userId, org: { subdomain } },
      include: { org: true },
    });
    return scoped?.org ?? null;
  }
  const membership = await prisma.orgMembership.findFirst({
    where: { userId },
    include: { org: true },
  });
  return membership?.org ?? null;
}

// Legacy helper preserved for backward compat
export async function verifyOrBootstrapUser(
  email: string,
  password: string
): Promise<{ id: string; email: string } | null> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const ok = await bcrypt.compare(password, existing.passwordHash!);
    if (!ok) return null;
    return { id: existing.id, email: existing.email };
  }

  if (process.env.ALLOW_SELF_REGISTER !== "true") {
    return null;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const created = await prisma.user.create({
    data: { email, passwordHash },
  });

  return { id: created.id, email: created.email };
}
