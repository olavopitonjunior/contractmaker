import { endpointInfo, TJRS_TIPOS } from "./endpoints";
import { comarcaForCidade } from "./comarcas-rj";
import type {
  ExtractionPlan,
  MissingField,
  PlannedJob,
  SkippedJob,
  TargetKind,
} from "./types";

/**
 * Phase B — declarative routing table: UF → civil endpoint on the TJ.
 * When a UF has multiple endpoints (TJSP 2-step, TJMS 2-step, TJRS 5 types),
 * the handler branch in the main loop handles those special cases; this
 * table only covers "simple" 1-etapa endpoints for the other TJs.
 *
 * UFs absent from this table fall back to "no TJ coverage" — planner emits
 * a SkippedJob so the due-diligence report lists it as manual pending.
 */
const CIVIL_ENDPOINT_BY_UF: Partial<Record<string, string>> = {
  BA: "tribunal/tjba/primeiro-grau",
  GO: "tribunal/tjgo/nada-consta",
  DF: "tribunal/tjdf/nada-consta",
  SC: "tribunal/tjsc/pedido-certidao",
  MT: "tribunal/tjmt/primeiro-grau-pf", // PF only — handler checks
};

/**
 * Phase B — UF → TRT regional for CEAT (Certidão Eletrônica de Ações
 * Trabalhistas). Each TRT covers 1-4 UFs. Only UFs where Infosimples has a
 * CEAT endpoint are listed.
 */
const CEAT_ENDPOINT_BY_UF: Partial<Record<string, string[]>> = {
  SP: ["tribunal/trt2/ceat", "tribunal/trt2/ceat-digital", "tribunal/trt15/ceat"],
  RJ: ["tribunal/trt1/ceat"],
  RS: ["tribunal/trt4/ceat"],
  MG: ["tribunal/trt3/ceat"],
  BA: ["tribunal/trt5/ceat"],
  PR: ["tribunal/trt9/ceat"],
  DF: ["tribunal/trt10/ceat", "tribunal/trt10/ceat-digital"],
  TO: ["tribunal/trt10/ceat", "tribunal/trt10/ceat-digital"],
  SC: ["tribunal/trt12/ceat"],
};

/**
 * Phase B — State debt (CND Estadual / Dívida Ativa PGE). Default to the
 * unified Sefaz endpoint that covers all 27 UFs, swapping to SP-specific
 * when available (cheaper + richer response).
 */
function stateDebtEndpointForUf(partyUf: string): string {
  // I.3 (Phase I, 2026-04-18) — `pge-sp/cndt` retornou code 602
  // ("serviço inválido") em 100% dos casos no QA 2026-04-18. Endpoint
  // depreciado pela Infosimples. Fallback para sefaz unificado que cobre
  // SP também. Quando provider confirmar nova URL, reativar.
  void partyUf;
  return "sefaz/certidao-debitos";
}

/**
 * Phase F.II-γ — UF → TRF individual (cível + criminal). Cobre 1ª e 2ª
 * instâncias da Justiça Federal regional. Usado em adição à `trf/cert-unificada`
 * (que só cobre cível 1ª instância dos 6 TRFs).
 */
const TRF_UF_MAP: Partial<Record<string, string>> = {
  AC: "tribunal/trf1/certidao",
  AM: "tribunal/trf1/certidao",
  AP: "tribunal/trf1/certidao",
  BA: "tribunal/trf1/certidao",
  DF: "tribunal/trf1/certidao",
  GO: "tribunal/trf1/certidao",
  MA: "tribunal/trf1/certidao",
  MT: "tribunal/trf1/certidao",
  PA: "tribunal/trf1/certidao",
  PI: "tribunal/trf1/certidao",
  RO: "tribunal/trf1/certidao",
  RR: "tribunal/trf1/certidao",
  TO: "tribunal/trf1/certidao",
  RJ: "tribunal/trf2/certidao",
  ES: "tribunal/trf2/certidao",
  SP: "tribunal/trf3/certidao",
  MS: "tribunal/trf3/certidao",
  RS: "tribunal/trf4/certidao",
  SC: "tribunal/trf4/certidao",
  PR: "tribunal/trf4/certidao",
  AL: "tribunal/trf5/certidao",
  CE: "tribunal/trf5/certidao",
  PB: "tribunal/trf5/certidao",
  PE: "tribunal/trf5/certidao",
  RN: "tribunal/trf5/certidao",
  SE: "tribunal/trf5/certidao",
  MG: "tribunal/trf6/certidao",
};

/**
 * Phase F.II-γ — múltiplos `tipo_certidao` do TJSP e TJRJ que cobrem os
 * distribuidores exigidos em transação imobiliária (cível, família, falência,
 * execução fiscal). Cada um é uma chamada separada.
 */
// I.1 (Phase I, 2026-04-18) — Infosimples TJSP pedido-civel rejeitava
// "familia-sucessoes" retornando code 606 em 16/16 jobs no QA 2026-04-18.
// Docs oficiais mostram os valores canônicos: civel, familia, falencia,
// execucao-fiscal (familia sem hífen composto).
const TJSP_TIPOS: Array<{ tipo_certidao: string; label: string }> = [
  { tipo_certidao: "civel", label: "Cível" },
  { tipo_certidao: "familia", label: "Família e Sucessões" },
  { tipo_certidao: "falencia", label: "Falência / Concordata / Rec. Judicial" },
  { tipo_certidao: "execucao-fiscal", label: "Execução Fiscal" },
];

const TJRJ_TIPOS: Array<{ tipo_certidao: string; label: string }> = [
  { tipo_certidao: "civel", label: "Cível" },
  { tipo_certidao: "familia", label: "Família e Sucessões" },
  { tipo_certidao: "falencia", label: "Falência / Concordata / Rec. Judicial" },
  { tipo_certidao: "execucao-fiscal", label: "Execução Fiscal" },
];

// ---- deal shape helpers (mirror of DadosContrato) -----------------

interface Parte {
  tipo_pessoa?: "fisica" | "juridica";
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  data_nascimento?: string;
  // H.3 (Phase H, 2026-04-18) — nome da mãe é requerido pelo TJSP pedido-cível
  // para alguns tipos (código 606 "parâmetros obrigatórios" em 100% dos jobs PF
  // sem esse campo). OCR do RG traz `filiacao`/`mae` quando disponível.
  nome_mae?: string;
  email?: string;
  uf?: string;
  cidade?: string;
}

interface Imovel {
  rua?: string;
  cidade?: string;
  uf?: string;
  matricula?: string;
  inscricao_iptu?: string;
  sql?: string;
  inscricao_municipal?: string;
}

interface DealDataLike {
  vendedores?: Parte[];
  compradores?: Parte[];
  imoveis?: Imovel[];
  // Phase K — modalidade da transação influencia quais certidões extras
  // disparam (ex: antecedentes criminais obrigatórios em financiamento).
  modalidade?: "a_vista" | "financiamento" | string;
}

// -------------------------------------------------------------------

const DEFAULT_FINALIDADE = "Instrucao de compra e venda de imovel";
const DEFAULT_EMAIL = "contato@contractmaker.com.br";

function onlyDigits(s: string | undefined | null): string {
  return typeof s === "string" ? s.replace(/\D/g, "") : "";
}

function normalizeCpf(cpf: string | undefined | null): string | null {
  const digits = onlyDigits(cpf);
  return digits.length === 11 ? digits : null;
}

function normalizeCnpj(cnpj: string | undefined | null): string | null {
  const digits = onlyDigits(cnpj);
  return digits.length === 14 ? digits : null;
}

function normalizeDate(d: string | undefined | null): string | null {
  if (!d) return null;
  // Accept "YYYY-MM-DD" or "DD/MM/YYYY"
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const br = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

function personLabel(p: Parte): string {
  // Phase F.IV — prioriza razao_social quando tipo_pessoa=juridica para
  // evitar que o nome residual do OCR de RG (PF) vaze para label de PJ
  if (p.tipo_pessoa === "juridica") {
    return p.razao_social || p.nome || "PJ sem razão social";
  }
  return p.nome || p.razao_social || "Sem nome";
}

function uf(p: Parte | Imovel | undefined): string {
  return (p?.uf || "").trim().toUpperCase();
}

// -------------------------------------------------------------------

/**
 * F3: shape of a DiligentedPerson row as passed into the planner. Matches the
 * Prisma model but intentionally loose so tests can build fixtures without
 * loading Prisma. The route handler that reads from DB maps the fields.
 */
export interface DiligentedPersonInput {
  id?: string;
  tipoPessoa: "fisica" | "juridica";
  nome: string;
  cpf?: string | null;
  cnpj?: string | null;
  dataNascimento?: string | null;
  uf?: string | null;
  cidade?: string | null;
}

function diligenciadoToParte(d: DiligentedPersonInput): Parte {
  return {
    tipo_pessoa: d.tipoPessoa,
    nome: d.nome,
    cpf: d.cpf ?? undefined,
    cnpj: d.cnpj ?? undefined,
    data_nascimento: d.dataNascimento ?? undefined,
    uf: d.uf ?? undefined,
    cidade: d.cidade ?? undefined,
  };
}

/**
 * F1/F2: options for the planner.
 *   - `expandAll`: when true, generate jobs for endpoints in ALL UFs (not just
 *     the party/imovel's own UF). Used by the POST /certidoes route so the
 *     user can select "extras" from the picker — e.g. a SP vendedor can opt
 *     into TJRJ civel if wanted. The default plan (expandAll=false) preserves
 *     the R5 behavior: only matched-UF endpoints are auto-suggested.
 */
export interface PlannerOptions {
  expandAll?: boolean;
  /**
   * Phase F.II-γ — resultado do pre-flight GOV.BR (checkGovBrAuth).
   * Se `true`, endpoints com `requiresGovBrAuth` disparam normalmente.
   * Se `false` ou `undefined`, esses endpoints viram SkippedJob com
   * razão clara para o usuário renovar auth em Settings.
   */
  govBrActive?: boolean;
}

export function planCertidoesForDeal(
  dealData: DealDataLike | null | undefined,
  dealEmail?: string,
  diligenciados?: DiligentedPersonInput[] | null,
  options?: PlannerOptions
): ExtractionPlan {
  const data = dealData ?? {};
  const jobs: PlannedJob[] = [];
  const skipped: SkippedJob[] = [];
  const email = dealEmail || DEFAULT_EMAIL;
  const expandAll = options?.expandAll === true;
  const govBrActive = options?.govBrActive === true;

  const pessoas: Array<{ kind: TargetKind; index: number; parte: Parte }> = [];
  (data.vendedores ?? []).forEach((p, i) =>
    pessoas.push({ kind: "vendedor", index: i, parte: p })
  );
  (data.compradores ?? []).forEach((p, i) =>
    pessoas.push({ kind: "comprador", index: i, parte: p })
  );
  // F3: diligenciados are treated like partes for personal certidões
  (diligenciados ?? []).forEach((d, i) =>
    pessoas.push({ kind: "diligenciado", index: i, parte: diligenciadoToParte(d) })
  );

  // Phase K (2026-04-18) — flag para ativar certidões extras quando a
  // transação é financiamento bancário (Mapeamento 2.1.4: antecedentes PF
  // obrigatório em financiamento, facultativo em particular).
  const isFinanciamento = data.modalidade === "financiamento";

  for (const { kind, index, parte } of pessoas) {
    const isPJ = parte.tipo_pessoa === "juridica";
    const label = personLabel(parte);
    const cpf = normalizeCpf(parte.cpf);
    const cnpj = normalizeCnpj(parte.cnpj);
    const partyUf = uf(parte);

    // ---- CPF situação cadastral (Phase K, Mapeamento 2.1.5) ----
    // Filtro inicial obrigatório para toda PF. CPF irregular bloqueia
    // minuta inteira. Endpoint informativo (retorna JSON, não PDF).
    if (!isPJ) {
      const ep = "receita-federal/cpf";
      if (!cpf) {
        skipped.push(
          buildSkip(ep, kind, index, label, "cpf", "CPF inválido ou vazio")
        );
      } else {
        const birthdate = normalizeDate(parte.data_nascimento);
        const payload: Record<string, unknown> = { cpf };
        if (birthdate) payload.birthdate = birthdate;
        jobs.push(buildJob(ep, kind, index, label, payload));
      }
    }

    // ---- Antecedentes Criminais PF (Phase K, Mapeamento 2.1.4) ----
    // Opcional em transação entre particulares; obrigatório em financiamento.
    // Dispara apenas para PF quando `deal.modalidade === "financiamento"`.
    if (!isPJ && isFinanciamento) {
      const ep = "antecedentes-criminais-pf/emit";
      if (!cpf) {
        skipped.push(
          buildSkip(ep, kind, index, label, "cpf", "CPF inválido")
        );
      } else {
        const birthdate = normalizeDate(parte.data_nascimento);
        const nomeMae =
          typeof parte.nome_mae === "string" && parte.nome_mae.trim()
            ? parte.nome_mae.trim()
            : null;
        if (!birthdate || !nomeMae) {
          // PF antecedentes costuma exigir data_nascimento + nome_mae
          const missing: string[] = [];
          if (!birthdate) missing.push("data_nascimento");
          if (!nomeMae) missing.push("nome_mae");
          skipped.push(
            buildSkip(
              ep,
              kind,
              index,
              label,
              missing[0] ?? "nome_mae",
              `Antecedentes PF exige ${missing.join(" + ")} — complete os dados da parte`
            )
          );
        } else {
          jobs.push(
            buildJob(ep, kind, index, label, {
              cpf,
              nome: label,
              data_nascimento: birthdate,
              nome_mae: nomeMae,
            })
          );
        }
      }
    }

    // ---- PGFN CND Federal ----
    {
      const ep = "receita-federal/pgfn";
      if (isPJ) {
        if (!cnpj) {
          skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido ou vazio"));
        } else {
          jobs.push(buildJob(ep, kind, index, label, { cnpj, preferencia_emissao: "2via" }));
        }
      } else {
        if (!cpf) {
          skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido ou vazio"));
        } else {
          const birthdate = normalizeDate(parte.data_nascimento);
          if (!birthdate) {
            skipped.push(
              buildSkip(
                ep,
                kind,
                index,
                label,
                "data_nascimento",
                "PGFN exige data de nascimento da pessoa fisica"
              )
            );
          } else {
            jobs.push(
              buildJob(ep, kind, index, label, {
                cpf,
                birthdate,
                preferencia_emissao: "2via",
              })
            );
          }
        }
      }
    }

    // ---- CNDT ----
    {
      const ep = "tribunal/tst/cndt";
      if (isPJ && !cnpj) {
        skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
      } else if (!isPJ && !cpf) {
        skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
      } else {
        jobs.push(
          buildJob(ep, kind, index, label, isPJ ? { cnpj } : { cpf })
        );
      }
    }

    // ---- TRF Cert Unificada + TRF Individual ----
    // J.1 (Phase J, 2026-04-18) — reverte I.4 skip default. Princípio:
    // TODA certidão solicitada é tentada. Falhas transitórias (600/615) são
    // retry automático pelo cron. Falha permanente (602 deprecated) vira
    // `failed_permanent` com `portalUrl` para extração manual.
    // `trf/cert-unificada` não emite PDF (retorna JSON agregado dos 6 TRFs)
    // — sai de CATEGORIES_REQUIRING_PDF (ver endpoints.ts).
    {
      const ep = "tribunal/trf/cert-unificada";
      if (isPJ && !cnpj) {
        skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
      } else if (!isPJ && !cpf) {
        skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
      } else {
        jobs.push(
          buildJob(ep, kind, index, label, {
            tipo: 1,
            email,
            ...(isPJ ? { cnpj } : { cpf }),
          })
        );
      }
    }

    // TRF regional individual (trf{1-6}/certidao) — retorna PDF.
    // Code 602 (deprecated) do QA será capturado pelo executor como
    // `failed_permanent` com `portalUrl` pro portal oficial do TRF.
    if (partyUf && TRF_UF_MAP[partyUf]) {
      const ep = TRF_UF_MAP[partyUf]!;
      if (isPJ && !cnpj) {
        skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
      } else if (!isPJ && !cpf) {
        skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
      } else {
        jobs.push(
          buildJob(ep, kind, index, label, {
            email,
            ...(isPJ ? { cnpj } : { cpf }),
          })
        );
      }
    }

    // ---- CEAT (Trabalhista regional, Phase B) ----
    // Rota declarativa por UF. Em expandAll, dispara todas as UFs cobertas.
    // UF vazia no match natural cai em SP como default histórico (era o
    // comportamento anterior para partes sem UF declarada).
    const ceatUfsToDispatch: string[] = expandAll
      ? Object.keys(CEAT_ENDPOINT_BY_UF)
      : partyUf && CEAT_ENDPOINT_BY_UF[partyUf]
      ? [partyUf]
      : !partyUf
      ? ["SP"]
      : [];

    for (const targetUf of ceatUfsToDispatch) {
      const endpointsList = CEAT_ENDPOINT_BY_UF[targetUf] ?? [];
      for (const ep of endpointsList) {
        // TRT2 digital é o único que aceita cnpj_raiz (truncado 8 dígitos).
        if (ep === "tribunal/trt2/ceat-digital") {
          if (isPJ) {
            if (!cnpj) {
              skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
            } else {
              jobs.push(buildJob(ep, kind, index, label, { cnpj_raiz: cnpj.slice(0, 8) }));
            }
          } else if (!cpf) {
            skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
          } else {
            jobs.push(buildJob(ep, kind, index, label, { cpf }));
          }
          continue;
        }
        // Todos os demais CEATs usam { nome?, cpf | cnpj }.
        if (isPJ && !cnpj) {
          skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
        } else if (!isPJ && !cpf) {
          skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
        } else {
          jobs.push(
            buildJob(ep, kind, index, label, {
              nome: label,
              ...(isPJ ? { cnpj } : { cpf }),
            })
          );
        }
      }
    }

    // Se a UF da parte não tem cobertura CEAT na Infosimples, registrar skip
    // explicativo (relatório de due diligence lista como pendência manual).
    if (!expandAll && partyUf && !CEAT_ENDPOINT_BY_UF[partyUf]) {
      skipped.push(
        buildSkip(
          "tribunal/trt-manual",
          kind,
          index,
          label,
          "cobertura",
          `TRT da UF ${partyUf} sem cobertura Infosimples — extrair manualmente no portal do TRT da região`
        )
      );
    }

    // ---- CND Estadual / Dívida Ativa PGE (Phase B) ----
    // Unificado via sefaz/certidao-debitos; SP usa endpoint dedicado.
    if (partyUf) {
      const stateEp = stateDebtEndpointForUf(partyUf);
      if (isPJ && !cnpj) {
        skipped.push(buildSkip(stateEp, kind, index, label, "cnpj", "CNPJ invalido"));
      } else if (!isPJ && !cpf) {
        skipped.push(buildSkip(stateEp, kind, index, label, "cpf", "CPF invalido"));
      } else {
        const args: Record<string, unknown> = isPJ ? { cnpj } : { cpf };
        // SEFAZ unificada exige UF; SP-específico não precisa.
        if (stateEp === "sefaz/certidao-debitos") args.uf = partyUf;
        jobs.push(buildJob(stateEp, kind, index, label, args));
      }
    } else if (!expandAll) {
      skipped.push(
        buildSkip(
          "sefaz/certidao-debitos",
          kind,
          index,
          label,
          "uf",
          "CND Estadual exige UF da parte"
        )
      );
    }

    // ---- PJ-only: Cartão CNPJ + CRF FGTS (Phase B) ----
    // Sempre disparar para PJ (sem custo-benefício em skip).
    if (isPJ && cnpj) {
      jobs.push(buildJob("receita-federal/cnpj", kind, index, label, { cnpj }));
      jobs.push(buildJob("caixa/regularidade", kind, index, label, { cnpj }));
    }

    // ---- CENPROT SP (Phase F.II-α) — remapeado de imóvel para pessoa ----
    // Consulta por CPF/CNPJ da própria parte. Só dispara quando UF=SP (única
    // cobertura Infosimples sem GOV.BR).
    // H.4 (Phase H, 2026-04-18): adicionado `uf: "SP"` no payload — portal
    // CENPROT exige location hint; sem ele, code 612/605 em ~75% dos casos.
    const cenprotShould = expandAll || partyUf === "SP";
    if (cenprotShould && (cpf || cnpj)) {
      jobs.push(
        buildJob(
          "cenprot-sp/protestos",
          kind,
          index,
          label,
          { uf: "SP", ...(cnpj ? { cnpj } : { cpf: cpf! }) }
        )
      );
    }

    // ---- CENPROT Nacional (Phase F.II-γ) — exige GOV.BR ativo ----
    // Cobre todos os estados exceto detalhes SP (supre item A da lista oficial
    // para partes fora de SP). Se auth GOV.BR da conta Infosimples não estiver
    // ativa, registra SkippedJob com instrução clara ao admin.
    const nacionalNeeded = expandAll || (partyUf && partyUf !== "SP");
    if (nacionalNeeded && (cpf || cnpj)) {
      const ep = "ieptb/protestos";
      if (govBrActive) {
        jobs.push(
          buildJob(ep, kind, index, label, cnpj ? { cnpj } : { cpf: cpf! })
        );
      } else {
        skipped.push(
          buildSkip(
            ep,
            kind,
            index,
            label,
            "govbr",
            "CENPROT Nacional requer autenticação GOV.BR ativa na conta Infosimples. Configure em Settings → Certidões → GOV.BR."
          )
        );
      }
    }
  }

  // ---- Imóveis: REMOVIDOS em Phase F.II-α ----
  // Decisão 2026-04-16: não há certidões de imóvel neste momento (IPTU SP/RJ,
  // CND Municipal RJ removidos). CENPROT foi remapeado para pessoa (acima).
  // Endpoints permanecem no catálogo para futura re-ativação — planner só não
  // dispara mais. Users com imóvel no form não verão skips de IPTU.

  // ---- TJ estadual por parte (segue UF da parte, ou todas com expandAll) ----
  for (const { kind, index, parte } of pessoas) {
    const partyUf = uf(parte);
    const label = personLabel(parte);
    const isPJ = parte.tipo_pessoa === "juridica";
    const cpf = normalizeCpf(parte.cpf);
    const cnpj = normalizeCnpj(parte.cnpj);

    const tjShouldSP = expandAll || partyUf === "SP";
    const tjShouldRJ = expandAll || partyUf === "RJ";
    const tjShouldRS = expandAll || partyUf === "RS";

    if (tjShouldSP) {
      const ep = "tribunal/tjsp/pedido-civel";
      if ((!isPJ && !cpf) || (isPJ && !cnpj)) {
        skipped.push(
          buildSkip(ep, kind, index, label, isPJ ? "cnpj" : "cpf", "documento invalido")
        );
      } else if (!isPJ && !parte.data_nascimento) {
        // H.3 — TJSP exige data_nascimento para PF (code 606). Sem ela,
        // skip explícito ao invés de disparar e falhar em 100% dos jobs.
        skipped.push(
          buildSkip(
            ep,
            kind,
            index,
            label,
            "data_nascimento",
            "TJSP exige data de nascimento — complete os dados da parte"
          )
        );
      } else {
        // Phase F.II-γ — multi-tipo: uma chamada por tipo_certidao (cível,
        // família, falência, execução fiscal) para cobrir os 4 distribuidores
        // exigidos em transação imobiliária (Comunicado SPI nº 37 - 10 anos).
        for (const t of TJSP_TIPOS) {
          const base: Record<string, unknown> = {
            email,
            finalidade: DEFAULT_FINALIDADE,
            instancia: 1,
            tipo_certidao: t.tipo_certidao,
            ...(isPJ
              ? { cnpj: cnpj!, razao_social: label, pais: "Brasil" }
              : { cpf: cpf!, nome: label }),
          };
          // H.3 — adicionar campos de identificação quando disponíveis
          if (!isPJ) {
            const dob = normalizeDate(parte.data_nascimento);
            if (dob) base.data_nascimento = dob;
            if (parte.nome_mae) base.nome_mae = parte.nome_mae;
          }
          jobs.push(buildJob(ep, kind, index, `${label} - ${t.label}`, base));
        }

        // E-Proc SP 1ª e 2ª instâncias — Infosimples não emite. SkippedJob
        // com link externo para portal oficial (Phase F.II-γ).
        skipped.push({
          ...buildSkip(
            "tribunal/tjsp/eproc",
            kind,
            index,
            label,
            "cobertura",
            "E-Proc SP (1ª e 2ª instâncias) sem cobertura Infosimples — extrair no portal oficial com login GOV.BR"
          ),
          externalLink: "https://certidoes.tjsp.jus.br",
        });
      }
    }
    if (tjShouldRJ) {
      const ep = "tribunal/tjrj/pedido-cert";
      if ((!isPJ && !cpf) || (isPJ && !cnpj)) {
        skipped.push(
          buildSkip(ep, kind, index, label, isPJ ? "cnpj" : "cpf", "documento invalido")
        );
      } else {
        // Phase F.II-γ — multi-tipo TJRJ: cível, família, falência, execução fiscal
        const cidade = (parte.cidade || "").trim();
        const comarca = comarcaForCidade(cidade);
        for (const t of TJRJ_TIPOS) {
          const base: Record<string, unknown> = {
            nome: label,
            email,
            tipo_certidao: t.tipo_certidao,
            comarca,
            finalidade: DEFAULT_FINALIDADE,
            ...(isPJ ? { cnpj: cnpj! } : { cpf: cpf! }),
          };
          // H.3 — mesma política de TJSP: anexar data_nascimento/nome_mae para PF
          if (!isPJ) {
            const dob = normalizeDate(parte.data_nascimento);
            if (dob) base.data_nascimento = dob;
            if (parte.nome_mae) base.nome_mae = parte.nome_mae;
          }
          jobs.push(buildJob(ep, kind, index, `${label} - ${t.label}`, base));
        }
      }
    }
    if (tjShouldRS) {
      const ep = "tribunal/tjrs/primeiro-grau";
      if ((!isPJ && !cpf) || (isPJ && !cnpj)) {
        skipped.push(
          buildSkip(ep, kind, index, label, isPJ ? "cnpj" : "cpf", "documento invalido")
        );
      } else {
        for (const t of TJRS_TIPOS) {
          jobs.push(
            buildJob(ep, kind, index, `${label} - ${t.label}`, {
              tipo_certidao: t.tipo,
              nome: label,
              ...(isPJ ? { cnpj: cnpj! } : { cpf: cpf! }),
            })
          );
        }
      }
    }

    // Phase B — Cíveis adicionais (BA, GO, DF, SC, MS, MT). Usa tabela
    // declarativa CIVIL_ENDPOINT_BY_UF. Só dispara se a UF da parte está
    // coberta E não é SP/RJ/RS (tratados separadamente acima). Em expandAll,
    // dispara todas as UFs da tabela.
    const additionalUfsToTry: string[] = expandAll
      ? Object.keys(CIVIL_ENDPOINT_BY_UF)
      : partyUf && partyUf in CIVIL_ENDPOINT_BY_UF
      ? [partyUf]
      : [];

    for (const tjUf of additionalUfsToTry) {
      const ep = CIVIL_ENDPOINT_BY_UF[tjUf];
      if (!ep) continue;
      // TJMT aceita apenas PF.
      if (ep === "tribunal/tjmt/primeiro-grau-pf" && isPJ) {
        skipped.push(
          buildSkip(
            ep,
            kind,
            index,
            label,
            "tipo_pessoa",
            "TJMT não emite certidão para pessoa jurídica via Infosimples — extrair manualmente"
          )
        );
        continue;
      }
      if ((!isPJ && !cpf) || (isPJ && !cnpj)) {
        skipped.push(
          buildSkip(ep, kind, index, label, isPJ ? "cnpj" : "cpf", "documento invalido")
        );
        continue;
      }
      // TJMS é two-step (só dispara o pedido; obter roda via cron). Outros
      // TJs são single-step.
      const args: Record<string, unknown> = {
        email,
        nome_razao_social: label,
        nome: label,
        finalidade: DEFAULT_FINALIDADE,
        ...(isPJ ? { cnpj: cnpj! } : { cpf: cpf! }),
      };
      if (parte.data_nascimento && !isPJ) {
        args.birthdate = normalizeDate(parte.data_nascimento);
      }
      jobs.push(buildJob(ep, kind, index, label, args));
    }

    // Phase B — UFs sem cobertura cível Infosimples: MG, PR, ES + demais.
    // Registrar skip informativo somente se expandAll=false E UF não está em
    // nenhuma das trilhas cobertas (SP/RJ/RS/BA/GO/DF/SC/MS/MT).
    const hasCivilCoverage =
      ["SP", "RJ", "RS"].includes(partyUf) ||
      partyUf in CIVIL_ENDPOINT_BY_UF;
    if (!expandAll && partyUf && !hasCivilCoverage) {
      skipped.push(
        buildSkip(
          "tribunal/tj-manual",
          kind,
          index,
          label,
          "cobertura",
          `TJ da UF ${partyUf} sem cobertura Infosimples — extrair manualmente no portal TJ${partyUf}`
        )
      );
    }
  }

  const totalCostCents = jobs.reduce((acc, j) => acc + j.costCents, 0);
  return { jobs, skipped, totalCostCents };
}

// ---- builders -----------------------------------------------------

function buildJob(
  endpoint: string,
  kind: TargetKind,
  index: number,
  partyOrImmLabel: string,
  args: Record<string, unknown>
): PlannedJob {
  const info = endpointInfo(endpoint);
  return {
    endpoint,
    label: `${info.label} - ${partyOrImmLabel}`,
    targetKind: kind,
    targetIndex: index,
    requestPayload: args,
    costCents: info.costCents,
  };
}

function buildSkip(
  endpoint: string,
  kind: TargetKind,
  index: number,
  partyLabel: string,
  missingField: string,
  reason: string
): SkippedJob {
  const info = endpointInfo(endpoint);
  const basePath =
    kind === "imovel"
      ? `imoveis.${index}`
      : kind === "diligenciado"
      ? `diligenciados.${index}`
      : `${kind}es.${index}`;
  const missingFields: MissingField[] = buildMissingFieldsForSkip(
    missingField,
    basePath,
    partyLabel
  );
  return {
    endpoint,
    label: `${info.label} - ${partyLabel}`,
    targetKind: kind,
    targetIndex: index,
    reason,
    missingField,
    missingFields,
  };
}

/**
 * Maps the shorthand `missingField` string used inside the planner into
 * one or more `MissingField` structured entries for the complement-data UI.
 * Falls back to a single generic text field if no specific mapping exists.
 */
function buildMissingFieldsForSkip(
  missingField: string,
  basePath: string,
  partyLabel: string
): MissingField[] {
  switch (missingField) {
    case "data_nascimento":
      return [
        {
          path: `${basePath}.data_nascimento`,
          label: `Data de nascimento — ${partyLabel}`,
          type: "date",
          placeholder: "AAAA-MM-DD",
        },
      ];
    case "sql":
      return [
        {
          path: `${basePath}.sql`,
          label: `SQL (Setor-Quadra-Lote) — ${partyLabel}`,
          type: "text",
          placeholder: "000.000.0000-0",
        },
      ];
    case "inscricao_municipal":
      return [
        {
          path: `${basePath}.inscricao_municipal`,
          label: `Inscrição Municipal — ${partyLabel}`,
          type: "text",
          placeholder: "00000000",
        },
      ];
    case "matricula":
      return [
        {
          path: `${basePath}.matricula`,
          label: `Matrícula — ${partyLabel}`,
          type: "text",
          placeholder: "000000",
        },
      ];
    case "cidade":
      return [
        {
          path: `${basePath}.cidade`,
          label: `Cidade — ${partyLabel}`,
          type: "text",
          placeholder: "Nome da cidade",
        },
      ];
    default:
      return [
        {
          path: `${basePath}.${missingField}`,
          label: `${missingField} — ${partyLabel}`,
          type: "text",
        },
      ];
  }
}
