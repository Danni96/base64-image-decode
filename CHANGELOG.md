# Changelog

Todos los cambios notables en la extensión **`base64-image-preview`** (*Base64 Image Decoder & Preview*) se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/), y este proyecto se adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-26

### Added
- **Detección de Base64 crudo y Data URI**: soporte para detección automática mediante *Magic Bytes* (`PNG`, `JPEG`, `GIF`, `WebP`, `SVG`, `BMP`, `ICO`) en cadenas sin prefijo `data:image/...`, además de Data URIs estándar.
- **Hover Tooltip enriquecido**: previsualización instantánea con miniatura, dimensiones (`W × H px`), comparativa de tamaño binario real vs Base64 y acciones rápidas.
- **CodeLens y decoraciones en línea**: indicadores visuales y botones de acción directa en el editor de código.
- **Visor Interactivo (`WebviewPanel`)**: controles completos de Zoom (`wheel`, `+`, `-`, `100%`, `Fit`), Pan, modo `Pixelated` y selector de fondo (Damero transparente, Oscuro, Claro).
- **Modo Playground integrado**: vista interactiva (`Ctrl+Alt+P`) para pegar cadenas desde Postman, navegador o logs con limpieza automática de saltos de línea (`\r\n`) y escapes JSON (`\/`).
- **Exportación e importación de archivos**: guardado directo a archivo físico (`.png`, `.jpg`, `.svg`, etc.) y comando de conversión inversa desde el Explorador de archivos a Base64 / Data URI.
