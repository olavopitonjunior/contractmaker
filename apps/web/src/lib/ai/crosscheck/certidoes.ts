/**
 * Análise cruzada Certidões × Contrato.
 *
 * Pure function — recebe rows de `CertidaoJob` + dataJson do contrato e
 * devolve findings estruturados. Sem LLM, sem chamadas externas — toda a
 * inteligência vem da `resultData` já normalizada pelos extractors em
 * `lib/certidoes/normalizers.ts`.
 *
 * O Analyst/Editor chama via tool `cross_check_certidoes` e cada finding
 * vira `add_comment` ou `propose_suggestion` no Editor.
 */

import type { Prisma } from "@prisma/client";
import { ENDPOINTS, type EndpointInfo } from "@/lib/certidoes/endpoints";
import type { NormalizedResult } from "@/lib/certidoes/types";

export type Severity = "error" | "warning" | "info";

export type FindingKind =
  | "matricula_onus"
  | "matricula_vencida"
  | "matricula_faltando"
  | "matricula_invalida"
  | "vendedor_civel_positiva"
  | "vendedor_trabalhista_positiva"
  | "vendedor_fiscal_positiva"
  | "vendedor_antecedentes_positiva"
  | "imovel_iptu_pendente"
  | "protesto_vendedor"
  | "fgts_pendente"
  | "certidao_falhou_portal_manual";

export interface CrossCheckFinding {
  /** Tipo do achado — usado no UI pra escolher ícone/categoria. */
  kind: FindingKind;
  severity: Severity;
  /** Mensagem objetiva em PT-BR (1-2 frases). */
  message: string;
  /** Parte/imóvel envolvido (vendedor 1, imovel 1, etc). */
  target?: string;
  /** Endpoint Infosimples relacionado (pra debug + link cards). */
  endpoint?: string;
  /** Texto sugerido de aditamento ou cláusula — Editor pode usar como base
   *  pra `propose_suggestion`. Cita base legal quando aplicável.
   *  Populado apenas quando o aditamento é juridicamente claro. Quando
   *  ambíguo, fica undefined e o `clarification_paths` é populado. */
  suggested_aditamento?: string;
  /** F4 iteração 2026-05-17 — Quando o finding não tem solução determinística
   *  (ex: vendedor com ação cível em curso de valor pequeno, que pode ou não
   *  afetar o negócio), o sistema NÃO inventa cláusula. Em vez disso,
   *  sugere caminhos de clarificação que o usuário deve tomar antes de
   *  decidir como tratar. UI mostra como lista de ações com checkbox.
   *  Editor que recebe finding com clarification_paths populado emite
   *  `add_comment` listando os caminhos — NÃO chama `propose_suggestion`. */
  clarification_paths?: string[];
  /** Quando há ação manual recomendada (abrir portal oficial, atualizar
   *  matrícula, etc) — UI mostra como CTA. */
  manual_action?: { label: string; url?: string };
  /** Audit pointer pro CertidaoJob.id de origem. */
  jobId?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Shape dos jobs lidos pelo handler — subset de `CertidaoJob` que importa.
// ────────────────────────────────────────────────────────────────────────

export interface CertidaoJobLite {
  id: string;
  endpoint: string;
  label: string;
  targetKind: "vendedor" | "comprador" | "imovel" | "diligenciado" | string;
  targetIndex: number;
  status: string;
  resultCode: number | null;
  resultData: Prisma.JsonValue | null;
  errorMessage: string | null;
  finishedAt: Date | null;
  /** Caminho do anexo do PDF emitido (quando emitido). */
  attachmentId: string | null;
}

export interface CrossCheckInput {
  contractDataJson: Record<string, unknown>;
  jobs: CertidaoJobLite[];
  /** Hoje (injetável pra teste determinístico). */
  now?: Date;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function getEndpoint(id: string): EndpointInfo | undefined {
  return ENDPOINTS[id];
}

function asResult(json: Prisma.JsonValue | null): NormalizedResult | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  return json as unknown as NormalizedResult;
}

function targetLabel(kind: string, index: number, data: Record<string, unknown>): string {
  if (kind === "vendedor") {
    const v = (data.vendedores as Array<Record<string, unknown>> | undefined)?.[index];
    const nome = v?.nome ?? v?.razao_social ?? `vendedor ${index + 1}`;
    return `Vendedor ${index + 1} (${nome})`;
  }
  if (kind === "comprador") {
    const c = (data.compradores as Array<Record<string, unknown>> | undefined)?.[index];
    const nome = c?.nome ?? c?.razao_social ?? `comprador ${index + 1}`;
    return `Comprador ${index + 1} (${nome})`;
  }
  if (kind === "imovel") {
    const i = (data.imoveis as Array<Record<string, unknown>> | undefined)?.[index];
    const rua = i?.rua ? `${i.rua}, ${i.numero ?? "s/n"}` : `imóvel ${index + 1}`;
    return `Imóvel ${index + 1} (${rua})`;
  }
  return `${kind} ${index + 1}`;
}

function isPositive(result: NormalizedResult | null): boolean {
  if (!result) return false;
  return (
    result.situacao === "positiva" ||
    result.situacao === "positiva_com_efeitos" ||
    result.situacao === "com_restricao" ||
    result.consta_debito === true
  );
}

function isMatriculaEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("registradores/matric-");
}

const MATRICULA_VALIDITY_DAYS = 30;

// ────────────────────────────────────────────────────────────────────────
// Regras de detecção
// ────────────────────────────────────────────────────────────────────────

function checkMatricula(input: CrossCheckInput): CrossCheckFinding[] {
  const findings: CrossCheckFinding[] = [];
  const now = input.now ?? new Date();
  const imoveis = (input.contractDataJson.imoveis as Array<Record<string, unknown>> | undefined) ?? [];

  for (let i = 0; i < imoveis.length; i++) {
    const matriculaJobs = input.jobs.filter(
      (j) => j.targetKind === "imovel" && j.targetIndex === i && isMatriculaEndpoint(j.endpoint)
    );
    const successful = matriculaJobs.find((j) => j.status === "success");

    if (!successful) {
      const target = targetLabel("imovel", i, input.contractDataJson);
      findings.push({
        kind: "matricula_faltando",
        severity: "error",
        message: `${target}: certidão de matrícula atualizada ausente. Sem ela é impossível confirmar titularidade e existência de ônus reais.`,
        target,
        manual_action: {
          label: "Abrir portal ONR",
          url: "https://www.registradores.org.br/",
        },
        suggested_aditamento: `O VENDEDOR obriga-se a apresentar, em até 5 (cinco) dias úteis a contar da assinatura deste instrumento, certidão de inteiro teor atualizada da matrícula do IMÓVEL emitida pelo Cartório de Registro de Imóveis competente, na qual conste expressamente a inexistência de ônus reais, gravames, indisponibilidades ou ações em andamento. A não apresentação no prazo constitui condição resolutiva, restituindo ao COMPRADOR todos os valores pagos a título de sinal, sem prejuízo das perdas e danos eventualmente apurados (Código Civil, arts. 127, 474 e 475).`,
      });
      continue;
    }

    const result = asResult(successful.resultData);
    if (!result) continue;

    const raw = (result.raw as Record<string, unknown> | undefined) ?? {};
    const target = targetLabel("imovel", i, input.contractDataJson);

    // Ônus / penhora / indisponibilidade / alienação fiduciária
    const onusFlags: { key: string; label: string }[] = [
      { key: "tem_onus", label: "ônus reais" },
      { key: "ha_penhora", label: "penhora" },
      { key: "ha_indisponibilidade", label: "indisponibilidade" },
      { key: "ha_alienacao_fiduciaria", label: "alienação fiduciária" },
    ];
    const flagsAtivas = onusFlags.filter((f) => raw[f.key] === true).map((f) => f.label);

    if (flagsAtivas.length > 0) {
      findings.push({
        kind: "matricula_onus",
        severity: "error",
        message: `${target}: matrícula apresenta ${flagsAtivas.join(", ")}. ${result.detalhes ?? ""}`.trim(),
        target,
        endpoint: successful.endpoint,
        jobId: successful.id,
        suggested_aditamento: `Considerando que a matrícula do IMÓVEL registra ${flagsAtivas.join(", ")}, o VENDEDOR declara estar ciente e obriga-se, sob pena de rescisão automática e devolução em dobro do sinal recebido (CC art. 418), a quitar e providenciar o cancelamento de todos os gravames antes da lavratura da escritura pública definitiva. O COMPRADOR fica autorizado a reter, até a data da apresentação da matrícula totalmente livre e desembaraçada, valor equivalente ao débito apurado, mediante depósito judicial ou em conta vinculada conjunta.`,
      });
      continue;
    }

    // Vencimento — matrícula com mais de 30 dias é considerada desatualizada
    // pela maioria dos cartórios pra fins de escritura.
    const emissao = result.emissao;
    if (typeof emissao === "string" && emissao.length >= 10) {
      const parsed = parseBRDate(emissao);
      if (parsed) {
        const idadeDias = Math.floor((now.getTime() - parsed.getTime()) / 86_400_000);
        if (idadeDias > MATRICULA_VALIDITY_DAYS) {
          findings.push({
            kind: "matricula_vencida",
            severity: "warning",
            message: `${target}: matrícula emitida em ${emissao} (há ${idadeDias} dias). Cartórios costumam exigir matrícula com menos de 30 dias para lavratura de escritura.`,
            target,
            endpoint: successful.endpoint,
            jobId: successful.id,
            manual_action: {
              label: "Solicitar matrícula atualizada",
              url: "https://www.registradores.org.br/",
            },
            suggested_aditamento: `Caso a escritura definitiva não seja lavrada em até 25 (vinte e cinco) dias contados da assinatura deste instrumento, o VENDEDOR obriga-se a apresentar nova certidão de inteiro teor atualizada, sob pena de configurar inadimplemento contratual.`,
          });
        }
      }
    }
  }

  return findings;
}

function parseBRDate(s: string): Date | null {
  // Aceita "DD/MM/YYYY" e "YYYY-MM-DD"
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) {
    const [, d, m, y] = br;
    return new Date(Number(y), Number(m) - 1, Number(d), 12);
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return new Date(Number(y), Number(m) - 1, Number(d), 12);
  }
  return null;
}

function checkVendedoresPositivas(input: CrossCheckInput): CrossCheckFinding[] {
  const findings: CrossCheckFinding[] = [];
  const vendedoresJobs = input.jobs.filter((j) => j.targetKind === "vendedor");

  // Agrupa por (targetIndex, categoria do endpoint)
  for (const job of vendedoresJobs) {
    if (job.status !== "success") continue;
    const result = asResult(job.resultData);
    if (!result || !isPositive(result)) continue;

    const endpoint = getEndpoint(job.endpoint);
    if (!endpoint) continue;

    const target = targetLabel(job.targetKind, job.targetIndex, input.contractDataJson);

    switch (endpoint.category) {
      case "civel":
        // Cível é ambíguo por natureza — ação em curso pode ser desde uma
        // cobrança de R$ 500 até uma execução milionária. Sistema NÃO infere
        // gravidade: dá caminhos de clarificação ao invés de inventar
        // aditamento determinístico.
        findings.push({
          kind: "vendedor_civel_positiva",
          severity: "warning",
          message: `${target}: certidão cível "${job.label}" retornou POSITIVA (consta ações). ${result.detalhes ?? ""}`.trim(),
          target,
          endpoint: job.endpoint,
          jobId: job.id,
          clarification_paths: [
            "Solicite cópia integral do(s) processo(s) cível ao vendedor antes de prosseguir",
            "Verifique o valor da causa e o estágio processual — execuções avançadas geram risco de penhora superveniente",
            "Pergunte ao vendedor se há outros bens do mesmo titular que possam servir de garantia",
            "Considere cláusula de retenção do saldo em conta vinculada até a apresentação de carta de anuência ou baixa do processo",
            "Se valor da causa for relevante, consulte advogado sobre risco de evicção parcial (CC art. 447)",
          ],
        });
        break;
      case "trabalhista":
        findings.push({
          kind: "vendedor_trabalhista_positiva",
          severity: "warning",
          message: `${target}: certidão trabalhista "${job.label}" positiva. ${result.detalhes ?? ""}`.trim(),
          target,
          endpoint: job.endpoint,
          jobId: job.id,
          suggested_aditamento: `Considerando que o VENDEDOR possui registro positivo em certidão trabalhista (${job.label}), as partes acordam que, na hipótese de penhora trabalhista superveniente sobre o IMÓVEL antes do registro da escritura, o VENDEDOR responderá pela evicção integral, devolvendo ao COMPRADOR todos os valores pagos acrescidos de perdas e danos.`,
        });
        break;
      case "fiscal":
      case "federal":
        findings.push({
          kind: "vendedor_fiscal_positiva",
          severity: "error",
          message: `${target}: certidão fiscal/federal "${job.label}" positiva — dívida ativa pode gerar penhora. ${result.detalhes ?? ""}`.trim(),
          target,
          endpoint: job.endpoint,
          jobId: job.id,
          suggested_aditamento: `O VENDEDOR reconhece a existência de débitos fiscais (${job.label}) e obriga-se a quitá-los antes da lavratura da escritura pública definitiva, apresentando ao COMPRADOR comprovante de regularização. O não cumprimento dentro do prazo de 30 (trinta) dias após a assinatura deste instrumento configura inadimplemento (CC art. 475), facultando ao COMPRADOR optar pela rescisão com devolução em dobro do sinal (CC art. 418) ou pela quitação direta do débito com retenção do valor correspondente do preço total.`,
        });
        break;
      case "protesto":
        findings.push({
          kind: "protesto_vendedor",
          severity: "warning",
          message: `${target}: protesto detectado em "${job.label}". ${result.detalhes ?? ""}`.trim(),
          target,
          endpoint: job.endpoint,
          jobId: job.id,
          suggested_aditamento: `Constatado protesto em nome do VENDEDOR (${job.label}), as partes pactuam que o COMPRADOR poderá reter, do saldo a quitar, valor equivalente ao montante protestado, depositando-o em conta vinculada conjunta até a apresentação da carta de anuência ou comprovante de regularização.`,
        });
        break;
      case "fgts":
        findings.push({
          kind: "fgts_pendente",
          severity: "warning",
          message: `${target}: CRF FGTS irregular. ${result.detalhes ?? ""}`.trim(),
          target,
          endpoint: job.endpoint,
          jobId: job.id,
          suggested_aditamento: `O VENDEDOR (PJ) declara a existência de irregularidade no CRF FGTS e compromete-se a regularizar a situação antes da lavratura da escritura, sob pena de o COMPRADOR optar pela rescisão sem penalidade.`,
        });
        break;
      default:
        break;
    }
  }

  return findings;
}

function checkAntecedentes(input: CrossCheckInput): CrossCheckFinding[] {
  const findings: CrossCheckFinding[] = [];
  for (const job of input.jobs) {
    if (job.status !== "success") continue;
    if (!job.endpoint.startsWith("antecedentes-criminais-pf/")) continue;
    const result = asResult(job.resultData);
    if (!result || !isPositive(result)) continue;
    const target = targetLabel(job.targetKind, job.targetIndex, input.contractDataJson);
    // Antecedentes também é ambíguo — pode ser contravenção leve antiga até
    // crime que envolve perdimento de bens. Caminho de clarificação.
    findings.push({
      kind: "vendedor_antecedentes_positiva",
      severity: "warning",
      message: `${target}: antecedentes criminais com registros. Verificar natureza para avaliar risco de constrição patrimonial. ${result.detalhes ?? ""}`.trim(),
      target,
      endpoint: job.endpoint,
      jobId: job.id,
      clarification_paths: [
        "Solicite ao vendedor cópia da folha de antecedentes detalhada ou consulta direta na origem (Polícia Federal/Civil)",
        "Verifique se há condenação transitada em julgado envolvendo perdimento de bens (Lei 9.613/98 ou Lei 11.343/06)",
        "Pergunte se há processo penal em andamento com pedido de medida assecuratória sobre o patrimônio",
        "Se confirmada existência de medida constritiva, considere distrato em vez de aditamento — risco de invalidação posterior do negócio",
      ],
    });
  }
  return findings;
}

function checkIptu(input: CrossCheckInput): CrossCheckFinding[] {
  const findings: CrossCheckFinding[] = [];
  for (const job of input.jobs) {
    if (job.status !== "success") continue;
    if (job.targetKind !== "imovel") continue;
    const endpoint = getEndpoint(job.endpoint);
    if (!endpoint) continue;
    if (endpoint.category !== "municipal") continue;
    const result = asResult(job.resultData);
    if (!result || !isPositive(result)) continue;
    const target = targetLabel("imovel", job.targetIndex, input.contractDataJson);
    findings.push({
      kind: "imovel_iptu_pendente",
      severity: "error",
      message: `${target}: ${job.label} positiva — débitos municipais sobre o imóvel. ${result.detalhes ?? ""}`.trim(),
      target,
      endpoint: job.endpoint,
      jobId: job.id,
      suggested_aditamento: `O VENDEDOR obriga-se a quitar integralmente os débitos municipais incidentes sobre o IMÓVEL (IPTU, taxas e tributos municipais) anteriores à imissão de posse, apresentando ao COMPRADOR a respectiva certidão negativa antes da escritura definitiva. Eventuais débitos não declarados e descobertos após a transmissão da propriedade serão de responsabilidade exclusiva do VENDEDOR, com direito de regresso pelo COMPRADOR (CC arts. 502 e 503).`,
    });
  }
  return findings;
}

function checkFailedPortalManual(input: CrossCheckInput): CrossCheckFinding[] {
  const findings: CrossCheckFinding[] = [];
  for (const job of input.jobs) {
    if (job.status !== "failed") continue;
    const endpoint = getEndpoint(job.endpoint);
    if (!endpoint?.portalUrl) continue;
    const target = targetLabel(job.targetKind, job.targetIndex, input.contractDataJson);
    findings.push({
      kind: "certidao_falhou_portal_manual",
      severity: "info",
      message: `${target}: ${job.label} não foi emitida via API (${job.errorMessage ?? "falha persistente"}). Extração manual via portal oficial é necessária.`,
      target,
      endpoint: job.endpoint,
      jobId: job.id,
      manual_action: {
        label: `Abrir portal — ${endpoint.label}`,
        url: endpoint.portalUrl,
      },
    });
  }
  return findings;
}

// ────────────────────────────────────────────────────────────────────────
// Entrypoint
// ────────────────────────────────────────────────────────────────────────

export interface CrossCheckResult {
  findings: CrossCheckFinding[];
  summary: {
    total: number;
    bySeverity: Record<Severity, number>;
    byKind: Partial<Record<FindingKind, number>>;
    hasBlockingIssues: boolean;
  };
}

export function crossCheckCertidoes(input: CrossCheckInput): CrossCheckResult {
  const findings: CrossCheckFinding[] = [
    ...checkMatricula(input),
    ...checkVendedoresPositivas(input),
    ...checkAntecedentes(input),
    ...checkIptu(input),
    ...checkFailedPortalManual(input),
  ];

  const bySeverity: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const byKind: Partial<Record<FindingKind, number>> = {};
  for (const f of findings) {
    bySeverity[f.severity]++;
    byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  }

  return {
    findings,
    summary: {
      total: findings.length,
      bySeverity,
      byKind,
      hasBlockingIssues: bySeverity.error > 0,
    },
  };
}
