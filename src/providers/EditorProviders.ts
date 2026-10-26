import * as vscode from 'vscode';
import { DecodedImageResult, ScannedBase64Candidate } from '../core/types';
import {
  extractCandidateAtCursor,
  scanLineForCandidates,
} from '../core/Base64Engine';
import { storePreviewItem } from './PreviewCache';

function getCandidateRange(
  candidate: ScannedBase64Candidate,
  lineIndex: number,
  lineLength: number
): vscode.Range {
  const startCol =
    typeof candidate.startCharacter === 'number'
      ? candidate.startCharacter
      : 0;
  const endCol =
    typeof candidate.endCharacter === 'number'
      ? candidate.endCharacter
      : lineLength;
  const line =
    typeof candidate.line === 'number' ? candidate.line : lineIndex;

  return new vscode.Range(
    new vscode.Position(line, Math.max(0, startCol)),
    new vscode.Position(line, Math.max(startCol, endCol))
  );
}

function formatSizeKb(bytes: number): string {
  return (bytes / 1024).toFixed(2);
}

/**
 * Provides instant rich hover cards when hovering over Data URIs or raw Base64 image strings.
 */
export class Base64HoverProvider implements vscode.HoverProvider {
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const config = vscode.workspace.getConfiguration('base64ImagePreview');
    if (!config.get<boolean>('enableHover', true)) {
      return undefined;
    }

    const lineText = document.lineAt(position.line).text;
    if (!lineText || lineText.length < 24) {
      return undefined;
    }

    const candidate = extractCandidateAtCursor(
      lineText,
      position.character,
      position.line
    );
    if (!candidate || !candidate.decoded) {
      return undefined;
    }

    const decoded: DecodedImageResult = candidate.decoded;
    const previewId = storePreviewItem(decoded);
    const encodedArgs = encodeURIComponent(JSON.stringify([previewId]));

    const binaryKb = formatSizeKb(decoded.byteLength);
    const base64Bytes =
      typeof decoded.base64Length === 'number'
        ? decoded.base64Length
        : decoded.base64Clean.length;
    const base64Kb = formatSizeKb(base64Bytes);
    const sourceBadge = decoded.hadDataUriPrefix ? 'Data URI' : 'Raw Base64';
    const dimensionsLabel =
      decoded.width > 0 && decoded.height > 0
        ? `${decoded.width} × ${decoded.height} px`
        : 'Vector / Dimensiones dinámicas';

    const md = new vscode.MarkdownString();
    md.isTrusted = {
      enabledCommands: [
        'base64ImagePreview.openInspector',
        'base64ImagePreview.saveImage',
        'base64ImagePreview.copyDataUri',
        'base64ImagePreview.copyRawBase64',
      ],
    };
    md.supportThemeIcons = true;

    md.appendMarkdown(
      `**$(file-media) ${decoded.mimeType}** &nbsp;•&nbsp; \`${dimensionsLabel}\` &nbsp;•&nbsp; **Binario:** ${binaryKb} KB *(Base64: ${base64Kb} KB)* &nbsp;•&nbsp; \`${sourceBadge}\`\n\n`
    );

    if (decoded.sanitizedNotes && decoded.sanitizedNotes.length > 0) {
      md.appendMarkdown(
        `_$(sparkle) Sanitizado automáticamente: ${decoded.sanitizedNotes.join(', ')}_\n\n`
      );
    }

    md.appendMarkdown(`![Base64 Preview](${decoded.dataUri}|height=180)\n\n`);
    md.appendMarkdown(
      `[$(open-preview) Abrir en Visor](command:base64ImagePreview.openInspector?${encodedArgs}) &nbsp;|&nbsp; ` +
        `[$(save) Guardar Imagen](command:base64ImagePreview.saveImage?${encodedArgs}) &nbsp;|&nbsp; ` +
        `[$(clippy) Copiar Data URI](command:base64ImagePreview.copyDataUri?${encodedArgs}) &nbsp;|&nbsp; ` +
        `[$(copy) Copiar Base64](command:base64ImagePreview.copyRawBase64?${encodedArgs})`
    );

    const range = getCandidateRange(candidate, position.line, lineText.length);
    return new vscode.Hover(md, range);
  }
}

/**
 * Displays actionable CodeLenses above detected Base64 images in the document.
 */
export class Base64CodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> =
    this._onDidChangeCodeLenses.event;

  private static readonly MAX_SCAN_LINES = 2500;

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const enabled = vscode.workspace
      .getConfiguration('base64ImagePreview')
      .get<boolean>('enableCodeLens', true);

    if (!enabled) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];
    const lineCount = Math.min(
      document.lineCount,
      Base64CodeLensProvider.MAX_SCAN_LINES
    );

    for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
      if (token.isCancellationRequested) {
        break;
      }

      const lineText = document.lineAt(lineIdx).text;
      if (!lineText || lineText.length < 24) {
        continue;
      }

      const candidates = scanLineForCandidates(lineText, lineIdx);
      for (const candidate of candidates) {
        const { decoded } = candidate;
        const previewId = storePreviewItem(decoded);
        const range = getCandidateRange(candidate, lineIdx, lineText.length);

        const extUpper = decoded.extension.toUpperCase();
        const dims =
          decoded.width > 0 && decoded.height > 0
            ? `${decoded.width}×${decoded.height} px`
            : 'SVG/Vector';
        const kb = (decoded.byteLength / 1024).toFixed(1);

        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `$(eye) Previsualizar Imagen (${extUpper} • ${dims} • ${kb} KB)`,
            command: 'base64ImagePreview.openInspector',
            arguments: [previewId],
            tooltip: 'Abrir en el Inspector Interactivo de Imágenes Base64',
          })
        );

        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `$(save) Guardar .${decoded.extension}`,
            command: 'base64ImagePreview.saveImage',
            arguments: [previewId],
            tooltip: `Guardar imagen decodificada como archivo .${decoded.extension}`,
          })
        );
      }
    }

    return codeLenses;
  }
}

/**
 * Manages subtle inline/after decorations for detected Base64 image strings in visible editor ranges.
 */
export class GutterDecoratorManager implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      borderWidth: '1px',
      borderStyle: 'dashed',
      borderRadius: '3px',
      borderColor: new vscode.ThemeColor('editorInfo.foreground'),
      overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.triggerUpdate()),
      vscode.window.onDidChangeTextEditorVisibleRanges(() =>
        this.triggerUpdate()
      ),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (
          vscode.window.activeTextEditor &&
          e.document === vscode.window.activeTextEditor.document
        ) {
          this.triggerUpdate();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('base64ImagePreview')) {
          this.triggerUpdate();
        }
      })
    );

    this.triggerUpdate();
  }

  public triggerUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.updateDecorations(vscode.window.activeTextEditor);
    }, 150);
  }

  private updateDecorations(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      return;
    }

    const enabled = vscode.workspace
      .getConfiguration('base64ImagePreview')
      .get<boolean>('enableGutterHighlight', true);

    if (!enabled) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const decorations: vscode.DecorationOptions[] = [];
    const visitedLines = new Set<number>();

    for (const visibleRange of editor.visibleRanges) {
      const startLine = Math.max(0, visibleRange.start.line);
      const endLine = Math.min(
        editor.document.lineCount - 1,
        visibleRange.end.line
      );

      for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
        if (visitedLines.has(lineIdx)) {
          continue;
        }
        visitedLines.add(lineIdx);

        const lineText = editor.document.lineAt(lineIdx).text;
        if (!lineText || lineText.length < 24) {
          continue;
        }

        const candidates = scanLineForCandidates(lineText, lineIdx);
        for (const candidate of candidates) {
          const { decoded } = candidate;
          const range = getCandidateRange(candidate, lineIdx, lineText.length);
          const dims =
            decoded.width > 0 && decoded.height > 0
              ? `${decoded.width}×${decoded.height}`
              : decoded.extension.toUpperCase();
          const kb = (decoded.byteLength / 1024).toFixed(1);

          decorations.push({
            range,
            renderOptions: {
              after: {
                contentText: ` 🖼️ ${decoded.extension.toUpperCase()} (${dims} • ${kb} KB)`,
                color: new vscode.ThemeColor('editorCodeLens.foreground'),
                fontStyle: 'italic',
                margin: '0 0 0 6px',
              },
            },
          });
        }
      }
    }

    editor.setDecorations(this.decorationType, decorations);
  }

  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.decorationType.dispose();
    while (this.disposables.length > 0) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
