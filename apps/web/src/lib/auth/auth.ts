import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma';

export async function verifyOrBootstrapUser(email: string, password: string): Promise<{ id: string; email: string } | null> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const ok = await bcrypt.compare(password, existing.passwordHash);
    if (!ok) return null;
    return { id: existing.id, email: existing.email };
  }

  if (process.env.ALLOW_SELF_REGISTER !== 'true') {
    return null;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const created = await prisma.user.create({
    data: {
      email,
      passwordHash
    }
  });

  return { id: created.id, email: created.email };
}
