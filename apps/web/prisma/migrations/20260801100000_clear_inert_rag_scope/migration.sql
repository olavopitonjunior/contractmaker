-- Limpa `ragScope` gravado para agentes que NÃO consultam a base de conhecimento.
--
-- A tela ofereceu o editor de escopo para `passive` e `insights` entre
-- 2026-07-31 e agora. Nenhum dos dois chama o modelo com `tools` —
-- `runPassiveAnalysis` faz `messages.create` sem toolbox e o gerador de
-- insights não referencia a base — então o escopo salvo nunca teve efeito.
-- `support` lê a base por caminho próprio (filtra `category` explicitamente,
-- fora do helper de escopo), então também ignora `ragScope`.
--
-- Deixar a linha no banco seria pior que apagá-la: quem lesse o `AgentProfile`
-- depois concluiria que existe uma restrição em vigor. `supports.ragScope` no
-- registry passa a impedir que volte a ser gravado.
--
-- Idempotente: rodar de novo não encontra nada.
UPDATE "AgentProfile"
   SET "ragScope" = NULL
 WHERE "agentKey" IN ('passive', 'insights', 'support', 'ocr', 'max')
   AND "ragScope" IS NOT NULL;
