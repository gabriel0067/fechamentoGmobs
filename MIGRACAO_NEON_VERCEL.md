# Migração segura — Neon + Vercel

Esta pasta é uma cópia de migração. O site atual e o banco Cloudflare D1 **não são alterados** por `npm run build`, pelos testes ou pelos scripts de backup. A branch `main` continua sendo a versão do Site atual.

## O que muda

- Neon: banco PostgreSQL separado para o GMOBS. Não compartilhar o banco dos outros projetos.
- Vercel: novo endereço para a aplicação, em projeto separado. O endereço antigo permanece como plano de retorno até a conferência final.
- Next.js nativo: substitui o empacotamento específico da Cloudflare nesta branch.
- A transferência da aplicação foi dividida em partes menores que o limite de 4,5 MB das Functions da Vercel.
- Os seis conjuntos originais (`closing`, `scans`, `tde`, `maex`, `billed`, `romaneios`) são preservados sem converter ou descartar campos. `closing` inclui Capas, Faturamento, Coletas, Dedicados e Financeiro.

Essa primeira etapa preserva o modelo atual de conjuntos inteiros. **Não promete eliminar toda a lentidão**: o navegador ainda carrega o histórico completo e salva um conjunto inteiro quando ele muda. Depois de validar a migração, a melhoria estrutural é separar notas, capas, romaneios etc. em registros consultados por período e índices.

## Antes de qualquer publicação

1. Criar um projeto Neon novo para o GMOBS, de preferência na região próxima aos usuários/Vercel. Usar uma branch de teste e outra de produção. Guardar a URL de conexão como segredo `DATABASE_URL`, nunca no Git.
2. Fazer a cópia integral do D1 usando `scripts/backup-cloud-data.mjs`. Ela lê os seis conjuntos pelo login do site, valida o JSON e verifica se nenhum conjunto mudou durante a leitura. O arquivo `.json.gz` deve ficar fora do Git. O backup antigo da interface não inclui todos os módulos novos e **não é suficiente** para essa migração.
3. Importar primeiro para a branch de teste do Neon com `scripts/import-backup-to-neon.mjs`. O script confere o checksum de cada conjunto e se recusa a sobrescrever dados diferentes.
4. Publicar apenas como novo projeto Vercel de teste, configurando `DATABASE_URL`, `GMOBS_LOGIN_USER`, `GMOBS_LOGIN_PASSWORD` e `GMOBS_SESSION_SECRET` como variáveis de ambiente protegidas. Não usar a URL da produção Neon na prévia.
5. Testar login, importação, busca, bipagem, Romaneio, Capas, Coletas, Dedicados, Faturamento, Financeiro, relatórios e sincronização em dois computadores. Conferir contagens dos seis conjuntos e exportações contra o site antigo.
6. Para a virada: combinar um intervalo sem lançamentos, fazer **novo backup final** do D1, importar em uma branch de produção vazia do Neon, validar contagens/checksums e então apontar o projeto Vercel de produção para essa branch. Manter o site antigo sem excluir dados. Se houver divergência, voltar ao site antigo e não usar os dois sites para lançamentos ao mesmo tempo.

## Execução dos scripts (por quem administra as contas)

As variáveis devem ser inseridas em um terminal privado ou no gerenciador de segredos; **não enviar senha por chat**. No Windows, executar `scripts/backup-cloud-data.ps1`: ele pergunta usuário e senha sem exibir a senha. A alternativa automatizada é configurar `GMOBS_SOURCE_URL`, `GMOBS_LOGIN_USER`, `GMOBS_LOGIN_PASSWORD` e executar `node scripts/backup-cloud-data.mjs`. O arquivo `.json.gz` fica na pasta acima. Para a importação: configurar `DATABASE_URL` da branch Neon vazia e executar `node scripts/import-backup-to-neon.mjs CAMINHO_DO_BACKUP.json.gz`.

No projeto Vercel importado do GitHub, selecionar esta branch como branch de produção apenas quando a migração estiver aprovada. O comando de build é `npm run build` e o framework é Next.js. Configurar as quatro variáveis acima no ambiente correto. O segredo de sessão deve ser aleatório e longo. Variáveis de prévia e produção devem apontar para bancos separados.

## Verificações feitas nesta cópia

- Backup compactado do código original: `backup-fechamentoGmobs-codigo-2026-09-16-d13155c.zip`, na pasta acima do projeto original.
- `npm run build` compilou a aplicação Next.js e suas rotas.
- O teste automatizado do script de backup confirmou a leitura dos seis conjuntos em uma origem simulada.
- **Ainda pendentes:** backup real do D1, criação/importação no Neon, credenciais da Vercel, deploy e testes com dados reais. Nenhuma dessas etapas pode ser dada como concluída apenas pela compilação local.

Referências: [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver), [Next.js na Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [limite de payload das Functions](https://vercel.com/docs/functions/limitations).
