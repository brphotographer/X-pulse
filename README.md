# X PULSE — Monitoramento Global

Painel experimental para acompanhar posts públicos do X relacionados a interrupções de energia, conectividade e infraestrutura.

## Requisitos
- Node.js 18 ou superior
- Bearer Token da API do X (para dados reais)

## Executar localmente
```bash
npm start
```
Abra http://localhost:3000. Sem token, o painel usa dados **fictícios de demonstração**, claramente identificados.

## API do X
Configure a variável de ambiente `X_BEARER_TOKEN` no serviço de hospedagem. Nunca coloque o token no código do navegador, no Git ou em arquivos públicos.

Exemplo em ambiente Linux/macOS:
```bash
X_BEARER_TOKEN="seu_token" npm start
```

A aplicação consulta `/2/tweets/search/recent` e depende do nível de acesso, limites e custos da conta de desenvolvedor do X. A busca recente não é um fluxo contínuo de streaming.

## Publicação
Este projeto precisa de hospedagem que execute Node.js (por exemplo, Render, Railway ou outro serviço compatível). GitHub Pages sozinho não executa `server.js` nem protege o token da API. Configure `X_BEARER_TOKEN` como variável secreta no serviço de hospedagem.

## Cuidados com os dados
- Posts são relatos públicos, não confirmação de incidentes.
- Classificações como relato/suspeita/confirmado exigem verificação externa.
- O mapa só usa geolocalização pública retornada pela API; não tenta deduzir localização de pessoas.
- As observações manuais ficam apenas na página aberta (não são persistidas em banco de dados).

## Licença
Projeto experimental. Verifique os termos da API do X e os direitos aplicáveis antes de uso operacional.