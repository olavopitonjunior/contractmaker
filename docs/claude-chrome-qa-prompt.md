# Prompt — QA em produção (Claude Chrome)

Copie e cole o bloco abaixo no Claude Chrome. Antes de enviar, substitua:

- `<URL_PROD>` pela URL do deploy (ex: `https://contractmaker.vercel.app`)
- `<EMAIL>` / `<SENHA>` por credenciais válidas
- `<DEAL_ID>` por um deal que tenha contrato ou crie um novo durante o teste

---

## Prompt

```
Você é um QA que vai validar em produção um pacote novo de features do Contractmaker
(editor de contratos, sistema de comentários, track changes, find & replace, quebra de
página, revisão pré-aprovação). O Contractmaker é uma plataforma SaaS em Next.js 14 +
TipTap + Prisma/Postgres para gestão de vendas e contratos imobiliários.

Ambiente: <URL_PROD>
Login: <EMAIL> / <SENHA>
Deal de teste (opcional): <DEAL_ID>

IMPORTANTE
- Trabalhe em ABA ANÔNIMA para não interferir com sessões ativas do usuário.
- NÃO aprove nenhum contrato real. Se precisar aprovar para testar B7, use um contrato
  marcado como "teste" no título do deal.
- NÃO delete dados reais. Qualquer comentário/sugestão que você criar, RESOLVA ou
  DELETE ao final do teste.
- Se encontrar um erro fatal (tela branca, 500, crash do editor), PARE imediatamente,
  tire screenshot, e reporte — não tente contornar.
- Reporte cada cenário como PASS/FAIL/BLOCKED com evidência (screenshot + descrição).

ROTEIRO DE TESTES (execute na ordem)

=== 1. Login e navegação ===
1.1 Acesse <URL_PROD>/login, faça login, confirme que o dashboard carrega.
1.2 Navegue até /clauses. Observe os títulos dos grupos G1-G6.
    ✓ VALIDAR: todos os acentos estão corretos ("Imissão na Posse", "Rescisão e
      Condição Resolutiva", "Declarações e Disposições Especiais"). Não deve haver
      "Imissao", "Rescisao", "Declaracoes" etc.

=== 2. Fix do ClauseEditor (bug D2) ===
2.1 Em /clauses, passe o mouse sobre o card "Arras Confirmatórias" (grupo G1) até
    aparecer o ícone de lápis. Clique para editar.
    ✓ VALIDAR: o painel lateral abre com TODOS os campos preenchidos (Título,
      Conteúdo Handlebars, Descrição, Tags, Notas para o Agente IA). Nenhum campo
      deve aparecer vazio.
2.2 Feche o painel (X ou fora). Clique em editar uma cláusula DIFERENTE (ex: qualquer
    uma de G3).
    ✓ VALIDAR: os campos mostram os dados da nova cláusula, não resíduos da anterior.
2.3 Abra uma cláusula, mude o título adicionando " (teste)" no final, salve, recarregue
    a página e confirme que persistiu. Edite de novo e REMOVA o " (teste)" para deixar
    limpo.

=== 3. Editor de contratos — toolbar e bubble menu ===
3.1 Navegue até /contracts, abra qualquer contrato em rascunho (status ≠ "aprovado").
    Se não existir, crie um: pipeline → deal com formulário preenchido → "Gerar
    Contrato" (ou botão equivalente).
3.2 Confira a toolbar do editor. Deve ter 6 GRUPOS separados por linhas verticais:
    Texto (Bold/Italic/Underline/Strike), Headings (¶/H1/H2/H3), Listas (UL/OL/Indent/
    Outdent), Alinhamento (E/C/D/Justify), Inserir (Link/Tabela/HR/Page Break),
    Ações (Undo/Redo/Search).
    ✓ VALIDAR: passando o mouse em cada botão aparece tooltip com nome + atalho
      (ex: "Negrito (Ctrl+B)").
3.3 Teste atalhos no editor: Ctrl+B, Ctrl+I, Ctrl+U. Confirme que aplicam
    bold/italic/underline.
3.4 No rodapé do editor, procure "X palavras · Y caracteres".
    ✓ VALIDAR: ambos os contadores atualizam ao digitar.

=== 4. Floating bubble menu ===
4.1 Selecione um trecho de 2-3 palavras no meio do contrato.
    ✓ VALIDAR: aparece uma barra flutuante acima da seleção com ícones Bold, Italic,
      Underline, Strike, Link, Highlight, Comentar (balão), e um botão laranja "IA"
      com estrela.
4.2 Clique no ícone Link, cole "https://exemplo.com", dê Enter.
    ✓ VALIDAR: o texto fica sublinhado/destacado como link.
4.3 Selecione o mesmo trecho e clique no Link de novo, apague a URL e dê Enter.
    ✓ VALIDAR: o link é removido.

=== 5. Find & Replace (Ctrl+F) ===
5.1 Pressione Ctrl+F no editor.
    ✓ VALIDAR: aparece uma barra logo abaixo da toolbar com campo Buscar, campo
      Substituir, contador, setas anterior/próximo, e ícones de Aa / palavra inteira
      / X.
5.2 Digite uma palavra que apareça várias vezes no contrato (ex: "vendedor").
    ✓ VALIDAR: todas as ocorrências ficam destacadas em amarelo; a ocorrência "atual"
      tem destaque laranja mais forte; contador mostra "1 de N".
5.3 Clique na seta de próximo várias vezes.
    ✓ VALIDAR: a ocorrência ativa muda e o viewport rola para cada uma.
5.4 No campo Substituir, digite "VENDEDOR" (maiúsculas). Clique em "Substituir" (ícone
    de um swap).
    ✓ VALIDAR: a ocorrência atual é substituída, o contador atualiza.
5.5 Clique em "Substituir Todos".
    ✓ VALIDAR: todas as ocorrências restantes são substituídas; contador vai a 0.
5.6 Pressione Esc.
    ✓ VALIDAR: a barra fecha e os highlights desaparecem.
5.7 Ctrl+Z para desfazer as substituições.
    ✓ VALIDAR: o texto original volta.

=== 6. Comentários laterais ===
6.1 Selecione um trecho no editor. No bubble menu, clique no ícone de balão (Comentar).
    ✓ VALIDAR: abre um Dialog "Novo comentário" mostrando o trecho selecionado e um
      campo de texto.
6.2 Digite "Teste QA - observação 1" e clique em "Comentar".
    ✓ VALIDAR: o trecho no editor fica com fundo amarelo claro + borda inferior amarela
      (comment anchor). Um painel lateral direito "Comentários" abre automaticamente
      mostrando o comentário criado.
6.3 No painel, crie mais um comentário em outro trecho. Confira que aparecem os 2
    comentários. Passe o mouse em um card — confirme que ao clicar, o editor rola até
    a âncora e destaca brevemente.
6.4 Clique "Responder" em um comentário, digite "Resposta 1", envie.
    ✓ VALIDAR: a resposta aparece aninhada abaixo do comentário pai.
6.5 Clique "Resolver" em um comentário.
    ✓ VALIDAR: o comentário some do painel; o fundo amarelo desaparece do trecho no
      editor.
6.6 Clique "Delete" (lixeira) no comentário restante para limpar o teste.

=== 7. Track Changes (sugestões da IA) ===
7.1 Abra o painel de chat IA (botão "Chat IA" no header).
7.2 Envie a mensagem: "Sugira trocar o prazo de 30 dias para 45 dias em qualquer
    cláusula que mencione prazo de 30 dias".
    ✓ VALIDAR: a IA responde com markdown estruturado contendo "## Alterações
      Realizadas", "## Justificativa", "## Verificação".
7.3 Feche o chat, olhe o editor.
    ✓ OBSERVAÇÃO: se a IA usou modo sugestão, você verá uma barra âmbar no topo do
      editor ("N sugestões pendentes") e trechos verdes/vermelhos no texto. Se ela
      aplicou direto (edit_contract_section), NÃO haverá essa barra — ainda é
      comportamento aceitável, apenas reporte qual ocorreu.
7.4 Se apareceu a barra de sugestões, clique em uma sugestão verde/vermelha e teste
    "Aceitar todas" / "Rejeitar todas".
    ✓ VALIDAR: as marcações são removidas e o texto final fica consistente.

=== 8. Quebra de página ===
8.1 Posicione o cursor em um parágrafo. Pressione Ctrl+Enter.
    ✓ VALIDAR: aparece uma linha tracejada com o texto "Quebra de página" centrado.
8.2 Clique no botão de exportar → PDF. Aguarde geração e abra o PDF.
    ✓ VALIDAR: o ponto onde você inseriu a quebra corresponde ao fim de uma página
      no PDF.
8.3 Volte ao editor, remova a quebra de página manual (clique na linha tracejada e
    delete).

=== 9. Revisão pré-aprovação ===
9.1 Crie pelo menos 1 comentário com severity "warning" ou deixe 1 sugestão pendente
    no contrato. Se você limpou tudo nos passos anteriores, adicione 1 comentário
    novo agora.
9.2 Clique em "Aprovar" (botão verde no header).
    ✓ VALIDAR: aparece um Dialog "Revisão necessária antes de aprovar" listando:
      contagem de erros/avisos, contagem de sugestões pendentes, contagem de
      comentários abertos. Deve ter dois botões: "Revisar" e "Aprovar mesmo assim".
9.3 Clique em "Revisar" — o dialog fecha sem aprovar.
9.4 Limpe os comentários/sugestões (resolva todos).
9.5 Clique em "Aprovar" de novo.
    ✓ VALIDAR: se não há mais issues, aprova direto sem dialog. Se ainda houver warnings
      ou sugestões, aparece o dialog de novo.
9.6 IMPORTANTE: NÃO finalize a aprovação se for um contrato real. Se for um contrato
    de teste, clique "Aprovar mesmo assim" e confirme que:
      - toast de sucesso aparece
      - editor entra em modo read-only
      - banner verde "Contrato aprovado - edição bloqueada" aparece no topo
      - chat IA e botões de edição ficam desabilitados

=== 10. Sincronização título do formulário → pipeline (F6) ===
10.1 Vá em /forms, crie um formulário novo. No título, coloque "QA TESTE - abril".
10.2 Vá em /pipeline.
    ✓ VALIDAR: o card no Kanban mostra "QA TESTE - abril" como título.
10.3 Volte em /forms, abra o formulário e renomeie para "QA TESTE - validado".
10.4 Recarregue /pipeline.
    ✓ VALIDAR: o card agora mostra "QA TESTE - validado".
10.5 Delete o formulário/deal de teste.

=== 11. Sanity checks finais ===
11.1 Abra o DevTools Console. Recarregue a página do editor.
    ✓ VALIDAR: zero erros vermelhos. Warnings amarelos são aceitáveis.
11.2 Teste em um viewport mobile (Responsive Design Mode, 375px largura).
    ✓ VALIDAR: a toolbar do editor vira flex-wrap, bubble menu continua funcionando,
      painel lateral de comentários ocupa tela cheia.
11.3 Exporte o contrato em PDF e DOCX, baixe e abra os arquivos.
    ✓ VALIDAR: o conteúdo está íntegro, quebras de página respeitadas (PDF), formatação
      preservada (DOCX).

RELATÓRIO FINAL
Apresente no fim um resumo no formato:

| # | Cenário | Resultado | Notas |
|---|---------|-----------|-------|
| 1 | Login e acentos | PASS/FAIL | ... |
| 2 | ClauseEditor fix | PASS/FAIL | ... |
| ... | ... | ... | ... |

Para cada FAIL, inclua: screenshot, URL da tela, passos para reproduzir, comportamento
observado vs esperado, e severidade (blocker/major/minor).

Comece agora pelo passo 1. Me avise antes de começar qualquer passo que envolva criar,
deletar ou aprovar dados.
```

---

## Checklist rápido para o revisor humano após o run do Claude Chrome

- [ ] Verificou o Console do browser em cada tela (zero errors)?
- [ ] Testou todos os 11 cenários acima?
- [ ] Registrou evidências (screenshots) para cada FAIL?
- [ ] Limpou todos os dados de teste criados?
- [ ] Confirmou que NÃO aprovou contratos reais?
