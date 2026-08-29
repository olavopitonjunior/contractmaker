import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { formClosedResponse, viewerIsOrgMember } from "@/lib/forms/form-gate";
import { rateLimit } from "@/lib/security/ratelimit";
import { findCommissionerMatch } from "@/lib/asaas/commissioner-registry";
import {
  RECEBIMENTO_SELECT,
  recebimentoFromRecipient,
} from "@/lib/forms/commissioner-receiving";

export const runtime = "nodejs";

/**
 * "Este corretor já está cadastrado?" — a consulta que alimenta o diálogo de
 * duplicidade da etapa Comissão, nas duas esteiras.
 *
 * Só CONSULTA: nunca cria, nunca altera. Quem cria é o POST irmão, depois de o
 * usuário responder que não é a mesma pessoa (ou de não haver candidato).
 *
 * Usa o MESMO `findCommissionerMatch` do POST e do auto-cadastro do finalize —
 * de propósito. Se a pergunta feita aqui divergisse da regra aplicada lá, a
 * tela diria "não achei" e o servidor casaria assim mesmo, ou o contrário: o
 * usuário responderia "não é a mesma pessoa" e ganharia o cadastro antigo do
 * mesmo jeito.
 *
 * `?id=` existe para o outro uso: reidratar uma linha que tem
 * `splitRecipientId` mas cujo `recebimento` ainda não está no `dataJson` —
 * formulário criado antes de 08/2026, quando os dados bancários viviam só no
 * cadastro.
 *
 * Dados bancários na resposta só para MEMBRO da org, como no GET da listagem.
 * Para anônimo o candidato vem com o documento mascarado: a resposta confirma
 * "existe alguém com este e-mail", que é o mínimo para a pergunta fazer sentido,
 * sem virar oráculo de CPF.
 */

function maskDoc(doc: string | null | undefined): string | null {
  if (!doc) return null;
  const digits = doc.replace(/\D/g, "");
  if (digits.length < 6) return digits;
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { searchParams } = new URL(req.url);

  const doc = (searchParams.get("doc") ?? "").trim();
  const email = (searchParams.get("email") ?? "").trim();
  const phone = (searchParams.get("phone") ?? "").trim();
  const nome = (searchParams.get("nome") ?? "").trim();
  const id = (searchParams.get("id") ?? "").trim();

  // Bucket próprio e mais folgado que o da listagem: isto dispara no blur de
  // três campos, e um teto apertado transformaria digitação normal em 429 —
  // que foi exatamente como a listagem de corretores sumiu em 08/2026.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = await rateLimit({
    identifier: `commissioners-match:${token}:${ip}`,
    limit: 60,
    window: "1 m",
  });
  if (!limited.success) {
    return NextResponse.json(
      { error: "Muitas tentativas — aguarde um instante." },
      { status: 429 }
    );
  }

  const form = await prisma.salesForm.findUnique({
    where: { token },
    select: { id: true, orgId: true, status: true, completedAt: true, reopenedAt: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }
  const closed = await formClosedResponse(form);
  if (closed) return closed;

  // Sem nenhum identificador não há pergunta a fazer. Responder "nenhum
  // candidato" seria pior: a UI concluiria que pode criar cadastro novo.
  if (!id && !doc && !email && !phone) {
    return NextResponse.json({ candidate: null, insuficiente: true });
  }

  const viewerIsMember = await viewerIsOrgMember(form.orgId);

  const match = await findCommissionerMatch(form.orgId, {
    splitRecipientId: id || null,
    // O tipo de documento não importa para a busca — `normalizeDoc` reduz os
    // dois a dígitos e a coluna é uma só.
    cpf: doc || null,
    email: email || null,
    mobile_phone: phone || null,
    // Nome de fora de propósito: o match por nome exato é o mais fraco da
    // escala e perguntar "é a mesma pessoa?" para dois homônimos sem nenhum
    // contato em comum é ruído. Ele segue valendo no POST, como rede.
    nome: id ? null : nome && (doc || email || phone) ? nome : null,
  });

  if (!match) return NextResponse.json({ candidate: null });

  return NextResponse.json({
    candidate: {
      id: match.id,
      label: match.label,
      tipoPessoa: match.tipoPessoa,
      doc: maskDoc(match.cpfCnpj),
      creci: match.creci,
      papel: match.papel,
      email: match.email,
      phone: match.phone,
      receivingPending: match.pendingFields.length > 0,
      ...(viewerIsMember
        ? {
            recebimento: recebimentoFromRecipient(
              Object.fromEntries(
                Object.keys(RECEBIMENTO_SELECT).map((k) => [
                  k,
                  (match as unknown as Record<string, string | null>)[k] ?? null,
                ])
              )
            ),
          }
        : {}),
    },
  });
}
