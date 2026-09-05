// Fecha o ciclo da exportação: a Superlógica é quem cobra a comissão, então é
// dela que vem a notícia de que o dinheiro entrou. Este módulo lê as vendas
// exportadas e reage a dois desfechos:
//
//   parcela liquidada  → negócio vai para "Comissão paga" e a despesa de cada
//                        comissionado é lançada (conta contábil da org);
//   venda cancelada/excluída lá → a exportação vira `error` com aviso, e o
//                        negócio fica onde está (quem desfez foi uma pessoa do
//                        outro lado; mover o funil sozinho esconderia isso).
//
// Idempotência é requisito, não detalhe: `lancarDespesa` move dinheiro de
// verdade. Cada lançamento grava um SuperlogicaLink `despesa` ANTES do próximo,
// e o link é conferido antes de lançar — um tick repetido não paga duas vezes.

import type { SuperlogicaAccount } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit, type AuditContext } from "@/lib/security/audit";
import { moveDealStage } from "@/lib/pipeline/move-stage";
import { decryptAccountCreds } from "../account";
import { createSuperlogicaClient } from "../resources";
import type { SLVenda, SLVendaParcela, SLVendaVendedor } from "../types";
import { claimLink, completeLink, despesaKey, LINK_PENDING } from "./links";

const TARGET_STAGE = "Comissão paga";
/** Stages a partir dos quais o negócio pode avançar para "Comissão paga". */
const STAGES_ANTERIORES: readonly string[] = [
  "Formulário",
  "Confecção de Contrato",
  "Enviado para assinatura",
  "Contrato assinado",
  "Cobrança emitida",
];
/** Status da parcela na Superlógica. */
const PARCELA_LIQUIDADA = "1";
/** `fl_status_ven`: "" ativa · 1 cancelada · 2 pendente · -1 excluída. */
const VENDA_ENCERRADA = new Set(["1", "-1"]);
/** Teto por execução — o cron roda a cada 30 min e cada venda é 1 GET. */
export const SYNC_MAX_VENDAS = 100;

export interface SyncOutcome {
  dealId: string;
  vendaId: string;
  /** `liquidada` | `cancelada` | `pendente` | `erro` */
  result: "liquidada" | "cancelada" | "pendente" | "erro";
  movedToStage?: string | null;
  despesasLancadas?: number;
  message?: string;
}

export interface SyncReport {
  verificadas: number;
  liquidadas: number;
  canceladas: number;
  erros: number;
  despesasLancadas: number;
  outcomes: SyncOutcome[];
}

/** Data brasileira/ISO da Superlógica → Date; inválida ou vazia → null. */
export function parseSuperlogicaDate(raw: unknown): Date | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  // MM/DD/YYYY (o que a API devolve) ou YYYY-MM-DD.
  const us = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (us) {
    const d = new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]), 12, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Primeira parcela liquidada da comissão, se houver.
 *
 * Fail-closed: status que não seja exatamente o de liquidada NÃO conta. A venda
 * pode trazer parcela com status desconhecido (versão nova da API, campo vazio)
 * e "não sei" nunca pode virar "pagou".
 */
export function parcelaLiquidada(venda: SLVenda): SLVendaParcela | null {
  const parcelas = Array.isArray(venda.comissao_parcelas) ? venda.comissao_parcelas : [];
  return parcelas.find((p) => String(p.fl_status_recb ?? "") === PARCELA_LIQUIDADA) ?? null;
}

/**
 * A venda foi cancelada ou excluída do outro lado?
 *
 * Só com `fl_status_ven` presente e conhecido. Um GET que volta vazio pode ser
 * rate limit, permissão momentânea ou paginação — declarar "cancelada" na
 * primeira ausência marcaria a exportação com erro para sempre, e ela sairia
 * do escopo da varredura. Ausência é "não sei", e "não sei" não vira ação.
 */
export function vendaEncerrada(venda: SLVenda | null): boolean {
  if (!venda) return false;
  return VENDA_ENCERRADA.has(String(venda.fl_status_ven ?? ""));
}

/** Comissionados com favorecido — quem recebe a despesa. */
export function comissionadosDaVenda(venda: SLVenda): Array<{ favorecidoId: string; nome: string; valor: string }> {
  const vendedores: SLVendaVendedor[] = Array.isArray(venda.vendedores) ? venda.vendedores : [];
  const itens = Array.isArray(venda.comissoes) ? venda.comissoes : [];
  const out: Array<{ favorecidoId: string; nome: string; valor: string }> = [];
  const vistos = new Set<string>();
  for (const v of vendedores) {
    const favorecidoId = String(v.id_favorecido_fav ?? "").trim();
    if (!favorecidoId) continue; // sem favorecido não há a quem pagar
    // Um favorecido rende UM lançamento (a chave da reserva é por favorecido).
    if (vistos.has(favorecidoId)) continue;
    // O valor em reais vem no item de COMISSÃO do mesmo favorecido. Depois do
    // primeiro lançamento a venda passa a trazer também o item de DESPESA, que
    // pode repetir o favorecido — casar com ele pagaria o valor errado.
    const item = itens.find(
      (i) =>
        String(i.id_favorecido_fav ?? "") === favorecidoId &&
        String(i.fl_despesa ?? "0") !== "1" &&
        String(i.fl_tipo_vei ?? "3") !== "2",
    );
    const valor = String(item?.vl_item_vei ?? "").trim();
    const num = Number(valor);
    // `Number("abc") <= 0` é falso: sem o teste de finitude, texto viraria valor.
    if (!valor || !Number.isFinite(num) || num <= 0) continue;
    vistos.add(favorecidoId);
    out.push({ favorecidoId, nome: String(v.st_nome_pes ?? "").trim() || `Favorecido ${favorecidoId}`, valor });
  }
  return out;
}

/**
 * Id do lançamento na resposta da Superlógica. A escrita devolve
 * `{ data, msg }`, e o id do movimento vem dentro de `data` — o nome do campo
 * varia por endpoint, então tentamos os conhecidos. Vazio = não sabemos qual
 * lançamento foi criado (a reserva continua valendo, ninguém paga de novo).
 */
export function extrairIdLancamento(resp: unknown): string {
  const data = (resp as { data?: unknown } | null)?.data;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return "";
  const candidatos = ["id_movimento_mov", "id_lancamento_mov", "id_movimentacao_mov", "id_item_vei", "id"];
  for (const campo of candidatos) {
    const v = (row as Record<string, unknown>)[campo];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return "";
}

/** `MM/DD/YYYY` — formato de data que a API de escrita aceita. */
function toApiDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

type Client = ReturnType<typeof createSuperlogicaClient>;

/**
 * Marca a linha como visitada mesmo quando nada mudou.
 *
 * A varredura pega as N mais antigas por `updatedAt`. Sem tocar a data, uma
 * venda que nunca resolve (parcela aberta, erro permanente) fica eternamente
 * no topo da fila, e a partir da N+1 nenhuma outra venda é consultada nunca —
 * comissão paga que ninguém vê.
 */
async function tocar(id: string, lastError: string | null): Promise<void> {
  await prisma.superlogicaExport
    .update({ where: { id }, data: { updatedAt: new Date(), lastError } })
    .catch(() => {});
}

/**
 * Lança a despesa de cada comissionado, uma vez só por (negócio, favorecido).
 * Devolve quantas foram lançadas AGORA (as já existentes não contam).
 */
export async function lancarDespesasComissao(args: {
  orgId: string;
  dealId: string;
  vendaId: string;
  venda: SLVenda;
  client: Client;
  contaBancariaId: number | null;
  contaContabil: string;
  contaContabilDescricao: string;
  vencimento: Date;
}): Promise<number> {
  const { orgId, dealId, vendaId, venda, client, contaBancariaId, contaContabil, contaContabilDescricao, vencimento } =
    args;
  if (!contaBancariaId) return 0; // sem conta bancária não há como lançar
  let lancadas = 0;
  for (const c of comissionadosDaVenda(venda)) {
    const key = despesaKey(dealId, c.favorecidoId);
    // RESERVA antes de mover dinheiro. Quem cria a linha vence; quem perde
    // desiste. Nunca "lê, chama a API, escreve" — a janela entre a leitura e a
    // escrita é exatamente onde nasce o pagamento duplicado.
    const claim = await claimLink(orgId, "despesa", key);
    if (!claim) continue;
    let created: unknown;
    try {
      created = await client.escrita.vendas.lancarDespesa({
        ID_VENDA_VEN: vendaId,
        ID_CONTABANCO_CB: String(contaBancariaId),
        DT_VENCIMENTO_MOV: toApiDay(vencimento),
        VL_VALOR_MOV: c.valor,
        ID_FAVORECIDO_FAV: c.favorecidoId,
        ST_FANTASIA_FAV: c.nome,
        ST_CONTA_CONT: contaContabil,
        ST_DESCRICAO_CONT: contaContabilDescricao,
        ST_COMPLEMENTO_DES: `Comissão — Contractmaker negócio ${dealId}`,
      });
    } catch (err) {
      // A reserva FICA. Uma falha aqui é ambígua — a Superlógica pode ter
      // processado antes de a resposta se perder. Apagar a reserva reabriria a
      // janela do pagamento em dobro; o lançamento preso em `pending` é
      // conferido por gente, que é o custo certo a pagar.
      throw err;
    }
    const remoteId = extrairIdLancamento(created);
    await completeLink(claim.id, remoteId || LINK_PENDING, c.favorecidoId, {
      valor: c.valor,
      nome: c.nome,
      // Sem id de retorno o lançamento existe mas não é rastreável: fica
      // marcado para conferência, e ainda assim ninguém paga de novo.
      idAusente: remoteId ? undefined : true,
    });
    lancadas += 1;
  }
  return lancadas;
}

type ContaCache = Map<string, SuperlogicaAccount | null>;

/** Conta da org, uma consulta por org por execução (a fila mistura orgs). */
async function carregarConta(orgId: string, cache?: ContaCache): Promise<SuperlogicaAccount | null> {
  if (cache?.has(orgId)) return cache.get(orgId) ?? null;
  const account = await prisma.superlogicaAccount.findUnique({ where: { orgId } });
  cache?.set(orgId, account);
  return account;
}

/** Uma venda exportada: lê o estado remoto e reage. Nunca lança. */
export async function syncOneVenda(
  row: {
    id: string;
    orgId: string;
    dealId: string;
    vendaId: string;
  },
  cache?: ContaCache,
): Promise<SyncOutcome> {
  const auditCtx: AuditContext = { orgId: row.orgId, userId: null };
  const base = { dealId: row.dealId, vendaId: row.vendaId };
  try {
    const account = await carregarConta(row.orgId, cache);
    if (!account || account.status === "disconnected") {
      await tocar(row.id, "Superlógica desconectada para esta imobiliária.");
      return { ...base, result: "pendente", message: "conta desconectada" };
    }
    const client = createSuperlogicaClient(decryptAccountCreds(account));
    const venda = await client.escrita.vendas.get(row.vendaId);

    // 1. Sem resposta: não sabemos nada. Tenta de novo no próximo tick.
    if (!venda) {
      await tocar(row.id, `A Superlógica não devolveu a venda ${row.vendaId} nesta consulta.`);
      return { ...base, result: "pendente", message: "venda não retornada" };
    }

    // 2. Cancelada ou excluída lá.
    if (vendaEncerrada(venda)) {
      const message = `A venda ${row.vendaId} foi cancelada ou excluída na Superlógica (status ${venda.fl_status_ven}).`;
      await prisma.superlogicaExport.update({
        where: { id: row.id },
        data: { status: "error", lastError: message, finishedAt: new Date() },
      });
      await audit(auditCtx, {
        action: "SUPERLOGICA_VENDA_CANCELLED",
        result: "FAILURE",
        resource: row.dealId,
        resourceType: "Deal",
        metadata: { vendaId: row.vendaId },
      }).catch(() => {});
      return { ...base, result: "cancelada", message };
    }

    // 2. Parcela ainda aberta — nada a fazer.
    const parcela = parcelaLiquidada(venda);
    if (!parcela) {
      await tocar(row.id, null);
      return { ...base, result: "pendente" };
    }

    // 3. Liquidada: despesas primeiro (idempotentes), depois o funil.
    const liquidadaEm = parseSuperlogicaDate(parcela.dt_liquidacao_recb) ?? new Date();
    const despesasLancadas = await lancarDespesasComissao({
      orgId: row.orgId,
      dealId: row.dealId,
      vendaId: row.vendaId,
      venda,
      client,
      contaBancariaId: account.contaBancariaId,
      contaContabil: account.contaContabilComissao,
      contaContabilDescricao: account.contaContabilDescricao,
      vencimento: liquidadaEm,
    });

    const deal = await prisma.deal.findUnique({
      where: { id: row.dealId },
      select: { pipelineId: true, stage: { select: { name: true } } },
    });
    let movedToStage: string | null = null;
    // Guard de regressão, como toda auto-transição do funil: só avança quem
    // está num stage ANTERIOR. Sem ele, um negócio marcado como perdido entre
    // a leitura da varredura e este ponto seria ressuscitado, apagando o
    // motivo da perda que alguém registrou à mão.
    if (deal && deal.stage.name !== TARGET_STAGE && STAGES_ANTERIORES.includes(deal.stage.name)) {
      const target = await prisma.pipelineStage.findFirst({
        where: { pipelineId: deal.pipelineId, name: TARGET_STAGE },
        select: { id: true },
      });
      if (target) {
        await moveDealStage({
          dealId: row.dealId,
          toStageId: target.id,
          reason: "superlogica_liquidacao",
          actorUserId: null,
          orgId: row.orgId,
          dealData: { commissionPaidAt: liquidadaEm },
          auditMetadata: { vendaId: row.vendaId, parcela: parcela.id_recebimento_recb ?? null },
          auditCtx,
        });
        movedToStage = TARGET_STAGE;
      }
    }
    await audit(auditCtx, {
      action: "SUPERLOGICA_COMISSAO_LIQUIDADA",
      result: "SUCCESS",
      resource: row.dealId,
      resourceType: "Deal",
      metadata: { vendaId: row.vendaId, despesasLancadas, movedToStage, liquidadaEm: liquidadaEm.toISOString() },
    }).catch(() => {});
    return { ...base, result: "liquidada", movedToStage, despesasLancadas };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    // Registra o erro E gira a fila: sem isso esta linha volta em todo tick,
    // ocupa uma vaga para sempre e esconde as vendas que vêm atrás.
    await tocar(row.id, message);
    return { ...base, result: "erro", message };
  }
}

/**
 * Varre as vendas exportadas que ainda podem mudar de estado.
 * Um negócio já em "Comissão paga" (ou perdido) não é consultado de novo.
 */
export async function syncSuperlogicaVendas(limit = SYNC_MAX_VENDAS): Promise<SyncReport> {
  const rows = await prisma.superlogicaExport.findMany({
    where: {
      status: "done",
      vendaId: { not: null },
      deal: { stage: { name: { notIn: [TARGET_STAGE, "Negócio perdido"] } } },
    },
    select: { id: true, orgId: true, dealId: true, vendaId: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  const report: SyncReport = {
    verificadas: 0,
    liquidadas: 0,
    canceladas: 0,
    erros: 0,
    despesasLancadas: 0,
    outcomes: [],
  };
  const cache: ContaCache = new Map();
  for (const row of rows) {
    const outcome = await syncOneVenda({ ...row, vendaId: row.vendaId! }, cache);
    report.verificadas += 1;
    report.despesasLancadas += outcome.despesasLancadas ?? 0;
    if (outcome.result === "liquidada") report.liquidadas += 1;
    if (outcome.result === "cancelada") report.canceladas += 1;
    if (outcome.result === "erro") report.erros += 1;
    report.outcomes.push(outcome);
  }
  return report;
}
