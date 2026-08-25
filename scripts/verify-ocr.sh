#!/usr/bin/env bash
#
# Verifica, por chamadas diretas de API, qual modelo de OCR está no ar.
#
# Por que existe: trocar env var no Vercel NÃO garante que o runtime pegou.
# `vercel redeploy` reaproveita o snapshot de env do deploy anterior — fica
# READY servindo o valor velho, sem sintoma. Já aconteceu com GEMINI_OCR_MODEL.
# Env declara intenção; só o runtime é prova.
#
# Uso:
#   OPS_VERIFY_SECRET=... ./scripts/verify-ocr.sh
#   OPS_VERIFY_SECRET=... BASE_URL=https://staging.imobpro.ia.br ./scripts/verify-ocr.sh
#   OPS_VERIFY_SECRET=... EXPECT_MODEL=gemini-3.5-flash-lite EXPECT_SHA=c024e57 ./scripts/verify-ocr.sh
#
# ATENÇÃO: o secret de staging é DIFERENTE do de produção. Usar o de prod
# contra staging dá 401 e o script reporta "não é JSON" — que parece
# "a rota não subiu", quando subiu. V2/V3 passam mesmo assim (não usam o
# secret válido), o que torna esse engano fácil de cometer.
#
# Sai 0 se tudo passou, 1 se qualquer passo falhou. WARN não reprova.

set -uo pipefail

BASE_URL="${BASE_URL:-https://imobpro.ia.br}"
EXPECT_MODEL="${EXPECT_MODEL:-gemini-3.5-flash-lite}"
EXPECT_STRUCTURED="${EXPECT_STRUCTURED:-true}"
EXPECT_SHADOW="${EXPECT_SHADOW:-gemini-2.5-flash}"
EXPECT_SHA="${EXPECT_SHA:-}"
DAYS="${DAYS:-7}"

FALHAS=0
AVISOS=0

verde()    { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
vermelho() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FALHAS=$((FALHAS+1)); }
amarelo()  { printf '  \033[33mWARN\033[0m  %s\n' "$1"; AVISOS=$((AVISOS+1)); }

# OPS_VERIFY_SECRET é o preferido; CRON_SECRET é fallback de transição.
# Vale separar: CRON_SECRET destranca cron/asaas/transfer-dispatch (PIX/TED).
# Este script roda a cada deploy, exportado no shell de quem verifica — que não
# é necessariamente quem pode mover dinheiro.
SECRET="${OPS_VERIFY_SECRET:-${CRON_SECRET:-}}"
if [[ -z "$SECRET" ]]; then
  echo "Defina OPS_VERIFY_SECRET (preferido) ou CRON_SECRET no ambiente." >&2
  echo "Atenção: o secret de staging é DIFERENTE do de produção." >&2
  exit 2
fi

case "$BASE_URL" in
  http://*|https://*) ;;
  *) echo "BASE_URL inválida: precisa começar com http:// ou https://" >&2; exit 2 ;;
esac

echo "verificando $BASE_URL (esperando modelo '$EXPECT_MODEL')"
echo

# ---------------------------------------------------------------- V2
# 401 prova que a rota EXISTE e negou. 404 significa que o deploy não subiu —
# distinção que falta quando tudo fica READY servindo código velho.
echo "V2  rota existe e é fail-closed (sem header)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/admin/ocr-verify")
case "$CODE" in
  401) verde "HTTP 401 — rota existe e exige auth" ;;
  404) vermelho "HTTP 404 — rota NÃO está no build deployado" ;;
  503) vermelho "HTTP 503 — CRON_SECRET não configurado no servidor" ;;
  *)   vermelho "HTTP $CODE — esperava 401" ;;
esac

# ---------------------------------------------------------------- V3
echo "V3  auth rejeita secret errado"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H @- \
  "$BASE_URL/api/admin/ocr-verify" <<<"Authorization: Bearer segredo-invalido-para-teste")
if [[ "$CODE" == "401" ]]; then
  verde "HTTP 401 com secret errado"
else
  vermelho "HTTP $CODE com secret errado — esperava 401"
fi

# ---------------------------------------------------------------- V4
echo "V4  qual build está no ar"
HEALTH=$(curl -s "$BASE_URL/api/health")
VERSION=$(printf '%s' "$HEALTH" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' 2>/dev/null)
if [[ -z "$VERSION" ]]; then
  vermelho "/api/health não respondeu JSON com 'version'"
elif [[ -n "$EXPECT_SHA" ]]; then
  if [[ "$VERSION" == "$EXPECT_SHA"* || "$EXPECT_SHA" == "$VERSION"* ]]; then
    verde "version=$VERSION bate com EXPECT_SHA=$EXPECT_SHA"
  else
    vermelho "version=$VERSION != EXPECT_SHA=$EXPECT_SHA — outro build no ar"
  fi
else
  amarelo "version=$VERSION (EXPECT_SHA não informado, nada a comparar)"
fi

# ---------------------------------------------------------------- V5-V8
echo "V5-V8  config efetiva do OCR"
# `-H @-` lê o header do stdin: tira o segredo do ARGV, então ele não aparece
# em `ps aux`. Não elimina a exposição por env — passado como
# `OPS_VERIFY_SECRET=... ./verify-ocr.sh`, o valor é herdado pelos subprocessos
# e fica legível em /proc/<pid>/environ enquanto rodam. Isso é inerente a
# secret via env (mesmo caso dos crons); `-H @-` fecha só o argv.
BODY=$(curl -s -H @- "$BASE_URL/api/admin/ocr-verify?days=$DAYS" \
  <<<"Authorization: Bearer $SECRET")

if ! printf '%s' "$BODY" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  vermelho "resposta não é JSON válido (secret errado? rota fora?)"
  printf '%s\n' "$BODY" | head -c 300
  echo
  echo
  echo "resultado: $FALHAS falha(s), $AVISOS aviso(s)"
  exit 1
fi

ler() { printf '%s' "$BODY" | python3 -c "
import json,sys
d = json.load(sys.stdin)
for parte in '$1'.split('.'):
    d = d.get(parte) if isinstance(d, dict) else None
print('' if d is None else d)
"; }

MODELO=$(ler "ocr.effectiveModel")
STRUCTURED=$(ler "ocr.structuredOutput")
SHADOW=$(ler "ocr.shadowModel")
PROVIDER=$(ler "ocr.provider")
KEY_OK=$(ler "ocr.providerKeyPresent")

# V5 — o assert que dá nome a este script
if [[ "$MODELO" == "$EXPECT_MODEL" ]]; then
  verde "modelo ativo = $MODELO"
else
  vermelho "modelo ativo = '$MODELO', esperava '$EXPECT_MODEL'"
fi

# V6
[[ "$STRUCTURED" == "True" || "$STRUCTURED" == "true" ]] && ST=true || ST=false
if [[ "$ST" == "$EXPECT_STRUCTURED" ]]; then
  verde "structuredOutput = $ST"
else
  vermelho "structuredOutput = $ST, esperava $EXPECT_STRUCTURED"
fi

# V6b — shadow é WARN: desligado é config válida, não falha.
if [[ "$SHADOW" == "$EXPECT_SHADOW" ]]; then
  verde "shadowModel = $SHADOW"
else
  amarelo "shadowModel = '${SHADOW:-<desligado>}', esperava '$EXPECT_SHADOW'"
fi

# V8 — o apagão silencioso: gpt-* sem chave derruba 100% do OCR sem fallback
if [[ "$PROVIDER" == "openai" ]]; then
  if [[ "$KEY_OK" == "True" || "$KEY_OK" == "true" ]]; then
    verde "provider=openai e OPENAI_API_KEY presente"
  else
    vermelho "provider=openai SEM OPENAI_API_KEY — 100% das extrações falham, sem fallback"
  fi
else
  if [[ "$KEY_OK" == "True" || "$KEY_OK" == "true" ]]; then
    verde "provider=$PROVIDER com chave presente"
  else
    vermelho "provider=$PROVIDER SEM chave configurada"
  fi
fi

# V9 — evidência de runtime. WARN, não FAIL: OCR é sob demanda, então ausência
# de chamada recente não prova falha nenhuma. É o único passo que olha o que
# REALMENTE rodou; todos os outros olham config.
echo "V9  evidência de runtime (últimos $DAYS dia(s))"
VISTOS=$(printf '%s' "$BODY" | python3 -c "
import json,sys
d = json.load(sys.stdin)
for m in d.get('runtime', {}).get('modelsSeen', []):
    print(f\"{m['operation']}\t{m['model']}\t{m['calls']}\t{m['lastAt']}\")
")
if [[ -z "$VISTOS" ]]; then
  amarelo "nenhuma extração na janela — não prova nem refuta (OCR é sob demanda)"
else
  printf '%s\n' "$VISTOS" | sed 's/^/        /'

  # A pergunta certa é "o modelo esperado JÁ rodou?", não "qual foi o último?".
  #
  # Comparar só a extração mais recente dá falso FAIL: se a última chamada é
  # ANTERIOR à troca de env, ela legitimamente usou o modelo antigo — isso é
  # histórico, não defeito. Foi o que o primeiro smoke em staging mostrou
  # (última extração 10:46, env trocada às 13:00). FAIL que dispara sem defeito
  # real ensina quem opera a ignorar o script.
  #
  # Distinguir "config não pegou" de "sem tráfego novo" exigiria a data do
  # deploy, que este script não tem. Então: presença do modelo esperado é prova
  # (PASS); ausência é falta de evidência (WARN), nunca FAIL.
  ESPERADO=$(printf '%s' "$VISTOS" \
    | awk -F'\t' -v m="$EXPECT_MODEL" '$1=="ocr_form" && $2==m {print $3"\t"$4; exit}')
  RECENTE=$(printf '%s' "$VISTOS" | awk -F'\t' '$1=="ocr_form"{print $2"\t"$4; exit}')

  if [[ -n "$ESPERADO" ]]; then
    verde "modelo esperado já rodou em tráfego real ($(printf '%s' "$ESPERADO" | cut -f1) chamada(s), última em $(printf '%s' "$ESPERADO" | cut -f2))"
  elif [[ -z "$RECENTE" ]]; then
    amarelo "sem linha ocr_form na janela — não prova nem refuta"
  else
    amarelo "modelo esperado ainda não rodou; a mais recente foi '$(printf '%s' "$RECENTE" | cut -f1)' em $(printf '%s' "$RECENTE" | cut -f2), possivelmente anterior ao deploy. Suba um documento e rode de novo."
  fi
fi

DBERR=$(ler "runtime.dbError")
[[ -n "$DBERR" ]] && amarelo "banco indisponível: $DBERR"

echo
if [[ "$FALHAS" -eq 0 ]]; then
  echo "resultado: OK — $AVISOS aviso(s), nenhuma falha"
  exit 0
else
  echo "resultado: $FALHAS falha(s), $AVISOS aviso(s)"
  exit 1
fi
