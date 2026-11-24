# BuilCord — Discord Server Builder CLI

Construtor de servidores Discord em **Node.js + discord.js**, com estrutura em fases e templates JSON.

## Instalação (PowerShell)

1. Instale **Node.js 20+**.
2. Crie um aplicativo/bot em https://discord.com/developers/applications. Ative **Server Members Intent** e **Message Content Intent** para eventos que deles dependem.
3. Convide o bot para **um servidor de testes** com permissão de gerenciar cargos, canais, webhooks, mensagens e, quando necessário, histórico de mensagens. O cargo do bot deve estar acima dos cargos gerenciados.
4. Abra um terminal na pasta clonada e execute:

```powershell
git clone https://github.com/raphaelsancho21-byte/BuilCord.git
cd BuilCord
npm install
Copy-Item .env.example .env
notepad .env
npm run check
npm start
```

No arquivo `.env`, preencha `DISCORD_TOKEN`. **Nunca publique tokens ou URLs de webhook.** O GitHub ignora `.env` e a pasta `data/`.

## Funcionalidades

- **Fase 1:** estrutura seca — categorias, cargos, canais e hierarquia por categoria.
- **Fase 2:** permissões dos cargos e overwrites por canais/categorias.
- **Fase 3:** decoração — nomes, cores e tópicos.
- **Fase 4:** regras, embeds, mensagens fixadas e painéis.
- **Fase 5:** configurações das automações — autorole, boas-vindas, logs, tickets e verificação.
- Templates JSON editáveis: Miraculous, Comunidade, Roblox RP, Gaming, Desenvolvimento e Suporte.
- Referências Xenon: busca de links na galeria pública, extração experimental e geração de plano de **fase 1**. Sem acesso aos detalhes ocultos do template.
- Criação de webhook sob confirmação (URL exibida uma única vez).
- Exportação estrutural em JSON; estado de execução, tickets e transcrições salvos em `data/`.

## Limitações

O Discord não permite que um bot comum crie livremente novos servidores. O BuilCord configura um servidor **existente e autorizado**. A busca Xenon lê somente HTML público e não garante encontrar todos os templates, categorias ou permissões; **não é um importador Xenon oficial**. Não contorna paywalls nem copia templates privados.

O bot precisa ficar **online** para executar botões, tickets e boas-vindas. É necessário revisar o plano e as permissões antes de aplicar em servidores de produção. As fases são recuperáveis em execução repetida, mas operações individuais podem falhar parcialmente conforme as permissões do bot e limites da API. Não existe restauração automática nem cópia do histórico de mensagens. A transcrição de ticket salva somente as últimas 100 mensagens localmente; proteja a pasta `data/`.

A fase 1 de um template Xenon propositalmente cria nomes **sem permissões inferidas nem decorações adicionais**. Edite o JSON para definir as próximas fases. Para templates prontos do BuilCord, as cinco fases já podem ser executadas após confirmação.
