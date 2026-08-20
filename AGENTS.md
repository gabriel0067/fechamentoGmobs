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
- O banco em `db/` está preparado, mas não ativo.
- A autenticação em `app/chatgpt-auth.ts` está disponível, mas não integra o fluxo atual.
- Não copie código da pasta `legacy/site/` sem revisar segurança, compatibilidade e regra de negócio.

## Regras que devem ser preservadas

- Aceitar arquivos `.xls`, `.xlsx` e `.csv`.
- Manter a interface em português do Brasil e valores em BRL.
- Incluir no fechamento apenas entregas e reentregas elegíveis.
- Manter registros não identificados visíveis para conferência, mas impedir sua exportação automática.
- Não perder suporte aos aliases de colunas já existentes.
- Usar o total/comissão informado quando presente; caso contrário, calcular pelos componentes financeiros.
- Gerar uma aba por transportadora selecionada no arquivo Excel final.
- Preservar funcionamento responsivo em telas menores.

## Qualidade e validação

- Para mudanças na leitura de planilhas, teste cabeçalhos alternativos, acentos, números brasileiros, datas e linhas de total.
- Para mudanças financeiras, compare entradas e saídas com exemplos calculados manualmente.
- Para mudanças na exportação, abra ou inspecione o `.xlsx` gerado e confira abas, colunas, formatos e totais.
- Para mudanças visuais, confira desktop e tela estreita.
- Execute, quando aplicável:

```powershell
npm run lint
npm run build
```

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

1. Validar importação e cálculos com relatórios reais anonimizados.
2. Validar o Excel final com fechamentos manuais conhecidos.
3. Corrigir e ampliar testes automatizados.
4. Atualizar o README do starter.
5. Decidir se haverá persistência em nuvem e acesso por usuário.
