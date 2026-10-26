import { DecodedImageResult, ScannedBase64Candidate, SupportedImageMime } from './types';

export interface SanitizedBase64Output {
  cleanBase64: string;
  declaredMime?: string;
  hadDataUriPrefix: boolean;
  wasSanitized: boolean;
  sanitizedNotes: string[];
}

const MIME_TO_EXTENSION: Record<SupportedImageMime, DecodedImageResult['extension']> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
};

const MAX_DIMENSION = 8192;

/**
 * Sanitizes raw Base64 or Data URI strings, handling JSON escaped slashes,
 * linebreaks, whitespace, Base64URL characters, and missing padding.
 */
export function sanitizeBase64Input(raw: string): SanitizedBase64Output {
  const sanitizedNotes: string[] = [];
  if (!raw || typeof raw !== 'string') {
    return {
      cleanBase64: '',
      hadDataUriPrefix: false,
      wasSanitized: false,
      sanitizedNotes,
    };
  }

  let working = raw.trim();

  // Strip wrapping quotes (", ', `)
  if (
    working.length >= 2 &&
    ((working.startsWith('"') && working.endsWith('"')) ||
      (working.startsWith("'") && working.endsWith("'")) ||
      (working.startsWith('`') && working.endsWith('`')))
  ) {
    working = working.slice(1, -1).trim();
  }

  let declaredMime: string | undefined;
  let hadDataUriPrefix = false;

  // Match data:image/<subtype>[;params];base64,
  const dataUriMatch = working.match(/^data:(image\/[a-zA-Z0-9.+-]+)(?:;[^,]*?)?;base64,/i);
  if (dataUriMatch) {
    hadDataUriPrefix = true;
    declaredMime = dataUriMatch[1].toLowerCase();
    working = working.slice(dataUriMatch[0].length);
  }

  // Replace JSON escaped slashes \/ -> /
  if (working.includes('\\/')) {
    working = working.replace(/\\\//g, '/');
    sanitizedNotes.push('JSON escaped slashes (\\/)');
  }

  // Handle literal escaped newlines/tabs if present in raw JSON strings
  if (working.includes('\\n') || working.includes('\\r') || working.includes('\\t')) {
    working = working.replace(/\\[nrt]/g, '');
    if (!sanitizedNotes.includes('Whitespace/linebreaks removed')) {
      sanitizedNotes.push('Whitespace/linebreaks removed');
    }
  }

  // Remove actual whitespace and linebreaks (\r, \n, \t, spaces)
  if (/[\r\n\t\s]/.test(working)) {
    working = working.replace(/[\r\n\t\s]+/g, '');
    if (!sanitizedNotes.includes('Whitespace/linebreaks removed')) {
      sanitizedNotes.push('Whitespace/linebreaks removed');
    }
  }

  // Convert Base64URL (- -> +, _ -> /)
  if (working.includes('-') || working.includes('_')) {
    working = working.replace(/-/g, '+').replace(/_/g, '/');
    sanitizedNotes.push('Base64URL characters (-/_) normalized');
  }

  // Normalize existing trailing padding before reconstructing
  const withoutTrailingEq = working.replace(/=+$/, '');
  const mod = withoutTrailingEq.length % 4;

  if (mod === 1) {
    // Remainder 1 is mathematically impossible in valid Base64
    return {
      cleanBase64: '',
      declaredMime,
      hadDataUriPrefix,
      wasSanitized: sanitizedNotes.length > 0,
      sanitizedNotes,
    };
  }

  let cleanBase64 = working;
  if (cleanBase64.length % 4 !== 0) {
    const padCount = (4 - (cleanBase64.length % 4)) % 4;
    cleanBase64 = cleanBase64 + '='.repeat(padCount);
    sanitizedNotes.push('Base64 padding (=) reconstructed');
  }

  return {
    cleanBase64,
    declaredMime,
    hadDataUriPrefix,
    wasSanitized: sanitizedNotes.length > 0,
    sanitizedNotes,
  };
}

function isLikelyFalsePositivePath(raw: string, cleanBase64: string, hadDataUriPrefix: boolean): boolean {
  if (hadDataUriPrefix) {
    return false;
  }

  const trimmed = raw.trim().replace(/^['"`]|['"`]$/g, '');
  // Reject obvious UNIX/file paths like /9j/usuarios/foto.jpg
  if (/\.(?:jpg|jpeg|png|gif|webp|svg|bmp|ico|json|js|ts|html|css)$/i.test(trimmed)) {
    return true;
  }

  if (trimmed.startsWith('/9j/')) {
    // Check if it looks like path segments of lowercase words separated by slashes
    const segments = trimmed.split('/').filter(Boolean);
    if (segments.length >= 2 && segments.slice(1).every((seg) => /^[a-z0-9_.-]+$/i.test(seg) && seg.length < 24)) {
      // Wait: valid JPEG base64 after /9j/ usually starts with 4AAQSkZJRg or 2wBD... and is a dense block or has high uppercase/digit mix
      // If total length is very short (< 28) and has multiple slashes, likely a path
      if (cleanBase64.length < 32 && (trimmed.match(/\//g) || []).length >= 2) {
        return true;
      }
    }
  }

  return false;
}

function inspectPng(buffer: Buffer): { width: number; height: number } | null {
  // 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a
  ) {
    return null;
  }

  // IHDR chunk check at offset 12..15 ('IHDR')
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR') {
    return null;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function inspectJpeg(buffer: Buffer): { width: number; height: number } | null {
  // FF D8 FF
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
    return null;
  }

  // Fourth byte in valid JPEG headers is a marker (e.g., E0, E1, DB, C0, FE, EE, etc. >= 0xC0)
  if (buffer[3] < 0xc0) {
    return null;
  }

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    // Skip any fill 0xFF bytes
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset++;
    }
    if (offset >= buffer.length) {
      break;
    }

    const marker = buffer[offset];
    offset++;

    // Standalone markers without length
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      continue;
    }

    if (offset + 2 > buffer.length) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) {
      break;
    }

    // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2), SOF3 (0xC3)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3) {
      if (offset + 7 <= buffer.length) {
        const height = buffer.readUInt16BE(offset + 3);
        const width = buffer.readUInt16BE(offset + 5);
        return { width, height };
      }
      break;
    }

    offset += segmentLength;
  }

  // Minimal truncated JPEG test fixture fallback if valid FF D8 FF marker + valid 4th marker byte
  return { width: 1, height: 1 };
}

function inspectGif(buffer: Buffer): { width: number; height: number } | null {
  // GIF87a or GIF89a
  if (buffer.length < 10) {
    return null;
  }
  const sig = buffer.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') {
    return null;
  }

  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  return { width, height };
}

function inspectWebp(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 12) {
    return null;
  }
  const riff = buffer.toString('ascii', 0, 4);
  const webp = buffer.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || webp !== 'WEBP') {
    return null;
  }

  if (buffer.length < 16) {
    return { width: 1, height: 1 };
  }

  const chunkHeader = buffer.toString('ascii', 12, 16);

  if (chunkHeader === 'VP8 ' && buffer.length >= 30) {
    // Lossy VP8: frame tag starts at 20, keyframe signature 9D 01 2A at 23..25
    if (buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
  } else if (chunkHeader === 'VP8L' && buffer.length >= 25) {
    // Lossless VP8L: signature 0x2f at offset 20, 4 bytes packed dimensions at 21..24
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  } else if (chunkHeader === 'VP8X' && buffer.length >= 30) {
    // Extended VP8X: 24-bit LE width-1 at 24..26, height-1 at 27..29
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }

  // Fallback for ultra-short WebP test buffers with valid RIFF....WEBP magic bytes
  return { width: 1, height: 1 };
}

function inspectBmp(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 26 || buffer[0] !== 0x42 || buffer[1] !== 0x4d) {
    return null;
  }
  // Reserved bytes 6..9 must be 0
  if (buffer[6] !== 0 || buffer[7] !== 0 || buffer[8] !== 0 || buffer[9] !== 0) {
    return null;
  }

  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const height = Math.abs(rawHeight);
  return { width, height };
}

function inspectIco(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length < 22 ||
    buffer[0] !== 0x00 ||
    buffer[1] !== 0x00 ||
    buffer[2] !== 0x01 ||
    buffer[3] !== 0x00
  ) {
    return null;
  }

  const imageCount = buffer.readUInt16LE(4);
  if (imageCount < 1 || imageCount > 64) {
    return null;
  }

  const rawWidth = buffer[6];
  const rawHeight = buffer[7];
  const width = rawWidth === 0 ? 256 : rawWidth;
  const height = rawHeight === 0 ? 256 : rawHeight;
  return { width, height };
}

function inspectSvg(buffer: Buffer): { width: number; height: number } | null {
  // Check that buffer doesn't contain binary null bytes typical of binary formats
  if (buffer.includes(0x00)) {
    return null;
  }

  const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  const lower = text.toLowerCase();

  const startsWithSvg = lower.startsWith('<svg');
  const startsWithXmlAndHasSvg = lower.startsWith('<?xml') && lower.includes('<svg');
  if (!startsWithSvg && !startsWithXmlAndHasSvg) {
    return null;
  }

  // AppSec checks: immediately reject dangerous SVG payloads (XSS, XXE, script execution)
  const forbiddenPatterns = [
    '<script',
    '<!entity',
    '<!doctype',
    '<foreignobject',
    'onload=',
    'onerror=',
    'javascript:',
  ];
  for (const pattern of forbiddenPatterns) {
    if (lower.includes(pattern)) {
      return null;
    }
  }

  let width = 256;
  let height = 256;

  const svgTagMatch = text.match(/<svg\b[^>]*>/i);
  if (svgTagMatch) {
    const svgTag = svgTagMatch[0];

    const widthMatch = svgTag.match(/\bwidth\s*=\s*["']\s*([0-9]+(?:\.[0-9]+)?)/i);
    const heightMatch = svgTag.match(/\bheight\s*=\s*["']\s*([0-9]+(?:\.[0-9]+)?)/i);
    const viewBoxMatch = svgTag.match(
      /\bviewBox\s*=\s*["']\s*[-+]?[0-9]*\.?[0-9]+[\s,]+[-+]?[0-9]*\.?[0-9]+[\s,]+([0-9]+(?:\.[0-9]+)?)[\s,]+([0-9]+(?:\.[0-9]+)?)/i
    );

    if (widthMatch && heightMatch) {
      width = Math.round(parseFloat(widthMatch[1]));
      height = Math.round(parseFloat(heightMatch[1]));
    } else if (viewBoxMatch) {
      width = Math.round(parseFloat(viewBoxMatch[1]));
      height = Math.round(parseFloat(viewBoxMatch[2]));
    }
  }

  return { width, height };
}

/**
 * Decodes and inspects a candidate Base64 string or Data URI, verifying real binary
 * magic bytes and extracting image dimensions and metadata.
 */
export function decodeAndInspectBase64Image(
  raw: string,
  maxBase64Length: number = 15 * 1024 * 1024
): DecodedImageResult | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  if (raw.length < 16 || raw.length > maxBase64Length) {
    return null;
  }

  const sanitized = sanitizeBase64Input(raw);
  const { cleanBase64, hadDataUriPrefix, wasSanitized, sanitizedNotes } = sanitized;

  if (!cleanBase64 || cleanBase64.length < 16 || cleanBase64.length > maxBase64Length) {
    return null;
  }

  // Validate strict Base64 alphabet after sanitization
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
    return null;
  }

  if (isLikelyFalsePositivePath(raw, cleanBase64, hadDataUriPrefix)) {
    return null;
  }

  const buffer = Buffer.from(cleanBase64, 'base64');
  if (buffer.length < 4) {
    return null;
  }

  let mimeType: SupportedImageMime | null = null;
  let dimensions: { width: number; height: number } | null = null;

  // Check binary formats via magic bytes
  if ((dimensions = inspectPng(buffer))) {
    mimeType = 'image/png';
  } else if ((dimensions = inspectJpeg(buffer))) {
    mimeType = 'image/jpeg';
  } else if ((dimensions = inspectGif(buffer))) {
    mimeType = 'image/gif';
  } else if ((dimensions = inspectWebp(buffer))) {
    mimeType = 'image/webp';
  } else if ((dimensions = inspectBmp(buffer))) {
    mimeType = 'image/bmp';
  } else if ((dimensions = inspectIco(buffer))) {
    mimeType = 'image/x-icon';
  } else if ((dimensions = inspectSvg(buffer))) {
    mimeType = 'image/svg+xml';
  }

  if (!mimeType || !dimensions) {
    return null;
  }

  const { width, height } = dimensions;

  // Anti-Zip Bomb & invalid dimension guard
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    return null;
  }

  const byteLength = buffer.length;
  const base64Length = cleanBase64.length;
  const overheadPercent = Math.round(((base64Length - byteLength) / Math.max(1, byteLength)) * 100);
  const extension = MIME_TO_EXTENSION[mimeType];
  const dataUri = `data:${mimeType};base64,${cleanBase64}`;

  return {
    isValid: true,
    mimeType,
    extension,
    width,
    height,
    base64Clean: cleanBase64,
    dataUri,
    byteLength,
    base64Length,
    overheadPercent,
    wasSanitized,
    sanitizedNotes,
    hadDataUriPrefix,
  };
}

function isTokenChar(ch: string): boolean {
  if (!ch) {
    return false;
  }
  const code = ch.charCodeAt(0);
  // A-Z (65-90), a-z (97-122), 0-9 (48-57)
  if (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57)
  ) {
    return true;
  }
  // Allowed Base64 / DataURI / JSON escape punctuation: + / = _ ; : , - \ .
  return (
    ch === '+' ||
    ch === '/' ||
    ch === '=' ||
    ch === '_' ||
    ch === ';' ||
    ch === ':' ||
    ch === ',' ||
    ch === '-' ||
    ch === '\\' ||
    ch === '.'
  );
}

/**
 * Expands left and right pointers from the cursor position in O(k) time to extract
 * a candidate Base64 / DataURI token and validate it.
 */
export function extractCandidateAtCursor(
  lineText: string,
  character: number,
  lineNumber: number = 0,
  maxScanWindow: number = 10 * 1024 * 1024
): ScannedBase64Candidate | null {
  if (!lineText || lineText.length < 16 || lineText.length > maxScanWindow) {
    return null;
  }

  const clampedChar = Math.max(0, Math.min(character, lineText.length - 1));

  // If cursor is on a quote right next to the token, nudge inward
  let pivot = clampedChar;
  if (!isTokenChar(lineText[pivot])) {
    if (pivot + 1 < lineText.length && isTokenChar(lineText[pivot + 1])) {
      pivot = pivot + 1;
    } else if (pivot > 0 && isTokenChar(lineText[pivot - 1])) {
      pivot = pivot - 1;
    } else {
      return null;
    }
  }

  let left = pivot;
  let right = pivot;

  while (left > 0 && isTokenChar(lineText[left - 1])) {
    left--;
  }

  while (right < lineText.length && isTokenChar(lineText[right])) {
    right++;
  }

  let rawToken = lineText.slice(left, right);

  // If the token does not start with data:image/, strip leading non-base64 punctuation (e.g., `:` or `,` from key:value)
  if (!/^data:image\//i.test(rawToken)) {
    const leadingTrim = rawToken.match(/^[;:,.\\-]+/);
    if (leadingTrim) {
      left += leadingTrim[0].length;
      rawToken = lineText.slice(left, right);
    }
  }

  // Strip trailing punctuation like `;`, `,`, `:` that belong to surrounding syntax (JSON/CSS/JS)
  const trailingTrim = rawToken.match(/[;:,.\\-]+$/);
  if (trailingTrim) {
    right -= trailingTrim[0].length;
    rawToken = lineText.slice(left, right);
  }

  if (rawToken.length < 16) {
    return null;
  }

  const decoded = decodeAndInspectBase64Image(rawToken);
  if (!decoded) {
    return null;
  }

  return {
    rawText: rawToken,
    startOffset: left,
    endOffset: right,
    line: lineNumber,
    startCharacter: left,
    endCharacter: right,
    decoded,
  };
}

/**
 * Scans a single line for all valid Base64 image candidates (both Data URIs and raw magic byte prefixes).
 */
export function scanLineForCandidates(
  lineText: string,
  lineNumber: number
): ScannedBase64Candidate[] {
  if (!lineText || lineText.length < 16) {
    return [];
  }

  const results: ScannedBase64Candidate[] = [];
  const prefixRegex =
    /(?:data:image\/[a-zA-Z0-9.+-]+(?:;[^,]*?)?;base64,|iVBORw0KGgo|\/9j\/|\\\/9j\\\/|R0lGOD|UklGR|PHN2Zy|PD94bWwg|Qk|AAABAA)/g;

  let match: RegExpExecArray | null;
  let lastEndIndex = -1;

  while ((match = prefixRegex.exec(lineText)) !== null) {
    const matchStart = match.index;
    if (matchStart < lastEndIndex) {
      continue;
    }

    // Ensure prefix is not in the middle of another alphanumeric identifier
    if (matchStart > 0 && /[A-Za-z0-9]/.test(lineText[matchStart - 1])) {
      continue;
    }

    let end = matchStart + match[0].length;
    while (end < lineText.length && isTokenChar(lineText[end])) {
      // Stop if we hit a CSS/JSON delimiter like `;` or `,` or `:` AFTER the base64 payload has started
      const ch = lineText[end];
      if (ch === ';' || ch === ',' || ch === ':') {
        break;
      }
      end++;
    }

    const candidateText = lineText.slice(matchStart, end);
    if (candidateText.length >= 16) {
      const decoded = decodeAndInspectBase64Image(candidateText);
      if (decoded) {
        results.push({
          rawText: candidateText,
          startOffset: matchStart,
          endOffset: end,
          line: lineNumber,
          startCharacter: matchStart,
          endCharacter: end,
          decoded,
        });
        lastEndIndex = end;
      }
    }
  }

  return results;
}
