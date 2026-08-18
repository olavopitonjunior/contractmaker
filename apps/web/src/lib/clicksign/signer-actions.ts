import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  addRequirement,
  addSigner,
  bulkRequirements,
  listEnvelopeRequirements,
  notifySigner,
  removeRequirement,
  removeSigner,
  updateSigner,
  type BulkRequirementOp,
} from "./envelopes";
import { ClicksignError, type ClicksignCreds } from "./client";
import { getSignatureSettings, resolveClickSignCreds } from "./account";
import type { ClicksignRole } from "./roles";
import type { AuthMethod } from "./types";

export const RESEND_COOLDOWN_MS = 60 * 60 * 1000; // 1h
export const MAX_RESENDS = 5;

type SignerWithEnvelope = Prisma.EnvelopeSignerGetPayload<{
  include: { envelope: true };
}>;
type Envelope = Prisma.EnvelopeGetPayload<object>;
type Signer = Prisma.EnvelopeSignerGetPayload<object>;

/** Resultado uniforme — a rota traduz pra NextResponse (sucesso ou erro+status). */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/** Reenvia a notificação de assinatura (com cooldown + limite). */
export async function resendSignerAction(
  signer: SignerWithEnvelope
): Promise<ActionResult<Signer>> {
  if (signer.status === "signed" || signer.status === "removed") {
    return { ok: false, status: 400, error: "Signatário não pode ser reenviado neste estado" };
  }
  if (signer.resendCount >= MAX_RESENDS) {
    return { ok: false, status: 429, error: `Limite de ${MAX_RESENDS} reenvios atingido` };
  }
  if (
    signer.lastResendAt &&
    Date.now() - signer.lastResendAt.getTime() < RESEND_COOLDOWN_MS
  ) {
    const wait = Math.ceil(
      (RESEND_COOLDOWN_MS - (Date.now() - signer.lastResendAt.getTime())) / 60000
    );
    return { ok: false, status: 429, error: `Aguarde ${wait} min antes de reenviar` };
  }

  // Sem os IDs remotos ou creds NÃO há o que reenviar — antes este caso caía
  // num no-op silencioso que ainda incrementava resendCount e marcava
  // "notified": a UI dizia "Lembrete enviado" pra um reenvio que não chamou a
  // ClickSign (justamente o cenário do envio interrompido, em que o signer
  // ficou sem clicksignId). Falhar explícito pro operador usar o /sync ou
  // reenviar a proposta.
  const creds = await resolveClickSignCreds(signer.envelope.orgId);
  if (!signer.envelope.clicksignId || !signer.clicksignId) {
    return {
      ok: false,
      status: 409,
      error:
        "Signatário sem vínculo na ClickSign (envio incompleto) — sincronize o envelope ou reenvie a proposta",
    };
  }
  if (!creds) {
    return { ok: false, status: 503, error: "Credenciais ClickSign não configuradas para a organização" };
  }
  try {
    await notifySigner(signer.envelope.clicksignId, signer.clicksignId, creds);
  } catch (err) {
    if (err instanceof ClicksignError) {
      return { ok: false, status: 502, error: `Clicksign: ${err.message}` };
    }
    throw err;
  }

  const updated = await prisma.envelopeSigner.update({
    where: { id: signer.id },
    data: {
      resendCount: { increment: 1 },
      lastResendAt: new Date(),
      ...(signer.status === "pending"
        ? { status: "notified", notifiedAt: new Date() }
        : {}),
    },
  });
  return { ok: true, data: updated };
}

export interface SignerUpdate {
  name?: string;
  email?: string;
  documentation?: string;
  phone?: string;
  /** Qualificação ClickSign ("Assina como"). Trocar recria o requirement `agree`. */
  role?: ClicksignRole;
  /** Tipo de assinatura (auth). Trocar recria o requirement `provide_evidence`. */
  authMethod?: AuthMethod;
}

/**
 * O POST atômico APLICOU na ClickSign, mas não conseguimos confirmar os IDs
 * dos requirements novos (atomic:results incompleto E diff falhou/ambíguo).
 * Semântica distinta de ClicksignError (que significa "nada aplicou"): quem
 * captura decide como reconciliar sabendo que o lado remoto JÁ mudou.
 */
class BulkRequirementsUnconfirmedError extends Error {
  constructor(public readonly found: number) {
    super(
      `bulk_requirements aplicado, mas IDs novos não confirmados (esperado 2, encontrei ${found})`
    );
    this.name = "BulkRequirementsUnconfirmedError";
  }
}

/** IDs de requirements criados numa resposta `atomic:results` (bulk). */
function pickAtomicRequirementIds(resp: unknown): string[] {
  if (!resp || typeof resp !== "object") return [];
  const results = (resp as Record<string, unknown>)["atomic:results"];
  if (!Array.isArray(results)) return [];
  const ids: string[] = [];
  for (const entry of results) {
    const data = (entry as { data?: { type?: string; id?: string } | null })
      ?.data;
    if (data?.id && (!data.type || data.type === "requirements")) {
      ids.push(data.id);
    }
  }
  return ids;
}

/** IDs de todos os requirements do envelope (pra diff antes/depois do bulk). */
async function listRequirementIds(
  envelopeClicksignId: string,
  creds: ClicksignCreds
): Promise<Set<string>> {
  const resp = await listEnvelopeRequirements(envelopeClicksignId, creds);
  const data = (resp as { data?: unknown })?.data;
  const ids = new Set<string>();
  if (Array.isArray(data)) {
    for (const item of data) {
      const id = (item as { id?: string })?.id;
      if (id) ids.add(id);
    }
  }
  return ids;
}

/**
 * Cria os 2 requirements do signatário (auth + qualificação) e opcionalmente
 * remove os antigos, TUDO numa única chamada atômica `bulk_requirements`.
 * É o único caminho que a ClickSign aceita em envelope `running` — o
 * `POST /requirements` simples responde "envelope não está no status draft".
 * Atomicidade é da própria API: ou tudo aplica, ou nada (não há estado parcial
 * pra rollback).
 *
 * Retorna os IDs dos requirements criados: extraídos de `atomic:results`
 * (caminho confirmado contra a conta real em 2026-07-24 — a resposta traz os
 * requirements criados com id/type), senão por diff do conjunto de IDs
 * antes/depois (a listagem v3 não expõe relationship com signer). Ambos os
 * caminhos exigem EXATAMENTE 2 IDs novos — contagem diferente indica corrida
 * com outra mutação no mesmo envelope ou consistência eventual, e persistir
 * um conjunto contaminado poderia, numa edição futura, remover o requirement
 * de um TERCEIRO signatário. Nesse caso: 1 retry do diff e, persistindo a
 * ambiguidade, `BulkRequirementsUnconfirmedError` (o remoto JÁ aplicou).
 */
async function bulkRecreateRequirements(args: {
  envelopeClicksignId: string;
  documentClicksignId: string;
  signerClicksignId: string;
  removeRequirementIds: string[];
  role: ClicksignRole;
  auth: AuthMethod;
  creds: ClicksignCreds;
}): Promise<string[]> {
  const before = await listRequirementIds(args.envelopeClicksignId, args.creds);
  const ops: BulkRequirementOp[] = [
    {
      op: "add",
      action: "provide_evidence",
      auth: args.auth,
      documentClicksignId: args.documentClicksignId,
      signerClicksignId: args.signerClicksignId,
    },
    {
      op: "add",
      action: "agree",
      role: args.role,
      documentClicksignId: args.documentClicksignId,
      signerClicksignId: args.signerClicksignId,
    },
    ...args.removeRequirementIds.map<BulkRequirementOp>((requirementId) => ({
      op: "remove",
      requirementId,
    })),
  ];
  // ClicksignError aqui = NADA aplicou (a chamada é atômica) — propaga limpo.
  const resp = await bulkRequirements(args.envelopeClicksignId, ops, args.creds);

  const atomicIds = pickAtomicRequirementIds(resp).filter((id) => !before.has(id));
  if (atomicIds.length === 2) return atomicIds;

  let found = atomicIds.length;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 750));
    try {
      const after = await listRequirementIds(args.envelopeClicksignId, args.creds);
      const fresh = [...after].filter((id) => !before.has(id));
      if (fresh.length === 2) return fresh;
      found = fresh.length;
    } catch {
      // GET transiente — o retry cobre; se persistir, cai no Unconfirmed.
    }
  }
  throw new BulkRequirementsUnconfirmedError(found);
}

/**
 * Recria os 2 requirements do signatário (auth `provide_evidence` + qualificação
 * `agree`). A v3 não tem PATCH de requirement, então cria os NOVOS e depois
 * remove os antigos.
 *
 * Em envelope `running` delega pro `bulkRecreateRequirements` (única forma que
 * a ClickSign aceita pós-ativação; atômico por natureza).
 *
 * Em `draft`, ordem ADD-THEN-DELETE (não delete-then-add) de propósito: se um
 * `add` falhar (transiente), fazemos rollback só do que criamos e os
 * requirements ANTIGOS seguem intactos — o envelope nunca fica sem requirement
 * e o DB continua consistente com a ClickSign (falha limpa, sem estado
 * parcial). Só quando os dois novos estão criados removemos os velhos.
 */
async function recreateSignerRequirements(args: {
  envelopeClicksignId: string;
  documentClicksignId: string;
  signerClicksignId: string;
  oldRequirementIds: string[];
  role: ClicksignRole;
  auth: AuthMethod;
  creds: ClicksignCreds;
  envelopeStatus: string;
}): Promise<string[]> {
  if (args.envelopeStatus === "running") {
    return bulkRecreateRequirements({
      envelopeClicksignId: args.envelopeClicksignId,
      documentClicksignId: args.documentClicksignId,
      signerClicksignId: args.signerClicksignId,
      removeRequirementIds: args.oldRequirementIds,
      role: args.role,
      auth: args.auth,
      creds: args.creds,
    });
  }

  const created: string[] = [];
  try {
    const authReq = await addRequirement(
      {
        envelopeId: args.envelopeClicksignId,
        documentClicksignId: args.documentClicksignId,
        signerClicksignId: args.signerClicksignId,
        action: "provide_evidence",
        auth: args.auth,
      },
      args.creds
    );
    const authId = pickId(authReq);
    if (!authId) throw new Error("Resposta sem id de requirement (auth)");
    created.push(authId);

    const agreeReq = await addRequirement(
      {
        envelopeId: args.envelopeClicksignId,
        documentClicksignId: args.documentClicksignId,
        signerClicksignId: args.signerClicksignId,
        action: "agree",
        role: args.role,
      },
      args.creds
    );
    const agreeId = pickId(agreeReq);
    if (!agreeId) throw new Error("Resposta sem id de requirement (agree)");
    created.push(agreeId);
  } catch (err) {
    // Rollback dos novos; os antigos nunca foram tocados → estado íntegro.
    for (const id of created) {
      try {
        await removeRequirement(args.envelopeClicksignId, id, args.creds);
      } catch {
        /* best-effort */
      }
    }
    throw err;
  }

  // Dois novos criados — remove os antigos (best-effort; órfão é inofensivo,
  // não deixa o fluxo falhar depois de já termos os novos válidos).
  for (const reqId of args.oldRequirementIds) {
    try {
      await removeRequirement(args.envelopeClicksignId, reqId, args.creds);
    } catch (err) {
      if (!(err instanceof ClicksignError && err.status === 404)) {
        console.error("[clicksign] falha ao remover requirement antigo:", err);
      }
    }
  }
  return created;
}

/**
 * Edita um signatário que ainda não assinou, num envelope não-concluído.
 * Perfil (nome/email/documento/telefone) via `updateSigner`; papel ("assina
 * como") e tipo de assinatura (auth) recriam os requirements na ClickSign.
 *
 * Consistência DB×ClickSign: o perfil é persistido no DB LOGO após o
 * `updateSigner` (nunca se perde se a recriação de requirement falhar depois);
 * papel/auth só são persistidos quando a recriação confirma na ClickSign.
 */
export async function updateSignerAction(
  signer: SignerWithEnvelope,
  updates: SignerUpdate
): Promise<ActionResult<Signer>> {
  if (signer.status === "signed" || signer.status === "removed") {
    return { ok: false, status: 400, error: "Signatário não pode ser editado neste estado" };
  }
  const envStatus = signer.envelope.status;
  if (envStatus !== "draft" && envStatus !== "running") {
    return { ok: false, status: 400, error: "Envelope não permite edição neste estado" };
  }
  const hasProfile =
    updates.name !== undefined ||
    updates.email !== undefined ||
    updates.documentation !== undefined ||
    updates.phone !== undefined;
  const roleChanged = updates.role !== undefined && updates.role !== signer.role;
  const authChanged =
    updates.authMethod !== undefined && updates.authMethod !== signer.authMethod;
  if (!hasProfile && !roleChanged && !authChanged) {
    return { ok: false, status: 400, error: "Nenhuma alteração informada" };
  }

  // Tipo de assinatura precisa estar na allow-list da org (defense-in-depth).
  if (authChanged) {
    const settings = await getSignatureSettings(signer.envelope.orgId);
    if (
      settings.allowedAuthMethods.length > 0 &&
      !settings.allowedAuthMethods.includes(updates.authMethod as string)
    ) {
      return {
        ok: false,
        status: 400,
        error: `Tipo de assinatura "${updates.authMethod}" não está habilitado nas preferências da imobiliária.`,
      };
    }
  }

  const creds = await resolveClickSignCreds(signer.envelope.orgId);
  const remoteReady = Boolean(
    signer.envelope.clicksignId && signer.clicksignId && creds
  );

  // Só é possível trocar papel/auth quando há como recriar os requirements
  // remotos: exige envelope+signer+documento na ClickSign. Sem isso NÃO
  // persistimos papel/auth (senão o DB divergiria do que a ClickSign assina).
  if (
    (roleChanged || authChanged) &&
    remoteReady &&
    !signer.envelope.documentClicksignId
  ) {
    return {
      ok: false,
      status: 409,
      error:
        "Não é possível alterar o tipo de assinatura ou o papel neste envelope. Cancele e reenvie.",
    };
  }

  // Perfil aplicado na ClickSign, persistido imediatamente (nunca se perde).
  const profileData: Prisma.EnvelopeSignerUpdateInput = {};
  if (updates.name !== undefined) profileData.name = updates.name;
  if (updates.email !== undefined) profileData.email = updates.email;
  if (updates.documentation !== undefined)
    profileData.documentation = updates.documentation || null;
  if (updates.phone !== undefined) profileData.phone = updates.phone || null;

  if (remoteReady && hasProfile) {
    try {
      const resp = await updateSigner(
        {
          envelopeId: signer.envelope.clicksignId!,
          signerId: signer.clicksignId!,
          name: updates.name,
          email: updates.email,
          documentation: updates.documentation,
          phoneNumber: updates.phone,
        },
        creds!
      );
      // Quirk v3: PATCH do signer pode ROTACIONAR a key (remove+add). Se a
      // resposta trouxer um id novo, adotamos e re-persistimos — senão as
      // recriações de requirement e ações futuras (resend/remove) mirariam
      // uma key morta. Ver feedback_clicksign_v3_quirks.
      const rotatedId = pickId(resp);
      if (rotatedId && rotatedId !== signer.clicksignId) {
        profileData.clicksignId = rotatedId;
        signer.clicksignId = rotatedId;
      }
    } catch (err) {
      if (err instanceof ClicksignError) {
        // Medido em produção (2026-08-04): PATCH de signatário em envelope
        // `running` volta 404 da ClickSign — o recurso deixa de ser editável
        // depois que o envelope sai. Sem esta tradução o operador (e o agente)
        // recebe "Resposta não-JSON da Clicksign (HTTP 404)", que não diz o que
        // fazer, e o caso é justamente o mais comum: mandou pro contato errado.
        // Restrito a 404 + running pra não engolir erro transitório (5xx) nem
        // falha de validação (422), que continuam subindo como estão.
        if (err.status === 404 && envStatus === "running") {
          return {
            ok: false,
            status: 409,
            error:
              "A ClickSign não permite trocar o contato de um signatário depois que o documento já foi enviado. Cancele e envie de novo com o contato correto.",
          };
        }
        return { ok: false, status: 502, error: `Clicksign: ${err.message}` };
      }
      throw err;
    }
    // Persiste o perfil já aplicado ANTES de mexer em requirements: se a
    // recriação falhar a seguir, o DB continua batendo com a ClickSign.
    await prisma.envelopeSigner.update({
      where: { id: signer.id },
      data: profileData,
    });
  }

  let newRequirementIds: string[] | undefined;
  if (remoteReady && (roleChanged || authChanged)) {
    try {
      newRequirementIds = await recreateSignerRequirements({
        envelopeClicksignId: signer.envelope.clicksignId!,
        documentClicksignId: signer.envelope.documentClicksignId!,
        signerClicksignId: signer.clicksignId!,
        oldRequirementIds: signer.requirementIds,
        role: (updates.role ?? (signer.role as ClicksignRole)) ?? "sign",
        auth: (updates.authMethod ?? (signer.authMethod as AuthMethod)) ?? "email",
        creds: creds!,
        envelopeStatus: envStatus,
      });
    } catch (err) {
      if (err instanceof BulkRequirementsUnconfirmedError) {
        // O bulk APLICOU (papel/auth novos já valem na ClickSign) — só não
        // confirmamos os IDs novos. Persistimos papel/auth pra não divergir
        // do que a ClickSign passou a exigir; `requirementIds` fica vazio
        // (numa próxima troca não haverá o que remover — pode duplicar
        // requirement na ClickSign, aceitável vs. exibir papel errado e
        // gerar retry que falharia mirando IDs mortos).
        console.error(
          `[clicksign] requirements recriados sem confirmação de IDs (signer ${signer.clicksignId}, envelope ${signer.envelope.clicksignId}):`,
          err.message
        );
        newRequirementIds = [];
      } else if (err instanceof ClicksignError) {
        const hint =
          envStatus === "running"
            ? " Talvez seja necessário cancelar o envelope e reenviar para trocar o tipo de assinatura ou o papel."
            : "";
        // ClicksignError no bulk/draft = nada aplicou. Perfil (se houve) já
        // foi aplicado + persistido acima; papel/auth NÃO são persistidos,
        // mantendo DB×ClickSign consistentes.
        return { ok: false, status: 502, error: `Clicksign: ${err.message}.${hint}` };
      } else {
        throw err;
      }
    }
  }

  // Persiste o restante: papel/auth (confirmados na ClickSign ou modo local) +
  // perfil quando NÃO houve chamada remota (envelope local-only).
  const finalData: Prisma.EnvelopeSignerUpdateInput = {};
  if (!remoteReady) Object.assign(finalData, profileData);
  if (roleChanged) finalData.role = updates.role;
  if (authChanged) finalData.authMethod = updates.authMethod;
  if (newRequirementIds) finalData.requirementIds = newRequirementIds;

  const updated =
    Object.keys(finalData).length > 0
      ? await prisma.envelopeSigner.update({
          where: { id: signer.id },
          data: finalData,
        })
      : (await prisma.envelopeSigner.findUnique({ where: { id: signer.id } }))!;
  return { ok: true, data: updated };
}

/** Remove (soft) um signatário que ainda não assinou. */
export async function removeSignerAction(
  signer: SignerWithEnvelope
): Promise<ActionResult<true>> {
  if (signer.status === "signed") {
    return { ok: false, status: 400, error: "Signatário já assinou — não pode ser removido" };
  }
  const envStatus = signer.envelope.status;
  if (envStatus !== "draft" && envStatus !== "running") {
    return { ok: false, status: 400, error: "Envelope não permite remoção neste estado" };
  }

  const creds = await resolveClickSignCreds(signer.envelope.orgId);
  if (signer.envelope.clicksignId && signer.clicksignId && creds) {
    try {
      await removeSigner(signer.envelope.clicksignId, signer.clicksignId, creds);
    } catch (err) {
      if (err instanceof ClicksignError && err.status !== 404) {
        return { ok: false, status: 502, error: `Clicksign: ${err.message}` };
      }
    }
  }

  await prisma.envelopeSigner.update({
    where: { id: signer.id },
    data: { status: "removed" },
  });
  return { ok: true, data: true };
}

export interface AddSignerData {
  name: string;
  email: string;
  documentation?: string;
  phone?: string;
  sourceKind: string;
  sourceIndex: number;
  role?: ClicksignRole;
  /** Grupo de ordem (ClickSign v3). */
  group?: number | null;
}

/** Adiciona um signatário a um envelope draft/running (cria signer +
 *  requirements de auth e qualificação na ClickSign).
 *
 *  Em `running` (envelope já enviado, ainda não concluído): o `POST /signers`
 *  é aceito normalmente; os requirements vão via `bulk_requirements` (única
 *  forma pós-ativação) e o novo signatário é NOTIFICADO na hora — quem já
 *  assinou não é afetado. Em `draft` a notificação fica pro activate. */
export async function addSignerToEnvelope(
  envelope: Envelope,
  data: AddSignerData
): Promise<ActionResult<Signer>> {
  if (envelope.status !== "draft" && envelope.status !== "running") {
    return {
      ok: false,
      status: 409,
      error: "Envelope não permite adicionar signatários neste estado",
    };
  }

  const authMethod = (envelope.authMethod as AuthMethod) ?? "email";
  const documentation = data.documentation
    ? data.documentation.replace(/\D+/g, "")
    : undefined;
  const phone = data.phone ? data.phone.replace(/\D+/g, "") : undefined;
  const role: ClicksignRole = data.role ?? "sign";

  const localSigner = await prisma.envelopeSigner.create({
    data: {
      envelopeId: envelope.id,
      sourceKind: data.sourceKind,
      sourceIndex: data.sourceIndex,
      role,
      signingGroup: data.group ?? null,
      name: data.name,
      email: data.email,
      documentation,
      phone,
      authMethod,
      status: "pending",
    },
  });

  const creds = await resolveClickSignCreds(envelope.orgId);
  if (envelope.clicksignId && envelope.documentClicksignId && creds) {
    let signerId: string | null = null;
    try {
      const signerResp = await addSigner(
        {
          envelopeId: envelope.clicksignId,
          name: data.name,
          email: data.email,
          documentation,
          phoneNumber: phone,
          hasDocumentation: Boolean(documentation),
          group: data.group ?? undefined,
        },
        creds
      );
      signerId = pickId(signerResp);
      if (!signerId) throw new Error("Resposta sem id de signer");

      let reqIds: string[];
      if (envelope.status === "running") {
        // Pós-ativação a ClickSign só aceita requirements via bulk atômico.
        reqIds = await bulkRecreateRequirements({
          envelopeClicksignId: envelope.clicksignId,
          documentClicksignId: envelope.documentClicksignId,
          signerClicksignId: signerId,
          removeRequirementIds: [],
          role,
          auth: authMethod,
          creds,
        });
      } else {
        const authReq = await addRequirement(
          {
            envelopeId: envelope.clicksignId,
            documentClicksignId: envelope.documentClicksignId,
            signerClicksignId: signerId,
            action: "provide_evidence",
            auth: authMethod,
          },
          creds
        );
        const signReq = await addRequirement(
          {
            envelopeId: envelope.clicksignId,
            documentClicksignId: envelope.documentClicksignId,
            signerClicksignId: signerId,
            action: "agree",
            role,
          },
          creds
        );
        reqIds = [pickId(authReq), pickId(signReq)].filter(Boolean) as string[];
      }

      // Em `running` não haverá activate — notifica o novo signatário agora.
      // Falha aqui NÃO desfaz nada: signer + requirements já estão válidos na
      // ClickSign; o botão "Reenviar notificação" cobre o gap.
      let notified = false;
      if (envelope.status === "running") {
        try {
          await notifySigner(envelope.clicksignId, signerId, creds);
          notified = true;
        } catch (notifyErr) {
          console.error(
            "[clicksign] novo signatário criado, mas a notificação falhou:",
            notifyErr
          );
        }
      }

      await prisma.envelopeSigner.update({
        where: { id: localSigner.id },
        data: {
          clicksignId: signerId,
          requirementIds: reqIds,
          // Draft: notificação fica pro activate. Running: notificado agora.
          status: notified ? "notified" : "pending",
          notifiedAt: notified ? new Date() : null,
        },
      });
    } catch (err) {
      // Rollback completo: signer remoto (se chegou a existir) + row local.
      // Sem requirement o signer remoto não assina, mas apareceria no
      // certificado — remove pra não divergir do DB. Remover o signer também
      // remove os requirements dele, então cobre inclusive o caso
      // "bulk aplicou mas não confirmamos os IDs".
      if (signerId) {
        try {
          await removeSigner(envelope.clicksignId, signerId, creds);
        } catch (rollbackErr) {
          // Signer órfão na ClickSign sem representação local — loga alto pra
          // dar visibilidade operacional (não dá pra desfazer daqui).
          console.error(
            `[clicksign] rollback: falha ao remover signer ${signerId} do envelope ${envelope.clicksignId} — signer órfão na ClickSign:`,
            rollbackErr
          );
        }
      }
      await prisma.envelopeSigner.delete({ where: { id: localSigner.id } });
      if (err instanceof BulkRequirementsUnconfirmedError) {
        return {
          ok: false,
          status: 502,
          error:
            "A ClickSign aceitou o signatário, mas não foi possível confirmar os requisitos de assinatura — a inclusão foi desfeita. Tente novamente.",
        };
      }
      if (err instanceof ClicksignError) {
        const hint =
          envelope.status === "running"
            ? " Se o erro persistir, cancele o envelope e reenvie incluindo a nova pessoa."
            : "";
        return { ok: false, status: 502, error: `Clicksign: ${err.message}${hint}` };
      }
      throw err;
    }
  }

  const fresh = await prisma.envelopeSigner.findUnique({
    where: { id: localSigner.id },
  });
  return { ok: true, data: fresh! };
}

function pickId(resp: unknown): string | null {
  if (!resp || typeof resp !== "object") return null;
  const data = (resp as { data?: unknown }).data;
  if (Array.isArray(data)) {
    return (data[0] as { id?: string } | undefined)?.id ?? null;
  }
  return (data as { id?: string } | undefined)?.id ?? null;
}
