import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PLACEHOLDER_CATALOG } from "@/lib/templates/placeholder-catalog";

export const metadata = {
  title: "Chaves de auto-preenchimento",
};

/**
 * Referência READ-ONLY das chaves de auto-preenchimento de contratos. Antes o
 * catálogo (placeholder-catalog.ts) e os helpers Handlebars só existiam no
 * código — o usuário não tinha onde ver "quais chaves posso usar" a não ser
 * validando um Google Doc específico. Esta tela renderiza o catálogo que já
 * existe, sem nova fonte de verdade.
 */

const HANDLEBARS_HELPERS: { name: string; desc: string; example: string }[] = [
  { name: "moeda", desc: "Formata número como R$ (2 casas, separador BR)", example: "{{moeda pagamento.valor_total}} → R$ 350.000,00" },
  { name: "cpf", desc: "Máscara de CPF", example: "{{cpf comprador.cpf}} → 111.444.777-35" },
  { name: "cnpj", desc: "Máscara de CNPJ", example: "{{cnpj vendedor.cnpj}} → 12.345.678/0001-90" },
  { name: "cep", desc: "Máscara de CEP", example: "{{cep imovel.cep}} → 01310-100" },
  { name: "dataExtenso", desc: "Data por extenso", example: "{{dataExtenso data}} → 15 de julho de 2026" },
  { name: "extenso", desc: "Valor monetário por extenso", example: "{{extenso valor}} → trezentos e cinquenta mil reais" },
  { name: "numero", desc: "Número com separador de milhar BR", example: "{{numero area}} → 1.250" },
  { name: "numeroExtenso", desc: "Número inteiro por extenso", example: "{{numeroExtenso parcelas}} → doze" },
  { name: "percentual", desc: "Formata percentual", example: "{{percentual comissao.percentual}} → 6%" },
  { name: "eq / gt / or / existe", desc: "Condicionais em blocos {{#if}}", example: "{{#if (eq modalidade \"financiamento\")}}…{{/if}}" },
];

export default function PlaceholdersReferencePage() {
  const composed = PLACEHOLDER_CATALOG.filter((p) => p.kind === "composed");
  const simple = PLACEHOLDER_CATALOG.filter((p) => p.kind === "simple");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link
        href="/templates"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar aos modelos
      </Link>

      <h1 className="text-2xl font-semibold">Chaves de auto-preenchimento</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Referência das chaves que os modelos preenchem automaticamente a partir
        dos dados do negócio. Em modelos Google Doc, use os tokens{" "}
        <code className="rounded bg-muted px-1">{"{{token}}"}</code>. Em modelos
        Handlebars, os helpers formatam os valores.
      </p>

      <Section
        title="Tokens compostos (Google Doc)"
        hint="Resolvidos no servidor — geram blocos completos (qualificação de partes, cláusulas, tabelas de pagamento)."
        rows={composed}
      />
      <Section
        title="Tokens simples (Google Doc)"
        hint="Substituição direta de um campo do negócio."
        rows={simple}
      />

      <h2 className="mb-2 mt-10 text-lg font-medium">Helpers Handlebars</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Usados nos modelos nativos (CCV). Formatam moeda, documentos e datas.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Helper</th>
              <th className="px-3 py-2 font-medium">O que faz</th>
              <th className="px-3 py-2 font-medium">Exemplo</th>
            </tr>
          </thead>
          <tbody>
            {HANDLEBARS_HELPERS.map((h) => (
              <tr key={h.name} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{h.name}</td>
                <td className="px-3 py-2">{h.desc}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {h.example}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: typeof PLACEHOLDER_CATALOG;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-8">
      <h2 className="mb-1 text-lg font-medium">{title}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{hint}</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Token</th>
              <th className="px-3 py-2 font-medium">Descrição</th>
              <th className="px-3 py-2 font-medium">Modalidades</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.token} className="border-t align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {"{{"}
                  {p.token}
                  {"}}"}
                  {p.required && (
                    <span className="ml-1 text-red-500" title="Obrigatório">
                      *
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{p.label}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {p.modalidades.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
