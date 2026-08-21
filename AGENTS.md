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
- Incluir registros elegíveis `ET`, `RE` e `CF`.
- Manter registros não identificados visíveis para conferência, mas impedir sua exportação automática.
- Não perder suporte aos aliases de colunas já existentes.
- Usar como total somente `Valor do Frete` (coluna BA). Não somar Frete Valor, TDE, TDA, TRT ou outras taxas separadamente.
- Usar `Valor Frete Parceiro` (coluna BD) na coluna de frete da parceira da exportação.
- Gerar um arquivo Excel separado para cada transportadora selecionada.
- Manter `Data de Entrega` depois de `Cidade`; mostrar `REENTREGA` para RE e `OUTROS` para CF.
- Para CF, deixar o frete da parceira vazio, colocar `Valor do Frete` em `Dedicado` e criar a aba `OUTROS` com `Observação` (BQ), exceto no formato especial da Argius.
- Preservar o modelo especial da Argius: tabela direta sem as cinco linhas institucionais, com cabeçalho preto e linhas alternadas.
- No formato padrão, manter as linhas 1 a 5 mescladas individualmente de A até M.
- Agrupar SIMB, SIMBAX, STX, Tadex, Tadlog e variações de Essessao/Exceção como `Tadex`; agrupar variações contendo TTJB como `TTJB`.
- Preservar a identificação manual de registros desconhecidos, inclusive cadastro de nova transportadora.
- Para Argius, TRD e D&Y, considerar na prévia e exportação somente documentos bipados. Chaves com 44 dígitos buscam AK; leituras menores buscam AJ.
- Manter bipagens não encontradas como `AGUARDANDO` para associação automática em importações futuras.
- Preservar funcionamento responsivo em telas menores.

## Persistência local

- `gmobs-closing-v3` guarda os registros importados e identificações no `localStorage`.
- `gmobs-scanned-ctes-v1` guarda bipagens confirmadas ou aguardando no `localStorage`.
- Uma nova importação substitui os registros, mas não apaga as bipagens.
- Esses dados sobrevivem a recarregamento e novo login no mesmo navegador, mas não acompanham Git, outro navegador ou outro computador.
- Não mude as chaves do `localStorage` nem limpe esses dados sem autorização e uma estratégia de migração.

## Qualidade e validação

- Para mudanças na leitura de planilhas, teste cabeçalhos alternativos, acentos, números brasileiros, datas e linhas de total.
- Para mudanças financeiras, compare entradas e saídas com exemplos calculados manualmente.
- Para mudanças na exportação, abra ou inspecione o `.xlsx` gerado e confira abas, colunas, formatos e totais.
- Para mudanças na bipagem, teste AJ, AK com 44 dígitos, `AGUARDANDO`, reaparecimento após nova importação e remoção manual.
- Para a Argius, compare visualmente a exportação com o modelo de referência fornecido pelo usuário.
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
3. Decidir se bipagens e identificações devem migrar do navegador para a nuvem.
4. Corrigir e ampliar testes automatizados.
5. Atualizar o README do starter.
