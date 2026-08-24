# Fechamentos GMOBS

Aplicação web para importar o relatório geral da GMOBS, conferir documentos por transportadora e exportar um fechamento Excel separado para cada parceira.

As regras completas do produto estão em `CONTEXTO_DO_PROJETO.md`. Antes de alterar cálculos, bipagem, identificação ou exportação, leia também `AGENTS.md`.

## Executar no Windows

Requisitos: Node.js 22.13 ou mais recente e dependências instaladas com `npm install`.

```powershell
npx vite --host
```

Abra o endereço informado pelo terminal. Para validar a versão de produção:

```powershell
npx vite build
```

O script `npm run dev` usa uma variável no formato Unix e pode não funcionar diretamente no PowerShell; por isso o comando recomendado é `npx vite --host`.

## Dados salvos

No endereço publicado, os dados ficam no Cloudflare D1 e são separados pelo usuário autenticado. O banco guarda:

- relatório atual e identificações manuais;
- bipagens da Argius, TRD e D&Y;
- lista de TDE e cadastros manuais;
- remetentes marcados para o MAEX ADICIONAL;
- documentos já enviados ao faturamento.

O IndexedDB e o `localStorage` permanecem como cópia rápida no navegador. A interface abre pela cópia local e sincroniza as alterações com o banco em segundo plano.

O estado é compactado no navegador e dividido em blocos na tabela `cloud_state_chunks`. O esquema fica em `db/schema.ts`, a migração em `drizzle/` e a API autenticada em `app/api/cloud-state/route.ts`.

## Primeira migração do computador para o site publicado

O endereço local e o endereço publicado usam armazenamentos de navegador diferentes. Para levar o conteúdo que já existe no computador:

1. Abra a aplicação local.
2. Na aba **Importar**, clique em **Baixar backup completo**.
3. Abra o endereço publicado e entre com a conta autorizada.
4. Na aba **Importar**, clique em **Restaurar backup** e escolha o arquivo `.json` baixado.
5. Aguarde o cabeçalho mostrar **Dados salvos no banco**.

Depois dessa restauração única, o banco passa a acompanhar o usuário em outros navegadores e computadores. O backup contém dados operacionais e deve ser guardado em local seguro, nunca no Git.

## Validação

```powershell
npx eslint app/page.tsx app/excel.ts app/storage.ts app/cloud-storage.ts app/api/cloud-state/route.ts db/schema.ts
npx vite build
```

O lint completo ainda encontra dois avisos herdados em `legacy/site/app.js`; essa pasta é apenas referência histórica e não faz parte da aplicação ativa.

## Estrutura principal

- `app/page.tsx`: interface, estados, filtros, prévia, backup e sincronização.
- `app/excel.ts`: leitura e exportação das planilhas.
- `app/storage.ts`: cópia local de grande capacidade no IndexedDB.
- `app/cloud-storage.ts`: compactação e comunicação com o banco.
- `app/api/cloud-state/route.ts`: API autenticada do D1.
- `db/schema.ts` e `drizzle/`: esquema e migração do banco.
- `.openai/hosting.json`: configuração lógica do site e do D1.
- `CONTEXTO_DO_PROJETO.md`: regras e histórico detalhados do produto.
