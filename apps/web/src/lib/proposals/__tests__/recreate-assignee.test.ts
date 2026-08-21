import { describe, it, expect } from "vitest";
import { resolveRecreationAssignee } from "@/lib/proposals/recreate-assignee";

/**
 * Recriar proposta preserva "os mesmos dados" — e o responsável é um deles.
 * Era o caminho menos coberto da recriação: três casos de borda distintos
 * (sem permissão, ex-membro, responsável externo) decididos numa cadeia de
 * if/else dentro de um server component.
 */
describe("resolveRecreationAssignee", () => {
  const base = {
    canAssign: true,
    responsibleUserId: null,
    responsibleName: null,
    memberIds: ["u1", "u2"],
  };

  it("herda o responsável quando ele ainda é membro", () => {
    expect(
      resolveRecreationAssignee({ ...base, responsibleUserId: "u2" })
    ).toEqual({ responsibleUserId: "u2" });
  });

  it("EX-MEMBRO não é herdado — o Select não o mostraria e o POST daria 400", () => {
    // Remover a membership não anula `responsibleUserId` na proposta, então o
    // id sobrevive apontando pra quem saiu da org.
    expect(
      resolveRecreationAssignee({ ...base, responsibleUserId: "fantasma" })
    ).toEqual({});
  });

  it("responsável EXTERNO (nome livre, sem userId) é preservado", () => {
    // Sem isto a recriação trocaria o dono da atribuição em silêncio.
    expect(
      resolveRecreationAssignee({ ...base, responsibleName: "Corretor Parceiro" })
    ).toEqual({ responsibleName: "Corretor Parceiro" });
  });

  it("userId tem precedência sobre nome externo quando os dois existem", () => {
    expect(
      resolveRecreationAssignee({
        ...base,
        responsibleUserId: "u1",
        responsibleName: "Corretor Parceiro",
      })
    ).toEqual({ responsibleUserId: "u1" });
  });

  it("ex-membro COM nome externo não cai no nome — o vínculo era com o usuário", () => {
    // Cair no nome livre inventaria um responsável externo que nunca existiu.
    expect(
      resolveRecreationAssignee({
        ...base,
        responsibleUserId: "fantasma",
        responsibleName: "Corretor Parceiro",
      })
    ).toEqual({});
  });

  it("sem PROPOSAL_ASSIGN nada é herdado — o POST recusaria o campo", () => {
    expect(
      resolveRecreationAssignee({
        ...base,
        canAssign: false,
        responsibleUserId: "u1",
      })
    ).toEqual({});
    expect(
      resolveRecreationAssignee({
        ...base,
        canAssign: false,
        responsibleName: "Corretor Parceiro",
      })
    ).toEqual({});
  });

  it("nome só de espaços não vira responsável externo", () => {
    expect(
      resolveRecreationAssignee({ ...base, responsibleName: "   " })
    ).toEqual({});
  });

  it("proposta sem responsável nenhum não inventa um", () => {
    expect(resolveRecreationAssignee(base)).toEqual({});
  });
});
