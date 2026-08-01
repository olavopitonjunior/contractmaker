/**
 * A geração nunca troca a cláusula da imobiliária pela da plataforma — o texto
 * vira contrato e congela no `dataJson`. O custo dessa regra é que uma correção
 * publicada centralmente ficava invisível pra quem tem cláusula própria. Este
 * módulo é o sinal que faltava; adotar continua sendo decisão da casa.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  slotSelectionKey,
  findPlatformSlotUpdates,
} from "../platform-slot-updates";

const mockPrisma = prisma as unknown as {
  knowledgeItem: { findMany: ReturnType<typeof vi.fn> };
};

const ONTEM = new Date("2026-07-30T12:00:00Z");
const HOJE = new Date("2026-07-31T12:00:00Z");

/** Responde por escopo: a 1ª chamada é a da org, a 2ª a da plataforma. */
function comEscopos(daOrg: unknown[], daPlataforma: unknown[]) {
  mockPrisma.knowledgeItem.findMany.mockImplementation(
    async (args: { where: { orgId: string | null } }) =>
      args.where.orgId === null ? daPlataforma : daOrg
  );
}

beforeEach(() => vi.clearAllMocks());

describe("slotSelectionKey", () => {
  it("junta slot + opção + garantidor, em ordem estável", () => {
    const a = slotSelectionKey(["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro"]);
    const b = slotSelectionKey(["provider:porto_seguro", "garantia:seguro_fianca", "slot:garantia"]);
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });

  it("IGNORA `cobertura:*` — é metadado de acessória, não seleciona nada", () => {
    // Sem isto, uma cobertura adicional (pintura) pareceria substituta da
    // cláusula principal e o aviso ofereceria trocar uma pela outra.
    expect(slotSelectionKey(["slot:garantia", "garantia:seguro_fianca", "cobertura:pintura"])).toBe(
      slotSelectionKey(["slot:garantia", "garantia:seguro_fianca"])
    );
  });

  it("garantidores diferentes NÃO são a mesma cláusula", () => {
    expect(slotSelectionKey(["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro"])).not.toBe(
      slotSelectionKey(["slot:garantia", "garantia:seguro_fianca", "provider:pottencial"])
    );
  });

  it("sem tag de slot, não há chave", () => {
    expect(slotSelectionKey(["garantia:fiador"])).toBeNull();
    expect(slotSelectionKey([])).toBeNull();
  });
});

describe("findPlatformSlotUpdates", () => {
  const tags = ["slot:garantia", "garantia:fiador"];

  it("avisa quando a da plataforma é mais recente", async () => {
    comEscopos(
      [{ id: "org-1", title: "Fiador (nossa)", tags, updatedAt: ONTEM }],
      [{ id: "plat-1", title: "Fiador (universal)", tags, updatedAt: HOJE }]
    );

    const out = await findPlatformSlotUpdates("org1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ orgClauseId: "org-1", platformClauseId: "plat-1" });
  });

  it("não avisa quando a da org é mais nova — a casa já atualizou", async () => {
    comEscopos(
      [{ id: "org-1", title: "Fiador (nossa)", tags, updatedAt: HOJE }],
      [{ id: "plat-1", title: "Fiador (universal)", tags, updatedAt: ONTEM }]
    );
    expect(await findPlatformSlotUpdates("org1")).toEqual([]);
  });

  it("empate não conta — só o estritamente mais novo", async () => {
    comEscopos(
      [{ id: "org-1", title: "a", tags, updatedAt: HOJE }],
      [{ id: "plat-1", title: "b", tags, updatedAt: HOJE }]
    );
    expect(await findPlatformSlotUpdates("org1")).toEqual([]);
  });

  it("não cruza opções diferentes do form", async () => {
    // Fiador da org contra caução da plataforma: não são substitutas. Cruzar
    // faria o contrato seguinte sair com a garantia errada.
    comEscopos(
      [{ id: "org-1", title: "Fiador", tags: ["slot:garantia", "garantia:fiador"], updatedAt: ONTEM }],
      [{ id: "plat-1", title: "Caução", tags: ["slot:garantia", "garantia:caucao"], updatedAt: HOJE }]
    );
    expect(await findPlatformSlotUpdates("org1")).toEqual([]);
  });

  it("com várias na plataforma, a candidata é a mais recente", async () => {
    comEscopos(
      [{ id: "org-1", title: "a", tags, updatedAt: ONTEM }],
      [
        { id: "plat-velha", title: "velha", tags, updatedAt: new Date("2026-07-30T13:00:00Z") },
        { id: "plat-nova", title: "nova", tags, updatedAt: HOJE },
      ]
    );
    const out = await findPlatformSlotUpdates("org1");
    expect(out[0].platformClauseId).toBe("plat-nova");
  });

  it("plataforma sem cláusula de slot: nada a avisar", async () => {
    comEscopos([{ id: "org-1", title: "a", tags, updatedAt: ONTEM }], []);
    expect(await findPlatformSlotUpdates("org1")).toEqual([]);
  });
});
