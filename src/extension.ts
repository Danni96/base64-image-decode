import * as vscode from 'vscode';
import { DecodedImageResult } from './core/types';
import {
  decodeAndInspectBase64Image,
  extractCandidateAtCursor,
} from './core/Base64Engine';
import {
  saveDecodedImageToDisk,
  encodeWorkspaceFileToBase64,
} from './services/FileService';
import {
  getPreviewItem,
  clearPreviewCache,
} from './providers/PreviewCache';
import {
  Base64HoverProvider,
  Base64CodeLensProvider,
  GutterDecoratorManager,
} from './providers/EditorProviders';
import { ImageInspectorPanel } from './webview/ImageInspectorPanel';

/**
 * Resolves a DecodedImageResult from a previewId argument, current editor selection, or cursor line.
 */
function resolveTargetImage(previewId?: string): DecodedImageResult | undefined {
  if (typeof previewId === 'string' && previewId.length > 0) {
    const cached = getPreviewItem(previewId);
    if (cached) {
      return cached;
    }
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const selection = editor.selection;
  if (!selection.isEmpty) {
    const selectedText = editor.document.getText(selection);
    const decodedSelection = decodeAndInspectBase64Image(selectedText);
    if (decodedSelection) {
      return decodedSelection;
    }
  }

  const cursorPos = selection.active;
  const lineText = editor.document.lineAt(cursorPos.line).text;
  const candidate = extractCandidateAtCursor(
    lineText,
    cursorPos.character,
    cursorPos.line
  );
  if (candidate?.decoded) {
    return candidate.decoded;
  }

  return decodeAndInspectBase64Image(lineText) ?? undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const hoverProvider = new Base64HoverProvider();
  const codeLensProvider = new Base64CodeLensProvider();
  const gutterDecorator = new GutterDecoratorManager();

  const documentSelector: vscode.DocumentSelector = '*';

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(documentSelector, hoverProvider),
    vscode.languages.registerCodeLensProvider(
      documentSelector,
      codeLensProvider
    ),
    gutterDecorator
  );

  // 1. Open Inspector (from Hover/CodeLens previewId or current cursor/selection)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'base64ImagePreview.openInspector',
      (previewId?: string) => {
        const decoded = resolveTargetImage(previewId);
        if (decoded) {
          ImageInspectorPanel.createOrShow(context.extensionUri, decoded, false);
        } else {
          ImageInspectorPanel.createOrShow(
            context.extensionUri,
            undefined,
            true
          );
        }
      }
    )
  );

  // 2. Preview Selection (decodes selected text or current line and opens Inspector)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'base64ImagePreview.previewSelection',
      async () => {
        const decoded = resolveTargetImage();
        if (decoded) {
          ImageInspectorPanel.createOrShow(context.extensionUri, decoded, false);
          return;
        }

        const clipboardText = await vscode.env.clipboard.readText();
        const clipboardDecoded = clipboardText
          ? decodeAndInspectBase64Image(clipboardText)
          : undefined;

        if (clipboardDecoded) {
          ImageInspectorPanel.createOrShow(
            context.extensionUri,
            clipboardDecoded,
            true
          );
          return;
        }

        void vscode.window.showWarningMessage(
          'No se detectó una imagen Base64 válida en la selección ni bajo el cursor. Abriendo el Playground interactivo.'
        );
        ImageInspectorPanel.createOrShow(context.extensionUri, undefined, true);
      }
    )
  );

  // 3. Open Playground (loads clipboard image automatically if valid)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'base64ImagePreview.openPlayground',
      async () => {
        let initialDecoded: DecodedImageResult | undefined;
        try {
          const clipText = await vscode.env.clipboard.readText();
          if (clipText && clipText.trim().length >= 24) {
            initialDecoded =
              decodeAndInspectBase64Image(clipText) ?? undefined;
          }
        } catch {
          // Ignore clipboard read issues
        }

        ImageInspectorPanel.createOrShow(
          context.extensionUri,
          initialDecoded,
          true
        );
      }
    )
  );

  // 4. Save Decoded Image to Disk
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'base64ImagePreview.saveImage',
      async (previewId?: string) => {
        const decoded = resolveTargetImage(previewId);
        if (!decoded) {
          void vscode.window.showWarningMessage(
            'No se encontró una imagen Base64 válida para guardar.'
          );
          return;
        }
        await saveDecodedImageToDisk(decoded);
      }
    )
  );

  // 5. Copy Data URI to Clipboard
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'base64ImagePreview.copyDataUri',
      async (previewId?: string) => {
        const decoded = resolveTargetImage(previewId);
        if (!decoded) {
          void vscode.window.showWarningMessage(
            'No se encontró una imagen Base64 válida para copiar su Data URI.'
          );
          return;
        }
        await vscode.env.clipboard.writeText(decoded.dataUri);
        void vscode.window.showInformationMessage(
          `Data URI (${decoded.mimeType}) copiado al portapapeles.`
        );
      }
    )
  );

  // 6. Copy Raw Base64 to Clipboard
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'base64ImagePreview.copyRawBase64',
      async (previewId?: string) => {
        const decoded = resolveTargetImage(previewId);
        if (!decoded) {
          void vscode.window.showWarningMessage(
            'No se encontró una imagen Base64 válida para copiar.'
          );
          return;
        }
        await vscode.env.clipboard.writeText(decoded.base64Clean);
        void vscode.window.showInformationMessage(
          'Cadena Base64 cruda copiada al portapapeles.'
        );
      }
    )
  );

  // 7. Encode Workspace Image File to Base64
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'base64ImagePreview.encodeFileToBase64',
      async (uri?: vscode.Uri) => {
        const decoded = await encodeWorkspaceFileToBase64(uri);
        if (decoded) {
          ImageInspectorPanel.createOrShow(context.extensionUri, decoded, true);
        }
      }
    )
  );
}

export function deactivate(): void {
  clearPreviewCache();
}
