# Changelog

Todas as mudancas notaveis neste projeto serao documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

## [Unreleased] - 2026-09-05 - A comissão paga na Superlógica fecha o negócio sozinha

### Adicionado

- **O negócio exportado se fecha quando a comissão é paga.** A cobrança da comissão passou a ser da Superlógica, então é de lá que vem a notícia do pagamento. A plataforma agora consulta a cada meia hora as vendas que exportou e, quando a parcela da comissão aparece liquidada, leva o negócio para "Comissão paga" com a data real da liquidação — não a data da consulta — e lança na Superlógica a despesa de cada comissionado, na conta contábil configurada pela imobiliária. O corretor não precisa mais dar baixa à mão em dois sistemas. Cada lançamento fica registrado antes do seguinte, então uma consulta repetida nunca paga o mesmo comissionado duas vezes.
- **Venda desfeita na Superlógica vira aviso, não mudança silenciosa.** Se alguém cancelar ou excluir por lá a venda que a plataforma criou, a exportação do negócio é marcada com erro explicando o que aconteceu, e o negócio fica onde está. Quem desfez foi uma pessoa, e mexer no funil sozinho esconderia isso de quem acompanha o processo.

## [Unreleased] - 2026-09-05 - A venda vai do negócio para a Superlógica

### Adicionado

- **"Enviar para Superlógica" na aba Pagamentos do negócio de venda.** Com a Superlógica conectada (Configurações › Integrações) e o negócio em "Contrato assinado", o operador abre um preview que espelha a tela "Venda" da Superlógica — data da venda, valor, comissão e parcela, imóvel, proprietários, compradores e comissionados com percentual e valor — com os bloqueios (sem comprador, sem conta bancária, acima do teto, comissão paga por ambas as partes) e os avisos (documento ausente, tipo de imóvel padrão) antes de qualquer envio. Ao confirmar, a plataforma cria na licença da imobiliária as pessoas que ainda não existem (reutilizando pelas que têm o mesmo CPF/CNPJ), os corretores comissionados, o imóvel e a venda completa em uma chamada; o negócio passa para "Cobrança emitida", ganha o selo "Na Superlógica: venda N" com link, e o botão de cobrança de comissão pelo Asaas é desligado, porque a comissão passa a ser cobrada pela Superlógica. Cada passo grava o vínculo antes do seguinte: se algo falhar no meio, uma nova tentativa reaproveita o que já foi criado e a Superlógica não recebe duplicatas. Só quem tem a permissão "Enviar venda para a Superlógica" enxerga o botão, e só para negócios do próprio escopo.

## [Unreleased] - 2026-09-05 - A imobiliária conecta a própria conta Superlógica

### Adicionado

- **Conta Superlógica por imobiliária em Configurações › Integrações.** O owner/admin informa a licença e os tokens (app e access) da conta da própria imobiliária; a plataforma valida a credencial nas duas APIs que a exportação usa — Imobiliárias e Financeiro v2 — antes de gravar, e guarda os tokens cifrados com AES-256-GCM por organização. Não existe credencial de plataforma nem fallback de `.env`: sem conta conectada, a imobiliária não fala com a Superlógica. A tela traz ainda os padrões da exportação (conta bancária das parcelas, filial, conta contábil da comissão, tipo de imóvel padrão, NF/DIMOB, quem paga a comissão, vencimento e teto), com auto-save por campo; "Testar" revalida nas duas APIs, "Reconectar" troca os tokens preservando os padrões e "Desconectar" apaga os tokens. Os tokens nunca voltam do servidor. A feature `vendas.superlogica` nasce desligada — depende de a Superlógica registrar o app do lado deles — e é ligada tenant a tenant no super-admin. Exportar a venda em si vem nos próximos lotes.

## [Unreleased] - 2026-09-05 - Documentos da proposta no formulário e diálogo de certidões da proposta

### Adicionado

- **Documentos da proposta agora aparecem também no formulário do negócio.** Ao converter uma proposta, os documentos anexados (pelo corretor ou pelo cliente) passam a estar na etapa de documentos do formulário, além da aba Documentos — mesmo arquivo, com o que a IA já leu e a parte a que pertencem. A leitura por IA continua sendo por clique.

### Corrigido

- **Diálogo "Emitir certidões" na proposta** não mostra mais "Pessoas adicionais", "Pesquisa Serasa — Em breve" nem a linha de gasto do mês, que são do negócio e não tinham ação na proposta.

## [Unreleased] - 2026-09-05 - Revisão de modelo: as checagens pegam o que a Trio expôs (medido)

### Corrigido

- **Três lacunas nas checagens semânticas da revisão de modelo, medidas por bateria.** Uma bateria nova (`scripts/ai-bench/placeholders/semantic-recall.ts`) reproduz, sobre o texto que a padronização produz hoje, cada defeito registrado na conferência dos 16 modelos da RE/MAX Trio, e mede se a revisão o aponta. Primeira medição: 58% (56 de 96). Os três zeros eram regras: **endereço da imobiliária escrito depois da chave** não contava como sobra (agora conta, com CEP incluído, e o botão "Remover o trecho" cobre o endereço inteiro); **cláusula de rateio colapsada numa chave solta** só era vista quando os parágrafos vizinhos não tinham chave nenhuma — e a cláusula anterior sempre tem o dia do vencimento chaveado (agora o alinhamento é o mesmo da aba "Cláusulas", que casa vizinho chaveado, e a restauração devolve cabeçalho + itens); **"item 4.2." citado com o 4.2 engolido** passava porque "4.2.2." contava como definição (não conta mais). Depois: 100% (96 de 96), zero achado no texto limpo, planejador inalterado nas fixtures.
- **Decisão registrada: não construir revisor por IA (R7).** O critério do plano era recall determinístico abaixo de 80%; ficou em 100%. Erro novo de produção vira uma injeção na bateria e uma regra, não um prompt.

## [Unreleased] - 2026-09-05 - Análise de crédito segue da proposta para o negócio

### Adicionado

- **A análise de crédito (Ficha Certa) acompanha a conversão da proposta**, para as imobiliárias com a análise de crédito habilitada. Ao converter a proposta de locação em negócio, os laudos já emitidos (situação, Score FC, parecer, PDF) aparecem na aba Dados do negócio, no card "Análise de crédito (Ficha Certa)", sem pedir nem pagar nada de novo. No stage "Em Aprovação" o card traz o botão "Aprovar ficha" (que não tinha mais lugar na tela) e o atalho "Analisar na proposta" para uma nova análise.

### Corrigido

- O `CLAUDE.md` apontava a lista de ações de auditoria para um arquivo que não existe; agora aponta para `lib/security/audit.ts`.

## [Unreleased] - 2026-09-05 - Análise de crédito Ficha Certa na proposta

### Adicionado

- **Análise de crédito (Ficha Certa) disparada da proposta de locação, para as imobiliárias com a análise de crédito habilitada** (nasce desligada). Com a conta da imobiliária conectada, consentimento registrado e os pretendentes completos, "Analisar pretendentes" envia locatário, cônjuge, fiador e cônjuge do fiador para a Ficha Certa de uma vez. O laudo volta sozinho (webhook da conta, com o cron como rede de segurança): cada pessoa aparece com situação (sem restrição / com restrição), Score FC, parecer e recomendações; ao final, o parecer da locação (inquilinos e fiadores) e o PDF do laudo entram em Documentos. "Atualizar" consulta a Ficha Certa na hora. O disparo respeita o teto mensal e os créditos pré-pagos da conta, não reenvia quem já está em análise e explica cada bloqueio (conta não conectada, consentimento, dados faltando).

## [Unreleased] - 2026-09-04 - Cláusulas do modelo lado a lado com o contrato original

### Adicionado

- **Aba "Cláusulas" na revisão do modelo.** Ao lado de "Documento" e "Prévia com dados de exemplo", a nova aba mostra o Doc-modelo parágrafo a parágrafo — cada `{{chave}}` marcada na cor da parte a que pertence (locador, locatário, imóvel, corretor, imobiliária…) — e, na coluna da direita, o parágrafo do contrato ORIGINAL que aquele trecho substituiu. Era o que faltava para ver o que a padronização fez: uma cláusula inteira colapsada numa chave solta aparece como um parágrafo do modelo "valendo" por três do original, com os que sumiram em linhas próprias ("sumiu do modelo"); a chave do corretor no item da imobiliária aparece com o nome da imobiliária a um palmo de distância. Os achados da revisão semântica ficam na linha do parágrafo, com o mesmo botão de conserto do card "Problemas". Filtros "só com chaves" e "só com problemas". O alinhamento tolera espaço fixo e espaçamento; um parágrafo que é só uma chave nunca é dado como "igual" ao original. Modelo sem lote (criado do zero ou enviado avulso) abre a aba em uma coluna e diz por quê.
- **Consertos por linha, sem sair da aba.** Em rascunho, cada linha oferece "Trocar chave…" (parágrafo com uma chave simples: escolhe a chave certa no catálogo), "Restaurar do original" (parágrafo pareado cujo texto difere do original, desde que não carregue bloco composto) e "Remover ‘trecho’" sobre o texto selecionado na linha. Todos passam pelo mesmo caminho das correções automáticas (`doc-edit`): frase do próprio Doc, uma ocorrência só, revalidação no mesmo passo, linha de auditoria. "Restaurar" só aparece em parágrafo sem chave nenhuma — e o próprio `doc-edit` passa a recusar restaurar um parágrafo de prosa + chave (apagaria a chave e devolveria o dado literal ao modelo); o colapso puro continua restaurável. Linha cujo pareamento tinha mais de um candidato no original vem marcada "correspondência aproximada". Selecionar texto na aba também alimenta o painel "Inserir campos que faltam". Modelo ativo é só leitura. Se a busca do original falhar, a aba diz que não conseguiu e oferece tentar de novo, em vez de cravar "sem arquivo original".
- **`GET /api/templates/[id]/source-text`** devolve os parágrafos do contrato original do acervo (junção por hash do arquivo e org do lote, como a revalidação já fazia), para o mesmo papel que lê o Doc inteiro.

## [Unreleased] - 2026-09-04 - Certidões direto na proposta

### Adicionado

- **Certidões da proposta, antes do negócio.** A tela da proposta (venda e locação, quando a imobiliária tem certidões habilitadas para a esteira) ganha a seção "Certidões" — a mesma da aba do negócio: plano automático por parte e imóvel, escolha do que emitir, acompanhamento em tempo real, "Corrigir dados" para o que faltou, relatório em PDF. Os PDFs entram em "Documentos" da proposta já atribuídos à parte certa. Ao converter a proposta em negócio, tudo o que foi emitido segue junto: a aba Certidões do negócio nasce preenchida e nada é pedido (nem pago) de novo. Na proposta não há Serasa (a análise de crédito é outra), pessoas adicionais, análise por IA, ZIP nem compartilhamento — são superfícies do negócio.

### Corrigido

- **"Pretendentes & renda" sem botões em proposta enviada.** A seção nascia sem "Editar" e sem "Registrar consentimento" depois do envio, justamente quando a análise de crédito acontece; o corte agora é o mesmo das rotas (só proposta encerrada bloqueia).

## [Unreleased] - 2026-09-04 - Pretendentes, renda e consentimento LGPD na proposta de locação

### Adicionado

- **Quem vai ser analisado, com o que falta, direto na proposta.** Na proposta de locação (com a análise de crédito habilitada), a seção "Pretendentes & renda" lista cada pessoa que a análise de crédito consulta — locatário, cônjuge, fiador e cônjuge do fiador — mostrando CPF, nascimento, renda e cidade, e marcando o que ainda falta para consultar (CPF válido, data de nascimento). "Editar" preenche nascimento, nome da mãe, RG, endereço, renda com origem e outra renda sem abrir o formulário da proposta, e funciona mesmo depois de a proposta ter sido enviada: esses dados não entram no documento assinado. O que já veio de um documento lido por IA aparece preenchido.
- **Consentimento LGPD na proposta.** Antes de consultar crédito, o corretor registra a base legal (proteção ao crédito ou execução de contrato) na própria proposta; o registro é auditável, pode ser revogado e segue para o negócio na conversão.
- **Formulário da proposta com "Dados para análise de crédito".** Bloco opcional por proponente pessoa física e no fiador: nascimento, nome da mãe, sexo, RG, endereço, renda e origem, outra renda e cônjuge. Reeditar a proposta preserva o que o OCR ou a edição de partes já tinham gravado.
- **Formulário público de locação** aceita origem da renda, outra renda e, no cônjuge, nome da mãe e renda; o resumo consolidado mostra renda e origem de cada parte.

## [Unreleased] - 2026-09-04 - O cliente envia documentos pela página da proposta

### Adicionado

- **O interessado envia os próprios documentos pela página pública da proposta de locação.** Na mesma página em que lê a proposta (o link enviado pelo WhatsApp), quando a análise de crédito está habilitada na imobiliária, aparece o bloco "Envie seus documentos": ele diz de quem é cada arquivo (locatário, cônjuge, fiador, cônjuge do fiador ou outro), envia PDF ou foto, vê o que já mandou e pode remover o que subiu por engano. O corretor recebe um aviso "Cliente enviou documentos" (um por hora, não um por arquivo) e encontra tudo em "Documentos por parte" com a marca "enviado pelo cliente" — já com a parte escolhida, pronto para extrair com IA e seguir para o negócio. A página só aceita envio enquanto a proposta está viva para o cliente (não expirou, não foi cancelada nem convertida); documentos da imobiliária, o dossiê e o PDF assinado nunca aparecem nem podem ser removidos por ali.

## [Unreleased] - 2026-09-04 - Refazer a padronização de um rascunho e descartar um lote

### Adicionado

- **"Refazer padronização" na revisão do modelo.** Quando o rascunho saiu ruim e os consertos cirúrgicos não bastam, a única saída era reingerir o lote inteiro. Agora o botão refaz SÓ aquele modelo a partir do arquivo original do acervo: reaproveita o plano do lote (blocos de slot, fornecedores a neutralizar, gabarito quando o arquivo era uma instância preenchida), cria um Google Doc novo e roda o pipeline inteiro de novo — na mesma linha do modelo, com o mesmo link. O Doc anterior vai para a lixeira do Drive só depois do sucesso; se o Drive falhar, o modelo continua apontando para o Doc antigo. O relatório da revisão é substituído (descrevia um Doc que não existe mais) e guarda `redo` com o Doc anterior e a contagem. Modelo ativo, modelo enviado avulso (sem arquivo no acervo) e arquivo diferente do que originou o modelo são recusados, cada um com o seu motivo. Linha de auditoria `TEMPLATE_REDO`.
- **"Descartar lote" na Central de ingestão.** Lote que travou ou que a conferência mostrou não valer a pena ficava para sempre como "lote aberto" no banner de modelos — o estado `cancelled` existia na máquina de estados e ninguém o escrevia. O botão encerra o lote: arquivos ainda não aplicados saem da fila (`discarded`), os modelos já criados ficam como rascunho, e o arquivo e o texto de cada item ficam guardados (é deles que o "refazer" acima se serve). A disponibilidade vai no `WHERE`, como no claim do executor: lote com processamento em voo recebe 409 e o operador tenta em instantes, em vez de o cancelamento ser sobrescrito pelo próximo estágio. Linha de auditoria `INGESTION_RUN_CANCELLED`.

## [Unreleased] - 2026-09-04 - Documentos por parte na proposta de locação

### Adicionado

- **Documentos por parte na proposta de locação, com leitura por IA.** Na tela da proposta (com a feature "Análise de crédito — locação" ligada), o corretor anexa RG/CNH, comprovantes de renda e de endereço dizendo de quem é cada documento (locatário, cônjuge, fiador, cônjuge do fiador, locador, imóvel), agrupados por papel como na aba de documentos do negócio. "Extrair com IA" lê o documento sob demanda (um clique só paga um OCR — dois cliques no mesmo card não pagam dois); "Mover para…" corrige a atribuição; mover para o fiador avisa que a garantia vira fiança ao converter. Documentos enviados pelo cliente ficam marcados. Subir de novo o mesmo arquivo escolhendo outra parte move o documento existente (antes respondia "ok" e mantinha a parte antiga). O "Anexar Registro do Aceite" continua no mesmo lugar com a feature ligada. Sem a feature, a lista simples de documentos continua igual.
- **A conversão em negócio aproveita o que foi lido.** CPF, nascimento, endereço e demais campos extraídos de documentos com atribuição feita por uma pessoa entram no formulário e no negócio sem redigitar, sem sobrescrever o que a proposta já trazia; a leitura e a atribuição seguem com o documento para a pasta do negócio, e o que veio do cliente continua identificado.

## [Unreleased] - 2026-09-04 - A revisão pela IA propõe; quem escreve é o operador

### Alterado

- **"Pedir revisão pela IA" deixa de escrever no modelo por conta própria.** O botão rodava o passe de inserção de chaves de novo e aplicava o resultado direto no Google Doc — e num dos dois usos em produção colapsou um parágrafo inteiro numa chave solta, sem ninguém ver antes. Agora ele PROPÕE: a IA lê o texto, o planejador aplica as mesmas travas de sempre, e a tela mostra cada proposta com o parágrafo como está e como ficaria, por chave, com uma caixa de seleção. Trecho simples e sem aviso vem marcado; bloco inteiro e proposta com aviso das checagens semânticas vêm desmarcados de propósito. "Aplicar N selecionadas" manda só o que foi marcado, e o servidor replaneja sobre o texto atual do Doc: trecho que virou ambíguo desde a proposta é pulado, nunca escrito errado; se o Doc mudou no meio, a aplicação é recusada inteira (`409 DOC_CHANGED`) e a lista some. O que fica no banco é a contagem e os motivos dos pulos — os trechos vivem na resposta e morrem com ela. A escrita ganha linha de auditoria (`TEMPLATE_AI_PROPOSALS_APPLIED`) com chaves e motivos, sem texto de contrato. Modelo ativo pode pedir propostas (é leitura) e não pode aplicar (é escrita). Chamada sem corpo passa a significar "propor": o disparo que escrevia direto deixou de existir.

## [Unreleased] - 2026-09-04 - A imobiliária conecta a própria conta Ficha Certa

### Adicionado

- **Conta Ficha Certa Digital por imobiliária em Configurações › Integrações.** O owner/admin informa login e senha da API (produção ou homologação) e os produtos contratados; a plataforma valida a credencial consultando os créditos, provisiona o webhook da conta apontando para o nosso endereço (com o par usuário/senha que a Ficha Certa usa para se autenticar antes de cada entrega) e guarda tudo cifrado. "Testar" confere créditos e se o webhook cadastrado lá é o nosso; "Reconectar" mantém o endereço do webhook. Sem conta conectada não há análise de crédito — não existe credencial de plataforma. Cliente HTTP, normalizador do laudo (restrição só por protestos/pendências/ações/cheques, CPF irregular ou suspeita de óbito; renda é parecer) e fixtures da documentação entram junto; o disparo pela proposta vem no próximo lote.

## [Unreleased] - 2026-09-04 - Costura para análise de crédito e certidões na proposta

### Adicionado

- **Base de dados para documentos, certidões e análise de crédito na proposta (pré-negócio).** Só a costura: conta da Ficha Certa Digital por imobiliária (credenciais e segredos do webhook cifrados, no molde da conta ClickSign), agregado neutro de provedor para uma análise de crédito com N pretendentes, vínculo do job de certidão/laudo com a proposta, OCR nos anexos da proposta e consentimento LGPD na proposta. Catálogo ganha os laudos Ficha Certa PF/PJ, o alvo "cônjuge do locatário" e a feature `locacao.credito` (nasce desligada). Nenhuma tela ou rota lê isso ainda — os próximos lotes ligam.

## [Unreleased] - 2026-09-04 - A label de promoção passa a atestar o head

### Corrigido

- **A label `staging-smoke-passed` atestava um head móvel.** O PR `staging → master` tem como head a branch `staging`: se outro merge entrar nela com a promoção aberta, o head avança, a label continua lá e o gate passa — código sem smoke chega a produção sob a label do smoke anterior (issue #591; aconteceu hoje com o #593 entrando na staging entre duas promoções). O gate passa a trabalhar por SHA, sem relógio: quando a label é aplicada, o run carimba o head daquele momento com um commit status; nos runs seguintes o head atual precisa ter o carimbo, senão o gate fica vermelho com a instrução de refazer o smoke e reaplicar a label. Só na promoção normal; o hotfix segue como estava. (A primeira versão comparava datas — a do committer não é a do push, e o feed de eventos do repositório atrasa horas.) Prova viva em 04/09/2026, num PR de promoção descartável: o gate recusou o head que avançou depois da label e continuou recusando ao fechar e reabrir o PR; reaplicar a label carimbou o head novo e liberou.

## [Unreleased] - 2026-09-04 - O banner que afirmava uma sessão já vencida

### Corrigido

- **O banner "Você está operando X como o dono" continuava na tela com a sessão vencida.** A sessão de teste em tenant tem 8 horas; a página é renderizada uma vez e pode ficar aberta além disso — e aí as rotas do tenant já respondem 404 enquanto o banner afirma o contrário. Medido em produção (issue #587): o diagnóstico só fechou indo ao banco. O banner passa a mostrar a hora do vencimento e, passada a hora, troca por "a sessão de teste venceu — as ações serão recusadas; reabra em Tenants". A autoridade continua sendo o servidor; a tela só informa (o relógio do browser pode divergir alguns segundos).

## [Unreleased] - 2026-09-04 - O corretor parceiro acompanha a proposta

### Adicionado

- **Corretores parceiros na proposta (vendas e locação).** Na criação/edição, o corretor informa parceiros — da casa ou de outra imobiliária — com nome, CRECI, telefone e e-mail opcional, escolhendo do cadastro de corretores ou cadastrando na hora. Eles recebem e-mail em três marcos: proposta **encaminhada** (1ª via enviada), **assinada pelo proponente** e **completa**. Quem decide se o e-mail sai é o cadastro em `/corretores` (avisos por e-mail ligados, sem opt-out, com endereço) — nunca o dado da proposta. O detalhe da proposta lista os parceiros e diz se cada um "avisa por e-mail".
- Os parceiros moram em chave própria do dado da proposta (`corretores_parceiros`), separada da distribuição da comissão. Foi decisão de revisão: a lista de comissão vai para o contrato (cláusula de intermediadora) e para o wizard de repasse; um parceiro que só acompanha não pode virar intermediadora sem CPF nem linha de 0% que trava a cobrança. Na conversão em negócio a chave segue para o Deal, e os parceiros passam a receber também os avisos do negócio.

### Corrigido

- **Angariador de locação nunca recebia aviso do negócio.** O resolvedor de corretores só lia a lista de venda (`comissionados`); a de locação (`angariadores`), preenchida pelo auto-cadastro no envio do formulário, ficava invisível. Agora as duas contam.

## [Unreleased] - 2026-09-04 - O bloco que nenhum parágrafo identifica

### Corrigido

- **O bloco de assinaturas ficava fixo no modelo — em 16 de 16 modelos da RE/MAX Trio, dois deles com os nomes das partes do contrato-fonte.** A IA propôs a chave `assinaturas` nas 16; o passe recusou nas 16. A linha de sublinhados aparece uma vez por signatário e "PARTE LOCATÁRIA" aparece dezenas de vezes num contrato de locação, e a troca por texto exigia que cada parágrafo do bloco fosse único. Nenhum é; a **sequência** é. Bloco composto cujos parágrafos se repetem mas cuja sequência consecutiva é única passa a entrar pelo caminho estrutural (apagar o intervalo, inserir a chave), com a estrutura relida antes de escrever e a releitura decidindo se entrou. O mesmo vale para a operação "trocar o bloco pela chave" da tela de revisão — que também recusava esse bloco. Sem a chave, todo contrato gerado sairia com a página de assinaturas de outro negócio; o gate de PII não vê nome de pessoa e o validador não exige a chave.
- **A cláusula de garantia por caução saía inteira como "não encontrei no texto".** O DOCX traz espaço não-quebrável depois de "8.1." e o modelo devolve a cópia com espaço comum. Em 3 de 16 modelos a cláusula ficou com o valor fixo. O casamento agora tolera a diferença, e o que vai para o Google é a forma real do documento — nunca a do modelo.
- **Valor e extenso na mesma proposta apagavam o extenso em silêncio.** "R$ 3.000,00 (três mil reais)" proposto como valor, com "três mil reais" proposto como extenso: o maior engolia o menor e `{{aluguel_valor}}` imprime só o número. O par é inequívoco (`<chave>_extenso` dentro de `(...)`), então o valor é aparado e os dois entram. Chave simples cujo trecho contém as propostas de **duas ou mais** outras chaves é frase, não valor — "30 (trinta) meses, a contar de … e com término em …" — e é recusada para que as datas entrem.
- **O que vai ao Google é a forma REAL do documento, não a do export.** O `text/plain` do Drive troca espaço não-quebrável por espaço; o Doc não. Um trecho lido com espaço casava zero num parágrafo com NBSP e a cláusula de garantia por caução saía "a edição não pegou" — medido no smoke da staging, invisível à bateria em texto (o corpus vinha do DOCX, que preserva o NBSP). Antes de escrever, o passe e a edição no app leem a estrutura e mandam a forma que está lá; a conferência depois tolera a diferença.
- **A cláusula variável que "continua fixa no modelo" ganha o botão "Tentar de novo".** O slot de cláusula (`{{slot_garantia}}`) só era aplicado na ingestão, e quando não pegava a única saída era editar o Google Doc à mão. Em produção, 3 modelos de caução da Trio ficaram assim pela mesma causa do NBSP: o export mostra espaço onde o Doc tem espaço não-quebrável. Agora o slot manda ao Docs a forma exata do documento, e o aviso da tela reaplica a cláusula a partir do plano do lote que criou o modelo — sem reingestão. Modelo enviado fora de lote não tem plano e continua com a instrução manual.
- **Bloco de assinaturas em colunas: o localizador da estrutura também o encontra.** (A linha abaixo, do #585, é a REGRA que propõe o conserto; esta é o LOCALIZADOR que o aplica.) O export do Drive mostra as colunas com espaços; o Doc guarda a tabulação, e a comparação de parágrafo inteiro exigia largura idêntica. Agora ela ignora sequências de espaço em branco — só ela: o casamento por índice continua exato, e o teste afirma isso. Parágrafo só de espaços dentro do bloco passa a contar como vazio e entra no intervalo apagado. Era o último dos 16 modelos da Trio.
- **"Tentar de novo" lia o plano errado.** A primeira versão tratava a revisão do lote (`planReviewed`) como se fosse o plano; a revisão é só a lista de aprovações por item, e os parágrafos da cláusula vivem no plano do planner. Em produção respondia "não encontrei o lote" para os três modelos que motivaram o botão. Agora lê o plano do planner; a linha de execução já prova a aprovação.
- **Bloco de assinaturas em colunas (duas assinaturas por linha, separadas por tabulação) é reconhecido pela regra semântica.** Um modelo da Trio sem tabela ficou de fora do "Corrigir tudo" porque a regra só via linha feita só de sublinhados.
- **Tabela de assinaturas com quebra de linha suave ou com chave dentro também vira a chave.** Ao aplicar "Corrigir tudo" nos 16 modelos da Trio, 3 ficaram de fora: numa célula o nome e o rótulo estavam separados por Shift+Enter (um parágrafo no Doc, duas linhas no export), e em dois modelos de fiador a célula do locador já tinha `{{locadores_qualificacao}}` no lugar do nome — a regra parava nessa linha e propunha um bloco parcial, que a estrutura recusa. Agora a célula é lida linha a linha, como o export, e uma linha que é só uma chave conta como material do bloco. Conferido, sem escrever, nos três Docs reais.
- **Bloco de assinaturas que é uma TABELA vira a chave.** Nos modelos da Trio as linhas de assinatura são células de uma tabela 3×2; o export achata em parágrafos e o localizador estrutural só via parágrafos. Bloco cujos textos são exatamente as células de uma tabela, na ordem de leitura, apaga a tabela como unidade e insere a chave no lugar — provado ao vivo no Doc de smoke.
- **Bloco composto cujos parágrafos não são consecutivos no documento é recusado inteiro.** O caminho de texto esvaziava cada parágrafo do trecho onde quer que ele fosse único, sem olhar se era vizinho do anterior — um "Nome" solto numa ficha no fim do modelo sumiria junto com o bloco de assinaturas. A sequência tem de existir uma vez; só então se decide entre o caminho de texto (todos únicos) e o estrutural.
- **Dado cadastral degenerado da própria imobiliária não acusa mais nada.** CRECI `00000-J` casava dentro de `R$ 00.000,00` e a revisão apontava três "dados da imobiliária fixos no modelo" que eram do próprio bench. Identificar exige pelo menos três dígitos distintos; o CNPJ real continua sendo acusado.

### Adicionado

- **Regra "bloco de assinaturas fixo no modelo"** na checagem semântica, com o conserto "trocar o bloco pela chave" — `error` quando há nome de pessoa no bloco, `warning` sem. Vale para qualquer tenant a partir de agora, na ingestão e na revisão da biblioteca.
- **Bateria sem gabarito** (`--corpus-dir`): mede "sem defeito" e **cobertura** sobre o texto real de um tenant, e a cobertura conta as chaves que um bloco composto presente já renderiza (a qualificação da imobiliária dentro do rateio não está faltando — o passe a recusa de propósito). Medido nos 16 da Trio, em replay das mesmas respostas do modelo: cobertura 62,1% → 70,0%; `not-found` 3 → 0; `assinaturas` recusada 16 → 0; 15 de 16 sem obrigatória faltando (era 14).

## [Unreleased] - 2026-09-03 - O conserto que devolvia o CPF ao modelo

### Corrigido

- **A regra "cláusula virou uma chave só" acusava o trabalho bem feito e propunha desfazê-lo.** Medido no smoke da staging: o único modelo com conserto automático disponível apontava `{{locadores_qualificacao}}` como erro e oferecia o botão "Restaurar o parágrafo" — e o texto a restaurar era a qualificação de uma pessoa real do contrato original, com **nome, RG e CPF**. Trocar a qualificação pela chave é exatamente o que a padronização deve fazer; a regra chamava isso de defeito e oferecia, como remédio, recolocar o dado de um terceiro dentro do modelo. A causa era o comprimento usado como segundo gatilho: a qualificação completa de dois locadores passa de 400 caracteres sem ter nada de cláusula. Agora quem distingue os dois casos é a **linguagem** (R$, %, deverá, pagamento) — que é o que o incidente original tinha —, nunca o tamanho.
- **Segunda rede, independente da primeira:** nenhum conserto automático pode devolver ao modelo um texto que o gate de ativação bloquearia. Colapso real cujo parágrafo-fonte contém CPF, RG ou conta passa a pedir ajuste manual, com a explicação do porquê. Uma heurística pode errar de novo, por um caminho que ninguém previu; o conserto que ela propõe não pode desfazer o gate de PII.

### Notas

- O defeito já estava em produção (veio com a checagem semântica e a edição no app). A tela de revisão da biblioteca não o criou — ela o tornou visível, e é assim que ele foi encontrado.
## [Unreleased] - 2026-09-03 - A biblioteca inteira numa tela

### Adicionado

- **"Revisar biblioteca": modelos E cláusulas conferidos de uma vez.** A revisão era modelo a modelo, e a pergunta que importa não é sobre um modelo: é se a biblioteca está pronta. Foi assim que os 16 modelos da RE/MAX Trio chegaram a "prontos" com 10 erros semânticos, e assim que, depois de corrigidos à mão, **16 de 16** seguiram com a lista de rateio chaveada item a item sem ninguém notar — cada tela dizia a verdade sobre si, e ninguém tinha a visão de conjunto. O botão fica no cabeçalho de **Templates** e no de **Banco de cláusulas**, visível antes de escolher qualquer aba: enterrá-lo dentro de uma delas foi exatamente como o botão "Revisar" de cada modelo passou despercebido.
- **A base de cláusulas ganha a prova que só existia dentro da geração.** Cláusula que não compila, que sobra com `{{chave}}` depois do preenchimento ou que está partida em pedaços no acervo é **descartada em silêncio** na hora de gerar: entra o texto canônico, o contrato sai bonito e sem a redação que a imobiliária escreveu, e o único registro é uma linha de log no servidor. A revisão roda a MESMA função que a geração usa para descartar, contra os dados de exemplo, e mostra o resultado antes de existir um contrato. Cláusula não classificada é provada nas **duas** esteiras, porque é nas duas que ela é lida.
- **Correção assistida por modelo**, com a lista do que será feito antes de aplicar. Os consertos vão um por vez, e cada um é recalculado no servidor no momento de aplicar — um conserto muda o documento sob os seguintes.

### Interno

- O painel **delega** à validação individual em vez de reimplementar as contagens. Duas fontes de verdade sobre "dá para ativar?" deixariam o operador entre duas telas que discordam sem ter como decidir qual está certa.

## [Unreleased] - 2026-09-03 - A migração que não tinha ferramenta

### Adicionado

- **`replace-block`: um bloco de parágrafos que já contém chaves vira uma chave composta.** Diagnóstico medido nos 16 modelos da RE/MAX Trio: **16 de 16** têm a lista de rateio do 1º aluguel chaveada item a item — e cada chave de corretagem imprime a lista INTEIRA de beneficiários, então um item sai com nome sem conta e o outro com conta sem nome. A chave certa (`rateio_primeiro_aluguel`) existe desde a entrega anterior, e **nada conseguia aplicá-la**: tanto o mapeamento manual quanto o passe de IA recusam trecho que já tem chave — travas corretas, para não apagar campo por acidente —, e a migração ficava sem caminho. As proteções vêm do que pode dar errado: bloco não consecutivo é recusado antes de escrever (apagar do primeiro ao último engoliria o contrato que está no meio), a estrutura do documento é relida antes de apagar, e na conferência **todos** os parágrafos têm de ter sumido — um sobrevivente vira falha, porque significa que o intervalo apagado não era o esperado.

### Notas

- A aplicação nos 16 modelos ainda não foi feita: escrita em documento de produção passa pela rota do app, então acontece depois da promoção.

## [Unreleased] - 2026-09-03 - Revisar um rascunho sem saber a URL

### Corrigido

- **A lista de modelos passa a linkar a tela de revisão.** Ela só era alcançável de dentro do fluxo de ingestão — o diálogo de upload e a tela do lote —, e os dois são transitórios: fechado o lote, um rascunho só era revisável por quem soubesse o endereço. O card oferecia "Preview" e "Editar", e "Editar" leva ao editor de Handlebars, não à revisão. Como é na revisão que moram a validação, os problemas apontados, a prévia preenchida e o botão de ativar, o autoatendimento inteiro ficava atrás de uma porta sem maçaneta — medido: o dono tentou revisar os 16 rascunhos da RE/MAX Trio em produção e não chegou à tela, e os 16 seguem sem nenhuma revalidação no banco.

## [Unreleased] - 2026-09-03 - A prévia mostra o contrato pronto, não as chaves

### Adicionado

- **Prévia com dados de exemplo para modelos Google Docs.** Até aqui, "prévia" de um modelo desse tipo era o próprio Doc-modelo: o operador via o relatório de validação e um documento cheio de `{{chaves}}`, e nunca via **como o contrato sai**. Foi decidindo assim que os 16 modelos da RE/MAX Trio foram aprovados com 10 erros semânticos — nenhum deles passaria por quem tivesse visto a cláusula preenchida. A tela de revisão ganha as abas Documento / Prévia: a prévia copia o Doc, preenche com um negócio fictício, exporta e **descarta a cópia** (um documento com cara de contrato sobrando no Drive da imobiliária é pior que uma prévia que falhou). Cache por revisão do Doc, e invalidada a cada edição — prévia velha parece confirmação de um estado que não existe mais.
- Link **"Abrir no Google Docs"** na revisão do modelo.

### Interno

- A montagem do mapa de substituição da locação — incluindo as três chaves de repasse (corretagem, via da imobiliária e rateio do 1º aluguel) que dependem de dados que o formulário não guarda — saiu de dentro da geração de contrato para um módulo compartilhado. Geração e prévia passam a usar **a mesma** montagem: uma prévia que diverge da geração é pior que prévia nenhuma, porque o operador aprova o modelo confiando nela.

## [Unreleased] - 2026-09-03 - Corrigir o modelo de dentro do app

### Adicionado

- **Botão de correção em cada problema apontado na revisão do modelo.** As checagens semânticas já diziam o que estava errado; agora consertam: trocar a chave da parte errada, remover o dado do titular que ficou ao lado da chave e restaurar a cláusula que uma chave engoliu. Antes, a única edição possível pelo app era "trecho literal → chave" — os outros três consertos exigiam abrir o Google Docs e editar à mão, que é como os 16 modelos da RE/MAX Trio foram corrigidos.
- A tela manda só o identificador do problema; o servidor recalcula as checagens e usa a frase que ele mesmo produziu contra o estado atual do documento. Trecho de contrato não trafega para o navegador, e por esse caminho o cliente não pode pedir a edição de uma frase arbitrária.

### Corrigido

- **O mapeamento manual de chave declarava sucesso sem conferir.** A rota enviava a substituição ao Google e respondia "ok" sem ler a resposta da API nem reler o documento — o mesmo defeito que o passe de IA teve até 02/09, quando 11 de 12 modelos declaravam chave "inserida" que não estava no Doc. Agora confere a resposta, relê o documento, gera linha de auditoria e revalida.
- Modelo **ativo** passa a recusar edição (409): contrato já gerado não pode ter o texto do modelo mudando debaixo. Voltar a rascunho é decisão consciente, não efeito colateral de um conserto.

## [Unreleased] - 2026-09-03 - Chave do rateio do primeiro aluguel

### Adicionado

- **`{{rateio_primeiro_aluguel}}`** — a cláusula que divide o primeiro aluguel entre a imobiliária e os corretores que captaram passa a ter chave própria, cobrindo a LISTA inteira (um item por beneficiário, com valor em R$ e por extenso, qualificação e via de pagamento) e nunca o cabeçalho que a introduz. Antes não havia chave: cada item ficava com uma chave de corretagem, que imprime a lista inteira de beneficiários — com dois corretores, o mesmo bloco saía repetido em todos os itens, e era isso que impedia a ativação dos modelos.
- **`comissao.angariadores[].valor_primeiro_aluguel`** (aditivo): quanto de cada corretor sai do primeiro aluguel. Ausente = usa a comissão do mês 1. A parte da imobiliária é a taxa de locação menos a soma dessas partes — os corretores recebem de dentro da taxa —, nunca negativa. O valor aparece no resumo do negócio ao lado da mensalidade do angariador.

## [Unreleased] - 2026-09-03 - Bateria de avaliação do passe de chaves

### Interno

- **O passe de inserção de chaves foi separado em propor / planejar / aplicar**, sem mudança de comportamento no caminho de produção: as três funções compõem a mesma operação e devolvem o mesmo relatório. O planejador — onde mora a segurança do replace global — ficou puro e passa a ser testável sem modelo e sem Google Docs, o que antes exigia mocar as duas pontas ao mesmo tempo. `commitInsertion` passou a recusar plano montado contra outro documento.
- **Nova bateria de avaliação** (`scripts/ai-bench/placeholders/`) mede precisão e recall do passe por índice de parágrafo contra gabaritos anotados à mão, com `--replay` para remedir a custo zero quando só o planejador muda. Referência contra Sonnet, em 2 contratos: precisão 90,9%, recall 81,1%, 0 colocações proibidas. Existe porque a ausência desse número deixou 10 dos 16 modelos da Trio passarem na validação sintática e chegarem errados na revisão.

## [Unreleased] - 2026-09-03 - Certidões: token da Infosimples inválido não vira "negativa"

### Corrigido

- **Código 601 "Não foi possível se autenticar com o token informado" passa a ser tratado como problema de conta** (falha terminal, sem retry, sem custo, mensagem apontando `INFOSIMPLES_TOKEN`). Antes o 601 caía no mapa fixo como "nenhum registro": o normalizer gravava situação **negativa** e o classificador agendava retries como "portal fora do ar" — um falso "nada consta" para uma consulta que nunca rodou (visto na staging em 03/09, 4/4 jobs). O 601 "não encontrado" do e-proc continua fechando como negativa legítima: a distinção é pela mensagem.

## [Unreleased] - 2026-09-03 - Trocar o tipo de garantia limpa a modalidade anterior

### Corrigido

- **Na etapa Garantia do formulário de locação, trocar o tipo (ex.: de Caução para Fiador) limpa os campos da modalidade anterior** — meses de caução, cobertura, título, prestadora. Só a prestadora era limpa: o negócio ficava com "Fiador" e "Caução: 3 aluguéis" ao mesmo tempo no resumo e no contrato (achado no smoke de 03/09). Os dados do fiador nunca são apagados. A limpeza grava valores reais (0 / vazio) em vez de `undefined`, que o auto-save descartava e o merge do servidor ignorava — sem isso o dado antigo ficava persistido e reaparecia no resumo e no PDF.

## [Unreleased] - 2026-09-03 - Aba Certidões no negócio de locação

### Adicionado

- **O negócio de locação ganha a aba "Certidões"**, a mesma da venda, com as partes da locação: seções Locatários e Fiador (fiador e cônjuge do fiador) vêm pré-marcadas; Locadores, Imóvel, Pessoas adicionais e Pesquisa de bens são opt-in. Cada pessoa mostra suas certidões por região (imóvel e endereço), com o mesmo seletor de extras, "Corrigir dados" e relatório. Sem menção a Serasa. A aba só aparece quando a sub-função **"Certidões — locação"** está ligada para a imobiliária (painel super-admin; nasce desligada).

### Corrigido

- "Corrigir dados" de uma certidão lia e gravava a parte errada quando o alvo não era vendedor (tudo caía em "compradores"); agora segue o alvo (locatário, locador, fiador, cônjuge do fiador).
- Os grupos da aba de certidões e os rótulos das pessoas passam a vir de uma lista única de alvos, sem enum cru na tela para alvos novos.

## [Unreleased] - 2026-09-03 - Sexo e nome da mãe nas pessoas físicas da locação

### Adicionado

- **Locador, locatário e fiador pessoa física ganham os campos Sexo e Nome da mãe** no formulário de locação, ao lado da data de nascimento. As certidões cíveis do TJSP (com execução fiscal) e os antecedentes exigem esses dados; sem eles a certidão mais útil para a análise de crédito nunca era emitida em São Paulo. Os campos são opcionais, podem ser configurados como obrigatórios em Configurações → Formulário, aparecem no resumo consolidado e o OCR de RG/CNH já os preenche.

## [Unreleased] - 2026-09-03 - Motor de certidões preparado para a locação (sem tela ainda)

### Adicionado

- **O planejador de certidões entende o negócio de locação**: locatários, fiador (quando a garantia é fiança), cônjuge do fiador e locadores viram alvos, e o imóvel único da locação entra como o imóvel do plano. Locatário, fiador e cônjuge ficam na camada padrão e herdam a região do imóvel; locador fica como opcional; a pesquisa de bens passa a valer para fiador e cônjuge. Nada aparece na tela ainda: a aba Certidões do negócio de locação chega no próximo passo, atrás da sub-função **"Certidões — locação"** (desligada por padrão no painel super-admin).
- As rotas de certidões de um negócio passam a exigir a sub-função do módulo certo (Vendas para venda, Locação para locação); a rota que monta o plano não tinha gate nenhum.

### Corrigido

- **"Corrigir dados" de uma certidão de locação apontava para o campo errado** (`fiadores.0`, `locatarioes.0`): os caminhos agora seguem o formulário (`garantia.fiador`, `locatarios.0`, `imovel`).
- **O PDF de certidão de locatário ou fiador caía na pasta "Outros"** dos documentos do negócio; agora vai para a pasta da pessoa.
- **Teto mensal de certidões mostrado de forma diferente em cada tela.** O executor bloqueava em R$ 200, a API do dashboard dizia R$ 50.000 e a documentação R$ 50; e cada tela contava o gasto do mês de um jeito (só negócios, ou só consultas avulsas). Agora há um único valor e uma única contagem (negócios da imobiliária + consultas de cliente/avulsas), e dois disparos simultâneos não passam mais os dois pelo teto.
- As certidões da ficha do cliente de locação (CNDT/PGFN) não olhavam o teto mensal antes de disparar; agora recusam com o mesmo aviso do negócio.
- As categorias "Cadastro" (CPF/CNPJ) e "FGTS" apareciam no catálogo mas nunca viravam filtro no seletor de certidões extras.

### Notas

- Documentação de certidões corrigida: 16 estados (não 12), cron a cada 5 minutos (não diário) e teto padrão de R$ 200.

## [Unreleased] - 2026-09-02 - Locador, locatário, fiador e cônjuge do fiador assinam com a qualificação certa

### Alterado

- **No envio do contrato de locação para assinatura, cada parte vai à ClickSign com a qualificação própria**: Locador, Locatário, Fiador e Cônjuge do fiador. Antes locador e locatário assinavam como "Interessado" e fiador e cônjuge como "Anuente", indistinguíveis no certificado. As quatro opções entram no menu "Assina como" e valem como padrão ao montar a lista de signatários; o operador continua podendo trocar. Cônjuge de locador ou locatário segue como Anuente (não há qualificação própria na ClickSign).
- Envelopes já enviados não mudam; os que exibiam "Anuente"/"Interessado" continuam assim.

### Notas

- A lista de qualificações passa a ter uma fonte única no código; as três cópias que existiam em rotas e validadores foram substituídas por ela.

## [Unreleased] - 2026-09-02 - Fiador e cônjuge do fiador sempre no seletor de documentos da locação

### Adicionado

- **"Fiador" e "Cônjuge do fiador" aparecem sempre em "Atribuir a:" na etapa Documentos do formulário de locação.** Antes só apareciam depois de escolher a garantia por fiador na etapa 5, que vem depois — num formulário novo o grupo nunca existia. Cônjuge do fiador continua fora quando o fiador é pessoa jurídica.
- **Atribuir um documento ao fiador (ou ao cônjuge dele) já define a garantia como fiador**, com aviso na tela. Caução, seguro ou título que estivessem marcados são limpos, para o contrato não sair com duas garantias. Os dados do fiador continuam entrando pelo "Aplicar aos campos", como para as outras partes. Vale também ao mover um documento para o fiador na aba Documentos do negócio e ao aplicar um documento pelo servidor.
- **O link individual do fiador passa a atribuir e aplicar sozinho o documento de identidade que ele envia**, como já acontecia para locador e locatário.

### Alterado

- **Garantia por fiador exige o fiador nomeado para avançar da etapa Garantia e para concluir o formulário.** Era só um aviso; virou bloqueio porque agora a modalidade pode ser definida por um documento antes de alguém qualificar o fiador. CPF, endereço e cônjuge continuam como avisos.
- **O contrato não mostra mais fragmentos de fiador quando ele não tem nome**: preâmbulo, cláusula de fiança (cai no texto genérico do art. 37) e linha de assinatura. Vale para os modelos canônicos residencial e comercial (v2 e v3) e para os blocos compostos dos modelos do Google Docs.
- O link do fiador, o painel de links e a recomendação de e-mail do cônjuge do fiador aparecem também quando já há um fiador identificado, não só quando a garantia está marcada como fiador.

### Corrigido

- **Os campos do cônjuge aparecem para "casado", "casada" e "União estável"** (o que o OCR devolve), não só para "Casado(a)" e "União Estável" escritos exatamente assim. Antes o formulário cobrava nome e CPF do cônjuge no final sem mostrar o campo. Vale para locador, locatário e fiador.

### Notas

- Os modelos canônicos `.hbs` mudaram: depois do deploy, rodar `sync-templates --apply` em staging e em produção.

## [Unreleased] - 2026-09-02 - Serasa sai das telas de locação até a integração existir

### Removido

- **O card "Análise de crédito (Serasa)" no negócio de locação, o card equivalente na ficha do cliente e o selo "Serasa" na lista de clientes deixam de aparecer.** A consulta ao Serasa não está integrada: o botão prometia uma análise que não acontece e o custo por consulta era um valor provisório. As telas voltam a mostrar só o que funciona (certidões, seguradoras, documentos). O que já existia por baixo (rotas, consultas antigas gravadas) fica como está, sem ser exibido; quando a integração for concluída, os cards voltam.

## [Unreleased] - 2026-09-02 - Uma chave de dado não engole mais o trecho da chave vizinha

### Corrigido

- **A revisão por IA podia trocar um item inteiro da cláusula de rateio por uma única chave.** Ao mapear a qualificação da imobiliária, o modelo propôs o item a) completo — valor, "a ser pago diretamente à imobiliária intermediadora", razão social, sede e conta — e o sistema aplicou: o parágrafo virou só `{{imobiliaria_qualificacao}}`, a chave da conta ficou de fora e o gate de dado pessoal liberou, porque a conta tinha sumido junto. Medido em produção em 02/09 num rascunho da RE/MAX Trio (reparado à mão). Agora: (1) o pedido ao modelo diz que chaves de dado (qualificações e dados de pagamento) cobrem só o dado em si e nunca se sobrepõem; (2) as descrições dessas chaves no catálogo dizem o limite exato; (3) uma trava determinística recusa a proposta de chave de dado que contenha a proposta de outra chave, com o motivo "engoliria a chave vizinha" e o nome dela — o trecho menor entra normalmente e o operador vê o que foi recusado.

## [Unreleased] - 2026-09-02 - "Pedir revisão pela IA" para de perder a resposta em silêncio

### Corrigido

- **A revisão por IA de um modelo já cheio de chaves não inseria nada e não avisava.** Nesse cenário o modelo responde o JSON dentro de uma cerca de código e emenda uma "nota de revisão" citando as chaves já presentes. A leitura da resposta ia do primeiro ao último sinal de chave do texto inteiro, pegava a nota junto, falhava e seguia como se o modelo não tivesse proposto nada: "Confirmou 0 trecho" e todos os campos como "sem proposta". Medido em produção nos rascunhos da RE/MAX Trio em 02/09. Agora a resposta é lida pelo primeiro objeto JSON completo (com preferência pela cerca de código), o que faz os trechos propostos entrarem — inclusive a qualificação e a conta da imobiliária na cláusula de rateio.
- **Quando a resposta realmente não puder ser lida, a tela diz isso** ("a resposta da IA não pôde ser lida — rode a IA de novo"), em vez de listar os campos como não propostos. Resposta cortada por limite de tamanho continua com o aviso próprio, que é a causa mais específica.
- O pedido ao modelo passa a dizer explicitamente: só o JSON, sem cerca de código nem comentários antes ou depois.

## [Unreleased] - 2026-09-02 - A conta onde a imobiliária recebe a comissão é cadastro, não padrão por formulário

### Alterado

- **"Onde a imobiliária recebe a comissão" sai de Configurações → Formulário e vai para Configurações → Perfil da imobiliária**, ao lado de CNPJ e CRECI. É dado fixo da imobiliária, igual à razão social — não uma condição que muda por formulário. Passa a ser guardado no cadastro da organização (colunas novas, com os mesmos nomes e domínios do cadastro de corretores), e a chave `{{imobiliaria_dados_pagamento}}` dos modelos de locação lê de lá. Medido em produção antes de mover: nenhuma imobiliária tinha preenchido o campo no lugar antigo, então nada foi copiado e nada se perdeu.
- Quem tem permissão de editar as configurações da organização (dono ou administrador) preenche; salva sozinho, como os outros campos do Perfil.

### Notas

- Os rascunhos de modelo já criados com a conta escrita no texto não mudam sozinhos. Para atualizar um rascunho existente sem reenviar o arquivo, use "Pedir revisão pela IA" na tela de revisão do modelo: o passe de chaves roda de novo sobre o documento que já está lá, com o catálogo atual.
- Este ajuste chega a produção junto com a migração de banco que cria as colunas; a pré-visualização de PR não roda migrações, então lá o card aparece vazio e não salva — o resto da tela de Perfil segue normal.

## [Unreleased] - 2026-09-02 - Aprovar uma ação de risco passa a exigir permissão

### Corrigido

- **Qualquer pessoa da organização podia aprovar uma ação de alto risco e dispará-la na hora.** A tela de aprovação existe para ser o ponto humano no meio do caminho: alguém confere antes de o sistema criar uma cobrança, mandar um contrato para assinatura ou apagar um negócio em definitivo. Só que a aprovação não conferia **quem** estava aprovando — bastava estar dentro da organização e ter sessão aberta. Um perfil de leitura, que existe justamente para não mexer em nada, aprovava e a ação acontecia. São treze ações nessa condição, entre elas cobrança, envio para assinatura (que custa e tem efeito jurídico) e exclusão definitiva de negócio.
- **A permissão para isso já existia e não fazia nada.** "Aprovar ActionIntent do Newton (HITL)" aparecia na tela de permissões e podia ser concedida ou negada — e o sistema ignorava a decisão nos dois sentidos. Era pior que não ter permissão nenhuma: dava ao administrador a impressão de estar no controle de quem aprova ações de risco, sem estar. Agora a permissão vale de verdade.
- **Recusar também passou a exigir a mesma permissão.** Aprovar e recusar são as duas metades da mesma decisão, e só a primeira estava sendo olhada. Recusar estava tão aberto quanto aprovar — e é o lado mais silencioso dos dois: a lista de pendências mostra tudo para qualquer pessoa da organização, então bastava percorrer a fila e recusar pedidos legítimos, que morriam sem explicação para quem os fez. Quem pode dizer sim é quem pode dizer não.
- **A recusa acontece antes de qualquer outra resposta**, de propósito: quem não pode decidir não descobre, pelo tipo de erro, se aquela aprovação existe ou em que estado ela está.
- **A mensagem de recusa passa a vir em português.** Antes o aviso na tela mostraria o código interno cru.

Medido em produção antes de fechar: das aprovações já feitas, todas foram do proprietário da conta. Ninguém perde acesso que usava.

## [Unreleased] - 2026-09-02 - Converter proposta passa a pedir a permissão de criar, e converter lead para de errar o funil

### Corrigido

- **O interruptor "Criar negócio de venda" não fechava tudo o que dizia fechar.** Além das seis portas fechadas nesta mesma versão, existe uma sétima: converter uma proposta em negócio também cria um negócio. Ela pedia só a permissão de converter. Como as duas opções ficam na mesma tela, em Configurações → Gerentes, o administrador que desligasse "Criar negócio de venda" lia a tela como fechada enquanto o gerente seguia abrindo negócio pela conversão, sem nenhum aviso. Não era brecha de segurança — era um controle que mentia. Agora a conversão pede as duas coisas.
- **E pede a permissão certa para cada tipo.** Converter uma proposta de locação cria um negócio de locação, então passa a cobrar "Criar negócio e contrato de locação"; converter uma proposta de venda cobra "Criar negócio de venda". Cobrar a de venda para as duas seria o rótulo errado. Efeito medido em produção antes de mexer: nas duas organizações que configuraram gerentes, a conversão de venda não muda para ninguém, porque essa permissão já vem ligada no perfil de gerente. O que muda é a conversão de proposta de locação, que passa a exigir a permissão de locação — hoje ligada em uma das duas. A outra reabre com um único visto na mesma tela. Nenhuma proposta havia sido convertida até aqui.
- **Converter uma lead podia criar o negócio no funil errado.** A busca do funil não dizia se queria o de venda ou o de locação, e as cinco organizações que têm funil têm os dois. O negócio podia nascer no funil de locação logo depois de o sistema ter cobrado a permissão de criar negócio de venda. Agora a busca declara o tipo, e uma organização sem funil de venda recebe uma recusa clara em vez de um negócio no lugar errado. Nenhuma lead havia sido convertida, então não há nada a corrigir no que já existe.

## [Unreleased] - 2026-09-02 - A própria imobiliária ganha chaves na cláusula de corretagem

### Adicionado

- **Duas chaves novas nos modelos de locação: `{{imobiliaria_qualificacao}}` e `{{imobiliaria_dados_pagamento}}`.** A primeira imprime razão social, CNPJ, CRECI e sede da imobiliária como intermediadora da locação (vem do perfil da imobiliária, e vale mesmo quando ela não administra o imóvel); a segunda, a chave PIX ou banco/agência/conta onde ela recebe a comissão do primeiro aluguel. Na reingestão dos modelos da RE/MAX Trio, 12 dos 16 rascunhos ficaram barrados pelo gate de dado pessoal exclusivamente pela conta da própria imobiliária, escrita por extenso na cláusula de rateio do primeiro aluguel — o corretor já tinha chave, a imobiliária não. Com a entrada no catálogo, a leitura por IA passa a mapear esse trecho no envio de modelos.
- **Configurações → Perfil da imobiliária ganha "Onde a imobiliária recebe a comissão"** (PIX ou conta), com o mesmo auto-save dos dados cadastrais. Só entra no contrato o que estiver completo: uma chave PIX, ou banco + agência + conta + tipo. Em branco, a chave sai vazia e a geração segue. *(Nesta mesma data a seção nasceu no padrão por formulário e foi movida para o Perfil antes de qualquer imobiliária preenchê-la — ver a seção acima.)*

### Notas

- A conta da imobiliária vai só para o documento do contrato, nunca para os dados do negócio — o mesmo desenho do repasse do corretor. O modelo guarda a chave; a conta, o padrão da imobiliária.
- Modelos já criados não mudam sozinhos: o trecho literal continua no documento até o operador trocá-lo pela chave (ou reenviar o modelo).

## [Unreleased] - 2026-09-02 - Trocar o papel de um membro passa pelo mesmo teto das outras três portas

### Corrigido

- **A tela de membros deixava conceder um papel mais poderoso que o de quem concede.** Existem quatro maneiras de dar papel a alguém — convidar, aprovar convite, adicionar direto e trocar o papel de quem já é membro. As três primeiras já perguntavam se o papel que está sendo dado cabe dentro do papel de quem está dando; a quarta não perguntava nada. **Hoje ninguém consegue explorar isso**, porque só o dono e o administrador podem trocar papéis, e os dois já concedem tudo. O que fecha é o amanhã: a tela de papéis permite criar um papel personalizado com essa mesma capacidade, e no dia em que alguém criasse um, esse caminho daria acesso total numa única ação, sem fila e sem aprovação. Agora ele recusa, dizendo qual papel foi negado, e a recusa fica registrada na trilha de auditoria.
- **Trocar alguém de papel personalizado para um papel comum deixava o papel antigo pendurado no cadastro.** O registro ficava com os dois ao mesmo tempo. Não mudava o que a pessoa podia fazer — o papel comum é que valia —, mas contradizia qualquer leitura posterior do dado. Agora o vínculo antigo é desfeito junto.
- **Escolher "papel personalizado" sem escolher qual deixava a pessoa sem acesso nenhum, em silêncio.** A requisição era aceita, respondia sucesso, e o membro perdia tudo. A checagem que impedia isso existia, mas só valia quando quem agia era administrador; para o dono da conta, passava direto. Agora recusa sempre, dizendo o que falta.

## [Unreleased] - 2026-09-02 - Criar negócio de venda passa a pedir permissão

### Corrigido

- **Qualquer membro da organização podia abrir um negócio de venda, inclusive quem só deveria olhar.** As seis portas que criam negócio de venda — a criação do formulário público, o botão do funil, a importação do iList, o cadastro por proposta, a importação de contrato e a conversão de lead — não conferiam permissão nenhuma. Bastava estar dentro da organização. O lado de locação sempre exigiu permissão para o mesmo ato, e a diferença não era uma decisão: era uma checagem que nunca foi escrita. Agora as seis pedem "Criar negócio de venda". O preenchimento do formulário pelo proponente, que acontece por link público, não é afetado.
- **Ninguém que já criava perde o acesso.** Antes de fechar a porta, medimos quem realmente a usava: dos 85 negócios de venda existentes, 84 foram criados por administradores, proprietários da conta, gerentes ou pelo agente Max — e a permissão nova nasce ligada para todos eles. Quem passa a ser barrado é quem nunca criou nada e não deveria poder: o perfil de leitura e os perfis financeiros e de portal. O perfil de leitura continua enxergando o funil inteiro, como antes; o que ele perde é só a criação.
- **Para o gerente, a permissão fica na tela.** "Criar negócio de venda" entra em Configurações → Gerentes ligada, e o administrador pode desligá-la — mesma tela onde, nesta mesma versão, passou a existir "Criar negócio e contrato de locação".

## [Unreleased] - 2026-09-02 - Dois consertos medidos no smoke de staging da troca pelo gabarito

### Corrigido

- **O valor do aluguel não era trocado em documento gerado pelo sistema.** O texto que o sistema lê do Google Doc vem com espaço comum onde o documento tem o espaço "fixo" que a formatação de moeda usa; a edição ia com a forma lida e o Google não encontrava nada. Agora a edição vai com todas as formas plausíveis (a lida, a do gabarito e a normalizada) e a que existe no documento casa. Medido: no modelo criado a partir de um contrato de locação, `aluguel_valor` saía como "a edição não pegou" — passa a ser trocado.
- **"Criar modelo a partir de contrato" gravava o relatório da troca sem máscara.** O gabarito ali é o contrato real de um cliente; CPF e conta iam para o relatório e para a resposta da API. A ingestão por upload já mascarava; a rota passa a mascarar também.
## [Unreleased] - 2026-09-02 - O admin passa a poder liberar o gerente para abrir negócio de locação

### Corrigido

- **O gerente não conseguia criar formulário de locação, e não havia como liberá-lo.** Criar o formulário público de locação exige a permissão "criar negócio e contrato de locação", que o gerente não tem por padrão — até aí, o desenho. O problema é que essa permissão não aparecia em Configurações → Gerentes: o admin abria a tela procurando o que ligar e não encontrava nada, enquanto o gerente levava "sem autorização" a cada tentativa. Do lado de vendas o mesmo gerente sempre criou formulário sem pedir nada a ninguém, então a diferença lia como defeito. A permissão passa a estar na tela, desligada por padrão — quem liga é o admin, e vale para todos os gerentes da organização.
- **O rótulo da permissão dizia menos do que ela faz.** Chamava-se "Criar contrato de locação", mas é ela que abre o formulário público, o cadastro de negócio a partir de imóvel/proposta e a aprovação da ficha. Passa a se chamar "Criar negócio e contrato de locação" — quem procura o checkbox certo agora o encontra pelo nome. Ligá-la não amplia o que o gerente enxerga: as rotas que ela destrava continuam aplicando o escopo de "só os negócios dele" por cima.

## [Unreleased] - 2026-09-02 - Modelo enviado por upload troca os valores do documento pelas chaves, sem interpretar

### Adicionado

- **O gabarito é extraído do próprio arquivo.** Ao subir um modelo de locação, o sistema lê os valores do documento (partes, imóvel, aluguel, vigência, garantia — a mesma extração, pelo mesmo caminho via PDF, que a importação de contrato já usa) em paralelo com a leitura por IA, e troca cada valor encontrado no texto pela chave correspondente — em todas as cláusulas em que ele aparece, quando o valor é específico. É a troca "hardcoded" que faltava: o que estava preenchido no documento vira chave sem que a IA precise adivinhar o trecho; a IA só entra antes, nos blocos, e a conferência final diz o que ainda falta. Custa cerca de um centavo de dólar por modelo e entra no custo do lote. `gabarito=false` no envio desliga (minuta em branco não tem o que trocar).
- **No lote da Central de ingestão, só os documentos classificados como instância preenchida** (dados reais de um cliente) pedem o gabarito; minuta em branco segue como antes.

### Notas

- O custo do passe de chaves por IA já entrava no custo do lote — a extração do gabarito passa a entrar também.
- Venda ainda não tem gabarito nesta entrega; o encanamento é o mesmo e liga quando o extrator de venda entrar.

## [Unreleased] - 2026-09-02 - A revisão do modelo mostra o que foi trocado pelo gabarito, e a ingestão está pronta para receber o gabarito

### Adicionado

- **Tela de revisão do modelo ganha o card "Troca pelo gabarito".** Ao criar um modelo a partir de um contrato, o sistema já trocava cada valor conhecido do contrato pela chave, sem IA — e gravava o relatório dessa troca sem que ninguém o visse. Agora a revisão mostra quantos valores foram confirmados e quais ficaram para revisão, com o motivo ("aparece em mais de um lugar", "genérico demais para trocar em todo lugar", "curto demais") e a contagem. É onde quem revisa vê o que foi trocado em todas as ocorrências antes de ativar. No catálogo, a chave ausente que tinha gabarito mostra o valor (mascarado) e quantas vezes ele aparece no texto.
- **A ingestão por upload está pronta para o gabarito.** Quando o modelo vier com os valores do documento-fonte (o extrator, na próxima entrega), a troca determinística roda depois da leitura por IA e antes da conferência final: o que a IA cobriu já não está no texto, e cada valor que sobrou e vira chave é um dado pessoal a menos no modelo. O relatório da IA é reconciliado com o texto final — chave posta pela troca deixa de aparecer como "não mapeada" — e cada chave ainda ausente diz o que o gabarito sabe dela. Sem gabarito, nada muda. O gabarito não é guardado; o que vai para o relatório sai mascarado — "mascarado" cobre o que tem detector automático (documentos, dados bancários, CEP, telefone, e-mail); nome e endereço não têm. E o gabarito nunca leva valores padrão do sistema (multa, juros): só o que veio do documento — um "10% (dez por cento)" inventado casaria a cláusula errada.

## [Unreleased] - 2026-09-02 - O modelo criado a partir de um contrato troca o valor em todas as cláusulas

### Alterado

- **Valor que se repete deixa de ficar literal por "aparecer mais de uma vez".** Ao criar um modelo a partir de um contrato pronto, o sistema troca cada valor do contrato pela chave correspondente — mas só quando o valor aparecia uma única vez. O valor do aluguel está na cláusula do preço, na do reajuste e na da multa; a data de início, no preâmbulo e na vigência. Ficavam literais, sem aviso. Agora os campos de valor (aluguel e seu extenso, início e fim da vigência, IPTU, condomínio, matrícula, inscrição, endereço, local e data de assinatura, preço, sinal, comissão) são trocados em **todas** as ocorrências, desde que o valor seja específico o bastante — moeda, valor por extenso em reais, CPF/CNPJ válido, CEP, data, ou texto longo. Dia de vencimento, meses de vigência, multas e juros ficam de fora de propósito: "10 (dez)" do vencimento é também o "prazo de 10 (dez) dias" da desocupação, e o formato não diz de qual campo o número é — a repetição desses fica com a leitura por IA, que tem o contexto. "casa" e "São Paulo" continuam não sendo trocados em todo lugar, de propósito: destruiriam "casa de máquinas" e "Foro de São Paulo". Quando um campo desses tem valor repetido mas genérico, o relatório gravado na criação do modelo registra o motivo ("genérico demais para trocar em todo lugar") e a contagem — a tela de revisão ainda não mostra esse relatório; isso fica para quando o motor entrar na ingestão.
- **Só chaves do catálogo entram nessa troca.** As chaves cruas que o sistema deriva do formulário (área do imóvel, tipo de garantia, campos fiscais, nome solto de uma parte) não são mais candidatas — eram genéricas demais para trocar às cegas, e a validação do modelo as marcava como desconhecidas de qualquer forma. A qualificação completa de cada parte continua sendo trocada como bloco.

### Corrigido

- **Valor em reais com espaço "fixo" não casava em documento digitado à mão** (#503). O sistema formata moeda com um espaço não separável depois do `R$`; um documento digitado ou importado traz espaço comum, e a comparação era literal — o valor do aluguel ficava sem chave, em silêncio. A comparação passa a tratar os dois espaços como iguais e a edição vai com o texto exatamente como está no documento.

## [Unreleased] - 2026-09-02 - A mesma chave entra em todas as cláusulas em que o valor aparece

### Corrigido

- **O passe de IA aceitava só um trecho por chave e descartava o resto em silêncio.** O valor do aluguel aparece na cláusula do preço, na do reajuste e na da multa; a IA propunha os três, o passe inseria o primeiro e ignorava os outros sem registrar nada — o modelo saía com o valor literal em todas as cláusulas menos uma. Foi o que apareceu no modelo de fiador da RE/MAX Trio. Agora chave simples entra em quantos trechos a IA propuser, cada um sob a mesma regra de unicidade; só chave de bloco (qualificação, cláusula de garantia, assinaturas) continua entrando uma vez, porque bloco duplicado no contrato é regressão.
- **A unicidade era contada sobre o texto original.** Dois trechos sobrepostos passavam ambos até o Google; o segundo não casava nada e só era pego depois, pela conferência, com o motivo genérico "a edição não pegou". A contagem passa a ser feita sobre o texto já com as substituições anteriores da mesma passada — as propostas entram da maior para a menor, como o reverse-merge — e o trecho consumido por outra substituição é recusado antes de gastar a chamada, com o motivo certo ("se sobrepõe a outro já mapeado").

## [Unreleased] - 2026-09-02 - A IA da ingestão para de cortar o documento em silêncio

### Corrigido

- **Modelo longo perdia o fim sem aviso.** O texto enviado à IA era cortado em 24 mil caracteres — menos que um contrato de locação de 10 páginas. Garantia, foro e assinaturas ficavam fora da leitura, e as chaves dessa parte apareciam como "não mapeadas" sem explicação. O limite sobe para 120 mil caracteres e, quando ainda assim o documento passa dele, o relatório avisa e cada chave da parte cortada diz que ficou fora da leitura.
- **Resposta cortada virava "nenhuma chave".** Quando a resposta da IA estourava o limite de saída, o JSON vinha pela metade e o passe seguia como se a IA não tivesse proposto nada — um modelo saiu da ingestão com zero chaves por isso. O limite de saída dobra e, se ainda cortar, o relatório diz para rodar a IA de novo em vez de fingir que não havia o que mapear. Quando o documento também passou do limite de leitura, é isso que a chave informa — rodar de novo não traria o que ficou fora.
- **As rotas de ingestão por upload, por contrato e o "Pedir revisão pela IA" ganham mais tempo** (300 s em vez de 120 s): com o limite de leitura maior, o pior caso estourava o tempo depois de a IA responder e antes de o relatório ser gravado, e a ingestão inteira se perdia.

## [Unreleased] - 2026-09-02 - O relatório da IA diz por que cada chave falta, e para de guardar dado pessoal

### Alterado

- **Cada chave ausente do catálogo agora vem com o motivo.** "Falta a chave X" era a mesma linha para quatro problemas — a IA não propôs nada, propôs um trecho que se repete, propôs um que não existe no texto, ou o Google recusou a edição. O relatório passa a dizer qual foi, com o trecho proposto, e a tela de revisão mostra isso embaixo de cada chave ausente. Chave que a IA nem tentou fica em silêncio, que é a informação certa ali.

### Corrigido

- **O relatório da ingestão guardava CPF, agência e conta do contrato-fonte.** O gate de dado pessoal protege o documento, mas os trechos que a IA recusou eram gravados crus no relatório do modelo e renderizados na revisão. Agora todo trecho passa pela máscara antes de ser gravado — inclusive o trecho que a IA **substituiu** pela chave, que depois disso só existia no relatório (documentos, dados bancários, CEP, telefone, e-mail). A tela mascara de novo ao exibir, então relatórios gravados antes desta versão, que têm o trecho cru no banco, também deixam de mostrá-lo. Nome e endereço não têm detector automático — o documento segue sendo a fonte, não o relatório.

## [Unreleased] - 2026-09-02 - O relatório da IA na ingestão de modelos para de contar o que não entrou

### Corrigido

- **"Preencheu N campos" contava envios, não resultados.** O passe de IA que insere chaves em modelos enviados por upload montava a lista de inseridos **antes** de pedir a edição ao Google e descartava a resposta. Na reingestão da RE/MAX Trio, 11 de 12 modelos declaravam chave inserida que não estava no documento — e o operador ativava o modelo com base nessa contagem. Agora o passe lê quantas ocorrências a API realmente trocou, relê o documento e só declara inserido o que **está lá e cujo trecho original sumiu**. Cada falha ganha nome, no mesmo vocabulário que a conferência de cláusulas já usava: a edição não pegou (formatação invisível partindo o parágrafo), pegou em mais lugares que o esperado (cabeçalho/rodapé), a API disse que trocou mas o documento não mostra, não deu para conferir, ou o Google recusou o lote. "Não consegui conferir" nunca vira "deu certo".
  - A lista de chaves faltantes passa a ler o documento **depois** do passe; se a releitura falhar, lê o de antes — o relatório erra para o lado pessimista. Chave que a API pôs em lugar não revisado continua contando como faltante até alguém conferir; e quando um parágrafo do bloco é apagado em mais de um lugar (o caso destrutivo), o relatório diz **qual** parágrafo e manda conferir o histórico de versões do Doc.
  - O rótulo na tela vira "Confirmou N campo(s) no documento". **O número vai cair** em relação ao que aparecia antes; é a contagem antiga que estava errada.
## [Unreleased] - 2026-09-02 - O contrato gerado passa a dizer que campo saiu em branco

### Adicionado

- **Laudo determinístico de preenchimento na geração por Google Docs.** A geração já era 100% hardcoded (formulário → mapa token→valor → `replaceAllText` → limpeza de órfãos), mas um campo que o modelo pedia e o formulário não trouxe saía **em branco** sem aviso — o replace troca `{{aluguel_dia_vencimento}}` por vazio e a evidência some. Os dois passos já devolviam o que faltava saber (ocorrências por token e a lista de órfãos apagados); os três call sites jogavam os dois fora. Agora o laudo vai para `GenerationPlan.fill` (no jsonb que já existe, sem migration) e a revisão pós-geração o transforma em comentário no contrato: **obrigatório em branco** gera um aviso por campo, com o rótulo do catálogo («Identificação do imóvel»); **opcionais em branco** viram um aviso agregado; **chave que o sistema não produz** (apagada da minuta) vira outro. Tudo aviso, nunca bloqueio — o contrato é gerado sempre; promover a bloqueante é decisão posterior, depois de medir.
  - O laudo é gravado best-effort e separado do snapshot: não depende do export do Drive, e a geração não falha por causa dele. Laudo malformado no banco é descartado no parse em vez de derrubar o plano — o executor da revisão não tem try/catch nos checks determinísticos, e a exceção prenderia o run até um sweeper repetir o mesmo erro.
  - Os checks determinísticos ganham o mesmo teto de 50 comentários IA abertos que o estágio LLM já tinha.

### Notas

- Não corrige a ingestão: modelo com chaveamento parcial continua parcial. Isto torna o efeito **visível** em cada contrato gerado; a cobertura total de chaves na ingestão vem nos PRs seguintes.
- Contrato gerado antes desta versão não tem laudo e não recebe os avisos.

## [Unreleased] - 2026-09-01 - O `{{#if}}` deixa de reprovar a cláusula inteira

### Corrigido

- **O extrator de chaves lia `if`, `each` e `unless` como caminho de dado, e isso reprovava toda cláusula condicional.** `HANDLEBARS_HELPER_NAMES` lista só os helpers que o app registra (`moeda`, `extenso`, `cpf`…), e a paridade com o registro é travada por teste — corretamente. Mas os **block helpers embutidos** do Handlebars vêm da biblioteca, não do app, e não estavam em lista nenhuma: `extractHandlebarsPaths("{{#if x}}")` devolvia `["if", "x"]`, e o catálogo rejeita `if` nas duas esteiras.
  - **O efeito não era teórico.** `classify/apply` revalida **toda** chave do conteúdo final, não só as que o cliente disse ter mexido. Qualquer cláusula com `{{#if}}` ou `{{#each}}` caía em `chave_invalida` e a proposta de conteúdo era descartada — em silêncio, e depois de o humano já ter aprovado na tela de revisão. O par é o pior possível: a tela **propõe** a tokenização, o usuário aprova, e o servidor recusa sem dizer por quê.
  - **Medido em produção:** das 20 cláusulas cujo conteúdo tinha ao menos uma chave fora do catálogo, **10 eram falso-positivo puro deste bug**. Depois da correção restam 10 — as que têm chave de fato inválida.
  - Os embutidos entram em `NON_PATH_TOKENS`, e **não** em `HANDLEBARS_HELPER_NAMES` — aquela lista significa "o que o app registra", e enchê-la com `if` quebraria o teste de paridade que a protege.
- **O teste que devia ter pego isso passava.** Ele cobria exatamente `{{#if}}`/`{{#each}}`, mas com `toContain`/`not.toContain`: afirmava que os argumentos entram e que `this.numero` não entra, e nunca que `if` e `each` ficam de fora. Virou `toEqual` com lista fechada. Teste de extrator que só usa `toContain` não consegue detectar extração **a mais** — que é o modo de falha desta função.

## [Unreleased] - 2026-09-01 - A tela de cláusulas para de mentir sobre o que está selecionado e sobre o que falta triar

### Corrigido

- **A seleção em lote sobrevivia a qualquer filtro que escondesse a linha.** Irmã da correção da troca de esteira, que fechou só aquele caso. Marcar uma cláusula `approved` e mudar o filtro de Status para `draft` escondia a linha mas mantinha o id no `Set`: a barra seguia "1 selecionada(s)" com **nenhum checkbox marcado na tela**, e "Analisar e classificar" mandava esse id. O recorte por esteira não pegava — a cláusula é da mesma esteira, só está filtrada. Valia igual para origem, tag e busca. A contagem e o payload passam a ser a **interseção** do `Set` com o que está visível.
  - Interseção com as visíveis, **não** com as seções ordenadas: aquelas já filtram por grupo de propósito, e o contrato é que trocar o filtro de GRUPO preserva a seleção. Derivar em vez de limpar também evita ter de lembrar de zerar o `Set` a cada filtro novo. Dois testes fixam o contrato pelo outro lado: **limpar o filtro traz a seleção de volta** (o `Set` não foi apagado) e **mudar o grupo não muda a contagem** — uma correção que "consertasse demais" passaria nos testes antigos e violaria isso em silêncio.
  - **`ignored` deixa de ser silencioso.** O campo existia na resposta do classify e nenhuma superfície o lia. Vindo não-vazio, N cláusulas saíam da análise sem aviso — a mesma contagem mentindo, na direção oposta: sumiço a menos em vez de fantasma a mais.
- **A contagem da aba ignorava justamente a cláusula que mais precisa de atenção.** A contagem reimplementava a regra de visibilidade e esqueceu das cláusulas SEM esteira, que a lista inclui de propósito: o badge dizia "Locação (23)" enquanto a lista mostrava 24 linhas. A regra virou uma função só (`apareceNaEsteira`), usada agora nas **três** pontas — as duas da tela e o recorte de lote do classify, que era uma terceira cópia. O teste fixa a **igualdade** entre contagem e nº de linhas em vez de um número mágico: asserção sobre literal passaria mesmo com as pontas derivando de regras diferentes, que é exatamente o bug. Os três caminhos de servidor (as duas queries Prisma do agente e a SQL crua) já tratavam `esteira IS NULL` corretamente — a divergência era só da tela.
- **O classificador dizia "já classificada" para quem está no balde de triagem.** A proposta é vazia quando nenhum campo muda — e numa cláusula de esteira nula, o modelo que **se abstém** de decidir a esteira não muda campo nenhum. A resposta caía em "já estão classificadas", e a cláusula ficava presa em triagem para sempre: aparece nas duas abas, a seção manda usar "Analisar e classificar", e a única ação oferecida responde que não há nada a fazer. Agora a abstenção tem balde próprio e a tela aponta o caminho manual. Cláusula **com** esteira e sem proposta continua em "nada a mudar"; os dois casos são controles no teste.
- **E esse caminho manual era uma parede em org sem o módulo de locação.** O select de esteira do editor era `disabled` sempre que o módulo estava desligado — então a instrução "defina a esteira à mão" apontava para um campo travado, e a cláusula não classificada não tinha saída nenhuma pela interface. Agora ele destrava **apenas** enquanto a cláusula está não classificada, e nesse caso oferece só "compra e venda": sair da triagem para venda é o que a regra do módulo já assume, e mover para locação continua vedado. Hoje as cinco organizações de produção têm o módulo ligado — isto era uma armadilha armada para o primeiro tenant venda-only, não um incêndio.
- **Os filtros de grupo, status e origem ganharam nome acessível.** Eram comboboxes anônimos para leitor de tela: o `placeholder` desaparece assim que há valor selecionado.

### Notas

- Nenhuma mudança de status code e nenhum campo removido: os baldes novos da resposta são aditivos e saem de dentro dos existentes, então a soma continua fechando com o lote elegível.
- Quando um lote tem falhas **e** abstenções, as duas frases agora somam em vez de competir — em cascata, a falha ganhava e a informação da abstenção sumia.

## [Unreleased] - 2026-09-01 - O convite avisa na hora, e o papel do Max para de correr risco de clique

### Corrigido

- **`/settings/membros` renderizava um campo de Função VAZIO para quem tem papel customizado — e o primeiro clique degradava o membro.** O select lista só os cinco presets, então `value="custom"` não casava com item nenhum: o campo parecia quebrado, com o nome real do papel só numa legenda cinza embaixo. Como não havia opção correspondente, qualquer interação disparava a troca de papel e rebaixava o membro para um preset, sem aviso e sem desfazer pela tela. **Não era hipótese:** os quatro membros `custom` de produção são as contas do agente Max, uma por org — um clique acidental mudava o que o Max pode fazer. Agora papel customizado é um badge com o nome, não editável inline, seguindo o padrão que `owner` já usava. **Fica de fora de propósito:** oferecer as CustomRoles como opção do select exige que `PATCH /api/org/members/:id` aceite `customRoleId`, que ele não aceita — é mudança de API, e a issue segue aberta para ela.

### Alterado

- **`POST /api/org/invitations` passa a checar teto de papel na CRIAÇÃO, não só na aprovação.** Quem tinha apenas `org.members.invite` criava um convite de `admin` com 201 e toast de sucesso; a negativa só aparecia depois, no `approve`, para outra pessoa. Do ponto de vista das três envolvidas o convite simplesmente evaporava. **A segurança nunca dependeu disto** — o teto do `approve` decide, e é lá que a membership nasce; o que estava quebrado era o momento do feedback. Reusa `canGrantRole`, que o PR do teto lateral exportou justamente por ser o teto puro, sem gate embutido.
  - **A capacidade removida não é usada, e isso foi medido, não suposto:** os 14 convites de produção foram todos criados por `owner` ou `admin`, e não há nenhum pendente. Ninguém convidava acima do próprio teto contando com um aprovador mais graduado.
  - **A ordem é deliberada:** o teto vem antes das checagens de "já é membro" e "já tem convite pendente". É a decisão mais barata, e quem não pode conceder o papel também não deve descobrir por resposta de API se um e-mail já pertence à org. Os dois casos têm teste.
  - **A armadilha que isto quase introduziu:** `member` é o default do schema de convite e **não está no catálogo de presets**. Se o teto tratasse "papel que não sei resolver" como recusa, todo convite padrão passaria a dar 403 — inclusive os do owner. `resolveTargetPermissions` já devolvia `{}` nesse caso; agora há teste para que continue.
  - A recusa audita `DENIED` e não escreve nada. É o único dos quatro call-sites de teto que audita a negação — os outros três não, e a assimetria virou follow-up.

### Notas

- **Duas afirmações do bloco de 31/08 ficaram superadas** e são corrigidas aqui em vez de reescritas lá, porque aquele bloco já foi promovido a produção apesar do rótulo: (1) "`POST /api/org/invitations` só exige `org.members.invite` e não checa teto" deixou de valer com esta entrada; (2) "`POST /api/org/members` cria membership com papel arbitrário … fica como follow-up" foi fechado pelo teto lateral, já em produção.
- Sem migration e sem mudança de schema.

## [Unreleased] - 2026-08-31 - O perfil de administrador passa a aprovar e reprovar usuários

### Corrigido

- **Sob impersonação de tenant, "aprovado por" registrava o dono do tenant, não o operador da plataforma.** `context.ts` faz o ator efetivo virar o dono (`ctx.userId = imp.ownerUserId`) de propósito — sem isso o super_admin entra na org sem membership e todo `requirePermission` nega. Mas `approvedById: ctx.userId` herdava esse ator e gravava que o cliente admitiu o próprio membro. Passa a gravar `ctx.impersonatedByUserId ?? ctx.userId`. O `AuditLog` já carimbava `impersonatedBy` no metadata; esta coluna é que não tinha par recuperável. **Sem backfill**: as linhas já gravadas seguem com o dono, e a auditoria do período anterior sai do `AuditLog`.
- **A porta de emergência ficava soldada exatamente sob impersonação.** A allowlist `INVITE_APPROVER_EMAILS` é gate de PLATAFORMA, mas era comparada contra `ctx.userEmail`, que sob impersonação é o e-mail do DONO do tenant — nunca casava. `AuthContext` ganha `impersonatedByEmail` (aditivo, sem query nova: impersonação só existe no ramo `session`, onde `ident.email` já é o do admin real) e os três gates de convite passam a ler o ator real. No caso comum o ramo RBAC já cobria (o dono tem preset `owner`); o que isto recupera é o tenant cujo owner PERDEU a permissão — a situação para a qual a porta de emergência existe.

### Adicionado

- **Teto de papel na aprovação (`canApproveInvitationForRole`): pelo caminho de CONVITE, ninguém admite alguém mais poderoso que si mesmo.** Sem ele, o gate novo fecharia um laço de escalação que não existia: `POST /api/org/invitations` só exige `org.members.invite` e não checa teto, `INVITATION_ROLE_VALUES` inclui `admin`, e o approve passou a aceitar `org.members.approve` — então uma CustomRole com só essas duas chaves convidaria `admin`, aprovaria pelo e-mail que controla e sairia com acesso quase total, sem nunca ter tido `org.members.change_role`. Antes o segundo passo exigia a allowlist de env e o laço não fechava. A regra é subconjunto: as permissões do papel alvo têm de caber nas de quem decide (`admin` aprovando `admin` passa por igualdade). Quem está na allowlist de env é operador de plataforma e não tem teto; `targetRole: "custom"` é negado em vez de passar vacuamente, e o alvo é resolvido COM os overrides de `OrgManagerSettings` — subestimá-lo afrouxaria o teste de subconjunto.
  - **Alcance honesto, medido:** fecha o caminho de convite, não a org inteira. `POST /api/org/members` cria membership com papel arbitrário protegido só por `org.members.invite` mais `requireElevation` — que hoje é **no-op deliberado** (o corpo real está em `requireElevationEnforced` e ninguém o chama). Quem tem essa chave chega a `admin` por lá, numa chamada, sem passar por aqui. É **pré-existente e fora deste PR**, e não é explorável hoje: a org tem 4 CustomRoles, todas "Max (agente)", nenhuma com `org.members.invite`. Fica como follow-up.
- **Permissão `org.members.approve`.** Os presets `owner` e `admin` a carregam por padrão (vêm de `fullAccess`); `finance`, `sales`, `viewer` e os presets de locação, que são allowlists explícitas, não. Entra em `PERMISSION_CATEGORIES` sob "Organização e membros" — o catálogo canônico — e uma CustomRole também pode recebê-la. **Sem superfície de UI hoje:** o único consumidor de `PERMISSION_CATEGORIES` é `ManagerSettingsClient`, que filtra por `MANAGER_CONFIGURABLE_PERMISSIONS`; conceder a chave é via API. O `RoleEditorDialog` citado no comentário de `permissions.ts` não existe.

### Alterado

- **Aprovar e reprovar acesso deixou de ser exclusividade da allowlist de env.** `POST /api/org/invitations/:id/{approve,reject}` decidiam por `isApprover(email)` — só os e-mails de `INVITE_APPROVER_EMAILS`, cujo default é uma conta pessoal. Um administrador da imobiliária não tinha como liberar ninguém: o convite ficava pendente até o aprovador designado aparecer. O gate virou `canApproveInvitations`, que é o OR de duas fontes: a permissão nova **ou** a allowlist de env.
  - **A allowlist continua valendo, de propósito.** Ela é a única porta que não depende de membership — se a última membership de admin/owner sair por engano, é por ela que a org volta a conseguir admitir gente. Tirá-la trocaria um problema de acesso por outro, pior.
  - **A UI já obedecia a um flag do servidor** (`isInvitationApprover`, em `GET /api/auth/permissions`), que também era só a env. Ele passou a espelhar o mesmo OR — divergir ali esconderia o botão justamente de quem pode clicar, e o 403 nunca chegaria a acontecer porque o clique não existiria.
- **Quem decide passa a ser avisado.** A criação de convite mandava o e-mail de "aguarda aprovação" só para `INVITE_APPROVER_EMAILS`; o administrador ganharia o botão e nunca saberia que há fila. Agora o CTA vai também para os membros com `org.members.approve`. A lista é resolvida **pela permissão, não casando `role` na string**: uma CustomRole que carregue a chave decide e por isso precisa saber. Uma query só, resolvendo o preset em memória — `getEffectivePermissions` custaria uma query por membro. Membership de serviço (`isSystem`) e usuário em soft delete ficam fora.

### Notas

- Sem migration: `OrgInvitation` já tinha `status`/`approvedById`/`rejectedAt`/`rejectionReason`, e a permissão é derivada do preset em memória (não há linha de permissão no banco para presets).
- O convite continua nascendo `pending` e nenhum `User` existe antes da aprovação — o fluxo não afrouxou, só deixou de depender de uma pessoa específica.
- **Dívida deixada em aberto:** `lib/api/require-auth.ts` espelha a lógica de impersonação e NÃO ganhou `impersonatedByEmail`. As 4 rotas de convite usam `lib/auth/context`, então nada quebra hoje — mas o campo passa a existir em só metade da superfície de auth. Quem for ler `impersonatedByEmail` a partir do outro caminho vai encontrar `undefined` sem aviso.
- **Isto é mudança de política, não bug fix.** Antes, convidar (`org.members.invite`, que o admin já tinha) e aprovar eram poderes separados — quatro olhos. Agora o admin faz os dois. Para o preset `admin` o teto é lateral: `INVITATION_ROLE_VALUES` não inclui `owner`, então ele admite no máximo outro admin e não alcança `ORG_DELETE`/`ORG_TRANSFER_OWNERSHIP`/`API_KEY_ROTATE`/`ACCOUNT_*`. Para papéis MENORES esse raciocínio não valia, e é o que `canApproveInvitationForRole` passou a garantir — no caminho de convite. Não foi adicionada regra impedindo que quem criou o convite o aprove — o sistema também não a tem hoje, e ela travaria uma org de um admin só.
- Notificação de convite é best-effort e passou a ter round-trip ao banco: falha do lookup degrada para a allowlist de env em vez de derrubar o handler com o convite já commitado. O criador não recebe CTA da própria ação, e o fan-out tem teto de 25 com aviso em log.

## [Unreleased] - 2026-08-28 - Seguradoras fora de vendas, dados bancários abertos e o picker que só mostrava 2 de 42

Três queixas do uso real, todas na etapa Comissão e na tela de configuração do
formulário.

### Corrigido

- **O dropdown de corretor oferecia 2 dos 42 comissionados cadastrados.** `SplitRecipient.active` acumulava dois sentidos incompatíveis: "rascunho sem meio de repasse" (`createCommissioner` grava `pendingFields` e `active:false` — o `splitDispatcher` precisa disso) e "excluído pelo admin" (o DELETE fazia soft delete com o mesmo booleano). O picker filtrava `active: true` e engolia os dois juntos. Consulta ao banco de produção em 28/08: 42 comissionados na org, 36 rascunhos e 4 inativos completos escondidos, contra 5 exclusões de verdade no `AuditLog` — a esmagadora maioria dos sumidos nunca foi apagada. Coluna nova **`archivedAt`** responde "este cadastro existe?", o soft delete passa a gravá-la, reativar limpa-a, e toda listagem de ESCOLHA de corretor filtra por ela. O dry-run do backfill em produção arquiva 5 linhas, todas artefatos de QA (`Teste E2E QA`, `[QA F6] Recipient A-D`), e devolve **37 corretores reais** ao formulário.
- **A busca do picker não olhava e-mail nem telefone**, só nome, documento e CRECI — e tinha `take: 50` sem sinal de truncamento, então lista cheia era indistinguível de lista completa. Agora busca também por contato, o teto é 200 e o payload traz `hasMore`, que a UI mostra como "digite para refinar".
- **A etapa Comissão de LOCAÇÃO ainda engolia 429/403 como lista vazia** e usava um `<datalist>` artesanal — o defeito que venda corrigiu em 27/08 e que esta esteira, nascida de uma cópia anterior, nunca recebeu. Passa a usar o `CorretorCombobox` compartilhado, com `fetchOptions` memoizado (a identidade nova a cada render foi a causa raiz do 429 original).
- **O catálogo de seguradoras aparecia com "Vendas" selecionado.** Seguradora é prestadora de garantia locatícia e não existe em venda. A causa era estrutural: a página tinha três seletores de esteira concorrentes e o `GarantiaOptionsCard` não obedecia a nenhum — só ao módulo. Agora há **um seletor só** (`EsteiraTabs`, por context), governando os campos obrigatórios, o padrão contratual e o catálogo de garantias. O `ContractDefaultsCard` perdeu as `Tabs` próprias; deixá-las criaria dois seletores discordando na mesma tela.
- **A exigência de dados bancários só aceitava chave PIX.** O critério vinha de `SplitRecipient.pendingFields`, que é PAGABILIDADE da esteira de repasse — quem digitava banco, agência, conta e tipo ficava travado tendo informado tudo o que a exigência pede. Agora vale **PIX OU conta completa**. `pendingFields` não muda: conta bancária é TED manual e `composeSplits`/`splitDispatcher` só conhecem wallet e PIX; os dois conceitos passam a ser distintos em vez de um posar pelo outro.

### Alterado

- **Os dados bancários do corretor passam a ficar salvos no formulário**, em `comissao.comissionados[].recebimento` (venda) e `comissao.angariadores[].recebimento` (locação), no mesmo shape que o `recebimento` das PARTES já usava. Quem preenche reabre o formulário e encontra o que digitou — antes era estado local write-only e sumia da tela.
  - **A contrapartida é inseparável, e é o que mais importa aqui:** o `dataJson` é devolvido inteiro pelo GET público a qualquer portador do link, que normalmente é o cliente. A redação por leitor vive em `lib/forms/redact-datajson.ts` e é aplicada nos dois GET públicos e no `initialData` do wizard; a cópia para o `Contract.dataJson` (de onde LLM de análise, ClickSign e DIMOB leem, sem gate de leitor nenhum) sai sem os campos, no fan-out e no sync do PATCH.
  - **A outra metade: preservar na escrita.** O PATCH do token principal não tem allowlist de propósito, e o autosave de quem leu redigido devolveria o array de comissionados sem o `recebimento` — apagando, só por salvar, o que a imobiliária preencheu. `preserveCommissionerReceiving` roda dentro do row lock, restaurando por `splitRecipientId` (ou por índice). Fazer uma metade sem a outra é pior que não fazer nenhuma; o teste-guarda cobre as duas e varre as superfícies pelo fonte, para que rota nova sem redação quebre o CI.
  - **Fora do resumo**, por decisão registrada: o resumo é impresso em PDF, enviado por e-mail para fora da imobiliária e vira o texto que alimenta o LLM de revisão. As 14 entradas em `OMITIDOS_COM_MOTIVO` usam PATH COMPLETO de propósito — `omitido()` casa também pelo último segmento, e `banco`/`agencia`/`conta`/`pix_chave` são os mesmos nomes do `recebimento` das PARTES, que É exibido; uma chave curta desligaria a cobertura dele em silêncio.
  - O subtoken por parte não precisou de nada: `comissao` não existe em `STEP_PATHS`, então é inalcançável por construção. Os `GET /api/deals/[dealId]` e `/api/pipeline/deals/[dealId]` ficaram de fora **de propósito** — exigem autenticação casada com a org dona do negócio, então quem chega neles já é a imobiliária; redigir ali esconderia da casa um dado que é dela.
- **O cadastro do corretor virou automático, e o botão sumiu.** "Salvar como cadastro reutilizável" era um passo que ninguém dava — e sem ele a linha ficava sem `splitRecipientId`, o corretor não entrava no roster e o negócio seguinte recomeçava do zero. Agora, quando a linha tem nome e algum identificador, o formulário consulta `GET .../commissioners/match` e: reconhecendo alguém, abre o diálogo **"é a mesma pessoa?"** (sim vincula e preenche só o que está vazio, inclusive os dados bancários para membro; não segue com cadastro novo e não repergunta aquele candidato); não reconhecendo, cria sozinho. Vale igual para corretor (PF) e imobiliária (PJ) — são a mesma entidade, separadas só por `tipoPessoa`.
  - **O dedupe passou a olhar e-mail e telefone**, não só documento e nome exato. Sem isso, quem digitasse o mesmo corretor com o nome escrito de outro jeito e sem CPF criava duplicata silenciosa, e o partial unique do banco não pega o que não tem documento. Ordem de confiança: id > documento > e-mail > telefone > nome. Cadastro arquivado fica fora — casar com ele ressuscitaria o que o admin apagou.
  - **`cpfCnpj` virou opcional no POST** (a etapa não pede documento antes de e-mail e telefone), com `superRefine` exigindo ao menos um identificador. Cadastro só com nome cairia no elo mais fraco do dedupe e viraria lixo irreconhecível.
  - **Cadastro existente + membro logado agora PREENCHE o que está vazio** e nunca sobrescreve, com audit listando os campos (nunca os valores). Antes tudo era descartado em silêncio — trava criada contra o link anônimo, que estava pegando também a imobiliária que mantém o próprio cadastro. **Para anônimo a trava continua intacta**: é ela que impede desviar repasse trocando a chave PIX alheia com o link na mão.
- **O bloco de dados bancários nasce aberto e marcado** quando a imobiliária exige, sem botão de mostrar/ocultar — recolhido atrás de um botão discreto era o motivo de o passo passar despercebido.
- **O "Não, é outra" do diálogo de duplicidade era desfeito pelo servidor.** O POST refaz o match server-side de propósito — é ele que fecha a corrida entre duas abas —, mas reencontrava pelo e-mail exatamente o cadastro que o usuário acabara de recusar e devolvia `existed: true`: a linha ficava vinculada a quem o humano disse não ser. A recusa agora viaja no corpo (`ignorarIds`) e vale para os sinais fracos (e-mail, telefone, nome). **O documento continua ignorando a recusa** — mesmo CPF/CNPJ é a mesma pessoa, e o partial unique do banco barraria de qualquer forma. Achado no smoke, com teste-guarda.
- **O selo "sem dados bancários"** (combobox e diálogo de duplicidade) passou a olhar o `recebimento` real, não `receivingPending`. Aquele booleano é pagabilidade da esteira de repasse e segue verdadeiro sem chave PIX de propósito — então, depois de a conta bancária passar a valer, ele acusava "sem dados bancários" num cadastro cuja conta acabara de ser preenchida. Achado no smoke de staging, não em teste.
- **Textos de split saíram da UI** (o módulo não entra agora): configurações do formulário, formulário público e telas financeiras passam a falar "repasse". Só texto visível — `SplitRecipient`, `splitJson` e `/api/financeiro/split-recipients` continuam com o nome que têm.

- **`archivedAt` vale em todas as superfícies que decidem se o corretor está em circulação**, não só no picker. Introduzir a coluna e parar no formulário deixaria o sentido novo valendo num lugar e em nenhum outro:
  - **"Desativar" em `/corretores` passa a arquivar.** A tela usa PATCH, não o DELETE — sem isto o corretor sairia das cobranças e **continuaria oferecido no formulário**, o inverso exato da queixa que originou a coluna. "Reativar" desfaz os dois. É o único PATCH que manda `active`; o sheet de edição não o inclui, então salvar um cadastro não o arquiva por acidente.
  - **Notificações do processo** (`resolveDealBrokers` e o inverso que o Max usa) passam a excluir arquivado. Excluir um corretor não silenciava nada — o resolvedor ignora `active` de propósito, porque quem está sem chave PIX segue tendo direito de saber que o contrato foi assinado. Era um defeito que só ficou corrigível quando os dois sentidos se separaram.
  - **Anexar corretor a negócio ou formulário novo** (`brokerIds` do painel de notificações e o pré-seed de `POST /api/forms`) rejeita arquivado — semeá-lo o ressuscitaria pela porta dos fundos.
  - **A tela `/corretores` reclassifica:** "Inativos" passa a ser quem foi desativado, não quem está sem meio de repasse. Um rascunho desativado caía em "Pendentes", com alerta amarelo pedindo para completar o cadastro de alguém que já tinha sido tirado de circulação.

- **Teste que afirma a AUSÊNCIA na saída do resumo**, não só o registro da omissão. O `form-summary-coverage.test.ts` garante que ninguém esqueça de decidir, mas uma entrada em `OMITIDOS_COM_MOTIVO` diz "decidimos não mostrar", não "o valor não sai" — um `pushIf` novo em outra seção passaria por ele. O teste novo monta um formulário com valores bancários sentinela e afirma que nenhum aparece no texto que vai à tela, ao PDF, ao e-mail e ao prompt do LLM de revisão.

### Nota — formulários em circulação

Até esta mudança os dados bancários viviam SÓ no `SplitRecipient` e o `dataJson` guardava apenas o booleano `recebimentoPendente`. O gate aceita as duas fontes (`linhaSatisfeita`): sem isso, todo formulário aberto antes de 28/08 passaria a acusar pendência num dado que de fato existe, travando negócio em andamento por causa do formato novo. E a linha com `splitRecipientId` mas sem `recebimento` no `dataJson` é reidratada do cadastro na abertura, para membro — senão o bloco apareceria vazio e "obrigatório" para quem já tinha informado tudo.

## [Unreleased] - 2026-08-28 - Resumo do formulário, o 404 do download e a obrigatoriedade dos campos

Cinco frentes a partir da mesma queixa: "o resumo não reflete o formulário, e o
download diz que o negócio não existe".

### Corrigido

- **"Não encontrado" ao baixar o PDF do resumo — e em mais 27 rotas de negócio.** Não era bug do resumo: `getUserOrg` aplica o overlay de impersonation e devolve a org IMPERSONADA, mas `guardDealScope` recebia o `session.user.id` do super_admin REAL, que não tem `OrgMembership` nesse tenant. `getEffectivePermissions` voltava `null` e o guard respondia 404 — enquanto a PÁGINA do negócio abria normalmente, porque ela resolve `getEffectiveUserId`. Quem operava um tenant por impersonation via a tela e não conseguia baixar o resumo, emitir certidão, anexar documento ou disparar notificação. Os dois guards (`guardDealScope` e `guardContractScope`) passam a resolver o ator efetivo internamente: uma correção, 28 rotas, e as quatro portas de escopo (`loadScopedDeal`/`loadScopedContract` já eram impersonation-aware) finalmente com a mesma identidade. Teste-guarda que falha sem o fix.
- **A aba Dados do negócio mostrava bem menos que o PDF do resumo.** Eram três renderizadores independentes — o do PDF/e-mail, o da aba de venda e o da aba de locação —, cada um com sua lista manual de campos. A aba de locação, por exemplo, não tinha encargos detalhados, administração, contas de consumo, cláusula rescisória, foro, local de assinatura nem observações; a de venda não tinha a etapa de posse/título, as parcelas em detalhe nem a configuração contratual. As duas telas passam a consumir o MESMO builder do PDF (`buildConsolidatedFormSummary`, puro, calculado no server), com os cards atuais preservados como visão rápida.
- **Campos que o formulário coleta e o resumo nunca imprimiu.** Locação: cobertura e vigência da apólice, nº da proposta do título de capitalização, multa e juros por atraso (venda já tinha), a seção de administração (`fiscal.*`), a vistoria de referência, a qualificação do angariador (documento, CRECI, e-mail, telefone) e a renda do FIADOR — que é justamente o que sustenta a fiança. Venda: parcelas com prazo, data, meio de pagamento e destino (PIX/conta), telefone do comissionado e o prazo das regularizações.
- **A taxa de administração sumia do resumo** em todo formulário anterior a 2026-08: a linha dependia de `aluguel.adm_imobiliaria === true`, booleano que só passou a existir naquela data. Além disso, o PDF lia só o valor do formulário enquanto a tela preferia `fiscal.taxa_admin_percent` — as duas superfícies podiam mostrar números diferentes para a mesma locação. Agora a fonte é uma só, com precedência do que o operador acertou.
- **O endereço do procurador nunca aparecia.** O resumo exibia o endereço próprio só quando `endereco_igual_ao_titular === false`, e o procurador não tem essa flag no schema — o campo era coletado e descartado na leitura.
- **Slugs de enum vazando para a tela e para o PDF** ("comercial_sala", "paga_e_retem", "retem_imobiliaria"): o mesmo defeito que o TEXTO do contrato já tinha corrigido. O mapa de tipo de imóvel virou fonte única com o `enrichLocacaoData`.
- **Campo obrigatório com valor numérico nunca bloqueava nada.** `isValueEmpty` não considerava `0` vazio, e o Zod dá `.default(0)` a quase todo campo de dinheiro: `pagamento.valor_total` está em TODOS os presets de venda e o formulário era concluído com valor total zero. O piso de locação já tratava `aluguel.valor` assim, com regra própria e inline — o mesmo campo era obrigatório ou não conforme o caminho que o checava. Regra única agora, com uma lista curta e justificada (`vagas_garagem: 0` e `caucao_meses: 0` seguem sendo respostas legítimas).
- **Obrigatoriedade fantasma.** A tela aceitava marcar campos que não existem mais no formulário público — `foro` (virou aba Configurações do contrato), `comissao.imobiliaria_*` (espelhos legados sem input), `status_propriedade`/`ocupacao` (default não-vazio, nunca disparava) e, em locação, `assinatura.*`, `foro` e `vistoria_ref` (a etapa foi removida em 2026-07-30). Marcar qualquer um deles criava uma pendência insolúvel. Saíram da allowlist, e o filtro passou a valer também na LEITURA — o que já estava salvo deixa de travar formulários em circulação. `garantia.fiador.*` saiu pelo mesmo motivo: `PARTY_PATH_RE` não casa esse prefixo, então o path passava sem o remap PF/PJ e sem checar se a garantia é fiança.
- **"Ver Negócio" levava um formulário de locação para a UI de venda** (`/deals/[id]`, que não tem guard de `kind`). Mesma classe do bug já registrado para o card do kanban.
- **`SalesForm <id> não encontrado`** ia verbatim para o toast do usuário num 500 — texto indistinguível do 404 de escopo, com causa oposta.

### Adicionado

- **A tela de Configurações → Formulário passou a oferecer todos os campos que a rota aceita.** Eram duas listas mantidas à mão, e a da tela era um subconjunto: 31 campos em venda e 37 em locação, contra 135 e 124 agora. A etapa Comissão não tinha um único campo configurável em nenhuma das duas esteiras; a garantia e os encargos de locação, o endereço do cônjuge e os dados de recebimento das partes eram aceitos pela API e invisíveis para o admin. O catálogo passou a ser DERIVADO da allowlist — a segunda lista deixou de existir. `imovel.descricao` de locação, que o schema mandava "exigir pelo preset da org", enfim aparece lá.
- **Exigir os dados bancários do corretor** (Configurações → Formulário, vale para venda e locação). Com a exigência ligada, o bloco de recebimento nasce ABERTO e destacado, e a etapa Comissão só avança com cada corretor cadastrado e com chave PIX — o critério de "pagável" que a esteira de repasse já usa (`SplitRecipient.pendingFields`). Não é um path de `customRequiredPaths` de propósito: esses campos não vivem no `dataJson`, que é devolvido inteiro pelo GET público do formulário e vai no resumo por e-mail. O que trafega é só um booleano de estado. **Quem preenche pelo link público nunca é bloqueado** — o cliente não vê nem pode enviar esses campos, e travá-lo seria um beco sem saída.
- **Três testes-guarda**, porque as três frentes têm a mesma forma — listas de campos mantidas à mão que divergem do schema com o tempo: cobertura do resumo (percorre o Zod, dá sentinela a cada campo folha e exige que apareça em alguma linha, com allowlist comentada dos omitidos), paridade allowlist ↔ catálogo da tela, e o gate de recebimento. Campo novo no formulário sem lugar no resumo ou na tela de obrigatoriedade agora quebra o CI em vez de aparecer como queixa três meses depois.

### Nota — a margem do PDF do resumo

O perfil de página próprio do resumo (16 mm simétricos, rodapé alinhado ao corpo) entrou no PR #416 e **já está em produção** desde o deploy do #418 (`c4571e78`); o deploy de produção atual é o `a3074344`. O PDF com margens de encadernação (30/25/35/25 mm, herdadas do contrato) é anterior a isso. Nada a corrigir aqui — verificado no painel de deploys, não presumido.

## [Unreleased] - 2026-08-27 - Formulário: o que a RE/MAX Ativa achou no uso real

Cinco frentes a partir do uso real do primeiro tenant com corretores de verdade
(demo de onboarding em 28/07 e sessão prática de preenchimento de uma locação
real em 25/08).

### Corrigido

- **O picker de corretor de LOCAÇÃO gravava o CPF/CNPJ MASCARADO no formulário.** O endpoint token-scoped devolve o documento como `390***05` de propósito (anti-scraping no form público) e a etapa de Comissão de locação persistia isso em `dataJson`. Venda já tinha o fix; locação nasceu de uma cópia anterior a ele. Em cadeia: salvar o cadastro devolvia 400 "CPF/CNPJ inválido" para um corretor vindo do próprio picker, o dedupe por documento era pulado (`normalizeDoc` via 5 dígitos) e o `materialize-parties` criava `PropertyOwner` com documento falso. O vínculo real sempre foi o `splitRecipientId`.
- **A listagem de corretores cadastrados não aparecia.** `CorretorCombobox` tem `fetchOptions` nas dependências do efeito de busca, e os dois call-sites declaravam a função sem `useCallback`: identidade nova a cada render, ~1 request a cada 300ms contra um teto de 30/min, 429 em ~9 segundos — e o `catch(() => setOptions([]))` transformava tudo em "Nenhum corretor encontrado". O fetch agora lança em HTTP != 2xx e o combobox tem estado de falha visível, para que um 429 ou 403 futuro não volte a se disfarçar de lista vazia.
- **`parseEndereco` gravava o CEP no campo `numero`.** `\d+` sem teto de dígitos e `.+?` preguiçoso: um endereço SEM número de porta ("Rua das Flores - Centro - CEP 01310-100") entregava `numero = "01310"`, e o bairro era engolido dentro de `rua`. O caminho mais comum é o comprovante de residência, cujo prompt pede endereço e CEP separados mas cujo modelo repete o CEP dentro do endereço. O sentido inverso já estava protegido e tinha teste; `parseEndereco` tinha cobertura ZERO.
- **Campos decimais recusavam a vírgula do teclado brasileiro.** Sobraram `<input type="number">` com `valueAsNumber` em área do imóvel, taxa de administração, taxa de locação e percentual do angariador: digitar "45,5" deixava o value vazio e o RHF gravava `NaN` — o campo se apagava sozinho.
- **O resumo em PDF saía com a diagramação de um contrato.** Gerado com `style = null`, herdava a tipografia de contrato do exporter — h1/h2 centralizados, em CAIXA ALTA, dourados, com o ornamento do `h2::after` — e as margens de encadernação (35mm à esquerda, 25mm à direita), com o rodapé de numeração num recuo que não batia com o corpo. Sobre uma sequência de tabelas label/valor. Agora tem perfil de página próprio.
- **A etapa "Garantia e Observações" tinha o card da cláusula rescisória torto.** Rótulo de 68 caracteres num grid de 2 colunas quebrava em 3 linhas enquanto o vizinho ocupava 1; como o `FormField` é `flex-col` sem altura mínima no label, o select descia ~30px em relação ao input, e escolher "Não" desmontava o campo vizinho deixando meia linha vazia.

### Adicionado

- **Reanálise de um documento já processado**, e **correção manual dos campos extraídos** antes de aplicar. A rota `/retry` sempre aceitou qualquer status — só a UI não oferecia o botão, e um documento cujo OCR saiu errado só tinha saída sendo removido e subido de novo. A edição entra por uma rota anônima e alimenta o autofill, então é fechada: só chaves que o OCR já produziu para aquele anexo, só string, teto de 500 caracteres, string vazia como remoção.
- **A etapa 0 agrupa os documentos por parte**, o destino aparece desde o upload (era só depois da extração, rotulado "Mover para:") e o card mostra todos os campos extraídos (cortava em 6 sem dizer que havia mais).
- **Re-sugestão reativa do destino.** O assignment era calculado uma única vez, no upload ou no restore; como a sugestão é um match de CPF/nome contra o formulário, um documento enviado ANTES de a pessoa digitar os nomes ficava em "outro" para sempre e o gate H.5 travava o "Aplicar aos campos" do formulário inteiro.
- **Ficha-resumo em PDF passa a funcionar em locação.** Os papéis de locação não existiam em `FICHA_PAPEIS`, o prompt instruía só venda e o adapter não implementava `applyFicha`: a ficha caía em "outro" e preenchia zero campos.
- **A extração deixa de descartar a qualificação das partes.** O prompt não pedia profissão, nacionalidade nem estado civil de documentos que os contêm (certidão de casamento e procuração qualificam as partes), e o mapa de locação não conhecia seis campos que o schema tem.
- **Comissão do 1º aluguel em valor fixo ou percentual**, com padrão por imobiliária (Configurações → Formulário → Locação) semeado na criação do formulário. A taxa da imobiliária só existia em percentual, e o valor era redigitado a cada formulário novo.
- **Seleção/anexo da matrícula na própria etapa do imóvel de locação** (venda já tinha), inclusive nos links por parte.
- **Preenchimento por áudio em locação e nos links das partes.** O schema de voz era um mapa único com paths de venda, e os índices de step colidem entre esteiras — em locação o filtro por escopo zerava e o prompt virava literalmente "Retorne {} — nada a preencher", com resposta 200 e silenciosa.
- **Logo da imobiliária nas páginas públicas do formulário** (mostravam a marca do produto hardcoded) e **seção de Comissão no resumo de locação** (venda já trazia a dela).
- **Proposta em nova guia** (pedido da demo de 28/07) — o card só oferecia "Ampliar/Reduzir" dentro do iframe. Não abre o HTML direto (nem por `blob:`, nem por `document.write` do conteúdo): as duas formas dariam ao documento a origem da aplicação e derrubariam a segunda camada de defesa de `preview-html.ts` — o `stripActiveContent` é um filtro de superfície conhecida, não um sanitizador, e o `dataJson` da proposta vem de digitação e de OCR. A guia recebe só uma casca; o documento continua dentro de `<iframe sandbox="">`.
- **Aviso quando a imobiliária não tem logo**, na tela de Perfil, e **passo `branding` no checklist de onboarding** (opcional, não bloqueia os 100%). Consulta ao banco de produção em 27/08: as 5 imobiliárias têm linha de `BrandingSettings` e **todas com `logoUrl` vazio**. Cinco de cinco não é esquecimento de um cliente — a ausência era invisível dos dois lados, porque o formulário, o PDF do resumo, a cobrança e os e-mails caem no NOME da imobiliária em texto, um fallback silencioso e plausível. Foi assim que "o resumo saiu sem o logo" virou suspeita de bug no PDF com o código de branding correto desde 18/08. O fato consultado é o ARQUIVO, não a linha.

### Alterado

- **"Descrição do imóvel" deixou de ser obrigatória no formulário de locação**, a pedido da corretora: o campo virava discussão de negociação num formulário que só precisa identificar o imóvel. Quem quiser exigir liga pelo preset de obrigatoriedade da org.

## [Unreleased] - 2026-08-22 - Precisão da linha medido × estimado

### Corrigido

- **A linha de procedência arredondava em 4 casas e exibia em 6.** `dividirPorProcedencia` devolvia `toFixed(4)`, então as duas últimas casas do `formatUsdPreciso` eram decoração: o valor medido real do smoke (US$ 0,00010614) chegava na tela como `$ 0,000100`, e `$ 0,000106` era inalcançável por construção. O resto do painel arredonda em 4 porque exibe 2; esta linha exibe 6 de propósito, porque um turn do Max custa ~US$ 0,0004 e os dois lados precisam ficar distinguíveis. Achado no smoke de 22/08 — por olhar o número renderizado em vez de aceitar que "a linha apareceu".

## [Unreleased] - 2026-08-22 - O painel de custo volta a enxergar o dia de hoje

### Corrigido

- **`/settings/ai-usage` NUNCA mostrava o gasto do dia corrente.** O cliente manda `?to=2026-08-22` (data pura), o servidor lia `new Date("2026-08-22")` — que é **meia-noite** — e o filtro `lte` cortava o dia inteiro. Os três presets (7 dias, 30 dias, mês atual) exibiam uma janela terminando ontem, e uma chamada de IA feita agora só aparecia no dia seguinte.
  - Silencioso da pior forma: o número exibido estava sempre **certo para o intervalo pedido**; o intervalo é que não era o que o botão prometia. Achado em 22/08 durante o smoke do custo reportado, quando três linhas recém-gravadas simplesmente não apareciam na tela.
  - Data pura em `?to=` passa a significar **o dia inteiro**, que é a leitura natural de um intervalo de datas e o que o contrato da rota já dizia. Timestamp completo continua respeitado como veio. O corte é em UTC — para um tenant em UTC-3, uma chamada depois das 21h cai no "dia seguinte" desta conta; é o mesmo critério que o `from` sempre usou, e resolver de verdade exige o fuso do tenant, que a rota não conhece.
- **Os botões de período cobriam um dia a mais do que o rótulo dizia.** Achado de gate: com o `to` valendo o dia inteiro, a janela virou `[D_from 00:00Z, D_to 23:59:59.999Z]` — os dois extremos entram por completo —, então `now − 7×24h` dava OITO dias-calendário sob "Últimos 7 dias". É erro herdado que este conserto **expôs**: antes o `to` era meia-noite e a conta fechava por acidente, às custas de o dia corrente sumir. Agora `now − 6×24h` e `now − 29×24h`, com a aritmética fixada em teste. **"Mês anterior" e "Mês atual" também estavam errados, e por outra causa:** a conta era feita em horário LOCAL e serializada em UTC. Num fuso negativo isso desloca o limite um dia — em UTC-3, "Mês anterior" mandava `to = 01/08` e, com o dia inteiro valendo, somava 1º de agosto dentro do total de julho; "Mês atual" começava às 21h do último dia do mês anterior. `presetRange` passa a calcular em UTC e a devolver `YYYY-MM-DD` direto, sem `.slice()` no meio do caminho para desfazer a conta.
- **O painel de Assinaturas tinha o MESMO bug, e agora também vê o dia corrente.** `/api/signatures/metrics` repetia o parsing de data e `SignaturesClient` tinha cópia própria da conta de período. Três telas usavam cópias da mesma aritmética; a conta agora mora em `lib/ui/date-range.ts` e a leitura de `to` em `limiteSuperior`. Consertar uma e deixar a outra é como não consertar — a segunda vira o relato de bug do mês seguinte.
- **O `from` default das duas rotas deslocou junto com o `to`** e foi corrigido: 30 dias contados do FIM do dia cortavam quase todo o primeiro dia da janela. Não afeta os painéis (sempre mandam `from`), mas afeta qualquer consumidor do default documentado.
- **A linha "medido · estimado" usava o formatador do KPI**, que colapsa tudo abaixo de um centavo em `$ <0,01` — inclusive zero. Como um turn do Max custa ~US$ 0,0004, o caso comum renderizava `$ <0,01 medido · $ <0,01 estimado`, escondendo exatamente a diferença que a linha existe para mostrar. Formatador próprio, com 6 casas, agora coberto por teste.

### Nota de dado — linhas do Max com contagem de token sobreposta

Entre o deploy do `efbd721` (22/08) e o deploy do emissor corrigido, as linhas do Max gravaram `promptTokens` **incluindo** os tokens de cache, porque o OpenAI/OpenRouter conta `cached_tokens` dentro de `prompt_tokens` enquanto esta base adota a convenção disjunta da Anthropic (`calcCostUsd` soma as parcelas).

**O custo não é afetado** — `openai/gpt-5.4-nano` não tem `cacheRead` na `PRICING`, então a parcela zera. O que fica inflado é `totalCacheReadTokens` somado com `totalPromptTokens` no painel, só nessas linhas.

Sem backfill, de propósito: reescrever linha marcada `costSource: "reported"` produziria o pior híbrido possível — pareceria medição e não seria. Para identificar as afetadas:

```sql
SELECT * FROM "AIUsage"
 WHERE "agentKey" = 'max' AND "cacheReadTokens" > 0
   AND "createdAt" < '<timestamp do deploy do emissor corrigido>';
```

## [Unreleased] - 2026-08-22 - Custo de IA medido, não estimado (receptor)

### Adicionado

- **`POST /api/agents/usage` aceita `costUsd`** — o crédito que o provedor de fato cobrou — quando `provider: "openrouter"`. Isso parece contrariar a regra escrita na própria rota ("custo informado por quem gasta não é medição") e não contraria: o número **não é auto-declarado pelo agente**, vem inline na resposta do OpenRouter (`usage.cost`); o Max só transporta. Contrato em `docs/max.md` §9.1.
  - **Por que importa, medido em 21/08 contra o `gpt-5.4-nano`:** sem cache de prefixo a tabela de preços acerta com erro de **0,0%** — o preço nunca foi o problema. Num turn com **1792 de 1956 tokens vindos do cache**, o custo real foi US$ 0,00010614 e a tabela dizia US$ 0,00042870: **superestimativa de 304%**. O tenant via uma conta que não existe, e a otimização que mais economiza era justamente a invisível.
  - **O número fica em `AIUsage.estimatedCostUsd`**, que passa a guardar *o melhor número disponível*, com **`AIUsage.costSource`** (`"reported"` | `"estimated"`) dizendo qual é. Coluna paralela obrigaria os ~60 pontos que somam custo (budget por contrato, teto mensal por agente, painéis de admin) a fazer COALESCE — e o primeiro esquecido daria um total errado em silêncio, que é o pior modo de falha desta tabela. Assim, todo agregado existente fica mais correto sem uma linha de mudança.
  - **`null` e ausência = "o provedor não informou"; zero NÃO.** Zero é um número, e um turn que custou zero de verdade precisa ser distinguível de um que ninguém mediu. Teto de sanidade próprio (US$ 1,00/turn), porque é o único campo que entra na tabela de custo sem passar pela tabela de preços.
  - **De outro provider, `costUsd` é descartado em silêncio** — não 400: o campo é aditivo, e um cliente antigo que o mande por engano não deve quebrar.
  - A resposta 202 devolve `costUsd`, `costSource` e **sempre** `estimatedCostUsd`, este último para quem integra medir o erro da tabela sem acesso ao banco. `/settings/ai-usage` passa a mostrar a divisão medido/estimado no card de custo.
  - **Nasce inerte**: nenhum cliente manda `costUsd` ainda. O emissor é PR próprio, no repositório do max-agent.

## [Unreleased] - 2026-08-22 - Alerta de queda da instância Z-API do Max

### Adicionado

- **`POST /api/webhooks/max/alert`** — quando a instância Z-API do Max cai (ou volta), a plataforma manda um e-mail. Fecha a lacuna que sobrou de 04/08: naquele dia quatro mensagens reais ficaram represadas porque a instância tinha caído e ninguém soube. A Fase 4 já impediu a PERDA — o Max checa a conexão antes de despachar e represa a fila em vez de mentir "enviado" —, mas a fila continuava parada em silêncio até alguém abrir o painel. Contrato normativo em `docs/max.md` §9.
  - **O corpo abre com quantas mensagens estão represadas.** É o número que decide a urgência de quem lê às 3 da manhã. `represadas: 0` é notícia legítima e não silencia nada: a queda derruba o inbound junto, e quem escrever para o Max fica sem resposta.
  - **Alerta por TRANSIÇÃO, nunca por estado** — por estado seriam 1.440 e-mails por dia, porque o cron do Max roda a cada minuto. Quem guarda a transição é o `connection_state` do lado de lá; esta rota não decide repetição.
  - **`MAX_ALERT_EMAIL`** (lista separada por vírgula) define o destinatário. **Ausente NÃO desliga o alerta**: cai nos `PlatformRole super_admin` do banco. Env esquecida virando alerta descartado em silêncio seria a falha original reencenada num lugar novo.
  - **E-mail não enviado responde 500, não 200** — o max-agent só carimba "já avisei" em 2xx, então o 500 vira reenvio na passada seguinte do cron, sem fila nova nem código de retry. O 500 cobre uma causa transitória (provedor recusou) e uma permanente (nenhum destinatário); nesta última o incidente ainda fica registrado, porque o registro acontece antes de qualquer desistência.
  - **Registro e notificação por caminhos separados**: o e-mail sai por `sendEmail` direto, e `reportPlatformAlert` entra em modo `"digest"` — o re-arm de 24 h do motor de alertas engoliria um segundo incidente no mesmo dia. A assinatura carrega o instante do incidente, então é uma linha por queda e o `count` conta tentativas de entrega.
  - **Sem migration** (`PlatformAlertEvent.kind` é `String`) e **nasce inerte**: sem `MAX_WEBHOOK_SECRET` a rota responde 503. O emissor é PR próprio, no repositório do max-agent.

## [Unreleased] - 2026-08-22 - Filtro "Responsável" do kanban

### Corrigido

- **O filtro "Responsável" listava o histórico, não a equipe.** As opções vinham de `user.findMany({ deals: { some: { pipelineId } } })` — só quem já tinha CRIADO um negócio naquele pipeline. Quem responde por negócio sem nunca ter aberto um simplesmente não existia no select, e não havia como filtrar por ele (reportado na Newcore). A lista passa a nascer da membership da org, como já fazia a tela de Propostas, unida a quem ainda figura como criador ou gerente de algum negócio do pipeline — sem essa união, o negócio de quem saiu da imobiliária ficaria não-filtrável. Usuário de serviço (`isSystem`) e conta removida (`deletedAt`) ficam de fora.
- **Filtrar por uma pessoa escondia os negócios que a tela atribuía a ela.** O filtro casava `Deal.userId` (o criador, imutável) enquanto o card do kanban exibe o GERENTE (`Deal.managerUserId`, reatribuível): filtrar pelo nome que a própria coluna mostrava devolvia menos negócio do que ela anunciava. Passa a casar criador OU gerente. **A contagem de "N negócios" muda para quem já usava o filtro** — é a correção, não regressão.
- **A busca sumia em silêncio quando combinada com outro filtro.** `q` e `responsavel` produzem `OR` e moravam na mesma chave `where.OR`: o segundo apagava o primeiro. Pela mesma razão, `getBoardStages` montava o `where` por spread, e o `OR` do escopo RBAC (gerente com visão restrita) sobrescrevia o dos filtros — a busca quebrava justamente para quem tem menos visão. Ambos passam a compor por `AND`. Nenhum dos dois vazou negócio: na colisão, quem sobrevivia era o escopo.

## [Unreleased] - 2026-08-22 - Fim do orçamento de gasto da ClickSign

### Removido

- **O teto mensal de gasto em R$ da ClickSign, inteiro.** A plataforma barrava envio comparando um gasto acumulado contra um orçamento que ela mesma inventava: a conta saía de uma tabela de preços *hardcoded* e nunca conferida (`CLICKSIGN_COST_CENTS`: e-mail R$1,50, WhatsApp R$2,50, selfie R$9,00, ICP R$3,50) contra um default de R$100 (`getMonthlyBudgetCents`). O envio foi recusado com **"R$ 93 de R$ 100"** numa conta cujo plano ClickSign estava intacto — número inventado, bloqueio inventado. Saem: o gate no `executor`, o `EnvelopeBudgetError`, o sub-teto de propostas (`proposalBudgetCents`) e os dois gates das 2ªs vias encadeadas (envelope e Aceite).
- **Todo valor em R$ do fluxo de assinatura**: os chips "Custo estimado" dos três diálogos de envio, o card "Orçamento e custo" em Configurações › Assinaturas, o `costCentsByMethod` de `/api/signatures/config`, o "(custo R$ X)" do resumo que vai a quem aprova envio por Bearer, e o valor por envelope na lista de recentes. O card "Gasto do mês / de R$ X de orçamento" do painel vira **"Envelopes no mês"** (contagem). Nenhuma coluna é apagada (limpeza é migration própria), mas o estado de cada uma difere: `monthlyBudgetCents` e `proposalBudgetCents` ficam **sem leitor**; **`costOverridesJson` continua sendo lida** (alimenta `Envelope.costCents`) e só perdeu o **escritor** — ajustar um override de custo virou operação de banco. Não confundir com coluna órfã.

### Adicionado

- **`lib/clicksign/quota.ts`** — a negativa por falta de envelope passa a nascer da resposta da própria ClickSign. `isPlanQuotaError` classifica HTTP 402 sozinho, e 403/422 só quando o texto do erro fala de limite/cota/plano/saldo; qualquer outra coisa segue como falha genérica. O critério é deliberadamente conservador: a ClickSign não documenta esse código publicamente, e errar para "limite do plano" reintroduziria o bug, mandando o corretor conferir um plano intacto. Todo 4xx de envio passa a logar o corpo cru (`[clicksign] falha 4xx`) para calibrar o regex com uma recusa real.
- O erro vira `EnvelopePlanLimitError` (HTTP 402, `code: "CLICKSIGN_PLAN_LIMIT"`), com mensagem fixa e sem valores. O MCP do Newton/Max também para de dizer "orçamento do mês atingido" no 402.

### Corrigido

- **`CLAUDE.md` prometia um "ClickSign cap" sob `STAGING_MODE` que nunca existiu no código** — lá `STAGING_MODE` só prefixa `[STAGING]` no nome do envelope. O único freio real era o orçamento agora removido. Docs corrigidas: **staging não tem teto e cada envio consome um envelope real do plano, cobrado.**

### Mantido de propósito

- O **advisory lock por org** no `executor` continua: ele nasceu para o TOCTOU do orçamento, mas é o que serializa o re-check "1 envelope ativo por contrato" — sem ele, dois envios paralelos do mesmo contrato criam 2 envelopes (cobrança dobrada e 2 e-mails por signatário).
- `Envelope.costCents` continua sendo gravado como telemetria interna, agora sem nenhum leitor em tela.
- Os labels `chained_*_budget_exceeded` em `status-view.ts` ficam: eventos já gravados precisam continuar renderizando na timeline. Nada novo é emitido.

## [Unreleased] - 2026-08-21 - Estilos de documento saem da configuração (soft removal)

### Removido

- **Tela `/settings/document-styles`, rotas `api/document-styles/*` e a tool de IA `apply_style_preset`** — a tela confundia com Templates (que carregam a própria formatação no engine google_docs) e virou superfície morta. O MOTOR fica 100% intacto: org nova continua nascendo com o preset padrão (seed), a geração Handlebars continua aplicando fonte/margens automaticamente (`googleApplyStylePreset`), e o export PDF/propostas continua usando o preset da org — a aparência de nenhum contrato muda. Compatibilidade: a entrada em `event-icons.ts` fica (timelines de chat antigas re-hidratam por ela); chamadas remanescentes ao nome caem no fallback genérico do dispatch (`Tool desconhecida`) e viram step `failed` gracioso no execute-plan — mesmo padrão da aposentadoria de `query_clauses`. ChatPlan PENDENTE antigo que contenha um step da tool falha esse step e pula dependentes (verificado zero casos em staging/prod na promoção). Ajustar preset passa a ser operação de banco (decisão consciente; reversível recriando a UI).
## [Unreleased] - 2026-08-21 - Reconciliação de entrega do Max (fim do ponto cego pós-202)

### Adicionado

- **`POST /api/webhooks/max`** — o agente Max passa a reportar o DESFECHO de cada notificação WhatsApp (`delivered` | `read` | `unconfirmed` | `failed`), fechando a lacuna que o `docs/max.md` §8 chamava de ponto cego: depois do 202 do `/notify`, falha real (número sem WhatsApp, bloqueio, instância desconectada) só existia dentro do Max. Agora o desfecho chega e fica gravado no log da notificação.
  - **Costura pelo ID da linha de log** — o `dedupeKey` que viajou no `/notify` É o `logId`/`deliveryId` (os call-sites mandam a linha de log de propósito, "para estender a idempotência até dentro do Max"); a coluna `dedupeKey` dos modelos guarda chave de EVENTO e casaria zero linhas. O `orgId` é obrigatório no payload como cerca: webhook autenticado por secret global não escreve em linha de tenant que ele não nomeou.
  - **Coluna própria `maxDeliveryJson`** (migration `20260821020000`, aditiva) nas duas tabelas de log, e não uma chave em `detail`: os settles dos trilhos substituem `detail` inteiro a cada retentativa e apagariam a marca — com o Max já tendo carimbado `reported_at`, a perda seria permanente. O `status` da linha NÃO muda (lá ele significa "processado pelo trilho", não "entregue").
  - **Monotônico e idempotente por construção**: um UPDATE atômico por tabela com a guarda de rank no próprio `WHERE` (`read` nunca regride para `delivered`; reentrega não duplica). HMAC `timestamp.rawBody` com secret PRÓPRIO desta direção (`MAX_WEBHOOK_SECRET`) — reusar o `MAX_NOTIFY_SECRET` deixaria qualquer lado forjar o outro.
  - **Nasce inerte**: sem `MAX_WEBHOOK_SECRET` a rota responde 503, e o cliente do Max classifica 503/404 como "integração fora" — não conta tentativa e não acumula fila. Ligar a integração é passo próprio, com smoke próprio.
  - **Cobertura**: só canais cuja `dedupeKey` é ID de linha de log. Canal com dedupeKey semântica e sem linha (ex.: request-completion de split-recipients) fica fora — o desfecho casa zero linhas, responde 200 e o Max o dá por entregue.

## [Unreleased] - 2026-08-21 - Situação da matrícula no formulário de vendas

### Adicionado

- **O formulário pergunta se a matrícula atualizada existe ou precisa ser solicitada** (pedido RE/MAX LCeA). Na seção Imóvel › Dados Registrais, dois caminhos:
  - **"Deverá ser solicitada"** → número e cartório viram obrigatórios (é o que identifica *o que pedir* ao registro; sem os dois a pendência que chega ao negócio é inacionável), com aviso âmbar explicando o porquê. A condicional entra por `matriculaConditionalPaths` e é somada aos QUATRO consumidores da lista de obrigatórios — gate do "Próximo", contagem de pendências, bullet do stepper e o asterisco do campo —, para que todos mostrem a mesma verdade.
  - **"Possui"** → dropdown dos documentos já anexados ao formulário (agrupado, com as matrículas identificadas pelo OCR em cima) **ou upload ali mesmo**: quem está com o PDF em mãos envia sem ir até a etapa Documentos e voltar para vincular. O arquivo enviado já nasce vinculado ao imóvel, a extração por IA é pedida na hora (é o único ponto do produto onde ela é automática — aqui o pedido é explícito, então gastar o token é o que o operador quer) e o botão "Aplicar dados extraídos" preenche número, cartório e dados do imóvel preservando o que já foi digitado. Anexo removido depois do vínculo aparece como "anexo removido, selecione outro" em vez de cair calado na primeira opção. Sem rota de anexos (link por parte), o bloco orienta a anexar pelo link principal.
- O pipeline de upload (limites, tipos, redimensionamento de foto, handshake do Blob) saiu do DocumentosStep para `lib/forms/attachment-upload.ts` e passou a ser o mesmo nas duas telas. Divergir ali produziria o pior tipo de bug: arquivo que passa na validação do cliente e morre no servidor com erro opaco.
- **Sem notificação nova**: o finalize já dispara "Formulário concluído", que leva exatamente à tela onde o banner está. Um segundo ping para o mesmo evento seria ruído.
- **Pendência visível na tela do negócio**: banner âmbar listando os imóveis à espera, com número e cartório do pedido, e atalho para a aba Anexos. Tem ciclo de vida — some quando a matrícula é obtida de fato (upload manual ou certidão emitida), e **não** com o anexo que veio do próprio formulário, que foi o que motivou o pedido. Linha correspondente no card Imóvel(is) e no PDF de resumo ("A ser solicitada" / "Anexada (arquivo)").
- Formulário anterior ao campo não exige nada e não alerta: pendência retroativa em negócio que já rodou seria ruído, não informação.

### Corrigido

- **A análise automática de matrícula anexada nunca rodou** — desde sempre. Os dois guards (`lib/deals/attachments.ts` e `manual-certidao-analysis.ts`) só aceitavam a categoria `matricula_anexada`, que **nenhum produtor do repo grava**: o finalize do formulário e o upload manual gravam `matricula`. Corrigir só um dos guards faria o gatilho disparar e a análise morrer três linhas adentro — o sintoma sumiria sem o efeito aparecer. Os dois aceitam agora ambas as categorias, e o OCR estruturado + cross-check com as certidões volta a rodar para matrículas.

## [Unreleased] - 2026-08-21 - Banco de cláusulas: redesign, preview e IA com consulta ao acervo

### Adicionado

- **Página `/clauses` redesenhada**: tabela com busca, filtros por grupo/status/tags e abas Padronizadas (G1–G6) / Cláusulas base / Plataforma, com coluna de uso POR TENANT (`KnowledgeItemUsage` — o contador global misturava orgs em cláusula de plataforma). Detalhe em painel lateral redimensionável com preview renderizado, fonte Handlebars colapsável e as ações de sempre (editar, adotar versão da plataforma, excluir).
- **Preview de cláusula** (`POST /api/clauses/preview`): renderiza o Handlebars contra as amostras determinísticas de preview (6 modalidades, lista canônica única entre UI e rota), pelo mesmo caminho seguro do preview de templates; erro de sintaxe vira 422 com mensagem — um linter de graça no editor.
- **Editor com RHF + Zod** (`clauseWriteSchema` compartilhado com o server): abas Conteúdo/Preview/Metadados, subcategoria com sugestões canônicas preservando valor legado, tags com sugestões de slots, e feedback de validação que troca pra aba do campo com erro (antes o Salvar ficava mudo com o erro numa aba desmontada).
- **"Gerar com IA" consulta o acervo antes** (primeiro consumidor do `ai-generate`): similaridade alta devolve as cláusulas existentes ("usar existente" / "gerar mesmo assim"); as parecidas entram no prompt como "não duplique". A busca ignora arquivadas e fragmentos de chunk.

### Corrigido

- **Rotas `/api/clauses` com validação Zod compartilhada** (POST/PATCH parciais sem apagar campos ausentes) e o gate `ai-generated → pending` tornado inviolável (status vindo do client não fura mais a revisão humana — approved é filtro duro do RAG e da geração de contratos).
- **Saída da IA validada pelo mesmo schema da escrita manual** — antes nasciam linhas que o editor recusava salvar.
- **Preview renderizava a amostra errada**: pedir "financiamento" caía na fixture de à vista — o linter aprovava cláusula quebrada.
- **`groupCode` legado "none"** deixava a cláusula insalvável em silêncio (Select mascarava como "Nenhum"); partição das abas agora é exaustiva (cláusula variável sem grupo não some mais da UI); página envia ao browser só os campos que a UI usa (colunas internas do KnowledgeItem não vazam mais).

## [Unreleased] - 2026-08-21 - Campos obrigatórios visíveis no formulário público

### Corrigido

- **O formulário não mostrava o que era obrigatório, e não marcava o que faltava.** A configuração por org (`OrgFormSettings` presets, tela `/settings/formulario`) já existia e já barrava o avanço — mas nada disso chegava à tela do cliente. Três defeitos somados: o asterisco era string fixa em ~14 labels, sem relação nenhuma com o preset (com preset `completo`, "RG" e "Nome da mãe" apareciam idênticos a campos opcionais e o cliente só descobria ao tentar avançar); nenhum input recebia `aria-invalid`, então o `setError` do wizard rodava e **nada acontecia na tela** — a borda vermelha de `ui/input.tsx` nunca acendia e o scroll-até-a-pendência do `RequiredFieldMarker`, que procura `[aria-invalid="true"]`, era código morto desde que foi escrito; e a mensagem de erro inline existia em ~5 campos por step, escrita à mão.

  O `FormField` compartilhado (`components/forms/fields/FormField.tsx`) liga os três ao path do campo: asterisco vindo do preset via `RequiredFieldsContext` (com índice normalizado — o preset declara em `.0.` e a exigência vale pra toda parte da lista, incluindo o path guarda-chuva que cobre nome/razão social do titular), `aria-invalid` injetado no filho e mensagem inline. **124 campos migrados** em 9 steps das duas esteiras. `NativeSelect`, `UFSelect` e `MoneyInput` aceitavam `aria-invalid` e **descartavam** — passam a repassar.

- **Toast de venda dizia só "etapa 3"** e mandava o cliente caçar o campo numa tela com 20. Agora nomeia até 4 campos e resume o resto, como a locação já fazia — com o vocabulário unificado em `lib/forms/field-labels.ts`, que absorveu o catálogo da tela de configuração e o mapa inline do wizard de locação (a venda não tinha nenhum). **Locação ganha a paridade que faltava**: bolha "N de M pendências" e contagem reativa da etapa, que só a venda tinha.

## [Unreleased] - 2026-08-20 - Recriar proposta enviada

### Adicionado

- **"Recriar proposta"** no detalhe e na linha da lista, para preenchimento errado ou não-recebimento (pedido RE/MAX LCeA): cancela a proposta atual (envelopes ClickSign junto, motivo obrigatório no histórico) e abre `nova?fromId=` com TUDO pré-preenchido via `parseProposalForm` — partes, valores, condições, comissão, signatários, título e responsável (com `PROPOSAL_ASSIGN`). Nos terminais (recusadas/expirada/cancelada) navega direto, sem cancelar de novo. Validade vencida/terminal volta ao default de 7 dias — senão a recriação nasceria expirável no ato. Gate `RECREATABLE_STATUSES` (fonte única UI+predicado): rascunho/aguardando_aprovacao ficam de fora (basta editar), convertida/completa também (desfecho fechado). Quando o proponente já assinou, o diálogo avisa que a assinatura será descartada; documentos anexados NÃO são copiados (avisado no diálogo e no banner do form).
- **Thread de recriação persistida**: a filha nasce com `parentProposalId` + `round` herdado (+1); o pai ganha `supersededById` (última recriação vence) e o botão "Recriar" some dele — o detalhe mostra "Recriação de PROP-X"/"Recriada como PROP-Y" com link (fora do escopo do visitante, o fato aparece sem code nem link: o link levaria ao próprio notFound da página), e a timeline ganha os eventos `superseded_by_recreation`/`recreated_from` (timeline apenas; decisão deliberada de não notificar — quem recria é o próprio corretor, na tela). Campos já existiam no schema desde a modelagem — sem migration.

  Guardas de estado que o review fechou: o POST valida status do pai server-side (só terminal recriável; recriar uma viva por API deixaria duas ativas na thread com envelope rodando na "superada"), o gate da UI é `PROPOSAL_CREATE` puro (com `write` — CREATE **ou** SEND — um SEND-sem-CREATE cancelava a proposta e batia em 403 na criação, executando só a metade destrutiva), e excluir o rascunho-filho limpa o `supersededById` do pai (o campo é escalar sem FK: o ponteiro pendurado escondia "Recriar" pra sempre). A validade **preserva a janela original** recontada de agora — resetar pro default de 7 dias contradizia o "mesmos dados" do diálogo —, o responsável externo (`responsibleName`) é herdado junto e um responsável que saiu da org não é copiado (viraria 400 no submit).
## [Unreleased] - 2026-08-20 - Cadastro de corretores: validação, design system e canais

### Adicionado

- **Importar corretores dos contratos**: o endpoint `uncadastrados` (corretores citados em contratos dos últimos 90 dias sem cadastro) ganhou UI — diálogo com seleção múltipla na tela `/corretores`. Dados raspados de formulário são saneados antes do POST estrito; doc com dígito verificador inválido não é selecionável (evitaria loop de 422) e aponta pro cadastro manual.
- **Pedir dados por WhatsApp**: o magic link de completar cadastro (`request-completion`) aceita `{channels}` e envia também pelo agente de WhatsApp do tenant (Newton/Max), com gate de `notifyOptOut` e janela 7h–22h do Newton. Resposta reporta o resultado POR CANAL; `ok=false` (e audit `FAILURE`) quando nada foi enviado — os três call-sites de UI mostram o desfecho real em vez do "Email enviado" incondicional.
- **Bulk-import completo**: o CSV aceita `phone`, `creci`, `papel`, `tipoPessoa` e flags de notificação — o import em massa não nasce mais incompleto.

### Corrigido

- **Validação e formato canônico de contato do corretor** nos 5 pontos de escrita (POST/PATCH admin, registry do form público/finalize, bulk-import): CPF/CNPJ com dígito verificador, CRECI por formato, email lowercase e **telefone gravado em E.164 via `normalizeBrPhone`** — o mesmo normalizador que o Max (`broker-scope`), o notify-trigger e o deal-events usam na leitura; formato livre no banco fazia o Max não reconhecer corretor. PATCH ganhou dedupe por documento (editar rascunho pro doc de corretor existente criava duplicata silenciosa) e valida apenas campos ALTERADOS — registros legados gravados soft continuam editáveis. Backfill `backfill-split-recipient-contacts.ts` normaliza os existentes (colisão no universo do Max reporta e não sobrescreve).
- **Tela `/corretores` no design system**: monólito de 927 linhas explodido em `components/corretores/` com RHF+Zod espelhando o server, tokens/Tooltip no lugar de cores hardcoded e `title=`, combobox compartilhado substituindo as 3 buscas duplicadas (form público usa o endpoint token-scoped; browse-all ao abrir), e lente por entitlement: com a pagadoria desligada, pendência de PIX não alarma (badge neutra) — a chave PIX segue disponível na criação (sem ela o registro nasceria rascunho sem caminho de ativação). "Desativar" agora também silencia notificações (`notifyOptOut`) — o diálogo prometia isso e o resolvedor continuava notificando rascunhos.
- **Doc mascarado não vaza mais pro contrato**: selecionar corretor cadastrado no form público persistia o documento MASCARADO (`390***05`) em `dataJson` — envenenava ClickSign, DIMOB e a qualificação. O vínculo é `splitRecipientId`; o campo fica pra preencher.
- **Menu "Corretores" com gate de permissão** (`SPLIT_VIEW`/`SPLIT_CONFIGURE`): o papel `sales` via o item e batia num 403 da API.

## [Unreleased] - 2026-08-20 - Cancelamento externo da 1ª via libera a proposta

### Corrigido

- **Proposta cujo envelope foi cancelado DIRETO na ClickSign ficava presa até expirar** — a limitação registrada em 19/08 ("1ª via cancelada FORA da plataforma continua presa"), agora fechada por decisão de produto. O webhook separa `cancel` de `deadline` (os dois já chegavam distintos em `payload.event.name`; a fusão era só fall-through do `case`): cancelamento externo faz o MESMO CAS pra `falha_envio` do cancelamento pela UI, e expiração continua com o cron de expire — liberar no `deadline` tiraria a proposta de `EXPIRABLE_STATUSES` e ela nunca mais seria marcada `expirada`.

  A API do hook trocou `opts.appInitiated?` por um **`cause` posicional obrigatório** (`app | external_cancel | deadline | unknown`): a omissão silenciosa era exatamente o bug — o webhook chamava sem opts e caía no no-op. Obrigatório, esquecer vira erro de compilação.

  **Sino novo `send_canceled`** só no cancelamento externo — o fato nasceu fora da vista do corretor; sem o aviso ele seguia achando "aguardando assinatura". Cancelamento pela própria UI continua mudo (seria eco). Kind próprio em vez de reusar `vendedor_send_failed`: o `title` viaja fixo no WhatsApp e mentiria "2ª via". Dedupe por envelope; emitido depois do CAS e só quando ele moveu (replay não re-toca).

  **A reconciliação aprende a causa pelo feed `/events`** (mesmos nomes de evento do webhook) — o sync é o caminho de recuperação de webhook perdido, e sem isso um envelope cancelado externamente cujo webhook se perdeu ficaria preso pra sempre. Fallback `unknown` = comportamento anterior: se a API não expuser os eventos no feed, a mudança nunca piora nada.

  O evento gravado continua `primeira_via_canceled` (com `source: "clicksign"` e a causa no payload) — badge âmbar "Envio cancelado" e o chip de filtro discriminam só pelo `eventName`, então funcionam sem nenhuma mudança de UI.

## [Unreleased] - 2026-08-20 - Cancelar o envelope não é "Falha no envio"

Três defeitos achados no smoke de staging — e, na sequência, um chip próprio de filtro nascido da mesma distinção —, todos consequência de o mesmo status `falha_envio` ter passado a cobrir duas situações diferentes desde que cancelar o envelope devolve a 1ª via para reenvio.

### Adicionado

- **Chip "Envio cancelado" no filtro da lista** (decisão de produto, opção 3): a `falha_envio` cujo último desfecho foi cancelamento sai de "Rascunho / falha" e ganha chip próprio — os dois wheres são o mesmo predicado (`sendCanceledWhere`) afirmado e negado, então toda `falha_envio` cai em exatamente um dos dois, por construção. O discriminador é o do **badge** (último evento de desfecho), não `sentAt`: um chip por `sentAt` mostraria uma falha real de reenvio sob "Envio cancelado" — o erro que este mesmo lote matou no badge. Como o Prisma não expressa "último evento é X", o where é a aproximação conservadora "existe cancelamento e não existe falha": sob o invariante de CAS ela é exata, e se os dois desfechos um dia coexistirem o único erro possível é o chip omitir — nunca mostrar falha real como cancelamento. Há teste avaliando where e badge sobre os mesmos históricos, incluindo a divergência documentada.

### Corrigido

- **Coluna "Envio" passa a mostrar só o canal do PROPONENTE** (decisão de produto): a via reduzida do proprietário sai da conta — proponente por e-mail + proprietário por WhatsApp não vira mais "E-mail e WhatsApp". Filtro com `OR` por causa do `via` nullable em envelopes antigos.

- **O botão "Excluir" reaparecia e a API sempre recusava.** A UI decidia por `status` (`falha_envio` está em `DELETABLE_STATUSES`) e o servidor por `sentAt` — o guard que impede apagar proposta que o cliente já viu. Resultado: menu oferecia "Excluir", o usuário confirmava, e vinha 409. Mesmo padrão de botão morto que o guard de renomear/editar fechou.

- **O diálogo de confirmação não fechava quando a ação falhava.** `setDialog(null)` só existia no caminho de sucesso, então a pessoa lia o toast "não pode" com o "Confirmar" ainda na tela, parecendo travada. Agora fecha também no erro, nos dois componentes de ação (lista e detalhe). O texto do motivo **não** é limpo — reabrir traz o que já tinha sido escrito. Vale além do caso acima: o 409 continua alcançável por proposta já convertida e por corrida com outra aba.

- **O badge dizia "Falha no envio", em vermelho, para quem cancelou de propósito.** Culpar o sistema por um ato do corretor gasta a credibilidade do vermelho para quando houver falha real. Passa a "Envio cancelado" em âmbar quando o envio efetivamente saiu. Só rótulo e cor mudam: o *bucket* continua "sua vez" nos dois casos, porque em ambos a bola é do corretor — reenviar ou arquivar.

- **A timeline mostrava o nome técnico cru** de `envelope_canceled` e `primeira_via_canceled`: nenhum dos dois tinha entrada em `EVENT_LABEL`, justamente nos eventos que explicam por que a proposta "voltou".

### Como — são DUAS perguntas, não uma

A tentação (e o primeiro desenho desta correção) é usar `sentAt` para tudo. Ele responde bem a **uma** das perguntas e é falso para a outra:

- **Exclusão — "esta proposta já circulou alguma vez?"** → `sentAt`, e é exato, porque ele nunca é zerado. É a pergunta certa: documento que chegou ao cliente não se apaga, tenha a queda atual vindo de cancelamento ou de falha. (`isFalhaEnvioAlreadyDelivered`, consumido pelo guard do DELETE e pelos dois botões Excluir — há teste amarrando a paridade, não só comentário.)

- **Rótulo — "por que ela está em `falha_envio` AGORA?"** → `sentAt` **não** responde. Justamente por ser monotônico, proposta que saiu uma vez o carrega para sempre: `enviar → cancelar → reenviar → o reenvio falha de verdade` mostraria "Envio cancelado" numa falha real — e esse é o fluxo que a distinção existe para servir. Quem responde é o **último evento de desfecho** (`primeira_via_canceled` × `send_failed`), que é durável e sobrevive a reenvios. (`lastSendOutcomeIsCancel`.)

Para isso, `releaseClaim` passou a gravar `send_failed` — antes o caminho de falha real não deixava rastro nenhum, e era essa ausência que tornava as duas origens indistinguíveis depois do primeiro envio.

**Sem backfill**: cancelamento sempre gravou `primeira_via_canceled` e falha nunca gravou nada, então `null` cai em "falha" e o acervo já classifica certo.

A leitura filtra por `SEND_OUTCOME_EVENTS` em vez de pegar o último evento de qualquer tipo — senão um `assignee_changed` posterior deslocaria a resposta. Na lista é uma consulta agrupada (`take: 1` em relação aninhada), não N+1; no detalhe é uma consulta própria, porque o array de eventos da página é `take: 50` e uma proposta conversada empurraria o desfecho para fora da janela.

`proposalStatusView` ganhou o desfecho como parâmetro **obrigatório** (aceita `null`), como `proposalSendChannel`: opcional, um chamador novo mostraria o vermelho errado sem erro de compilação. `falha_envio` continua em `DELETABLE_STATUSES` — o predicado recorta só a subpopulação que circulou.

### Em aberto

- **O chip de filtro "Rascunho / falha" ficou incompleto** (não errado — falha real continua ali). Mover o recorte para um chip próprio é decisão de produto, e exigiria `requiresServer: true`, porque a condição depende de `sentAt` e não se expressa só por lista de status. Documentado no código.
- Os conjuntos `OPEN_STATUSES`, `REMINDABLE_STATUSES` e `CONVERT_UNSIGNED_STATUSES` seguem sem distinguir as duas origens de `falha_envio`.

## [Unreleased] - 2026-08-19 - O gate humano de master só valia para PR vindo de staging

### Corrigido

- **O gate humano de `master` era pulado em todo PR que não viesse de `staging`** — e job pulado conta como **sucesso** para a branch protection do GitHub. O `if: github.head_ref == 'staging'` existia para não exigir o smoke de homologação num hotfix, mas desligava o job inteiro em vez de trocar a exigência: o fluxo `hotfix/critical → master` documentado em `docs/staging-workflow.md` entrava em produção sem nenhuma aprovação manual. O guarda da porta era exatamente o que abria a porta.

  O `if:` saiu. O gate passa a valer para todos, mudando apenas QUAL label o satisfaz: origem `staging` exige `staging-smoke-passed` (o smoke de homologação), qualquer outra origem exige `hotfix-sem-smoke` (label novo, criado no repo).

  As duas exigências são **disjuntas de propósito**: `hotfix-sem-smoke` não satisfaz um PR vindo de `staging`. Se satisfizesse, viraria um bypass do smoke no fluxo de todo dia, que é justamente o que o gate existe para impedir.

  Junto: a checagem passou de `grep -q` (substring) para `grep -qx` (linha inteira). Um label chamado `nao-staging-smoke-passed-x` satisfazia o gate antigo.

  **A validação nunca esteve descoberta** — `ci.yml` roda `prisma validate` + `typecheck` + `vitest` em todo PR com base `master`, sem `if:`, e sempre rodou. `promote-to-prod.yml` tinha um job `validate` idêntico ao dele (mesmos env, mesmos steps), que foi **removido**: dobrava o tempo de CI de cada PR sem acrescentar sinal. O workflow fica sendo só o gate humano, que é o que ele de fato protege.

  Fica de fora, e depende de branch protection: os workflows só disparam em `pull_request`, então push direto em `master` continua sem passar por gate algum.

## [Unreleased] - 2026-08-19 - Papel de leitura escrevia em proposta; coluna "Envio" mentia depois de cancelar o envelope

### Segurança

- **`viewer` editava e renomeava qualquer proposta da org.** `loadScopedProposal` resolve ESCOPO (quem enxerga a proposta) e libera todo mundo que tem `PROPOSAL_VIEW_ALL` — que é exatamente o recorte do preset `viewer`, o papel explicitamente somente-leitura. Duas rotas de escrita confiavam só nisso e não checavam permissão nenhuma:
  - `PATCH /api/proposals/[id]/title` — renomeava qualquer proposta não terminal.
  - `PATCH /api/proposals/[id]` — o buraco largo: reescrevia o `dataJson` inteiro, trocava `validUntil`/`comissaoIncluida`/`hiddenPaths` e **substituía a lista de signatários** de qualquer proposta pré-envio. Era incoerente com as próprias rotas irmãs: `/signers`, `/signers/[signerId]` e `/attachments`, que fazem essas mesmas escritas em pedaços, já exigiam `PROPOSAL_SEND`; só o PATCH monolítico, que faz tudo de uma vez, não exigia nada.

  As duas passam a exigir `PROPOSAL_CREATE` **ou** `PROPOSAL_SEND` (não existe `PROPOSAL_UPDATE`; o corte é quem produz a proposta). Fechar o PATCH é aplicar a convenção que já existia no resto da família, não criar regra nova.

  A UI foi gateada em lockstep, porque botão que só falha no salvar é pior que botão ausente: `ProposalPermissions` ganhou `write` (nome pelo que a permissão É, não pelo botão que ela habilita), usado em "Renomear", em "Editar proposta" e na página `/pipeline/propostas/[id]/editar` — que gateava só por escopo e servia o formulário inteiro, preenchido, para quem o PATCH agora recusa. O doc-comment dela dizia "o guard de verdade está lá", apontando para um PATCH que não tinha guard.

  Os testes varrem **todos** os `ROLE_PRESETS` em vez de fixar `viewer`: o que abre o buraco é a FORMA da permissão (`VIEW_ALL` sem `CREATE`/`SEND`), não o rótulo, e um preset novo de auditoria ou portal cairia nele em silêncio.

  Consequência conhecida: o preset `gerente` tem `PROPOSAL_VIEW_OWN_ONLY` sem `CREATE`/`SEND`, então um gerente atribuído como responsável perde a edição via PATCH. É coerência, não perda — ele já não podia editar signatário, anexar arquivo nem enviar, então nenhum fluxo de edição fechava para ele de qualquer maneira.

### Corrigido

- **A coluna "Envio" voltava a dizer "ainda não enviada" depois que o envelope era cancelado.** A subquery da lista filtrava `status: { notIn: ["failed", "canceled"] }`, então uma proposta enviada cujo envelope foi depois cancelado perdia os `EnvelopeSigner` e a célula caía no plano, esmaecida, afirmando "canal previsto" sobre uma proposta que o cliente recebeu. Ficou visível agora porque cancelar o envelope passou a ser um caminho normal (devolve a 1ª via para reenvio).

  O filtro passou a `not: "failed"`, e `proposalSendChannel` ganhou `proposalSentAt` como discriminador de `resolved`. Tratar todo `canceled` como executado seria o mesmo bug invertido: um envelope que morreu em `draft` nunca notificou ninguém, e a célula afirmaria um canal usado num envio que não houve. `Envelope.sentAt` não serve — nasce preenchido junto com o rascunho, em `executor.ts`, com `status: "draft"`. O `sentAt` da **proposta** é gravado como último passo dos dois caminhos felizes de envio.

  O parâmetro é **obrigatório** (aceita `null`) de propósito: opcional, um chamador novo que esquecesse de passá-lo veria os signatários do envelope ignorados em silêncio e a coluna voltaria a mentir, sem erro de compilação.

### Em aberto

- **A coluna "Envio" soma as duas vias.** O chamador passa os signatários da via `completa` (proponente) e da `reduzida` (proprietário) juntos — ambas têm `source: "proposal"`. Proponente por e-mail e proprietário por WhatsApp viram "E-mail e WhatsApp". É defensável lendo a coluna como "por onde a proposta saiu" e enganoso lendo como "por onde o proponente recebeu". Comportamento anterior a esta correção, mantido: escolher um dos dois é decisão de produto, não conserto de bug. Documentado em `send-channel.ts` com a forma correta do filtro (`via` é nullable em envelopes antigos).
- **A mudança na cláusula Prisma não tem teste.** Os testes novos fixam a lógica de `proposalSendChannel`, que é pura; o `where` em si e a fusão de múltiplos envelopes só seriam alcançados por teste de integração com banco.

## [Unreleased] - 2026-08-19 - Modelo em rascunho para de ser chamado de arquivado

### Corrigido

- **Escolher um modelo em RASCUNHO na geração de contrato dizia "Esse modelo está arquivado"** (achado no smoke de staging da promoção). Rascunho e arquivado levam o operador a lugares diferentes: rascunho é um modelo em revisão, listado na aba **Ativos**, e mandá-lo procurar em "Arquivados" era conselho errado. Viraram motivos separados (`draft` / `archived`), cada um com sua mensagem.

## [Unreleased] - 2026-08-19 - Cancelar o envelope da proposta não prende mais a proposta

### Corrigido

- **Cancelar o envelope deixava a proposta órfã**: o `DELETE /api/proposals/[id]/envelopes/[envelopeId]` cancelava na ClickSign e registrava o evento, mas nunca tocava em `Proposal.status`. A proposta seguia em `enviada`/`entregue`/`visualizada` com o envelope morto — a tela dizia "aguardando assinatura" para sempre, o polling nunca avançava, `/send` recusava ("já foi enviada"), editar era proibido (`EDITABLE_STATUSES`) e as únicas saídas eram o cancelamento TERMINAL da proposta ou esperar o prazo vencer para cair em `expirada`. Exatamente o caminho de quem cancela para corrigir o e-mail de um signatário e reenviar. Agora a rota propaga via `onProposalEnvelopeCanceled(id, { appInitiated: true })`, que devolve a proposta a `falha_envio` — balde já existente de "envio não vingou, reenvie", que está tanto em `EDITABLE_STATUSES` quanto no claim de `executeProposalSend`, então edição e reenvio voltam sem alargar nenhum dos dois conjuntos (o doc-comment do set exige que eles não divirjam). A aresta `enviada|entregue|visualizada → falha_envio` é exclusiva do hook e usa CAS local, como já fazia a aresta da 2ª via: fora da 1ª via em curso o CAS não move nada, porque `assinada_proponente`/`aguardando_vendedor` já têm reenvio próprio e terminal é registro histórico. Sem sino — quem cancelou foi o corretor, na própria UI.
- **O retorno idempotente pulava a propagação**: `if (envelope.status === "canceled") return { alreadyCanceled: true }` saía ANTES de tocar no status da proposta, então uma segunda chamada nunca corrigia uma propagação que falhou na primeira (ela é best-effort e engole o erro — o envelope já morreu na ClickSign e não dá pra desfazer). O hook é CAS e idempotente, então roda nos dois caminhos.
- **Exclusão bloqueada para proposta que já circulou**: `falha_envio` continua em `DELETABLE_STATUSES` — para o caso histórico, envio que nunca saiu e que ninguém viu, apagar é o desfecho certo. Mas o mesmo status agora também é alcançado por proposta que o cliente recebeu e abriu, e apagar essa cascatearia `ProposalEvent`, envelopes e signatários, destruindo o registro de um documento que circulou. `DELETE /api/proposals/[id]` passa a recusar (409, "cancele para manter o histórico") quando o status é `falha_envio` **e** há `sentAt` — os dois caminhos felizes de envio gravam `sentAt` como último passo, então ele é o discriminador exato entre as duas populações.
- **`falha_envio` entrou em `CANCELLABLE_STATUSES` e em `ALLOWED_FROM.cancelada`**: sem isso a correção tirava uma saída que existia. Antes ficava de fora porque só se chegava lá por claim de envio que nunca saiu — proposta que ninguém viu, cujo desfecho natural é excluir. Agora `falha_envio` também cobre proposta REALMENTE enviada, que o cliente viu; se o negócio morre, o corretor precisa ARQUIVAR. Sem a mudança, cancelar o envelope escondia o botão "Cancelar proposta" que existia em `enviada` e a única saída terminal virava APAGAR o registro.
- **`appInitiated` (nome final da flag) também cala o sino da 2ª via**: como o DELETE nunca chamava este hook antes, cancelar um envelope de via reduzida pelo botão passou a cair no ramo pré-existente e dispararia o sino "A via do proprietário foi cancelada ou expirou na ClickSign" — evento externo que não houve, e eco da ação do próprio corretor. A devolução à parada de decisão continua acontecendo; só a notificação é suprimida, e o `ProposalEvent` sai com `source: "api"` em vez de `"clicksign"`.
- **`appInitiated` é opt-in de propósito**: só o DELETE passa a flag. O webhook `cancel`/`deadline`, cujo cancelamento nasce fora da plataforma, mantém o comportamento anterior (no-op na 1ª via, cron de expire trata) — a decisão original segue valendo para o caso em que não sabemos a intenção de quem cancelou. E o handler do webhook cobre `cancel` E `deadline` no mesmo ramo: liberar para reenvio ali atropelaria a semântica de expiração.
- **A reconciliação registrava recusa que não houve**: `syncEnvelopeState` tratava `remoteStatus === "canceled"` como recusa (`refusedNewly || remoteStatus === "canceled"` → `onProposalEnvelopeRefused`). Cancelar o envelope direto na ClickSign fazia a proposta virar `recusada_proponente` — **terminal**, com `refusedAt`/`refusedBy` persistidos e sino de "proposta recusada" para o corretor. Ninguém tinha recusado. Pior que o limbo, porque grava uma afirmação falsa no histórico e é irreversível. Os dois caminhos do mesmo fato também discordavam entre si: o webhook `cancel` chamava `onProposalEnvelopeCanceled`, a reconciliação chamava `onProposalEnvelopeRefused`. Agora o discriminador é `refusedRemotely` — existe signatário com `refusedAt` no remoto —, não o status do envelope: a ClickSign marca `canceled` **nos dois** desfechos, então o status sozinho nunca respondeu à pergunta. Recusa continua sendo recusa (inclusive com o envelope ainda `running`, quando um de vários signatários recusa, e inclusive numa reconciliação posterior em que a recusa já estava gravada localmente — por isso o discriminador é `refusedRemotely` e não `refusedNewly`); cancelamento sem recusa passa a cair em `onProposalEnvelopeCanceled`, que devolve a 2ª via à parada de decisão e não mexe na 1ª.

### Limitações conhecidas (não corrigidas aqui)

- **1ª via cancelada FORA da plataforma continua presa até expirar.** O release só acontece pelo cancelamento feito na nossa UI. Pela tela não há como acionar o caminho de reparo depois: `EnvelopeCard` esconde "Cancelar envelope" assim que o envelope vira `canceled` (`canEdit` = `draft | running`), e o passo de claim órfão do cron exige `sentAt: null`, então não resgata proposta realmente enviada. Fechar isso exige decidir se o webhook `cancel` (distinguindo-o de `deadline`, que hoje divide o mesmo ramo) também deve liberar a 1ª via.
- **A supressão do sino na 2ª via é best-effort, não garantida.** `cancelEnvelopeFlow` cancela na ClickSign, que dispara o webhook `cancel`. Se ele for processado antes da propagação da rota, `webhook-process` chama o hook SEM a flag, ganha o CAS e emite exatamente a notificação que se queria evitar; a chamada da rota chega depois e vê `count === 0`. Corrida inerente a ter dois produtores do mesmo fato.
- **`falha_envio` muda o enquadramento da proposta na UI.** Não está em `OPEN_STATUSES`, `REMINDABLE_STATUSES` nem `CONVERT_UNSIGNED_STATUSES`, e `list-filters` a arquiva sob "Rascunho / falha". Quem cancela o envelope só para corrigir o e-mail de um signatário vê a proposta sair dos KPIs de "em aberto" e reaparecer com cara de rascunho, além de perder o "Converter em negócio sem assinatura". É consequência de reusar o balde existente em vez de criar um status novo.

  > **Parcialmente corrigido em 2026-08-20** (ver seção "Cancelar o envelope não é 'Falha no envio'"): o badge vermelho e o botão Excluir morto foram resolvidos. O que PERMANECE desta limitação é o enquadramento em conjuntos: `OPEN_STATUSES`, `REMINDABLE_STATUSES`, `CONVERT_UNSIGNED_STATUSES` e o chip "Rascunho / falha" seguem sem distinguir as duas origens.

## [Unreleased] - 2026-08-19 - Escolher o modelo do contrato à mão

### Adicionado

- **Escolha manual de modelo na geração do contrato.** O pareamento automático só sabe decidir com FATOS do formulário — garantia, PF/PJ, administração. Quando o que distingue dois modelos não está no formulário ("este é o de curta temporada"), o modelo empata com o genérico, perde o desempate pro `isDefault` e fica **inalcançável**: até aqui não havia nenhuma forma de usá-lo, nem por UI nem por API (`Contract.templateOverride`, apesar do nome, guarda o *source* Handlebars e nunca foi escrito por ninguém). Agora `POST generate-contract` (sessão e o gêmeo bearer) aceita `templateId` opcional, e as telas de negócio ganham "Escolher outro modelo" ao lado do botão de gerar.

  Caminho secundário de propósito: o botão principal continua no automático, que acerta na esmagadora maioria — cada escolha manual é uma chance de errar o contrato. Sem `templateId` nada muda, e os dois call-sites de formulário público nem mudaram de assinatura.

  Três travas: `templateId` inválido responde **400 e não gera nada** (cair no automático depois de o operador ter escolhido outro modelo seria a troca silenciosa que este produto não pode fazer); o **contrato de administração de locação é recusado** para o contrato do inquilino — é família "locacao" mas outro instrumento, entre imobiliária e proprietário, e geraria um documento que não vincula quem assina; e o `GET template-choices` que alimenta o diálogo usa o **mesmo gate e a mesma regra de elegibilidade** do POST, então a UI nunca oferece o que a rota vai recusar. A escolha entra no metadata do audit — "por que este contrato saiu com aquele modelo" só se responde depois se ficar registrado.

- **Modalidade `temporada` (short stay)**: o contrato de curta temporada é outro contrato (diária, sem vínculo de moradia, sem garantia locatícia clássica) e vinha sendo cadastrado como locação residencial comum, disputando o padrão da modalidade. Nome sem o prefixo `locacao` — igual a `administracao_locacao` — para ficar fora do fallback `startsWith("locacao")` e nunca ser servido por acidente a uma locação comum; há teste negativo travando isso. Como nenhum campo do formulário declara "isto é uma temporada", ela é alcançada pela escolha manual acima, e reusa o schema residencial (os campos de temporada ficam em `[colchetes]` no próprio modelo).

## [Unreleased] - 2026-08-19 - Administração pela imobiliária vira eixo de pareamento

### Adicionado

- **Eixo `admImobiliaria` no `matchCriteria`** (4º eixo, ao lado de garantia, fiador PF/PJ e locatário PF/PJ): quando a imobiliária tem um modelo próprio para imóvel administrado, a esteira passa a escolher sozinha lendo `aluguel.adm_imobiliaria` do formulário — que o form já grava desde 2026-08. Caso concreto: a RE/MAX Trio tem "Locação Residencial (Trio)" e "Locação Residencial — Administração (Trio)" na mesma modalidade e o operador escolhia à mão. Disponível na Central de ingestão (só no tipo "contrato de locação" — a proposta não coleta o dado) e no editor de template.

  Três cuidados que o eixo booleano exigiu e que os eixos de enum não tinham: o scoring passou a testar `wanted == null` em vez de truthiness (sob `!wanted`, o critério `false` — "modelo para imóvel SEM administração" — era silenciosamente ignorado, e o modelo de administração empatava com o comum em toda locação); `deriveTemplateFacts` mapeia a ausência do campo para `null` e nunca para `false`, senão todo form antigo e toda proposta desclassificariam o modelo de administração; e a coerção `"true"`/`"false"` → boolean vive num `z.preprocess` dentro do próprio `matchCriteriaSchema`, cobrindo de uma vez as três rotas que o consomem, em vez de um call-site por vez (`"false"` é uma string truthy — coerção esquecida em qualquer boundary viraria `true`).

## [Unreleased] - 2026-08-19 - Slot de garantia: o relatório para de mentir

### Corrigido

Três bugs encadeados da ingestão DOCX→template, todos com o mesmo desfecho silencioso: o modelo **declara** um `{{slot_garantia}}` que não está no Google Doc, a cláusula resolvida é descartada na geração e o contrato sai com a garantia da variante de referência **chumbada** — o cliente escolhe caução no formulário e assina fiador. Os três foram vividos montando a biblioteca da RE/MAX Trio em produção (19/08), onde os 4 modelos precisaram de conserto manual via Docs API.

- **`applyClauseSlotToDoc` presumia a troca em vez de conferir**: as guardas rodam contra o texto PLANO (`getDocPlainText`, que concatena os `textRun`), mas quem aplica é o `replaceAllText`, que casa contra a estrutura real do Doc. Parágrafo partido em vários runs — herança comum de DOCX com formatação invisível — satisfaz a guarda e muda ZERO ocorrências, e o retorno do batch era descartado: `applied: true` sem nada ter acontecido. Agora o `occurrencesChanged` de cada reply é inspecionado e o doc é RELIDO; `applied: true` só sai quando o token está no documento e nenhum parágrafo do bloco sobrou. Casar em MAIS de um lugar (`over-matched`) também reprova — a guarda de unicidade não enxerga cabeçalho e rodapé, mas o `replaceAllText` edita os dois. Motivos novos no relatório, traduzidos na página de revisão: `replace-noop`, `over-matched`, `verify-failed`, `verify-unavailable` e `token-missing`.
- **O pass de IA apagava o slot**: ele roda DEPOIS do apply, então enxerga o `{{slot_garantia}}` solto no doc e devolvia o trecho ao redor mapeado pro legado `{{clausula_garantia}}` — aconteceu nos 4 modelos da Trio. Guarda determinística passa a descartar qualquer mapeamento cujo `trecho_literal` contenha `{{...}}` (`reason: "already-tokenized"`), o que cobre também os parágrafos que seriam esvaziados num bloco multi-parágrafo. A regra entrou no prompt, mas a trava é o código.
- **A declaração do slot saiu de antes pra depois do pass de IA** em `POST /api/templates/from-docx`, derivada do estado FINAL do documento: slot que não sobrevive não é declarado e é rebaixado no `draftReport`, travando a ativação na página de revisão. Doc ilegível na conferência é fail-closed — não declara e trava a ativação, mas com motivo `verify-unavailable`: "não consegui conferir" não é a mesma afirmação que "conferi e o token não está lá", e um 429 do Drive não pode virar diagnóstico.
- **`validate-gdoc` nunca rebaixava `applied`**: o mapa só subia (false→true), então um `applied: true` gravado por engano era permanente e a revalidação — único ponto que relê o Doc — confirmava a mentira. Agora espelha o Doc nos dois sentidos, sem duplicar issue em slot que já estava falho, e um erro de credencial/rate-limit do Google segue devolvendo 502 sem tocar no relatório. O `update` também passou a ser escopado por `orgId`.

## [Unreleased] - 2026-08-19 - Rotas de negócio voltam a funcionar sob impersonation

### Corrigido

- **Impersonation de tenant nas rotas de deal** (descoberto ao montar a biblioteca de contratos da RE/MAX Trio em prod): as 9 rotas sob `/api/pipeline/deals/[dealId]/**` resolviam identidade com `auth()` cru e passavam `session.user.id` pro RBAC. Como o super_admin "testando como" um tenant NÃO tem `OrgMembership` na org impersonada, `getEffectivePermissions` voltava `null` e **toda** operação de negócio respondia 404/403 — abrir, editar, apagar, arquivar, gerar contrato, marcar assinado/perdido/comissão paga e reabrir. Migradas pro `requireAuth` (`lib/auth/context.ts`), que já sobrepõe a identidade: `ctx.userId` é o dono do tenant (quem resolve membership/RBAC e assina o que for criado) e o admin real fica em `ctx.impersonatedByUserId`, carimbado em todo `AuditLog` por `audit()` (`metadata.impersonatedBy`). Sem mudança de comportamento fora de impersonation; Bearer continua barrado (rota session-only, sem `scope`).

## [Unreleased] - 2026-08-19 - Propostas: código sequencial, título editável, canal de envio e gestão de assinaturas

### Adicionado

- **Código sequencial por proposta** (`Proposal.code`, formato `PROP-<ano BRT>-<seq 4>`): contador atômico por `(org, ano)` na nova tabela `OrgSequence`, alocado dentro da transação do create (`INSERT … ON CONFLICT DO UPDATE … RETURNING` — `MAX+1` teria corrida entre dois creates simultâneos, e o rollback devolve o número em vez de abrir buraco na sequência). Substitui o `id.slice(-8)` que servia de "número" em 8 pontos (assunto de e-mail `{{numero}}`, comprovante de aceite, landing `/p/[token]`, contexto Handlebars `numero_proposta`), agora todos atrás de `proposalNumero()`. Migration faz backfill de todas as propostas por ordem de `createdAt` e semeia o contador; o ano sai do fuso de São Paulo (`AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'`) — em UTC a virada aconteceria 3h cedo em 31/12.
- **Título editável**: campo "Título da proposta" na criação/edição (em branco cai no derivado "proponente — imóvel", agora `derivedProposalTitle`) e renomeação por `PATCH /api/proposals/[id]/title`, com diálogo na lista (menu da linha) e no detalhe (lápis). A rota é separada do PATCH de conteúdo de propósito: título é rótulo interno, então vale além de `EDITABLE_STATUSES` e só barra os terminais, com claim atômico contra a corrida com webhook/cron. Audit `PROPOSAL_RENAME` + evento `renamed`.
- **Coluna "Envio"** na lista de propostas (WhatsApp/E-mail/Misto), resolvida no servidor por `proposalSendChannel`: o canal do `EnvelopeSigner` vence o do plano porque `decideInstrument` rebaixa WhatsApp→e-mail conforme a capacidade da conta ClickSign — mostrar o pedido afirmaria um canal que ninguém usou.
- **Gestão de assinaturas dentro da proposta**, equivalente à aba dos contratos: `EnvelopeCard` saiu de `pipeline/SignaturesTab` para `components/signatures/` (já era genérico sobre `basePath`) e ganhou a família `/api/proposals/[id]/envelopes/*` — listar, editar nome/prazo, cancelar envelope, adicionar/reenviar/editar/remover signatário, além do botão Atualizar ligado ao `/sync` que existia e nenhuma UI chamava. Escopo por `loadScopedProposal` e permissões do vocabulário de proposta (`PROPOSAL_SEND`/`RESEND`/`CANCEL`), não `ENVELOPE_SEND`.

### Corrigido

- **Botão do catálogo iList (RE/MAX) aparecia para todos os tenants** no formulário de proposta: era o único ponto do produto sem o gate `getIListConnection(orgId)`, então uma org sem conexão (Newcore) via a porta e caía num diálogo "integração não habilitada". As rotas `/api/ilist/*` já eram fail-closed — o vazamento era só de UI.
- **`EnvelopeSignerRow.email` tipado como `string`** enquanto `EnvelopeSigner.email` é nullable no schema *por causa das propostas* (signatário proprietário costuma vir de `PropertyOwner`, sem e-mail e com WhatsApp como canal). O tipo mentia e o `EditSignerDialog` passava `null` a um input controlado; a linha do signatário agora cai pro telefone em vez de renderizar vazio.
- **Placeholder `{{imovel}}`** do e-mail da proposta era extraído fatiando o título no `" — "`, o que só valia enquanto o título era sempre derivado. Passa a vir resolvido do `dataJson` — senão um título livre entregaria um pedaço arbitrário do texto do corretor como endereço do imóvel.
- **Filtros da lista de propostas**: a busca era `flex-1` entre o seletor Vendas/Locação e dois `<select>` crus, então esticava e deixava a barra com cara de centralizada. Passa a ter largura fixa, com os filtros empurrados pra direita (`ml-auto`), `Select` do design system no lugar dos selects artesanais, botão de limpar dentro do campo e `role="group"`/`aria-pressed` no segmentado.
- **Coluna "Proponente" da lista mostrava o título**, não o proponente — os dois eram a mesma string enquanto o título era derivado. Agora são colunas distintas, com **Título** (mais o código) antes de **Proponente** (mais o imóvel).
- **Página do dashboard rolava na horizontal quando a tabela era larga** (`min-w-0` no `SidebarInset`): o `<main>` ao lado da sidebar é item flex e, com o `min-width: auto` padrão do flexbox, não encolhia abaixo do min-content do conteúdo. Uma tabela larga esticava o item e quem rolava era a PÁGINA — breadcrumb e KPIs saíam de posição — em vez de rolar dentro do `overflow-x-auto` da própria tabela. Medido no QA de staging: 98px de estouro em viewport de 1505px (`/pipeline/propostas` depois da coluna Envio); com o `min-w-0` o documento volta a 1505 e a tabela rola dentro do cartão. Vale pra toda tabela larga do dashboard, não só propostas.

## [Unreleased] - 2026-08-19 - Guard anti-clobber dos templates de tenant

### Corrigido

- **`sync-templates.ts` não sobrescreve mais template de TENANT** (incidente 2026-08-18/19): o sync atualizava toda row `ContractTemplate` handlebars ativa da modalidade — em todas as orgs, sem olhar o dono — e um `--apply` de rotina clobberou os templates próprios da Newcore e da RE/MAX Ativa (staging e prod) com o source canônico. Guard com duas pernas em `isTenantManagedRow` (`seed-tenant-templates.ts`): marcador `tenant-template: <slug>` na 1ª linha do comentário do `.hbs` (sobrevive a rename na UI) e nome do manifest (cobre row semeada antes do marcador ou já clobberada). Rows restauradas via re-seed nos dois ambientes; dry-run pós-fix: `tenant skipped: 5, would update: 0`.

### Adicionado

- **`seed-tenant-templates.ts --archive-others`**: arquiva (`status="archived"`, `isDefault=false`) as demais rows handlebars ativas da mesma `(org, modalidade)` — um único template ativo por tipo de contrato. Nunca deleta e não toca `engine="google_docs"`. Aplicado na org Newcore (prod e staging Demo); flag opt-in, atrás de `--apply`, não deve entrar em automação.

## [Unreleased] - 2026-08-19 - Breadcrumb não linka segmento sem rota

### Corrigido

- **Breadcrumb do dashboard** (issue #320): crumb intermediário sem `page.tsx` nem redirect renderiza como texto (`role="link"` + `aria-disabled`) em vez de link 404 — casos: `/certidoes`, `/relatorios`, `/settings/pagamentos`, `/settings/seguranca/audit-log/users` e o "Detalhe" sob `/forms`. `/deals` e `/locacao/deals` seguem como links (o redirect do #319 os faz navegar). Whitelist guardada por teste que deriva a verdade do `app/(dashboard)` e subtrai os redirects do `next.config.js`.

## [Unreleased] - 2026-08-19 - Ressalvas de UX do QA de locação (checkboxes e dropdown)

### Corrigido

- **Checkboxes do `StatusDebitosStep` agora persistem** (`tem_debitos`, `debitos.*.selecionado`, `debitos_assumidos.assume`, `regularizacoes.tem`): os `setValue` rodavam sem `{ shouldDirty: true }`, então o campo nunca entrava em `dirtyFields` e o auto-save (que recorta o PATCH pelo escopo sujo, `use-dirty-scope`) o descartava em silêncio — marcado na UI, ausente do dataJson salvo, mesmo quando outro campo disparava o save. Só persistia por acidente se o usuário digitasse na textarea vizinha (o `register` sujava a chave top-level) ou no finalize completo. Mesma classe corrigida nos toggles `tipo_pessoa` (Vendedor/Comprador/_PartyFields/fiador da Garantia), que escapavam pelo mesmo acidente.
- **Dropdown "Novo negócio" não fica mais aberto sobre o modal** (vendas e locação): o `e.preventDefault()` no `onSelect` — posto ali pra impedir que o restore-focus do Radix derrubasse o Dialog controlado — também cancelava o fechamento do menu, que ficava encavalado com o modal (ambos `z-50`). Trocado pelo par canônico: `onSelect` default fecha o menu e `onCloseAutoFocus={(e) => e.preventDefault()}` no `DropdownMenuContent` preserva o Dialog.

## [Unreleased] - 2026-08-19 - Propostas: 2ª via do Aceite sai dos becos sem saída

Seis correções do QA do bloco F2 (issue #314), todas no modo Aceite/2ª via.

### Corrigido

- **Termo do proprietário expirado/cancelado devolve a proposta à decisão** (`acceptance-webhook.ts`): antes era no-op — a proposta ficava presa em `aguardando_vendedor` pra sempre, sem sino e sem reenvio (o caminho de envelope tinha `onProposalEnvelopeCanceled`; o Aceite não tinha equivalente). Agora: CAS de volta a `assinada_proponente` + evento `vendedor_via_canceled` + sino "reenvie ou conclua sem enviar". Aceite de terceiro chegando em proposta MORTA (expirada/cancelada/recusada) deixou de ser engolido em silêncio: evento `acceptance_orphan_after_terminal` + sino — o aceite é juridicamente relevante e o operador precisa vê-lo.
- **Aceite legado destravado** (`sendVendedorAceiteLocked`): "tem `acceptanceClicksignId` ⇒ enviado" tratava termo morto (expired/canceled) e proposta pré-F2 (vendedor com termo da 1ª rodada) como sucesso — 200 "já enviado" sem nada acontecer, escotilha "concluir sem enviar" fechada, cron redisparando pra sempre. Agora: termo morto é reemitido (com trilha `aceite2_term_reissued` do id antigo) e proposta com TODOS os vendedores `completed` é reconciliada direto em `completa` (+ dossiê + sino), destravando o backlog legado sem custo ClickSign.
- **"2ª via falhou" ficou instrument-aware** (`live-vendedor-via.ts`, predicado único para lista, filtro e cron): o cálculo olhava só `Envelope via="reduzida"`, então TODA proposta de Aceite em `aguardando_vendedor` aparecia como falha — e o cron `reconcile` re-selecionava todas, todo dia (churn infinito). O termo de Aceite vivo (`sent`/`completed`) do vendedor agora conta como via enviada; o cron ganhou `orderBy` (fairness no take 50) e a métrica separa `chainedRetried` de `chainedNoop` (contava no-op como reconciliação).
- **Guards no `loadScopedPlanSigner`** (`scoped-signer.ts`): PATCH/DELETE de linha de plano passam a exigir proposta em edição ou na parada de decisão (409 fora disso) e recusam linha com termo de Aceite emitido — apagá-la destruía a prova por-signatário e fazia o webhook cair no fallback `isProponente=true` (recusa do proprietário virava `recusada_proponente`; expiração dele expirava a proposta inteira). EnvelopeSigner fora do escopo agora 404 explícito (sem fallthrough).
- **Fallback de link vinculante apontava pra staging** (`send-execute.ts` ×2, `acceptance-webhook.ts`): `NEXTAUTH_URL ?? "https://staging.imobpro.ia.br"` no termo de Aceite (WhatsApp) e no comprovante durável — os 3 únicos pontos do codebase com fallback de staging. Novo helper `proposalPublicLink` com fallback de PRODUÇÃO e `||` (cobre env var vazia).

### Adicionado

- **Seletor de canal no diálogo "Enviar ao proprietário"** (`EnviarProprietarioDialog`): o cadastro inline do vendedor não expunha `notifyChannel` — contato só-WhatsApp caía em 422 de preflight sem saída pela UI (default do backend = e-mail). Select E-mail/WhatsApp com default derivado do preenchimento; o envio também passa a mostrar `warnings` de rebaixamento (antes descartados) e o desfecho "reconciliada como completa".

## [Unreleased] - 2026-08-18 - Ressalvas de QA pós-promo2 (resumo, FAB, /propostas)

### Corrigido

- **Unique parcial do resumo por negócio** (`DealAttachment_dealId_form_summary_key`, migration `20260818213000` com saneamento de duplicatas ANTES do índice): fecha a corrida create-vs-create de "Baixar PDF" + "Enviar" simultâneos; `persistFormSummaryPdf` trata `P2002` degradando pra update da linha vencedora (e deleta o blob substituído). Índice é parcial (`WHERE source='form_summary'`) — anexos manuais seguem ilimitados; documentado no schema, único writer é o próprio persist.
- **Diálogo do resumo**: "Baixar PDF" mostra "Gerando…" durante a geração (evita clique repetido no ~5-8s de Puppeteer) e "Enviar" fica desabilitado até selecionar destinatário.
- **FAB do assistente IA** não cobre mais o "Salvar identidade" em `/settings/perfil` em viewport estreita (respiro no fim do container).
- **`/propostas` redireciona** para `/pipeline/propostas` (antes 404).

## [Unreleased] - 2026-08-18 - Visibilidade de seções por link de parte, configurável

### Adicionado

- **Card "Seções por link de parte"** em `/settings/formulario` (`ParticipantVisibilityCard`): matriz papel × etapa por esteira (venda/locação) gravada em `OrgFormSettings.participantVisibilityJson` (migration aditiva `20260818190000`), merge por branch e sanitização ANTES de gravar (`parseParticipantVisibilityJson`). Aplica ao vivo em links já emitidos — visibilidade não é obrigatoriedade.
- **Novo módulo `lib/forms/participant-visibility.ts`** — fonte de verdade: catálogo `STEP_PATHS` (etapas habilitáveis × data-paths), `DEFAULT_ROLE_STEPS` e `resolveRoleVisibility`. **Defaults novos (pedido 2026-08-18):** comprador ganha a etapa Pagamento; locador ganha Aluguel e Reajuste; locatário ganha Garantia (e, coerentemente, a atribuição de docs do fiador); vendedor e fiador mantêm o histórico. `resolveParticipantScope` passa a carregar a config da org; `ROLE_PATHS`/`ROLE_STEP_INDEXES` viraram derivados dos defaults (sem segunda cópia); `voice-extract` idem.
- **Guard-rail por construção:** a config só escolhe etapas do catálogo — etapa 6 (Comissão) e as chaves `comissao`/`fiscal`/`testemunhas`/`assinatura`/`config` são inalcançáveis por subtoken, mesmo com Json malicioso no banco (testes em `participant-visibility.test.ts`).

### Alterado

- `requiredPathsForRoleScope`/auto-save/finalize acompanham automaticamente (já eram dirigidos por `stepIndexes`/`topKeys` do scope).

## [Unreleased] - 2026-08-18 - Form de locação: administração, despesas, cláusula rescisória e comissão

### Adicionado

- **Administração e despesas na etapa 4 do form público de locação** (`aluguel.*` em `validation-locacao.ts`, UI no `AluguelStep`): "A locação terá administração pela imobiliária?" (Sim/Não); com "Sim", como os encargos transitam (`encargos_repasse`: paga-e-retém no repasse ou repasse integral no boleto) e a taxa de administração (%); com condomínio, se as contas de consumo são individualizadas ou quais somam no boleto do condomínio (`contas_no_condominio`: água/luz/gás). O finalize exige `encargos_repasse` quando adm=sim e a lista quando não individualizadas. `enrichLocacaoData` materializa `config.*` e — decisão nova — **"Não" explícito impede a nomeação da administradora** no contrato de locação (cláusulas 4.1/9.1.2 caem no fallback direto ao locador); o instrumento de administração re-injeta por conta própria. Templates v3 (residencial+comercial): 9.1.2 ramificada por `encargos_repasse`, 9.3 por individualização (concessionárias ENEL/SABESP/COMGÁS hardcoded viraram texto genérico). Espelho no negócio: `create-lease-contract` já lia `aluguel.taxa_admin_percent` como fallback.
- **Cláusula rescisória opcional** (`config.clausula_rescisoria`, default true; card na etapa Garantia): "Não" omite a cláusula 7.2 (multa por rescisão antecipada) nos dois templates v3 — a 7.1 (multa por infração) permanece, pois 5.4/6.7 a referenciam. Forms antigos inalterados (default no enrich).
- **Etapa "Comissão" no form público de locação** (nova etapa 6, token principal apenas — subtokens não a veem): paridade com venda usando `comissao.taxa_locacao_percent` + `comissao.angariadores[]` já existentes. Lookup "Selecionar cadastrado" reusa `GET/POST /api/forms/[token]/commissioners` (a rota resolve `SalesForm.token` e serve as duas esteiras — sem rota gêmea), com anti-duplicação (`findCommissionerMatch`) e autopreenchimento; auto-cadastro no finalize já cobria `angariadores`.
- **`CadastroRecebimento` compartilhado** (`components/forms/steps/CadastroRecebimento.tsx`, extraído do `ComissaoConfigStep` de venda): título de seção visível e botão outline "Preencher dados bancários" (era ghost text-xs escondido); em cadastro já vinculado, membro ganha **"Pedir dados ao corretor"** — reusa o magic link de completion (`/api/financeiro/split-recipients/[id]/request-completion`), o corretor preenche PIX/banco num link próprio por e-mail. Regra mantida: anônimo nunca envia dado bancário.
- **Propagação:** semântica dos campos novos no prompt do Analista de locação (`prompts-locacao.ts` regra 9), description de `fill_form` no MCP do Newton, 4 FAQs novas de locação no seed de suporte (`seed-faq.ts` — rodar `seed-support-kb.ts --apply` ou o botão em /admin/support-ai), `docs/locacao/spec.md` §4.1. **Deploy exige `sync-templates.ts --apply`** (v3 mudou) e recriação do container MCP na VPS.

## [Unreleased] - 2026-08-18 - Laudo de vistoria externo + seed de pesquisa padrão

### Adicionado

- **Template padrão de pesquisa de satisfação** (`src/lib/surveys/seed.ts` + `scripts/seed-survey-templates.ts`): NPS + CSAT + comentário livre, neutro entre vendas e locação. Script no padrão dry-run/`--apply`/`--orgId=` (dry-run reporta "would create", distinto do apply), alvo = orgs sem nenhum template ativo e com feature de pesquisas ligada; idempotente por `(orgId, name)`; `createdBy` cai no owner da org. Org nova passa a nascer com o template (`api/admin/orgs`, best-effort como os seeds vizinhos).
- **Upload de laudo de vistoria pronto**: vistoria feita fora do sistema entra por PDF (≤20MB) e vai direto a `status="laudo_gerado"` com `Inspection.laudoOrigem="externo"` (migration aditiva `20260818120000`) — elegível pro envelope conjunto com o contrato de locação (`collectInspectionExtraDocuments`) e pro envio avulso; a assinatura conjunta já existia, faltava a porta de entrada. Fluxo em duas rotas no padrão dos anexos: handshake `laudo/blob-upload` (upload client-direct pro Vercel Blob, contorna os ~4.5MB de corpo de função) + registro `laudo/upload` (valida propriedade da URL, magic bytes via `sniffFileType`, update condicional ao status editável — corrida com envio pra assinatura vira 409 — e zera `qrToken` pra o QR do laudo substituído não seguir validando). Botão "Anexar laudo pronto" no `LaudoEditor` (vira "Substituir…" quando já há PDF; "Regerar" sobre laudo externo pede confirmação). Regeração interna volta `laudoOrigem="gerado"`. Audit `INSPECTION_LAUDO_UPLOADED`. `docs/locacao/spec.md` §7 atualizado (falava em `Envelope source="attachment"`; o real é `EnvelopeDocument kind="attachment"`).

## [Unreleased] - 2026-07-30 - Hardening da trava de grupo do Newton

Follow-ups do review do #197, ambos em `apps/mcp-server/src/tools.ts`.

### Alterado

- **`isGroupJid` cobre mais formatos:** além de `<digitos>-group` (convenção da bridge), agora reconhece o sufixo nativo `@g.us` (case-insensitive) e o JID legado com hífen interno (`<criador>-<timestamp>-group`), que escapavam do regex só-dígitos.
- **`normalizeWhatsappTo` é fail-closed:** JID de grupo lança `assertNotGroupTarget` em vez de passar intacto. Os handlers já barram antes, então o ramo é redundante hoje — de propósito, pra que um caller futuro sem o assert falhe em vez de mandar mensagem pro grupo.

## [Unreleased] - 2026-07-25 - Newton calado nos grupos: runtime + tools

Segunda metade da mudança abaixo. A primeira tirou a iniciativa automática do lado
Contractmaker; esta fecha o comportamento do agente em si.

### Adicionado

- **Trava determinística contra envio proativo pra grupo** (`assertNotGroupTarget` em `apps/mcp-server/src/tools.ts`): `whatsapp_send` e `schedule_proactive_message` agora rejeitam JID de grupo (`<id>-group`) com erro. O `normalizeWhatsappTo` deixava passar intacto, então a proibição era 100% prompt — e o modelo ativo é nano-tier. Responder num grupo mencionado continua funcionando: essa resposta volta pelo webhook da bridge, não por essas tools.

### Alterado

- **Persona do agente (fora do repo, via Mission Control → Persona):** `SOUL.md` ganhou a subseção "Escopo de ação em grupo" e perdeu o bullet que autorizava responder sem `@`; `AGENTS.md` ganhou nota de precedência em "Group Chats" e um bloco absoluto em "Red Lines". Registro do que foi gravado, com os backups pra rollback, em `docs/newton-persona-snapshot-2026-07-25.md`.
- **Descrições das tools MCP** (`apps/mcp-server/src/tools.ts`): `whatsapp_send`, `schedule_proactive_message`, `list_newton_requests`, `update_newton_request` e o comentário do bloco Newton Requests mandavam o agente cobrar informação, agendar lembretes e mandar DM ao fechar. Agora dizem o contrário — o inbox é registro interno, envio proativo é só DM e nunca re-cobrança.

### Corrigido na VPS (fora do repo)

- **O relatório em grupo existia, e não era cron do openclaw.** `🗂️ Resumo de propostas — Negócios NC` saía 2×/dia (08:30 e 17:30) do `proposal-tracker.js`, scheduler próprio do sidecar, configurado por env no `.env` de `/docker/openclaw-mvzp/`. Desligado esvaziando `NC_PROP_CHASE_TIMES`; `NC_PROP_GROUP_ID` mantido de propósito, preservando a consulta por `@` com as tools `prop_*`. Junto, `handlePropTool` passou a chamar `ingestGroupDelta` — sem isso a consulta responderia dado congelado, já que o único chamador era o `runChasePass` que não roda mais. Backups `.env.bak-prop-chase-off-*` e `proposal-tracker.js.bak-preingest-*`.
- Crons do openclaw auditados (aba Crons do MC): `morning-briefing` e `stale-deals`, ambos `telegram→` DM do Olavo, sem execução há ~1 mês. Max não tem cron. A aba Crons **não enxerga** os schedulers do sidecar — foi por isso que a primeira auditoria concluiu, erradamente, que não havia relatório em grupo.
- Smoke no sandbox do MC: com a política só no `SOUL.md` o modelo ainda respondia sem `@` e se oferecia pra cobrar diariamente; com o bloco em "Red Lines", parou. O caminho positivo (`create_form`) fica inconclusivo — o sandbox interrompe na 1ª tool call.

### Deploy

- **MCP server na VPS: feito.** `dist/` copiado pra `/docker/openclaw-mvzp/contractmaker-mcp-server/dist/` (backup `dist.bak-groupguard-*`) e container `sidecar` recriado. O boot confirma `connected to https://imobpro.ia.br (81 tools)` — eram 80 antes, ou seja, o MCP da VPS estava atrás do repo e o deploy trouxe também o que já estava em `master` sem ter subido.
- **`doc-collector` desligado**: `WATCH_DOC_COLLECTOR: "1"` → `"0"` em `/docker/openclaw-mvzp/docker-compose.yml` (backup `.bak-doccollector-off-*`). Era o watcher que observava grupos com `group_config.watch_documents=1` e, ao ver documento novo, perguntava na DM da aprovadora. Não postava no grupo, mas era captura passiva — fora do escopo desejado. A linha `[doc-collector] ativo` sumiu do boot.

### Pendente

- **Inbound de WhatsApp está 403** — `turn sem orgId e NEWTON_REQUIRE_ORG_ID=1`. O bridge (`whatsapp-newton-bridge`) não manda `orgId` no forward pro sidecar, enquanto o Contractmaker manda. Correção na branch `fix/forward-orgid` daquele repo; depende de setar `NEWTON_ORG_ID` no projeto Vercel antes do deploy. Enquanto isso, o `@` no grupo não responde nada.
- Validação temporal: 24h com pendência aberta no inbox e nenhuma mensagem no grupo.

## [Unreleased] - 2026-07-25 - Newton para de capturar informação nos grupos

### Removido

- **Cron `/api/cron/newton-requests/sweep`** (horário) — motor de re-cobrança que fazia o Newton voltar ao grupo/contato atrás de informação pendente. Saiu de `vercel.json`, do `KNOWN_CRON_PATHS` de `/api/admin/staging-crons/[path]` e do catálogo da UI de staging-crons. Rota e testes deletados.
- **Disparo imediato em `POST /api/deals/:dealId/newton-requests`** — criar pedido agora só grava a `NewtonRequest`; nenhum turn vai ao sidecar.
- `TriggerArgs.kind: "remind"` e o branch correspondente em `buildText` (só o sweep usava).

### Alterado

- O inbox de pedidos virou **registro interno**: aba do negócio renomeada de "Pedidos ao Newton" pra **"Pendências"**, copy do diálogo e toasts ajustados pra não prometer cobrança automática.
- `triggerNewtonForRequest` fica restrito a dois usos: envio one-shot de pesquisa de satisfação (`lib/surveys/channels.ts`) e `kind:"cancel"` pra derrubar lembretes legados (`NewtonRequest.cronJobIds`).
- Docs: nova seção `docs/newton-integration.md §0` com o escopo atual + efeito colateral nas réguas de locação; `docs/staging-workflow.md` atualizado.

### Mantido de propósito

- `/api/cron/newton-requests/group-match` — só resolve deal↔grupo (`DealGroupLink`), não envia mensagem.
- `notifyDealEvent` e o sweep de `Notification` → WhatsApp: são notificação a corretor/usuário que optou, não captura de dado.

### Pendente (fora deste repo)

- Gate de comportamento no runtime do agente (openclaw na VPS): responder só quando chamado com `@` e limitar a escrita a criação de formulário de negócio. Bloco de política pronto em `docs/newton-escopo-grupos.md`.

## [Unreleased] - 2026-05-16 - Multi-agent orchestrator (F0-F5)

### Adicionado

- **Orquestrador multi-agente** via LangGraph TS — substitui o `streamContractAgent` legacy como caminho principal de chat. 7 nodes (`loadContext`, `router`, `analyst`, `legal`, `editor`, `curator`, `aggregator`) com fanout paralelo para `intent=review` e `propose`. Mantém streaming SSE com formato `AgentEvent` compatível com front-end atual.
- **6 especialistas** em `apps/web/src/lib/ai/specialists/`:
  - `analyst.ts` — Haiku 4.5, read-only (validate_contract, analyze_contradictions, extract_document_data, add_comment, cross_check_certidoes)
  - `legal.ts` — Haiku 4.5, RAG (query_clauses, query_templates, explain_clause, query_knowledge_base, find_similar_contracts)
  - `editor.ts` — Sonnet 4.6, writes gated pelo Sentinel (edit_contract_section, update_contract_data, propose_suggestion, insert_clause, remove_clause, apply_style_preset, insert_image, add_comment, cross_check_certidoes, propose_plan)
  - `curator.ts` — Haiku 4.5, propose-only (propose_new_clause, propose_template_change, find_similar_contracts)
  - `ocr-quarantine.ts` — Gemini + Sentinel classifier (low-priv, sem tools de write)
  - System prompts dedicados em `specialists/prompts.ts` (Analyst/Legal/Editor/Curator)
- **Sentinel** (`apps/web/src/lib/ai/sentinel/`):
  - `policy.yaml` versionada com 3 regras (no_external_url_in_insert_image, no_template_change_without_evidence, budget_exceeded)
  - `policy-engine.ts` parser AST seguro (sem `eval`/`Function`) com tokens, funções (`contains_private_ip`), operadores (==, !=, <, >, >=, MATCHES, AND, OR, NOT)
  - `classifier.ts` regex + Haiku 4.5 fallback contra prompt injection (11 patterns regex, LRU cache 100 entries por hash)
  - `middleware.ts` `applyPolicy(toolCall, state)` + `quarantineAttachment(text, ctx)` — audit `AGENT_TOOL_BLOCKED` / `SENTINEL_ATTACHMENT_QUARANTINED`
- **PostgresSaver checkpointer** — `@langchain/langgraph-checkpoint-postgres@^1.0` no mesmo Neon do Prisma. Tabelas `langgraph_*` criadas via `apps/web/scripts/setup-langgraph-tables.ts`. `thread_id = ChatSession.id` pra time-travel forense.
- **Tool `cross_check_certidoes`** (21ª tool no AGENT_TOOLS) — Analyst e Editor cruzam `CertidaoJob.resultData` × `Contract.dataJson`. 11 categorias de finding (matricula_onus, matricula_vencida, matricula_faltando, vendedor_fiscal_positiva, vendedor_trabalhista_positiva, vendedor_civel_positiva, vendedor_antecedentes_positiva, imovel_iptu_pendente, protesto_vendedor, fgts_pendente, certidao_falhou_portal_manual). Cada finding com `suggested_aditamento` citando base legal (CC arts. 127, 418, 474, 475, 502, 503).
- **Hook automático em `contract-generation.ts`** — após criar contrato, dispara `analyzeCertidoesForContract` fire-and-forget que cria `ContractComment` por finding (dedupe via `dedupeKey`). Usuário vê alertas no editor sem ação manual.
- **Roteamento de aditamento (F4.x polish)** — `ADITAMENTO_REGEX` + nova regra de prompt do Editor (regra 19) ativam ciclo 1-turn: cross_check_certidoes → propose_suggestion. "Proponha aditamento" agora roteia pra Editor (não Curator) por ser write neste contrato.
- **Audit API + UI time-travel** — `GET /api/contracts/[id]/audit` lê histórico via `graph.getStateHistory(sessionId)`; UI server-component em `/contracts/[id]/audit` mostra checkpoints com intent/agents/tools/respostas por turn.
- **Memory service unificado** (`apps/web/src/lib/ai/multi-agent-memory.ts`) — `getTimeline(contractId)` consolida AuditLog + AIUsage + ContractChangeLog; `recordEvent()` helper fire-and-forget.
- **Audit actions novas**: `AGENT_TOOL_BLOCKED`, `SENTINEL_ATTACHMENT_QUARANTINED` em `lib/security/audit.ts`.
- **Doc**: `docs/multi-agent-architecture.md` com fases F0-F5, estrutura de arquivos, gestão das tabelas `langgraph_*` fora do Prisma.
- **Scripts de diagnóstico** em `apps/web/scripts/`: `setup-langgraph-tables.ts`, `test-multi-agent.ts`, `test-f3-curator-and-audit.ts`, `test-f4-crosscheck.ts`, `test-f4-polish-aditamento.ts`, `test-f5-edit-multi.ts`.
- **Tests**: +44 testes (24 Sentinel + 13 routing + 10 crosscheck − 3 atualizados de tools.test). Total 813/813.

### Alterado

- **`apps/web/src/lib/ai/agent.ts`** — `streamContractAgent` marcada `@deprecated` com nota explicando que só permanece pra `runPassiveAnalysis` + `ai-resolve` route (planejado pra F6). Helpers extraídos para `shared/`: `loadContext`, `resolveSession`, `loadChatHistory`, `streamOneTurn`, `mapToolToAction`, `summarizeToolResult`, `getAnthropicClient`, `snapshot` helpers.
- **`apps/web/src/app/api/contracts/[id]/chat/route.ts`** — flag `ENABLE_MULTI_AGENT` agora default `true`. Para rollback emergência, set `ENABLE_MULTI_AGENT=false`. Todos os intents (informational, edit_simple, edit_multi, review, propose) roteiam via graph; edit_multi força Editor com `propose_plan`.
- **`apps/web/src/lib/services/contract-generation.ts`** — adicionado `analyzeCertidoesForContract` chamado fire-and-forget no fim de `generateContractForDeal`.

### Adicionado em schema

- Tabelas `langgraph_*` no Neon (gerenciadas FORA do Prisma — não rodar `prisma db pull`).
- Audit actions enum: `AGENT_TOOL_BLOCKED`, `SENTINEL_ATTACHMENT_QUARANTINED`.

### Dependências

- `@langchain/langgraph@^1.0.0`
- `@langchain/langgraph-checkpoint-postgres@^1.0.0`
- `@langchain/core@^1.0.0`
- `js-yaml@^4.1.0` + `@types/js-yaml@^4.0.9`

### Motivação

Single-agent monolítico em `agent.ts` (1133 linhas, 18 tools, 18 regras de prompt) começou a apresentar:
1. **Anti-prompt-injection** insuficiente — `ChatAttachment.extractedText` entra direto no prompt do mesmo agente que tem tools de write.
2. **Tools demais por turn** — todas as 18 oferecidas mesmo em queries informacionais.
3. **Zero paralelismo em reads** — `validate_contract + query_knowledge_base + find_similar_contracts` serializados.
4. **Audit não replay-able** — sem checkpoint serializado por turn pra time-travel forense em casos de litígio.

Multi-agente resolve os 4 gargalos: tools restritas por especialista, fanout paralelo em review (3 agents simultâneos), Sentinel hard-block em writes que violam policy, PostgresSaver enterprise-grade pra audit/replay (exposição regulatória mitigada).

### Sobre Voyage API key inválida (warning persistente)

Em prod a `VOYAGE_API_KEY` está retornando 401. O multi-agente roda normalmente — `query_knowledge_base` cai em fallback ILIKE e `find_similar_contracts` em fallback fingerprint — mas a qualidade RAG semântica está degradada. Rotacionar antes da release.

## [Unreleased] - 2026-05-07 - Newton extract_document_fields (Phase 3 do plano openclaw)

### Adicionado
- **Endpoint Bearer `POST /api/deals/[dealId]/extract-fields`** (`apps/web/src/app/api/deals/[dealId]/extract-fields/route.ts`) — wrapper pra `classifyAndExtract` (Gemini OCR) com score POR CAMPO. Bearer scope `documents:rw`. Body `{ attachmentId, documentType?, idempotencyKey? }`. Retorna `{ fields[key]: {value, confidence, needsReview, reason}, lowConfidenceFields[], missingRequiredFields[], unknownFields[] }`. Audit `ATTACHMENT_EXTRACT`.
- **Field schemas** (`apps/web/src/lib/extraction/field-schemas.ts`) — 9 documentTypes (rg, cpf, cnh, matricula, iptu, escritura, procuracao, comprovante_residencia, certidao_casamento) com `FieldSpec { key, required, regex?, partialMarkers? }`. Função `scoreField(spec, value)` → confidence 0-1 baseado em (empty + required) / partial markers / regex match. `scoreFields(documentType, rawFields)` agrega + lista `lowConfidenceFields` (needsReview true) e `missingRequiredFields` (required + ausente).
- **Audit action** `ATTACHMENT_EXTRACT` em `apps/web/src/lib/security/audit.ts`.
- **Tool MCP** `extract_document_fields` em `apps/mcp-server/src/tools.ts`. Total Newton: 24 → 25 tools. Wrap do endpoint acima, idempotencyKey opcional.

### Motivação

Newton estava fazendo OCR errada de documento de uma das partes em produção (relato 2026-05-07). `classifyAndExtract` retorna confidence GLOBAL — Newton não sabia quais campos especificamente precisava conferir antes de gravar. Com score por campo + needsReview por campo + persona OCR.md (no repo openclaw), Newton agora recita campos de baixa confiança e pede confirmação antes de chamar `fill_form`.
## [0.3.1] - 2026-04-11 - Deploy e Documentacao

### Adicionado
- Guia de deploy Vercel (`docs/DEPLOYMENT.md`)
- `.env.example` atualizado com todas as variaveis necessarias
- README raiz reescrito para refletir a plataforma web (nao mais CLI)
- `apps/web/README.md` atualizado com rotas, setup Neon e instrucoes de teste

### Corrigido
- `ignoreDeprecations` no tsconfig corrigido de `"6.0"` para `"5.0"` (TS 5.9 compatibility)
- `TextractClient` lazy-initialized para evitar "Region is missing" durante build
- Arquivos de teste excluidos do tsconfig (evita erros de tipo no build)

---

## [0.3.0] - 2026-04-11 - Templates Padronizados e Banco de Clausulas v2

### Adicionado
- **Templates Padronizados v2** baseados nos modelos Zimmermann
  - `ccv_a_vista_v2.hbs` - CCV para pagamento a vista (15 clausulas)
  - `ccv_financiamento_v2.hbs` - CCV para financiamento imobiliario (17 clausulas)
  - Marcadores `<!-- CLAUSE_SLOT:Gx -->` para insercao semantica de clausulas variaveis
  - Template legado v1 marcado como deprecated (contratos existentes preservados)

- **Banco de Clausulas Padronizadas** (23 clausulas em 6 grupos)
  - G1: Sinal, Arras e Inicio de Pagamento (3 clausulas)
  - G2: Imissao na Posse (4 clausulas)
  - G3: Rescisao e Condicao Resolutiva (4 clausulas)
  - G4: Financiamento e Registro (4 clausulas - obrigatorio em financiamento)
  - G5: Comissao de Corretagem (3 clausulas)
  - G6: Declaracoes e Disposicoes Especiais (5 clausulas)
  - Cada clausula com `agentNotes` (orientacao juridica da Zimmermann)

- **Selecao automatica de template por modalidade**
  - Auto-detecta financiamento quando `alienacao_fiduciaria > 0`
  - Campo `modalidade` no schema de validacao (step5)
  - Fallback para template default generico

- **Agente IA aprimorado**
  - System prompt com descricao dos 2 modelos e 6 grupos de clausulas
  - `query_clauses` aceita `groupCode` e `isVariable`, retorna `agentNotes`
  - `suggest_improvements` detecta clausulas obrigatorias: G4 (financiamento), FGTS (G6), socio PJ (G6), pluralidade vendedores (G1)
  - Context do agente inclui `templateModalidade` e `templateName`
  - `insert_clause` posiciona clausulas nos CLAUSE_SLOT:Gx corretos

- **Schema Prisma atualizado**
  - `Clause`: campos `agentNotes`, `groupCode`, `isVariable`
  - `ContractTemplate`: campo `modalidade`
  - Migracao: `add_clause_bank_v2_fields`

- **UI da biblioteca de clausulas aprimorada**
  - Clausulas padronizadas agrupadas por grupo (G1-G6) com labels descritivos
  - Secao colapsavel "Orientacao de uso" mostrando `agentNotes`
  - Badges de grupo e status
  - Clausulas legacy exibidas separadamente como "Clausulas Base"

- **Suite de testes de renderizacao** (21 testes)
  - Verificacao de ambos templates com dados mockados realistas
  - Testes de helpers (moeda, extenso, cpf, cnpj, cep)
  - Testes de renderizacao de clausulas variaveis com dados do contrato

### Corrigido
- `insert_clause` agora usa CLAUSE_SLOT:Gx para posicionamento semantico (antes inseria sempre no final)
- Contratos aprovados nao podem mais ser versionados (retorna 403)
- Registro de novas orgs agora copia ambos templates v2 + 23 clausulas padronizadas

### Alterado
- Pagina de clausulas agora agrupa por `groupCode` ao inves de so por `category`
- `suggest_improvements` substituiu sugestao generica de "Condicao Suspensiva" por verificacao especifica de clausulas G4

---

## [0.2.0] - 2026-04-10 - Esteira de Vendas

### Adicionado
- **Fase 0: Fundacao**
  - Tailwind CSS v3 + Shadcn UI (20+ componentes)
  - NextAuth v5 com Prisma Adapter + Credentials provider (JWT sessions)
  - Prisma schema com 20+ models (Organization, Pipeline, Deal, SalesForm, ContractTemplate, Clause, Contract versionado)
  - Seed script: org default, pipeline 6 stages, template base, 14 clausulas categorizadas
  - Dashboard layout com Sidebar + Header
  - Paginas de login e registro com auto-criacao de org/pipeline/template/clausulas

- **Fase 1: Formulario de Vendas**
  - SalesFormWizard com 7 steps (Vendedor, Comprador, Imovel, Status, Pagamento, Posse, Comissao)
  - Link compartilhavel publico `/f/[token]` (sem autenticacao)
  - Auto-save com debounce 1500ms + indicador visual
  - Suporte a PF/PJ, conjuge, procurador, arrays dinamicos

- **Fase 2: Pipeline Kanban**
  - KanbanBoard com @dnd-kit drag-and-drop entre colunas
  - DealDetail com tabs (Dados, Anexos, Contratos)
  - Criacao de deal a partir de formulario completo
  - Auto-move para stage "Contrato" ao gerar contrato

- **Fase 3: Contratos + Clausulas**
  - Botao "Confeccionar Contrato" (Handlebars + dados do form)
  - Biblioteca de 14 clausulas em 9 categorias
  - API de geracao de clausulas com Claude AI (pending -> approved)
  - CRUD completo de clausulas com filtros

- **Fase 4: Editor + Chat IA**
  - Editor TipTap com toolbar (bold, italic, headings, listas, tabelas, alinhamento)
  - ChatPanel com IA para editar contratos via linguagem natural
  - Versionamento de contratos (linked-list, isLatest flag)
  - VersionTimeline no painel lateral

- **Fase 5: Export**
  - ExportDialog com opcoes PDF e DOCX
  - Historico de exportacoes anteriores

### Corrigido
- TipTap SSR hydration error (`immediatelyRender: false`)
- Registro de usuario nao copiava template e clausulas para nova org
- Campos legados renomeados (handlebarsTemplate -> handlebarsSource, htmlPreview -> htmlContent)
- Anthropic SDK tool type error (type: 'object' as const)

### Bugs Conhecidos
- Secao 8 do contrato (penalidades) mostra campos config vazios quando nao preenchidos
- Helper `extenso` nao implementado (valores por extenso mostram numero entre parenteses)

---

## [0.1.0] - MVP Original (pre-esteira)

### Existente
- Upload DOCX/PDF com extracao de texto (mammoth, pdf-parse)
- Analise por IA (Claude) para identificar campos e condicionais
- UI de mapeamento manual (standalone HTML)
- Chat de edicao com tool-use (update_data_patch, propose_clause_edit)
- Renderizacao via Handlebars com helpers brasileiros
- Export PDF (Puppeteer) e DOCX (html-to-docx)
- PostgreSQL + Prisma (User, Document, Template, Contract, Export, ChatSession, ChatMessage)
- Auth basica com bcryptjs (sem sessoes)
- Storage S3 ou local
- Template unico: contrato_compra_venda.hbs
