import * as vscode from 'vscode';
import { DecodedImageResult } from '../core/types';
import {
  decodeAndInspectBase64Image,
  sanitizeBase64Input,
} from '../core/Base64Engine';
import { saveDecodedImageToDisk } from '../services/FileService';

interface WebviewInboundMessage {
  type:
    | 'READY'
    | 'DECODE_INPUT'
    | 'SAVE_IMAGE'
    | 'COPY_DATA_URI'
    | 'COPY_RAW_BASE64'
    | 'REQUEST_CLIPBOARD_PASTE'
    | 'NOTIFY_INFO'
    | 'NOTIFY_ERROR';
  rawText?: string;
  message?: string;
}

/**
 * Interactive Webview Inspector & Base64 to Image Playground panel.
 */
export class ImageInspectorPanel {
  public static currentPanel: ImageInspectorPanel | undefined;
  public static readonly viewType = 'base64ImagePreview.inspector';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private currentImage: DecodedImageResult | undefined;
  private openPlaygroundByDefault: boolean;

  private constructor(
    panel: vscode.WebviewPanel,
    _extensionUri: vscode.Uri,
    initialImage?: DecodedImageResult,
    openPlayground = false
  ) {
    this.panel = panel;
    this.currentImage = initialImage;
    this.openPlaygroundByDefault = openPlayground;

    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message: WebviewInboundMessage) => {
        await this.handleWebviewMessage(message);
      },
      null,
      this.disposables
    );
  }

  /**
   * Creates or reveals the singleton ImageInspectorPanel beside the active editor.
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    initialImage?: DecodedImageResult,
    openPlayground = false
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (ImageInspectorPanel.currentPanel) {
      ImageInspectorPanel.currentPanel.panel.reveal(column);
      if (initialImage) {
        ImageInspectorPanel.currentPanel.updateImage(
          initialImage,
          openPlayground
        );
      } else if (openPlayground) {
        ImageInspectorPanel.currentPanel.openPlaygroundDrawer();
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ImageInspectorPanel.viewType,
      'Base64 Image Inspector',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );

    ImageInspectorPanel.currentPanel = new ImageInspectorPanel(
      panel,
      extensionUri,
      initialImage,
      openPlayground
    );
  }

  public updateImage(
    image: DecodedImageResult,
    openPlayground = false
  ): void {
    this.currentImage = image;
    this.openPlaygroundByDefault = openPlayground;
    this.panel.title = `Base64 (${image.extension.toUpperCase()} • ${
      image.width > 0 ? `${image.width}×${image.height}` : 'Vector'
    })`;
    void this.panel.webview.postMessage({
      type: 'IMAGE_LOADED',
      payload: this.serializeDecodedImage(image),
      openPlayground,
    });
  }

  public openPlaygroundDrawer(): void {
    this.openPlaygroundByDefault = true;
    void this.panel.webview.postMessage({
      type: 'OPEN_PLAYGROUND',
    });
  }

  private serializeDecodedImage(image: DecodedImageResult) {
    const base64Length =
      typeof image.base64Length === 'number'
        ? image.base64Length
        : image.base64Clean.length;

    return {
      mimeType: image.mimeType,
      extension: image.extension,
      width: image.width,
      height: image.height,
      byteLength: image.byteLength,
      base64Length,
      dataUri: image.dataUri,
      base64Clean: image.base64Clean,
      isDataUri: image.hadDataUriPrefix,
      sanitizationNotes: image.sanitizedNotes ?? [],
    };
  }

  private async handleWebviewMessage(
    message: WebviewInboundMessage
  ): Promise<void> {
    switch (message.type) {
      case 'READY': {
        if (this.currentImage) {
          this.updateImage(this.currentImage, this.openPlaygroundByDefault);
        } else if (this.openPlaygroundByDefault) {
          this.openPlaygroundDrawer();
        }
        break;
      }

      case 'DECODE_INPUT': {
        const rawText = (message.rawText ?? '').trim();
        if (!rawText) {
          await this.panel.webview.postMessage({
            type: 'DECODE_ERROR',
            message:
              'Introduce o pega una cadena Base64 o Data URI para decodificar.',
          });
          return;
        }

        const sanitized = sanitizeBase64Input(rawText);
        const decoded = decodeAndInspectBase64Image(rawText);

        if (!decoded) {
          await this.panel.webview.postMessage({
            type: 'DECODE_ERROR',
            message:
              'No se detectó una firma mágica de imagen válida (PNG, JPEG, GIF, WEBP, BMP, ICO, SVG, AVIF) en la cadena Base64 proporcionada.',
            sanitizationNotes: sanitized.sanitizedNotes ?? [],
          });
          return;
        }

        this.currentImage = decoded;
        this.panel.title = `Base64 (${decoded.extension.toUpperCase()} • ${
          decoded.width > 0 ? `${decoded.width}×${decoded.height}` : 'Vector'
        })`;

        await this.panel.webview.postMessage({
          type: 'IMAGE_LOADED',
          payload: this.serializeDecodedImage(decoded),
        });
        break;
      }

      case 'REQUEST_CLIPBOARD_PASTE': {
        const clipboardText = await vscode.env.clipboard.readText();
        await this.panel.webview.postMessage({
          type: 'CLIPBOARD_TEXT',
          rawText: clipboardText,
        });
        break;
      }

      case 'SAVE_IMAGE': {
        if (!this.currentImage) {
          void vscode.window.showWarningMessage(
            'No hay ninguna imagen Base64 cargada para guardar.'
          );
          return;
        }
        await saveDecodedImageToDisk(this.currentImage);
        break;
      }

      case 'COPY_DATA_URI': {
        if (!this.currentImage) {
          return;
        }
        await vscode.env.clipboard.writeText(this.currentImage.dataUri);
        void vscode.window.showInformationMessage(
          `Data URI copiado al portapapeles (${this.currentImage.mimeType}).`
        );
        break;
      }

      case 'COPY_RAW_BASE64': {
        if (!this.currentImage) {
          return;
        }
        await vscode.env.clipboard.writeText(this.currentImage.base64Clean);
        void vscode.window.showInformationMessage(
          'Base64 crudo (sin prefijo) copiado al portapapeles.'
        );
        break;
      }

      case 'NOTIFY_INFO': {
        if (message.message) {
          void vscode.window.showInformationMessage(message.message);
        }
        break;
      }

      case 'NOTIFY_ERROR': {
        if (message.message) {
          void vscode.window.showErrorMessage(message.message);
        }
        break;
      }
    }
  }

  private getHtmlForWebview(): string {
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>Base64 Image Inspector & Playground</title>
  <style>
    :root {
      --checker-a: #2d2d2d;
      --checker-b: #383838;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* Top Toolbar */
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      background-color: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
      z-index: 10;
    }

    .toolbar-group {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }

    .toolbar-divider {
      width: 1px;
      height: 20px;
      background: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
      margin: 0 4px;
    }

    button {
      background-color: var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.2));
      color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background-color 0.12s ease;
    }

    button:hover {
      background-color: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.32));
    }

    button.primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    button.primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    button.active {
      border-color: var(--vscode-focusBorder, #007fd4);
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .zoom-badge {
      min-width: 52px;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      font-size: 12px;
    }

    /* Interactive Canvas Area */
    .canvas-viewport {
      flex: 1;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      user-select: none;
    }

    .canvas-viewport.dragging {
      cursor: grabbing;
    }

    .canvas-viewport.bg-checkerboard {
      background-color: var(--checker-a);
      background-image:
        linear-gradient(45deg, var(--checker-b) 25%, transparent 25%),
        linear-gradient(-45deg, var(--checker-b) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, var(--checker-b) 75%),
        linear-gradient(-45deg, transparent 75%, var(--checker-b) 75%);
      background-size: 20px 20px;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0;
    }

    .canvas-viewport.bg-dark {
      background-color: #141414;
      background-image: none;
    }

    .canvas-viewport.bg-light {
      background-color: #f3f3f3;
      background-image: none;
    }

    #preview-img {
      max-width: none;
      max-height: none;
      transform-origin: center center;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
      transition: transform 0.04s linear;
      display: none;
    }

    #preview-img.pixelated {
      image-rendering: pixelated;
    }

    .empty-state {
      text-align: center;
      padding: 24px;
      max-width: 440px;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.3));
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }

    .empty-state h3 {
      margin: 0 0 8px 0;
      font-size: 14px;
    }

    .empty-state p {
      margin: 0;
      opacity: 0.85;
      line-height: 1.45;
      font-size: 12px;
    }

    .error-banner {
      display: none;
      background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      color: var(--vscode-errorForeground, #f48771);
      padding: 8px 12px;
      font-size: 12px;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    /* Metadata Bar */
    .metadata-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 14px;
      padding: 6px 12px;
      font-size: 12px;
      background-color: var(--vscode-statusBar-background, var(--vscode-editorWidget-background));
      color: var(--vscode-statusBar-foreground, var(--vscode-editor-foreground));
      border-top: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
    }

    .meta-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .meta-label {
      opacity: 0.75;
    }

    .meta-value {
      font-weight: 600;
      font-family: var(--vscode-editor-font-family, monospace);
    }

    /* Export Actions Bar */
    .actions-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      background-color: var(--vscode-editorWidget-background);
      border-top: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
    }

    /* Playground Drawer */
    .playground-drawer {
      background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
      border-top: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.3));
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .playground-drawer.collapsed {
      display: none;
    }

    .playground-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    .playground-title {
      font-weight: 600;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    #playground-input {
      width: 100%;
      height: 82px;
      resize: vertical;
      padding: 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.4));
      border-radius: 4px;
      outline: none;
    }

    #playground-input:focus {
      border-color: var(--vscode-focusBorder, #007fd4);
    }
  </style>
</head>
<body>
  <!-- Top Toolbar -->
  <div class="toolbar">
    <div class="toolbar-group">
      <button id="btn-zoom-out" title="Alejar (-)">−</button>
      <span id="zoom-label" class="zoom-badge">100%</span>
      <button id="btn-zoom-in" title="Acercar (+)">+</button>
      <button id="btn-zoom-100" title="Zoom 100% (1:1)">100%</button>
      <button id="btn-zoom-fit" title="Ajustar a la ventana">Fit</button>
      <div class="toolbar-divider"></div>
      <button id="btn-pixelated" title="Alternar renderizado pixelado (ideal para iconos/sprites)">Pixelated</button>
    </div>

    <div class="toolbar-group">
      <button id="bg-checker" class="active" title="Fondo damero transparente">🏁 Damero Transparente</button>
      <button id="bg-dark" title="Fondo oscuro">⬛ Fondo Oscuro</button>
      <button id="bg-light" title="Fondo claro">⬜ Fondo Claro</button>
      <div class="toolbar-divider"></div>
      <button id="btn-toggle-playground" class="primary" title="Mostrar/Ocultar Cajón Playground Base64">🧪 Playground Base64</button>
    </div>
  </div>

  <!-- Error Notification Banner -->
  <div id="error-banner" class="error-banner">
    <span id="error-text"></span>
  </div>

  <!-- Central Interactive Canvas -->
  <div id="viewport" class="canvas-viewport bg-checkerboard">
    <div id="empty-state" class="empty-state">
      <h3>🖼️ Inspector & Playground Base64</h3>
      <p>Pasa el cursor sobre un Base64 en el editor o pega cualquier cadena Base64 / Data URI en el cajón inferior para previsualizar, hacer zoom y exportar la imagen.</p>
    </div>
    <img id="preview-img" alt="Base64 Decoded Image Preview" draggable="false" />
  </div>

  <!-- Metadata Bar -->
  <div class="metadata-bar">
    <div class="meta-item">
      <span class="meta-label">MIME:</span>
      <span id="meta-mime" class="meta-value">—</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Dimensiones:</span>
      <span id="meta-dims" class="meta-value">—</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Tamaño Binario vs Base64:</span>
      <span id="meta-size" class="meta-value">—</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Origen:</span>
      <span id="meta-source" class="meta-value">—</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Sanitización:</span>
      <span id="meta-notes" class="meta-value">Ninguna</span>
    </div>
  </div>

  <!-- Export Actions Bar -->
  <div class="actions-bar">
    <div class="toolbar-group">
      <button id="btn-save-file" class="primary">💾 Guardar como Archivo (.png/.jpg/.svg...)</button>
      <button id="btn-copy-image">🖼️ Copiar Imagen al Portapapeles</button>
    </div>
    <div class="toolbar-group">
      <button id="btn-copy-data-uri">🔗 Copiar Data URI</button>
      <button id="btn-copy-raw-base64">📄 Copiar Base64 Crudo</button>
    </div>
  </div>

  <!-- Interactive Playground Drawer -->
  <div id="playground-drawer" class="playground-drawer">
    <div class="playground-header">
      <div class="playground-title">
        <span>🧪 Cajón Playground Interactivo (Base64 to Image)</span>
      </div>
      <div class="toolbar-group">
        <button id="btn-paste-clipboard">📋 Pegar desde Portapapeles</button>
        <button id="btn-decode-now" class="primary">🔍 Decodificar y Previsualizar</button>
        <button id="btn-clear-input">🗑️ Limpiar</button>
      </div>
    </div>
    <textarea
      id="playground-input"
      placeholder="Pega aquí cualquier cadena Base64 cruda (iVBORw0KGgo..., /9j/4AAQ...) o Data URI (data:image/png;base64,...), incluso con saltos de línea, comillas o escapes JSON (\/)..."
      spellcheck="false"
    ></textarea>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const viewport = document.getElementById('viewport');
    const previewImg = document.getElementById('preview-img');
    const emptyState = document.getElementById('empty-state');
    const errorBanner = document.getElementById('error-banner');
    const errorText = document.getElementById('error-text');
    const zoomLabel = document.getElementById('zoom-label');
    const playgroundDrawer = document.getElementById('playground-drawer');
    const playgroundInput = document.getElementById('playground-input');

    const metaMime = document.getElementById('meta-mime');
    const metaDims = document.getElementById('meta-dims');
    const metaSize = document.getElementById('meta-size');
    const metaSource = document.getElementById('meta-source');
    const metaNotes = document.getElementById('meta-notes');

    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let isPixelated = false;
    let liveDecodeTimer = null;
    let currentDataUri = '';

    function applyTransform() {
      previewImg.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${scale})\`;
      zoomLabel.textContent = \`\${Math.round(scale * 100)}%\`;
    }

    function setZoom(newScale, resetPan = false) {
      scale = Math.min(Math.max(newScale, 0.05), 32);
      if (resetPan) {
        panX = 0;
        panY = 0;
      }
      applyTransform();
    }

    function fitImageToViewport() {
      if (!previewImg.naturalWidth || !previewImg.naturalHeight) {
        setZoom(1, true);
        return;
      }
      const pad = 40;
      const vw = Math.max(100, viewport.clientWidth - pad);
      const vh = Math.max(100, viewport.clientHeight - pad);
      const fitScale = Math.min(
        vw / previewImg.naturalWidth,
        vh / previewImg.naturalHeight,
        1
      );
      setZoom(fitScale, true);
    }

    // Toolbar Zoom & Pixelated controls
    document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(scale * 1.25));
    document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(scale / 1.25));
    document.getElementById('btn-zoom-100').addEventListener('click', () => setZoom(1, true));
    document.getElementById('btn-zoom-fit').addEventListener('click', () => fitImageToViewport());

    const btnPixelated = document.getElementById('btn-pixelated');
    btnPixelated.addEventListener('click', () => {
      isPixelated = !isPixelated;
      previewImg.classList.toggle('pixelated', isPixelated);
      btnPixelated.classList.toggle('active', isPixelated);
    });

    // Background 3-state selector
    const bgButtons = {
      checker: document.getElementById('bg-checker'),
      dark: document.getElementById('bg-dark'),
      light: document.getElementById('bg-light'),
    };

    function setBackgroundMode(mode) {
      viewport.classList.remove('bg-checkerboard', 'bg-dark', 'bg-light');
      Object.values(bgButtons).forEach((b) => b.classList.remove('active'));
      if (mode === 'checker') {
        viewport.classList.add('bg-checkerboard');
        bgButtons.checker.classList.add('active');
      } else if (mode === 'dark') {
        viewport.classList.add('bg-dark');
        bgButtons.dark.classList.add('active');
      } else if (mode === 'light') {
        viewport.classList.add('bg-light');
        bgButtons.light.classList.add('active');
      }
    }

    bgButtons.checker.addEventListener('click', () => setBackgroundMode('checker'));
    bgButtons.dark.addEventListener('click', () => setBackgroundMode('dark'));
    bgButtons.light.addEventListener('click', () => setBackgroundMode('light'));

    // Toggle Playground drawer
    document.getElementById('btn-toggle-playground').addEventListener('click', () => {
      playgroundDrawer.classList.toggle('collapsed');
    });

    // Mouse wheel zoom & drag-to-pan on viewport
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom(scale * factor);
    }, { passive: false });

    viewport.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      viewport.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      viewport.classList.remove('dragging');
    });

    // Playground actions
    function triggerDecode(rawText) {
      vscode.postMessage({
        type: 'DECODE_INPUT',
        rawText,
      });
    }

    document.getElementById('btn-decode-now').addEventListener('click', () => {
      triggerDecode(playgroundInput.value);
    });

    playgroundInput.addEventListener('input', () => {
      if (liveDecodeTimer) clearTimeout(liveDecodeTimer);
      liveDecodeTimer = setTimeout(() => {
        const val = playgroundInput.value.trim();
        if (val.length > 16) {
          triggerDecode(val);
        }
      }, 220);
    });

    document.getElementById('btn-paste-clipboard').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          playgroundInput.value = text;
          triggerDecode(text);
          return;
        }
      } catch (_err) {
        // Fallback to Extension Host clipboard API
      }
      vscode.postMessage({ type: 'REQUEST_CLIPBOARD_PASTE' });
    });

    document.getElementById('btn-clear-input').addEventListener('click', () => {
      playgroundInput.value = '';
      errorBanner.style.display = 'none';
      playgroundInput.focus();
    });

    // Export buttons
    document.getElementById('btn-save-file').addEventListener('click', () => {
      vscode.postMessage({ type: 'SAVE_IMAGE' });
    });

    document.getElementById('btn-copy-data-uri').addEventListener('click', () => {
      vscode.postMessage({ type: 'COPY_DATA_URI' });
    });

    document.getElementById('btn-copy-raw-base64').addEventListener('click', () => {
      vscode.postMessage({ type: 'COPY_RAW_BASE64' });
    });

    document.getElementById('btn-copy-image').addEventListener('click', async () => {
      if (!currentDataUri || previewImg.style.display === 'none') {
        vscode.postMessage({
          type: 'NOTIFY_ERROR',
          message: 'No hay ninguna imagen cargada para copiar al portapapeles.',
        });
        return;
      }

      try {
        const canvas = document.createElement('canvas');
        const width = previewImg.naturalWidth || 512;
        const height = previewImg.naturalHeight || 512;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(previewImg, 0, 0, width, height);

        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear el blob PNG'))), 'image/png');
        });

        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);

        vscode.postMessage({
          type: 'NOTIFY_INFO',
          message: 'Imagen renderizada copiada al portapapeles como PNG.',
        });
      } catch (_err) {
        vscode.postMessage({
          type: 'COPY_DATA_URI',
        });
      }
    });

    // Messages from Extension Host
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'IMAGE_LOADED' && msg.payload) {
        const data = msg.payload;
        currentDataUri = data.dataUri;
        errorBanner.style.display = 'none';
        emptyState.style.display = 'none';
        previewImg.style.display = 'block';

        previewImg.onload = () => {
          const actualW = data.width > 0 ? data.width : previewImg.naturalWidth;
          const actualH = data.height > 0 ? data.height : previewImg.naturalHeight;
          metaDims.textContent = actualW && actualH ? \`\${actualW} × \${actualH} px\` : 'Vector / Dinámico';
          fitImageToViewport();
        };
        previewImg.src = data.dataUri;

        const binaryKb = (data.byteLength / 1024).toFixed(2);
        const base64Kb = (data.base64Length / 1024).toFixed(2);
        const overheadPct = data.byteLength > 0
          ? Math.round(((data.base64Length - data.byteLength) / data.byteLength) * 100)
          : 33;

        metaMime.textContent = \`\${data.mimeType} (.\${data.extension})\`;
        metaDims.textContent = data.width > 0 && data.height > 0
          ? \`\${data.width} × \${data.height} px\`
          : 'Calculando...';
        metaSize.textContent = \`\${binaryKb} KB real vs \${base64Kb} KB Base64 (+\${overheadPct}%)\`;
        metaSource.textContent = data.isDataUri ? 'Data URI' : 'Raw Base64';
        metaNotes.textContent =
          data.sanitizationNotes && data.sanitizationNotes.length > 0
            ? data.sanitizationNotes.join(', ')
            : 'Limpio';

        if (playgroundInput.value.trim() === '') {
          playgroundInput.value = data.isDataUri ? data.dataUri : data.base64Clean;
        }

        if (msg.openPlayground) {
          playgroundDrawer.classList.remove('collapsed');
          playgroundInput.focus();
        }
      } else if (msg.type === 'DECODE_ERROR') {
        errorText.textContent = '⚠️ ' + (msg.message || 'Cadena Base64 inválida.');
        errorBanner.style.display = 'flex';
      } else if (msg.type === 'CLIPBOARD_TEXT') {
        if (msg.rawText) {
          playgroundInput.value = msg.rawText;
          triggerDecode(msg.rawText);
        }
      } else if (msg.type === 'OPEN_PLAYGROUND') {
        playgroundDrawer.classList.remove('collapsed');
        playgroundInput.focus();
      }
    });

    vscode.postMessage({ type: 'READY' });
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    ImageInspectorPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length > 0) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
