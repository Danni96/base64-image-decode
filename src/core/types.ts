export type SupportedImageMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml'
  | 'image/bmp'
  | 'image/x-icon';

export interface DecodedImageResult {
  isValid: boolean;
  mimeType: SupportedImageMime;
  extension: 'png' | 'jpg' | 'gif' | 'webp' | 'svg' | 'bmp' | 'ico';
  width: number;
  height: number;
  base64Clean: string;
  dataUri: string;
  byteLength: number;
  base64Length: number;
  overheadPercent: number;
  wasSanitized: boolean;
  sanitizedNotes: string[];
  hadDataUriPrefix: boolean;
}

export interface ScannedBase64Candidate {
  rawText: string;
  startOffset: number;
  endOffset: number;
  line: number;
  startCharacter: number;
  endCharacter: number;
  decoded: DecodedImageResult;
}
