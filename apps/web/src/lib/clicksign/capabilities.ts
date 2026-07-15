import { prisma } from "@/lib/db/prisma";
import { ClicksignError, type ClicksignCreds } from "./client";
import {
  createEnvelope,
  addDocument,
  addSigner,
  deleteDraftEnvelope,
} from "./envelopes";
import { resolveClickSignCreds } from "./account";
import {
  interpretWhatsappProbe,
  type ProbeVerdict,
} from "@/lib/proposals/routing";

// PDF mínimo válido (1 página em branco), base64. Usado só no probe descartável.
const TINY_PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8" +
  "PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdl" +
  "L1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMzAwIDIwMF0+PmVuZG9iagp0cmFpbGVyPDwvU2l6ZSA0" +
  "L1Jvb3QgMSAwIFI+PgolJUVPRg==";

function extractId(resp: unknown): string | null {
  const data = (resp as { data?: unknown })?.data;
  if (Array.isArray(data)) return (data[0] as { id?: string })?.id ?? null;
  return (data as { id?: string } | undefined)?.id ?? null;
}

/**
 * Probe de assinatura por WhatsApp contra a conta real. Cria um envelope
 * RASCUNHO, tenta um signer com `notifyChannel:"whatsapp"`, lê o resultado e
 * DELETA o rascunho — custo zero (nunca ativa, nunca envia). É a mesma sequência
 * validada no spike de 2026-07-14.
 *
 * Retorna o veredito de 3 estados; `inconclusive` (rede, telefone, etc.) não
 * deve ser cacheado como indisponível.
 */
export async function probeWhatsappSignature(
  creds: ClicksignCreds
): Promise<ProbeVerdict> {
  let envId: string | null = null;
  try {
    const env = await createEnvelope(
      { name: "Verificação de recursos (descartável)", autoClose: true },
      creds
    );
    envId = extractId(env);
    if (!envId) return "inconclusive";
    await addDocument(
      { envelopeId: envId, filename: "probe.pdf", contentBase64: TINY_PDF_BASE64 },
      creds
    );
    await addSigner(
      {
        envelopeId: envId,
        name: "Verificacao Recurso",
        email: "verificacao@exemplo.com",
        phoneNumber: "11987654321",
        notifyChannel: "whatsapp",
        hasDocumentation: false,
      },
      creds
    );
    // addSigner não lançou → 2xx → WhatsApp disponível.
    return "available";
  } catch (err) {
    if (err instanceof ClicksignError) {
      return interpretWhatsappProbe(err.status, err.body);
    }
    return "inconclusive";
  } finally {
    if (envId) {
      // Best-effort: o rascunho nunca foi ativado, então deletar é limpo.
      await deleteDraftEnvelope(envId, creds).catch(() => {});
    }
  }
}

export interface CapabilityResult {
  whatsappSignatureAvailable: boolean | null; // null = veredito inconclusivo
  acceptanceWhatsappAvailable: boolean;
  checkedAt: Date;
}

/**
 * Roda o probe e CACHEIA em OrgSignatureSettings. Chamado na conexão da conta
 * ClickSign e pelo botão "Reverificar recursos".
 *
 * `deps.probe` é injetável pra teste. `acceptanceWhatsappAvailable` deriva do
 * opt-in manual `acceptanceEnabled` (o operador confirma o Aceite no painel da
 * ClickSign) — não há probe barato pro Aceite sem enviar um de verdade.
 */
export async function detectAndCacheCapabilities(
  orgId: string,
  deps: {
    resolveCreds?: (orgId: string) => Promise<ClicksignCreds | null>;
    probe?: (creds: ClicksignCreds) => Promise<ProbeVerdict>;
    now?: () => Date;
  } = {}
): Promise<CapabilityResult | { error: "not_configured" }> {
  const resolve = deps.resolveCreds ?? resolveClickSignCreds;
  const probe = deps.probe ?? probeWhatsappSignature;
  const now = deps.now ? deps.now() : new Date();

  const creds = await resolve(orgId);
  if (!creds) return { error: "not_configured" };

  const verdict = await probe(creds);
  // Inconclusivo → NÃO sobrescreve o valor anterior (mantém null/último).
  const whatsappSignatureAvailable =
    verdict === "available" ? true : verdict === "unavailable" ? false : null;

  const settings = await prisma.orgSignatureSettings.findUnique({
    where: { orgId },
    select: { acceptanceEnabled: true },
  });
  const acceptanceWhatsappAvailable = settings?.acceptanceEnabled ?? false;

  await prisma.orgSignatureSettings.upsert({
    where: { orgId },
    create: {
      orgId,
      acceptanceWhatsappAvailable,
      capabilitiesCheckedAt: now,
      ...(whatsappSignatureAvailable !== null
        ? { whatsappSignatureAvailable }
        : {}),
    },
    update: {
      acceptanceWhatsappAvailable,
      capabilitiesCheckedAt: now,
      ...(whatsappSignatureAvailable !== null
        ? { whatsappSignatureAvailable }
        : {}),
    },
  });

  return { whatsappSignatureAvailable, acceptanceWhatsappAvailable, checkedAt: now };
}
