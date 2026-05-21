import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateContractForDeal } from "@/lib/services/contract-generation";
import { dedupConjuges } from "@/lib/forms/dedup-conjuges";
import { dadosContratoSchema } from "@/lib/forms/validation";
import { deepMergeAtPaths } from "@/lib/forms/dataJson-merge";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

// GET: public - fetch form data by token
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
  });

  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: form.id,
    token: form.token,
    title: form.title,
    schemaType: form.schemaType,
    dataJson: form.dataJson,
    status: form.status,
    updatedAt: form.updatedAt,
  });
}

// PATCH: public - auto-save form data
export async function PATCH(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const body = await req.json();

  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
  });

  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const currentData = (form.dataJson as Record<string, unknown>) || {};
  // Deep-merge restrito substitui `{ ...current, ...incoming }` raso.
  // Sem allowlist no token principal — subtokens (PR 4) passam ROLE_PATHS.
  // undefined/null em incoming não apaga chave existente. Arrays substituem
  // inteiros pra permitir remoção de itens (ex: deletar 2º comprador).
  const mergeOutcome = deepMergeAtPaths(
    currentData,
    (body.dataJson ?? {}) as Record<string, unknown>,
  );
  const rawMergedData = mergeOutcome.merged;

  if (mergeOutcome.rejectedPaths.length > 0) {
    // Token principal não deveria ter allowlist — qualquer rejectedPath aqui
    // é bug. Audita best-effort sem bloquear save.
    console.warn("[forms PATCH] rejected paths (token principal)", {
      token: params.token,
      rejectedPaths: mergeOutcome.rejectedPaths,
    });
    audit(
      extractAuditContextFromRequest(req, form.orgId, null),
      {
        action: "FORM_PATCH_REJECTED_PATH",
        result: "DENIED",
        resource: form.id,
        resourceType: "SalesForm",
        metadata: { rejectedPaths: mergeOutcome.rejectedPaths },
      },
    );
  }

  const previousStatus = form.status;
  const newStatus = body.status ?? form.status;

  // No finalize (transição para "completo"), aplica dedup de cônjuges
  // duplicados como vendedor/comprador autônomo. Bug demo 2026-05-05:
  // Isabel virou comprador 2 mesmo já sendo cônjuge de Luiz. Em auto-save
  // intermediário não rodamos dedup — usuário pode estar revendo.
  const isFinalizing = newStatus === "completo" && previousStatus !== "completo";
  const mergedData = isFinalizing ? dedupConjuges(rawMergedData) : rawMergedData;

  // A6 (QA deal 20486): validação server-side no finalize. O form público é
  // editável por qualquer um com o link e a validação client-side é burlável —
  // sem isso, dados inválidos (ex.: CPF do cônjuge vazio quando casado, comissão
  // zerada com comissionado, soma de parcelas ≠ total) finalizavam e geravam
  // contrato sem aviso. NÃO bloqueia a geração (o render linter + o gate de
  // aprovação barram o contrato defeituoso downstream), mas materializa os
  // problemas na resposta e no audit pra correção pelo corretor.
  let validationIssues: Array<{ path: string; message: string }> = [];
  if (isFinalizing) {
    const parsed = dadosContratoSchema.safeParse(mergedData);
    if (!parsed.success) {
      validationIssues = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      console.warn(
        `[forms/finalize] form ${form.id} finalizado com ${validationIssues.length} problema(s) de validação:`,
        validationIssues.map((v) => `${v.path}: ${v.message}`).join(" | ")
      );
    }
  }

  const updated = await prisma.salesForm.update({
    where: { token: params.token },
    data: {
      dataJson: mergedData as Prisma.InputJsonValue,
      title: body.title ?? form.title,
      status: newStatus,
      ...(isFinalizing ? { completedAt: new Date() } : {}),
    },
  });

  // Keep the deal title in sync with the form title when the user renames the form
  if (typeof body.title === "string" && body.title.trim() && body.title !== form.title) {
    await prisma.deal.updateMany({
      where: { formId: form.id },
      data: { title: body.title },
    });
  }

  // Auto-generate contract when form is completed
  let contractId: string | null = null;
  let dealId: string | null = null;
  if (newStatus === "completo" && previousStatus !== "completo") {
    const deal = await prisma.deal.findFirst({
      where: { formId: form.id },
    });

    if (deal) {
      dealId = deal.id;
      try {
        const result = await generateContractForDeal(deal.id, deal.userId, form.orgId);
        contractId = result.contractId;
      } catch (error) {
        console.error("Auto-generate contract failed:", error);
      }

      try {
        const formAttachments = await prisma.formAttachment.findMany({
          where: { formId: form.id },
        });
        if (formAttachments.length > 0) {
          const existing = await prisma.dealAttachment.findMany({
            where: { dealId: deal.id },
            select: { url: true },
          });
          const existingUrls = new Set(existing.map((e) => e.url));
          const newOnes = formAttachments.filter((a) => !existingUrls.has(a.url));
          if (newOnes.length > 0) {
            await prisma.dealAttachment.createMany({
              data: newOnes.map((a) => ({
                dealId: deal.id,
                filename: a.filename,
                mime: a.mime,
                url: a.url,
                category: a.category,
                // H.6 (Phase H, 2026-04-18) — copia extractedData inteiro
                // (incluindo {assignment, fields, confidence}) para que a
                // aba Documentos do deal consiga agrupar docs pelo lado
                // explicitamente escolhido pelo usuário no form, em vez
                // do fallback heurístico cego de resolveKind(category).
                extractedData:
                  (a.extractedData as Prisma.InputJsonValue) ?? undefined,
              })),
            });
          }
        }
      } catch (error) {
        console.error("Link form attachments to deal failed:", error);
      }

      // Phase F.II-δ — automação "sou sócio de PJ X":
      // Varre vendedores[] e compradores[] procurando campo `socio_pj` (adicionado
      // pelo front-end quando PF marca checkbox) e cria DiligentedPerson PJ
      // vinculado ao deal. Planner passa a incluir esta PJ no próximo batch de
      // certidões, cobrindo a "lista H" (itens B-G + falência PJ) automaticamente.
      try {
        const dataLocal = mergedData as {
          vendedores?: Array<{
            socio_pj?: { cnpj?: string; razao_social?: string; uf?: string; cidade?: string };
          }>;
          compradores?: Array<{
            socio_pj?: { cnpj?: string; razao_social?: string; uf?: string; cidade?: string };
          }>;
        };
        const partesComSocio = [
          ...(dataLocal.vendedores ?? []),
          ...(dataLocal.compradores ?? []),
        ]
          .map((p) => p.socio_pj)
          .filter((s): s is NonNullable<typeof s> => !!s?.cnpj?.trim());

        if (partesComSocio.length > 0) {
          const existingDiligenciados = await prisma.diligentedPerson.findMany({
            where: { dealId: deal.id },
            select: { cnpj: true },
          });
          const existingCnpjs = new Set(
            existingDiligenciados.map((d) => d.cnpj?.replace(/\D/g, "")).filter(Boolean)
          );
          const newSocios = partesComSocio.filter(
            (s) => !existingCnpjs.has(s.cnpj!.replace(/\D/g, ""))
          );
          if (newSocios.length > 0) {
            await prisma.diligentedPerson.createMany({
              data: newSocios.map((s) => ({
                dealId: deal.id,
                tipoPessoa: "juridica",
                nome: s.razao_social ?? "PJ sem razão social",
                cnpj: s.cnpj!.replace(/\D/g, ""),
                uf: s.uf ?? null,
                cidade: s.cidade ?? null,
              })),
            });
          }
        }
      } catch (error) {
        console.error("Auto-create DiligentedPerson from socio_pj failed:", error);
      }
    }
  }

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    updatedAt: updated.updatedAt,
    contractId,
    dealId,
    // A6: problemas de validação detectados no finalize (não bloqueiam a
    // geração, mas o cliente pode exibir e o contrato gerado terá os findings
    // do render linter). Vazio quando os dados passam no dadosContratoSchema.
    validationIssues,
  });
}
