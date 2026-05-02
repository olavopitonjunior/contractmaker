# QA E2E — Prompt para `/chrome` (paridade Google Docs · commit 5108961d)

Cole este prompt inteiro numa sessão Claude Code que tenha o MCP `claude-in-chrome` ligado e um Chrome logado em produção (`imobpro.ia.br`).

---

Você é um QA E2E. Sua missão é validar manualmente, num browser real, que as features de UX/IA portadas para o modo Google Docs no Contractmaker funcionam em produção.

## Contexto

Em 2026-05-02 o editor migrou de TipTap pra Google Docs embedado. Hoje (commit 5108961d) foram portadas pra modo Google Docs:
- Banner de erro quando criação do Google Doc falhou (P0-1)
- Análise passiva on-open + on-edit sem editor TipTap (P0-2)
- SuggestionsToolbar que aceita/rejeita sugestões IA via API direto (P0-3)
- Botão "Novo comentário" no painel + dialog com trecho editável (P0-4)

Produção: https://imobpro.ia.br · login: olavo.piton@gmail.com.
A organização-padrão é a "Contractmaker (admin)" (single-tenant compartilhado).

## Setup (use mcp__claude-in-chrome__*)

1. `tabs_context_mcp` para ver tabs abertos. Se não houver tab logado em imobpro.ia.br, peça ao usuário pra logar manualmente — NÃO digite credenciais.
2. `tabs_create_mcp` em https://imobpro.ia.br/deals
3. `read_page` para confirmar que o pipeline carregou.
4. Procure um deal cujo card mostre "Confecção de Contrato" como stage atual e que tenha um contrato já gerado. Se não houver:
   - Crie um deal de teste (botão "+ Novo deal") com dados mínimos
   - Vá pelo wizard do form, preenche valor R$ 800.000 / financiamento R$ 600.000 / 1 vendedor / 1 comprador
   - "Confeccionar Contrato"
   - Aguarde redirect pra `/contracts/{id}`

## Cenário 1 — Análise passiva on-open em modo Google Docs (P0-2)

Pré-condição: contrato com `googleDocId` setado (banner amarelo do Google Docs aparece escondido — vide cenário 5 — significa que NÃO está em GDocs; pule pro cenário 5).

Passos:
1. `navigate` para `/contracts/{contractId}`
2. `take_screenshot` logo após carregar
3. Aguarde 12 segundos (análise passiva on-open dispara em <10s no modo google_docs)
4. `read_page` e procure pelo botão "Comentários" no header. Se houver badge numérico, anote o número.
5. Clique no botão "Comentários" → `take_screenshot` do painel aberto.
6. Verifique se há comentários do "Assistente IA" listados.

Critério de aceitação: pelo menos 1 comentário IA com Bot icon e severity warning/error visível no painel em <15s do open. Se 0 comentários e o contrato tem inconsistências óbvias (CPF inválido / soma errada), FALHA.

## Cenário 2 — SuggestionsToolbar via chat IA (P0-3)

1. No mesmo contrato, click no botão "Chat IA" no header.
2. No textarea do ChatPanel, digite:
   `Sugira melhorar a cláusula de irretratabilidade — proponha uma versão mais clara`
3. Submeta e aguarde até 30s.
4. `read_page` periodicamente até ver mensagem de assistant respondendo.
5. `take_screenshot`. Procure por uma BARRA AMARELA logo acima do iframe contendo:
   - Badge "X sugestões pendentes" (Sparkles icon)
   - Botões "Detalhes / Aceitar todas / Rejeitar todas"
6. Se a barra aparecer:
   - Clique "Detalhes" → `take_screenshot` expandido
   - Verifique que cada item mostra `originalText` (vermelho riscado) e `newText` (verde)
   - Clique "Aceitar" em uma sugestão individual
   - Aguarde 5s, `take_screenshot` do iframe
   - Recarregue o iframe (clique em "Abrir no Google Docs" e volte) ou faça F5 da página
   - Verifique que o texto mudou no doc

Critério: barra amarela aparece em <30s; aceitar uma sugestão remove ela da barra e modifica o texto visível no doc.

## Cenário 3 — Comentário manual com trecho editável (P0-4)

1. Clique "Comentários" no header. `take_screenshot` do painel.
2. No topo do painel deve aparecer um botão azul "+ Novo comentário". Se não, FALHA.
3. Clique no botão → dialog "Novo comentário" abre.
4. `take_screenshot` do dialog.
5. Verifique que tem 2 textareas: uma "Trecho de referência" + uma "Comentário".
6. **Trecho 1 (deve falhar):** cole `TEXTO QUE NÃO EXISTE NO CONTRATO XYZQWER`. Comentário: `Teste falha`. Click Comentar.
   Aguarde toast → deve aparecer mensagem em vermelho com "não encontrado" / "Trecho de referência não encontrado". Se aparecer toast de sucesso, FALHA.
7. Feche o dialog. Reabra com "Novo comentário".
8. **Trecho 2 (deve passar):** copie do iframe a primeira frase visível do contrato (ex: "CONTRATO PARTICULAR DE COMPROMISSO" ou similar — use o que estiver lá).
   Comentário: `Teste E2E ` + new Date().toISOString(). Click Comentar.
9. Aguarde toast verde "Comentário adicionado · veja no painel lateral do Google Doc".
10. `take_screenshot`. Verifique que:
    - Comentário aparece no painel à direita, com authorType=user e o trecho como blockquote
    - Dentro do iframe, no painel lateral nativo do Google Docs, aparece um comment com o mesmo texto ancorado no trecho

Critério: trecho-falso retorna erro com mensagem clara; trecho-real cria comment ancorado nos dois lugares.

## Cenário 4 — Refresh on-edit (P0-2 parte 2)

Esse cenário precisa de paciência (90s timer).

1. Volte ao contrato; abra "Comentários" e anote contagem atual de comentários IA.
2. No iframe Google Docs, edite um valor numérico (ex: troque o valor total do imóvel de R$ 800.000 para R$ 1.500.000) — basta selecionar o número e digitar outro.
3. Espere 100 segundos (GDOCS_REFRESH_MS = 90s + buffer).
4. Recarregue só o painel "Comentários" (feche e reabra o Sheet) — NÃO recarregue a página.
5. `take_screenshot` e compare a contagem.

Critério: novo finding sobre soma de parcelas inconsistente OU contagem mudou. Se contagem ficou idêntica e nenhum novo finding referencia o novo valor, FALHA.

## Cenário 5 — Banner de erro googleDocStatus (P0-1)

Esse cenário só pode rodar se houver um contrato com `googleDocStatus` começando com `error:`. Se nenhum contrato tem isso em produção, REPORTE como "skipped — sem fixture em produção" e siga.

Procurar manualmente: navegue por `/deals/*` abrindo contratos. Para cada um:
- `read_page` e procure por "Editor Google Docs indisponível" no início da página.
- Se achar: `take_screenshot`, anote causa exibida, tire screenshot.

Critério: se achou um contrato com erro, banner amarelo é renderizado com causa truncada em 240 chars + CTA explicando fallback offline.

## Relatório final

Volte aqui no chat e poste um markdown com:

```
## QA E2E — paridade Google Docs (commit 5108961d)
Data: <ISO>
Ambiente: imobpro.ia.br

| Cenário | Resultado | Evidência |
|---|---|---|
| 1 — análise on-open | PASS/FAIL/SKIP | screenshot 1.png, contagem N comments |
| 2 — SuggestionsToolbar | PASS/FAIL | ... |
| 3 — comment manual GDocs | PASS/FAIL | trecho-falso erro: <msg>, trecho-real OK |
| 4 — refresh on-edit | PASS/FAIL | delta contagem antes/depois |
| 5 — banner erro googleDoc | PASS/FAIL/SKIP | ... |

Bugs encontrados: lista numerada com path/comportamento/expected.
```

## Limites

- NÃO crie/aprove contratos reais que vão pra ClickSign. Use sempre rascunho.
- Se algo travar, NÃO insista mais que 3 tentativas — reporte e siga.
- Se o iframe Google Docs pedir login, peça ao usuário pra logar manualmente.
- NÃO compartilhe o doc com email externo. NÃO delete comments antigos.
