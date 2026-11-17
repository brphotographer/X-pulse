# X PULSE — Monitoramento Multirrede

Painel experimental para acompanhar publicações públicas sobre interrupções de energia, conectividade e infraestrutura.

## Fontes na primeira versão
- **Bluesky:** busca pública pela AppView oficial, sem login ou token.
- **Mastodon:** linhas do tempo públicas de hashtags no servidor configurado (padrão: mastodon.social). O servidor pode limitar ou desativar a visualização pública.

A aplicação não usa login pessoal, não acessa mensagens privadas e não consulta a API paga do X nesta versão.

## Executar localmente
- Node.js 18 ou superior
- Execute `npm start` e abra http://localhost:3000.

## Configuração opcional
- `MASTODON_HOST`: servidor Mastodon a consultar. Padrão: `mastodon.social`.
- Não é necessário configurar `X_BEARER_TOKEN`.

## Atualização e limites
- O navegador atualiza o painel a cada 5 minutos.
- O servidor mantém cache por 3 minutos para reduzir chamadas.
- A busca digitada é enviada ao Bluesky; o feed do Mastodon usa as hashtags públicas padrão.
- Não há garantia de cobertura completa, indexação imediata ou disponibilidade contínua das redes.

## Cuidados com os dados
- Apenas publicações públicas são consideradas.
- Relatos não comprovam incidentes.
- O painel não deduz a localização de autores pelo texto ou perfil.
- As publicações originais são abertas na plataforma de origem.
- Respeite os termos de uso, limites e políticas de cada serviço.

## Publicação
Hospede em serviço compatível com Node.js (por exemplo, Render). GitHub Pages sozinho não executa o servidor.
