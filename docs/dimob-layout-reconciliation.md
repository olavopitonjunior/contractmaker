# DIMOB — Reconciliação do leiaute posicional do TXT

**Data:** 2026-07-06 · **Layout resultante:** `DIMOB_LAYOUT_VERSION = 2026-07-provisorio-3-header-t9-docleft`

## Por que este documento existe

A Receita **não publica** o leiaute posicional do TXT da DIMOB (só o PGD DIMOB o contém), e as
reproduções de ERPs terceiros divergem no byte. Nosso `apps/web/src/lib/dimob/layout.ts` foi
construído como **provisório**. Este documento reconcilia esse layout contra fontes independentes
para reduzir ao máximo o risco antes do aceite final (import no PGD). O gate definitivo continua
sendo importar um TXT real no PGD sem erros.

## Fontes usadas (independentes)

| # | Fonte | Tipo | Como acessada | Confiabilidade |
|---|-------|------|---------------|----------------|
| A | `orochasamuel/fiscalbr-net` (C#) | Biblioteca fiscal madura, campos com `[DimobCampos(ordem,inicio,fim,tamanho,formato)]` | raw.githubusercontent | Alta |
| B | `lucasnpinheiro/dimob` (PHP) | Lib (tamanhos via `str_pad`) | raw | Média (1 bug no sequencial) |
| C | `MatVini0601/dimob` (Java) + `saida.txt` | Constantes de posição + **arquivo real gerado** | raw | Alta (arquivo real) |
| D | `guilhermegouwloft/dimob` — `DIMOB - LAYOUT.txt` | **Arquivo DIMOB de produção (Foxter/RS)** dissecado byte a byte | raw | Alta (arquivo real) |

**Não acessíveis daqui (não verificadas):** Invent TaxOne (`docs.inventsoftware.info` — host fora do ar,
sem snapshot no Wayback), Senior (`documentacao.senior.com.br` — 404, URL versionada mudou), Mega,
Domínio (é leiaute contábil genérico, não DIMOB), docplayer, fórum contabeis (sem layout colado).

## Estrutura do arquivo (confirmada)

1. **Cabeçalho `DIMOB`** — 1ª linha, literal `"DIMOB"` + brancos, **total 374**.
2. **R01** — declarante, **270**.
3. **R04** — intermediação de venda, **321** (1 por operação).
4. **R02** — locação, **797** (1 por locador; 12 meses **agrupados por mês** × {aluguel, comissão, imposto}, 14 cada).
5. **Trailer `T9`** — última linha, literal `"T9"` + brancos, **total 102** (contador NÃO preenchido).
- (R03 construção/incorporação, 247 — só 1 fonte, **não implementado**, não confirmado.)
- Separador de linha: **CRLF** (convenção RFB; único ponto não cravado byte-a-byte).

## Veredito por registro

- **R01 (270):** consenso total (A+B+C+D). Bate byte a byte, incluindo retificadora(22,1),
  numeroRecibo(23–32), situacaoEspecial(33), dataEvento(34–41), codigoSituacao(42–43).
- **R02 (797):** consenso (A+B+C). Sequencial = **5** (não 7 — o "7" era bug isolado do PHP,
  contradito por A/C/D e 2 arquivos reais). Meses por mês, valores 14. CEP 754–761, município 762–765.
- **R04 (321):** consenso triplo (A + constantes C + arquivo real D dissecado). Ordem
  reservado1 → UF → reservado2 confirmada.

## Calibrações aplicadas (só onde ≥2 fontes independentes concordam e divergiam do nosso)

| # | Correção | Evidência | Onde |
|---|----------|-----------|------|
| **1** | **Adicionar cabeçalho `DIMOB` (374)** como 1ª linha | A+B+C+D (2 arquivos reais têm) — sem ele o PGD rejeita o import | `layout.ts` (`DIMOB_HEADER_LAYOUT`), `build-file.ts` |
| **2** | **Adicionar trailer `T9` (102)** como última linha (sem contador) | A+B+C+D | `layout.ts` (`DIMOB_TRAILER_LAYOUT`), `build-file.ts` |
| **3** | **CPF/CNPJ dos campos de parte = alinhado à ESQUERDA + espaços à direita** (não zero-à-esquerda). CNPJ (14) preenche; CPF (11) + 3 espaços | A (código: ramo `PadRight(' ')` p/ formato CPF/CNPJ) + C + D (bytes reais: `01158788070   `) | `txt-writer.ts` (case `doc`) |

## Confirmado correto (sem mudança)

- **Valores** (`money`, 14): zero-à-esquerda, centavos implícitos (ex.: `00000007900000` = R$ 79.000,00).
- **Data** (`date`, 8): **DDMMAAAA** (ex.: `02012023`). Nosso `toDdmmyyyy` já produz isso.
- Tamanhos: nomes 60, endereço R01 120 / imóvel 60, nº contrato 6, CEP 8, código município 4.
- Campos numéricos puros (ano, sequencial, nº recibo, código município) e R01 cpfResponsavel(11)/
  cnpjDeclarante(14): zero-à-esquerda / largura exata — mantidos.

## Pendências (deixadas para o PGD decidir)

- **Terminador CRLF**: convenção, mas o único arquivo medido em bytes usava LF (provável re-save Unix).
  Mantido CRLF.
- **R03**: não implementado (só 1 fonte).
- **Aceite final**: importar um TXT gerado no **PGD DIMOB** oficial (Declarações → Importar → Validar).
  Se acusar erro de posição, colar no copiloto ("Diagnosticar erro do PGD") e recalibrar `layout.ts`.
