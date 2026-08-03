-- Atribuição explícita da imobiliária: "este corretor é da minha casa e pode
-- conversar com o meu Max".
--
-- Default FALSE de propósito. `SplitRecipient.phone` não tem unique nenhum (ao
-- contrário de `User.phone`, que é @unique global), então o mesmo corretor
-- existe como commissioner em N orgs — e o telefone sozinho não diz de qual
-- casa ele é. Ligar por padrão faria toda org herdar corretores de parceiras.
--
-- NÃO é `notifyByWhatsapp`: receber aviso de um negócio compartilhado é
-- legítimo para corretor de imobiliária parceira; ser reconhecido como da casa
-- não é.
ALTER TABLE "SplitRecipient"
  ADD COLUMN IF NOT EXISTS "maxEnabled" BOOLEAN NOT NULL DEFAULT false;

-- O agente resolve identidade por telefone varrendo as orgs; sem índice isso
-- vira seq scan por org a cada mensagem recebida. Parcial porque a varredura só
-- pergunta por corretor atribuído e ativo — as duas colunas do predicado ficam
-- fora da chave justamente por serem constantes dentro dele.
CREATE INDEX IF NOT EXISTS "SplitRecipient_max_phone_idx"
  ON "SplitRecipient" ("orgId", "phone")
  WHERE "maxEnabled" AND "active";
