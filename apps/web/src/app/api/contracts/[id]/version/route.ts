import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import { copyContractGoogleDoc } from "@/lib/google/copy-doc";
import { exportDocAsHtml } from "@/lib/google/docs";
import { watchFile } from "@/lib/google/watch";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const htmlFromClient: string | undefined = body?.htmlContent;

  const current = await prisma.contract.findUnique({
    where: { id: params.id },
  });

  if (!current) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  if (current.status === "aprovado") {
    return NextResponse.json(
      { error: "Contrato aprovado não pode ser versionado. Crie um novo contrato a partir do deal." },
      { status: 403 }
    );
  }

  // Em GDocs mode, o source-of-truth do conteúdo é o Drive — htmlContent que
  // chega do cliente é o snapshot inicial do contrato e fica stale durante a
  // edição (auto-save TipTap está desligado). Pra preservar o layout e o
  // estado visual ao salvar versão, replicamos o doc nativo: cria-se uma
  // cópia no Drive e a nova `Contract` aponta pra ela. O htmlContent salvo
  // no DB vira o export HTML do doc atual, pra histórico/PDF/análise.
  const isGdocs = Boolean(current.googleDocId) && isGoogleDocsFeatureEnabled();

  let copiedDocId: string | undefined;
  let copiedWebViewLink: string | undefined;
  let exportedHtml: string | undefined;
  let watchData: {
    googleWatchChannel?: string;
    googleWatchResource?: string;
    googleWatchExpires?: Date;
  } = {};

  if (isGdocs && current.googleDocId) {
    try {
      // Snapshot do estado atual do GDoc — usado como htmlContent da nova versão.
      // Falha aqui não bloqueia: caímos pro htmlContent persistido na versão atual.
      try {
        exportedHtml = await exportDocAsHtml(current.googleDocId);
      } catch (err) {
        console.error("[version] Falha ao exportar HTML do GDoc atual:", err);
      }

      const copy = await copyContractGoogleDoc({
        sourceDocId: current.googleDocId,
        name: `Contrato ${current.id} — v${current.version + 1}`,
      });
      copiedDocId = copy.docId;
      copiedWebViewLink = copy.webViewLink;

      const webhookBase = process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL;
      const watchToken = process.env.GOOGLE_WATCH_TOKEN?.trim();
      if (webhookBase && watchToken) {
        try {
          const watch = await watchFile({
            fileId: copy.docId,
            webhookUrl: `${webhookBase.replace(/\/$/, "")}/api/webhooks/google-drive`,
            token: watchToken,
          });
          watchData = {
            googleWatchChannel: watch.channelId,
            googleWatchResource: watch.resourceId,
            googleWatchExpires: new Date(watch.expiration),
          };
        } catch (err) {
          console.error("[version] Falha ao registrar watch Drive:", err);
        }
      }
    } catch (err) {
      console.error("[version] Falha ao copiar Google Doc — abortando:", err);
      return NextResponse.json(
        {
          error:
            "Não foi possível copiar o documento no Google Drive. Tente novamente.",
        },
        { status: 502 }
      );
    }
  }

  // Marca a versão atual como não-latest. Em GDocs mode, mantém o googleWatch
  // da versão antiga (sumiço dele só ocorre quando a versão for hard-deleted —
  // desejado: deal traz histórico de docs no Drive).
  await prisma.contract.update({
    where: { id: current.id },
    data: { isLatest: false },
  });

  const newVersion = await prisma.contract.create({
    data: {
      dealId: current.dealId,
      templateId: current.templateId,
      userId: session.user.id,
      version: current.version + 1,
      dataJson: (current.dataJson ?? {}) as never,
      // Em GDocs mode, prioriza o HTML exportado do doc atual; cai pro body
      // do cliente se export falhou; e por último mantém o htmlContent da
      // versão anterior (sempre algo coerente vai parar no DB).
      htmlContent:
        exportedHtml || htmlFromClient || current.htmlContent,
      templateOverride: current.templateOverride,
      status: current.status,
      isLatest: true,
      parentVersionId: current.id,
      ...(copiedDocId
        ? {
            googleDocId: copiedDocId,
            googleDocUrl: copiedWebViewLink,
            googleDocStatus: "draft",
            ...watchData,
          }
        : {}),
    },
  });

  return NextResponse.json(
    {
      id: newVersion.id,
      version: newVersion.version,
      googleDocUrl: newVersion.googleDocUrl ?? null,
    },
    { status: 201 }
  );
}
