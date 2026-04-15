import { endpointInfo, TJRS_TIPOS } from "./endpoints";
import { comarcaForCidade } from "./comarcas-rj";
import type {
  ExtractionPlan,
  MissingField,
  PlannedJob,
  SkippedJob,
  TargetKind,
} from "./types";

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

export function planCertidoesForDeal(
  dealData: DealDataLike | null | undefined,
  dealEmail?: string
): ExtractionPlan {
  const data = dealData ?? {};
  const jobs: PlannedJob[] = [];
  const skipped: SkippedJob[] = [];
  const email = dealEmail || DEFAULT_EMAIL;

  const pessoas: Array<{ kind: TargetKind; index: number; parte: Parte }> = [];
  (data.vendedores ?? []).forEach((p, i) =>
    pessoas.push({ kind: "vendedor", index: i, parte: p })
  );
  (data.compradores ?? []).forEach((p, i) =>
    pessoas.push({ kind: "comprador", index: i, parte: p })
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

    // ---- CEAT (Trabalhista regional) ----
    // baseado em UF da parte: SP -> TRT2 + TRT15; RJ -> TRT1; RS -> TRT4
    if (partyUf === "SP" || partyUf === "") {
      // TRT2 fisico
      {
        const ep = "tribunal/trt2/ceat";
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
      // TRT2 digital (usa cnpj_raiz)
      {
        const ep = "tribunal/trt2/ceat-digital";
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
      }
      // TRT15 (interior)
      {
        const ep = "tribunal/trt15/ceat";
        jobs.push(
          buildJob(ep, kind, index, label, {
            nome: label,
            ...(isPJ ? { cnpj } : cpf ? { cpf } : {}),
          })
        );
      }
    } else if (partyUf === "RJ") {
      const ep = "tribunal/trt1/ceat";
      if (isPJ && !cnpj) {
        skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
      } else if (!isPJ && !cpf) {
        skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
      } else {
        jobs.push(buildJob(ep, kind, index, label, isPJ ? { cnpj } : { cpf }));
      }
    } else if (partyUf === "RS") {
      const ep = "tribunal/trt4/ceat";
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

  // ---- Imoveis: cenprot + TJ + IPTU ----
  const imoveis = data.imoveis ?? [];
  for (let i = 0; i < imoveis.length; i++) {
    const im = imoveis[i];
    const imLabel = im.rua ? `${im.rua}${im.cidade ? `, ${im.cidade}` : ""}` : `Imovel ${i + 1}`;
    const imUf = uf(im);

    // For estadual TJ: use the FIRST vendedor/comprador's CPF/CNPJ (standard practice is per-parte).
    // Generate one TJ job per parte at this imovel's UF.
    if (imUf === "SP") {
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
    } else if (imUf === "RJ") {
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
    } else if (imUf === "RS") {
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

  // ---- TJ estadual por parte (segue UF da parte) ----
  for (const { kind, index, parte } of pessoas) {
    const partyUf = uf(parte);
    const label = personLabel(parte);
    const isPJ = parte.tipo_pessoa === "juridica";
    const cpf = normalizeCpf(parte.cpf);
    const cnpj = normalizeCnpj(parte.cnpj);

    if (partyUf === "SP") {
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
    } else if (partyUf === "RJ") {
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
    } else if (partyUf === "RS") {
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
    kind === "imovel" ? `imoveis.${index}` : `${kind}es.${index}`;
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
