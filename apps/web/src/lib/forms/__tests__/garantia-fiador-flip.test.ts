import { describe, it, expect } from "vitest";
import {
  applyFiadorFlip,
  fiadorHasIdentity,
  fiadorHasName,
  garantiaTemFiador,
  missingFiadorName,
  shouldFlipGarantiaToFiador,
} from "../garantia-fiador-flip";

/** Form plano com get/set por path pontilhado — o mesmo contrato que RHF e o
 *  adaptador server-side oferecem ao helper. */
function plainForm(initial: Record<string, unknown>) {
  const data = JSON.parse(JSON.stringify(initial)) as Record<string, unknown>;
  const writes: Array<[string, unknown]> = [];
  const get = (path: string): unknown =>
    path.split(".").reduce<unknown>(
      (cur, seg) =>
        cur && typeof cur === "object" ? (cur as Record<string, unknown>)[seg] : undefined,
      data
    );
  const set = (path: string, value: unknown) => {
    writes.push([path, value]);
    const segs = path.split(".");
    let cur = data;
    for (const seg of segs.slice(0, -1)) {
      if (!cur[seg] || typeof cur[seg] !== "object") cur[seg] = {};
      cur = cur[seg] as Record<string, unknown>;
    }
    cur[segs[segs.length - 1]] = value;
  };
  return { data, writes, get, set };
}

describe("shouldFlipGarantiaToFiador", () => {
  it("só os kinds de fiador flipam, e só quando o tipo ainda não é fiador", () => {
    expect(shouldFlipGarantiaToFiador("fiador", "caucao")).toBe(true);
    expect(shouldFlipGarantiaToFiador("conjuge_fiador", undefined)).toBe(true);
    expect(shouldFlipGarantiaToFiador("fiador", "fiador")).toBe(false);
    expect(shouldFlipGarantiaToFiador("locatario", "caucao")).toBe(false);
    expect(shouldFlipGarantiaToFiador("outro", "caucao")).toBe(false);
  });
});

describe("applyFiadorFlip", () => {
  it("doc no fiador vira o tipo e limpa a modalidade anterior, sem tocar garantia.fiador", () => {
    const f = plainForm({
      garantia: {
        tipo: "caucao",
        caucao_meses: 3,
        provider: "Porto Seguro",
        fiador: { nome: "Pedro Fiador", cpf: "11144477735" },
      },
    });
    expect(applyFiadorFlip("fiador", f.get, f.set)).toBe(true);
    const g = f.data.garantia as Record<string, unknown>;
    expect(g.tipo).toBe("fiador");
    expect(g.caucao_meses).toBeUndefined();
    expect(g.provider).toBe("");
    expect(g.fiador).toEqual({ nome: "Pedro Fiador", cpf: "11144477735" });
  });

  it("cônjuge do fiador também define a modalidade", () => {
    const f = plainForm({ garantia: { tipo: "seguro_fianca", cobertura_meses: 30 } });
    expect(applyFiadorFlip("conjuge_fiador", f.get, f.set)).toBe(true);
    const g = f.data.garantia as Record<string, unknown>;
    expect(g.tipo).toBe("fiador");
    expect(g.cobertura_meses).toBeUndefined();
  });

  it("é idempotente: tipo já fiador não escreve nada (a caução limpa não volta, a manual fica)", () => {
    const f = plainForm({ garantia: { tipo: "fiador", caucao_meses: 2 } });
    expect(applyFiadorFlip("fiador", f.get, f.set)).toBe(false);
    expect(f.writes).toEqual([]);
    expect((f.data.garantia as Record<string, unknown>).caucao_meses).toBe(2);
  });

  it("kind de outra parte não mexe na garantia", () => {
    const f = plainForm({ garantia: { tipo: "caucao", caucao_meses: 3 } });
    expect(applyFiadorFlip("locatario", f.get, f.set)).toBe(false);
    expect(f.writes).toEqual([]);
  });

  it("não escreve campos de modalidade que já estavam vazios (só o que precisa limpar)", () => {
    const f = plainForm({ garantia: { tipo: "caucao" } });
    applyFiadorFlip("fiador", f.get, f.set);
    expect(f.writes).toEqual([["garantia.tipo", "fiador"]]);
  });

  it("garantia ausente: cria o objeto com o tipo", () => {
    const f = plainForm({});
    expect(applyFiadorFlip("fiador", f.get, f.set)).toBe(true);
    expect(f.data.garantia).toEqual({ tipo: "fiador" });
  });
});

describe("fiadorHasIdentity / fiadorHasName", () => {
  it("identidade aceita nome, razão social, CPF ou CNPJ", () => {
    expect(fiadorHasIdentity({ cpf: "11144477735" })).toBe(true);
    expect(fiadorHasIdentity({ razao_social: "Fiança Ltda" })).toBe(true);
    expect(fiadorHasIdentity({ tipo_pessoa: "fisica", nome: "  " })).toBe(false);
    expect(fiadorHasIdentity(undefined)).toBe(false);
  });

  it("nome respeita PF/PJ", () => {
    expect(fiadorHasName({ tipo_pessoa: "fisica", nome: "Ana" })).toBe(true);
    expect(fiadorHasName({ tipo_pessoa: "juridica", razao_social: "Fiança Ltda" })).toBe(true);
    expect(fiadorHasName({ tipo_pessoa: "juridica", nome: "Ana" })).toBe(false);
    expect(fiadorHasName({ cpf: "11144477735" })).toBe(false);
  });
});

describe("garantiaTemFiador", () => {
  it("tipo fiador OU fiador identificado", () => {
    expect(garantiaTemFiador({ garantia: { tipo: "fiador" } })).toBe(true);
    expect(garantiaTemFiador({ garantia: { tipo: "caucao", fiador: { cpf: "1" } } })).toBe(true);
    expect(garantiaTemFiador({ garantia: { tipo: "caucao", fiador: { tipo_pessoa: "fisica" } } })).toBe(false);
    expect(garantiaTemFiador({})).toBe(false);
    expect(garantiaTemFiador(null)).toBe(false);
  });
});

describe("missingFiadorName (piso do finalize e da etapa 5)", () => {
  it("tipo fiador sem nome aponta o path certo por PF/PJ", () => {
    expect(missingFiadorName({ garantia: { tipo: "fiador" } })).toBe("garantia.fiador.nome");
    expect(
      missingFiadorName({ garantia: { tipo: "fiador", fiador: { tipo_pessoa: "juridica", cnpj: "1" } } })
    ).toBe("garantia.fiador.razao_social");
  });

  it("nome presente, ou outra modalidade, não bloqueia", () => {
    expect(missingFiadorName({ garantia: { tipo: "fiador", fiador: { nome: "Ana" } } })).toBeNull();
    expect(missingFiadorName({ garantia: { tipo: "caucao" } })).toBeNull();
    expect(missingFiadorName({})).toBeNull();
    expect(missingFiadorName(null)).toBeNull();
  });
});
