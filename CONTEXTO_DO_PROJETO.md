# Contexto do projeto — Fechamentos GMOBS

## Objetivo

Este projeto transforma o processo de fechamento de transportadoras/parceiras em um fluxo web simples. O usuário importa um relatório geral em Excel ou CSV, confere os registros separados por parceira e exporta um único arquivo Excel com uma aba para cada transportadora escolhida.

Este documento existe para permitir a continuidade do trabalho em outra máquina ou em uma nova conversa com o Codex sem precisar reexplicar o projeto desde o início.

## Estado atual em 20/08/2026

- O projeto foi colocado no Git e enviado ao GitHub.
- A branch de trabalho é `main`.
- O primeiro commit é `24ea783` (`first commit`).
- A interface principal já está implementada em React/TypeScript.
- O fluxo Importar → Prévia → Exportar já está programado.
- O projeto antigo foi preservado em `legacy/site/` somente como referência.
- Ainda não há banco de dados ativo: `db/schema.ts` está vazio e `.openai/hosting.json` mantém D1 e R2 como `null`.
- Os dados importados são guardados no `localStorage` do navegador, usando a chave `gmobs-closing-v3`. Portanto, esses dados não acompanham o Git e não aparecem automaticamente em outra máquina. A planilha original deve ser importada novamente na outra máquina.

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
- inclui apenas registros entregues ou de reentrega quando há status reconhecido (`ET`, `RE`, `ENTREGUE` ou `REENTREGA`);
- informa quantos registros ficaram fora do fechamento.

Os campos reconhecidos incluem parceira, ocorrência, status, data, CTE, nota fiscal/minuta, remetente, destinatário, cidade, frete, TDE, TDA, TRT, reentrega, dedicado, ajuste e total/comissão informado.

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

O total usa o valor de total/comissão informado na planilha quando ele existe. Caso contrário, soma frete + TDE + TDA + TRT + reentrega + dedicado + ajuste, nunca exibindo valor abaixo de zero.

### 5. Exportação para Excel

O botão de exportação gera um arquivo chamado aproximadamente:

`Fechamentos - 1ª Quinzena de agosto de 2026.xlsx`

O período é definido como primeira quinzena para datas até o dia 15 e segunda quinzena após o dia 15. Cada parceira selecionada ganha uma aba própria. O arquivo possui títulos, cabeçalho escuro, formatação monetária em reais, filtro, congelamento do cabeçalho e linha final de total em destaque amarelo.

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
npm run dev
```

Abrir no navegador o endereço informado pelo terminal. Para continuar no Codex, abrir a pasta clonada e pedir:

> Leia `CONTEXTO_DO_PROJETO.md` e `AGENTS.md`, confira o estado atual do Git e continue o desenvolvimento.

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

## Pontos de atenção

- Não enviar arquivos `.env`, senhas, tokens ou dados confidenciais ao GitHub. O `.gitignore` já ignora `.env*`.
- O repositório contém `package-lock.json` e `pnpm-lock.yaml`. É melhor escolher apenas um gerenciador de pacotes futuramente; por enquanto, os comandos documentados usam npm.
- O commit inicial incluiu arquivos internos de `.pnpm-store` e `tsconfig.tsbuildinfo`; convém removê-los do controle de versão e adicioná-los ao `.gitignore` em uma limpeza futura.
- O sistema substitui os dados anteriores quando uma nova planilha é importada; ele não acumula importações.
- Como o armazenamento atual é local ao navegador, abrir o site em outro navegador ou computador começa sem dados importados.
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
