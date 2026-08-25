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

No endereço publicado, os dados ficam no Cloudflare D1 central. O endereço pode ser aberto por qualquer pessoa, mas o aplicativo exige login antes de carregar a interface ou permitir acesso aos dados. Todos os computadores autorizados usam o mesmo conteúdo compartilhado. O banco guarda:

- relatório atual e identificações manuais;
- bipagens da Argius, TRD e D&Y;
- lista de TDE e cadastros manuais;
- remetentes marcados para o MAEX ADICIONAL;
- documentos já enviados ao faturamento, separando o histórico normal do histórico do MAEX ADICIONAL.

No site publicado, o navegador não usa IndexedDB nem `localStorage` como fonte de dados operacionais: a interface abre diretamente pelo banco e bloqueia o trabalho se ele estiver indisponível. O armazenamento local permanece apenas no endereço de desenvolvimento (`localhost`) e serve para a migração inicial por backup.

O estado é compactado no navegador e dividido em blocos na tabela `cloud_state_chunks`. O esquema fica em `db/schema.ts`, a migração em `drizzle/`, a sessão assinada em `app/auth.ts` e a API protegida em `app/api/cloud-state/route.ts`. Usuário, senha e segredo de sessão são variáveis protegidas da hospedagem e nunca devem ser colocados no repositório.

## Primeira migração do computador para o site publicado

O endereço local e o endereço publicado usam armazenamentos de navegador diferentes. Para levar o conteúdo que já existe no computador:

1. Abra a aplicação local.
2. Na aba **Importar**, clique em **Baixar backup completo**.
3. Abra o endereço publicado e entre com as credenciais fornecidas ao time.
4. Na aba **Importar**, clique em **Restaurar backup** e escolha o arquivo `.json` baixado.
5. Aguarde o cabeçalho mostrar **Dados salvos no banco**.

Depois dessa restauração única, todos os computadores que entrarem no aplicativo passam a usar o mesmo banco. A tela atualiza mudanças externas a cada 60 segundos e quando a janela volta a receber foco. O backup contém dados operacionais e deve ser guardado em local seguro, nunca no Git.

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
- `app/auth.ts` e `app/api/auth/`: login e sessão assinada em cookie HttpOnly.
- `app/api/cloud-state/route.ts`: API protegida do D1 compartilhado.
- `db/schema.ts` e `drizzle/`: esquema e migração do banco.
- `.openai/hosting.json`: configuração lógica do site e do D1.
- `CONTEXTO_DO_PROJETO.md`: regras e histórico detalhados do produto.


alo teste 
