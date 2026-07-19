<h1 align="center">Interlinear</h1>

<p align="center">
  Traducción interlineal por párrafos en el modo de lectura de <a href="https://obsidian.md">Obsidian</a>
</p>

<p align="center">
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.md">English</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.zh-TW.md">繁體中文</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.ja.md">日本語</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.ko.md">한국어</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.vi.md">Tiếng Việt</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.ru.md">Русский</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.pt-BR.md">Português (Brasil)</a> ·
  <strong>Español</strong>
</p>

<p align="center">
  <img src="images/interlinear-bilingual.png" alt="Interlinear muestra una traducción bilingüe por párrafos en Obsidian" width="900">
</p>

Plugin de **traducción interlineal por párrafos** para el modo de lectura de
[Obsidian](https://obsidian.md). Abre una nota en otro idioma y pulsa el botón de
traducción; Interlinear mostrará la traducción al español —o a cualquier otro idioma
de destino— justo debajo de cada párrafo original. Puedes ver el texto bilingüe o
solo la traducción.

> La interfaz del plugin sigue estando en inglés. Los nombres de los ajustes y comandos
> de este README se mantienen iguales a los de la interfaz real para que sean fáciles de encontrar.

## Seguridad desde el diseño

- **Nunca modifica tus notas.** Las traducciones solo se insertan en el DOM, en la capa
  de visualización. Al cerrar y volver a abrir la nota, el archivo Markdown del disco
  permanece intacto.
- **Nunca traduce automáticamente.** Abrir o cambiar de nota, desplazarse por ella y
  modificar el diseño o los ajustes no envían solicitudes. La traducción solo comienza
  tras una acción explícita desde el botón flotante, la barra de estado o la paleta de comandos.
- **BYOK y sin telemetría.** La clave de API y las credenciales de la aplicación solo se
  guardan en los ajustes del plugin dentro de la bóveda y únicamente se envían al servicio elegido.
- **Solo para el modo de lectura.** El modo de edición y Live Preview no son compatibles.

## Funciones principales

- **Traduce toda la nota con una pulsación.** En el escritorio, usa la barra de estado;
  en el móvil, usa el botón flotante de la esquina inferior derecha. Durante la traducción
  se muestra el progreso por lotes (`3/12`, por ejemplo).
- **Dos modos de visualización.** Cambia al instante entre bilingüe (original + traducción)
  y solo traducción, sin volver a solicitarla. En el modo de solo traducción, pasa el cursor
  o toca la traducción para consultar el original.
- **Cinco estilos visuales.** Borde, cita, texto tenue, subrayado discontinuo y máscara de
  estudio pueden alternarse inmediatamente solo mediante CSS.
- **Caché persistente de traducciones.** Los resultados se indexan mediante un hash del
  contenido y se guardan en `cache.json` dentro de la carpeta del plugin. Esto reduce el
  coste y la espera al repetir traducciones; el texto original no se almacena en la caché.
- **Compatible con el renderizado virtualizado de Obsidian.** Los párrafos visibles se
  traducen de inmediato; el resto se guarda previamente en la caché y se inserta al desplazarse.
- **Omite el contenido que no debe traducirse.** Se ignoran el código, las fórmulas, los
  bloques que solo contienen imágenes, URL, símbolos o números y el contenido que puede
  reconocerse con seguridad como ya escrito en el idioma de destino. Para los idiomas que
  comparten el alfabeto latino, como el español, el plugin evita deducir el idioma solo por la escritura.
- **Backends intercambiables.** Admite DeepSeek, OpenAI, SiliconFlow, Ollama, endpoints
  personalizados compatibles con OpenAI, Baidu Translate (百度翻译) y Youdao (有道智云).
  Todas las solicitudes de red utilizan `requestUrl` de Obsidian.
- **Idiomas de destino predefinidos.** Incluye español (`es`), portugués de Brasil (`pt-BR`),
  ruso (`ru`), japonés (`ja`), coreano (`ko`), vietnamita (`vi`), chino simplificado y
  tradicional, inglés y otros. También puedes introducir un código de idioma personalizado.

## Red, cuentas y privacidad

- El plugin solo envía los fragmentos que se van a traducir al servicio seleccionado
  cuando inicias explícitamente la traducción o pulsas **Test connection**.
- Tú proporcionas la clave de API o las credenciales de la aplicación. El proveedor
  elegido cobra el servicio; Interlinear no lo hace.
- No hay telemetría ni recopilación de datos analíticos.
- Los ajustes se guardan en `data.json`, la copia de seguridad previa a la migración puede
  estar en `data.backup.json` y la caché de traducciones en `cache.json`. Todos estos archivos
  se encuentran dentro de la carpeta del plugin.
- Al sincronizar la bóveda, las credenciales también pueden sincronizarse con otros dispositivos.
  Si gestionas la bóveda con Git, añade al menos `.obsidian/plugins/interlinear/data.json` y
  `.obsidian/plugins/interlinear/data.backup.json` a `.gitignore`.

## Instalación

### Desde Obsidian (recomendado)

1. Abre **Settings → Community plugins → Browse**.
2. Busca **Interlinear** y selecciona **Install** y **Enable**.

También puedes abrir la [página del plugin](https://obsidian.md/plugins?id=interlinear)
y pulsar **Install**.

### Actualización de v0.2.5 a v0.3.0

La versión v0.3.0 utiliza settings schema v2. Los ajustes planos de v0.2.5 se migran
una sola vez; los datos originales se guardan en `data.backup.json` antes de volver
a escribir `data.json`.

Si sincronizas los ajustes del plugin, actualiza Interlinear en **todos los dispositivos
sincronizados antes de cambiar cualquier ajuste**. No se admite mezclar versiones ni
volver a una versión anterior después de la migración.

### BRAT / instalación manual

- Para recibir versiones antes de su publicación en el directorio oficial, instala
  [BRAT](https://github.com/TfTHacker/obsidian42-brat), ejecuta
  **BRAT: Add a beta plugin for testing** e introduce `linyp/obsidian-interlinear`.
- Para instalarlo manualmente, descarga `main.js`, `manifest.json` y `styles.css` de la
  [versión más reciente](https://github.com/linyp/obsidian-interlinear/releases/latest)
  y colócalos en `<your-vault>/.obsidian/plugins/interlinear/`.

## Configuración

Abre **Settings → Interlinear**.

| Ajuste | Predeterminado | Notas |
| --- | --- | --- |
| Service | DeepSeek | Elige un LLM o traducción automática tradicional. Cada preset conserva sus propias credenciales y ajustes avanzados. |
| API key _(solo LLM)_ | _vacío_ | Clave de API del servicio LLM seleccionado. |
| App ID + secret _(Baidu / Youdao)_ | _vacío_ | Credenciales de la consola para desarrolladores del servicio. |
| Base URL _(solo LLM)_ | `https://api.deepseek.com` | Endpoint compatible con OpenAI. |
| Model _(solo LLM)_ | `deepseek-v4-flash` | Nombre del modelo utilizado. |
| Test connection | — | Envía una pequeña solicitud para comprobar las credenciales y la conexión. |
| Target language | `zh-CN` | Elige `es`, `pt-BR`, `ru`, `zh-TW` o introduce un código de idioma personalizado. |
| Default display mode | Bilingual | Presentación aplicada tras la primera traducción. |
| Translation style | Border | Estilo visual de la traducción. |
| Floating button | Mobile only | Always / mobile only / never. |
| Concurrency | 10 | Número máximo de solicitudes simultáneas. |
| Min interval (ms) | 0 | Intervalo mínimo entre el inicio de las solicitudes. |
| Max retries | 3 | Reintentos para errores 429 o fallos temporales. |
| Batch char budget | 4000 | Máximo de caracteres agrupados en una solicitud. |
| Max segments per request | 12 | Máximo de bloques agrupados en una solicitud. |
| Custom instructions _(solo LLM)_ | _vacío_ | Añade terminología, tono o instrucciones de dominio al prompt. El contenido forma parte de la identidad de la caché. |
| Persistent cache | On | Conserva la caché de traducciones después de reiniciar. |

## Uso

1. Abre una nota y cambia al **reading view**.
2. En el escritorio, pulsa **Translate** en la barra de estado; en el móvil, pulsa el
   botón flotante de la esquina inferior derecha.
3. Pulsa de nuevo para alternar entre la traducción y el original.
4. Usa el botón de modo para cambiar entre **bilingual** y **translation-only**. Esta
   acción no crea una nueva solicitud de traducción.

La paleta de comandos ofrece los siguientes comandos. El plugin no asigna atajos predeterminados.

- **Interlinear: Translate / show original**
- **Interlinear: Toggle display mode (bilingual / translation-only)**
- **Interlinear: Clear translations**

## Desarrollo

Consulta las instrucciones de compilación, pruebas, publicación y arquitectura en la
[sección Develop del README en inglés](https://github.com/linyp/obsidian-interlinear/blob/main/README.md#develop).

## Limitaciones

- Solo se admite el modo de lectura; el modo de edición y Live Preview no son compatibles.
- Las listas y tablas se traducen como un solo bloque. Las listas simples se reconstruyen,
  pero la estructura anidada no se conserva por completo.

## Licencia

MIT
