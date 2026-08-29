import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resolveUserByPhone, chaveDePolitica } from "@/lib/max/user-identity";

/**
 * Fecha a lacuna do `custom:<id>` contra um Postgres REAL (staging).
 *
 * ── Por que este teste precisa existir ─────────────────────────────────────
 *
 * O caminho `custom:<CustomRole.id>` estava provado só por unitário com Prisma
 * MOCKADO. O elo que nenhum teste tocava é o mais banal e o mais fácil de
 * quebrar: **o `select` de `resolveUserByPhone` traz mesmo `customRoleId` do
 * banco?** Um `select` sem aquele campo devolveria `undefined`, a chave viraria
 * `null`, e o efeito seria *fail-closed silencioso* — ninguém recebe capability
 * nenhuma, sem erro, sem log, sem teste vermelho.
 *
 * Não deu para fechar isso por smoke manual: `User.phone` tem **um único**
 * caminho de escrita no produto (`PATCH /api/me/profile`, auto-serviço sobre o
 * PRÓPRIO usuário), então não existe forma de cadastrar telefone de terceiro
 * para exercitar a rota — nem por API de admin, nem por script.
 *
 * ── Autocontido de propósito ───────────────────────────────────────────────
 *
 * Cria a própria org, usuário, `CustomRole` e membership, e apaga tudo no
 * `afterAll`. NÃO depende das orgs sintéticas do `seed-synthetic-orgs.ts` (que
 * não estão semeadas nesta base) nem toca em org existente — assim ele não
 * deixa resíduo numa org compartilhada se o cleanup falhar no meio.
 *
 * Rodar: `DATABASE_URL=<staging> npm run test:isolation`
 */

const SUFIXO = `iso_${Date.now().toString(36)}`;
const ORG_ID = `org_${SUFIXO}`;
const USER_CUSTOM = `u_custom_${SUFIXO}`;
const USER_PRESET = `u_preset_${SUFIXO}`;
const FONE_CUSTOM = "+5511900000101";
const FONE_PRESET = "+5511900000102";
const FONE_VIZINHA = "+5511900000103";
let customRoleId = "";

beforeAll(async () => {
  // Idempotente, e é o que impede a suíte de travar. Um run interrompido entre
  // este bloco e o `afterAll` deixa as duas linhas de `User` — e `User.phone` é
  // `@unique` GLOBAL, então o run seguinte morreria num P2002 opaco e ninguém
  // rodaria isolation de novo até limpar à mão.
  //
  // Os telefones são FIXOS de propósito (ao contrário dos ids e e-mails, que
  // levam timestamp): é a assimetria que torna o resíduo limitado e
  // encontrável. Timestampá-los vazaria dois users novos a cada interrupção,
  // que ninguém jamais acharia.
  //
  // Os dois predicados são seguros: os telefones são reservados a este teste e
  // `.invalid` é TLD reservado (RFC 2606), então `@qa.invalid` nunca é gente.
  //
  // ⚠️ Pressupõe que a suíte de isolamento NÃO roda concorrente contra o mesmo
  // banco. O `fileParallelism: false` do config resolve dentro de um run; duas
  // invocações simultâneas de `npm run test:isolation` se atropelariam nos
  // telefones fixos.
  await prisma.user.deleteMany({
    where: { phone: { in: [FONE_CUSTOM, FONE_PRESET, FONE_VIZINHA] } },
  });
  await prisma.organization.deleteMany({
    where: { name: { startsWith: "QA isolation " } },
  });

  await prisma.organization.create({
    data: { id: ORG_ID, name: `QA isolation ${SUFIXO}`, slug: ORG_ID },
  });
  const papel = await prisma.customRole.create({
    data: {
      orgId: ORG_ID,
      name: "QA Estagiário",
      description: "fixture de teste de isolamento",
      permissions: {},
      createdBy: USER_CUSTOM,
    },
  });
  customRoleId = papel.id;

  await prisma.user.createMany({
    data: [
      { id: USER_CUSTOM, email: `${USER_CUSTOM}@qa.invalid`, name: "QA Custom", phone: FONE_CUSTOM },
      { id: USER_PRESET, email: `${USER_PRESET}@qa.invalid`, name: "QA Preset", phone: FONE_PRESET },
    ],
  });
  await prisma.orgMembership.createMany({
    data: [
      { userId: USER_CUSTOM, orgId: ORG_ID, role: "custom", customRoleId },
      { userId: USER_PRESET, orgId: ORG_ID, role: "sales" },
    ],
  });
});

afterAll(async () => {
  // Org cascateia membership e customRole; o User é global e sai explícito.
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_CUSTOM, USER_PRESET] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${SUFIXO}@qa.invalid` } } });
  await prisma.$disconnect();
});

describe("user-identity contra banco real", () => {
  it("o select TRAZ customRoleId do banco — o elo que o mock não provava", async () => {
    const u = await resolveUserByPhone({ orgId: ORG_ID, phoneE164: FONE_CUSTOM });
    expect(u).not.toBeNull();
    expect(u!.role).toBe("custom");
    // É ISTO. Um `select` sem o campo devolveria undefined aqui, e a chave
    // cairia em null — fail-closed silencioso.
    expect(u!.customRoleId).toBe(customRoleId);
  });

  it("a chave do papel customizado é custom:<id>, não o literal custom", async () => {
    const u = await resolveUserByPhone({ orgId: ORG_ID, phoneE164: FONE_CUSTOM });
    expect(chaveDePolitica(u!)).toBe(`custom:${customRoleId}`);
    expect(chaveDePolitica(u!)).not.toBe("custom");
  });

  it("papel de preset devolve a própria string", async () => {
    const u = await resolveUserByPhone({ orgId: ORG_ID, phoneE164: FONE_PRESET });
    expect(chaveDePolitica(u!)).toBe("sales");
  });

  it("telefone de usuário de OUTRA org não resolve — confinamento real", async () => {
    // Org que EXISTE e tem membership própria — não um id inventado. Com id
    // inexistente o teste passaria por "org não existe", que é outra coisa: o
    // que precisa ser provado é que uma org LEGÍTIMA não enxerga o usuário da
    // vizinha. Isto já foi vazamento de verdade — o cabeçalho de
    // `user-identity.ts` registra o caso.
    const vizinha = await prisma.organization.create({
      data: { id: `${ORG_ID}_vz`, name: `QA isolation ${SUFIXO} vizinha`, slug: `${ORG_ID}_vz` },
    });
    const forasteiro = await prisma.user.create({
      data: { email: `u_vz_${SUFIXO}@qa.invalid`, name: "QA Vizinho" },
    });
    await prisma.orgMembership.create({
      data: { userId: forasteiro.id, orgId: vizinha.id, role: "sales" },
    });
    try {
      // O telefone é do usuário da PRIMEIRA org; perguntado pela segunda.
      expect(
        await resolveUserByPhone({ orgId: vizinha.id, phoneE164: FONE_CUSTOM })
      ).toBeNull();
      // E a vizinha resolve o SEU — para o null acima não passar por vacuidade.
      const proprio = await prisma.user.update({
        where: { id: forasteiro.id },
        data: { phone: FONE_VIZINHA },
      });
      const r = await resolveUserByPhone({ orgId: vizinha.id, phoneE164: FONE_VIZINHA });
      expect(r?.userId).toBe(proprio.id);
    } finally {
      await prisma.organization.deleteMany({ where: { id: vizinha.id } });
      await prisma.user.deleteMany({ where: { id: forasteiro.id } });
    }
  });

  it("dois papéis customizados da mesma org produzem chaves diferentes", async () => {
    const outro = await prisma.customRole.create({
      data: { orgId: ORG_ID, name: "QA Diretor", permissions: {}, createdBy: USER_CUSTOM },
    });
    try {
      const a = chaveDePolitica({ role: "custom", customRoleId });
      const b = chaveDePolitica({ role: "custom", customRoleId: outro.id });
      expect(a).not.toBe(b);
    } finally {
      await prisma.customRole.delete({ where: { id: outro.id } });
    }
  });
});
