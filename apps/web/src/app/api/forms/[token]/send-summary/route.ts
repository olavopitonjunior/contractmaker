import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { resolveFormScope } from "@/lib/forms/resolve-form-scope";
import { sendFormSummary } from "@/lib/forms/form-summary-mailer";
import { dealDataToSigners, isValidEmail } from "@/lib/clicksign/mapping";
import { RateLimits } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  target: z.enum(["org", "parties"]),
  includeAttachments: z.boolean().optional().default(true),
});

/**
 * Envio público do resumo consolidado a partir do form. NÃO aceita e-mail
 * arbitrário — o destino é resolvido no servidor: e-mail configurado da org
 * OU e-mails das partes já preenchidas no dataJson. Rate-limit apertado
 * (Puppeteer + download + envio sem auth). Só venda + form completo/vinculado.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const byIp = await RateLimits.publicPageByIp(ip);
  if (!byIp.success) {
    return NextResponse.json({ error: "Muitas requisições" }, { status: 429 });
  }

  const scope = await resolveFormScope(params.token);
  if (!scope) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });

  if (scope.schemaType !== "compra_venda_v1") {
    return NextResponse.json(
      { error: "Resumo disponível apenas para formulários de compra e venda" },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Body inválido" },
      { status: 400 }
    );
  }

  const form = await prisma.salesForm.findUnique({
    where: { id: scope.formId },
    select: { id: true, status: true, dataJson: true, orgId: true },
  });
  if (!form) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });
  if (form.status !== "completo" && form.status !== "vinculado") {
    return NextResponse.json(
      { error: "Finalize o formulário antes de enviar o resumo" },
      { status: 400 }
    );
  }

  // Resolução server-side de destinatários — nunca do body.
  let recipients: string[] = [];
  if (parsed.data.target === "org") {
    const settings = await prisma.orgFormSettings.findUnique({
      where: { orgId: form.orgId },
      select: { summaryRecipientEmail: true },
    });
    const email = settings?.summaryRecipientEmail?.trim();
    if (email && isValidEmail(email)) recipients = [email];
  } else {
    const { signers } = dealDataToSigners(form.dataJson);
    recipients = Array.from(
      new Set(
        signers
          .filter((s) => s.sourceKind === "vendedor" || s.sourceKind === "comprador")
          // Só quem representa a parte: o titular PF e o representante legal
          // da PJ. Cônjuge e procurador assinam o contrato, mas o resumo do
          // formulário é dado da negociação e vai só pras partes — desde que
          // `dealDataToSigners` virou opt-out (2026-07-24) eles entrariam aqui
          // por efeito colateral.
          .filter((s) => (s.subKind ?? "titular") === "titular" || s.subKind === "representante")
          .map((s) => s.email.trim().toLowerCase())
          .filter((e) => e && isValidEmail(e))
      )
    );
  }

  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "Nenhum destinatário disponível para esta opção" },
      { status: 400 }
    );
  }

  // Rate-limit por token só depois de validar destino (não gasta o 1/h em erro).
  const byToken = await RateLimits.formSummarySendPerToken(params.token);
  if (!byToken.success) {
    return NextResponse.json(
      { error: "Resumo já enviado recentemente. Tente novamente mais tarde." },
      { status: 429 }
    );
  }

  // Isolamento entre titulares (LGPD): pra "parties" NUNCA anexa os documentos
  // de identidade (RG/CNH) — senão o comprador recebe os documentos do vendedor
  // e vice-versa. E os destinatários vão em BCC (um `to` neutro = o remetente),
  // então uma parte NÃO vê o e-mail da outra no cabeçalho. É UM único envio
  // (uma renderização do PDF, artefato persistido) e é all-or-nothing — o
  // status reflete o envio real, sem mascarar falha parcial. Anexos só pro
  // destino "org" (uso interno).
  const isOrg = parsed.data.target === "org";
  const result = await sendFormSummary({
    formId: form.id,
    to: isOrg ? recipients : process.env.EMAIL_FROM ?? "no-reply@contractmaker.local",
    bcc: isOrg ? undefined : recipients,
    includeAttachments: isOrg ? parsed.data.includeAttachments : false,
    persist: true,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Falha ao enviar" }, { status: 502 });
  }

  // Não devolve os e-mails (privacidade) — só confirmação.
  return NextResponse.json({ ok: true, sent: recipients.length });
}
