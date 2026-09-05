// Orquestrador da exportação de um negócio de venda para a Superlógica.
// Sequência (docs/integracoes/superlogica-vendas-export.md §2.3):
//   contexto → avisos (preview) → claim ATÔMICO do SuperlogicaExport →
//   pessoas → corretores (+favorecido) → imóvel → vendas/put → GET de volta →
//   done → audit → deal para "Cobrança emitida".
// Cada id resolvido grava um SuperlogicaLink ANTES do passo seguinte, então
// uma tentativa nova pula o que já existe (retomável) — inclusive a própria
// venda — e a Superlógica barra venda duplicada por imóvel+comprador (tratada
// como sucesso). Concorrência: só UM claim vence (updateMany com guarda de
// estado / create com unique), o outro toma 409 — nunca dois pipelines.

import { createHash } from "node:crypto";
import { Prisma, type SuperlogicaAccount, type SuperlogicaExport } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit, type AuditContext } from "@/lib/security/audit";
import { moveDealStage } from "@/lib/pipeline/move-stage";
import { SUPERLOGICA_EXPORTABLE_STAGES } from "@/lib/pipeline/stage-config";
import { decryptAccountCreds, superlogicaVendaUrl } from "../account";
import { createSuperlogicaClient } from "../resources";
import { SuperlogicaDuplicateError } from "../client";
import type { SLVenda } from "../types";
import {
  buildCorretorPayload,
  buildImovelPayload,
  buildPessoaPayload,
  buildVendaPayload,
  extractVendaSource,
  imovelIdentificador,
  validarVendaSource,
  VendaExportBlockedError,
  type ExportWarning,
  type ResolvedIds,
  type VendaExportDefaults,
  type VendaSource,
} from "./build-venda-payload";

/** Stages de venda a partir dos quais se pode exportar (fonte única: stage-config). */
export const EXPORTABLE_STAGES = SUPERLOGICA_EXPORTABLE_STAGES;
const TARGET_STAGE = "Cobrança emitida";
/**
 * Duração máxima da rota de exportação (segundos) — declarada literalmente
 * em `api/deals/[dealId]/superlogica/export/route.ts` (`maxDuration = 300`).
 * A janela de "running abandonado" deriva daqui: só depois de a função ter
 * certamente morrido é que outro claim pode assumir.
 */
export const EXPORT_MAX_DURATION_S = 300;
const RUNNING_STALE_MS = (EXPORT_MAX_DURATION_S + 60) * 1000;

/** Cobranças Asaas que ainda contam como "ativas" (mesma lista de regress-stage). */
const INACTIVE_CHARGE_STATUSES = ["CANCELLED", "REFUNDED", "REFUND_PENDING", "CHARGEBACK"];

/**
 * Erro previsto do fluxo, mapeável para HTTP sem vazar texto interno:
 * 404 não achado · 409 estado (stage, conta, andamento) · 502 a Superlógica
 * devolveu algo inesperado · 422 dado do negócio que impede exportar.
 */
export class ExportNotAllowedError extends Error {
  constructor(
    message: string,
    public readonly status: 404 | 409 | 422 | 502 = 409,
  ) {
    super(message);
    this.name = "ExportNotAllowedError";
  }
}

export interface ExportContext {
  deal: {
    id: string;
    title: string;
    value: number | null;
    kind: string;
    stageName: string;
    stageId: string;
    pipelineId: string;
    /** Assinatura: envelope fechado > override manual > null. */
    contractSignedAt: Date | null;
    dataJson: unknown;
    /** Cobranças de comissão Asaas ainda ativas (exclusividade Asaas × Superlógica). */
    activeAsaasCharges: number;
  };
  orgId: string;
  account: SuperlogicaAccount;
  existing: SuperlogicaExport | null;
}

export async function loadExportContext(orgId: string, dealId: string): Promise<ExportContext> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, pipeline: { orgId } },
    select: {
      id: true,
      title: true,
      value: true,
      kind: true,
      stageId: true,
      pipelineId: true,
      contractSignedAt: true,
      stage: { select: { name: true } },
      form: { select: { dataJson: true } },
      envelopes: {
        where: { source: "contract", status: "closed", contract: { kind: "contract" } },
        select: { closedAt: true },
        orderBy: { closedAt: "desc" },
        take: 1,
      },
      commissionCharges: {
        where: { kind: "commission", cancelledAt: null, status: { notIn: INACTIVE_CHARGE_STATUSES } },
        select: { id: true },
      },
      superlogicaExport: true,
    },
  });
  if (!deal) throw new ExportNotAllowedError("Negócio não encontrado.", 404);
  if (deal.kind !== "venda")
    throw new ExportNotAllowedError("Só negócios de venda são exportados para a Superlógica.", 409);
  const account = await prisma.superlogicaAccount.findUnique({ where: { orgId } });
  if (!account || account.status === "disconnected") {
    throw new ExportNotAllowedError(
      "Superlógica não conectada. Conecte em Configurações › Integrações › Superlógica.",
      409,
    );
  }
  return {
    orgId,
    account,
    existing: deal.superlogicaExport,
    deal: {
      id: deal.id,
      title: deal.title,
      value: deal.value,
      kind: deal.kind,
      stageName: deal.stage.name,
      stageId: deal.stageId,
      pipelineId: deal.pipelineId,
      contractSignedAt: deal.envelopes[0]?.closedAt ?? deal.contractSignedAt ?? null,
      dataJson: deal.form?.dataJson ?? null,
      activeAsaasCharges: deal.commissionCharges.length,
    },
  };
}

export function defaultsFromAccount(a: SuperlogicaAccount): VendaExportDefaults {
  return {
    contaBancariaId: a.contaBancariaId,
    filialId: a.filialId,
    tipoImovelPadrao: a.tipoImovelPadrao,
    tipoPagamentoComissao: a.tipoPagamentoComissao,
    tipoRecebimentoComissao: a.tipoRecebimentoComissao,
    emitirNf: a.emitirNf,
    gerarDimob: a.gerarDimob,
    vencimentoDias: a.vencimentoDias,
    tetoValorCents: a.tetoValorCents,
  };
}

function isRunningFresh(e: SuperlogicaExport | null): boolean {
  return !!e && e.status === "running" && Date.now() - e.startedAt.getTime() < RUNNING_STALE_MS;
}

/** Avisos que dependem do contexto (não do formulário) — mesmos no preview e no export. */
function contextWarnings(ctx: ExportContext): ExportWarning[] {
  const out: ExportWarning[] = [];
  if (ctx.deal.activeAsaasCharges > 0) {
    out.push({
      code: "cobranca_asaas_ativa",
      message: `Este negócio já tem ${ctx.deal.activeAsaasCharges} cobrança(s) de comissão ativa(s) no Asaas. Cancele-as antes de exportar, senão a comissão seria cobrada duas vezes.`,
      blocking: true,
    });
  }
  if (isRunningFresh(ctx.existing)) {
    out.push({
      code: "exportacao_em_andamento",
      message: "Já existe uma exportação em andamento para este negócio. Aguarde ela terminar.",
      blocking: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export interface ExportPreview {
  /** Pode exportar agora (sem aviso bloqueante, stage certo, sem export done/running). */
  canExport: boolean;
  stageName: string;
  stageAllowed: boolean;
  exportableStages: readonly string[];
  warnings: ExportWarning[];
  existing: { status: string; vendaId: string | null; url: string | null; lastError: string | null } | null;
  /** O que vai aparecer na Superlógica (espelho da tela da venda). */
  resumo: {
    imovel: string | null;
    tipoImovel: number;
    vendedores: Array<{ nome: string; documento: string | null }>;
    compradores: Array<{ nome: string; documento: string | null }>;
    comissionados: Array<{ nome: string; papel: string; valor: number; participacao: number }>;
    valorVenda: number;
    comissaoTotal: number;
    comissaoPercentual: number;
    quemPaga: string;
    contaBancariaId: number | null;
    dataVenda: Date | null;
    prazoDias: number;
  };
}

function maskDoc(doc: string): string | null {
  if (!doc) return null;
  if (doc.length === 11) return `***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**`;
  if (doc.length === 14) return `**.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-**`;
  return "***";
}

export async function previewDealExport(orgId: string, dealId: string): Promise<ExportPreview> {
  const ctx = await loadExportContext(orgId, dealId);
  const source = extractVendaSource(ctx.deal.dataJson);
  const defaults = defaultsFromAccount(ctx.account);
  const { warnings: formWarnings, comissao, valorVenda } = validarVendaSource(source, dealInfo(ctx), defaults);
  const warnings = [...contextWarnings(ctx), ...formWarnings];
  const stageAllowed = EXPORTABLE_STAGES.includes(ctx.deal.stageName);
  const existing = ctx.existing
    ? {
        status: isRunningFresh(ctx.existing) || ctx.existing.status !== "running" ? ctx.existing.status : "error",
        vendaId: ctx.existing.vendaId,
        url: ctx.existing.vendaId ? superlogicaVendaUrl(ctx.existing.vendaId) : null,
        lastError: ctx.existing.lastError,
      }
    : null;
  const im = source.imoveis[0];
  return {
    canExport: stageAllowed && existing?.status !== "done" && !warnings.some((w) => w.blocking),
    stageName: ctx.deal.stageName,
    stageAllowed,
    exportableStages: EXPORTABLE_STAGES,
    warnings,
    existing,
    resumo: {
      imovel: im ? [im.rua, im.numero, im.complemento, im.bairro, im.cidade, im.uf].filter(Boolean).join(", ") : null,
      tipoImovel: defaults.tipoImovelPadrao,
      vendedores: source.vendedores.map((p) => ({ nome: p.nome, documento: maskDoc(p.documento) })),
      compradores: source.compradores.map((p) => ({ nome: p.nome, documento: maskDoc(p.documento) })),
      comissionados: comissao.itens.map((i) => ({ nome: i.nome, papel: i.papel, valor: i.valor, participacao: i.participacao })),
      valorVenda,
      comissaoTotal: comissao.total,
      comissaoPercentual: comissao.percentualSobreVenda,
      quemPaga: source.comissao.quemPaga,
      contaBancariaId: defaults.contaBancariaId,
      dataVenda: ctx.deal.contractSignedAt,
      prazoDias: source.comissao.prazoDias ?? defaults.vencimentoDias,
    },
  };
}

function dealInfo(ctx: ExportContext) {
  return {
    id: ctx.deal.id,
    title: ctx.deal.title,
    value: ctx.deal.value,
    contractSignedAt: ctx.deal.contractSignedAt,
  };
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

export interface ExportDealInput {
  orgId: string;
  dealId: string;
  userId: string;
  auditCtx?: AuditContext;
}

export interface ExportDealResult {
  vendaId: string;
  url: string;
  alreadyExported: boolean;
  warnings: ExportWarning[];
  movedToStage: string | null;
}

type Escrita = ReturnType<typeof createSuperlogicaClient>["escrita"];

async function getLink(orgId: string, entityType: string, localKey: string) {
  return prisma.superlogicaLink.findUnique({
    where: { orgId_entityType_localKey: { orgId, entityType, localKey } },
  });
}

async function putLink(
  orgId: string,
  entityType: string,
  localKey: string,
  remoteId: string,
  remoteAux: string | null,
  snapshot: Prisma.InputJsonValue | null,
) {
  const snapshotJson = snapshot ?? undefined;
  return prisma.superlogicaLink.upsert({
    where: { orgId_entityType_localKey: { orgId, entityType, localKey } },
    create: { orgId, entityType, localKey, remoteId, remoteAux, snapshotJson },
    update: { remoteId, remoteAux, snapshotJson, lastSyncedAt: new Date() },
  });
}

function entityKey(dealId: string, kind: "pessoa" | "corretor", role: string, index: number, doc: string): string {
  return doc ? `${kind}:${doc}` : `deal:${dealId}:${role}:${index}`;
}

/** Pessoa (vendedor/comprador): link → busca por documento → cria. */
async function resolvePessoa(
  orgId: string,
  escrita: Escrita,
  dealId: string,
  p: VendaSource["vendedores"][number],
): Promise<string> {
  const key = entityKey(dealId, "pessoa", p.role, p.index, p.documento);
  const link = await getLink(orgId, "pessoa", key);
  if (link) return link.remoteId;
  let id: string | undefined;
  let nome: string | undefined;
  if (p.documento) {
    const found = await escrita.pessoas.findByDoc(p.documento);
    if (found?.id_pessoa_pes) {
      id = String(found.id_pessoa_pes);
      nome = found.st_nome_pes;
    }
  }
  if (!id) {
    const created = await escrita.pessoas.createProprietario(buildPessoaPayload(p));
    id = String(created.data?.id_pessoa_pes ?? "");
    nome = created.data?.st_nome_pes;
    if (!id)
      throw new ExportNotAllowedError(`A Superlógica não devolveu o id ao cadastrar ${p.role} "${p.nome}".`, 502);
  }
  await putLink(orgId, "pessoa", key, id, null, { nome: nome ?? p.nome });
  return id;
}

/** Comissionado: link → busca por documento → cria; sempre com favorecido. */
async function resolveCorretor(
  orgId: string,
  escrita: Escrita,
  dealId: string,
  c: VendaSource["comissionados"][number],
): Promise<{ idPessoa: string; idFavorecido: string }> {
  const key = entityKey(dealId, "corretor", "comissionado", c.index, c.documento);
  const link = await getLink(orgId, "corretor", key);
  if (link?.remoteAux) return { idPessoa: link.remoteId, idFavorecido: link.remoteAux };
  let idPessoa = link?.remoteId;
  if (!idPessoa && c.documento) {
    const found = await escrita.pessoas.findByDoc(c.documento);
    if (found?.id_pessoa_pes) idPessoa = String(found.id_pessoa_pes);
  }
  if (!idPessoa) {
    const created = await escrita.pessoas.createCorretor(buildCorretorPayload(c));
    idPessoa = String(created.data?.id_pessoa_pes ?? "");
    if (!idPessoa)
      throw new ExportNotAllowedError(`A Superlógica não devolveu o id ao cadastrar o corretor "${c.nome}".`, 502);
  }
  // O favorecido (contas a pagar) vem do GET de corretores, não do POST.
  const corretor = await escrita.pessoas.findCorretorById(idPessoa);
  const idFavorecido = corretor?.id_favorecido_fav ? String(corretor.id_favorecido_fav) : "";
  if (!idFavorecido) {
    throw new ExportNotAllowedError(
      `O comissionado "${c.nome}" existe na Superlógica (id ${idPessoa}) mas não como corretor com favorecido. Cadastre-o como corretor lá e tente de novo.`,
      422,
    );
  }
  await putLink(orgId, "corretor", key, idPessoa, idFavorecido, { nome: corretor?.st_nome_pes ?? c.nome });
  return { idPessoa, idFavorecido };
}

/** Imóvel: link → busca pelo identificador `cm:<dealId>` → cria. */
async function resolveImovel(
  orgId: string,
  escrita: Escrita,
  ctx: ExportContext,
  source: VendaSource,
  proprietarios: string[],
  valorVenda: number,
): Promise<string> {
  const key = `deal:${ctx.deal.id}`;
  const link = await getLink(orgId, "imovel", key);
  if (link) return link.remoteId;
  const identificador = imovelIdentificador(ctx.deal.id);
  let id: string | undefined;
  const found = await escrita.imoveis.findByIdentificador(identificador);
  if (found?.id_imovel_imo) id = String(found.id_imovel_imo);
  if (!id) {
    const created = await escrita.imoveis.create(
      buildImovelPayload({
        imovel: source.imoveis[0],
        dealId: ctx.deal.id,
        proprietarios: proprietarios.map((idPessoa) => ({ idPessoa })),
        tipoImovel: ctx.account.tipoImovelPadrao,
        valorVenda,
      }),
    );
    id = String(created.data?.id_imovel_imo ?? "");
    if (!id) throw new ExportNotAllowedError("A Superlógica não devolveu o id ao cadastrar o imóvel.", 502);
  }
  await putLink(orgId, "imovel", key, id, null, { identificador });
  return id;
}

function summarizeVenda(v: SLVenda | null): Prisma.InputJsonValue | undefined {
  if (!v) return undefined;
  return {
    id_venda_ven: v.id_venda_ven ?? null,
    dt_venda_ven: v.dt_venda_ven ?? null,
    vl_total_ven: v.vl_total_ven ?? null,
    vl_comissao_ven: v.vl_comissao_ven ?? null,
    fl_status_ven: v.fl_status_ven ?? null,
    vendedores: (v.vendedores ?? []).map((x) => ({ id: x.id_vendedor_vev ?? null, fav: x.id_favorecido_fav ?? null, pct: x.vl_comissao_ang ?? null })),
    comissoes: (v.comissoes ?? []).map((x) => ({ item: x.id_item_vei ?? null, valor: x.vl_item_vei ?? null, venc: x.dt_vencimento_vei ?? null })),
    parcelas: (v.comissao_parcelas ?? []).map((x) => ({ id: x.id_recebimento_recb ?? null, valor: x.vl_total_recb ?? null, status: x.fl_status_recb ?? null })),
  };
}

/**
 * Reserva a exportação para ESTE chamador, atomicamente:
 *  - sem registro → `create` (unique `dealId`: o perdedor de uma corrida toma P2002);
 *  - registro `error` ou `running` abandonado → `updateMany` com guarda de
 *    estado (count 0 = alguém assumiu antes).
 * Molde: claim de transferência em api/financeiro/transfers (updateMany + count).
 */
async function claimExport(orgId: string, dealId: string, userId: string, existing: SuperlogicaExport | null) {
  const now = new Date();
  if (!existing) {
    try {
      return await prisma.superlogicaExport.create({
        data: { orgId, dealId, status: "running", createdById: userId, startedAt: now },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ExportNotAllowedError("Já existe uma exportação em andamento para este negócio.", 409);
      }
      throw err;
    }
  }
  const claimed = await prisma.superlogicaExport.updateMany({
    where: {
      id: existing.id,
      OR: [{ status: "error" }, { status: "running", startedAt: { lt: new Date(now.getTime() - RUNNING_STALE_MS) } }],
    },
    data: { status: "running", createdById: userId, startedAt: now, finishedAt: null, lastError: null },
  });
  if (claimed.count === 0) {
    throw new ExportNotAllowedError("Já existe uma exportação em andamento para este negócio.", 409);
  }
  return { ...existing, status: "running", startedAt: now };
}

export async function exportDeal(input: ExportDealInput): Promise<ExportDealResult> {
  const { orgId, dealId, userId } = input;
  const ctx = await loadExportContext(orgId, dealId);
  const auditCtx: AuditContext = input.auditCtx ?? { orgId, userId };

  if (ctx.existing?.status === "done" && ctx.existing.vendaId) {
    return {
      vendaId: ctx.existing.vendaId,
      url: superlogicaVendaUrl(ctx.existing.vendaId),
      alreadyExported: true,
      warnings: [],
      movedToStage: null,
    };
  }
  if (!EXPORTABLE_STAGES.includes(ctx.deal.stageName)) {
    throw new ExportNotAllowedError(
      `A venda só é exportada a partir de "${EXPORTABLE_STAGES[0]}" (negócio está em "${ctx.deal.stageName}").`,
      409,
    );
  }

  const source = extractVendaSource(ctx.deal.dataJson);
  const defaults = defaultsFromAccount(ctx.account);
  const pre = validarVendaSource(source, dealInfo(ctx), defaults);
  // "Em andamento" é tratado pelo claim atômico abaixo (409), não como aviso
  // de dado do negócio (422).
  const blocking = [
    ...contextWarnings(ctx).filter((w) => w.code !== "exportacao_em_andamento"),
    ...pre.warnings,
  ].filter((w) => w.blocking);
  if (blocking.length) throw new VendaExportBlockedError(blocking);

  const { escrita } = createSuperlogicaClient(decryptAccountCreds(ctx.account));
  const exportRow = await claimExport(orgId, dealId, userId, ctx.existing);

  try {
    // 1. Pessoas (vendedores, compradores) — na ordem do form.
    const vendedoresIds: string[] = [];
    for (const p of source.vendedores) vendedoresIds.push(await resolvePessoa(orgId, escrita, dealId, p));
    const compradores: ResolvedIds["compradores"] = {};
    for (const p of source.compradores) compradores[p.index] = await resolvePessoa(orgId, escrita, dealId, p);

    // 2. Comissionados (com favorecido).
    const comissionados: ResolvedIds["comissionados"] = {};
    for (const c of source.comissionados) comissionados[c.index] = await resolveCorretor(orgId, escrita, dealId, c);

    // 3. Imóvel.
    const imovelId = await resolveImovel(orgId, escrita, ctx, source, vendedoresIds, pre.valorVenda);

    // 4. Venda: link já existente (tentativa anterior morreu depois do put) →
    //    reutiliza; senão payload puro + put; anti-duplicidade = sucesso.
    const built = buildVendaPayload({
      source,
      deal: dealInfo(ctx),
      defaults,
      ids: { imovelId, compradores, comissionados },
    });
    const payloadHash = createHash("sha256").update(JSON.stringify(built.payload)).digest("hex");
    const vendaLinkKey = `deal:${dealId}`;
    let vendaId: string;
    const vendaLink = await getLink(orgId, "venda", vendaLinkKey);
    if (vendaLink) {
      vendaId = vendaLink.remoteId;
    } else {
      try {
        const created = await escrita.vendas.create(built.payload);
        vendaId = String(created.data?.id_venda_ven ?? "");
        if (!vendaId)
          throw new ExportNotAllowedError("A Superlógica não devolveu o id da venda criada.", 502);
      } catch (err) {
        if (err instanceof SuperlogicaDuplicateError) vendaId = err.existingId;
        else throw err;
      }
      await putLink(orgId, "venda", vendaLinkKey, vendaId, null, null);
    }

    // 5. Leitura de volta (o que ficou na Superlógica) e fechamento.
    const venda = await escrita.vendas.get(vendaId).catch(() => null);
    await prisma.superlogicaExport.update({
      where: { id: exportRow.id },
      data: {
        status: "done",
        vendaId,
        payloadHash,
        payloadJson: built.payload as unknown as Prisma.InputJsonValue,
        responseJson: summarizeVenda(venda),
        warningsJson: built.warnings as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        lastError: null,
      },
    });
    await audit(auditCtx, {
      action: "SUPERLOGICA_VENDA_CREATED",
      result: "SUCCESS",
      resource: dealId,
      resourceType: "Deal",
      metadata: {
        vendaId,
        valorVenda: pre.valorVenda,
        comissao: pre.comissao.total,
        comissionados: source.comissionados.length,
        compradores: source.compradores.length,
        avisos: built.warnings.map((w) => w.code),
      },
    }).catch(() => {});

    // 6. Funil: "Contrato assinado" → "Cobrança emitida" (a cobrança agora é da Superlógica).
    let movedToStage: string | null = null;
    if (ctx.deal.stageName !== TARGET_STAGE) {
      const target = await prisma.pipelineStage.findFirst({
        where: { pipelineId: ctx.deal.pipelineId, name: TARGET_STAGE },
        select: { id: true },
      });
      if (target) {
        await moveDealStage({
          dealId,
          toStageId: target.id,
          reason: "superlogica_export",
          actorUserId: userId,
          orgId,
          dealData: { chargeIssuedAt: new Date() },
          auditMetadata: { vendaId },
          auditCtx,
        });
        movedToStage = TARGET_STAGE;
      }
    }

    return { vendaId, url: superlogicaVendaUrl(vendaId), alreadyExported: false, warnings: built.warnings, movedToStage };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 800);
    await prisma.superlogicaExport
      .update({ where: { id: exportRow.id }, data: { status: "error", lastError: message, finishedAt: new Date() } })
      .catch(() => {});
    await audit(auditCtx, {
      action: "SUPERLOGICA_VENDA_FAILED",
      result: "FAILURE",
      resource: dealId,
      resourceType: "Deal",
      metadata: { message },
    }).catch(() => {});
    throw err;
  }
}
