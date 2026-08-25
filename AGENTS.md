# Instruções para agentes — Fechamentos GMOBS

## Antes de alterar qualquer coisa

1. Leia `CONTEXTO_DO_PROJETO.md` por completo.
2. Consulte `git status` e preserve alterações existentes do usuário.
3. Examine a implementação atual antes de propor mudanças.
4. Trate `legacy/site/` como referência histórica, não como a aplicação ativa.
5. Não presuma regras financeiras: quando uma regra não estiver clara no código ou no contexto, peça confirmação ao usuário.

## Objetivo do produto

Manter uma aplicação simples, em português do Brasil, para importar o relatório geral da GMOBS, separar entregas/reentregas por transportadora, permitir conferência por período e exportar fechamentos em Excel.

O usuário não é técnico. Explique resultados e decisões em linguagem simples, priorizando o que mudou, como testar e o que ainda falta.

## Aplicação ativa

- Trabalhe principalmente em `app/page.tsx`, `app/excel.ts` e `app/globals.css`.
- Use `app/layout.tsx` para metadados globais.
- O banco Cloudflare D1 em `db/` está ativo no site publicado pela ligação lógica `DB`.
- O site publicado é público na internet, mas o aplicativo exige login próprio antes de carregar qualquer dado.
- Não copie código da pasta `legacy/site/` sem revisar segurança, compatibilidade e regra de negócio.

## Regras que devem ser preservadas

- Aceitar arquivos `.xls`, `.xlsx` e `.csv`.
- Manter a interface em português do Brasil e valores em BRL.
- Incluir registros elegíveis `ET`, `RE` e `CF`.
- Manter registros não identificados visíveis para conferência, mas impedir sua exportação automática.
- Não perder suporte aos aliases de colunas já existentes.
- Em todas as transportadoras, calcular `Total Comissão` e o valor do fechamento como `Valor do Frete` (coluna BA) + TDE. Não somar TDA, TRT ou outras taxas separadamente. Na exportação da Argius, preservar a exceção de divisão desse total entre o arquivo normal e o arquivo de adicionais.
- Tratar TDA e TRT como o mesmo campo na exportação: mostrar somente a coluna `TDA`, usando primeiro o valor de TDA e, quando ele estiver vazio ou zerado, o valor de TRT. Nunca somar os dois.
- Usar `Valor Frete Parceiro` (coluna BD) na coluna de frete da parceira da exportação.
- Na lista de TDE, cruzar o CNPJ do cliente com o `CNPJ Destinatário` do relatório e usar a taxa da coluna da transportadora correspondente.
- Preservar zeros à esquerda no CNPJ; valores numéricos de 12 ou 13 dígitos da planilha devem ser completados até 14 dígitos para a comparação.
- O cadastro manual de TDE deve ter prioridade sobre a lista importada para a mesma combinação CNPJ + transportadora.
- No cadastro manual de TDE, sugerir clientes enquanto o nome é digitado usando a lista TDE e os destinatários do relatório. Agrupar clientes pelo nome normalizado; ao escolher uma sugestão, preencher todos os CNPJs encontrados para esse nome.
- Permitir salvar vários CNPJs de uma vez com o mesmo nome, transportadora e valor TDE. Persistir um registro por CNPJ para manter o cruzamento e agrupar esses registros visualmente na lista de cadastros manuais.
- Na primeira página, permitir importar vários fechamentos antigos `.xls`/`.xlsx` de uma vez para marcar documentos já enviados ao faturamento.
- Identificar um documento faturado por `tipo de fechamento + transportadora + CTE`. Não usar somente NF, pois ela pode se repetir em parceiras diferentes. O histórico normal e o histórico do `MAEX ADICIONAL` são independentes; arquivos e linhas duplicados no mesmo tipo apenas acrescentam a origem ao documento.
- Tratar arquivos com `Custos_extras_MVF` no nome como adicionais da Argius. Nos demais fechamentos históricos, identificar a transportadora pelo nome do arquivo ou por uma indicação explícita no cabeçalho.
- Excluir os documentos já faturados no histórico normal da prévia, dos totais e da exportação normal, mostrando quantos registros do período foram ocultados. Um documento faturado somente no `MAEX ADICIONAL` continua elegível para o fechamento normal quando receber data de entrega. Permitir desfazer uma origem importada sem remover a marcação quando o mesmo CTE também existir em outro arquivo do mesmo tipo.
- Depois de uma exportação bem-sucedida, marcar automaticamente os CTEs no tipo correspondente: normal para o fechamento principal e `maex-additional` para o arquivo adicional.
- Alterar TDE afeta o total de todas as transportadoras: cada linha e o fechamento devem usar BA + TDE.
- Gerar um arquivo Excel separado para cada transportadora selecionada.
- No fechamento normal, quando houver filtro de período, exigir que tanto a data de emissão quanto a data de entrega estejam dentro do intervalo. Se a entrega estiver depois da data final, excluir o documento mesmo que a emissão esteja dentro. `RE`, `CF` e `OUTROS` não exigem data de entrega e continuam seguindo somente a data de emissão.
- Manter `Data de Entrega` depois de `Cidade`; mostrar `REENTREGA` para RE e `OUTROS` para CF.
- Para CF, deixar o frete da parceira vazio, colocar somente `Valor do Frete` (BA) em `Dedicado` e criar a aba `OUTROS` com `Observação` (BQ), exceto no formato especial da Argius. O TDE entra no `Total Comissão`, mas não deve ser misturado ao valor de `Dedicado` nem ao `Valor do Frete` da aba `OUTROS`.
- Preservar o modelo especial da Argius: gerar dois arquivos em tabela direta, sem as cinco linhas institucionais, com cabeçalho preto, linhas alternadas e soma total ao final. O normal mantém os dados do cliente, omite TDA, TDE e Dedicado e usa como total líquido `Total Comissão - TDA - TDE - Dedicado`, sem ficar negativo. O segundo mostra somente registros com adicionais e mantém as colunas na ordem TDA, TDE e Dedicado; seu total por linha é a soma desses três valores.
- No formato padrão, manter as linhas 1 a 5 mescladas individualmente até a última coluna da tabela.
- No fechamento normal da Maex, substituir o cabeçalho padrão pelas sete linhas do modelo GISE: empresa `GISE TRANSPORTES LTDA`, endereço, CNPJ/IE, dados bancários do Bradesco, período abreviado, uma linha em branco e `Parceiro: MAEX`. Mesclar cada uma dessas linhas até a última coluna; o cabeçalho da tabela começa na linha 8.
- A Fitlog é exceção apenas no formato: a aba principal mantém a coluna TDE, não possui a coluna Dedicado e não cria aba TDE separada. Assim como todas as demais, cada linha usa `Valor do Frete + TDE` no `Total Comissão`.
- Agrupar SIMB, SIMBAX, STX, Tadex, Tadlog e variações de Essessao/Exceção como `Tadex`; agrupar variações contendo TTJB como `TTJB`.
- Agrupar o parceiro `ARC` como `D&Y`, preservando o identificador interno `dy` e as mesmas regras de bipagem da D&Y.
- Agrupar Maex e nomes contendo Mardonio como `Maex`.
- Exibir e exportar a parceira exatamente como `PAJUSSARA`, mantendo Pajuçara/Pajucara como aliases reconhecidos e preservando o identificador interno existente.
- Na prévia da Pajussara, permitir importar o fechamento recebido da parceira. Ler a aba que contém `CTRC/SUBC` e `NF`, comparar com o relatório atual pela NF sem zeros à esquerda e sem a série, respeitar ocorrências duplicadas uma a uma e listar o que existe no nosso relatório mas faltou no arquivo deles.
- Permitir baixar os faltantes da Pajussara em Excel com CTE, NF, remetente, destinatário, cidade, datas e Total Comissão. A comparação usa apenas os registros da Pajussara no período filtrado e o arquivo recebido não é persistido.
- Preservar a identificação manual de registros desconhecidos, inclusive cadastro de nova transportadora.
- Para Argius, TRD e D&Y, considerar na prévia e exportação somente documentos bipados. Chaves com 44 dígitos buscam AK; leituras menores buscam AJ.
- Para essas três parceiras, permitir importar um arquivo `.txt` com CTEs. A importação deve adicionar as leituras ao histórico existente, aceitar um CTE por linha ou separado por vírgula e manter os não encontrados como `AGUARDANDO`.
- Na prévia da bipagem, listar documentos que ainda estão sem `OK` e permitir marcá-los manualmente por caixa de seleção. A seleção manual deve usar o mesmo armazenamento persistente das bipagens.
- Manter bipagens não encontradas como `AGUARDANDO` para associação automática em importações futuras.
- Na prévia da Maex, permitir marcar documentos para `MAEX ADICIONAL`. A marcação representa o remetente: usar primeiro o CNPJ do remetente e, se estiver ausente, o nome normalizado. Todos os documentos atuais e futuros desse remetente devem herdar a marcação.
- A exportação da Maex mantém o fechamento normal independente. O `MAEX ADICIONAL` considera os remetentes marcados que ainda estejam em aberto no histórico adicional até a data final escolhida, inclusive sem data de entrega e mesmo que o documento já tenha sido faturado no normal. Gerar o arquivo adicional com taxa fixa de R$ 15 por documento.
- Preservar o layout específico do `MAEX ADICIONAL`: sete linhas iniciais mescladas de A até J, aviso vermelho na linha 6, parceiro na linha 7, cabeçalho preto na linha 8, colunas `EMISSÃO`, `Mde`, `CTE`, `NF`, `REMETENTE`, `DESTINATARIO`, `CIDADE`, `PESO`, `VOL` e `TAXA DE MOVEIS`, sem coluna de entrega e com total amarelo ao final.
- Preservar funcionamento responsivo em telas menores.

## Persistência local e no banco central

- `gmobs-closing-v3` é a chave lógica dos registros importados e identificações. O conteúdo principal fica no IndexedDB `gmobs-closing-storage`, que comporta relatórios maiores.
- A versão antiga em `localStorage` é lida como fallback e migrada automaticamente para o IndexedDB; só depois de uma gravação bem-sucedida a cópia antiga é removida para liberar espaço.
- `gmobs-scanned-ctes-v1` guarda bipagens confirmadas ou aguardando no `localStorage`.
- `gmobs-tde-rates-v1` guarda a lista de taxas TDE importada, o nome do arquivo e os cadastros manuais no `localStorage`.
- `gmobs-maex-additional-senders-v1` guarda os remetentes marcados para o fechamento adicional da Maex no `localStorage`.
- `gmobs-billed-documents-v1` guarda no IndexedDB o histórico de CTEs já enviados, com escopo `normal` ou `maex-additional`, transportadora e arquivos de origem. Registros antigos cujo arquivo contenha `Fechamento Adicional Maex` são migrados automaticamente para o escopo adicional.
- Uma nova importação substitui os registros, mas não apaga as bipagens.
- Uma nova lista de TDE substitui as taxas vindas de arquivo, mas preserva os cadastros manuais.
- A aplicação publicada usa Cloudflare D1 por meio da ligação lógica `DB`. O D1 é a única fonte de dados operacionais no endereço publicado; não carregar nem salvar esses dados no IndexedDB ou `localStorage` do navegador hospedado.
- `app/cloud-storage.ts` compacta o estado no navegador com gzip e sincroniza cinco conjuntos: `closing`, `scans`, `tde`, `maex` e `billed`.
- `app/auth.ts` valida as credenciais configuradas nas variáveis `GMOBS_LOGIN_USER` e `GMOBS_LOGIN_PASSWORD` e cria uma sessão assinada por `GMOBS_SESSION_SECRET` em cookie HttpOnly. Nunca gravar as credenciais no código, Git ou documentação.
- `app/api/cloud-state/route.ts` exige uma sessão válida e usa o proprietário lógico compartilhado `shared:fechamentos-gmobs`, para que todos os computadores autorizados vejam o mesmo conteúdo. A API grava blocos de até 1,5 MB em `cloud_state_chunks`.
- A chave primária `(owner_id, state_key, chunk_index)` deve ser preservada: ela garante leitura indexada sem varrer o banco inteiro.
- No endereço local (`localhost`/`127.0.0.1`) a sincronização automática com a nuvem fica desligada; o D1 local existe apenas para testes da API.
- Se a sessão expirar, a tela volta ao login. Se o D1 não responder, o trabalho fica bloqueado e a interface oferece nova tentativa; não usar cache local silenciosamente como substituto no site publicado.
- O site verifica alterações no banco a cada 60 segundos e ao receber foco, permitindo que diferentes computadores acompanhem o mesmo estado compartilhado.
- A primeira abertura do endereço publicado começa com o banco vazio porque o armazenamento do endereço local pertence a outro domínio. Use `Baixar backup completo` no site local e `Restaurar backup` no site publicado para levar os dados existentes. Depois disso, a sincronização é automática.
- O backup JSON contém dados operacionais reais e não deve ser colocado no Git, enviado por mensagem ou compartilhado sem necessidade.
- Não mude as chaves, o banco IndexedDB nem limpe esses dados sem autorização e uma estratégia de migração.

## Qualidade e validação

- Para mudanças na leitura de planilhas, teste cabeçalhos alternativos, acentos, números brasileiros, datas e linhas de total.
- Para mudanças em TDE, teste CNPJ formatado, CNPJ numérico sem zeros à esquerda, parceira correta, importação antes/depois do relatório e prioridade do cadastro manual.
- Para todas as parceiras, confira que o TDE é somado ao `Total Comissão` uma única vez. Na Fitlog, confira também que a aba principal mostra TDE, não mostra Dedicado e não cria aba TDE separada.
- Para mudanças financeiras, compare entradas e saídas com exemplos calculados manualmente.
- Para mudanças na exportação, abra ou inspecione o `.xlsx` gerado e confira abas, colunas, formatos e totais.
- Para mudanças no filtro, teste emissão e entrega dentro do período, entrega depois da data final, entrega antes da data inicial, ausência de entrega comum e as exceções `RE`, `CF` e `OUTROS`. O MAEX ADICIONAL deve usar somente a emissão.
- Para a validação da Pajussara, teste arquivo com abas `Extrato` e `MAPA`, NF com série no nosso relatório, NF numérica no arquivo deles, zeros à esquerda, NFs duplicadas, período filtrado, lista de faltantes e exportação das pendências.
- Para mudanças na bipagem, teste digitação/leitor, importação TXT, caixa de seleção, AJ, AK com 44 dígitos, `AGUARDANDO`, reaparecimento após nova importação e remoção manual.
- Para mudanças no adicional da Maex, teste persistência por CNPJ/nome do remetente, documento sem data de entrega, documento já faturado no normal, histórico adicional independente, desfazer adicional sem afetar o normal, taxa fixa de R$ 15 e comparação visual do Excel adicional com o modelo aprovado.
- Para mudanças no histórico de faturamento, teste importação múltipla, cabeçalhos em linhas diferentes, duplicatas, `Custos_extras_MVF` como Argius, persistência, desfazer por arquivo, ocultação na prévia e marcação automática após exportar.
- Para a Argius, valide os dois arquivos: dados dos clientes no normal, ausência das três colunas de adicionais, ordem TDA/TDE/Dedicado no segundo arquivo e totais finais em ambos.
- Para mudanças visuais, confira desktop e tela estreita.
- Execute, quando aplicável:

```powershell
npm run lint
npx vite build
```

- No Windows, prefira `npx vite --host` para executar localmente; `npm run dev` pode falhar porque o script atual define variáveis no formato Unix.

- Não considere `npm test` confiável até que `tests/rendered-html.test.mjs` seja atualizado, pois ele ainda testa o starter antigo. Se alterar testes, faça-os representar o comportamento real da aplicação.

## Dados, segurança e Git

- Nunca registre `.env`, tokens, credenciais ou dados reais de clientes no repositório ou nos documentos de contexto.
- Evite incluir planilhas reais com informações operacionais; use amostras anônimas para testes.
- Não altere ou apague mudanças do usuário sem autorização.
- Faça alterações focadas e commits com mensagens claras.
- Não faça `push`, publicação ou mudanças externas sem pedido do usuário.

## Documentação contínua

Ao concluir uma etapa relevante:

1. atualize `CONTEXTO_DO_PROJETO.md` com o novo estado;
2. registre decisões de regra de negócio e limitações conhecidas;
3. atualize a lista de próximas etapas;
4. mantenha este `AGENTS.md` curto e voltado a instruções duráveis.

## Prioridades atuais

1. Validar bipagem e exportação com uma quinzena real completa.
2. Validar o Excel da Argius contra o modelo aprovado.
3. Confirmar no endereço publicado que o primeiro backup local foi restaurado e aparece em outro computador.
4. Corrigir e ampliar testes automatizados.
5. Atualizar o README do starter.
