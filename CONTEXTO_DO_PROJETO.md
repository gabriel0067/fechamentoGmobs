# Contexto do projeto — Fechamentos GMOBS

## Objetivo

Este projeto transforma o processo de fechamento de transportadoras/parceiras em um fluxo web simples. O usuário importa um relatório geral em Excel ou CSV, confere os registros separados por parceira e exporta um arquivo Excel separado para cada transportadora escolhida.

Este documento existe para permitir a continuidade do trabalho em outra máquina ou em uma nova conversa com o Codex sem precisar reexplicar o projeto desde o início.

## Estado atual em 25/08/2026

- O projeto foi colocado no Git e enviado ao GitHub.
- A branch de trabalho é `main`.
- O primeiro commit é `24ea783` (`first commit`).
- A interface principal já está implementada em React/TypeScript.
- O fluxo Importar → Prévia → Exportar já está programado.
- O projeto antigo foi preservado em `legacy/site/` somente como referência.
- A persistência em nuvem foi implementada com Cloudflare D1. `.openai/hosting.json` declara a ligação lógica `DB`, `db/schema.ts` define `cloud_state_chunks` e a migração correspondente fica em `drizzle/`.
- No endereço local, os dados importados continuam sendo guardados no IndexedDB do navegador, no banco `gmobs-closing-storage`, usando a chave lógica `gmobs-closing-v3`. No site publicado, o Cloudflare D1 é a única fonte operacional: nenhum relatório ou histórico é restaurado do armazenamento do navegador.
- As bipagens, a tabela de TDE, os cadastros manuais, os remetentes do `MAEX ADICIONAL` e o histórico de faturamento também ficam no D1 compartilhado no endereço publicado.
- A importação e a tela separada de romaneios estão implementadas e validadas localmente, mas ainda não foram publicadas; aguardam aprovação visual do usuário.
- Em `Romaneios > Fechamento`, o fechamento de motorista agora abre uma prévia antes da geração, permite ajustar a cidade atendida e adicionar observação por dia, e exporta um PDF separado para cada motorista selecionado.
- O endereço publicado é acessível pela internet, mas a interface e a API exigem login próprio. A sessão é assinada no servidor e mantida em cookie HttpOnly.

## O que foi construído

### 1. Importação de relatórios

Em `app/excel.ts`, o sistema:

- aceita `.xls`, `.xlsx` e `.csv`;
- procura automaticamente a melhor linha de cabeçalhos nas primeiras 35 linhas de todas as abas;
- reconhece nomes alternativos de colunas, com ou sem acentos;
- entende datas do Excel, datas brasileiras e datas em texto;
- converte valores monetários brasileiros, inclusive com `R$`, ponto de milhar e vírgula decimal;
- exige que o relatório tenha CTE, NF ou Minuta identificável;
- ignora linhas de totalização;
- inclui registros entregues, reentregas e complementos de frete quando há status reconhecido (`ET`, `RE`, `CF`, `ENTREGUE`, `REENTREGA` ou `COMPLEMENTO DE FRETE`);
- informa quantos registros ficaram fora do fechamento.

Os campos reconhecidos incluem parceira e CNPJ do redespacho, ocorrência, status, data de emissão, data de entrega, MDe/documento, CTE, chave do CTE, nota fiscal/minuta, remetente e CNPJ, destinatário e CNPJ, cidade, peso, volumes, observação, fretes, TDE, TDA, TRT, reentrega, dedicado, ajuste e total informado.

No cartão `Relatório geral`, a tela mostra sempre a maior `Data de Emissão` encontrada na coluna F do último arquivo importado. Essa informação é salva junto com os metadados do relatório no endereço local e no estado `closing` do banco publicado. Para dados antigos sem esse metadado, a maior data é reconstruída automaticamente a partir dos registros atuais.

#### Lista de taxas TDE

A primeira página possui uma segunda importação específica para a lista de TDE. O formato aprovado contém:

- `NOME`: nome ou razão social do cliente;
- `CNPJ`: identificador usado no cruzamento;
- uma coluna monetária para cada transportadora, como `ARGIUS`, `FITLOG`, `MAEX`, `TADEX`, `LOVATO` e `TRD`.

O sistema lê todas as abas e procura, nas primeiras 20 linhas, uma linha que contenha `NOME`, `CNPJ` e ao menos uma coluna de taxa. Cada linha é transformada em combinações CNPJ + transportadora + valor. No relatório GMOBS, o cruzamento é feito contra o campo `CNPJ Destinatário`; quando CNPJ e transportadora coincidem, o valor da lista substitui o TDE original do registro para a prévia e exportação.

O CNPJ é comparado somente pelos dígitos. Como o Excel pode transformar CNPJs iniciados por zero em números de 12 ou 13 dígitos, o sistema completa zeros à esquerda até chegar a 14 dígitos. Exemplo: `6127582000905` é tratado como `06.127.582/0009-05`.

A ordem de importação não importa: se a lista TDE vier primeiro, ela será usada na próxima importação do relatório; se o relatório já estiver aberto, a taxa é aplicada imediatamente. Quando não há correspondência para CNPJ + transportadora, permanece o TDE que veio no relatório original.

Na mesma página existe um cadastro manual com Nome/Razão social, CNPJ, Transportadora e Valor TDE. O cadastro manual tem prioridade sobre a lista importada para a mesma combinação CNPJ + transportadora. Ele pode ser removido; ao remover, a taxa do arquivo volta a valer, se existir. Importar uma lista TDE nova substitui apenas os dados vindos do arquivo e preserva os cadastros manuais.

Enquanto o nome é digitado no cadastro manual, o sistema procura sugestões tanto na lista TDE importada quanto nos destinatários do relatório atual. Clientes com o mesmo nome normalizado são agrupados na sugestão, que informa quantos CNPJs foram encontrados. Ao escolher o cliente, Nome/Razão social e todos esses CNPJs são preenchidos automaticamente; a transportadora e o valor continuam sendo escolhidos manualmente.

O campo `CNPJ(s)` também aceita vários números colados manualmente, separados por vírgula ou um por linha. Ao salvar, o sistema cria internamente uma combinação manual para cada CNPJ com o mesmo nome, transportadora e valor TDE, mantendo a prioridade sobre a lista importada. Na interface esses registros aparecem agrupados em um único cadastro com a quantidade de CNPJs; remover o grupo remove todas as combinações manuais dele e restaura as taxas do arquivo quando existirem.

#### Colunas importantes do relatório GMOBS

- `AJ - CT-e Parceiro`: número curto usado na bipagem quando a leitura possui menos de 44 dígitos.
- `AK - Chave CT-e Parceiro`: chave de acesso usada quando a bipagem possui exatamente 44 dígitos.
- `C - Documento`: número MDe usado no arquivo `MAEX ADICIONAL`.
- `AL - Volumes` e `AN - Peso`: quantidade e peso usados no arquivo `MAEX ADICIONAL`.
- `BA - Valor do Frete`: única fonte do total do registro e do fechamento.
- `BD - Valor Frete Parceiro`: fonte da coluna `Frete da Parceira` na exportação padrão.
- `BQ - Observação`: texto levado para a aba `OUTROS` nos registros CF.
- Os CNPJs e nomes de remetente, destinatário e redespacho são localizados pelo par de cabeçalhos `CNPJ ...` seguido de `Nome`, evitando ambiguidade entre as várias colunas chamadas `Nome`.

#### Histórico de documentos enviados ao faturamento

Na primeira página existe uma terceira importação chamada `Já enviados ao faturamento`. Ela aceita vários fechamentos antigos `.xls` ou `.xlsx` de uma vez e procura automaticamente as colunas `CTE`/`CT-E` e `NF`, mesmo quando o cabeçalho aparece depois das linhas institucionais.

A identificação segura usa `tipo de fechamento + transportadora + CTE`. A NF é preservada apenas para conferência; ela não é usada sozinha porque pode se repetir em parceiros diferentes. Fechamentos repetidos e cópias com sufixos como `(1)` ou `(2)` não duplicam os documentos dentro do mesmo tipo. Cada registro mantém a lista de arquivos em que foi encontrado.

A transportadora é reconhecida pelo nome do arquivo ou por uma indicação explícita no cabeçalho. Os arquivos cujo nome contém `Custos_extras_MVF` são tratados como adicionais da Argius. Arquivos cujo nome contém `Fechamento Adicional Maex` entram no escopo exclusivo `maex-additional`; eles não ocultam documentos do fechamento normal. O importador também reconhece os formatos históricos da Displan, Maex, TRD e Argius analisados nesta etapa.

O histórico mostra a quantidade de registros, quantos foram encontrados no relatório atual e a relação dos arquivos importados. Fontes do adicional aparecem como `Maex (somente adicional)`. O botão `Desfazer` de um arquivo adicional remove apenas o histórico adicional e nunca altera o normal; se o mesmo CTE também estiver presente em outro arquivo do mesmo tipo, ele continua marcado.

#### Relatórios de romaneio

A primeira página possui um quarto campo de importação para um ou vários relatórios de romaneio `.xls`, `.xlsx` ou `.csv`. O arquivo aprovado contém as colunas `FILIAL`, `ROMANEIO`, `TABELA`, `STATUS`, `DATA EMISSAO`, `PARCEIRA DE ENTREGA`, `CARTA FRETE`, `CPF`, `MOTORISTA`, `PLACA`, `TIPO VEICULO`, `ENGATE`, `FRETE`, `PESO`, `QTD. ENTREGAS`, `VOLUMES`, `EM ROTA`, `DOCUMENTOS`, `AJUDANTES` e `CONFERENTES`.

Os registros ficam em uma aba independente chamada `Romaneios`. A tela operacional agrupa as linhas por dia de emissão + motorista + número do romaneio, ignorando o horário. Linhas do mesmo romaneio que vieram separadas por cidade permanecem juntas, mas dois números de romaneio feitos pelo mesmo motorista no mesmo dia aparecem em painéis independentes. Ao bipar um documento de outro romaneio enquanto há marcações ainda não gravadas, o sistema avisa e mantém o usuário no romaneio atual até concluir a gravação. O painel mostra número do romaneio, dia, motorista, rotas agrupadas e editáveis, quantidade operacional de entregas, peso total, frete total das linhas e produção gravada. Frete total, peso, entregas importadas e volumes são somados linha a linha dentro do mesmo número de romaneio, porque ele pode aparecer quebrado por cidade e cada linha representa uma parte real da carga. A quantidade operacional vem dos documentos únicos extraídos da coluna `DOCUMENTOS`, somando notas manuais e coletas; a coluna `QTD. ENTREGAS` da planilha não deve comandar o total quando vier duplicada ou divergente. A tela não possui filtro separado de dia nem cartões gerais de totais. Há um único campo global para procurar motorista, romaneio, rota ou cliente e também para bipar MD-e, CT-e Parceiro ou NF. Um documento bipado como Entregue continua visível em verde-claro até a gravação e possui o botão `Desfazer`, que restaura o estado original. Volta, Retorno, Retido, Não seguiu e Motorista não trouxe ficam destacados em vermelho-claro para evidenciar a ocorrência. Os detalhes só são renderizados quando o usuário abre o painel, evitando lentidão com milhares de documentos.

Ao tentar gravar um Romaneio com documentos ainda sem situação, o alerta oferece `Gravar marcados e deixar restantes em aberto`. Nessa opção, somente as notas já marcadas são persistidas; as demais continuam abertas no mesmo Romaneio e podem ser bipadas e gravadas posteriormente.

A coluna `DOCUMENTOS` (S) é dividida por vírgula, ponto e vírgula ou quebra de linha. O prefixo define o vínculo com o relatório geral:

- `M-627822-1` significa MD-e `627822` e é comparado com o campo MDe/documento do relatório geral;
- `C-8160-1` significa CT-e `8160` e é comparado com o CTE do relatório geral;
- o sufixo final, como `-1`, não participa da comparação.

Cada referência aparece em verde quando foi localizada e em amarelo como `AGUARDANDO RELATÓRIO` quando ainda não existe no relatório geral. O vínculo do MD-e usa a coluna C (`Documento`). Os dados exibidos vêm das colunas R (`Nome` do remetente), V (`Nome` do destinatário) e W (`Cidade` do destinatário); a busca também aceita o CT-e Parceiro da AJ e a chave de 44 dígitos da AK. A base de consulta do romaneio preserva todos os status importados, inclusive `LT` e `RM`, mesmo que eles ainda não estejam liberados para o fechamento. Como o vínculo é recalculado a partir dos dois estados atuais, um documento pendente passa automaticamente para localizado quando aparecer em uma futura importação do relatório geral, sem precisar importar novamente o romaneio.

O frete de cada documento não é obtido dividindo o frete total da linha do romaneio quando há vínculo com o relatório geral. O sistema faz uma busca equivalente a PROCV no relatório geral: `M-...` procura o MD-e, `C-...` procura o CT-e e usa o `Valor do Frete` da coluna BA encontrado naquele registro. A produção individual é `BA × 87%`, correspondente ao desconto de 13%. Quando um romaneio já foi conferido como Entregue ou Retido, mas os documentos ainda não têm frete individual localizado pelo relatório geral, a produção gravada usa o frete total do romaneio importado, também com 13% de desconto, somando todos os romaneios do mesmo motorista no dia. A conferência também permite inserir NF manual com frete bruto; esse lançamento entra na produção como `frete bruto × 32% × 87%`.

Ao bipar ou digitar MD-e, CT-e Parceiro, chave da AK ou NF no campo global, o sistema localiza e abre automaticamente o painel diário vinculado. A própria primeira leitura já prepara o documento como Entregue, e as próximas leituras continuam localizando e marcando documentos. A lista também permite selecionar `Entregue`, `Volta`, `Retorno`, `Retido`, `Não seguiu` ou `Motorista não trouxe o documento`; Retorno exige motivo. A ticagem permite selecionar vários documentos e lançar a mesma situação em lote, mantendo confirmação sonora para ocorrências diferentes de Entregue. Nenhuma alteração comum do painel é definitiva antes do botão `Gravar conferência`. Depois de gravados, os documentos deixam a lista de pendências. No fechamento do agregado, Entregue soma nota e produção, Retorno soma somente a nota, e Volta/Não seguiu não somam nota nem produção. O valor total da produção considera somente situações já gravadas.

Na ticagem diária existe uma ação para marcar todos os documentos pendentes como `Entregue`, com confirmação obrigatória e alerta sonoro antes de preparar as marcações. Abaixo dos documentos há um campo de observação geral da conferência; essa observação é salva junto com a conferência do dia.

A contagem de pendentes diminui imediatamente quando um documento recebe uma situação na conferência, mesmo antes de gravar; documentos já coloridos/preparados não continuam contabilizados como pendentes. O Enter confirma a ação principal dos avisos, fecha mensagens de erro/informação e mantém o envio normal dos formulários e campos de bipagem.

Em `Romaneios > Romaneio completo`, a aplicação permite consultar romaneios já importados por motorista, data, número do romaneio, cidade ou documento. Essa visão mostra se cada documento está aberto ou já foi gravado como Entregue, Retido, Retorno, Volta ou Motorista não trouxe o documento, mostra o motivo do Retorno quando houver e permite `Desfazer` uma situação gravada para corrigir erro de conferência.

Para facilitar a conferência, um documento bipado ou com situação manual completa desaparece da lista visível assim que fica preparado; ele continua contado na faixa de alterações aguardando gravação. Retorno é a exceção: permanece visível até a gravação para permitir digitar e revisar o motivo obrigatório. Toda leitura válida toca um bipe de confirmação mais forte. Leituras inválidas, documentos não encontrados, ocorrências manuais e tentativas de gravar sem situação ou sem o motivo obrigatório tocam um alerta sonoro forte em estilo sirene. Se houver qualquer situação não gravada e o usuário tentar bipar um documento pertencente a outro painel diário, a leitura é bloqueada e aparece no centro da tela um alerta forte, com fundo escurecido, pedindo para usar `Gravar conferência` primeiro. Ao tentar gravar com qualquer documento aberto, o alerta informa quantos documentos continuam sem situação e oferece apenas `Voltar e conferir`; não existe gravação parcial. Antes da gravação final, outro alerta sonoro pergunta se houve coleta e permite informar a quantidade; essas coletas entram apenas na quantidade de documentos do fechamento do agregado.

Além de Entregue, Volta, Retorno e Retido, a conferência oferece `Motorista não trouxe o documento`. Volta, Retorno, Retido e essa nova situação exigem confirmação em um alerta central antes de serem preparadas. A falta fica persistida por documento e motorista, aparece como aviso nos painéis dos romaneios posteriores do mesmo motorista e, ao completar três dias corridos desde o dia do romaneio original, passa automaticamente a integrar o Relatório de Retidos até receber baixa. A falta não libera documentos `LT` ou `RM` para o fechamento.

Documentos que chegam do relatório geral com status `LT` ou `RM` ficam disponíveis para consulta no Romaneio, mas permanecem fora do fechamento enquanto não houver conferência gravada. Depois de `Gravar conferência`, Entregue/Bipado converte o documento em `ET`; Volta, Retorno e Retido convertem em `OC`. A data operacional passa a ser o dia do romaneio e o documento convertido fica liberado para o fechamento. Essa conversão também é reaplicada automaticamente quando o relatório geral for importado novamente, porque a situação gravada do Romaneio é persistente.

Os Retidos entram automaticamente numa visão separada chamada `Relatório de Retidos`. Quando um documento retido é lido no campo global da operação, ele recebe baixa imediata como Entregue e sai somente do relatório de Retidos. Dentro da própria visão de Retidos, o usuário ainda pode bipar ou selecionar várias baixas e precisa clicar em `Gravar baixas`. Em ambos os casos, a produção já contabilizada é mantida.

O relatório geral também pode ser o `Relat_Docs_Emitidos`. Quando a coluna `Tipo` indicar `CT-e`, a coluna `Documento` é tratada como CT-e, `Notas Fiscais/Serie` como NF e `Chave CT-e` como chave de acesso. Isso permite localizar documentos que não aparecem no relatório de minutas. Na bipagem dos romaneios, uma chave CT-e de 44 dígitos também extrai o número do CT-e embutido na chave e compara com referências `C-...` do romaneio, cobrindo clientes sem MD-e como Barueri e Agro Litoral.

Na bipagem dos Romaneios, a busca ocorre em cascata. Primeiro são comparados os identificadores diretos do documento; para uma chave CT-e de 44 dígitos, o sistema compara a chave completa e o número do CT-e extraído das posições oficiais da chave. Se ainda não houver correspondência, procura a chave no relatório geral e reaproveita os identificadores vinculados naquela mesma linha (MD-e, CT-e e NF) para localizar o documento do romaneio. Esse último recurso atende Barueri e outras operações sem MD-e. NFs e CT-es com série nos formatos `123456-1`, `123456 - 1`, `123456/1`, `123456 01` ou `123456 série 1` são normalizados para o número base `123456`; chaves completas de 44 dígitos são preservadas.

Nos Romaneios, confirmações mantêm o som crescente de sucesso. Erros, documentos não encontrados e situações que exigem atenção usam uma buzina curta, de aproximadamente 0,3 segundo, acompanhada do aviso visual.

Os romaneios são cumulativos: uma nova importação acrescenta as linhas novas ao conjunto que já estava salvo. Uma linha de romaneio só é ignorada quando todos os seus campos são idênticos aos de outra linha já salva ou selecionada, mesmo que a cópia esteja em outro arquivo. A mesma regra de linha inteira foi aplicada ao relatório geral dentro de cada importação: células isoladas podem se repetir normalmente; somente uma linha completamente igual é removida. O resumo informa quantas duplicatas completas foram descartadas.

No teste local com `Relat_Romaneio_Emitidos (7).xls`, o sistema reconheceu 592 linhas, agrupadas em 254 romaneios e 5.804 referências da coluna S. Depois de importar um relatório geral compatível, 4.914 referências foram localizadas e 890 permaneceram aguardando. Esses números servem apenas como validação local e os arquivos reais não pertencem ao Git.

### 2. Identificação das parceiras

Em `app/page.tsx`, há aliases para:

- Argius;
- Fitlog;
- Maex;
- Displan;
- TRD;
- D&Y;
- ARC, agrupado e exibido como D&Y;
- PAJUÇARA (também reconhece as grafias antigas Pajussara/Pajucara);
- Rio Vermelho.

Uma transportadora desconhecida recebe um identificador próprio baseado no nome recebido. Linhas sem nome de parceira aparecem como **Não identificado** e não podem ser exportadas até que essa situação seja tratada.

Os nomes SIMB, SIMBAX, STX, Tadex, Tadlog e Essessao são agrupados como **Tadex**. Todas as variações contendo TTJB são agrupadas como **TTJB**. Nomes contendo Maex ou Mardonio são agrupados como **Maex**. Na prévia de registros não identificados, o sistema mostra CNPJ do redespacho, nome/razão social recebido, remetentes, cidades e exemplos de documentos, permitindo atribuir o grupo a uma transportadora conhecida ou cadastrar uma nova antes da exportação. A nova transportadora fica salva com os registros no navegador e passa a aparecer nas opções seguintes.

O nome de parceiro **ARC** é tratado como um alias da **D&Y**. Registros novos ou já salvos com ARC usam o identificador interno `dy`, aparecem agrupados como D&Y e obedecem à mesma exigência de bipagem antes de entrar na prévia e na exportação.

A identificação manual altera todos os registros do mesmo grupo, priorizando o CNPJ do redespacho como chave. Se o CNPJ estiver ausente, usa o nome recebido e, por último, o remetente como pista de agrupamento.

### 3. Entregas e reentregas

O sistema considera um registro como reentrega quando:

- encontra o código `RE` no status, descrição, ocorrência, CTE ou nota; ou
- encontra CTE e nota repetidos para a mesma parceira durante a importação.

O resumo da importação mostra quantidade importada, reentregas, registros fora do fechamento e registros sem parceira.

### 4. Prévia do fechamento

A tela possui três menus principais:

1. **Importar**: seleção do relatório geral, TDE, históricos e romaneios.
2. **Romaneios**: reúne os submenus `Ticagem`, para a operação diária e Retidos, e `Fechamento`, para o relatório quinzenal dos motoristas.
3. **Fechamento parceiros**: reúne os submenus `Prévia` e `Exportar` do fechamento das transportadoras.

No submenu `Romaneios > Fechamento`, o período é livre e aceita data inicial e final. A lista mostra todos os motoristas com romaneio no intervalo, inclusive aqueles sem entregas gravadas, e permite selecionar um ou vários nomes. O fechamento considera somente documentos cuja situação `Entregue` já foi gravada; Volta, Retorno, Retido e `Motorista não trouxe o documento` permanecem no histórico operacional, mas não entram nas notas nem no frete entregue desse relatório. A exportação gera um PDF separado por motorista, em retrato, com recibo em meia folha de A4, linhas pontilhadas, faixas claras esverdeadas e cabeçalho no estilo do modelo validado. Cada linha diária mostra data, romaneios, cidades atendidas com observação na frente, quantidade de NFs únicas, notas manuais e coletas, além da produção gravada. Antes de exportar, o sistema pergunta se houve desconto; se houver, o valor fica destacado abaixo do conteúdo do PDF. Quando o desconto é parcelado, a parcela atual aparece no PDF e as parcelas seguintes ficam persistidas para os próximos fechamentos do mesmo motorista.

Na prévia são exibidos:

- quantidade de notas únicas;
- quantidade de CTEs/minutas únicas;
- quantidade de reentregas;
- valor total do fechamento.

Quando um período é informado, o fechamento normal aplica o intervalo às duas datas: emissão e entrega. Um documento emitido em 15/08 e entregue em 18/08 não aparece se a data final for 16/08. Registros comuns sem data de entrega também ficam fora enquanto houver filtro. As exceções `RE`, `CF` e `OUTROS` continuam elegíveis pela data de emissão, pois nesses casos o campo de entrega pode conter um código em vez de uma data. O MAEX ADICIONAL não usa essa regra de entrega: ele considera somente a emissão até a data final escolhida.

Antes de montar a lista normal de parceiras, o sistema retira os registros cujo par `transportadora + CTE` já consta no histórico normal de faturamento. Uma faixa informa quantos registros do período foram ocultados. O histórico do `MAEX ADICIONAL` não participa desse filtro: um documento faturado no adicional continua disponível para o fechamento normal quando a entrega ocorrer.

Argius, TRD e D&Y usam conferência por bipagem do CTE da parceira. Leituras com exatamente 44 dígitos são procuradas na coluna `Chave CT-e Parceiro` (AK); leituras menores são procuradas na coluna `CT-e Parceiro` (AJ). A marcação `OK` é feita na prévia e, no site publicado, fica salva no conjunto `scans` do banco central, permanecendo entre acessos, computadores e novas importações. Se um CTE bipado ainda não existir no relatório, ele fica como `AGUARDANDO` e recebe `OK` automaticamente quando aparecer em uma importação futura da mesma parceira. Para essas três parceiras, quantidades, valores e exportação consideram somente documentos bipados que já apareceram no relatório. Uma bipagem pode ser removida em caso de erro.

Nas demais parceiras, a parte superior da prévia possui a opção `Exportar apenas documentos bipados`, desligada por padrão. Desligada, a parceira continua mostrando e exportando todos os documentos, sem exigir leitura. Ligada, o mesmo painel de bipagem da Argius aparece e somente documentos com `OK` participam das quantidades, valores e exportação. A opção é temporária para o relatório atual, reinicia desligada ao importar ou restaurar outro relatório e não modifica a lista lateral de parceiras. As leituras confirmadas continuam persistidas normalmente no conjunto `scans`.

Além da leitura individual, a prévia dessas três parceiras permite importar um arquivo `.txt` com um CTE por linha ou valores separados por vírgula. O sistema adiciona todas as leituras válidas ao histórico existente, sem apagar bipagens anteriores. CTEs encontrados recebem `OK`; os que ainda não apareceram no relatório ficam como `AGUARDANDO`, obedecendo à mesma regra de AJ/AK.

Logo abaixo, os documentos do período que continuam sem `OK` aparecem em uma lista de pendências com caixas de seleção. Marcar uma caixa confirma manualmente o CTE e o move para a lista de documentos com `OK`. Essa confirmação manual também é gravada em `gmobs-scanned-ctes-v1`, portanto participa do fechamento e permanece após recarregar ou reimportar no mesmo navegador.

As bipagens são separadas por identificador da parceira. O mesmo número bipado para Argius não libera automaticamente um documento da TRD ou D&Y. O valor salvo é a leitura normalizada e a data/hora ISO da bipagem. Ao reimportar, o sistema cruza novamente as leituras salvas com AJ e AK; por isso não se deve apagar `gmobs-scanned-ctes-v1`.

A aba principal `Capas` possui as seções independentes `Embarque`, `Capas`, `Coleta` e `Relatório`. As três operações permitem escolher qualquer transportadora, bipar NF, CT-e ou chave, revisar uma fila própria e gerar um PDF inspirado no protocolo da Argius. Somente a seção `Capas` possui também um campo para inserir um número de capa avulso informado pela parceira; esse número entra diretamente no PDF e na planilha do relatório, sem procurar uma capa antiga nem vincular notas automaticamente. Embarque e Coleta continuam aceitando somente documentos localizados no relatório geral. A bipagem feita nessa aba alimenta o mesmo histórico `scans` usado na prévia da parceira. Portanto, quando a opção `Pagar somente notas bipadas` estiver ligada na prévia, a soma e a exportação consideram conjuntamente o que foi bipado na própria prévia e em qualquer uma dessas capas. Cada documento gerado fica salvo junto ao estado `closing`, entra no backup completo e pode ser baixado novamente. As novas capas usam uma sequência global iniciada em `10000`, com os identificadores `E-` para Embarque, `CA-` para Capas e `CO-` para Coleta. O responsável vem obrigatoriamente da identificação feita na entrada do sistema, aparece no PDF e na planilha, e a marca da capa é `MVFLOG`. No Relatório, a busca aceita o número sequencial, o identificador completo ou um documento; os filtros reduzem a lista, mas o usuário precisa selecionar explicitamente uma ou mais capas antes de gerar a planilha correspondente.

Na bipagem de Capas, a localização é global sobre todas as linhas preservadas da importação, inclusive as que não entram no fechamento. Ela compara diretamente a chave completa em qualquer campo documental ou dentro da observação e também reconhece o número do CT-e extraído da chave, NF, MD-e e CT-e. A busca não depende da transportadora escolhida nem do operador conectado. A transportadora escolhida identifica somente o destino e o cabeçalho da capa. Para o fechamento mensal, a leitura também é registrada sob a parceira original do documento. Uma leitura aceita toca o som de confirmação; documento inválido ou não encontrado toca a buzina curta e mostra o motivo.

Se a mesma chave, CT-e ou nota for bipado novamente na capa em preparação, o item não é duplicado: o sistema limpa o campo, mostra o aviso de que já foi bipado e toca o alerta sonoro.

As notificações de bipagem são apenas visuais, não possuem botão de fechar, desaparecem automaticamente em menos de dois segundos e nunca consomem o Enter enviado pelo leitor. Assim, leituras rápidas continuam submetendo a próxima nota normalmente.

Embarque e Coleta aceitam também inclusão manual com NF, remetente, destinatário, volumes e peso. Capas salvas podem ser abertas para edição, atualizadas com novos itens e excluídas pelo histórico mediante confirmação. A duplicidade é bloqueada tanto no rascunho quanto contra capas já salvas; as exportações também eliminam repetições exatas antigas. A capa padrão pagina automaticamente a cada 72 itens, sem limite de páginas, e existe um PDF completo em paisagem com NF, CT-e, chave, remetente, destinatário, volumes, peso e cidade.

Quando a procura de Romaneios é bloqueada por uma ticagem ainda não gravada, o aviso oferece `Cancelar ticagem atual`, que descarta apenas as marcações provisórias e permite recomeçar sem recarregar a página.

A busca de Capas consulta tanto os documentos já elegíveis para o fechamento quanto a base completa preservada para consulta dos Romaneios. Isso permite localizar chaves que estão visíveis no sistema, mas cujo status ainda não foi liberado para entrar no fechamento.

Alguns arquivos `Relat_Docs_Emitidos` de MD-e informam o CT-e de redespacho em `Doc Redesp Parceiro` e colocam a chave CT-e somente no texto da `Observacao`, no formato `MDE DE REDESPACHO GERADO COM BASE NO DOCUMENTO: ... CHAVE: ...`. A importação reconhece essa coluna como CT-e e recupera a chave da observação quando o campo próprio estiver vazio. As buscas operacionais também extraem dinamicamente o documento e qualquer chave de 44 dígitos da observação, permitindo corrigir a consulta dos dados já carregados sem exigir nova importação.

Antes de entrar, o sistema exige o nome do operador acima dos campos de usuário e senha. O nome pode ser escolhido entre os já cadastrados ou digitado para criar um novo, fica salvo para reutilização e aparece no topo durante a sessão. O botão `Sair` fica sempre disponível no cabeçalho, inclusive no modo local. Capas guardam `generatedBy`, bipagens guardam data e `scannedBy`, e situações gravadas dos Romaneios guardam `savedBy`; registros antigos sem operador continuam compatíveis.

No modo local, `Sair` encerra somente a identificação do operador e mantém todos os relatórios, Romaneios, bipagens e demais estados carregados. Nunca limpar os estados operacionais ao trocar o nome local, pois os efeitos de persistência poderiam gravar um conjunto vazio no IndexedDB. No site publicado, o logout continua limpando apenas a cópia em memória depois de encerrar a sessão; os dados compartilhados permanecem no D1.

Registros `CF` são complementos de frete independentes, mesmo quando repetem NF, cliente e destino de uma linha ET, OLN ou RE. Eles permanecem fora de todo o fluxo de Romaneios e entram diretamente no fechamento da parceira pelo valor integral informado no relatório, apresentado como `Dedicado`, sem exigir bipagem e sem aplicação de desconto adicional.

Na prévia de cada parceira, logo abaixo do valor do fechamento, existe um painel temporário de auditoria calculado sobre exatamente as linhas que entram na soma e na exportação. Ele mostra quantidade e valor de entregas normais, reentregas, CF, TDE, TDA/TRT, dedicados fora de CF, frete da parceira, frete base, NFs, CTEs, peso, volumes e documentos excluídos por falta de bipagem. Um detalhamento expansível lista cada NF com CTE, status, destinatário, cidade e todos os componentes de valor.

#### Validação do fechamento recebido da Pajuçara

Na prévia da Pajuçara existe um campo para importar o fechamento enviado pela própria transportadora. O modelo reconhecido pode conter as abas `Extrato` e `MAPA SJC`; o sistema localiza automaticamente a aba e a linha que possuem as colunas `CTRC/SUBC` e `NF`, ignorando linhas de cabeçalho, separadores, totais e o bloco de estorno posterior ao resumo.

O número `CTRC/SUBC` deles não corresponde ao CTE que vem no relatório GMOBS. Por isso, a comparação usa a NF: remove zeros à esquerda e desconsidera a série que aparece depois do hífen no nosso relatório. Quando a mesma NF aparece mais de uma vez, cada ocorrência do arquivo recebido só pode confirmar uma ocorrência do nosso relatório; remetente é usado como apoio para escolher a correspondência correta.

A tela mostra quantos documentos existem no nosso relatório no período filtrado, quantos foram encontrados, quantos faltaram no fechamento deles e quantos existem somente no arquivo recebido. Os faltantes aparecem com CTE, NF, remetente, destinatário, cidade e valor. O botão `Baixar faltantes` gera um Excel com esses documentos, as datas, o `Total Comissão` e a soma final. O arquivo recebido é temporário e precisa ser importado novamente após recarregar a página.

#### Seleção do MAEX ADICIONAL

Na prévia da Maex existe uma lista dos documentos adicionais ainda em aberto até a data final escolhida, inclusive documentos sem data de entrega e documentos já faturados no fechamento normal. A interface mostra MDe, CTE, NF, remetente, destinatário e cidade. Embora a caixa apareça em cada documento, a escolha é salva por remetente para evitar repetir o trabalho em todas as quinzenas:

- usa primeiro o CNPJ normalizado do remetente como identificador permanente;
- quando não há CNPJ, usa o nome normalizado do remetente;
- ao marcar um documento, todos os documentos atuais do mesmo remetente ficam marcados;
- em uma importação futura, novos documentos desse remetente são marcados automaticamente;
- ao desmarcar, o remetente é removido da lista adicional e todos os seus documentos deixam de entrar nela.

A marcação fica em `gmobs-maex-additional-senders-v1` no desenvolvimento local e no conjunto `maex` do D1 publicado. No endereço publicado, ela é compartilhada entre todos os computadores autorizados.

Em todas as transportadoras, o total de cada registro e do fechamento é `Valor do Frete + TDE`. O frete base vem da coluna `Valor do Frete` (BA); para relatórios alternativos sem BA, usa a coluna de frete reconhecida. O sistema não adiciona separadamente Frete Valor, TDA, TRT ou outras taxas, e nunca exibe total abaixo de zero. A exportação da Argius divide esse total em dois arquivos conforme a exceção descrita abaixo.

Na exportação, a coluna `Data de Entrega` aparece depois de `Cidade`. Reentregas recebem o texto `REENTREGA`. Registros `CF` recebem o texto `OUTROS`; neles, somente o `Valor do Frete` (BA) é exibido em `Dedicado`, a coluna de frete da transportadora fica vazia e o TDE continua entrando apenas no `Total Comissão`. Quando existem registros `CF`, o arquivo também ganha uma aba `OUTROS` com seus dados, somente o valor BA na coluna `Valor do Frete` e o conteúdo da coluna `Observação` (BQ) do relatório original. A coluna `Frete da Parceira` usa o valor da coluna `Valor Frete Parceiro` (BD) do relatório. Ao selecionar várias transportadoras, o sistema gera um arquivo Excel separado para cada uma.

### 5. Exportação para Excel

O botão de exportação gera um arquivo chamado aproximadamente:

`Fechamento D&Y - 2ª Quinzena de agosto de 2026.xlsx`

Após gerar os arquivos, os CTEs são gravados automaticamente no histórico correspondente. O fechamento principal usa o escopo `normal`; o arquivo MAEX ADICIONAL usa `maex-additional`. Um escopo nunca bloqueia o outro, e a origem gerada pode ser desfeita na primeira página.

O período é definido como primeira quinzena para datas até o dia 15 e segunda quinzena após o dia 15. Cada parceira selecionada gera um arquivo separado. Em geral, o arquivo possui títulos, cabeçalho escuro, formatação monetária em reais, filtro, congelamento do cabeçalho e linha final de total em destaque amarelo.

No formato padrão, cada uma das cinco linhas iniciais do cabeçalho é mesclada individualmente de `A` até a última coluna da tabela.

O fechamento normal da Maex é a exceção institucional dentro desse formato. Ele usa sete linhas mescladas até a última coluna: `Empresa: GISE TRANSPORTES LTDA`, endereço da Rua Carlos Marcondes, CNPJ `53.823.705/0001-75` e IE `135.201.059.11`, dados bancários do Bradesco, período abreviado como `1° Quinzena de agosto / 26`, uma linha em branco e `Parceiro: MAEX`. O cabeçalho preto da tabela começa na linha 8 e os registros começam na linha 9. Essa alteração não afeta o arquivo `MAEX ADICIONAL`, que mantém seu layout próprio.

O cabeçalho da tabela padrão fica na linha 6 e possui 12 colunas: `Entrada`, `CTE`, `NF`, `Remetente`, `Destinatário`, `Cidade`, `Data de Entrega`, `TDE`, `Dedicado`, `TDA`, `Frete da Parceira` e `Total Comissão`. TDA e TRT representam o mesmo serviço, então a exportação mostra somente `TDA`: usa primeiro o valor de TDA e, quando ele estiver vazio ou zerado, reaproveita o valor de TRT, sem somar os dois. A linha final soma a coluna L. As cinco linhas institucionais são mescladas individualmente de A até L.

A Fitlog possui uma exceção apenas de formato. A aba principal `DadosExcel` mantém todos os registros e a coluna `TDE`, mas não possui a coluna `Dedicado`; por isso o cabeçalho vai de A até K e o total fica na coluna K. Não existe aba TDE separada. Em todas as transportadoras, inclusive a Fitlog, cada linha de `Total Comissão` é calculada como `Valor do Frete` (BA) + TDE, e a linha final soma esses totais.

A exportação da Argius é uma exceção e gera sempre dois arquivos separados, ambos em tabela direta, sem as cinco linhas institucionais, com cabeçalho preto, linhas alternadas claras e uma linha amarela de soma total no final.

O arquivo normal se chama aproximadamente `Fechamento Argius - 2ª Quinzena de agosto de 2026.xlsx`. Ele mantém `Entrada`, `CTE`, `NF`, `Remetente`, CNPJ do remetente, `Destinatário`, CNPJ do destinatário e `Cidade`, não mostra as colunas TDA, TDE e Dedicado e termina em `Total Comissão`. O valor líquido de cada linha é calculado como `Total Comissão original - TDA - TDE - Dedicado`, limitado a zero para nunca ficar negativo.

O segundo arquivo se chama aproximadamente `Fechamento Adicionais Argius - 2ª Quinzena de agosto de 2026.xlsx`. Ele inclui somente documentos que possuam ao menos um adicional, preserva os mesmos dados do cliente e mostra as colunas na ordem `TDA`, `TDE`, `Dedicado` e `Total Comissão`. Nesse arquivo, o total da linha é `TDA + TDE + Dedicado`. Para CF, o Dedicado continua usando o Valor do Frete (BA). A linha final soma todos os adicionais.

#### Arquivo MAEX ADICIONAL

Quando a Maex é selecionada para exportação, o fechamento normal usa somente sua própria elegibilidade e seu histórico. Se houver remetentes marcados entre os documentos adicionais ainda em aberto até a data final escolhida, o sistema gera um arquivo separado chamado aproximadamente `Fechamento Adicional Maex - 1 Quinzena de agosto de 2026.xlsx`. O adicional pode ser gerado mesmo quando não há documentos novos no fechamento normal.

O adicional segue o modelo fornecido pelo usuário:

- aba `TEMP_EXPORT`;
- linhas 1 a 7 mescladas individualmente de A até J;
- período no padrão `1° Quinzena de agosto / 26` ou `2° Quinzena ...`;
- aviso de adicional de móveis em faixa vermelha na linha 6;
- identificação `Parceiro: MAEX` na linha 7;
- cabeçalho preto na linha 8 com `EMISSÃO`, `Mde`, `CTE`, `NF`, `REMETENTE`, `DESTINATARIO`, `CIDADE`, `PESO`, `VOL` e `TAXA DE MOVEIS`;
- não possui coluna de entrega e usa apenas a data de emissão para o corte do fechamento adicional;
- taxa fixa de R$ 15 por documento;
- linha final amarela com fórmula de soma da coluna J;
- datas em `dd/mm/aaaa` e MDe/CTE mantidos como texto para evitar notação científica ou perda de zeros.

O arquivo adicional não possui mais a coluna `ENTREGA`. Ele não substitui nem altera os valores ou o histórico do fechamento normal da Maex. Quando esse documento receber data de entrega em uma importação futura, ele ainda poderá entrar no fechamento normal.

### 6. Persistência e limites

- `gmobs-closing-v3`: registros atualmente importados, identificações manuais e transportadoras cadastradas a partir desses registros. Fica no IndexedDB `gmobs-closing-storage`, cuja capacidade é adequada para relatórios grandes.
- `gmobs-general-import-info-v1`: metadados locais do último relatório geral, incluindo arquivo, quantidades e maior Data de Emissão da coluna F. No site publicado, o mesmo conteúdo fica dentro de `closing` no D1.
- `gmobs-scanned-ctes-v1`: bipagens da Argius, TRD e D&Y, encontradas ou aguardando.
- `gmobs-tde-rates-v1`: taxas TDE importadas, nome/resumo do último arquivo e cadastros manuais.
- `gmobs-maex-additional-senders-v1`: remetentes marcados para o adicional da Maex, identificados por CNPJ ou nome normalizado.
- `gmobs-billed-documents-v1`: histórico no IndexedDB dos documentos enviados, identificado por escopo (`normal` ou `maex-additional`) + transportadora + CTE e acompanhado dos arquivos de origem. Dados antigos são normalizados ao carregar; fontes chamadas `Fechamento Adicional Maex` migram automaticamente para o escopo adicional.
- `gmobs-romaneios-v1`: linhas importadas dos romaneios, arquivos de origem, resumo da última importação, situações gravadas dos documentos, nomes de rota editados, notas manuais de frete, observações, quantidades de coleta e descontos parcelados dos motoristas.
- O D1 guarda os seis conjuntos duráveis `closing`, `scans`, `tde`, `maex`, `billed` e `romaneios`. O cliente compacta cada conjunto com gzip antes do envio e a API divide a carga em blocos de até 1,5 MB, abaixo do limite de 2 MB por linha do D1.
- A tabela `cloud_state_chunks` usa a chave primária composta `(owner_id, state_key, chunk_index)`. No site publicado, todos os logins autorizados usam o proprietário lógico `shared:fechamentos-gmobs`, formando um banco operacional único para a equipe.
- `app/auth.ts` valida as credenciais recebidas contra `GMOBS_LOGIN_USER` e `GMOBS_LOGIN_PASSWORD`, configuradas na hospedagem. A sessão dura oito horas, é assinada com `GMOBS_SESSION_SECRET` e fica em cookie HttpOnly, Secure e SameSite Strict. Senha e segredo não pertencem ao código nem ao Git.
- A API aceita somente os seis conjuntos conhecidos, limita o tamanho recebido, usa comandos preparados e exige sessão válida fora do ambiente local.
- A sincronização acontece cerca de 600 milissegundos depois de uma alteração. Várias mudanças rápidas são agrupadas pelo atraso, e o processamento pesado de compactação ocorre no navegador para não consumir o limite reduzido de CPU do servidor gratuito.
- O site consulta as versões dos seis conjuntos a cada 60 segundos, ao voltar para a aba e ao receber foco. Quando detecta alteração feita por outro computador, recarrega apenas os conjuntos modificados.
- Se o banco não responder, a interface publicada bloqueia a operação e oferece nova tentativa. Ela não usa uma cópia local silenciosa, evitando que dois computadores trabalhem com estados divergentes.
- Ao abrir uma versão atualizada, um relatório que ainda esteja no antigo `localStorage` é migrado automaticamente para o IndexedDB. A cópia antiga só é removida após o novo salvamento ser concluído.
- Se o IndexedDB não estiver disponível, o sistema tenta o `localStorage` como alternativa. Se ambos recusarem a gravação, a tela não cai: o relatório permanece aberto na sessão e aparece um aviso para não recarregar antes de exportar.
- A correção foi validada com um relatório real de 7,8 MB contendo 18.116 registros elegíveis; somente os registros importados resultavam em aproximadamente 14,5 MB de dados serializados, acima da capacidade comum do `localStorage`.
- O histórico foi validado com 28 fechamentos antigos: todos foram reconhecidos, totalizando 9.525 linhas lidas e 6.114 documentos únicos depois de remover duplicatas. No relatório real de 18.116 registros, 6.183 linhas corresponderam a CTEs já faturados; a diferença para os CTEs únicos decorre de ocorrências repetidas/reentregas do mesmo documento.
- O fechamento recebido da Pajuçara e o resultado da comparação não são gravados no `localStorage`.
- Importar outra planilha substitui `gmobs-closing-v3`, mas não apaga `gmobs-scanned-ctes-v1`.
- Importar outra lista TDE substitui as taxas com origem no arquivo e preserva os registros manuais.
- A taxa manual prevalece sobre a taxa importada para o mesmo CNPJ + transportadora.
- Git guarda apenas o código. Nenhum dado operacional, credencial ou segredo é levado para outra máquina pelo repositório.
- Limpar os dados do navegador publicado encerra a sessão, mas não apaga o conteúdo central do D1.
- A tela Importar possui `Baixar backup completo` e `Restaurar backup`. O arquivo JSON inclui relatório geral, romaneios, bipagens, TDE, remetentes adicionais da Maex e histórico de faturamento.
- Como `127.0.0.1` e o endereço publicado são domínios diferentes, os dados antigos não atravessam automaticamente na primeira publicação. É necessário baixar o backup no site local e restaurá-lo uma vez no site publicado; depois todos os computadores autorizados passam a usar o mesmo banco.

## Estrutura importante

- `app/page.tsx`: tela principal, estado da aplicação, identificação de parceiras, filtros, prévia e comando de exportação.
- `app/excel.ts`: leitura das planilhas, reconhecimento de colunas, normalização e criação do Excel final.
- `app/storage.ts`: armazenamento de maior capacidade dos registros importados e migração segura do antigo `localStorage` para IndexedDB.
- `app/cloud-storage.ts`: compactação, leitura e gravação dos seis conjuntos persistentes na API do D1.
- `app/auth.ts` e `app/api/auth/`: validação do login, criação e encerramento da sessão assinada.
- `app/api/cloud-state/route.ts`: API protegida de leitura e gravação do estado compartilhado em blocos.
- `app/globals.css`: aparência responsiva da interface.
- `app/layout.tsx`: título e descrição da aplicação.
- `app/chatgpt-auth.ts`: arquivo legado de funções do starter; o fluxo ativo usa `app/auth.ts` e as rotas em `app/api/auth/`.
- `db/schema.ts`: tabela ativa `cloud_state_chunks` do Cloudflare D1; as migrações geradas ficam em `drizzle/`.
- `worker/index.ts`: entrada do Cloudflare Worker/vinext.
- `legacy/site/`: versão antiga do sistema, mantida para consulta; não deve ser alterada sem necessidade.
- `tests/rendered-html.test.mjs`: teste herdado do starter. Ele ainda verifica a tela inicial do template e provavelmente precisa ser substituído por testes do sistema GMOBS.
- `README.md`: ainda descreve principalmente o starter vinext e precisa ser atualizado para documentar o produto GMOBS.

## Tecnologias e requisitos

- Node.js `>= 22.13.0`;
- React 19;
- TypeScript;
- vinext/Vite;
- Cloudflare Workers/Sites;
- `xlsx-js-style` para importação e exportação;
- Cloudflare D1 com esquema e migração em Drizzle ORM.

## Como continuar em outra máquina

```powershell
git clone URL_DO_REPOSITORIO
cd fechamentoGmobs
npm install
npx vite --host
```

No Windows, prefira `npx vite --host`: os scripts `npm run dev/build/start` usam atribuição de variável no formato Unix e podem falhar no PowerShell. Para validar a compilação, use `npx vite build`.

Abrir no navegador o endereço informado pelo terminal. Para continuar no Codex, abrir a pasta clonada e pedir:

> Leia `AGENTS.md` e `CONTEXTO_DO_PROJETO.md` por completo, confira o estado atual do Git e preserve todas as regras de importação, cálculo, bipagem, identificação e exportação documentadas antes de alterar o projeto.

Antes de trabalhar, trazer a versão mais recente:

```powershell
git pull
```

Depois de terminar uma etapa:

```powershell
git add .
git commit -m "Descrição clara da alteração"
git push
```

### Checklist de continuidade para outro chat

1. Confirmar que os commits mais recentes foram enviados ao GitHub antes de trocar de computador.
2. Ler `AGENTS.md` e este documento integralmente.
3. Executar `git status` e não apagar alterações existentes.
4. Abrir `app/page.tsx`, `app/excel.ts` e `app/globals.css` antes de mudar regras.
5. Lembrar que a planilha real e as bipagens não vêm no clone do Git. No site publicado, basta entrar com as credenciais da equipe para acessar os dados compartilhados; o backup é necessário apenas para a migração inicial do antigo endereço local.
6. Para qualquer mudança financeira, confirmar que o total de todas as transportadoras continua sendo BA + TDE, sem somar TDA, TRT ou outras taxas, e validar separadamente a divisão especial dos valores nos dois arquivos da Argius.
7. Para qualquer mudança em TDE, validar a lista, CNPJ com zero à esquerda, taxa da transportadora correta, cadastro manual e persistência em `gmobs-tde-rates-v1`.
8. Para qualquer mudança de bipagem, validar leitor/digitação, TXT, caixas de seleção, AJ, AK, `AGUARDANDO`, `OK`, nova importação e persistência no D1 compartilhado.
9. Para qualquer mudança de exportação, validar separadamente formato padrão, CF/aba `OUTROS`, os dois arquivos da Argius, a exceção da Fitlog sem Dedicado e a lista de faltantes da Pajuçara.
10. Para qualquer mudança na Maex, validar o fechamento normal e o adicional separadamente, incluindo marcação por remetente, nova importação, taxa fixa de R$ 15 e layout A:J sem coluna de entrega.
11. Executar `npx vite build` antes de concluir.
12. Atualizar este documento ao mudar qualquer regra aprovada.
13. Antes de publicar a aba de romaneios, obter aprovação do usuário na prévia local.

## Pontos de atenção

- Não enviar arquivos `.env`, senhas, tokens ou dados confidenciais ao GitHub. O `.gitignore` já ignora `.env*`.
- O repositório contém `package-lock.json` e `pnpm-lock.yaml`. É melhor escolher apenas um gerenciador de pacotes futuramente; por enquanto, os comandos documentados usam npm.
- O commit inicial incluiu arquivos internos de `.pnpm-store` e `tsconfig.tsbuildinfo`; convém removê-los do controle de versão e adicioná-los ao `.gitignore` em uma limpeza futura.
- O sistema substitui os dados anteriores quando uma nova planilha é importada; ele não acumula importações.
- A substituição da planilha não apaga as bipagens, que ficam em outro conjunto persistente (`scans`).
- No endereço local, IndexedDB e `localStorage` continuam específicos daquele navegador. No endereço publicado, não são usados como fonte operacional: o D1 compartilhado carrega os dados depois do login. Para a primeira migração do endereço local, use o backup completo.
- O modelo PDF da Argius contém dados operacionais e não foi copiado para o repositório. A estrutura visual necessária está descrita neste documento e implementada em `buildArgiusSheet`.
- As regras financeiras e o formato final precisam ser validados com planilhas reais antes do uso definitivo.

## Próximas etapas sugeridas

1. Testar a importação com relatórios reais de diferentes formatos.
2. Conferir os cálculos e a planilha exportada com fechamentos já validados manualmente.
3. Corrigir aliases de colunas ou parceiras que não forem reconhecidos.
4. Manter o `README.md` alinhado com o produto GMOBS e com o endereço publicado.
5. Substituir o teste herdado do starter por testes da importação, cálculos e exportação.
6. Restaurar o primeiro backup no endereço publicado e conferir a recuperação em outro navegador/computador.
7. Limpar arquivos de cache que entraram no primeiro commit.
8. Acompanhar o consumo do plano gratuito e fazer backups periódicos do histórico operacional.
9. Depois da aprovação visual, publicar a aba de romaneios e validar o estado `romaneios` no D1 compartilhado.

## Decisão temporária sobre volume e desempenho

Em 7 de setembro de 2026, ficou decidido manter a arquitetura atual durante um mês de teste operacional das Capas e dos demais módulos. Não migrar o armazenamento antes dessa avaliação sem nova solicitação do usuário.

Ao final do teste, revisar a velocidade de importação, abertura, bipagem, salvamento e geração de relatórios. Se houver lentidão, a prioridade é reorganizar o D1 para salvar cada nota, CT-e, capa e romaneio como registro individual; criar índices por NF, CT-e, chave, data, transportadora e romaneio; consultar somente o período necessário; paginar listas grandes; evitar reenviar todo o histórico a cada alteração; e permitir arquivamento por competência. A hospedagem atual na Cloudflare pode ser mantida nessa reorganização. PostgreSQL, como Supabase ou Neon, fica somente como alternativa futura para um volume ou uma quantidade de usuários muito maior. Antes de qualquer migração, gerar e validar um backup completo do estado atual.

## Regra de manutenção deste documento

Atualize este arquivo sempre que houver uma decisão relevante, mudança de regra de negócio, nova funcionalidade, alteração de arquitetura ou novo próximo passo. Não registre senhas, tokens, dados de clientes ou informações confidenciais.
