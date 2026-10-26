import * as assert from 'assert';
import {
  decodeAndInspectBase64Image,
  extractCandidateAtCursor,
  scanLineForCandidates,
  sanitizeBase64Input
} from '../core/Base64Engine';

interface TestCase {
  name: string;
  run: () => void;
}

const RAW_PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DATA_URI_PNG_1X1 = `data:image/png;base64,${RAW_PNG_1X1}`;
const RAW_GIF_1X1 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const RAW_WEBP_1X1 = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';

function buildMinimalJpegBase64(width: number, height: number): string {
  // Minimal valid JPEG structure: SOI + APP0 (JFIF) + SOF0 (width/height) + SOS + EOI
  const buf = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, // APP0
    0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0 marker + length + 8-bit precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, // SOS
    0x00, 0xff, 0xd9 // Scan byte + EOI
  ]);
  return buf.toString('base64');
}

function buildMinimalBmpBase64(width: number, height: number): string {
  const buf = Buffer.alloc(70, 0);
  // BMP Header (14 bytes)
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(70, 2); // File size
  buf.writeUInt32LE(54, 10); // Pixel data offset
  // DIB Header BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 14); // DIB header size
  buf.writeInt32LE(width, 18); // Width
  buf.writeInt32LE(height, 22); // Height
  buf.writeUInt16LE(1, 26); // Planes
  buf.writeUInt16LE(24, 28); // Bits per pixel
  return buf.toString('base64');
}

function buildMinimalIcoBase64(width: number, height: number): string {
  const buf = Buffer.alloc(70, 0);
  // ICONDIR (6 bytes): 00 00 01 00 01 00
  buf.writeUInt16LE(0, 0); // Reserved
  buf.writeUInt16LE(1, 2); // Type: 1 = ICO
  buf.writeUInt16LE(1, 4); // Count: 1 image
  // ICONDIRENTRY (16 bytes)
  buf.writeUInt8(width === 256 ? 0 : width, 6);
  buf.writeUInt8(height === 256 ? 0 : height, 7);
  buf.writeUInt8(0, 8); // Color count
  buf.writeUInt8(0, 9); // Reserved
  buf.writeUInt16LE(1, 10); // Color planes
  buf.writeUInt16LE(32, 12); // Bits per pixel
  buf.writeUInt32LE(48, 14); // Image data size
  buf.writeUInt32LE(22, 18); // Image data offset
  return buf.toString('base64');
}

const tests: TestCase[] = [
  {
    name: '1. PNG en Base64 crudo (sin prefijo data:image/png;base64,)',
    run: () => {
      const result = decodeAndInspectBase64Image(RAW_PNG_1X1);
      assert.ok(result, 'Debe decodificar PNG crudo válido');
      assert.strictEqual(result.mimeType, 'image/png');
      assert.strictEqual(result.width, 1);
      assert.strictEqual(result.height, 1);
      assert.strictEqual(result.hadDataUriPrefix, false);
    }
  },
  {
    name: '2. PNG con Data URI completo (data:image/png;base64,...)',
    run: () => {
      const result = decodeAndInspectBase64Image(DATA_URI_PNG_1X1);
      assert.ok(result, 'Debe decodificar PNG con Data URI');
      assert.strictEqual(result.mimeType, 'image/png');
      assert.strictEqual(result.width, 1);
      assert.strictEqual(result.height, 1);
      assert.strictEqual(result.hadDataUriPrefix, true);
    }
  },
  {
    name: '3. JPEG en Base64 crudo y con escapes JSON (\\/9j\\/...)',
    run: () => {
      const rawJpeg = buildMinimalJpegBase64(3, 2);
      const escapedJpeg = rawJpeg.replace(/\//g, '\\/');
      assert.ok(escapedJpeg.startsWith('\\/9j\\/'), 'El payload de prueba debe iniciar con \\/9j\\/');

      const sanitized = sanitizeBase64Input(escapedJpeg);
      assert.strictEqual(sanitized.wasSanitized, true, 'sanitizeBase64Input debe marcar wasSanitized = true');

      const result = decodeAndInspectBase64Image(escapedJpeg);
      assert.ok(result, 'Debe decodificar JPEG con escapes JSON');
      assert.strictEqual(result.mimeType, 'image/jpeg');
      assert.strictEqual(result.wasSanitized, true);
      assert.strictEqual(result.width, 3);
      assert.strictEqual(result.height, 2);
    }
  },
  {
    name: '4. GIF 1x1 en Base64 crudo',
    run: () => {
      const result = decodeAndInspectBase64Image(RAW_GIF_1X1);
      assert.ok(result, 'Debe decodificar GIF 1x1 crudo');
      assert.strictEqual(result.mimeType, 'image/gif');
      assert.strictEqual(result.width, 1);
      assert.strictEqual(result.height, 1);
    }
  },
  {
    name: '5. WebP 1x1 en Base64 crudo',
    run: () => {
      const result = decodeAndInspectBase64Image(RAW_WEBP_1X1);
      assert.ok(result, 'Debe decodificar WebP 1x1 crudo');
      assert.strictEqual(result.mimeType, 'image/webp');
      assert.strictEqual(result.width, 1);
      assert.strictEqual(result.height, 1);
    }
  },
  {
    name: '6. SVG válido en Base64 crudo (120x80)',
    run: () => {
      const svgBase64 = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#4f46e5"/></svg>'
      ).toString('base64');
      const result = decodeAndInspectBase64Image(svgBase64);
      assert.ok(result, 'Debe decodificar SVG válido en Base64');
      assert.strictEqual(result.mimeType, 'image/svg+xml');
      assert.strictEqual(result.width, 120);
      assert.strictEqual(result.height, 80);
    }
  },
  {
    name: '7a. BMP válido en Base64 crudo (4x4)',
    run: () => {
      const bmpBase64 = buildMinimalBmpBase64(4, 4);
      const result = decodeAndInspectBase64Image(bmpBase64);
      assert.ok(result, 'Debe decodificar BMP válido');
      assert.strictEqual(result.mimeType, 'image/bmp');
      assert.strictEqual(result.width, 4);
      assert.strictEqual(result.height, 4);
    }
  },
  {
    name: '7b. ICO válido en Base64 crudo (16x16)',
    run: () => {
      const icoBase64 = buildMinimalIcoBase64(16, 16);
      const result = decodeAndInspectBase64Image(icoBase64);
      assert.ok(result, 'Debe decodificar ICO válido');
      assert.strictEqual(result.mimeType, 'image/x-icon');
      assert.strictEqual(result.width, 16);
      assert.strictEqual(result.height, 16);
    }
  },
  {
    name: '8a. Rechazo de Falso Positivo: Token JWT',
    run: () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const result = decodeAndInspectBase64Image(jwt);
      assert.strictEqual(result, null, 'Un token JWT debe retornar null');
    }
  },
  {
    name: '8b. Rechazo de Falso Positivo: Ruta UNIX (/9j/usuarios/fotos/avatar.jpg)',
    run: () => {
      const unixPath = '/9j/usuarios/fotos/avatar.jpg';
      const result = decodeAndInspectBase64Image(unixPath);
      assert.strictEqual(result, null, 'Una ruta UNIX debe retornar null');
    }
  },
  {
    name: '8c. Rechazo de Falso Positivo: Texto normal o hash corto',
    run: () => {
      assert.strictEqual(decodeAndInspectBase64Image('Hola mundo, esto no es base64'), null);
      assert.strictEqual(decodeAndInspectBase64Image('aGVsbG8gd29ybGQ='), null);
    }
  },
  {
    name: '9. Seguridad AppSec: Bloqueo de SVG con XSS (<script>)',
    run: () => {
      const maliciousSvgBase64 = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
      ).toString('base64');
      const result = decodeAndInspectBase64Image(maliciousSvgBase64);
      assert.strictEqual(result, null, 'SVG con <script> debe ser bloqueado y retornar null');
    }
  },
  {
    name: '10. Extracción bajo el cursor (extractCandidateAtCursor) y escaneo de línea (scanLineForCandidates)',
    run: () => {
      const jsonLine = `{"user": "demo", "avatar": "${RAW_PNG_1X1}"}`;
      const candidateAtCursor = extractCandidateAtCursor(jsonLine, 40);
      assert.ok(candidateAtCursor, 'Debe extraer candidato cuando el cursor está en la posición 40');

      const candidatesInLine = scanLineForCandidates(jsonLine, 0);
      assert.ok(Array.isArray(candidatesInLine), 'scanLineForCandidates debe retornar un arreglo');
      assert.strictEqual(candidatesInLine.length, 1, 'Debe detectar exactamente 1 imagen candidata en la línea JSON');
    }
  }
];

function runSuite(): void {
  console.log('==========================================================');
  console.log(' Ejecutando Suite de Pruebas Unitarias - Base64 Image Preview');
  console.log('==========================================================\n');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      test.run();
      passed++;
      console.log(`  [PASS] ${test.name}`);
    } catch (err) {
      failed++;
      console.error(`  [FAIL] ${test.name}`);
      console.error(`         ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n----------------------------------------------------------');
  console.log(` Total: ${tests.length} | Aprobadas: ${passed} | Fallidas: ${failed}`);
  console.log('----------------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite();
