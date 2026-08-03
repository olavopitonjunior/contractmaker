import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getAcceptanceWhatsapp } from "@/lib/clicksign/acceptance";
import { resolveClickSignCreds } from "@/lib/clicksign/account";
import { safeFetch } from "@/lib/security/ssrf";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import {
  extractAcceptanceRecordUrl,
  extractAcceptanceFacts,
  type AcceptanceOfficialFacts,
} from "./acceptance-record";
import { persistProposalDocument } from "./attachments";

/**
 * Busca na ClickSign os dados oficiais do Aceite e tenta trazer o Registro do
 * Aceite (o PDF com as provas de identidade + mensagens trocadas).
 *
 * Compartilhado entre o webhook `acceptance_term_completed` e o script de
 * recuperação retroativa — os dois precisam exatamente disto.
 *
 * BEST-EFFORT por construção: a API v3 documentada não expõe link de download
 * (só a interface web da ClickSign entrega o Registro). Quando não houver link,
 * `recordUrl` volta null e o caminho é o upload manual pela UI da proposta. O
 * valor garantido desta função é o outro: gravar a resposta CRUA num
 * `ProposalEvent`, que é o que permite descobrir campos não documentados contra
 * a conta real — e passa a anexar sozinho se/quando a ClickSign publicar.
 *
 * Nunca lança: o aceite não pode falhar por causa disto.
 */
export interface AcceptanceRecordSyncResult {
  facts: AcceptanceOfficialFacts;
  /** URL do artefato oficial já no nosso storage, quando encontrado. */
  recordUrl: string | null;
  /** Resposta crua da ClickSign — o script imprime; o webhook grava no evento. */
  raw: unknown;
  error?: string;
}

export async function syncAcceptanceRecord(input: {
  proposalId: string;
  orgId: string;
  acceptanceId: string;
  /** `false` no script em modo inspeção, pra só olhar sem gravar evento/anexo. */
  persist?: boolean;
}): Promise<AcceptanceRecordSyncResult> {
  const persist = input.persist !== false;
  const empty: AcceptanceRecordSyncResult = { facts: {}, recordUrl: null, raw: null };

  let raw: unknown;
  try {
    const creds = await resolveClickSignCreds(input.orgId);
    if (!creds) return { ...empty, error: "not_configured" };
    raw = await getAcceptanceWhatsapp(input.acceptanceId, creds);
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }

  // Grava a resposta CRUA na timeline. É isto que responde em definitivo se a
  // ClickSign devolve algum campo de download fora da documentação.
  if (persist) {
    await prisma.proposalEvent
      .create({
        data: {
          proposalId: input.proposalId,
          eventName: "acceptance_term_fetched",
          source: "api",
          payload: raw as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
  }

  const facts = extractAcceptanceFacts(raw);
  const url = extractAcceptanceRecordUrl(raw);
  if (!url) return { facts, recordUrl: null, raw };

  // Achou um link: baixa com o mesmo guard SSRF do PDF assinado (a URL vem de
  // terceiro) e arquiva do nosso lado — o link da ClickSign pode expirar.
  try {
    const res = await safeFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) throw new Error("conteúdo vazio");
    if (!persist) return { facts, recordUrl: url, raw };

    const stored = await uploadBufferToStorage({
      bucket: process.env.S3_BUCKET,
      key: `proposals/${input.proposalId}/registro-aceite.pdf`, // key estável
      body: buf,
      contentType: "application/pdf",
    });
    await persistProposalDocument({
      proposalId: input.proposalId,
      buffer: buf,
      url: stored,
      filename: "Registro do Aceite (ClickSign).pdf",
      mime: "application/pdf",
      category: "aceite_registro_clicksign",
      source: "clicksign_acceptance",
    });
    return { facts, recordUrl: stored, raw };
  } catch (err) {
    // Link existe mas não veio: mantém os fatos oficiais (que já valem pro
    // comprovante) e reporta.
    return {
      facts,
      recordUrl: null,
      raw,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
