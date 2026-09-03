import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { DocumentosStep } from "@/components/forms/steps/DocumentosStep";
import { locacaoDocAdapter } from "@/components/forms/steps/locacao/locacao-doc-adapter";
import { fireEvent } from "@testing-library/react";

/**
 * Integração: valida que a OCR feita/categorizada nos links individuais reflete
 * nos campos quando o form (principal ou o próprio link) é (re)aberto —
 * Fix 1 (usa o assignment PERSISTIDO) + Fix 3 (auto-aplica aos campos), sem
 * depender de Gemini/Drive/DB. Mocka só o GET /attachments.
 */

type Attachment = {
  id: string;
  filename: string;
  mime: string;
  category: string | null;
  extractedData: unknown;
  status: string;
  fileUrl: string;
  createdAt: string;
};

function mockAttachments(attachments: Attachment[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("/attachments")) {
        return {
          ok: true,
          json: async () => ({ attachments }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({}) } as unknown as Response;
    })
  );
}

/** RG do comprador já extraído + atribuído (persistido) ao Comprador 1. */
function compradorRg(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "att-1",
    filename: "rg-maria.jpg",
    mime: "image/jpeg",
    category: "rg",
    status: "ready",
    fileUrl: "/api/forms/tok/attachments/att-1/file",
    createdAt: new Date("2026-07-01T12:00:00Z").toISOString(),
    extractedData: {
      confidence: 0.95,
      fields: {
        nome_completo: "Maria Compradora",
        cpf_numero: "12345678909",
        rg_numero: "1234567",
      },
      assignment: { kind: "comprador", index: 0 },
    },
    ...overrides,
  };
}

let capturedForm: UseFormReturn<Record<string, unknown>> | null = null;

function Harness({
  allowedTopKeys,
  defaultValues,
}: {
  allowedTopKeys?: readonly string[];
  defaultValues?: Record<string, unknown>;
}) {
  const form = useForm<Record<string, unknown>>({
    defaultValues: defaultValues ?? { compradores: [{}] },
  });
  capturedForm = form;
  return (
    <DocumentosStep form={form} token="tok" allowedTopKeys={allowedTopKeys} />
  );
}

beforeEach(() => {
  capturedForm = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DocumentosStep — reflexão de OCR/categoria nos campos", () => {
  it("Fix 1+3: doc categorizado com assignment PERSISTIDO auto-preenche o comprador ao abrir", async () => {
    mockAttachments([compradorRg()]);
    render(<Harness allowedTopKeys={["compradores"]} />);

    await waitFor(() => {
      expect(capturedForm!.getValues("compradores.0.nome")).toBe(
        "Maria Compradora"
      );
    });
    expect(capturedForm!.getValues("compradores.0.cpf")).toBe("12345678909");
    expect(capturedForm!.getValues("compradores.0.rg")).toBe("1234567");
  });

  it("não auto-aplica quando NÃO há assignment persistido (fica pro 'Aplicar' manual)", async () => {
    // Sem `assignment` no extractedData → assignmentPersisted=false → sem auto-apply.
    const noAssignment = compradorRg({
      extractedData: {
        confidence: 0.9,
        fields: { nome_completo: "Maria Compradora", cpf_numero: "12345678909" },
      },
    });
    mockAttachments([noAssignment]);
    render(<Harness allowedTopKeys={["compradores"]} />);

    // Dá tempo dos effects (restore + auto-apply) rodarem.
    await new Promise((r) => setTimeout(r, 50));
    expect(capturedForm!.getValues("compradores.0.nome")).toBeFalsy();
  });

  it("skipIfDirty: auto-apply não sobrescreve valor já digitado à mão", async () => {
    mockAttachments([compradorRg()]);
    render(
      <Harness
        allowedTopKeys={["compradores"]}
        defaultValues={{ compradores: [{ nome: "Nome Digitado" }] }}
      />
    );

    await waitFor(() => {
      // cpf (vazio) é preenchido → prova que o auto-apply rodou…
      expect(capturedForm!.getValues("compradores.0.cpf")).toBe("12345678909");
    });
    // …mas o nome já digitado é preservado.
    expect(capturedForm!.getValues("compradores.0.nome")).toBe("Nome Digitado");
  });

  it("Fix 2: no link do comprador o dropdown 'Mover para' só oferece slots de comprador", async () => {
    mockAttachments([compradorRg()]);
    const { container } = render(<Harness allowedTopKeys={["compradores"]} />);

    const select = await waitFor(() => {
      const el = container.querySelector("select");
      if (!el) throw new Error("select ainda não renderizou");
      return el as HTMLSelectElement;
    });

    const groups = Array.from(select.querySelectorAll("optgroup")).map(
      (g) => g.getAttribute("label")
    );
    // Os sub-slots do comprador (cônjuge/procurador/representante) passam a
    // aparecer desde 2026-07-31 (os gates por estado_civil/PJ escondiam grupos
    // inteiros na etapa 0). O que importa aqui é o ESCOPO: nada de vendedor.
    expect(groups).toEqual([
      "Compradores",
      "Cônjuges",
      "Procuradores",
      "Representantes legais",
      "Outros",
    ]);
    expect(groups).not.toContain("Vendedores");
    expect(groups).not.toContain("Imóveis");
    const values = Array.from(select.querySelectorAll("option")).map(
      (o) => o.getAttribute("value") ?? ""
    );
    expect(values.some((v) => v.includes("vendedor"))).toBe(false);
    // Fix 1: o select reflete o slot PERSISTIDO escolhido pela parte.
    expect(select.value).toBe("comprador:0");
  });

  it("Fix 2: no token principal (sem escopo) o dropdown mostra Vendedores e Compradores", async () => {
    mockAttachments([compradorRg()]);
    const { container } = render(<Harness />); // allowedTopKeys undefined

    const select = await waitFor(() => {
      const el = container.querySelector("select");
      if (!el) throw new Error("select ainda não renderizou");
      return el as HTMLSelectElement;
    });
    const groups = Array.from(select.querySelectorAll("optgroup")).map(
      (g) => g.getAttribute("label")
    );
    expect(groups).toContain("Vendedores");
    expect(groups).toContain("Compradores");
  });
});

/** RG do fiador (locação) já extraído e atribuído (persistido) ao fiador. */
function fiadorRg(overrides: Partial<Attachment> = {}): Attachment {
  return compradorRg({
    id: "att-fiador",
    filename: "rg-pedro.jpg",
    extractedData: {
      confidence: 0.95,
      fields: { nome_completo: "Pedro Fiador", cpf_numero: "11144477735" },
      assignment: { kind: "fiador", index: 0 },
    },
    ...overrides,
  });
}

function LocacaoHarness({ defaultValues }: { defaultValues?: Record<string, unknown> }) {
  const form = useForm<Record<string, unknown>>({
    defaultValues: defaultValues ?? {
      locadores: [{ tipo_pessoa: "fisica" }],
      locatarios: [{ tipo_pessoa: "fisica" }],
      garantia: { tipo: "caucao", caucao_meses: 3 },
    },
  });
  capturedForm = form;
  return <DocumentosStep form={form} token="tok" adapter={locacaoDocAdapter} />;
}

// 2026-09-02 — doc no fiador define a modalidade, mas SÓ no evento de
// atribuição. O restore (Fix 3) não flipa: o usuário pode ter trocado para
// caução na etapa 5 depois de atribuir, e a escolha manual vence.
describe("DocumentosStep (locação) — fiador define a garantia só no evento de atribuição", () => {
  it("restore com assignment persistido no fiador aplica o OCR mas NÃO muda o tipo", async () => {
    mockAttachments([fiadorRg()]);
    render(<LocacaoHarness />);

    await waitFor(() => {
      expect(capturedForm!.getValues("garantia.fiador.nome")).toBe("Pedro Fiador");
    });
    expect(capturedForm!.getValues("garantia.tipo")).toBe("caucao");
    expect(capturedForm!.getValues("garantia.caucao_meses")).toBe(3);
  });

  it("trocar o seletor para Fiador vira o tipo e limpa a caução", async () => {
    // Sem assignment persistido: o doc nasce em "outro" e o usuário escolhe.
    mockAttachments([
      fiadorRg({
        extractedData: {
          confidence: 0.95,
          fields: { nome_completo: "Pedro Fiador", cpf_numero: "11144477735" },
        },
      }),
    ]);
    const { container } = render(<LocacaoHarness />);

    const select = await waitFor(() => {
      const el = container.querySelector("select");
      if (!el) throw new Error("select ainda não renderizou");
      return el as HTMLSelectElement;
    });
    const values = Array.from(select.querySelectorAll("option")).map(
      (o) => o.getAttribute("value") ?? ""
    );
    // Garantia caução e o grupo Fiador está lá mesmo assim.
    expect(values).toContain("fiador:0");
    expect(values).toContain("conjuge_fiador:0");

    fireEvent.change(select, { target: { value: "fiador:0" } });

    await waitFor(() => {
      expect(capturedForm!.getValues("garantia.tipo")).toBe("fiador");
    });
    expect(capturedForm!.getValues("garantia.caucao_meses")).toBeUndefined();
    // A atribuição não aplica os campos: isso segue no "Aplicar aos campos".
    expect(capturedForm!.getValues("garantia.fiador.nome")).toBeFalsy();
  });

  it("mover o doc do fiador para o locatário não reverte o tipo", async () => {
    mockAttachments([fiadorRg()]);
    const { container } = render(
      <LocacaoHarness
        defaultValues={{
          locadores: [{ tipo_pessoa: "fisica" }],
          locatarios: [{ tipo_pessoa: "fisica" }],
          garantia: { tipo: "fiador" },
        }}
      />
    );
    const select = await waitFor(() => {
      const el = container.querySelector("select");
      if (!el) throw new Error("select ainda não renderizou");
      return el as HTMLSelectElement;
    });
    await waitFor(() => expect(select.value).toBe("fiador:0"));
    fireEvent.change(select, { target: { value: "locatario:0" } });
    await waitFor(() => expect(select.value).toBe("locatario:0"));
    expect(capturedForm!.getValues("garantia.tipo")).toBe("fiador");
  });
});
