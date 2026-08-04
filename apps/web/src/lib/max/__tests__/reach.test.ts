import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getMaxReach } from "../reach";

/**
 * Aqui o comportamento É o filtro da query — quem entra na conta e quem não
 * entra. Um teste que só afirmasse o número devolvido passaria com qualquer
 * `where`, inclusive o errado que este arquivo existe para impedir. Então o
 * que se afirma é o critério enviado ao banco.
 *
 * Os dois erros que motivaram isto estavam em produção:
 *  - opt-in sem telefone contava, e `user-recipients.ts` recusa quem não tem
 *    telefone — a etapa do onboarding fechava afirmando alcance inexistente;
 *  - a membership do próprio Max (`isSystem`) entrava no total de pessoas, e
 *    num tenant de um sócio só o card dizia que faltava cadastrar o telefone
 *    de alguém que era o bot.
 */

const memberCount = prisma.orgMembership.count as unknown as ReturnType<typeof vi.fn>;
const prefCount = prisma.userNotificationPreference
  .count as unknown as ReturnType<typeof vi.fn>;

/** Argumentos da n-ésima chamada de `orgMembership.count`. */
const memberWhere = (n: number) => memberCount.mock.calls[n][0].where;

describe("getMaxReach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberCount.mockResolvedValue(0);
    prefCount.mockResolvedValue(0);
  });

  it("não conta o usuário de serviço do Max como pessoa", async () => {
    await getMaxReach("org-1");

    // As duas contagens de membership — total e com telefone.
    expect(memberWhere(0)).toMatchObject({ orgId: "org-1", isSystem: false });
    expect(memberWhere(1)).toMatchObject({ orgId: "org-1", isSystem: false });
  });

  it("só conta como 'com telefone' quem tem telefone e não foi excluído", async () => {
    await getMaxReach("org-1");

    expect(memberWhere(1).user).toMatchObject({
      deletedAt: null,
      phone: { not: null },
    });
  });

  /**
   * O achado principal. Opt-in é condição NECESSÁRIA e não suficiente: sem
   * telefone a pessoa é descartada em `user-recipients.ts`, então contá-la faz
   * a etapa fechar dizendo que alguém recebe quando ninguém recebe.
   */
  it("quem optou mas não tem telefone NÃO conta como alcançado", async () => {
    await getMaxReach("org-1");

    const where = prefCount.mock.calls[0][0].where;
    expect(where).toMatchObject({
      orgId: "org-1",
      whatsappOptInAt: { not: null },
    });
    expect(where.user).toMatchObject({ phone: { not: null }, deletedAt: null });
  });

  /**
   * `UserNotificationPreference` só cascateia em delete de User/Org — sair da
   * imobiliária não apaga a linha. Sem cruzar com membership viva, um ex-membro
   * seguiria contando como destinatário para sempre.
   */
  it("ex-membro não conta: o opt-in é cruzado com membership viva", async () => {
    await getMaxReach("org-1");

    expect(prefCount.mock.calls[0][0].where.user.orgMemberships).toEqual({
      some: { orgId: "org-1", isSystem: false },
    });
  });

  it("devolve as três contagens", async () => {
    memberCount.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    prefCount.mockResolvedValue(1);

    expect(await getMaxReach("org-1")).toEqual({
      membersTotal: 5,
      membersWithPhone: 2,
      optedIn: 1,
    });
  });
});
