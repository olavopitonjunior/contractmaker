import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateClauseView, tokenColorClass, type TemplateClauseViewProps } from "../TemplateClauseView";
import type { SemanticFinding } from "@/lib/templates/semantic-checks";

/**
 * A aba existe para o operador VER o colapso e agir sem sair da tela. O que
 * estes casos guardam: o parágrafo que sumiu aparece como linha própria; as
 * ações por linha entregam ao pai exatamente a operação do `doc-edit` (frase
 * do próprio Doc, chaves certas); e modelo ativo não oferece ação nenhuma.
 */
const DOC = [
  "4.1.1. O pagamento do primeiro aluguel será rateado:",
  "{{rateio_primeiro_aluguel}}",
  "a) {{corretagem_qualificacao}}, como intermediadora imobiliária;",
  "LOCADOR: {{locador_nome}}, CPF {{locador_cpf}}.",
];
const SRC = [
  "4.1.1. O pagamento do primeiro aluguel será rateado:",
  "a) R$ 1.000,00 à imobiliária intermediadora, via PIX;",
  "b) R$ 800,00 ao corretor Fulano, via conta 123;",
  "a) Imob Ltda, CNPJ 11.111.111/0001-11, como intermediadora imobiliária;",
  "LOCADOR: João da Silva, CPF 123.456.789-00.",
];
const CATALOG: TemplateClauseViewProps["catalog"] = [
  { token: "rateio_primeiro_aluguel", label: "Rateio do 1º aluguel", kind: "composed" },
  { token: "corretagem_qualificacao", label: "Qualificação do corretor", kind: "simple" },
  { token: "imobiliaria_qualificacao", label: "Qualificação da imobiliária", kind: "simple" },
  { token: "locador_nome", label: "Nome do locador", kind: "simple" },
  { token: "locador_cpf", label: "CPF do locador", kind: "simple" },
];
const FINDING: SemanticFinding = {
  id: "f1",
  severity: "error",
  category: "wrong-entity",
  paragraphIndex: 2,
  token: "corretagem_qualificacao",
  excerpt: "a) {{corretagem_qualificacao}}, como intermediadora imobiliária;",
  message: "A frase fala da imobiliária, mas a chave é do corretor.",
  suggestedFix: { op: "rekey", phrase: DOC[2], fromToken: "corretagem_qualificacao", toToken: "imobiliaria_qualificacao" },
};

function renderView(over: Partial<TemplateClauseViewProps> = {}) {
  const props: TemplateClauseViewProps = {
    docParagraphs: DOC,
    source: { status: "ready", paragraphs: SRC },
    findings: [FINDING],
    catalog: CATALOG,
    editable: true,
    busy: false,
    fixingId: null,
    onFix: vi.fn(),
    onRekey: vi.fn(),
    onRemoveLeftover: vi.fn(),
    onRestore: vi.fn(),
    onSelectText: vi.fn(),
    onRetrySource: vi.fn(),
    ...over,
  };
  render(<TemplateClauseView {...props} />);
  return props;
}

const rows = () => screen.getAllByTestId("clause-row");
const kinds = () => rows().map((r) => r.getAttribute("data-kind"));

describe("TemplateClauseView — o que o operador vê", () => {
  it("alinha o Doc com o original e mostra o parágrafo que sumiu como linha própria", () => {
    renderView();
    // same, changed (chave solta × item a), missing (item b), tokenized ×2
    expect(kinds()).toEqual(["same", "changed", "missing-in-doc", "tokenized", "tokenized"]);
    const sumiu = rows()[2];
    expect(within(sumiu).getByText("sumiu do modelo")).toBeInTheDocument();
    expect(within(sumiu).getByText(SRC[2])).toBeInTheDocument();
    expect(within(sumiu).getByText("(sem parágrafo no modelo)")).toBeInTheDocument();
  });

  it("marca cada chave na cor do seu prefixo (a parte errada salta aos olhos)", () => {
    renderView();
    const marks = document.querySelectorAll("mark[data-token]");
    expect([...marks].map((m) => m.getAttribute("data-token"))).toEqual([
      "rateio_primeiro_aluguel",
      "corretagem_qualificacao",
      "locador_nome",
      "locador_cpf",
    ]);
    expect(tokenColorClass("locador_nome")).toBe(tokenColorClass("locador_cpf"));
    expect(tokenColorClass("corretagem_qualificacao")).not.toBe(
      tokenColorClass("imobiliaria_qualificacao")
    );
  });

  it("mostra o achado semântico na linha do parágrafo e o botão do conserto chama onFix", async () => {
    const props = renderView();
    const linha = rows()[3];
    expect(within(linha).getByText("chave da parte errada")).toBeInTheDocument();
    await userEvent.click(within(linha).getByRole("button", { name: "Corrigir a chave" }));
    expect(props.onFix).toHaveBeenCalledWith("f1");
  });

  it("filtro 'só com problemas' deixa achado, texto diferente e o que sumiu", async () => {
    renderView();
    await userEvent.click(screen.getByLabelText(/Só com problemas/));
    expect(kinds()).toEqual(["changed", "missing-in-doc", "tokenized"]);
    await userEvent.click(screen.getByLabelText(/Só com problemas/));
    await userEvent.click(screen.getByLabelText(/Só com chaves/));
    expect(kinds()).toEqual(["changed", "tokenized", "tokenized"]);
  });

  it("sem arquivo original: uma coluna só e o aviso do porquê", () => {
    renderView({ source: { status: "unavailable", paragraphs: [] } });
    expect(screen.getByText(/Sem arquivo original para comparar/)).toBeInTheDocument();
    expect(kinds()).toEqual(["same", "same", "same", "same"]);
    expect(screen.queryByText(/original ¶/)).not.toBeInTheDocument();
  });
});

describe("TemplateClauseView — ações por linha", () => {
  it("'Trocar chave…' devolve a frase do Doc com a chave de origem e a escolhida", async () => {
    const props = renderView();
    const linha = rows()[3];
    await userEvent.click(within(linha).getByRole("button", { name: "Trocar chave…" }));
    await userEvent.selectOptions(
      within(linha).getByLabelText("Nova chave"),
      "imobiliaria_qualificacao"
    );
    await userEvent.click(within(linha).getByRole("button", { name: "Trocar" }));
    expect(props.onRekey).toHaveBeenCalledWith(
      DOC[2],
      "corretagem_qualificacao",
      "imobiliaria_qualificacao"
    );
  });

  it("não oferece 'Trocar chave…' com duas chaves no parágrafo nem com bloco composto", () => {
    renderView();
    expect(within(rows()[4]).queryByRole("button", { name: "Trocar chave…" })).toBeNull();
    expect(within(rows()[1]).queryByRole("button", { name: "Trocar chave…" })).toBeNull();
  });

  it("'Restaurar do original' só em linha `changed` SEM chave nenhuma", async () => {
    // A chave solta é um bloco composto: restaurar apagaria `{{rateio_…}}`.
    renderView();
    expect(within(rows()[1]).queryByRole("button", { name: "Restaurar do original" })).toBeNull();
    // Prosa + chave simples alinhada como `changed` (literal curto demais para
    // o curinga): restaurar devolveria o CEP literal e sumiria com a chave.
    renderView({
      docParagraphs: ["CEP {{imovel_cep}}"],
      source: { status: "ready", paragraphs: ["CEP 82000-000, outro bairro qualquer da cidade"] },
      findings: [],
      catalog: [{ token: "imovel_cep", label: "CEP", kind: "simple" }],
    });
    const mista = screen.getAllByTestId("clause-row").at(-1)!;
    expect(mista.getAttribute("data-kind")).toBe("changed");
    expect(within(mista).queryByRole("button", { name: "Restaurar do original" })).toBeNull();

    const props = renderView({
      docParagraphs: ["Prazo de 30 meses."],
      source: { status: "ready", paragraphs: ["Prazo de 36 (trinta e seis) meses."] },
      findings: [],
    });
    const linha = screen.getAllByTestId("clause-row").at(-1)!;
    expect(linha.getAttribute("data-kind")).toBe("changed");
    await userEvent.click(within(linha).getByRole("button", { name: "Restaurar do original" }));
    expect(props.onRestore).toHaveBeenCalledWith(
      "Prazo de 30 meses.",
      "Prazo de 36 (trinta e seis) meses."
    );
  });

  it("falha ao buscar o original: diz que não conseguiu e oferece tentar de novo", async () => {
    const props = renderView({ source: { status: "error", paragraphs: [] } });
    expect(screen.getByText(/Não consegui buscar o arquivo original/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(props.onRetrySource).toHaveBeenCalledTimes(1);
  });

  it("modelo ativo (não editável): nenhuma ação, só leitura", () => {
    renderView({ editable: false });
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});
