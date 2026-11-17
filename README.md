# X PULSE — Global Incident Intelligence

Plataforma experimental de monitoramento global de sinais públicos relacionados a interrupções de energia, conectividade, telecomunicações e infraestrutura digital.

## Objetivo global
- Monitorar publicações públicas em diferentes idiomas e regiões.
- Cruzar relatos sociais com sinais técnicos e fontes oficiais.
- Separar relatos de usuários, sinais técnicos e incidentes confirmados.
- Nunca inferir a localização de uma pessoa a partir do texto ou perfil.
- Exibir links para as fontes originais e indicar limitações de cobertura.

## Fontes implementadas
- **Bluesky:** busca pública multilíngue pela AppView.
- **Mastodon:** hashtags públicas em mastodon.social (ou host configurado).
- **Reddit:** RSS público, com termos em inglês, português, francês e alemão.
- **YouTube:** integração opcional com YouTube Data API; sem restrição de país.
- **Cloudflare Radar:** integração opcional para anotações globais de interrupções. Requer token de API próprio.

## Próximas integrações planejadas
- Threads API oficial (busca de posts públicos sujeita à aprovação da Meta).
- RIPE Atlas para medições de conectividade e rotas.
- Fontes oficiais de energia e telecomunicações por país/região.
- Portais de notícias e feeds RSS locais.
- Alertas, agrupamento de incidentes, deduplicação semântica e pontuação de confiança.

## Executar localmente
- Node.js 18 ou superior.
- Execute `npm start` e abra http://localhost:3000.

## Variáveis opcionais
- `MASTODON_HOST`: servidor Mastodon (padrão: `mastodon.social`).
- `YOUTUBE_API_KEY`: chave própria do YouTube Data API.
- `CLOUDFLARE_API_TOKEN`: token Cloudflare com permissões necessárias para consultar Radar.
- Não é necessário configurar `X_BEARER_TOKEN`; esta versão não usa a API paga do X.

Configure segredos diretamente no painel do provedor de hospedagem. Nunca publique tokens no repositório ou em mensagens.

## Atualização e limites
- O navegador atualiza o painel a cada 5 minutos.
- Cache de posts sociais: 3 minutos; cache do Cloudflare Radar: 5 minutos; YouTube: 30 minutos.
- A busca customizada não é equivalente a uma pesquisa completa em todas as fontes.
- A cobertura depende de idioma, indexação, políticas, limites e disponibilidade de cada plataforma.
- Algumas fontes oficiais publicam dados agregados ou históricos, não alertas em tempo real.

## Cuidados com os dados
- Apenas publicações públicas são consideradas.
- Relatos não comprovam incidentes.
- Sinais técnicos são evidências, não necessariamente confirmação da causa.
- Não deduzir coordenadas ou localização de autores.
- Preservar fonte, horário e link original.
- Respeitar termos de uso, limites e políticas de cada serviço.

## Publicação
Hospede em serviço compatível com Node.js (por exemplo, Render). GitHub Pages sozinho não executa o servidor.
