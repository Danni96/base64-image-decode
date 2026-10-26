# Base64 Image Decode & Preview (`base64-image-decode`)

![Logo](img/icon.png)

Extensión para Visual Studio Code diseñada para detectar, decodificar, previsualizar y exportar cadenas **Base64 de imágenes** directamente en el editor, tanto con prefijo Data URI como en formato **Base64 crudo** (sin prefijo).

---

## Características Principales

1. **Detección inteligente por *Magic Bytes* y Data URI**
   - Detecta automáticamente cadenas **Base64 crudas (sin prefijo `data:image/...;base64,`)** analizando sus *Magic Bytes* / cabeceras binarias (`PNG`, `JPEG`, `GIF`, `WebP`, `SVG`, `BMP`, `ICO`).
   - Compatible también con Data URIs completos en archivos de código, JSON, XML, logs, HTML, CSS y pruebas de API.

2. **Hover Tooltip Instantáneo**
   - Al pasar el cursor sobre una cadena Base64 válida, muestra una miniatura inmediata junto con metadatos detallados:
     - Formato y tipo MIME detectado (`image/png`, `image/jpeg`, etc.).
     - Dimensiones exactas en píxeles (`W × H px`).
     - Peso binario real decodificado frente al tamaño de la cadena Base64.
     - Enlaces de acción rápida para abrir el visor interactivo, guardar en disco o copiar como Data URI.

3. **CodeLens e Indicadores en Línea**
   - Muestra acciones contextuales (`CodeLens`) sobre las líneas que contienen imágenes en Base64 para previsualizar o exportar con un clic.
   - Decoraciones sutiles en el editor que identifican rápidamente qué cadenas corresponden a imágenes válidas.

4. **Visor Interactivo (`WebviewPanel`)**
   - Panel dedicado para inspección visual de alta precisión:
     - **Zoom**: rueda del ratón (`wheel`), botones `+` / `-`, restablecimiento a `100%` y ajuste automático (`Fit`).
     - **Pan (Arrastre)**: desplazamiento libre por el lienzo cuando la imagen está ampliada.
     - **Modo `Pixelated`**: alterna entre suavizado estándar y renderizado de píxeles nítidos (ideal para iconos, sprites y artes pequeños).
     - **Selector de fondo**: alterna entre **Damero transparente** (checkerboard), fondo **Oscuro** y fondo **Claro** para contrastar siluetas o transparencias.

5. **Modo Playground Integrado**
   - Panel interactivo donde puedes pegar cualquier cadena Base64 obtenida de Postman, respuestas de red del navegador, consolas o logs.
   - Limpia y normaliza automáticamente comillas envolventes, saltos de línea (`\r`, `\n`), espacios y barras escapadas de JSON (`\/`).

6. **Exportación a Archivo Físico y Conversión Inversa**
   - **De Base64 a archivo**: decodifica y guarda la imagen en disco con la extensión correcta (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`).
   - **De archivo a Base64**: desde el Explorador de archivos de VS Code, convierte cualquier imagen física en una cadena Base64 cruda o Data URI lista para pegar en el portapapeles.

---

## Comandos y Atajos de Teclado

| Comando ID | Título en la Paleta de Comandos | Atajo (Win / Linux / macOS) | Descripción |
| :--- | :--- | :--- | :--- |
| `base64ImagePreview.previewUnderCursor` | **Base64 Image: Preview Image at Cursor / Selection** | `Ctrl+Alt+B` (`Cmd+Alt+B` en macOS) | Abre el visor interactivo con la cadena Base64 bajo el cursor o seleccionada. |
| `base64ImagePreview.openPlayground` | **Base64 Image: Open Decoder Playground** | `Ctrl+Alt+P` (`Cmd+Alt+P` en macOS) | Abre el Playground interactivo para pegar, limpiar y previsualizar cualquier Base64. |
| `base64ImagePreview.saveImageToFile` | **Base64 Image: Decode & Save Image to File...** | — | Decodifica el Base64 actual y lo exporta como archivo físico (`.png`, `.jpg`, `.svg`, etc.). |
| `base64ImagePreview.copyAsDataUri` | **Base64 Image: Copy as Complete Data URI** | — | Copia la cadena Base64 al portapapeles garantizando el prefijo `data:image/<ext>;base64,`. |
| `base64ImagePreview.encodeFileToBase64` | **Base64 Image: Encode Image File to Base64** | — | Disponible en el menú contextual del Explorador para codificar un archivo de imagen a Base64. |

---