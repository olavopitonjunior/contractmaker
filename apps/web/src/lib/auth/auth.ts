import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
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
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
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

// Helper to get current user's org
export async function getUserOrg(userId: string) {
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
