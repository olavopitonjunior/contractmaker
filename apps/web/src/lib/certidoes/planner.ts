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
  if (partyUf === "SP") return "pge-sp/cndt";
  return "sefaz/certidao-debitos";
}

// ---- deal shape helpers (mirror of DadosContrato) -----------------

interface Parte {
  tipo_pessoa?: "fisica" | "juridica";
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  data_nascimento?: string;
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

  for (const { kind, index, parte } of pessoas) {
    const isPJ = parte.tipo_pessoa === "juridica";
    const label = personLabel(parte);
    const cpf = normalizeCpf(parte.cpf);
    const cnpj = normalizeCnpj(parte.cnpj);
    const partyUf = uf(parte);

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

    // ---- TRF Cert Unificada (Civel = tipo 1) ----
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
  }

  // ---- Imoveis: cenprot + TJ + IPTU ----
  const imoveis = data.imoveis ?? [];
  for (let i = 0; i < imoveis.length; i++) {
    const im = imoveis[i];
    const imLabel = im.rua ? `${im.rua}${im.cidade ? `, ${im.cidade}` : ""}` : `Imovel ${i + 1}`;
    const imUf = uf(im);

    const imShouldSP = expandAll || imUf === "SP";
    const imShouldRJ = expandAll || imUf === "RJ";
    const imShouldRS = expandAll || imUf === "RS";

    if (imShouldSP) {
      // CENPROT SP
      const primeiroResponsavel = [...(data.vendedores ?? []), ...(data.compradores ?? [])][0];
      if (primeiroResponsavel) {
        const cpfImm = normalizeCpf(primeiroResponsavel.cpf);
        const cnpjImm = normalizeCnpj(primeiroResponsavel.cnpj);
        if (cpfImm || cnpjImm) {
          jobs.push(
            buildJob(
              "cenprot-sp/protestos",
              "imovel",
              i,
              `${imLabel} (responsavel: ${personLabel(primeiroResponsavel)})`,
              cnpjImm ? { cnpj: cnpjImm } : { cpf: cpfImm! }
            )
          );
        }
      }

      // IPTU SP
      if (!im.sql) {
        skipped.push(
          buildSkip(
            "pref/sp/sao-paulo/iptu",
            "imovel",
            i,
            imLabel,
            "sql",
            "IPTU SP exige SQL (Setor-Quadra-Lote) do imovel"
          )
        );
      } else {
        jobs.push(buildJob("pref/sp/sao-paulo/iptu", "imovel", i, imLabel, { sql: im.sql }));
      }
    }
    if (imShouldRJ) {
      if (!im.inscricao_municipal) {
        skipped.push(
          buildSkip(
            "pref/rj/rio-janeiro/cert-trib",
            "imovel",
            i,
            imLabel,
            "inscricao_municipal",
            "IPTU RJ exige Inscricao Municipal"
          )
        );
      } else {
        jobs.push(
          buildJob("pref/rj/rio-janeiro/cert-trib", "imovel", i, imLabel, {
            inscricao: im.inscricao_municipal,
          })
        );
        jobs.push(
          buildJob("pref/rj/rio-janeiro/cnd", "imovel", i, imLabel, {
            inscricao_municipal: im.inscricao_municipal,
            email,
          })
        );
      }
    }
    if (imShouldRS && !expandAll) {
      skipped.push(
        buildSkip(
          "pref/rs/porto-alegre/iptu",
          "imovel",
          i,
          imLabel,
          "cobertura",
          "IPTU POA sem cobertura Infosimples - extrair manualmente"
        )
      );
    }
  }

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
      } else {
        const base = {
          email,
          finalidade: DEFAULT_FINALIDADE,
          instancia: 1,
          ...(isPJ
            ? { cnpj: cnpj!, razao_social: label, pais: "Brasil" }
            : { cpf: cpf!, nome: label }),
        };
        jobs.push(buildJob(ep, kind, index, label, base));
      }
    }
    if (tjShouldRJ) {
      const ep = "tribunal/tjrj/pedido-cert";
      if ((!isPJ && !cpf) || (isPJ && !cnpj)) {
        skipped.push(
          buildSkip(ep, kind, index, label, isPJ ? "cnpj" : "cpf", "documento invalido")
        );
      } else {
        const cidade = (parte.cidade || "").trim();
        jobs.push(
          buildJob(ep, kind, index, label, {
            nome: label,
            email,
            tipo_certidao: "civel",
            comarca: comarcaForCidade(cidade),
            finalidade: DEFAULT_FINALIDADE,
            ...(isPJ ? { cnpj: cnpj! } : { cpf: cpf! }),
          })
        );
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
