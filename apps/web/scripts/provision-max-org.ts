/**
 * Provisiona o acesso do Max a um tenant: usuário de serviço, membership e
 * token de API.
 *
 * Existe porque o único produtor de token no repo é `POST /api/me/api-tokens`,
 * que é session-only e hardcoda `userId: session.user.id` — não há rota admin
 * nem Bearer que emita token para outro usuário, e impersonation não serve de
 * atalho (`/api/me` está no path-guard). Sem isto, ligar o Max num tenant exige
 * criar um usuário, logar como ele e gerar o token na UI.
 *
 * A lógica vive em `lib/max/provisioning.ts` de propósito: quando o hook
 * automático entrar no PATCH de módulos, script e rota compartilham o MESMO
 * caminho, em vez de existir um "jeito de teste" que diverge do de produção.
 *
 * Uso:
 *   npx tsx scripts/provision-max-org.ts --org-id cms7xmtks001gf13av1wf98tb
 *   npx tsx scripts/provision-max-org.ts --org-id <id> --apply
 *
 * Flags:
 *   --org-id   (obrigatório)
 *   --apply    (sem ele, só mostra o que faria)
 *   --revoke   (revoga os tokens do Max naquela org)
 *
 * Env: DATABASE_URL
 *
 * O token cru é impresso UMA vez. O banco guarda só o sha256 — perdeu, rode de
 * novo (o script rotaciona, não duplica).
 */

import {
  provisionMaxForOrg,
  deprovisionMaxForOrg,
  serviceUserEmail,
  MAX_SCOPES,
} from "../src/lib/max/provisioning";
import { prisma } from "../src/lib/db/prisma";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const orgId = arg("org-id");
  if (!orgId) {
    console.error("--org-id é obrigatório");
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, subdomain: true },
  });
  if (!org) {
    console.error(`org ${orgId} não encontrada`);
    process.exit(1);
  }

  console.log(`Org:      ${org.name} (${org.subdomain ?? "sem subdomínio"})`);
  console.log(`Serviço:  ${serviceUserEmail(orgId)}`);

  if (has("revoke")) {
    if (!has("apply")) {
      console.log("\n[dry-run] revogaria os tokens do Max nesta org.");
      return;
    }
    const { revoked } = await deprovisionMaxForOrg(orgId);
    console.log(`\n${revoked} token(s) revogado(s).`);
    return;
  }

  console.log(`Escopos:  ${MAX_SCOPES.join(", ")}`);

  if (!has("apply")) {
    console.log(
      "\n[dry-run] criaria/reusaria o usuário de serviço, garantiria UMA membership\n" +
        "          nesta org, emitiria um token novo e revogaria os anteriores.\n" +
        "          Rode de novo com --apply."
    );
    return;
  }

  const r = await provisionMaxForOrg({ orgId });

  if (r.status === "failed") {
    console.error(`\nFALHOU: ${r.reason}`);
    process.exit(1);
  }

  console.log(`\n${r.status === "rotated" ? "Token ROTACIONADO" : "Token criado"}.`);
  console.log(`\n  ${r.rawToken}\n`);
  console.log("Guarde agora — o banco só tem o sha256.");
  console.log(
    "Cadastre no `org_config` do Max (cifrado com MAX_ENCRYPTION_KEY):\n" +
      `  org_id   = ${r.orgId}\n` +
      `  org_name = ${r.orgName}`
  );
}

main()
  .catch((err) => {
    console.error("\nerro:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
