# Contexto do projeto — Fechamentos GMOBS

## Objetivo

Este projeto transforma o processo de fechamento de transportadoras/parceiras em um fluxo web simples. O usuário importa um relatório geral em Excel ou CSV, confere os registros separados por parceira e exporta um arquivo Excel separado para cada transportadora escolhida.

Este documento existe para permitir a continuidade do trabalho em outra máquina ou em uma nova conversa com o Codex sem precisar reexplicar o projeto desde o início.

## Estado atual em 21/08/2026

- O projeto foi colocado no Git e enviado ao GitHub.
- A branch de trabalho é `main`.
- O primeiro commit é `24ea783` (`first commit`).
- A interface principal já está implementada em React/TypeScript.
- O fluxo Importar → Prévia → Exportar já está programado.
- O projeto antigo foi preservado em `legacy/site/` somente como referência.
- Ainda não há banco de dados ativo: `db/schema.ts` está vazio e `.openai/hosting.json` mantém D1 e R2 como `null`.
- Os dados importados são guardados no `localStorage` do navegador, usando a chave `gmobs-closing-v3`. Portanto, esses dados não acompanham o Git e não aparecem automaticamente em outra máquina. A planilha original deve ser importada novamente na outra máquina.
- As bipagens são guardadas separadamente em `gmobs-scanned-ctes-v1`, também no `localStorage`. Elas sobrevivem a novas importações e novo login no mesmo navegador, mas não migram para outro computador.

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

Os campos reconhecidos incluem parceira e CNPJ do redespacho, ocorrência, status, data de emissão, data de entrega, CTE, chave do CTE, nota fiscal/minuta, remetente e CNPJ, destinatário e CNPJ, cidade, observação, fretes, TDE, TDA, TRT, reentrega, dedicado, ajuste e total informado.

#### Colunas importantes do relatório GMOBS

- `AJ - CT-e Parceiro`: número curto usado na bipagem quando a leitura possui menos de 44 dígitos.
- `AK - Chave CT-e Parceiro`: chave de acesso usada quando a bipagem possui exatamente 44 dígitos.
- `BA - Valor do Frete`: única fonte do total do registro e do fechamento.
- `BD - Valor Frete Parceiro`: fonte da coluna `Frete da Parceira` na exportação padrão.
- `BQ - Observação`: texto levado para a aba `OUTROS` nos registros CF.
- Os CNPJs e nomes de remetente, destinatário e redespacho são localizados pelo par de cabeçalhos `CNPJ ...` seguido de `Nome`, evitando ambiguidade entre as várias colunas chamadas `Nome`.

### 2. Identificação das parceiras

Em `app/page.tsx`, há aliases para:

- Argius;
- Fitlog;
- Maex;
- Displan;
- TRD;
- D&Y;
- Pajuçara;
- Rio Vermelho.

Uma transportadora desconhecida recebe um identificador próprio baseado no nome recebido. Linhas sem nome de parceira aparecem como **Não identificado** e não podem ser exportadas até que essa situação seja tratada.

Os nomes SIMB, SIMBAX, STX, Tadex, Tadlog e Essessao são agrupados como **Tadex**. Todas as variações contendo TTJB são agrupadas como **TTJB**. Na prévia de registros não identificados, o sistema mostra CNPJ do redespacho, nome/razão social recebido, remetentes, cidades e exemplos de documentos, permitindo atribuir o grupo a uma transportadora conhecida ou cadastrar uma nova antes da exportação. A nova transportadora fica salva com os registros no navegador e passa a aparecer nas opções seguintes.

A identificação manual altera todos os registros do mesmo grupo, priorizando o CNPJ do redespacho como chave. Se o CNPJ estiver ausente, usa o nome recebido e, por último, o remetente como pista de agrupamento.

### 3. Entregas e reentregas

O sistema considera um registro como reentrega quando:

- encontra o código `RE` no status, descrição, ocorrência, CTE ou nota; ou
- encontra CTE e nota repetidos para a mesma parceira durante a importação.

O resumo da importação mostra quantidade importada, reentregas, registros fora do fechamento e registros sem parceira.

### 4. Prévia do fechamento

A tela possui três etapas:

1. **Importar**: seleção do relatório geral.
2. **Prévia**: filtro por período e visão por transportadora.
3. **Exportar**: seleção das transportadoras e geração do fechamento.

Na prévia são exibidos:

- quantidade de notas únicas;
- quantidade de CTEs/minutas únicas;
- quantidade de reentregas;
- valor total do fechamento.

Argius, TRD e D&Y usam conferência por bipagem do CTE da parceira. Leituras com exatamente 44 dígitos são procuradas na coluna `Chave CT-e Parceiro` (AK); leituras menores são procuradas na coluna `CT-e Parceiro` (AJ). A marcação `OK` é feita na prévia, fica salva no navegador em `gmobs-scanned-ctes-v1` e permanece entre acessos, novo login no mesmo navegador e novas importações. Se um CTE bipado ainda não existir no relatório, ele fica como `AGUARDANDO` e recebe `OK` automaticamente quando aparecer em uma importação futura da mesma parceira. Para essas três parceiras, quantidades, valores e exportação consideram somente documentos bipados que já apareceram no relatório. Uma bipagem pode ser removida em caso de erro.

As bipagens são separadas por identificador da parceira. O mesmo número bipado para Argius não libera automaticamente um documento da TRD ou D&Y. O valor salvo é a leitura normalizada e a data/hora ISO da bipagem. Ao reimportar, o sistema cruza novamente as leituras salvas com AJ e AK; por isso não se deve apagar `gmobs-scanned-ctes-v1`.

O total usa exclusivamente o valor da coluna `Valor do Frete` quando ela existe no relatório. O sistema não adiciona separadamente Frete Valor, TDE, TDA, TRT ou outras taxas, pois esses componentes já estão consolidados nessa coluna. Para relatórios alternativos sem `Valor do Frete`, usa somente a coluna de frete reconhecida, nunca exibindo valor abaixo de zero.

Na exportação, a coluna `Data de Entrega` aparece depois de `Cidade`. Reentregas recebem o texto `REENTREGA`. Registros `CF` recebem o texto `OUTROS`; neles, o `Valor do Frete` é exibido em `Dedicado`, a coluna de frete da transportadora fica vazia e o valor entra no total apenas uma vez. Quando existem registros `CF`, o arquivo também ganha uma aba `OUTROS` com seus dados e o conteúdo da coluna `Observação` (BQ) do relatório original. A coluna `Frete da Parceira` usa o valor da coluna `Valor Frete Parceiro` (BD) do relatório. Ao selecionar várias transportadoras, o sistema gera um arquivo Excel separado para cada uma.

### 5. Exportação para Excel

O botão de exportação gera um arquivo chamado aproximadamente:

`Fechamento D&Y - 2ª Quinzena de agosto de 2026.xlsx`

O período é definido como primeira quinzena para datas até o dia 15 e segunda quinzena após o dia 15. Cada parceira selecionada gera um arquivo separado. Em geral, o arquivo possui títulos, cabeçalho escuro, formatação monetária em reais, filtro, congelamento do cabeçalho e linha final de total em destaque amarelo.

No formato padrão, cada uma das cinco linhas iniciais do cabeçalho é mesclada individualmente de `A` até `M` (`A1:M1` até `A5:M5`).

O cabeçalho da tabela padrão fica na linha 6 e possui 13 colunas: `Entrada`, `CTE`, `NF`, `Remetente`, `Destinatário`, `Cidade`, `Data de Entrega`, `TDE`, `TDA`, `Dedicado`, `TRT`, `Frete da Parceira` e `Total Comissão`. A linha final soma a coluna M.

A exportação da Argius é uma exceção e segue o modelo fornecido em `fechamento exemplo.pdf`: uma tabela direta com Entrada, CTE, NF, Remetente/CNPJ, Destinatário/CNPJ, Cidade, TDE, TDA, Dedicado e Total Comissão, cabeçalho preto e linhas alternadas claras.

O modelo da Argius não possui as cinco linhas institucionais, aba extra `OUTROS` nem linha final amarela. A primeira linha já é o cabeçalho com 12 colunas: `Entrada`, `CTE`, `NF`, `Remetente`, `CNPJ`, `Destinatário`, `CNPJ`, `Cidade`, `TDE`, `TDA`, `Dedicado` e `Total Comissão`. Preservar essa exceção mesmo que o formato padrão mude.

### 6. Persistência e limites

- `gmobs-closing-v3`: registros atualmente importados, identificações manuais e transportadoras cadastradas a partir desses registros.
- `gmobs-scanned-ctes-v1`: bipagens da Argius, TRD e D&Y, encontradas ou aguardando.
- Importar outra planilha substitui `gmobs-closing-v3`, mas não apaga `gmobs-scanned-ctes-v1`.
- Git guarda apenas o código. Nenhum dos dois conjuntos do `localStorage` é levado para outra máquina.
- Limpar dados do site, usar navegação privada, trocar de navegador ou trocar de computador remove o acesso local às informações.
- Ainda não há recurso de backup/importação das bipagens nem persistência em D1.

## Estrutura importante

- `app/page.tsx`: tela principal, estado da aplicação, identificação de parceiras, filtros, prévia e comando de exportação.
- `app/excel.ts`: leitura das planilhas, reconhecimento de colunas, normalização e criação do Excel final.
- `app/globals.css`: aparência responsiva da interface.
- `app/layout.tsx`: título e descrição da aplicação.
- `app/chatgpt-auth.ts`: funções prontas para autenticação via ChatGPT, ainda não utilizadas pela tela principal.
- `db/`: estrutura preparada para Cloudflare D1/Drizzle, mas sem tabelas ativas.
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
- Drizzle ORM preparado para eventual banco D1.

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
5. Lembrar que a planilha real e as bipagens não vêm no clone; importar o relatório novamente e, se necessário, rebipar documentos no novo computador.
6. Para qualquer mudança financeira, confirmar que o total continua vindo somente de BA.
7. Para qualquer mudança de bipagem, validar AJ, AK, `AGUARDANDO`, `OK`, nova importação e persistência local.
8. Para qualquer mudança de exportação, validar separadamente formato padrão, CF/aba `OUTROS` e exceção Argius.
9. Executar `npx vite build` antes de concluir.
10. Atualizar este documento ao mudar qualquer regra aprovada.

## Pontos de atenção

- Não enviar arquivos `.env`, senhas, tokens ou dados confidenciais ao GitHub. O `.gitignore` já ignora `.env*`.
- O repositório contém `package-lock.json` e `pnpm-lock.yaml`. É melhor escolher apenas um gerenciador de pacotes futuramente; por enquanto, os comandos documentados usam npm.
- O commit inicial incluiu arquivos internos de `.pnpm-store` e `tsconfig.tsbuildinfo`; convém removê-los do controle de versão e adicioná-los ao `.gitignore` em uma limpeza futura.
- O sistema substitui os dados anteriores quando uma nova planilha é importada; ele não acumula importações.
- A substituição da planilha não apaga as bipagens, que ficam em outra chave do `localStorage`.
- Como o armazenamento atual é local ao navegador, abrir o site em outro navegador ou computador começa sem dados importados.
- O modelo PDF da Argius contém dados operacionais e não foi copiado para o repositório. A estrutura visual necessária está descrita neste documento e implementada em `buildArgiusSheet`.
- As regras financeiras e o formato final precisam ser validados com planilhas reais antes do uso definitivo.

## Próximas etapas sugeridas

1. Testar a importação com relatórios reais de diferentes formatos.
2. Conferir os cálculos e a planilha exportada com fechamentos já validados manualmente.
3. Corrigir aliases de colunas ou parceiras que não forem reconhecidos.
4. Atualizar `README.md` para refletir o produto GMOBS.
5. Substituir o teste herdado do starter por testes da importação, cálculos e exportação.
6. Decidir se os fechamentos precisam ficar salvos na nuvem; se sim, implementar autenticação e banco D1.
7. Limpar arquivos de cache que entraram no primeiro commit.
8. Publicar a aplicação quando o fluxo estiver validado.

## Regra de manutenção deste documento

Atualize este arquivo sempre que houver uma decisão relevante, mudança de regra de negócio, nova funcionalidade, alteração de arquitetura ou novo próximo passo. Não registre senhas, tokens, dados de clientes ou informações confidenciais.
