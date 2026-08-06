import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { moveDealStage } from "@/lib/pipeline/move-stage";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import { uploadHtmlAsGoogleDoc } from "@/lib/google/upload-rendered-html";
import { copyContractGoogleDoc } from "@/lib/google/copy-doc";
import { shareDocWithOrgMembers } from "@/lib/google/share-org";
import { replacePlaceholdersInDoc } from "@/lib/google/replace-placeholders";
import { watchFile } from "@/lib/google/watch";
import {
  deriveDealMetadata,
  deriveLocacaoDealMetadata,
} from "@/lib/contracts/derive-deal-metadata";
import {
  selectTemplateForDeal,
  selectLocacaoTemplate,
  selectAdministracaoTemplate,
} from "@/lib/contracts/template-category";
import { resolveClauseSlots } from "@/lib/templates/clause-slots";
import { getPipelineByKind } from "@/lib/modules/resolve";
import {
  DEFAULT_CONTRACT_SETTINGS,
  type ContractSettings,
} from "@/lib/contracts/default-config";
import {
  loadOrgContractDefaults,
  loadOrgLocacaoDefaults,
} from "@/lib/contracts/org-defaults";
import { assertModuleEnabled } from "@/lib/modules/guard";
import { MODULE } from "@/lib/modules/catalog";
import { enrichLocacaoData, enrichAdministracaoData } from "@/lib/locacao/enrich";
import { createLeaseContractFromDataJson } from "@/lib/locacao/create-lease-contract";
import {
  MOMENTO_TEXTO,
  MEIO_PAGAMENTO_TEXTO,
  PIX_TIPO_CHAVE_LABELS,
  TIPO_CONTA_LABELS,
  BANCO_FINANCIAMENTO_LABELS,
  PAPEL_LABELS,
} from "@/lib/forms/payment-labels";
import { collectPartyFormatIssues } from "@/lib/forms/field-formats";
import { findMissingRequired, getByPath } from "@/lib/forms/party-required";
import { resolveAllRequiredFields } from "@/lib/forms/presets";
import {
  GoogleDocsGenerationError,
  googleDocsFailureMessage,
  rollbackFailedContract,
} from "@/lib/contracts/google-docs-failure";

interface GenerateResult {
  contractId: string;
  version: number;
  googleDocUrl?: string;
}


/**
 * Enriches form data with sensible defaults for template variables that
 * aren't captured in the wizard but are required by the contract
 * template (delivery deadlines, daily penalties, commission percentage, etc).
 *
 * 2026-05-16: pagamento.parcelas[] virou canônico com tipo/momento/meio.
 * Esta função:
 *   1. Soma parcelas por tipo → buckets nomeados (sinal_arras, fgts, ...)
 *      pra preservar templates atuais sem mudança.
 *   2. Filtra parcelas que já viram bucket (renderizadas hardcoded no
 *      template) pra não duplicar no loop {{#each parcelas}}.
 *   3. Deriva dias do momento (assinatura=0, escritura=prazo_escritura_dias,
 *      data_exata=delta, dias=mantém input).
 *   4. Deriva tipo_texto canônico quando o form não preencheu.
 */

const TIPO_TEXTO_CANONICO: Record<string, string> = {
  sinal_arras: "Sinal e princípio de pagamento (arras confirmatórias)",
  recursos_proprios: "Recursos próprios",
  fgts: "FGTS — Fundo de Garantia do Tempo de Serviço",
  cessao_consorcio: "Cessão de consórcio",
  financiamento: "Financiamento bancário com alienação fiduciária",
  permuta_veiculo: "Permuta com veículo",
  permuta_imovel: "Permuta com imóvel",
  outros: "Outras formas de pagamento",
};

// Mapeia tipo da parcela → nome do bucket no shape `pagamento.*`.
// `financiamento` → `alienacao_fiduciaria` por convenção dos templates v2.
// `permuta_*` e `outros` caem em `outras_formas`.
const TIPO_TO_BUCKET: Record<string, string> = {
  sinal_arras: "sinal_arras",
  recursos_proprios: "recursos_proprios",
  fgts: "fgts",
  cessao_consorcio: "cessao_consorcio",
  financiamento: "alienacao_fiduciaria",
  permuta_veiculo: "outras_formas",
  permuta_imovel: "outras_formas",
  outros: "outras_formas",
};

// Tipos renderizados HARDCODED na cláusula 2.1 do template a_vista — `a)`
// sempre é o sinal. Não pode aparecer duplicado dentro do loop {{#each}}.
const TIPOS_HARDCODED_AVISTA = new Set(["sinal_arras"]);

// Tipos renderizados HARDCODED no template financiamento:
// `a)` sinal, `b)` financiamento, `b.1)` fgts, `c)` recursos próprios.
// Tudo isso já sai pelo bucket nomeado — não repetir no loop.
const TIPOS_HARDCODED_FINANCIAMENTO = new Set([
  "sinal_arras",
  "financiamento",
  "fgts",
  "recursos_proprios",
]);

function formatCpfCnpjMasked(raw: string | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return raw;
}

/**
 * Texto narrativo do destino da parcela. Compõe a partir dos sub-objetos
 * `pix`, `bancarios` ou `banco_financiamento` conforme `meio_pagamento`.
 * Retorna "" quando o dado está incompleto — template oculta via `existe`.
 */
function buildDestinoTexto(out: Record<string, unknown>): string {
  const meio = typeof out.meio_pagamento === "string" ? (out.meio_pagamento as string) : "";
  if (meio === "pix") {
    const pix = (out.pix as Record<string, unknown> | undefined) || {};
    const chave = typeof pix.chave === "string" ? pix.chave.trim() : "";
    if (!chave) return "";
    const tipoChave = typeof pix.tipo_chave === "string"
      ? PIX_TIPO_CHAVE_LABELS[pix.tipo_chave as keyof typeof PIX_TIPO_CHAVE_LABELS] || ""
      : "";
    const titularNome = typeof pix.titular_nome === "string" ? pix.titular_nome.trim() : "";
    const titularDoc = typeof pix.titular_cpf_cnpj === "string"
      ? formatCpfCnpjMasked(pix.titular_cpf_cnpj)
      : "";
    let txt = `na chave PIX${tipoChave ? ` (${tipoChave})` : ""}: ${chave}`;
    if (titularNome) {
      txt += `, de titularidade de ${titularNome}`;
      if (titularDoc) txt += ` (${titularDoc})`;
    }
    return txt;
  }
  if (meio === "ted") {
    const b = (out.bancarios as Record<string, unknown> | undefined) || {};
    const banco = typeof b.banco === "string" ? b.banco.trim() : "";
    if (!banco) return "";
    const agencia = typeof b.agencia === "string" ? b.agencia.trim() : "";
    const conta = typeof b.conta === "string" ? b.conta.trim() : "";
    const tipoConta = typeof b.tipo_conta === "string"
      ? TIPO_CONTA_LABELS[b.tipo_conta as keyof typeof TIPO_CONTA_LABELS] || ""
      : "";
    const titularNome = typeof b.titular_nome === "string" ? b.titular_nome.trim() : "";
    const titularDoc = typeof b.titular_cpf_cnpj === "string"
      ? formatCpfCnpjMasked(b.titular_cpf_cnpj)
      : "";
    const parts: string[] = [`no Banco ${banco}`];
    if (agencia) parts.push(`Agência ${agencia}`);
    if (conta) parts.push(`Conta${tipoConta ? ` ${tipoConta}` : ""} nº ${conta}`);
    if (titularNome) {
      let titularPart = `titular ${titularNome}`;
      if (titularDoc) titularPart += ` (${titularDoc})`;
      parts.push(titularPart);
    }
    return parts.join(", ");
  }
  if (meio === "financiamento") {
    const bancoKey = typeof out.banco_financiamento === "string"
      ? (out.banco_financiamento as keyof typeof BANCO_FINANCIAMENTO_LABELS)
      : null;
    const label = bancoKey ? BANCO_FINANCIAMENTO_LABELS[bancoKey] : "";
    return label ? `através da ${label}` : "";
  }
  return "";
}

export interface EnrichContractContext {
  /**
   * Imobiliária do tenant (perfil da org: razão social, CNPJ, CRECI). Serve de
   * FALLBACK pro bloco da intermediadora quando o formulário do negócio não
   * nomeou nenhuma corretora — antes disso, o CCV saía sem intermediadora e o
   * corretor tinha que redigitar os dados da própria imobiliária a cada deal.
   *
   * Só fallback: o que veio do formulário sempre vence.
   */
  imobiliaria?: {
    nome?: string;
    cnpj?: string;
    creci?: string;
  };
  /**
   * Padrão de configurações contratuais da org (multas, juros, foro,
   * desistência, local/data de assinatura). Sobrepõe o padrão de fábrica.
   *
   * Omitir é seguro: cai em `DEFAULT_CONTRACT_SETTINGS`. É por isso que o
   * fallback mora AQUI e não no wizard — `enrichContractData` é chamado sem ctx
   * pelo preview de template, pelo parity test e pelo resumo do formulário, e
   * qualquer um desses ficaria sem os valores quando eles saíram do form.
   */
  contractDefaults?: ContractSettings;
}

// Padrão de configurações contratuais da org — a implementação mora em
// `lib/contracts/org-defaults.ts` (server-safe e sem as deps pesadas deste
// módulo); re-exportado aqui pra não quebrar callers antigos.
export { loadOrgContractDefaults, loadOrgLocacaoDefaults };

export function enrichContractData(
  data: Record<string, unknown>,
  ctx?: EnrichContractContext
): Record<string, unknown> {
  const enriched = { ...data };
  const config = ((enriched.config as Record<string, unknown>) || {}) as Record<string, unknown>;

  // --- Configurações contratuais: padrão da org > padrão de fábrica ---
  //
  // Estes campos eram coletados na última etapa do form público (e o wizard
  // gravava os literais no dataJson via defaultFormValues). Ao saírem de lá, a
  // geração passou a depender deste fallback — sem ele o template renderiza
  // "multa de %" e ", ." no fecho, e o parity test NÃO pega: `undefined` vira
  // string vazia no Handlebars, não sobra `{{...}}` pra detectar.
  //
  // Aditivo por definição: só preenche o que está ausente. Contrato/form que já
  // tem o valor gravado mantém o dele.
  const settings = ctx?.contractDefaults ?? DEFAULT_CONTRACT_SETTINGS;
  if (enriched.foro == null || enriched.foro === "") enriched.foro = settings.foro;
  if (enriched.desistencia == null) enriched.desistencia = { ...settings.desistencia };
  if (enriched.assinatura == null) enriched.assinatura = { ...settings.assinatura };
  for (const [key, value] of Object.entries(settings.config)) {
    if (config[key] == null) config[key] = value;
  }
  const tituloDefinitivo = enriched.titulo_definitivo as { prazo_dias?: number } | undefined;
  const entregaPosse = enriched.entrega_posse as { momento?: string } | undefined;
  const pagamento = enriched.pagamento as { valor_total?: number } | undefined;
  const comissao = ((enriched.comissao as Record<string, unknown>) || {}) as Record<string, unknown>;

  // Prazo de posse: default ao prazo do titulo definitivo ou 30 dias
  if (config.prazo_posse_dias == null) {
    config.prazo_posse_dias = tituloDefinitivo?.prazo_dias || 30;
  }
  // Prazo de escritura: usa prazo do titulo definitivo ou 60 dias
  if (config.prazo_escritura_dias == null) {
    config.prazo_escritura_dias = tituloDefinitivo?.prazo_dias || 60;
  }
  // Multas diarias: valores default razoaveis
  if (config.multa_diaria_posse == null) config.multa_diaria_posse = 500;
  if (config.multa_diaria_escritura == null) config.multa_diaria_escritura = 300;

  enriched.config = config;

  // Percentual da comissao: calculado automaticamente
  const valorComissao = Number(comissao.valor || 0);
  const valorTotal = Number(pagamento?.valor_total || 0);
  if (valorTotal > 0 && valorComissao > 0 && comissao.percentual == null) {
    comissao.percentual = Number(((valorComissao / valorTotal) * 100).toFixed(2));
  }
  enriched.comissao = comissao;

  // Titulo/registro aquisitivo: o template usa config.* — mantemos undefined
  // quando nao informado para que o template renda a frase condicionalmente
  // em vez de mostrar parenteses vazios.
  if (enriched.titulo_aquisitivo && !config.titulo_aquisitivo) {
    config.titulo_aquisitivo = enriched.titulo_aquisitivo;
  }
  if (enriched.registro_aquisitivo && !config.registro_aquisitivo) {
    config.registro_aquisitivo = enriched.registro_aquisitivo;
  }

  // Momento de posse texto
  if (entregaPosse && !entregaPosse.momento) {
    entregaPosse.momento = "assinatura";
  }

  // Local e data da assinatura — F1 (QA deal 20486). O form salva em
  // `assinatura.{cidade,uf,data}` (validation.ts step7), mas os templates v2
  // renderizam o fecho como `{{config.municipio_imovel}}, {{dataExtenso config.data_assinatura}}.`.
  // Sem esta ponte o contrato saía com ", ." (cidade+data vazias).
  const assinatura = enriched.assinatura as
    | { cidade?: string; uf?: string; data?: string }
    | undefined;
  const imoveis = enriched.imoveis as Array<Record<string, unknown>> | undefined;
  const imovel0 = imoveis?.[0];
  if (config.municipio_imovel == null || config.municipio_imovel === "") {
    const cidade =
      (typeof assinatura?.cidade === "string" && assinatura.cidade.trim()) ||
      (typeof imovel0?.cidade === "string" ? (imovel0.cidade as string).trim() : "");
    const uf =
      (typeof assinatura?.uf === "string" && assinatura.uf.trim()) ||
      (typeof imovel0?.uf === "string" ? (imovel0.uf as string).trim() : "");
    if (cidade) config.municipio_imovel = uf ? `${cidade}/${uf}` : cidade;
  }
  if (
    (config.data_assinatura == null || config.data_assinatura === "") &&
    typeof assinatura?.data === "string" &&
    assinatura.data.trim()
  ) {
    config.data_assinatura = assinatura.data.trim();
  }

  // ===== Form → template field bridges =====
  // O form (lib/forms/validation.ts) salva esses campos em paths top-level
  // que os templates v2 não leem. Mapeia agora pra config.* esperado pelo
  // Handlebars. Idempotente: nunca sobrescreve quando o destino já tem valor.

  // Saldo devedor de financiamento (form.saldo_devedor → config.saldo_devedor_vendedor)
  const saldoDevedorForm = Number(enriched.saldo_devedor || 0);
  if (saldoDevedorForm > 0 && config.saldo_devedor_vendedor == null) {
    config.saldo_devedor_vendedor = saldoDevedorForm;
  }

  // Bens inclusos no preço (form.incluso_no_preco → config.itens_entrega)
  const inclusoNoPreco =
    typeof enriched.incluso_no_preco === "string"
      ? (enriched.incluso_no_preco as string).trim()
      : "";
  if (inclusoNoPreco && config.itens_entrega == null) {
    // A7 (QA deal 20486): não duplicar quando o texto já consta na descrição
    // do imóvel (ex.: "Uma casa com área de 101,61m²" aparecia na cláusula 1.1
    // E na 3.4). Já estando na descrição, a cláusula de itens inclusos é omitida.
    const descricoes =
      (enriched.imoveis as Array<{ descricao?: string }> | undefined)?.map((i) =>
        (i.descricao ?? "").toLowerCase()
      ) ?? [];
    const jaNaDescricao = descricoes.some((d) => d.includes(inclusoNoPreco.toLowerCase()));
    if (!jaNaDescricao) {
      config.itens_entrega = inclusoNoPreco;
    }
  }

  // Débitos pendentes (IPTU, condomínio, outros)
  const debitos =
    ((enriched.debitos as Record<string, unknown>) || {}) as {
      iptu?: { selecionado?: boolean; valor?: number };
      condominio?: { selecionado?: boolean; valor?: number };
      outros?: string;
    };
  if (enriched.tem_debitos === true) {
    if (config.tem_debitos == null) config.tem_debitos = true;
    if (
      debitos.iptu?.selecionado &&
      Number(debitos.iptu.valor) > 0 &&
      config.debito_iptu_valor == null
    ) {
      config.debito_iptu_valor = debitos.iptu.valor;
    }
    if (
      debitos.condominio?.selecionado &&
      Number(debitos.condominio.valor) > 0 &&
      config.debito_condominio_valor == null
    ) {
      config.debito_condominio_valor = debitos.condominio.valor;
    }
    const debitosOutros =
      typeof debitos.outros === "string" ? debitos.outros.trim() : "";
    if (debitosOutros && config.debito_outros_descricao == null) {
      config.debito_outros_descricao = debitosOutros;
    }
  }

  // Vícios construtivos / ocultos — 4 variantes (renuncia/detalhado/reparar/desocultados).
  // Consolida descricao_reparar | descricao_desocultados em vicios_descricao
  // quando aplicável; opções "renuncia"/"detalhado" só setam vicios_opcao.
  const vicios = ((enriched.vicios as Record<string, unknown>) || {}) as {
    opcao?: string;
    descricao_reparar?: string;
    descricao_desocultados?: string;
  };
  if (vicios.opcao && config.vicios_opcao == null) {
    config.vicios_opcao = vicios.opcao;
    if (vicios.opcao === "reparar" && vicios.descricao_reparar?.trim()) {
      config.vicios_descricao = vicios.descricao_reparar.trim();
    } else if (
      vicios.opcao === "desocultados" &&
      vicios.descricao_desocultados?.trim()
    ) {
      config.vicios_descricao = vicios.descricao_desocultados.trim();
    }
  }

  // Débitos assumidos pelo comprador (em derrogação à cláusula de tributos)
  const debitosAssumidos =
    ((enriched.debitos_assumidos as Record<string, unknown>) || {}) as {
      assume?: boolean;
      descricao?: string;
    };
  if (
    debitosAssumidos.assume === true &&
    debitosAssumidos.descricao?.trim() &&
    config.debitos_assumidos_descricao == null
  ) {
    config.debitos_assumidos_descricao = debitosAssumidos.descricao.trim();
  }

  // Regularizações pendentes (vendedor compromete-se a regularizar X em Y dias)
  const regs = ((enriched.regularizacoes as Record<string, unknown>) || {}) as {
    tem?: boolean;
    prazo_dias?: number;
    descricao?: string;
  };
  if (regs.tem === true && regs.descricao?.trim()) {
    if (config.regularizacoes_descricao == null) {
      config.regularizacoes_descricao = regs.descricao.trim();
    }
    if (Number(regs.prazo_dias) > 0 && config.regularizacoes_prazo_dias == null) {
      config.regularizacoes_prazo_dias = regs.prazo_dias;
    }
  }

  // Locação preexistente — só quando imóvel está ocupado por terceiro
  const locacao = ((enriched.locacao as Record<string, unknown>) || {}) as {
    data_preferencia?: string;
    situacao?: string;
  };
  if (enriched.ocupacao === "ocupado-terceiro" && locacao.situacao) {
    if (config.locacao_situacao == null) {
      config.locacao_situacao = locacao.situacao;
    }
    if (locacao.data_preferencia && config.locacao_data == null) {
      config.locacao_data = locacao.data_preferencia;
    }
  }

  // Direito de desistência
  const desistencia =
    ((enriched.desistencia as Record<string, unknown>) || {}) as {
      permite?: boolean;
      prazo_dias?: number;
    };
  if (desistencia.permite === true) {
    if (config.desistencia_permite == null) config.desistencia_permite = true;
    if (
      Number(desistencia.prazo_dias) > 0 &&
      config.desistencia_prazo_dias == null
    ) {
      config.desistencia_prazo_dias = desistencia.prazo_dias;
    }
  }

  // Pagamento — derivação canônica das parcelas tipadas.
  const pagamentoMut = enriched.pagamento as
    | (Record<string, unknown> & {
        parcelas?: Array<Record<string, unknown>>;
      })
    | undefined;

  if (pagamentoMut?.parcelas?.length) {
    // 1. Derivar dias e tipo_texto pra cada parcela quando faltam.
    const prazoEscritura = Number(config.prazo_escritura_dias || 60);
    const prazoTitulo = Number(
      config.prazo_titulo_dias || config.prazo_escritura_dias || 60
    );
    // UX 2026-05-16: dados de PIX/banco do vendedor saíram do card de parcela
    // e foram pra `vendedores[0].recebimento`. Banco do financiamento subiu
    // de cada parcela pra `pagamento.banco_financiamento`. Aqui populamos
    // de volta na parcela só pra alimentar `buildDestinoTexto` — preserva
    // a saída do contrato sem mudar o template.
    const vendedores = enriched.vendedores as Array<Record<string, unknown>> | undefined;
    const recebimentoVendedor = vendedores?.[0]?.recebimento as
      | Record<string, unknown>
      | undefined;
    const pagamentoBancoFin =
      typeof pagamentoMut.banco_financiamento === "string"
        ? (pagamentoMut.banco_financiamento as string)
        : null;

    pagamentoMut.parcelas = pagamentoMut.parcelas.map((p) => {
      const out: Record<string, unknown> = { ...p };
      const momento = String(out.momento || "");

      // Inferir meio_pagamento quando vazio (form novo não pergunta mais):
      // - tipo=financiamento → meio=financiamento
      // - tipo=fgts → meio=fgts_saque
      // - tipo=permuta_* → meio=permuta
      // - caso contrário → "pix" se vendedor tem chave PIX, senão "ted"
      if (!out.meio_pagamento || out.meio_pagamento === "") {
        const tipo = String(out.tipo || "");
        if (tipo === "financiamento") out.meio_pagamento = "financiamento";
        else if (tipo === "fgts") out.meio_pagamento = "fgts_saque";
        else if (tipo.startsWith("permuta_")) out.meio_pagamento = "permuta";
        else if (typeof recebimentoVendedor?.pix_chave === "string" && recebimentoVendedor.pix_chave) {
          out.meio_pagamento = "pix";
        } else if (typeof recebimentoVendedor?.banco === "string" && recebimentoVendedor.banco) {
          out.meio_pagamento = "ted";
        }
      }

      // Popular pix/bancarios/banco_financiamento da parcela a partir do
      // vendedor / config quando vazios. Forms legados que já tinham esses
      // dados na parcela mantêm seus valores (idempotente).
      const meioCurrent = String(out.meio_pagamento || "");
      if (meioCurrent === "pix" && !out.pix && recebimentoVendedor?.pix_chave) {
        out.pix = {
          chave: recebimentoVendedor.pix_chave,
          tipo_chave: recebimentoVendedor.pix_tipo_chave,
          titular_nome:
            (vendedores?.[0]?.nome as string | undefined) ??
            (vendedores?.[0]?.razao_social as string | undefined),
          titular_cpf_cnpj:
            (vendedores?.[0]?.cpf as string | undefined) ??
            (vendedores?.[0]?.cnpj as string | undefined),
        };
      }
      if (meioCurrent === "ted" && !out.bancarios && recebimentoVendedor?.banco) {
        out.bancarios = {
          banco: recebimentoVendedor.banco,
          agencia: recebimentoVendedor.agencia,
          conta: recebimentoVendedor.conta,
          tipo_conta: recebimentoVendedor.tipo_conta,
          titular_nome:
            (vendedores?.[0]?.nome as string | undefined) ??
            (vendedores?.[0]?.razao_social as string | undefined),
          titular_cpf_cnpj:
            (vendedores?.[0]?.cpf as string | undefined) ??
            (vendedores?.[0]?.cnpj as string | undefined),
        };
      }
      if (
        meioCurrent === "financiamento" &&
        !out.banco_financiamento &&
        pagamentoBancoFin
      ) {
        out.banco_financiamento = pagamentoBancoFin;
      }

      // Derivar dias quando vazio/0 mas momento canônico setado.
      if ((!out.dias || Number(out.dias) === 0) && momento) {
        if (momento === "assinatura") out.dias = 0;
        else if (momento === "escritura") out.dias = prazoEscritura;
        else if (momento === "registro") out.dias = prazoTitulo;
        // Parcela financiada (momento novo 2026-07-30): o form agora coleta o
        // prazo inline em `dias`; sem valor, cai no MESMO prazo dos irmãos do
        // título (config.prazo_titulo_dias → prazo_escritura_dias → 60).
        else if (momento === "contrato_financiamento") out.dias = prazoTitulo;
        else if (momento === "data_exata" && typeof out.data_exata === "string") {
          const dt = new Date(out.data_exata);
          if (!Number.isNaN(dt.getTime())) {
            const delta = Math.max(
              0,
              Math.round((dt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
            );
            out.dias = delta;
          }
        }
      }
      // Derivar tipo_texto quando vazio mas tipo setado.
      if (
        (!out.tipo_texto || String(out.tipo_texto).trim() === "") &&
        typeof out.tipo === "string"
      ) {
        const tipoKey = String(out.tipo);
        if (tipoKey === "outros" && typeof out.tipo_outros_texto === "string") {
          out.tipo_texto = out.tipo_outros_texto;
        } else if (
          tipoKey.startsWith("permuta_") &&
          typeof out.permuta_descricao === "string"
        ) {
          const base = TIPO_TEXTO_CANONICO[tipoKey] ?? "Permuta";
          out.tipo_texto = out.permuta_descricao
            ? `${base}: ${out.permuta_descricao}`
            : base;
        } else {
          out.tipo_texto = TIPO_TEXTO_CANONICO[tipoKey] ?? "";
        }
      }

      // Texto canônico do "contados de" — preserva semântica original de
      // momento mesmo quando dias virou número. Default 'assinatura' bate
      // com o comportamento histórico do template.
      const momentoKey = momento as keyof typeof MOMENTO_TEXTO;
      out.momento_texto =
        MOMENTO_TEXTO[momentoKey] ?? MOMENTO_TEXTO.assinatura;

      // Data absoluta — quando momento=data_exata, formata em PT-BR longo
      // pra template render "até DD de mês de AAAA" em vez de "em X dias".
      // Parse com âncora ao meio-dia local pra estabilizar timezone — sem isso,
      // "2026-09-15" vira meia-noite UTC e desliza pra dia anterior em UTC-3.
      if (momento === "data_exata" && typeof out.data_exata === "string") {
        const dataStr = (out.data_exata as string).trim();
        const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataStr);
        const dt = ymd
          ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0)
          : new Date(dataStr);
        if (!Number.isNaN(dt.getTime())) {
          out.momento_data_texto = new Intl.DateTimeFormat("pt-BR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(dt);
        }
      }

      // Texto canônico do "mediante X" — substitui o hardcoded TED/PIX do
      // template. Fallback pra "transferencia" preserva forms legados sem
      // meio_pagamento setado.
      const meio = typeof out.meio_pagamento === "string"
        ? (out.meio_pagamento as keyof typeof MEIO_PAGAMENTO_TEXTO)
        : "transferencia";
      out.meio_pagamento_texto =
        MEIO_PAGAMENTO_TEXTO[meio] ?? MEIO_PAGAMENTO_TEXTO.transferencia;

      // Destino — chave PIX, dados bancários ou banco financiador. Só
      // renderiza quando há dado completo; abstrato (campos vazios) cai
      // pra string vazia e o template oculta com {{#if existe}}.
      out.destino_texto = buildDestinoTexto(out);

      // Promover banco_financiamento da parcela pra config quando ainda
      // não setado — alínea "b)" hardcoded do template financiamento usa
      // config.banco_financiamento pra mencionar a instituição.
      if (
        typeof out.banco_financiamento === "string" &&
        out.banco_financiamento &&
        !config.banco_financiamento
      ) {
        const bancoKey = out.banco_financiamento as keyof typeof BANCO_FINANCIAMENTO_LABELS;
        config.banco_financiamento =
          BANCO_FINANCIAMENTO_LABELS[bancoKey] ?? out.banco_financiamento;
      }

      return out;
    });

    // 2. Derivar buckets nomeados a partir de parcelas tipadas. Só
    // sobrescreve quando há ≥1 parcela com `tipo` setado (preserva forms
    // legados que editavam buckets direto sem tipar parcelas).
    const temParcelaTipada = pagamentoMut.parcelas.some(
      (p) => typeof p.tipo === "string"
    );
    if (temParcelaTipada) {
      const buckets: Record<string, number> = {
        sinal_arras: 0,
        recursos_proprios: 0,
        fgts: 0,
        cessao_consorcio: 0,
        alienacao_fiduciaria: 0,
        outras_formas: 0,
      };
      for (const p of pagamentoMut.parcelas) {
        const tipo = typeof p.tipo === "string" ? p.tipo : null;
        if (!tipo) continue;
        const bucket = TIPO_TO_BUCKET[tipo];
        if (bucket && buckets[bucket] !== undefined) {
          buckets[bucket] += Number(p.valor) || 0;
        }
      }
      for (const [k, v] of Object.entries(buckets)) {
        pagamentoMut[k] = v;
      }
    }

    // 2.1. Permuta — consolida descrições + valores em config.permuta_descricao
    // pra cláusula condicional dedicada. Parcelas permuta_* já entraram em
    // pagamento.outras_formas no bucket map acima, mas o template precisa do
    // texto narrativo separado.
    const permutaItems: string[] = [];
    for (const p of pagamentoMut.parcelas) {
      const tipo = typeof p.tipo === "string" ? (p.tipo as string) : null;
      const valor = Number(p.valor) || 0;
      if (
        valor > 0 &&
        (tipo === "permuta_veiculo" || tipo === "permuta_imovel")
      ) {
        const descr =
          typeof p.permuta_descricao === "string"
            ? (p.permuta_descricao as string).trim()
            : "";
        const valorTxt = new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(valor);
        const tipoTxt = tipo === "permuta_veiculo" ? "veículo" : "imóvel";
        permutaItems.push(
          `${tipoTxt} no valor de ${valorTxt}${descr ? ` — ${descr}` : ""}`
        );
      }
    }
    if (permutaItems.length > 0 && config.permuta_descricao == null) {
      config.permuta_descricao = permutaItems.join("; ");
    }

    // 3. Filtrar parcelas que já viram bucket renderizado HARDCODED no
    // template, pra evitar duplicação ("a) sinal_arras" + loop com outro
    // "sinal_arras"). Heurística da modalidade segue mesma regra abaixo.
    const isFinanciamento =
      (Number(pagamentoMut.alienacao_fiduciaria) || 0) > 0 ||
      (Number(pagamentoMut.fgts) || 0) > 0 ||
      (Number(pagamentoMut.cessao_consorcio) || 0) > 0;
    const hardcoded = isFinanciamento
      ? TIPOS_HARDCODED_FINANCIAMENTO
      : TIPOS_HARDCODED_AVISTA;
    pagamentoMut.parcelas = pagamentoMut.parcelas.filter((p) => {
      const tipo = typeof p.tipo === "string" ? p.tipo : null;
      // Sem tipo (forms legados ou CCV import) → mantém no loop pra não
      // sumir conteúdo de contratos antigos.
      if (!tipo) return true;
      // F2 (QA deal 20486): permuta é renderizada na cláusula dedicada
      // (2.1.4 à vista / 2.1.5 financiamento via `config.permuta_descricao`).
      // Mantê-la também no loop duplicava os parágrafos da descrição e gerava
      // gramática quebrada ("...vigente.: R$ ... mediante entrega ... nas contas").
      if (tipo === "permuta_veiculo" || tipo === "permuta_imovel") return false;
      return !hardcoded.has(tipo);
    });

    // 4. Letra do alfabeto (a_vista) e número sequencial (financiamento).
    // A5 (QA deal 20486): a alínea "a)" hardcoded só renderiza quando há sinal
    // (sinal_arras > 0). Sem sinal, o loop começa em "a)" em vez de "b)" pra
    // não deixar buraco de letra. Com sinal, mantém o offset (b, c, ...).
    const hasSinalArras = Number(pagamentoMut.sinal_arras) > 0;
    pagamentoMut.parcelas = pagamentoMut.parcelas.map((p, i) => ({
      ...p,
      letra: indexToLetter(hasSinalArras ? i + 1 : i),
      numero: i + 1,
    }));
  }

  // ===== Comissionados — papel + derivação valor↔percentual + auto-promote =====
  // Templates novos iteram comissao.comissionados[]. Enrich garante 3 coisas:
  //  1. Cada comissionado tem `papel_texto` PT-BR pra qualificação/cláusula
  //  2. `valor` e `percentual` são complementares — quando há um, deriva o outro
  //  3. Forms legados (só comissao.imobiliaria_*, sem array) sintetizam um
  //     comissionado único pra cláusula de breakdown poder iterar
  //  4. Form sem corretora nomeada + org com perfil cadastrado → a própria
  //     imobiliária do tenant (ctx.imobiliaria) entra como intermediadora
  const comissaoMut = enriched.comissao as Record<string, unknown> | undefined;
  if (comissaoMut) {
    const valorTotalComissao = Number(comissaoMut.valor || 0);
    const comissionados = (comissaoMut.comissionados as Array<Record<string, unknown>> | undefined) ?? [];

    if (comissionados.length === 0) {
      const imobNomeForm = typeof comissaoMut.imobiliaria_nome === "string"
        ? (comissaoMut.imobiliaria_nome as string).trim()
        : "";

      // Fallback pro perfil da org — só quando o form não nomeou corretora E há
      // comissão de fato. Numa venda direta sem comissão, carimbar a imobiliária
      // como comissionada seria inventar uma parte que não existe no negócio.
      const percentualForm =
        typeof comissaoMut.percentual === "number" ? comissaoMut.percentual : 0;
      const temComissao = valorTotalComissao > 0 || percentualForm > 0;
      const daOrg =
        !imobNomeForm && temComissao && ctx?.imobiliaria?.nome?.trim()
          ? ctx.imobiliaria
          : undefined;

      const imobNome = imobNomeForm || (daOrg?.nome ?? "").trim();
      if (imobNome) {
        // A org do tenant é sempre PJ; só o form pode declarar corretora PF.
        const tipoPessoa =
          !daOrg && comissaoMut.corretora_tipo_pessoa === "fisica" ? "fisica" : "juridica";
        const docRaw = daOrg
          ? (daOrg.cnpj ?? "")
          : typeof comissaoMut.imobiliaria_cnpj === "string"
            ? (comissaoMut.imobiliaria_cnpj as string)
            : "";
        const creciRaw = daOrg
          ? (daOrg.creci ?? "")
          : typeof comissaoMut.creci === "string"
            ? (comissaoMut.creci as string)
            : "";
        const sintetizado: Record<string, unknown> = {
          nome: imobNome,
          tipo_pessoa: tipoPessoa,
          papel: "imobiliaria_principal",
          incluir_como_signatario: comissaoMut.incluir_como_signatario !== false,
        };
        if (tipoPessoa === "fisica") sintetizado.cpf = docRaw;
        else sintetizado.cnpj = docRaw;
        if (creciRaw) {
          sintetizado.creci = creciRaw;
        }
        if (typeof comissaoMut.imobiliaria_email === "string" && comissaoMut.imobiliaria_email) {
          sintetizado.email = comissaoMut.imobiliaria_email;
        }
        if (typeof comissaoMut.percentual === "number" && comissaoMut.percentual > 0) {
          sintetizado.percentual = comissaoMut.percentual;
        }
        if (valorTotalComissao > 0) sintetizado.valor = valorTotalComissao;
        comissaoMut.comissionados = [sintetizado];
      }
    }

    const arr = (comissaoMut.comissionados as Array<Record<string, unknown>> | undefined) ?? [];
    comissaoMut.comissionados = arr.map((c) => {
      const out: Record<string, unknown> = { ...c };
      // Texto PT-BR do papel
      if (typeof out.papel === "string") {
        const label = PAPEL_LABELS[out.papel as keyof typeof PAPEL_LABELS];
        if (label) out.papel_texto = label;
      }
      // Derivar valor a partir de percentual (ou vice-versa)
      const pct = typeof out.percentual === "number" ? out.percentual : null;
      const val = typeof out.valor === "number" ? out.valor : null;
      if (pct != null && pct > 0 && (val == null || val === 0) && valorTotalComissao > 0) {
        out.valor = Math.round(valorTotalComissao * pct) / 100;
      } else if (val != null && val > 0 && (pct == null || pct === 0) && valorTotalComissao > 0) {
        out.percentual = Math.round((val / valorTotalComissao) * 10000) / 100;
      }
      return out;
    });
  }

  return enriched;
}

function indexToLetter(idx: number): string {
  if (idx < 0) return "";
  if (idx < 26) return String.fromCharCode(97 + idx);
  return `${idx + 1}`;
}

/**
 * Generates a contract for a deal:
 * 1. Auto-detects modalidade from deal/form data
 * 2. Selects matching template
 * 3. Renders HTML with Handlebars
 * 4. Creates Contract v1 (or next version)
 * 5. Moves deal to "Confeccao de Contrato" stage
 */
export async function generateContractForDeal(
  dealId: string,
  userId: string,
  orgId: string
): Promise<GenerateResult> {
  await assertModuleEnabled(orgId, MODULE.VENDAS);

  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { form: true },
  });

  // Get form data from deal or form
  const dataJson = deal.form
    ? (deal.form.dataJson as Record<string, unknown>)
    : (deal.dataJson as Record<string, unknown>) || {};

  // Seleção DETERMINÍSTICA de template por categoria (forma de pagamento →
  // template). Substitui a antiga detecção heurística de modalidade, que lia
  // os buckets derivados (alienacao_fiduciaria/fgts/cessao_consorcio) ANTES do
  // enrich rodar — eles saíam 0 e o fallback dataJson.modalidade (undefined)
  // fazia um financiamento cair no template À Vista (QA contrato cmpfp60h5).
  // Agora a categoria vem dos `parcelas[].tipo`, com fallback p/ o principal
  // do grupo (ex.: consórcio sem template → financiamento).
  const selection = await selectTemplateForDeal(orgId, dataJson);
  if (!selection) {
    throw new Error(
      "Nenhum template ativo para gerar o contrato. Ative ou envie um modelo em Configurações → Modelos."
    );
  }
  const template = selection.template;

  // Perfil da imobiliária (Organization) — fallback da intermediadora quando o
  // formulário do negócio não nomeou corretora. Espelha o que a locação já faz
  // com a administradora; sem isso o CCV saía sem intermediadora e o corretor
  // redigitava nome/CNPJ/CRECI da própria imobiliária a cada negócio.
  const orgProfile = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { legalName: true, cnpj: true, creci: true },
  });

  // Padrão de configurações contratuais da imobiliária (multas, juros, foro,
  // desistência). Ausente → padrão de fábrica.
  const contractDefaults = await loadOrgContractDefaults(orgId);

  // Enrich data with template defaults (multas, prazos, percentual comissao)
  const enrichedData = enrichContractData(dataJson, {
    imobiliaria: {
      nome: orgProfile?.legalName?.trim() || undefined,
      cnpj: orgProfile?.cnpj?.trim() || undefined,
      creci: orgProfile?.creci?.trim() || undefined,
    },
    contractDefaults,
  });

  // Render HTML — apenas pra engine="handlebars". Em engine="google_docs"
  // o conteúdo nunca passa por Handlebars; o doc fonte é copiado e tem seus
  // placeholders substituídos via Drive API. Ainda guardamos um snapshot
  // mínimo em htmlContent pra fallback de export/diff.
  const isGoogleDocsEngine = template.engine === "google_docs";
  const htmlContent = isGoogleDocsEngine
    ? `<p>Contrato gerado a partir de Google Doc (${template.name}).</p>`
    : renderContratoHTML(template.handlebarsSource, enrichedData);

  // Versionamento atômico (C1 — QA deal 20486): a versão vem de MAX(version)+1
  // (robusto a rows duplicadas legadas) e o par updateMany(isLatest:false) +
  // create(isLatest:true) roda numa transação. Sem isso, gerações concorrentes
  // produziam 2 linhas isLatest=true no mesmo deal. O índice único parcial
  // `Contract_dealId_kind_isLatest_unique` reforça a invariante (por kind) no
  // nível do banco.
  const agg = await prisma.contract.aggregate({
    where: { dealId: deal.id, kind: "contract" },
    _max: { version: true },
  });
  const nextVersion = (agg._max.version ?? 0) + 1;

  const contract = await prisma.$transaction(async (tx) => {
    await tx.contract.updateMany({
      where: { dealId: deal.id, kind: "contract", isLatest: true },
      data: { isLatest: false },
    });
    return tx.contract.create({
      data: {
        dealId: deal.id,
        templateId: template.id,
        userId,
        version: nextVersion,
        dataJson: enrichedData as any,
        htmlContent,
        status: "rascunho",
        isLatest: true,
      },
    });
  });

  // Google Docs nativo: gera o doc fazendo upload do HTML já renderizado pelo
  // Handlebars. Antes (até 2026-05-05) usávamos um template-modelo cacheado +
  // replaceAllText, mas o template era gerado por um migrador que colapsava
  // loops para 1 iteração e fixava conditionals — ou seja, perdia 2º vendedor,
  // 2ª testemunha, branch cônjuge, slots de cláusula etc. Agora cada contrato
  // sobe seu próprio HTML, preservando tudo. Falha aqui não impede a criação
  // (degrada para TipTap).
  let googleDocUrl: string | undefined;
  if (isGoogleDocsFeatureEnabled()) {
    try {
      const numeroContrato = `${contract.id.slice(-8).toUpperCase()}-v${contract.version}`;
      const docName = `Contrato ${contract.id} — v${contract.version}`;

      let created: { docId: string; webViewLink: string };

      if (isGoogleDocsEngine) {
        // engine="google_docs": copia o template-modelo e substitui placeholders
        // simples via batchUpdate(replaceAllText). Não suporta loops nem
        // conditionals — limitação anunciada na UI de import.
        if (!template.googleTemplateDocId) {
          throw new Error(
            "Template Google Docs sem googleTemplateDocId associado."
          );
        }
        const copy = await copyContractGoogleDoc({
          sourceDocId: template.googleTemplateDocId,
          name: docName,
          orgId,
        });
        created = { docId: copy.docId, webViewLink: copy.webViewLink };

        // Mapa composto (qualificações narrativas, parcelas) + flat legado.
        const { buildVendaPlaceholderMap } = await import("@/lib/templates/placeholder-map");
        const { cleanupOrphanPlaceholders, exportDocAsHtml: exportSnapshot } = await import(
          "@/lib/google/docs"
        );
        const map = buildVendaPlaceholderMap(enrichedData);
        map["contrato_numero"] = numeroContrato;
        map["contrato_id"] = contract.id;
        map["contrato_versao"] = String(contract.version);
        // Sem replace, o contrato sai com `{{tokens}}` crus — inútil. Deixa propagar
        // para o catch externo, que desfaz o contrato e lança.
        await replacePlaceholdersInDoc({
          docId: copy.docId,
          replacements: map,
        });
        await cleanupOrphanPlaceholders(copy.docId);

        // Snapshot real do conteúdo (substitui o stub de htmlContent).
        try {
          const snapshot = await exportSnapshot(copy.docId);
          await prisma.contract.update({
            where: { id: contract.id },
            data: { htmlContent: snapshot },
          });
        } catch (snapErr) {
          console.error("[contract-generation] Falha no snapshot exportDocAsHtml:", snapErr);
        }
      } else {
        // Pré-injeta `{{contrato.numero}}` no HTML caso o template tenha esse
        // placeholder em algum cabeçalho/rodapé customizado. O htmlContent já
        // foi renderizado por Handlebars contra `enrichedData`, então só
        // sobram literais dessa forma se o template os deixou intencionalmente.
        const htmlForUpload = htmlContent
          .replace(/\{\{\s*contrato\.numero\s*\}\}/g, numeroContrato)
          .replace(/\{\{\s*contrato\.id\s*\}\}/g, contract.id)
          .replace(/\{\{\s*contrato\.versao\s*\}\}/g, String(contract.version));

        const uploaded = await uploadHtmlAsGoogleDoc({
          htmlContent: htmlForUpload,
          name: docName,
          orgId,
        });
        created = { docId: uploaded.docId, webViewLink: uploaded.webViewLink };
      }

      // Registra watch do Drive para popular ContractChangeLog quando o doc
      // for editado dentro do iframe. Falha aqui não impede a criação.
      let watchData: {
        googleWatchChannel?: string;
        googleWatchResource?: string;
        googleWatchExpires?: Date;
      } = {};
      const webhookBase = process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL;
      const watchToken = process.env.GOOGLE_WATCH_TOKEN?.trim();
      if (webhookBase && watchToken) {
        try {
          const watch = await watchFile({
            fileId: created.docId,
            webhookUrl: `${webhookBase.replace(/\/$/, "")}/api/webhooks/google-drive`,
            token: watchToken,
          });
          watchData = {
            googleWatchChannel: watch.channelId,
            googleWatchResource: watch.resourceId,
            googleWatchExpires: new Date(watch.expiration),
          };
        } catch (err) {
          console.error("[contract-generation] Falha ao registrar watch Drive:", err);
        }
      }

      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          googleDocId: created.docId,
          googleDocUrl: created.webViewLink,
          googleDocStatus: "draft",
          ...watchData,
        },
      });
      googleDocUrl = created.webViewLink;

      // Compartilha com membros da org (writer). Sem isso, usuários não-owner
      // veem "Solicitar acesso" no iframe — Drive autentica direto contra a
      // conta Google, fora da sessão NextAuth. Falha não bloqueia: helper
      // nunca lança e usa Promise.allSettled per-membro.
      try {
        await shareDocWithOrgMembers(created.docId, orgId);
      } catch (shareErr) {
        console.error(
          "[contract-generation] Falha ao compartilhar com org members:",
          shareErr
        );
      }

      // Aplica DocumentStyle default da org (fonte, tamanho, line-height,
      // margens) — Drive descarta CSS de classes ao importar HTML, então
      // sem isso o doc nasce com Arial 11pt + margens default. Falha não
      // bloqueia: doc fica funcional, só sem o branding visual.
      // EXCEÇÃO engine google_docs: o layout vem do modelo da imobiliária;
      // reaplicar preset sobrescreveria timbrado/fontes do modelo.
      if (!isGoogleDocsEngine) {
        try {
          const defaultStyle = await prisma.documentStyle.findFirst({
            where: { orgId, isDefault: true },
          });
          if (defaultStyle) {
            const { googleApplyStylePreset } = await import("@/lib/ai/google-tool-handlers");
            await googleApplyStylePreset(created.docId, {
              fontFamily: defaultStyle.fontFamily,
              fontSizeBase: defaultStyle.fontSizeBase,
              lineHeight: defaultStyle.lineHeight,
              colorPrimary: defaultStyle.colorPrimary,
              marginTopMm: defaultStyle.marginTopMm,
              marginBottomMm: defaultStyle.marginBottomMm,
              marginLeftMm: defaultStyle.marginLeftMm,
              marginRightMm: defaultStyle.marginRightMm,
            });
          }
        } catch (styleErr) {
          console.error(
            "[contract-generation] Falha ao aplicar DocumentStyle default:",
            styleErr
          );
        }
      }
    } catch (err) {
      // Persiste a causa exata da falha no contrato pra diagnóstico — sem
      // isso, o try/catch silencioso esconde o erro real (visto no QA E2E).
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error("[contract-generation] Falha ao criar Google Doc:", err);
      try {
        await prisma.contract.update({
          where: { id: contract.id },
          data: { googleDocStatus: `error: ${msg.slice(0, 500)}` },
        });
      } catch {
        // ignora — diagnóstico best-effort
      }

      // engine=google_docs não tem corpo alternativo: degradar aqui produziria um
      // contrato com stub de HTML e sem doc. Desfaz e lança.
      if (isGoogleDocsEngine) {
        await rollbackFailedContract(contract.id, deal.id, "contract");
        throw new GoogleDocsGenerationError(googleDocsFailureMessage(err, template.name), err);
      }
    }
  }

  // Derive deal title and value from form data
  const { title: derivedTitle, value: derivedValue, clientName } = deriveDealMetadata(
    dataJson,
    { formTitle: deal.form?.title, fallbackTitle: deal.title }
  );

  // Move deal to "Confeccao de Contrato" stage and sync title/value
  const pipeline = await getPipelineByKind(orgId, MODULE.VENDAS, {
    include: { stages: { orderBy: { position: "asc" } } },
  });

  const confeccaoStage = pipeline?.stages.find(
    (s) => s.name === "Confecção de Contrato"
  );

  // Sempre grava o derivado (null LIMPA): comprador trocado/removido não
  // pode deixar o nome antigo no card — o kanban antigo re-derivava ao vivo.
  const dealMeta = { title: derivedTitle, value: derivedValue ?? deal.value, clientName };
  if (confeccaoStage) {
    await moveDealStage({
      dealId: deal.id,
      toStageId: confeccaoStage.id,
      reason: "contract_generation",
      orgId,
      dealData: dealMeta,
    });
  } else {
    await prisma.deal.update({ where: { id: deal.id }, data: dealMeta });
  }

  // Transfer form attachments to deal. Idempotente: pula urls que já viraram
  // DealAttachment (evita duplicação quando o contrato é regerado). Preserva
  // extractedData (assignment/fields) pra manter o agrupamento por parte na
  // aba Documentos, e marca source="form".
  if (deal.formId) {
    const formAttachments = await prisma.formAttachment.findMany({
      where: { formId: deal.formId },
    });

    if (formAttachments.length > 0) {
      const existing = await prisma.dealAttachment.findMany({
        where: { dealId: deal.id },
        select: { url: true },
      });
      const existingUrls = new Set(existing.map((a) => a.url));
      const toCopy = formAttachments.filter((att) => !existingUrls.has(att.url));

      if (toCopy.length > 0) {
        await prisma.dealAttachment.createMany({
          data: toCopy.map((att) => ({
            dealId: deal.id,
            filename: att.filename,
            mime: att.mime,
            url: att.url,
            category: att.category || "documento",
            source: "form",
            extractedData: (att.extractedData as object | null) ?? undefined,
            contentHash: att.contentHash ?? undefined,
          })),
        });
      }
    }
  }

  // F4 — Análise automática de certidões na confecção. Fire-and-forget:
  // não bloqueia retorno do contrato. Vai pra ContractComment como
  // findings ancorados, severity error/warning. Usuário vê os warnings
  // ao abrir o contrato.
  // waitUntil: essas análises gateiam o /approve (criam ContractComment
  // severity=error). `void` após o response era cancelado na Vercel.
  waitUntil(
    analyzeCertidoesForContract(contract.id, deal.id, orgId, userId).catch((err) => {
      console.error("[contract-generation] analyzeCertidoesForContract falhou:", err);
    })
  );

  // A0.3 — Gate de qualidade de render. Roda o linter determinístico sobre o
  // HTML recém-renderizado e materializa findings como ContractComment. Severity
  // "error" (ex.: local/data em branco, {{var}} não preenchida) é contada pelo
  // /approve e BLOQUEIA a aprovação; "warning" só sinaliza. O agente pode
  // autocorrigir via "Resolver com IA".
  waitUntil(
    analyzeRenderQualityForContract(contract.id, htmlContent).catch((err) => {
      console.error("[contract-generation] analyzeRenderQualityForContract falhou:", err);
    })
  );

  // FU2/FU5 — Gate de validade de DADOS críticos. O finalize do form é
  // leniente (gera rascunho mesmo com lacunas), mas lacunas LEGAIS críticas
  // (cônjuge sem CPF/nome quando a parte é casada) viram ContractComment
  // severity="error" → bloqueiam /approve. Mantém o rascunho navegável mas
  // impede que um contrato juridicamente inválido seja aprovado/enviado.
  waitUntil(
    analyzeContractDataValidity(contract.id, dataJson).catch((err) => {
      console.error("[contract-generation] analyzeContractDataValidity falhou:", err);
    })
  );

  // Sem notificação de "contrato pronto" — decisão de produto (2026-08-17):
  // o contrato recém-gerado é um rascunho interno; os marcos comunicados são
  // form_completed (no finalize do form) e contract_sent (no envio).

  return { contractId: contract.id, version: contract.version, googleDocUrl };
}

/**
 * Gera o contrato de LOCAÇÃO para um deal. Espelha generateContractForDeal mas
 * troca dois pontos: seleção de template (selectLocacaoTemplate por schemaType)
 * e enrich (enrichLocacaoData). Reusa o pipeline de Google Doc (upload do HTML
 * renderizado + watch + share + style). Depois faz upsert do LeaseContract e
 * liga LeaseContract.contractId ao Contract recém-criado. Pula as análises
 * sales-específicas (certidões/validade de cônjuge); mantém o render linter.
 */
export async function generateLocacaoContractForDeal(
  dealId: string,
  userId: string,
  orgId: string
): Promise<GenerateResult> {
  await assertModuleEnabled(orgId, MODULE.LOCACAO);

  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { form: true },
  });

  const dataJson = deal.form
    ? (deal.form.dataJson as Record<string, unknown>)
    : (deal.dataJson as Record<string, unknown>) || {};
  const schemaType = deal.form?.schemaType ?? "locacao_residencial_v1";

  // dataJson entra na seleção: além da modalidade, garantia e PF/PJ (locatário e
  // fiador) escolhem a variante do template (ContractTemplate.matchCriteria).
  const selection = await selectLocacaoTemplate(orgId, schemaType, dataJson);
  if (!selection) {
    throw new Error(
      "Nenhum template de locação ativo. Ative ou envie um modelo em Configurações → Modelos."
    );
  }
  const template = selection.template;

  // Administradora nomeada na cláusula de pagamento. O gate é a RAZÃO SOCIAL
  // (cadastro deliberado do dono no perfil da imobiliária) — não `org.name`,
  // que toda org tem e nomearia uma administradora que ninguém cadastrou, nem
  // o CRECI, que o bloco Handlebars já trata como opcional. Sem razão social,
  // o template usa o fallback "à PARTE LOCADORA ou a quem esta indicar".
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, legalName: true, cnpj: true, creci: true, legalAddress: true },
  });
  const orgLegalName = org?.legalName?.trim();
  const administradora = orgLegalName
    ? {
        nome: orgLegalName,
        cnpj: org?.cnpj?.trim() || undefined,
        creci: org?.creci?.trim() || undefined,
        endereco: org?.legalAddress?.trim() || undefined,
      }
    : undefined;

  // Padrão contratual de LOCAÇÃO da imobiliária (multa de atraso, juros, multa
  // rescisória, comarca). Ausente → padrão de fábrica.
  const contractDefaults = await loadOrgLocacaoDefaults(orgId);

  const enrichedData = enrichLocacaoData(dataJson, { administradora, contractDefaults });

  // Slots de cláusula (`{{{slot_garantia}}}`): quando o template veio da
  // CONSOLIDAÇÃO de N modelos quase idênticos, o bloco que variava entre eles
  // não está no template — está no acervo, uma cláusula por opção do form. Aqui
  // a opção escolhida puxa a cláusula certa. Template sem marcador nem consulta
  // o banco e o resultado é `{}` (canônicos seguem intactos).
  //
  // Os valores entram no `enrichedData` ANTES do create — então ficam no
  // `Contract.dataJson` e todo re-render posterior (export PDF, diff da aba
  // Configurações, memória) reproduz o mesmo texto sem reconsultar o acervo.
  const slotFormat = template.engine === "google_docs" ? "text" : "html";
  const { values: slotValues } = await resolveClauseSlots({
    orgId,
    templateSource: template.handlebarsSource,
    data: enrichedData,
    format: slotFormat,
  });
  Object.assign(enrichedData, slotValues);

  // engine="google_docs": o template É um Google Doc (modelo da imobiliária,
  // layout/timbrado preservados) — copiamos o doc e substituímos placeholders
  // (campos simples + blocos compostos resolvidos server-side). O htmlContent
  // inicial é um stub; após criar o doc, o snapshot real vem de exportDocAsHtml.
  const isLocacaoGoogleDocsEngine = template.engine === "google_docs";
  const htmlContent = isLocacaoGoogleDocsEngine
    ? `<p>Contrato gerado a partir do modelo Google Doc (${template.name}).</p>`
    : renderContratoHTML(template.handlebarsSource, enrichedData);

  const agg = await prisma.contract.aggregate({
    where: { dealId: deal.id, kind: "contract" },
    _max: { version: true },
  });
  const nextVersion = (agg._max.version ?? 0) + 1;

  const contract = await prisma.$transaction(async (tx) => {
    await tx.contract.updateMany({
      where: { dealId: deal.id, kind: "contract", isLatest: true },
      data: { isLatest: false },
    });
    return tx.contract.create({
      data: {
        dealId: deal.id,
        templateId: template.id,
        userId,
        version: nextVersion,
        dataJson: enrichedData as any,
        htmlContent,
        status: "rascunho",
        isLatest: true,
      },
    });
  });

  // Google Doc: engine handlebars sobe o HTML renderizado; engine google_docs
  // copia o doc-modelo da imobiliária e substitui placeholders. Watch + share
  // iguais nos dois. Falha não bloqueia a criação do contrato.
  let googleDocUrl: string | undefined;
  if (isGoogleDocsFeatureEnabled()) {
    try {
      const numeroContrato = `${contract.id.slice(-8).toUpperCase()}-v${contract.version}`;
      const docName = `Locação ${contract.id} — v${contract.version}`;

      let created: { docId: string; webViewLink: string };
      if (isLocacaoGoogleDocsEngine) {
        if (!template.googleTemplateDocId) {
          throw new Error("Template Google Docs sem googleTemplateDocId associado.");
        }
        const { buildLocacaoPlaceholderMap } = await import("@/lib/templates/placeholder-map");
        const { cleanupOrphanPlaceholders } = await import("@/lib/google/docs");

        const copy = await copyContractGoogleDoc({
          sourceDocId: template.googleTemplateDocId,
          name: docName,
          orgId,
        });
        created = { docId: copy.docId, webViewLink: copy.webViewLink };

        const map = buildLocacaoPlaceholderMap(enrichedData);
        // Slots resolvidos acima — `{{slot_garantia}}` no Doc do modelo vira a
        // cláusula do acervo (ou o fallback canônico). Doc sem o token não casa
        // nada no replaceAllText, então isto é inócuo pros modelos antigos.
        Object.assign(map, slotValues);
        map["contrato_numero"] = numeroContrato;
        map["contrato_id"] = contract.id;
        map["contrato_versao"] = String(contract.version);
        // Sem replace, o contrato sai com `{{tokens}}` crus — deixa propagar.
        await replacePlaceholdersInDoc({ docId: copy.docId, replacements: map });
        await cleanupOrphanPlaceholders(copy.docId);

        // Snapshot real do conteúdo pro htmlContent (export/diff/memória).
        try {
          const { exportDocAsHtml } = await import("@/lib/google/docs");
          const snapshot = await exportDocAsHtml(copy.docId);
          await prisma.contract.update({
            where: { id: contract.id },
            data: { htmlContent: snapshot },
          });
        } catch (snapErr) {
          console.error("[locacao-generation] Falha no snapshot exportDocAsHtml:", snapErr);
        }
      } else {
        const htmlForUpload = htmlContent
          .replace(/\{\{\s*contrato\.numero\s*\}\}/g, numeroContrato)
          .replace(/\{\{\s*contrato\.id\s*\}\}/g, contract.id)
          .replace(/\{\{\s*contrato\.versao\s*\}\}/g, String(contract.version));
        created = await uploadHtmlAsGoogleDoc({ htmlContent: htmlForUpload, name: docName, orgId });
      }

      let watchData: {
        googleWatchChannel?: string;
        googleWatchResource?: string;
        googleWatchExpires?: Date;
      } = {};
      const webhookBase = process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL;
      const watchToken = process.env.GOOGLE_WATCH_TOKEN?.trim();
      if (webhookBase && watchToken) {
        try {
          const watch = await watchFile({
            fileId: created.docId,
            webhookUrl: `${webhookBase.replace(/\/$/, "")}/api/webhooks/google-drive`,
            token: watchToken,
          });
          watchData = {
            googleWatchChannel: watch.channelId,
            googleWatchResource: watch.resourceId,
            googleWatchExpires: new Date(watch.expiration),
          };
        } catch (err) {
          console.error("[locacao-generation] Falha ao registrar watch Drive:", err);
        }
      }

      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          googleDocId: created.docId,
          googleDocUrl: created.webViewLink,
          googleDocStatus: "draft",
          ...watchData,
        },
      });
      googleDocUrl = created.webViewLink;

      try {
        await shareDocWithOrgMembers(created.docId, orgId);
      } catch (shareErr) {
        console.error("[locacao-generation] Falha ao compartilhar com org members:", shareErr);
      }

      // DocumentStyle SÓ no caminho handlebars — em engine google_docs o
      // layout vem do modelo da imobiliária e reaplicar preset o destruiria
      // (mesma razão do import de contratos externos).
      if (!isLocacaoGoogleDocsEngine) {
        try {
          const defaultStyle = await prisma.documentStyle.findFirst({
            where: { orgId, isDefault: true },
          });
          if (defaultStyle) {
            const { googleApplyStylePreset } = await import("@/lib/ai/google-tool-handlers");
            await googleApplyStylePreset(created.docId, {
              fontFamily: defaultStyle.fontFamily,
              fontSizeBase: defaultStyle.fontSizeBase,
              lineHeight: defaultStyle.lineHeight,
              colorPrimary: defaultStyle.colorPrimary,
              marginTopMm: defaultStyle.marginTopMm,
              marginBottomMm: defaultStyle.marginBottomMm,
              marginLeftMm: defaultStyle.marginLeftMm,
              marginRightMm: defaultStyle.marginRightMm,
            });
          }
        } catch (styleErr) {
          console.error("[locacao-generation] Falha ao aplicar DocumentStyle:", styleErr);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error("[locacao-generation] Falha ao criar Google Doc:", err);
      try {
        await prisma.contract.update({
          where: { id: contract.id },
          data: { googleDocStatus: `error: ${msg.slice(0, 500)}` },
        });
      } catch {
        // diagnóstico best-effort
      }

      // engine=google_docs não tem corpo alternativo — ver google-docs-failure.ts.
      if (isLocacaoGoogleDocsEngine) {
        await rollbackFailedContract(contract.id, deal.id, "contract");
        throw new GoogleDocsGenerationError(googleDocsFailureMessage(err, template.name), err);
      }
    }
  }

  // Upsert do LeaseContract + liga o instrumento (Google Doc) recém-criado.
  try {
    await createLeaseContractFromDataJson({
      orgId,
      deal: { id: deal.id },
      dataJson,
      contractId: contract.id,
    });
  } catch (err) {
    console.error("[locacao-generation] Falha ao upsert LeaseContract:", err);
  }

  // Move o deal pro stage "Em contrato" do pipeline DE LOCAÇÃO (esteira comercial).
  // deriveLocacaoDealMetadata lê o shape de locação (locadores/locatarios/
  // imovel singular/aluguel.valor) — a variante de venda deixava o card com
  // título genérico e "Sem valor".
  const { title: derivedTitle, value: derivedValue, clientName } = deriveLocacaoDealMetadata(dataJson, {
    formTitle: deal.form?.title,
    fallbackTitle: deal.title,
  });
  const pipeline = await getPipelineByKind(orgId, MODULE.LOCACAO, {
    include: { stages: { orderBy: { position: "asc" } } },
  });
  const confeccaoStage = pipeline?.stages.find((s) => s.name === "Em contrato");
  // Sempre grava o derivado (null LIMPA): comprador trocado/removido não
  // pode deixar o nome antigo no card — o kanban antigo re-derivava ao vivo.
  const dealMeta = { title: derivedTitle, value: derivedValue ?? deal.value, clientName };
  if (confeccaoStage) {
    await moveDealStage({
      dealId: deal.id,
      toStageId: confeccaoStage.id,
      reason: "contract_generation",
      orgId,
      dealData: dealMeta,
    });
  } else {
    await prisma.deal.update({ where: { id: deal.id }, data: dealMeta });
  }

  // Render linter (genérico) — materializa findings como ContractComment.
  waitUntil(
    analyzeRenderQualityForContract(contract.id, htmlContent).catch((err) => {
      console.error("[locacao-generation] analyzeRenderQualityForContract falhou:", err);
    })
  );

  // Sem notificação de "contrato pronto" (paridade com vendas — ver
  // generateContractForDeal).

  return { contractId: contract.id, version: contract.version, googleDocUrl };
}

/**
 * Gera o CONTRATO DE ADMINISTRAÇÃO DE LOCAÇÃO (instrumento imobiliária ↔
 * proprietário) como Contract kind="administracao" no MESMO deal de locação.
 * Espelha generateLocacaoContractForDeal com 3 diferenças: template da
 * modalidade "administracao_locacao" (match exato, sem fallback), enrich
 * próprio (taxa de administração/repasse/exclusividade) e NENHUM efeito
 * colateral de esteira — não move stage, não mexe em LeaseContract. Suporta
 * engine handlebars (template canônico) e google_docs (modelo da imobiliária:
 * copia o Doc + substitui placeholders via buildLocacaoPlaceholderMap).
 */
export async function generateAdministracaoContractForDeal(
  dealId: string,
  userId: string,
  orgId: string
): Promise<GenerateResult> {
  await assertModuleEnabled(orgId, MODULE.LOCACAO);

  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { form: true },
  });

  const dataJson = deal.form
    ? (deal.form.dataJson as Record<string, unknown>)
    : (deal.dataJson as Record<string, unknown>) || {};

  const selection = await selectAdministracaoTemplate(orgId);
  if (!selection) {
    throw new Error(
      "Nenhum template de administração de locação ativo. Ative ou envie um modelo em Configurações → Modelos."
    );
  }
  const template = selection.template;
  // engine="google_docs": o template É o Google Doc-modelo da imobiliária
  // (layout/timbrado + administradora/taxa/foro literais preservados); copiamos
  // o doc e substituímos os placeholders. engine="handlebars": render do HTML
  // canônico com a administradora vinda do cadastro da org.
  const isGoogleDocsEngine = template.engine === "google_docs";

  // Administradora = a própria org. Diferente da locação (que só nomeia a
  // administradora quando há CRECI), no handlebars a org É parte do instrumento
  // — campos faltantes viram findings do render linter e gateiam o /approve.
  // No google_docs a administradora é literal no modelo (não usa esses campos).
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, legalName: true, cnpj: true, creci: true, legalAddress: true },
  });
  const administradora = {
    nome: org?.legalName ?? org?.name ?? undefined,
    cnpj: org?.cnpj ?? undefined,
    creci: org?.creci ?? undefined,
    endereco: org?.legalAddress ?? undefined,
  };

  const contractDefaults = await loadOrgLocacaoDefaults(orgId);
  const enrichedData = enrichAdministracaoData(dataJson, {
    administradora,
    contractDefaults,
  });
  const htmlContent = isGoogleDocsEngine
    ? `<p>Contrato de administração gerado a partir do modelo Google Doc (${template.name}).</p>`
    : renderContratoHTML(template.handlebarsSource, enrichedData);

  const agg = await prisma.contract.aggregate({
    where: { dealId: deal.id, kind: "administracao" },
    _max: { version: true },
  });
  const nextVersion = (agg._max.version ?? 0) + 1;

  const contract = await prisma.$transaction(async (tx) => {
    await tx.contract.updateMany({
      where: { dealId: deal.id, kind: "administracao", isLatest: true },
      data: { isLatest: false },
    });
    return tx.contract.create({
      data: {
        dealId: deal.id,
        templateId: template.id,
        userId,
        version: nextVersion,
        dataJson: enrichedData as any,
        htmlContent,
        status: "rascunho",
        isLatest: true,
        kind: "administracao",
      },
    });
  });

  // Google Doc — mesmo pipeline handlebars da locação (upload + watch + share
  // + DocumentStyle). Falha não bloqueia a criação do contrato.
  let googleDocUrl: string | undefined;
  if (isGoogleDocsFeatureEnabled()) {
    try {
      const numeroContrato = `${contract.id.slice(-8).toUpperCase()}-v${contract.version}`;
      const docName = `Administração de Locação ${contract.id} — v${contract.version}`;

      let created: { docId: string; webViewLink: string };
      if (isGoogleDocsEngine) {
        if (!template.googleTemplateDocId) {
          throw new Error("Template Google Docs sem googleTemplateDocId associado.");
        }
        const { buildLocacaoPlaceholderMap } = await import("@/lib/templates/placeholder-map");
        const { cleanupOrphanPlaceholders } = await import("@/lib/google/docs");

        const copy = await copyContractGoogleDoc({
          sourceDocId: template.googleTemplateDocId,
          name: docName,
          orgId,
        });
        created = { docId: copy.docId, webViewLink: copy.webViewLink };

        // O deal de administração É um deal de locação — reusa o mapa de
        // locação (locadores_qualificacao = CONTRATANTE/proprietário, imóvel,
        // data). Chaves não presentes no doc são ignoradas; {{token}} órfão
        // (fora do mapa) é removido pelo cleanupOrphanPlaceholders.
        const map = buildLocacaoPlaceholderMap(enrichedData);
        map["contrato_numero"] = numeroContrato;
        map["contrato_id"] = contract.id;
        map["contrato_versao"] = String(contract.version);
        // Sem replace, o contrato sai com `{{tokens}}` crus — deixa propagar.
        await replacePlaceholdersInDoc({ docId: copy.docId, replacements: map });
        await cleanupOrphanPlaceholders(copy.docId);

        // Snapshot real do conteúdo pro htmlContent (export/diff/memória).
        try {
          const { exportDocAsHtml } = await import("@/lib/google/docs");
          const snapshot = await exportDocAsHtml(copy.docId);
          await prisma.contract.update({
            where: { id: contract.id },
            data: { htmlContent: snapshot },
          });
        } catch (snapErr) {
          console.error("[administracao-generation] Falha no snapshot exportDocAsHtml:", snapErr);
        }
      } else {
        const htmlForUpload = htmlContent
          .replace(/\{\{\s*contrato\.numero\s*\}\}/g, numeroContrato)
          .replace(/\{\{\s*contrato\.id\s*\}\}/g, contract.id)
          .replace(/\{\{\s*contrato\.versao\s*\}\}/g, String(contract.version));
        created = await uploadHtmlAsGoogleDoc({
          htmlContent: htmlForUpload,
          name: docName,
          orgId,
        });
      }

      let watchData: {
        googleWatchChannel?: string;
        googleWatchResource?: string;
        googleWatchExpires?: Date;
      } = {};
      const webhookBase = process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL;
      const watchToken = process.env.GOOGLE_WATCH_TOKEN?.trim();
      if (webhookBase && watchToken) {
        try {
          const watch = await watchFile({
            fileId: created.docId,
            webhookUrl: `${webhookBase.replace(/\/$/, "")}/api/webhooks/google-drive`,
            token: watchToken,
          });
          watchData = {
            googleWatchChannel: watch.channelId,
            googleWatchResource: watch.resourceId,
            googleWatchExpires: new Date(watch.expiration),
          };
        } catch (err) {
          console.error("[administracao-generation] Falha ao registrar watch Drive:", err);
        }
      }

      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          googleDocId: created.docId,
          googleDocUrl: created.webViewLink,
          googleDocStatus: "draft",
          ...watchData,
        },
      });
      googleDocUrl = created.webViewLink;

      try {
        await shareDocWithOrgMembers(created.docId, orgId);
      } catch (shareErr) {
        console.error("[administracao-generation] Falha ao compartilhar com org members:", shareErr);
      }

      // DocumentStyle SÓ no caminho handlebars — em engine google_docs o
      // layout/timbrado vêm do modelo da imobiliária e não devem ser sobrescritos.
      if (!isGoogleDocsEngine) {
        try {
          const defaultStyle = await prisma.documentStyle.findFirst({
            where: { orgId, isDefault: true },
          });
          if (defaultStyle) {
            const { googleApplyStylePreset } = await import("@/lib/ai/google-tool-handlers");
            await googleApplyStylePreset(created.docId, {
              fontFamily: defaultStyle.fontFamily,
              fontSizeBase: defaultStyle.fontSizeBase,
              lineHeight: defaultStyle.lineHeight,
              colorPrimary: defaultStyle.colorPrimary,
              marginTopMm: defaultStyle.marginTopMm,
              marginBottomMm: defaultStyle.marginBottomMm,
              marginLeftMm: defaultStyle.marginLeftMm,
              marginRightMm: defaultStyle.marginRightMm,
            });
          }
        } catch (styleErr) {
          console.error("[administracao-generation] Falha ao aplicar DocumentStyle:", styleErr);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error("[administracao-generation] Falha ao criar Google Doc:", err);
      try {
        await prisma.contract.update({
          where: { id: contract.id },
          data: { googleDocStatus: `error: ${msg.slice(0, 500)}` },
        });
      } catch {
        // diagnóstico best-effort
      }

      // engine=google_docs não tem corpo alternativo — ver google-docs-failure.ts.
      if (isGoogleDocsEngine) {
        await rollbackFailedContract(contract.id, deal.id, "administracao");
        throw new GoogleDocsGenerationError(googleDocsFailureMessage(err, template.name), err);
      }
    }
  }

  // Render linter (genérico) — lacunas da administradora (CNPJ/CRECI vazios)
  // viram ContractComment e gateiam o /approve.
  waitUntil(
    analyzeRenderQualityForContract(contract.id, htmlContent).catch((err) => {
      console.error("[administracao-generation] analyzeRenderQualityForContract falhou:", err);
    })
  );

  return { contractId: contract.id, version: contract.version, googleDocUrl };
}

// Rótulos amigáveis pro último segmento do path obrigatório (mensagem do
// ContractComment). Fallback: o próprio nome do campo.
const REQUIRED_FIELD_LABELS: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  nome: "Nome",
  razao_social: "Razão social",
  rg: "RG",
  data_nascimento: "Data de nascimento",
  nome_mae: "Nome da mãe",
  sexo: "Sexo",
  estado_civil: "Estado civil",
  profissao: "Profissão",
  email: "E-mail",
  endereco: "Endereço",
  rua: "Logradouro",
  cidade: "Cidade",
  uf: "UF",
  cep: "CEP",
  matricula: "Matrícula",
  descricao: "Descrição",
  valor_total: "Valor total",
};

// Traduz o path obrigatório em um label legível pra parte/seção
// (ex.: "vendedores.0.cpf" → "Vendedor 1 — CPF").
function describeRequiredPath(path: string): { anchor: string; field: string } {
  const segs = path.split(".");
  const last = segs[segs.length - 1];
  const field = REQUIRED_FIELD_LABELS[last] ?? last;
  if (path === "vendedores") return { anchor: "Vendedores", field: "ao menos 1 vendedor" };
  if (path === "compradores") return { anchor: "Compradores", field: "ao menos 1 comprador" };
  const m = /^(vendedores|compradores)\.(\d+)\./.exec(path);
  if (m) {
    const label = m[1] === "vendedores" ? "Vendedor" : "Comprador";
    return { anchor: `${label} ${Number(m[2]) + 1}`, field };
  }
  if (path.startsWith("imoveis.")) {
    const mi = /^imoveis\.(\d+)\./.exec(path);
    return { anchor: `Imóvel ${mi ? Number(mi[1]) + 1 : 1}`, field };
  }
  if (path.startsWith("pagamento.")) return { anchor: "Pagamento", field };
  return { anchor: field, field };
}

/**
 * FU2/FU5 — Validação de dados críticos no nível do dataJson (não do texto
 * renderizado). Espelha o superRefine de lib/forms/validation.ts para os itens
 * que são bloqueadores legais/formais e cria ContractComment severity="error"
 * (bloqueia aprovação). Determinístico, fire-and-forget.
 *
 * Cobre (todos viram error → travam /approve):
 *  - cônjuge ausente quando casado(a)/união estável (meação);
 *  - formato inválido de CPF/CNPJ/nome/CEP/UF/telefone/data (collectPartyFormatIssues);
 *  - soma de percentuais dos comissionados > 100% e comissão zerada com participação;
 *  - soma das parcelas divergente do valor_total;
 *  - campos obrigatórios da org (OrgFormSettings/presets) vazios — SÓ para
 *    contratos gerados por formulário de VENDA (templateId != null). Contratos
 *    importados (templateId=null, dados de OCR parciais) e locação são isentos
 *    do bloco de required-paths; as demais checagens valem para todos.
 */
async function analyzeContractDataValidity(
  contractId: string,
  dataJson: Record<string, unknown>
): Promise<void> {
  const { dedupeKeyFor } = await import("@/lib/ai/quickChecks");

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      status: true,
      templateId: true,
      deal: {
        select: { kind: true, pipeline: { select: { orgId: true } } },
      },
    },
  });
  if (!contract || contract.status === "aprovado") return;

  type Parte = {
    tipo_pessoa?: string;
    nome?: string;
    estado_civil?: string;
    conjuge?: { nome?: string; cpf?: string };
  };
  const issues: Array<{ severity: "error" | "warning"; key: string; text: string; anchor: string }> = [];

  const checkParte = (p: Parte, label: string) => {
    if (p.tipo_pessoa !== "fisica") return;
    // Estado civil em branco não é mais preenchido com "Solteiro(a)" por default
    // (evita casado sem outorga). Se ficou vazio, avisa pra confirmar antes de
    // aprovar — impacta necessidade de outorga conjugal / meação.
    if (!(p.estado_civil ?? "").trim()) {
      issues.push({
        severity: "warning",
        key: `estado_civil:${label}`,
        anchor: `${label} — estado civil`,
        text: `${label} está sem ESTADO CIVIL informado. Confirme antes de aprovar — se for casado(a)/união estável, o contrato precisa de outorga conjugal e qualificação do cônjuge.`,
      });
    }
    const casado = p.estado_civil === "Casado(a)" || p.estado_civil === "União Estável";
    if (!casado) return;
    const nome = (p.conjuge?.nome ?? "").trim();
    const cpf = (p.conjuge?.cpf ?? "").trim();
    if (nome.length < 2) {
      issues.push({
        severity: "error",
        key: `conjuge_nome:${label}`,
        anchor: `${label} — cônjuge`,
        text: `${label} é casado(a)/união estável, mas o NOME do cônjuge está ausente. Obrigatório para a venda (meação). Preencha no formulário.`,
      });
    }
    if (cpf.length === 0) {
      issues.push({
        severity: "error",
        key: `conjuge_cpf:${label}`,
        anchor: `${label} — cônjuge`,
        text: `${label} é casado(a)/união estável, mas o CPF do cônjuge está ausente. Obrigatório para a venda. Preencha no formulário.`,
      });
    }
  };

  const vendedores = (dataJson.vendedores as Parte[] | undefined) ?? [];
  const compradores = (dataJson.compradores as Parte[] | undefined) ?? [];
  vendedores.forEach((v, i) => checkParte(v, `Vendedor ${i + 1} (${v.nome ?? "?"})`));
  compradores.forEach((c, i) => checkParte(c, `Comprador ${i + 1} (${c.nome ?? "?"})`));

  // Formatos (CPF/CNPJ/nome/CEP/UF/telefone/data) — mesma regra única do
  // superRefine. Campo vazio não bloqueia; preenchido com formato inválido sim.
  const checkFormats = (p: Parte, label: string) => {
    for (const fi of collectPartyFormatIssues(p as Record<string, unknown>)) {
      issues.push({
        severity: "error",
        key: `formato:${label}:${fi.path}`,
        anchor: `${label} — ${fi.path}`,
        text: `${label}: ${fi.message}. Corrija no formulário.`,
      });
    }
  };
  vendedores.forEach((v, i) => checkFormats(v, `Vendedor ${i + 1} (${v.nome ?? "?"})`));
  compradores.forEach((c, i) => checkFormats(c, `Comprador ${i + 1} (${c.nome ?? "?"})`));

  // Comissionados: soma de percentuais ≤ 100% e comissão zerada com participação.
  const comissao = (dataJson.comissao as
    | { valor?: number; comissionados?: Array<{ percentual?: number; valor?: number }> }
    | undefined) ?? {};
  const comissionados = comissao.comissionados ?? [];
  if (comissionados.length > 0) {
    const soma = comissionados.reduce((acc, c) => acc + (c.percentual ?? 0), 0);
    if (soma > 100) {
      issues.push({
        severity: "error",
        key: "comissionados_soma",
        anchor: "Comissão — comissionados",
        text: `Soma dos percentuais dos comissionados é ${soma.toFixed(2)}% (máximo 100%). Ajuste no formulário.`,
      });
    }
    const valorComissao = Number(comissao.valor ?? 0);
    const temParticipacao = comissionados.some(
      (c) => (c.percentual ?? 0) > 0 || (c.valor ?? 0) > 0
    );
    if (temParticipacao && valorComissao <= 0) {
      issues.push({
        severity: "error",
        key: "comissao_zerada",
        anchor: "Comissão — valor",
        text: "Há comissionado com participação informada, mas o valor total da comissão está zerado. Informe o valor da comissão.",
      });
    }
  }

  // Pagamento: soma das parcelas == valor_total (tolerância 0.01), só com ambos > 0.
  const pagamento = (dataJson.pagamento as
    | { valor_total?: number; parcelas?: Array<{ valor?: number }> }
    | undefined) ?? {};
  const valorTotal = pagamento.valor_total ?? 0;
  const parcelas = pagamento.parcelas ?? [];
  const somaParcelas = parcelas.reduce((acc, p) => acc + (Number(p.valor) || 0), 0);
  if (valorTotal > 0 && somaParcelas > 0 && Math.abs(valorTotal - somaParcelas) > 0.01) {
    issues.push({
      severity: "error",
      key: "parcelas_soma",
      anchor: "Pagamento — parcelas",
      text: `Soma das parcelas (R$ ${somaParcelas.toFixed(2)}) difere do valor total (R$ ${valorTotal.toFixed(2)}). Ajuste no formulário.`,
    });
  }

  // Campos obrigatórios da org (presets/OrgFormSettings) — SÓ para contratos
  // gerados por formulário de venda. Importados (templateId=null) e locação são
  // isentos: o dataJson de OCR é parcial por natureza, e em locação a
  // obrigatoriedade é cobrada no FINALIZE do formulário (422 em
  // /api/locacao/forms/[token]), não como comentário no contrato.
  const isImported = contract.templateId === null;
  const isLocacao = contract.deal?.kind === "locacao";
  const orgId = contract.deal?.pipeline?.orgId;
  if (!isImported && !isLocacao && orgId) {
    try {
      const settings = await prisma.orgFormSettings.findUnique({
        where: { orgId },
        select: { preset: true, customRequiredPaths: true },
      });
      const requiredPaths = resolveAllRequiredFields(settings).flatMap((p) =>
        Array.from(p)
      );
      const missing = findMissingRequired(requiredPaths, (path) =>
        getByPath(dataJson, path)
      );
      for (const path of missing) {
        const { anchor, field } = describeRequiredPath(path);
        issues.push({
          severity: "error",
          key: `required:${path}`,
          anchor: `${anchor} — ${field}`,
          text: `Campo obrigatório ausente: ${anchor} — ${field}. Preencha no formulário antes de aprovar.`,
        });
      }
    } catch (err) {
      console.error("[analyzeContractDataValidity] required-paths falhou:", err);
    }
  }

  for (const issue of issues) {
    const dedupeKey = dedupeKeyFor("ai", `data:${issue.key}`, issue.anchor);
    try {
      await prisma.contractComment.upsert({
        where: { contractId_dedupeKey: { contractId, dedupeKey } },
        create: {
          contractId,
          userId: null,
          authorName: "Validação de Dados",
          authorType: "ai",
          text: issue.text,
          selectedText: issue.anchor.slice(0, 240),
          anchorId: dedupeKey,
          severity: issue.severity,
          dedupeKey,
        },
        update: { updatedAt: new Date() },
      });
    } catch (err) {
      console.error("[analyzeContractDataValidity] upsert comment falhou:", err);
    }
  }
}

/**
 * A0.3 — Materializa os findings do render linter (quickChecks.renderQualityChecks)
 * como ContractComment dedupe-key'ed. Determinístico, sem LLM. Erros são engolidos
 * no caller (fire-and-forget).
 */
async function analyzeRenderQualityForContract(
  contractId: string,
  htmlContent: string
): Promise<void> {
  const { renderQualityChecks, dedupeKeyFor } = await import("@/lib/ai/quickChecks");

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { status: true },
  });
  if (!contract || contract.status === "aprovado") return;

  const findings = renderQualityChecks(htmlContent);
  for (const f of findings) {
    const dedupeKey = dedupeKeyFor("ai", `render:${f.category}`, f.selectedText);
    const text = f.suggestedFix ? `${f.message}\n\n**Sugestão:** ${f.suggestedFix}` : f.message;
    try {
      await prisma.contractComment.upsert({
        where: { contractId_dedupeKey: { contractId, dedupeKey } },
        create: {
          contractId,
          userId: null,
          authorName: "Análise de Qualidade",
          authorType: "ai",
          text,
          selectedText: f.selectedText.slice(0, 240),
          anchorId: dedupeKey,
          severity: f.severity,
          dedupeKey,
        },
        update: { updatedAt: new Date() },
      });
    } catch (err) {
      console.error("[analyzeRenderQualityForContract] upsert comment falhou:", err);
    }
  }
}

/**
 * F4 — Análise fire-and-forget de certidões existentes pro contrato recém-criado.
 * Lê CertidaoJob do deal, roda crossCheckCertidoes() (pure function), e cria
 * ContractComment dedupe-key'ed para cada finding. Usuário vê os alertas no
 * editor sem precisar pedir.
 *
 * Não bloqueia generateContractForDeal — erros são engolidos no caller.
 *
 * `triggeredByUserId`: quem disparou a geração. Vai no `userId` do ChangeLog só
 * como RASTRO (o `source` continua "system" — foi o pipeline que rodou, não a
 * pessoa; a UI rotula "Sistema"). Sem ele a entry ficava órfã de qualquer
 * vínculo com o ato humano que a originou.
 */
async function analyzeCertidoesForContract(
  contractId: string,
  dealId: string,
  _orgId: string,
  triggeredByUserId?: string | null
): Promise<void> {
  const { crossCheckCertidoes } = await import("@/lib/ai/crosscheck/certidoes");
  const { dedupeKeyFor } = await import("@/lib/ai/quickChecks");

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { dataJson: true, status: true },
  });
  if (!contract || contract.status === "aprovado") return;

  const jobs = await prisma.certidaoJob.findMany({
    where: { dealId },
    select: {
      id: true,
      endpoint: true,
      label: true,
      targetKind: true,
      targetIndex: true,
      status: true,
      resultCode: true,
      resultData: true,
      errorMessage: true,
      finishedAt: true,
      attachmentId: true,
    },
  });

  if (jobs.length === 0) {
    // Sem certidões emitidas — registra info pro usuário saber que pode
    // disparar via aba Certidões. NÃO cria comments (evita spam).
    await prisma.contractChangeLog.create({
      data: {
        contractId,
        userId: triggeredByUserId ?? null,
        action: "validation",
        summary:
          "Análise de certidões pulada — nenhum CertidaoJob emitido para o deal. Considere disparar via aba Certidões.",
        details: { trigger: "contract_generation", jobsFound: 0 } as object,
        source: "system",
      },
    });
    return;
  }

  const { findings, summary } = crossCheckCertidoes({
    contractDataJson: contract.dataJson as Record<string, unknown>,
    jobs,
  });

  // Cria ContractComment por finding (dedupe via category + targetKind + targetIndex).
  for (const finding of findings) {
    const anchorBase = `${finding.kind}:${finding.target ?? "n/a"}:${finding.endpoint ?? ""}`;
    const dedupeKey = dedupeKeyFor("ai", `crosscheck:${finding.kind}`, anchorBase);
    try {
      await prisma.contractComment.upsert({
        where: {
          contractId_dedupeKey: { contractId, dedupeKey },
        },
        create: {
          contractId,
          userId: null,
          authorName: "Análise de Certidões",
          authorType: "ai",
          text: buildCommentText(finding),
          // selectedText vazio porque a âncora não é num trecho do contrato —
          // é um alerta global. Frontend exibe no painel sem ancorar.
          selectedText: anchorBase.slice(0, 240),
          anchorId: dedupeKey,
          severity: finding.severity,
          dedupeKey,
        },
        update: { updatedAt: new Date() },
      });
    } catch (err) {
      console.error("[analyzeCertidoesForContract] upsert comment falhou:", err);
    }
  }

  await prisma.contractChangeLog.create({
    data: {
      contractId,
      userId: triggeredByUserId ?? null,
      action: "validation",
      summary: `Análise inicial de certidões: ${summary.total} achados (${summary.bySeverity.error} erros, ${summary.bySeverity.warning} warnings)`,
      details: {
        trigger: "contract_generation",
        jobsFound: jobs.length,
        summary,
      } as object,
      source: "system",
    },
  });
}

function buildCommentText(finding: import("@/lib/ai/crosscheck/certidoes").CrossCheckFinding): string {
  const parts: string[] = [finding.message];
  if (finding.suggested_aditamento) {
    parts.push(`\n**Sugestão de aditamento:**\n${finding.suggested_aditamento}`);
  }
  if (finding.manual_action?.url) {
    parts.push(`\n**Ação manual:** [${finding.manual_action.label}](${finding.manual_action.url})`);
  }
  return parts.join("\n");
}
