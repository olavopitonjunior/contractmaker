// scripts/backfill-split-recipient-contacts.ts
// Normaliza contatos dos SplitRecipients EXISTENTES para o formato canônico de
// escrita adotado em 2026-08 (lib/validators/corretor):
//   - phone → E.164 (+55DDNNNNNNNNN) via normalizeBrPhone — o MESMO normalizador
//     que o Max (broker-scope), notify-trigger e deal-events usam na leitura.
//   - email → trim + lowercase.
// NÃO valida CPF/CNPJ de registros antigos (só escrita nova valida DV).
//
// Telefone não-parseável ou colisão (dois registros da org convergindo pro
// mesmo telefone normalizado com maxEnabled/active — território do índice
// parcial do Max) → REPORTA e não sobrescreve.
//
// ⚠️ Prod: rodar só depois da F4 promovida E com o webhook de entrega do Max
// estabilizado — ambos operam sobre a mesma superfície de dados.
//
// Uso:
//   pnpm tsx apps/web/scripts/backfill-split-recipient-contacts.ts            # dry-run
//   pnpm tsx apps/web/scripts/backfill-split-recipient-contacts.ts --apply
//   pnpm tsx apps/web/scripts/backfill-split-recipient-contacts.ts --apply --orgId=<id>

import { prisma } from "@/lib/db/prisma";
import { normalizeBrPhone } from "@/lib/validators/phone-br";

const APPLY = process.argv.includes("--apply");
const ORG_ARG = process.argv.find((a) => a.startsWith("--orgId="));
const TARGET_ORG = ORG_ARG ? ORG_ARG.split("=")[1] : null;
if (ORG_ARG && !TARGET_ORG) {
  // `--orgId=$VAR` com a var vazia cairia no ramo "todas as orgs" em silêncio.
  console.error("--orgId presente mas vazio — abortando (omita a flag para rodar em todas as orgs).");
  process.exit(1);
}

async function main() {
  console.log(
    APPLY
      ? "[backfill-split-recipient-contacts] APPLY mode"
      : "[backfill-split-recipient-contacts] DRY-RUN"
  );

  const rows = await prisma.splitRecipient.findMany({
    where: TARGET_ORG ? { orgId: TARGET_ORG } : {},
    select: {
      id: true,
      orgId: true,
      label: true,
      phone: true,
      email: true,
      active: true,
      maxEnabled: true,
    },
    orderBy: [{ orgId: "asc" }, { createdAt: "asc" }],
  });

  // Pré-mapeia telefones normalizados por org pra detectar colisões dentro do
  // universo do índice parcial do Max (maxEnabled AND active).
  const maxPhoneSeen = new Map<string, string>(); // `${orgId}|${e164}` → id
  for (const r of rows) {
    if (r.maxEnabled && r.active && r.phone) {
      const e164 = normalizeBrPhone(r.phone);
      if (e164) {
        const key = `${r.orgId}|${e164}`;
        if (!maxPhoneSeen.has(key)) maxPhoneSeen.set(key, r.id);
      }
    }
  }

  let phoneChanged = 0;
  let emailChanged = 0;
  let unparseable = 0;
  let collisions = 0;
  let untouched = 0;

  for (const r of rows) {
    const patch: { phone?: string; email?: string } = {};

    if (r.phone) {
      const e164 = normalizeBrPhone(r.phone);
      if (!e164) {
        console.log(`[unparseable] org=${r.orgId} id=${r.id} "${r.label}" phone=${JSON.stringify(r.phone)}`);
        unparseable++;
      } else if (e164 !== r.phone) {
        const key = `${r.orgId}|${e164}`;
        const owner = maxPhoneSeen.get(key);
        if (r.maxEnabled && r.active && owner && owner !== r.id) {
          console.log(
            `[collision] org=${r.orgId} id=${r.id} "${r.label}" → ${e164} já pertence a id=${owner} no universo do Max — NÃO sobrescrito`
          );
          collisions++;
        } else {
          patch.phone = e164;
        }
      }
    }

    if (r.email) {
      const norm = r.email.trim().toLowerCase();
      if (norm && norm !== r.email) patch.email = norm;
    }

    if (Object.keys(patch).length === 0) {
      untouched++;
      continue;
    }
    if (patch.phone) phoneChanged++;
    if (patch.email) emailChanged++;

    const detail = [
      patch.phone ? `phone ${JSON.stringify(r.phone)} → ${patch.phone}` : null,
      patch.email ? `email ${JSON.stringify(r.email)} → ${patch.email}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    if (APPLY) {
      await prisma.splitRecipient.update({ where: { id: r.id }, data: patch });
      console.log(`[updated] org=${r.orgId} id=${r.id} "${r.label}" — ${detail}`);
    } else {
      console.log(`[would update] org=${r.orgId} id=${r.id} "${r.label}" — ${detail}`);
    }
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY-RUN"}: ${phoneChanged} phone(s), ${emailChanged} email(s); ` +
      `${unparseable} não-parseável(is), ${collisions} colisão(ões) (intocados), ${untouched} já canônicos.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
