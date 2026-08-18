import { describe, it, expect } from "vitest";
import {
  proposalStatusView,
  proposalTimelineStage,
  proposalEventLabel,
  responsibleDisplay,
  initials,
} from "../status-view";
import { ALLOWED_FROM } from "../status";

describe("proposalStatusView", () => {
  it("mapeia todos os status da máquina de estados (sem cair no default)", () => {
    // Todo status conhecido tem um bucket específico (não 'encerrada' por acidente
    // quando devia ser outro). Cobre os destinos de ALLOWED_FROM + rascunho.
    const known = new Set<string>(["rascunho", "aguardando_aprovacao", ...Object.keys(ALLOWED_FROM)]);
    for (const s of known) {
      const v = proposalStatusView(s);
      expect(v.label).toBeTruthy();
      expect(["sua_vez", "cliente", "proprietario", "encerrada"]).toContain(v.bucket);
    }
  });

  it("recusa do vendedor é 'sua vez' (contrapropor), não terminal frio", () => {
    expect(proposalStatusView("recusada_vendedor").bucket).toBe("sua_vez");
    expect(proposalStatusView("recusada_proponente").bucket).toBe("encerrada");
  });

  it("visualizou é bola com o cliente; aguardando_vendedor é com o proprietário", () => {
    expect(proposalStatusView("visualizada").bucket).toBe("cliente");
    expect(proposalStatusView("aguardando_vendedor").bucket).toBe("proprietario");
  });

  it("traz a frase 'de quem é a bola' (turn)", () => {
    expect(proposalStatusView("enviada").turn).toBe("Com o cliente");
    expect(proposalStatusView("aguardando_vendedor").turn).toBe("Com o proprietário");
  });

  it("parada de decisão deixou de ser homônima da 2ª via (2026-08)", () => {
    const decisao = proposalStatusView("assinada_proponente");
    const segundaVia = proposalStatusView("aguardando_vendedor");
    expect(decisao.label).toBe("Aguardando sua decisão");
    expect(decisao.bucket).toBe("sua_vez");
    expect(segundaVia.label).toBe("Com o proprietário");
    expect(decisao.label).not.toBe(segundaVia.label);
  });
});

describe("proposalEventLabel — nomes REAIS gravados têm rótulo", () => {
  it("os 5 chained_envelope2_* de send-execute.ts não caem no fallback cru", () => {
    for (const suffix of [
      "sent",
      "failed",
      "budget_exceeded",
      "preflight_failed",
      "no_creds",
    ]) {
      const label = proposalEventLabel(`chained_envelope2_${suffix}`);
      expect(label).not.toBe(`chained_envelope2_${suffix}`);
      expect(label).toMatch(/2ª via/);
    }
  });

  it("eventos da parada de decisão e conclusão manual têm rótulo", () => {
    expect(proposalEventLabel("awaiting_owner_decision")).toBe("Aguardando sua decisão");
    expect(proposalEventLabel("completed_manually")).toMatch(/Concluída/);
    expect(proposalEventLabel("manual_sync")).toBe("Sincronização manual");
  });

  it("fallback por prefixo cobre variantes futuras de 2ª via", () => {
    expect(proposalEventLabel("chained_envelope2_qualquer_coisa_nova")).toBe(
      "2ª via — atualização"
    );
    expect(proposalEventLabel("chained_aceite2_x")).toMatch(/aceite/);
  });

  it("nome desconhecido continua caindo no cru", () => {
    expect(proposalEventLabel("evento_misterioso")).toBe("evento_misterioso");
  });
});

describe("proposalTimelineStage", () => {
  it("avança o índice conforme o status", () => {
    expect(proposalTimelineStage("rascunho").reachedIndex).toBe(0);
    expect(proposalTimelineStage("enviada").reachedIndex).toBe(1);
    expect(proposalTimelineStage("visualizada").reachedIndex).toBe(3);
    expect(proposalTimelineStage("completa").reachedIndex).toBe(6);
    expect(proposalTimelineStage("convertida").reachedIndex).toBe(7);
  });

  it("marca terminal negativo (recusa/expiração/cancelamento)", () => {
    expect(proposalTimelineStage("cancelada").negative).toBe(true);
    expect(proposalTimelineStage("recusada_proponente").negative).toBe(true);
    expect(proposalTimelineStage("completa").negative).toBe(false);
  });
});

describe("responsibleDisplay — precedência nome livre > usuário > criador", () => {
  const user = { name: "Criador Silva" };
  it("nome livre (não-usuário) tem precedência", () => {
    const r = responsibleDisplay({
      responsibleName: "Corretor Externo",
      responsibleUser: { name: "Fulano", image: null },
      user,
    });
    expect(r).toEqual({ name: "Corretor Externo", isNonUser: true, image: null });
  });
  it("sem nome livre, usa o usuário responsável", () => {
    const r = responsibleDisplay({
      responsibleName: null,
      responsibleUser: { name: "Fulano", image: "http://x/y.png" },
      user,
    });
    expect(r).toEqual({ name: "Fulano", isNonUser: false, image: "http://x/y.png" });
  });
  it("sem responsável, cai no criador", () => {
    const r = responsibleDisplay({ responsibleName: null, responsibleUser: null, user });
    expect(r).toEqual({ name: "Criador Silva", isNonUser: false, image: null });
  });
});

describe("initials", () => {
  it("pega até 2 iniciais em maiúsculas", () => {
    expect(initials("Márcia Rafaini")).toBe("MR");
    expect(initials("joão")).toBe("J");
    expect(initials("Ana Paula Souza")).toBe("AP");
  });
});
