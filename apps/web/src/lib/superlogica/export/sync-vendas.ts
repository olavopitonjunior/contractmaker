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

import { prisma } from "@/lib/db/prisma";
import { audit, type AuditContext } from "@/lib/security/audit";
import { moveDealStage } from "@/lib/pipeline/move-stage";
import { decryptAccountCreds } from "../account";
import { createSuperlogicaClient } from "../resources";
import type { SLVenda, SLVendaParcela, SLVendaVendedor } from "../types";
import { despesaKey, getLink, putLink } from "./links";

const TARGET_STAGE = "Comissão paga";
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

/** A venda foi cancelada ou excluída do outro lado? */
export function vendaEncerrada(venda: SLVenda | null): boolean {
  if (!venda) return true; // sumiu do GET = não existe mais
  return VENDA_ENCERRADA.has(String(venda.fl_status_ven ?? ""));
}

/** Comissionados com favorecido — quem recebe a despesa. */
export function comissionadosDaVenda(venda: SLVenda): Array<{ favorecidoId: string; nome: string; valor: string }> {
  const vendedores: SLVendaVendedor[] = Array.isArray(venda.vendedores) ? venda.vendedores : [];
  const itens = Array.isArray(venda.comissoes) ? venda.comissoes : [];
  const out: Array<{ favorecidoId: string; nome: string; valor: string }> = [];
  for (const v of vendedores) {
    const favorecidoId = String(v.id_favorecido_fav ?? "").trim();
    if (!favorecidoId) continue; // sem favorecido não há a quem pagar
    // O valor em reais vem no item de comissão do mesmo vendedor; o campo do
    // vendedor pode ser percentual (`fl_valorcomissao_ang`).
    const item = itens.find((i) => String(i.id_favorecido_fav ?? "") === favorecidoId);
    const valor = String(item?.vl_item_vei ?? "").trim();
    if (!valor || Number(valor) <= 0) continue;
    out.push({ favorecidoId, nome: String(v.st_nome_pes ?? "").trim() || `Favorecido ${favorecidoId}`, valor });
  }
  return out;
}

/** `MM/DD/YYYY` — formato de data que a API de escrita aceita. */
function toApiDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

type Client = ReturnType<typeof createSuperlogicaClient>;

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
    const existing = await getLink(orgId, "despesa", key);
    if (existing) continue; // já lançada — nunca duas vezes
    const created = await client.escrita.vendas.lancarDespesa({
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
    const remoteId = String((created as { id?: unknown })?.id ?? "") || `venda:${vendaId}:${c.favorecidoId}`;
    await putLink(orgId, "despesa", key, remoteId, c.favorecidoId, { valor: c.valor, nome: c.nome });
    lancadas += 1;
  }
  return lancadas;
}

/** Uma venda exportada: lê o estado remoto e reage. Nunca lança. */
export async function syncOneVenda(row: {
  id: string;
  orgId: string;
  dealId: string;
  vendaId: string;
}): Promise<SyncOutcome> {
  const auditCtx: AuditContext = { orgId: row.orgId, userId: null };
  const base = { dealId: row.dealId, vendaId: row.vendaId };
  try {
    const account = await prisma.superlogicaAccount.findUnique({ where: { orgId: row.orgId } });
    if (!account || account.status === "disconnected") {
      return { ...base, result: "pendente", message: "conta desconectada" };
    }
    const client = createSuperlogicaClient(decryptAccountCreds(account));
    const venda = await client.escrita.vendas.get(row.vendaId);

    // 1. Sumiu, foi cancelada ou excluída lá.
    if (vendaEncerrada(venda)) {
      const message = venda
        ? `A venda ${row.vendaId} foi cancelada ou excluída na Superlógica (status ${venda.fl_status_ven}).`
        : `A venda ${row.vendaId} não existe mais na Superlógica.`;
      await prisma.superlogicaExport.update({
        where: { id: row.id },
        data: { status: "error", lastError: message, finishedAt: new Date() },
      });
      await audit(auditCtx, {
        action: "SUPERLOGICA_VENDA_CANCELED",
        result: "FAILURE",
        resource: row.dealId,
        resourceType: "Deal",
        metadata: { vendaId: row.vendaId },
      }).catch(() => {});
      return { ...base, result: "cancelada", message };
    }

    // 2. Parcela ainda aberta — nada a fazer.
    const parcela = parcelaLiquidada(venda!);
    if (!parcela) return { ...base, result: "pendente" };

    // 3. Liquidada: despesas primeiro (idempotentes), depois o funil.
    const liquidadaEm = parseSuperlogicaDate(parcela.dt_liquidacao_recb) ?? new Date();
    const despesasLancadas = await lancarDespesasComissao({
      orgId: row.orgId,
      dealId: row.dealId,
      vendaId: row.vendaId,
      venda: venda!,
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
    if (deal && deal.stage.name !== TARGET_STAGE) {
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
  for (const row of rows) {
    const outcome = await syncOneVenda({ ...row, vendaId: row.vendaId! });
    report.verificadas += 1;
    report.despesasLancadas += outcome.despesasLancadas ?? 0;
    if (outcome.result === "liquidada") report.liquidadas += 1;
    if (outcome.result === "cancelada") report.canceladas += 1;
    if (outcome.result === "erro") report.erros += 1;
    report.outcomes.push(outcome);
  }
  return report;
}
