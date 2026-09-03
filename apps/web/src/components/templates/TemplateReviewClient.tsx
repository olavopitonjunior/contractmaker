"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { describePiiKinds, type TemplatePiiReport } from "@/lib/templates/pii-gate";
import { maskForReport, readNotMapped } from "@/lib/templates/insertion-report";
import {
  SEMANTIC_CATEGORY_LABEL,
  countBySeverity,
  type SemanticFinding,
  type SemanticReport,
} from "@/lib/templates/semantic-checks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Star,
  Sparkles,
  Info,
  MousePointerClick,
} from "lucide-react";
import { matchCriteriaSummary, modalidadeLabel } from "@/lib/contracts/template-category";

interface CatalogEntry {
  token: string;
  label: string;
  description: string;
  required: boolean;
  kind: "simple" | "composed";
  present: boolean;
}
interface ValidateResult {
  found: string[];
  unknown: string[];
  missingRequired: string[];
  catalog: CatalogEntry[];
  /** Estado dos slots reconciliado com o Doc (ver validate-gdoc). */
  slots?: SlotReport[];
  /** Achados semânticos do último `validate-gdoc` (ver semantic-checks.ts). */
  semantic?: SemanticReport;
}
/** Espelha `ApplyClauseSlotReport` (lib/templates/apply-clause-slot.ts). */
interface SlotReport {
  slot: string;
  applied: boolean;
  token: string | null;
  removed?: number;
  issues?: { paragraph: string; reason: string }[];
}
interface DraftReport {
  inserted?: { token: string; trecho: string }[];
  skippedAmbiguous?: { token: string; trecho: string; reason: string; paragraph?: string; neighbor?: string }[];
  /** `string[]` em relatórios antigos; `{token, reason, trecho?}` desde 2026-09-02. */
  notMapped?: unknown[];
  missingRequired?: string[];
  slots?: SlotReport[];
  docTruncated?: boolean;
  responseTruncated?: boolean;
  responseUnparsed?: boolean;
  /** Estágio determinístico (gabarito → chaves). Só existe quando houve gabarito. */
  reverseMerge?: {
    replaced?: { token: string; value: string; occurrences?: number }[];
    skipped?: { token: string; value: string; reason: string; occurrences?: number }[];
  };
  ranAt?: string;
  /** Gate de PII do modelo — espelho do último texto lido (ver lib/templates/pii-gate.ts). */
  pii?: TemplatePiiReport;
  /** Achados semânticos persistidos (sem as frases cruas do conserto). */
  semantic?: SemanticReport;
}
interface TemplateInfo {
  id: string;
  name: string;
  modalidade: string;
  matchCriteria?: unknown;
  status: string;
  isDefault: boolean;
  /** `ContractTemplate.draftReport` — inclui os avisos de slot da ingestão. */
  draftReport?: unknown;
  docId: string;
  embedLink: string;
}

const SKIP_REASON: Record<string, string> = {
  ambiguous: "aparece em mais de um lugar",
  "not-found": "não encontrei no texto",
  "unknown-token": "chave fora do catálogo",
  "already-tokenized": "o trecho já tem uma chave",
  overlapped: "o trecho se sobrepõe a outro já mapeado nesta passada",
  "engulfs-neighbor":
    "o trecho proposto engoliria também o trecho de outra chave (a qualificação e a conta ficam em chaves separadas) — mapeie só o dado desta chave",
  // Pós-batch — o passe confere o que a API fez (mesmo vocabulário dos slots).
  "batch-failed": "o Google recusou a edição",
  "replace-noop":
    "o trecho existe no texto, mas a edição não pegou — costuma ser formatação invisível partindo o parágrafo no meio",
  "over-matched":
    "a chave entrou em mais lugares do que o esperado (possivelmente no cabeçalho ou rodapé) — confira no documento",
  "over-removed":
    "um parágrafo do bloco foi apagado em mais de um lugar do documento, fora do trecho revisado — confira o histórico de versões do Doc",
  "verify-failed":
    "a edição foi enviada, mas a conferência no documento não confirmou o resultado",
  "verify-unavailable":
    "não consegui conferir o documento agora (Drive indisponível) — rode a IA de novo",
  "not-specific": "o valor se repete, mas é genérico demais para trocar em todo lugar",
  "too-short": "o valor é curto demais para ser trocado com segurança",
  stopword: "o valor é uma palavra comum de contrato (não se troca às cegas)",
  "doc-truncated": "o documento é maior que o limite lido pela IA — esta parte ficou fora da leitura",
  "response-truncated": "a resposta da IA veio cortada antes de chegar aqui — rode a IA de novo",
  "response-unparsed": "a resposta da IA não pôde ser lida (veio com texto fora do JSON) — rode a IA de novo",
};

const SLOT_LABEL: Record<string, string> = {
  garantia: "cláusula de garantia",
};

const SLOT_ISSUE_REASON: Record<string, string> = {
  ambiguous: "o texto se repete em mais de um lugar do documento",
  "not-found": "não localizei esse trecho no documento",
  "too-short": "o trecho é curto demais para ser localizado com segurança",
  "doc-unreadable": "não consegui ler o documento no Drive",
  "batch-failed": "o Google recusou a edição",
  "replace-noop":
    "o trecho existe no texto, mas a edição não pegou — costuma ser formatação invisível partindo o parágrafo no meio",
  "over-matched":
    "o trecho foi encontrado em mais lugares do que o esperado (possivelmente no cabeçalho ou rodapé)",
  "verify-failed":
    "a edição foi enviada, mas a conferência no documento não confirmou o resultado",
  "verify-unavailable":
    "não consegui conferir o documento agora (Drive indisponível) — clique em Revalidar",
  "token-missing": "o campo não está mais no documento",
};

const SEVERITY_STYLE: Record<string, string> = {
  error: "border-destructive/40 bg-destructive/5",
  warning: "border-warning/40 bg-warning/5",
  info: "border-border bg-muted/40",
};

/**
 * Um achado semântico. Mostra o que está errado e ONDE — o excerto é o que
 * permite ao operador achar o parágrafo no Doc ao lado sem procurar às cegas.
 */
function SemanticFindingRow({ finding }: { finding: SemanticFinding }) {
  return (
    <div className={`space-y-1 rounded-md border p-2 ${SEVERITY_STYLE[finding.severity] ?? ""}`}>
      <p className="font-medium">
        {SEMANTIC_CATEGORY_LABEL[finding.category] ?? finding.category}
        <span className="ml-1 font-normal text-muted-foreground">
          · parágrafo {finding.paragraphIndex + 1}
        </span>
      </p>
      <p className="text-muted-foreground">{finding.message}</p>
      {finding.excerpt && (
        <p className="rounded bg-muted px-1.5 py-1 font-mono text-[11px] leading-snug">
          {finding.excerpt}
        </p>
      )}
    </div>
  );
}

function parseDraftReport(raw: unknown): DraftReport | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as DraftReport)
    : null;
}

export function TemplateReviewClient({ template }: { template: TemplateInfo }) {
  const router = useRouter();
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [activating, setActivating] = useState(false);
  const [status, setStatus] = useState(template.status);
  const [isDefault, setIsDefault] = useState(template.isDefault);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /**
   * Mensagem do 409 `SLOT_CLAUSE_MISSING` do PATCH — o modelo tem espaço de
   * cláusula e o acervo da imobiliária ainda não tem cláusula aprovada pra ele.
   * A trava é do servidor; aqui só mostramos o efeito e a saída consciente.
   */
  const [slotGap, setSlotGap] = useState<string | null>(null);
  /**
   * Mensagem do 409 `PII_LEFTOVER` do PATCH — o texto do modelo ainda tem dado
   * pessoal literal (CPF, RG, conta bancária…). Trava do servidor; a saída
   * consciente aqui é `allowPii`, separada do `forceActivate` do slot.
   */
  const [piiGap, setPiiGap] = useState<string | null>(null);
  /**
   * Flags já aceitos numa trava anterior, para o próximo PATCH não recuar
   * (slot → PII é a única cadeia: o servidor roda a trava de slot primeiro).
   * Ref, não state: é lido no mesmo handler que o escreve. Zerado ao ativar.
   */
  const acceptedFlags = useRef<{ forceActivate?: boolean; allowPii?: boolean }>({});

  // Revisão por IA — parte do relatório persistido na ingestão (é ele que traz
  // os avisos de slot), sobrescrito quando o operador roda a IA de novo.
  const [aiRunning, setAiRunning] = useState(false);
  const [report, setReport] = useState<DraftReport | null>(() =>
    parseDraftReport(template.draftReport)
  );

  /**
   * Slots de cláusula que a ingestão NÃO conseguiu abrir. O modelo ficou com a
   * cláusula da variante de referência CHUMBADA — ativar assim faz todo contrato
   * dessa família sair com aquela garantia, seja qual for a escolha do
   * formulário. Trava a ativação (o operador ainda pode insistir, como no caso
   * dos campos obrigatórios ausentes).
   */
  const failedSlots = (report?.slots ?? []).filter((s) => !s.applied);
  // A validação da sessão manda (traz o conserto proposto com a frase crua); o
  // relatório persistido é o fallback enquanto a primeira revalidação não volta.
  const semantic = validation?.semantic ?? report?.semantic ?? null;
  const semanticFindings = semantic?.findings ?? [];
  const semanticCounts = countBySeverity(semanticFindings);
  const semanticErrors = semanticFindings.filter((f) => f.severity === "error");

  // Mapeamento manual
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [selText, setSelText] = useState("");
  const [mapping, setMapping] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  const revalidate = useCallback(async () => {
    setValidating(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/validate-gdoc`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha na validação");
      setValidation(data);
      // A revalidação reconcilia a declaração de slot com o Doc — se o operador
      // consertou o modelo à mão, o aviso (e a trava da ativação) some aqui.
      if (Array.isArray(data.slots) || data.pii || data.semantic) {
        setReport((prev) => ({
          ...(prev ?? {}),
          ...(Array.isArray(data.slots) ? { slots: data.slots as SlotReport[] } : {}),
          ...(data.pii ? { pii: data.pii as TemplatePiiReport } : {}),
          ...(data.semantic ? { semantic: data.semantic as SemanticReport } : {}),
        }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na validação");
    } finally {
      setValidating(false);
    }
  }, [template.id]);

  const refreshDocText = useCallback(async () => {
    try {
      const res = await fetch(`/api/templates/${template.id}/doc-text`);
      const data = await res.json();
      if (res.ok) setParagraphs(data.paragraphs ?? []);
    } catch {
      /* ignore */
    }
  }, [template.id]);

  useEffect(() => {
    void revalidate();
    void refreshDocText();
  }, [revalidate, refreshDocText]);

  async function patchTemplate(body: Record<string, unknown>, okMsg: string) {
    setActivating(true);
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.code === "SLOT_CLAUSE_MISSING") {
        // Não é erro de operação: é uma decisão que falta ser tomada.
        setSlotGap(data.error as string);
        return;
      }
      if (res.status === 409 && (data?.code === "PII_LEFTOVER" || data?.code === "PII_UNVERIFIED")) {
        setPiiGap(data.error as string);
        return;
      }
      if (!res.ok) {
        acceptedFlags.current = {};
        throw new Error(data.error ?? "Falha ao atualizar template");
      }
      toast.success(okMsg);
      if (body.status === "active") acceptedFlags.current = {};
      if (typeof body.status === "string") setStatus(body.status);
      if (typeof body.isDefault === "boolean") setIsDefault(body.isDefault);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar");
    } finally {
      setActivating(false);
    }
  }

  async function activate() {
    // Nova tentativa = nenhum flag aceito ainda. O ref só sobrevive DENTRO da
    // cadeia slot → PII de uma mesma tentativa (409 → diálogo → retry).
    acceptedFlags.current = {};
    if (
      (validation?.missingRequired ?? []).length > 0 ||
      failedSlots.length > 0 ||
      semanticErrors.length > 0
    ) {
      setConfirmOpen(true);
      return;
    }
    await patchTemplate({ status: "active" }, "Template ativado.");
  }

  async function runAI() {
    setAiRunning(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/rerun-ai`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha na revisão por IA");
      // `rerun-ai` só devolve o pass de placeholders — preserva os avisos de
      // slot da ingestão, senão rodar a IA "limparia" a trava da ativação.
      setReport((prev) => ({
        ...(data.report as DraftReport),
        slots: prev?.slots,
      }));
      const n = (data.report?.inserted ?? []).length;
      toast.success(
        n > 0 ? `A IA confirmou ${n} trecho(s) no documento.` : "A IA revisou o modelo."
      );
      await Promise.all([revalidate(), refreshDocText()]);
      setIframeKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na revisão por IA");
    } finally {
      setAiRunning(false);
    }
  }

  async function mapField(token: string, phrase: string) {
    const trecho = phrase.trim();
    if (trecho.length < 2) {
      toast.error("Selecione um trecho do texto primeiro.");
      return;
    }
    setMapping(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/map-field`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, phrase: trecho }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao mapear");
      toast.success(`Campo {{${token}}} inserido no modelo.`);
      setSelText("");
      window.getSelection?.()?.removeAllRanges();
      await Promise.all([revalidate(), refreshDocText()]);
      setIframeKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao mapear");
    } finally {
      setMapping(false);
    }
  }

  const catalog = validation?.catalog ?? [];
  // Por que cada chave ausente está ausente — vem do último passe da IA.
  const notMappedByToken = new Map(readNotMapped(report?.notMapped).map((n) => [n.token, n]));
  const total = catalog.length;
  const done = catalog.filter((c) => c.present).length;
  const missing = catalog.filter((c) => !c.present);

  return (
    <div className="space-y-4">
      <AlertDialog open={slotGap !== null} onOpenChange={(o) => !o && setSlotGap(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Falta a cláusula deste modelo no acervo
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{slotGap}</p>
                <p>
                  <a
                    href="/clauses"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline"
                  >
                    Abrir o acervo de cláusulas
                  </a>{" "}
                  — aprove a cláusula lá e volte para ativar.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => (acceptedFlags.current = {})}>
              Voltar e aprovar a cláusula
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSlotGap(null);
                // Saída consciente: o texto padrão da plataforma é legítimo pra
                // quem não tem redação própria — só não pode acontecer sem
                // ninguém saber. O flag SOBREVIVE ao próximo elo (slot → PII):
                // o AlertDialogAction fecha o diálogo via onOpenChange, por isso
                // a limpeza do ref vive só no Cancelar e no início da tentativa.
                acceptedFlags.current.forceActivate = true;
                void patchTemplate(
                  { status: "active", ...acceptedFlags.current },
                  "Template ativado com o texto padrão da plataforma no espaço de cláusula."
                );
              }}
            >
              Ativar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={piiGap !== null} onOpenChange={(o) => !o && setPiiGap(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>O modelo ainda tem dado pessoal no texto</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{piiGap}</p>
                <p>
                  Use o mapeamento manual abaixo para trocar o trecho por uma chave
                  de preenchimento, ou edite o Doc e clique em &quot;Revalidar&quot;.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => (acceptedFlags.current = {})}>
              Voltar e corrigir
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPiiGap(null);
                // Saída consciente e SEPARADA da do slot: quem aceita imprimir
                // o dado em todo contrato assume isso com nome próprio.
                acceptedFlags.current.allowPii = true;
                void patchTemplate(
                  { status: "active", ...acceptedFlags.current },
                  "Template ativado com dado pessoal no texto — revise os contratos gerados."
                );
              }}
            >
              Ativar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {failedSlots.length > 0
                ? "Ativar com a cláusula variável chumbada?"
                : semanticErrors.length > 0 && (validation?.missingRequired ?? []).length === 0
                  ? "Ativar com problemas apontados na revisão?"
                  : "Ativar com campos obrigatórios ausentes?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {failedSlots.length > 0 && (
                  <p>
                    Não consegui trocar a{" "}
                    {failedSlots
                      .map((s) => SLOT_LABEL[s.slot] ?? s.slot)
                      .join(", ")}{" "}
                    pelo campo variável. Do jeito que está, <b>todo contrato desta
                    família sai com a garantia deste arquivo</b> — mesmo quando o
                    cliente escolher outra no formulário.
                  </p>
                )}
                {(validation?.missingRequired ?? []).length > 0 && (
                  <p>
                    Os campos{" "}
                    <code className="rounded bg-muted px-1">
                      {(validation?.missingRequired ?? [])
                        .map((t) => `{{${t}}}`)
                        .join(", ")}
                    </code>{" "}
                    não estão no modelo — não serão preenchidos nos contratos até
                    você inseri-los.
                  </p>
                )}
                {semanticErrors.length > 0 && (
                  <div className="space-y-1">
                    <p>
                      A revisão apontou{" "}
                      <b>
                        {semanticErrors.length}{" "}
                        {semanticErrors.length === 1 ? "problema" : "problemas"}
                      </b>{" "}
                      no conteúdo do modelo:
                    </p>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs">
                      {semanticErrors.slice(0, 5).map((f) => (
                        <li key={f.id}>{f.message}</li>
                      ))}
                    </ul>
                    {semanticErrors.length > 5 && (
                      <p className="text-xs text-muted-foreground">
                        …e mais {semanticErrors.length - 5}. A lista completa está no
                        card &quot;Problemas&quot;.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e revisar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void patchTemplate({ status: "active" }, "Template ativado.");
              }}
            >
              Ativar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {report?.pii?.blocked && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium">Dado pessoal literal no texto do modelo</p>
          <p className="text-muted-foreground">
            {describePiiKinds(report.pii.kinds)} — {report.pii.count}{" "}
            {report.pii.count === 1 ? "ocorrência" : "ocorrências"}. A ativação fica travada
            até o trecho virar chave de preenchimento (ou cláusula do acervo) e o modelo ser
            revalidado.
          </p>
        </div>
      )}

      {/* Slot de cláusula que não abriu — o aviso mais grave desta tela: o
          modelo consolidado ficou com a garantia de UMA variante chumbada. */}
      {failedSlots.length > 0 && (
        <div className="flex gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-destructive" />
          <div className="space-y-1.5">
            <p>
              <b>A cláusula que varia entre as versões continua fixa no modelo.</b>{" "}
              A consolidação tentou substituí-la pelo campo{" "}
              <code className="rounded bg-muted px-1">{"{{slot_garantia}}"}</code>{" "}
              e não conseguiu — então todo contrato gerado por este modelo sai com
              a garantia deste arquivo, mesmo quando o formulário disser outra.
            </p>
            {failedSlots.map((s, i) => (
              <div key={i} className="text-xs text-muted-foreground">
                {(s.issues ?? []).map((iss, j) => (
                  <p key={j}>
                    • {SLOT_ISSUE_REASON[iss.reason] ?? iss.reason}:{" "}
                    <span className="italic">“{iss.paragraph}”</span>
                  </p>
                ))}
              </div>
            ))}
            <p className="text-xs">
              Como resolver: abra o Doc ao lado, apague o texto da cláusula de
              garantia e escreva{" "}
              <code className="rounded bg-muted px-1">{"{{slot_garantia}}"}</code>{" "}
              no lugar. As cláusulas de cada variante já estão no acervo.
            </p>
          </div>
        </div>
      )}

      {/* Como funciona */}
      <div className="flex gap-2.5 rounded-xl border border-info/30 bg-info/10 p-3.5 text-sm">
        <Info className="mt-0.5 h-4 w-4 flex-none text-info" />
        <span>
          Este é o <b>seu modelo</b>. As <code className="rounded bg-muted px-1">{"{{chaves}}"}</code>{" "}
          são os campos que a IA preenche em cada contrato — <b className="text-success">verde</b> já
          está no modelo, <span className="text-muted-foreground">cinza</span> ainda falta. Peça a{" "}
          <b>revisão da IA</b> ou insira você mesmo: <b>selecione um trecho</b> abaixo e clique (ou
          arraste) a chave.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-h-[64vh] overflow-hidden rounded-lg border">
          <iframe
            key={iframeKey}
            src={template.embedLink}
            className="h-full min-h-[64vh] w-full"
            title="Modelo da imobiliária"
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>Status</span>
                <span className="flex items-center gap-1.5">
                  {/* A modalidade decide o catálogo de campos abaixo e qual
                      esteira acha este template — deixá-la visível evita
                      revisar um modelo de locação com campos de venda. */}
                  <Badge variant="outline" className="text-xs">
                    {modalidadeLabel(template.modalidade)}
                  </Badge>
                  {/* Variante: por qual escolha do formulário este modelo é
                      escolhido dentro da modalidade. */}
                  {matchCriteriaSummary(template.matchCriteria).map((label) => (
                    <Badge
                      key={label}
                      variant="outline"
                      className="text-xs border-sky-300 text-sky-700"
                      title="Critério de seleção pelas escolhas do formulário"
                    >
                      {label}
                    </Badge>
                  ))}
                  <Badge variant={status === "active" ? "default" : "outline"}>
                    {status === "active" ? "Ativo" : status === "draft" ? "Rascunho" : status}
                  </Badge>
                  {isDefault && (
                    <Badge variant="outline" className="border-amber-300 text-amber-700">
                      Padrão
                    </Badge>
                  )}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {total > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Campos preenchidos</span>
                    <span className="font-semibold tabular-nums">
                      {done}/{total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${Math.round((done / total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={runAI} disabled={aiRunning}>
                  {aiRunning ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Pedir revisão pela IA
                </Button>
                <Button size="sm" variant="outline" onClick={revalidate} disabled={validating}>
                  {validating ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Revalidar
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {status !== "active" && (
                  <Button size="sm" variant="outline" onClick={activate} disabled={activating || !validation}>
                    Ativar template
                  </Button>
                )}
                {status === "active" && !isDefault && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => patchTemplate({ isDefault: true }, "Definido como padrão.")}
                    disabled={activating}
                  >
                    <Star className="mr-1.5 h-3.5 w-3.5" />
                    Definir como padrão
                  </Button>
                )}
              </div>
              {validation && validation.unknown.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Chaves desconhecidas (não serão preenchidas):{" "}
                    {validation.unknown.map((t) => `{{${t}}}`).join(", ")}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Problemas de CONTEÚDO — o que a validação sintática não vê. */}
          {semantic && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle
                      className={
                        semanticCounts.error > 0
                          ? "h-4 w-4 text-destructive"
                          : "h-4 w-4 text-muted-foreground"
                      }
                    />
                    Problemas
                  </span>
                  {semanticFindings.length > 0 && (
                    <span className="flex gap-1">
                      {semanticCounts.error > 0 && (
                        <Badge variant="destructive">{semanticCounts.error}</Badge>
                      )}
                      {semanticCounts.warning > 0 && (
                        <Badge variant="outline">{semanticCounts.warning} aviso(s)</Badge>
                      )}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {semanticFindings.length === 0 ? (
                  <p className="text-muted-foreground">
                    Nada a apontar no conteúdo: as chaves batem com as partes que o texto
                    nomeia, não há dado de pessoa ao lado delas e nenhuma cláusula virou
                    uma chave só.
                  </p>
                ) : (
                  semanticFindings.map((f) => (
                    <SemanticFindingRow key={f.id} finding={f} />
                  ))
                )}
                {/* O que a checagem NÃO pôde afirmar é parte do resultado: sem
                    o contrato original ela não distingue "cláusula engolida" de
                    "qualificação corretamente chaveada". */}
                {!semantic.sourceAvailable && (
                  <p className="border-t pt-2 text-muted-foreground">
                    Não encontrei o arquivo original deste modelo, então não dá para
                    comparar parágrafo a parágrafo — cláusula engolida por uma chave pode
                    passar despercebida.
                  </p>
                )}
                {!semantic.orgFactsAvailable && (
                  <p className="text-muted-foreground">
                    O cadastro da imobiliária está vazio em{" "}
                    <a href="/settings/perfil" className="underline" target="_blank" rel="noreferrer">
                      Perfil
                    </a>
                    : sem CNPJ, CRECI e dados de recebimento não consigo apontar quando um
                    dado da própria imobiliária ficou fixo no modelo.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Relato da IA */}
          {report && (report.ranAt || report.inserted) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Sparkles className="h-4 w-4 text-primary" />O que a IA fez
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p className="text-muted-foreground">
                  Confirmou <b className="text-success">{(report.inserted ?? []).length}</b> trecho(s) no
                  documento.
                  {(report.skippedAmbiguous ?? []).length > 0 && (
                    <>
                      {" "}
                      Ficou em dúvida em{" "}
                      <b className="text-warning">{(report.skippedAmbiguous ?? []).length}</b>.
                    </>
                  )}
                </p>
                {/* Os dois podem valer ao mesmo tempo (documento longo tende a
                    estourar a saída também) e pedem ações diferentes. */}
                {report.docTruncated && (
                  <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-warning">
                    O documento é maior que o limite lido pela IA: o fim do texto ficou fora da
                    leitura. As chaves dessa parte precisam ser mapeadas à mão.
                  </p>
                )}
                {report.responseTruncated && (
                  <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-warning">
                    A resposta da IA veio cortada. Rode a IA de novo — parte dos campos pode ter
                    ficado de fora.
                  </p>
                )}
                {report.responseUnparsed && (
                  <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-warning">
                    A resposta da IA não pôde ser lida (veio com texto fora do JSON), então esta
                    rodada não inseriu nada. Rode a IA de novo.
                  </p>
                )}
                {(report.skippedAmbiguous ?? []).map((s, i) => (
                  <div key={i} className="rounded-md border bg-muted/30 p-2">
                    <code className="rounded bg-muted px-1">{`{{${s.token}}}`}</code>{" "}
                    <span className="text-muted-foreground">
                      — {SKIP_REASON[s.reason] ?? s.reason}
                      {s.neighbor ? (
                        <>
                          {" "}(chave vizinha: <code className="rounded bg-muted px-1">{`{{${s.neighbor}}}`}</code>)
                        </>
                      ) : null}
                      .
                    </span>
                    {/* Máscara também no render: relatório gravado antes de
                        2026-09-02 tem o trecho cru, e é a única defesa se um
                        relatório futuro escapar da máscara na gravação. */}
                    {s.paragraph && (
                      <p className="mt-1 text-destructive">
                        Parágrafo apagado: “{maskForReport(s.paragraph)}”
                      </p>
                    )}
                    {s.trecho && (
                      <p className="mt-1 line-clamp-2 italic text-muted-foreground">
                        “{maskForReport(s.trecho)}”
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Troca pelo gabarito (reverse-merge) */}
          {report?.reverseMerge && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Troca pelo gabarito</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p className="text-muted-foreground">
                  Sem IA: cada valor conhecido do documento-fonte foi trocado pela chave.
                  Confirmou{" "}
                  <b className="text-success">{(report.reverseMerge.replaced ?? []).length}</b>{" "}
                  valor(es)
                  {(report.reverseMerge.replaced ?? []).some((r) => (r.occurrences ?? 1) > 1) && (
                    <> (alguns em mais de um trecho)</>
                  )}
                  .
                  {(report.reverseMerge.skipped ?? []).filter((s) => s.reason !== "not-found").length > 0 && (
                    <>
                      {" "}
                      Deixou{" "}
                      <b className="text-warning">
                        {(report.reverseMerge.skipped ?? []).filter((s) => s.reason !== "not-found").length}
                      </b>{" "}
                      para revisão.
                    </>
                  )}
                </p>
                {(report.reverseMerge.skipped ?? [])
                  .filter((s) => s.reason !== "not-found")
                  .map((s, i) => (
                    <div key={i} className="rounded-md border bg-muted/30 p-2">
                      <code className="rounded bg-muted px-1">{`{{${s.token}}}`}</code>{" "}
                      <span className="text-muted-foreground">
                        — {SKIP_REASON[s.reason] ?? s.reason}
                        {s.occurrences !== undefined && <> ({s.occurrences}×)</>}.
                      </span>
                      {s.value && (
                        <p className="mt-1 line-clamp-2 italic text-muted-foreground">
                          “{maskForReport(s.value)}”
                        </p>
                      )}
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* Catálogo */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Campos do contrato</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="max-h-[40vh] space-y-1.5 overflow-y-auto pr-1 text-xs">
                {catalog.map((c) => (
                  <li key={c.token} className="flex items-start gap-2">
                    {c.present ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    ) : (
                      <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    )}
                    <div>
                      <code className="rounded bg-muted px-1 py-0.5">{`{{${c.token}}}`}</code>
                      {c.required && <span className="ml-1 text-warning">obrigatório</span>}
                      {c.kind === "composed" && (
                        <span className="ml-1 text-muted-foreground">(bloco)</span>
                      )}
                      <p className="text-muted-foreground">{c.label}</p>
                      {!c.present && notMappedByToken.get(c.token)?.reason &&
                        notMappedByToken.get(c.token)!.reason !== "no-mapping" && (
                          <p className="text-warning">
                            {SKIP_REASON[notMappedByToken.get(c.token)!.reason] ??
                              notMappedByToken.get(c.token)!.reason}
                            {notMappedByToken.get(c.token)!.occurrences !== undefined && (
                              <> ({notMappedByToken.get(c.token)!.occurrences}×)</>
                            )}
                            {notMappedByToken.get(c.token)!.neighbor && (
                              <>
                                {" "}(chave vizinha:{" "}
                                <code className="rounded bg-muted px-1">{`{{${notMappedByToken.get(c.token)!.neighbor}}}`}</code>)
                              </>
                            )}
                            {notMappedByToken.get(c.token)!.trecho && (
                              <> — “{maskForReport(notMappedByToken.get(c.token)!.trecho!)}”</>
                            )}
                            {!notMappedByToken.get(c.token)!.trecho &&
                              notMappedByToken.get(c.token)!.sourceValue && (
                                <> — gabarito: “{maskForReport(notMappedByToken.get(c.token)!.sourceValue!)}”</>
                              )}
                          </p>
                        )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Mapeamento manual */}
      {missing.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <MousePointerClick className="h-4 w-4 text-brand-accent" />
              Inserir campos que faltam
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              <b>Selecione</b> no texto abaixo o trecho que corresponde a um campo e{" "}
              <b>clique na chave</b> (ou arraste-a para o trecho selecionado). A chave substitui o
              trecho no modelo.
            </p>

            {/* Barra do trecho selecionado (drop target) */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const token = e.dataTransfer.getData("text/plain");
                if (token) void mapField(token, selText);
              }}
              className="flex min-h-9 items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs"
            >
              {mapping ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : selText ? (
                <span className="line-clamp-1">
                  Trecho: <span className="italic">“{selText}”</span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Nenhum trecho selecionado — selecione um pedaço do texto abaixo.
                </span>
              )}
            </div>

            {/* Chips das chaves que faltam */}
            <div className="flex flex-wrap gap-1.5">
              {missing.map((c) => (
                <button
                  key={c.token}
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", c.token)}
                  onClick={() => mapField(c.token, selText)}
                  disabled={mapping}
                  title={c.description || c.label}
                  className="inline-flex cursor-grab items-center gap-1 rounded-full border border-brand-accent/40 bg-brand-accent/5 px-2.5 py-1 text-[11px] font-medium text-brand-accent hover:bg-brand-accent/10 active:cursor-grabbing disabled:opacity-50"
                >
                  {`{{${c.token}}}`}
                  {c.required && <span className="text-warning">*</span>}
                </button>
              ))}
            </div>

            {/* Texto do doc (seleção) */}
            <div
              onMouseUp={() => setSelText(window.getSelection?.()?.toString().trim() ?? "")}
              className="max-h-[38vh] space-y-1.5 overflow-y-auto rounded-md border bg-card p-3 text-sm leading-relaxed"
            >
              {paragraphs.length === 0 ? (
                <p className="text-xs text-muted-foreground">Carregando o texto do modelo…</p>
              ) : (
                paragraphs.map((p, i) => (
                  <p key={i} className="whitespace-pre-wrap">
                    {p}
                  </p>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
