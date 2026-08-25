-- Shadow mode do OCR: divergência entre o modelo de produção e um candidato.
--
-- ── Por que existe ────────────────────────────────────────────────────────
--
-- O bench de visão mede contra um gabarito anotado à mão. É o número mais
-- confiável que temos, e ainda assim é um corpus pequeno e escolhido — 10
-- documentos de um formulário. O shadow cobre o outro lado: TODO documento que
-- entra, sem gabarito, medindo só se os dois modelos concordam.
--
-- As duas medições respondem perguntas diferentes. O bench diz "quem lê certo";
-- o shadow diz "onde discordam, e com que frequência" — que é o que revela o
-- caso raro que nenhum corpus curado contém.
--
-- ── O que esta tabela NÃO guarda, de propósito ───────────────────────────
--
-- Nenhum VALOR extraído. Só nome de campo e contagem.
--
-- Gravar o valor criaria uma segunda cópia de CPF, RG e nome da mãe numa tabela
-- que ninguém trata como sensível, com retenção indefinida e fora de qualquer
-- fluxo de exclusão do titular. Para responder "os modelos divergem, e em quais
-- campos?", o nome do campo basta — e é a única pergunta que ela existe para
-- responder.
--
-- ── Segurança operacional ────────────────────────────────────────────────
--
-- O shadow nasce DESLIGADO (`OCR_SHADOW_MODEL` vazio). Isso não é só cautela de
-- produto: o projeto Vercel `web` roda previews contra o banco de PRODUÇÃO sem
-- migrar (ver apps/web/scripts/vercel-migrate.mjs, incidente 2026-07-14). Com a
-- flag ligada num preview, a escrita cairia numa tabela inexistente. Por isso a
-- gravação também está dentro de try/catch — a sombra jamais pode derrubar a
-- extração que o usuário está esperando.
--
-- `attachmentId` sem FK: a medição continua válida depois de o anexo ser
-- apagado, e uma FK criaria dependência de exclusão em cima de dado de análise.

CREATE TABLE "OcrShadowComparison" (
    "id"                TEXT NOT NULL,
    "orgId"             TEXT,
    "attachmentId"      TEXT,
    "primaryModel"      TEXT NOT NULL,
    "shadowModel"       TEXT NOT NULL,
    "primaryCategory"   TEXT,
    "shadowCategory"    TEXT,
    "categoryDiverged"  BOOLEAN NOT NULL DEFAULT false,
    "fieldsEqual"       INTEGER NOT NULL DEFAULT 0,
    "fieldsDiverged"    TEXT[],
    "fieldsOnlyPrimary" TEXT[],
    "fieldsOnlyShadow"  TEXT[],
    "primaryLatencyMs"  INTEGER NOT NULL DEFAULT 0,
    "shadowLatencyMs"   INTEGER NOT NULL DEFAULT 0,
    "shadowCostUsd"     DECIMAL(12,6) NOT NULL DEFAULT 0,
    "shadowError"       TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrShadowComparison_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OcrShadowComparison_orgId_createdAt_idx"
    ON "OcrShadowComparison"("orgId", "createdAt");

CREATE INDEX "OcrShadowComparison_shadowModel_createdAt_idx"
    ON "OcrShadowComparison"("shadowModel", "createdAt");
