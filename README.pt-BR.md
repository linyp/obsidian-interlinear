<h1 align="center">Interlinear</h1>

<p align="center">
  Tradução interlinear por parágrafo no modo de leitura do <a href="https://obsidian.md">Obsidian</a>
</p>

<p align="center">
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.md">English</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.zh-TW.md">繁體中文</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.ja.md">日本語</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.ko.md">한국어</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.vi.md">Tiếng Việt</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.ru.md">Русский</a> ·
  <strong>Português (Brasil)</strong> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.es.md">Español</a>
</p>

<p align="center">
  <img src="images/interlinear-bilingual.png" alt="Interlinear exibindo tradução bilíngue por parágrafo no Obsidian" width="900">
</p>

Plugin de **tradução interlinear por parágrafo** para o modo de leitura do
[Obsidian](https://obsidian.md). Abra uma nota em outro idioma e pressione o botão de
tradução; o Interlinear exibirá a tradução em português brasileiro — ou em qualquer
outro idioma de destino — logo abaixo de cada parágrafo original. Você pode visualizar
o texto bilíngue ou somente a tradução.

> A interface do plugin ainda está em inglês. Os nomes de configurações e comandos
> neste README foram mantidos iguais aos da interface real para facilitar a localização.

## Segurança por design

- **Nunca altera suas notas.** As traduções são inseridas somente no DOM, na camada de
  exibição. Depois de fechar e reabrir a nota, o arquivo Markdown no disco permanece intacto.
- **Nunca traduz automaticamente.** Abrir ou trocar de nota, rolar a página e alterar o
  layout ou as configurações não enviam solicitações. A tradução só começa após uma ação
  explícita pelo botão flutuante, pela barra de status ou pela paleta de comandos.
- **BYOK e sem telemetria.** A chave de API e as credenciais do aplicativo ficam apenas
  nas configurações do plugin dentro do cofre e são enviadas somente ao serviço escolhido.
- **Somente modo de leitura.** O modo de edição e o Live Preview não são compatíveis.

## Principais recursos

- **Traduza a nota inteira com um clique.** No desktop, use a barra de status; no celular,
  use o botão flutuante no canto inferior direito. O progresso por lotes (`3/12`, por exemplo)
  aparece durante a tradução.
- **Dois modos de exibição.** Alterne instantaneamente entre bilíngue (original + tradução)
  e somente tradução, sem uma nova solicitação. No modo somente tradução, passe o mouse ou
  toque na tradução para consultar o original.
- **Cinco estilos visuais.** Borda, bloco de citação, texto suave, sublinhado tracejado e
  máscara de estudo podem ser alternados imediatamente apenas com CSS.
- **Cache persistente de traduções.** Os resultados são indexados pelo hash do conteúdo e
  salvos em `cache.json` na pasta do plugin. Isso reduz custo e espera em novas traduções;
  o texto original não é armazenado no cache.
- **Compatível com a renderização virtualizada do Obsidian.** Os parágrafos visíveis são
  traduzidos imediatamente; o restante é previamente salvo no cache e inserido ao rolar.
- **Ignora conteúdo que não deve ser traduzido.** Código, fórmulas, blocos contendo apenas
  imagens, URLs, símbolos ou números e conteúdo reconhecido com segurança como já escrito
  no idioma de destino são ignorados. Para idiomas que compartilham o alfabeto latino,
  como o português, o plugin evita deduzir o idioma apenas pelo sistema de escrita.
- **Backends intercambiáveis.** Há suporte a DeepSeek, OpenAI, SiliconFlow, Ollama,
  endpoints personalizados compatíveis com OpenAI, Baidu Translate (百度翻译) e Youdao
  (有道智云). Todas as solicitações de rede usam o `requestUrl` do Obsidian.
- **Idiomas de destino predefinidos.** Inclui português do Brasil (`pt-BR`), espanhol (`es`),
  russo (`ru`), japonês (`ja`), coreano (`ko`), vietnamita (`vi`), chinês simplificado e
  tradicional, inglês e outros. Também é possível inserir um código de idioma personalizado.

## Rede, contas e privacidade

- O plugin só envia os trechos a traduzir ao serviço selecionado quando você inicia a
  tradução explicitamente ou pressiona **Test connection**.
- Você fornece sua própria chave de API ou credenciais de aplicativo. Os custos são
  cobrados pelo provedor escolhido, não pelo Interlinear.
- Não há telemetria nem coleta de dados analíticos.
- As configurações ficam em `data.json`, o backup único anterior à migração pode ficar em
  `data.backup.json` e o cache em `cache.json`. Todos estão na pasta do plugin.
- Ao sincronizar o cofre, as credenciais também podem ser sincronizadas com outros dispositivos.
  Se você gerencia o cofre com Git, adicione pelo menos
  `.obsidian/plugins/interlinear/data.json` e
  `.obsidian/plugins/interlinear/data.backup.json` ao `.gitignore`.

## Instalação

### Pelo Obsidian (recomendado)

1. Abra **Settings → Community plugins → Browse**.
2. Procure por **Interlinear** e selecione **Install** e **Enable**.

Você também pode abrir a [página do plugin](https://obsidian.md/plugins?id=interlinear)
e pressionar **Install**.

### Atualização da v0.2.5 para a v0.3.0

A v0.3.0 usa o settings schema v2. As configurações planas da v0.2.5 são migradas
uma única vez; os dados originais são salvos em `data.backup.json` antes que
`data.json` seja regravado.

Se você sincroniza as configurações do plugin, atualize o Interlinear em **todos os
dispositivos sincronizados antes de alterar qualquer configuração**. Não há suporte
para misturar versões nem para fazer downgrade após a migração.

### BRAT / instalação manual

- Para receber versões antes da publicação no diretório oficial, instale o
  [BRAT](https://github.com/TfTHacker/obsidian42-brat), execute
  **BRAT: Add a beta plugin for testing** e informe `linyp/obsidian-interlinear`.
- Para instalar manualmente, baixe `main.js`, `manifest.json` e `styles.css` da
  [versão mais recente](https://github.com/linyp/obsidian-interlinear/releases/latest)
  e coloque-os em `<your-vault>/.obsidian/plugins/interlinear/`.

## Configuração

Abra **Settings → Interlinear**.

| Configuração | Padrão | Observações |
| --- | --- | --- |
| Service | DeepSeek | Escolha um LLM ou tradução automática tradicional. Cada preset preserva suas próprias credenciais e configurações avançadas. |
| API key _(somente LLM)_ | _vazio_ | Chave de API do serviço de LLM selecionado. |
| App ID + secret _(Baidu / Youdao)_ | _vazio_ | Credenciais do console de desenvolvedor do serviço. |
| Base URL _(somente LLM)_ | `https://api.deepseek.com` | Endpoint compatível com OpenAI. |
| Model _(somente LLM)_ | `deepseek-v4-flash` | Nome do modelo utilizado. |
| Test connection | — | Envia uma pequena solicitação para verificar as credenciais e a conectividade. |
| Target language | `zh-CN` | Escolha `pt-BR`, `es`, `ru`, `zh-TW` ou insira um código de idioma personalizado. |
| Default display mode | Bilingual | Exibição aplicada após a primeira tradução. |
| Translation style | Border | Estilo visual da tradução. |
| Floating button | Mobile only | Always / mobile only / never. |
| Concurrency | 10 | Número máximo de solicitações simultâneas. |
| Min interval (ms) | 0 | Intervalo mínimo entre o início das solicitações. |
| Max retries | 3 | Tentativas adicionais para erros 429 ou falhas temporárias. |
| Batch char budget | 4000 | Máximo de caracteres agrupados em uma solicitação. |
| Max segments per request | 12 | Máximo de blocos agrupados em uma solicitação. |
| Custom instructions _(somente LLM)_ | _vazio_ | Acrescenta terminologia, tom ou instruções de domínio ao prompt. O conteúdo faz parte da identidade do cache. |
| Persistent cache | On | Mantém o cache de traduções após reiniciar. |

## Como usar

1. Abra uma nota e mude para o **reading view**.
2. No desktop, pressione **Translate** na barra de status; no celular, pressione o botão
   flutuante no canto inferior direito.
3. Pressione novamente para alternar entre a tradução e o original.
4. Use o botão de modo para alternar entre **bilingual** e **translation-only**. Isso não
   cria uma nova solicitação de tradução.

A paleta de comandos oferece os comandos abaixo. O plugin não define atalhos padrão.

- **Interlinear: Translate / show original**
- **Interlinear: Toggle display mode (bilingual / translation-only)**
- **Interlinear: Clear translations**

## Desenvolvimento

Consulte as instruções de compilação, testes, lançamento e arquitetura na
[seção Develop do README em inglês](https://github.com/linyp/obsidian-interlinear/blob/main/README.md#develop).

## Limitações

- Somente o modo de leitura é compatível; o modo de edição e o Live Preview não são.
- Listas e tabelas são traduzidas como um único bloco. Listas simples são reconstruídas,
  mas a estrutura aninhada não é preservada por completo.

## Licença

MIT
