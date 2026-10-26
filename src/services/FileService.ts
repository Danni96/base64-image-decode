import * as vscode from 'vscode';
import { DecodedImageResult } from '../core/types';
import { decodeAndInspectBase64Image } from '../core/Base64Engine';

/**
 * Prompts the user with a Save Dialog and writes the decoded image binary to disk.
 */
export async function saveDecodedImageToDisk(
  decoded: DecodedImageResult
): Promise<vscode.Uri | undefined> {
  const defaultFileName = `decoded-image-${Date.now()}.${decoded.extension}`;
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const defaultUri = workspaceFolder
    ? vscode.Uri.joinPath(workspaceFolder, defaultFileName)
    : vscode.Uri.file(defaultFileName);

  const filters: Record<string, string[]> = {
    [`Image (${decoded.extension.toUpperCase()})`]: [decoded.extension],
  };

  const targetUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters,
    saveLabel: 'Save Decoded Image',
  });

  if (!targetUri) {
    return undefined;
  }

  const buffer = Buffer.from(decoded.base64Clean, 'base64');
  await vscode.workspace.fs.writeFile(targetUri, new Uint8Array(buffer));

  const openAction = 'Open File';
  const selection = await vscode.window.showInformationMessage(
    `Image saved (${decoded.width}x${decoded.height} ${decoded.extension.toUpperCase()}, ${decoded.byteLength} bytes).`,
    openAction
  );

  if (selection === openAction) {
    await vscode.commands.executeCommand('vscode.open', targetUri);
  }

  return targetUri;
}

/**
 * Encodes an image file from the workspace (or via Open Dialog) into Base64,
 * validates it with Base64Engine, and offers quick actions (Copy Data URI, Copy Raw Base64, Open in Preview/Playground).
 */
export async function encodeWorkspaceFileToBase64(
  fileUri?: vscode.Uri
): Promise<DecodedImageResult | undefined> {
  let targetUri = fileUri;

  if (!targetUri) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Encode Image to Base64',
      filters: {
        Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'],
      },
    });

    if (!picked || picked.length === 0) {
      return undefined;
    }
    targetUri = picked[0];
  }

  const bytes = await vscode.workspace.fs.readFile(targetUri);
  const rawBase64 = Buffer.from(bytes).toString('base64');
  const decoded = decodeAndInspectBase64Image(rawBase64);

  if (!decoded) {
    await vscode.window.showErrorMessage(
      'Selected file is not a valid or supported image (PNG, JPEG, GIF, WebP, SVG, BMP, ICO) or exceeds security limits.'
    );
    return undefined;
  }

  const optionDataUri = {
    label: '$(clippy) Copy as Data URI',
    description: `data:${decoded.mimeType};base64,... (${decoded.base64Length} chars)`,
    id: 'dataUri' as const,
  };
  const optionRaw = {
    label: '$(code) Copy Raw Base64',
    description: `Clean Base64 without prefix (${decoded.base64Length} chars)`,
    id: 'raw' as const,
  };
  const optionPreview = {
    label: '$(eye) Open in Base64 Image Preview / Playground',
    description: `${decoded.width}x${decoded.height} ${decoded.extension.toUpperCase()} (${decoded.byteLength} bytes)`,
    id: 'preview' as const,
  };

  const choice = await vscode.window.showQuickPick([optionDataUri, optionRaw, optionPreview], {
    placeHolder: `Encoded ${decoded.width}x${decoded.height} ${decoded.mimeType} — Choose an action`,
  });

  if (!choice) {
    return undefined;
  }

  if (choice.id === 'dataUri') {
    await vscode.env.clipboard.writeText(decoded.dataUri);
    await vscode.window.showInformationMessage('Copied Data URI to clipboard.');
    return undefined;
  } else if (choice.id === 'raw') {
    await vscode.env.clipboard.writeText(decoded.base64Clean);
    await vscode.window.showInformationMessage('Copied raw Base64 to clipboard.');
    return undefined;
  } else if (choice.id === 'preview') {
    return decoded;
  }
  return undefined;
}
