/**
 * Image helpers: downscale a photo before upload and read barcodes when the browser supports it.
 * @module services/image
 */

import { CONFIG } from '../config.js';

/**
 * Downscale an image file to JPEG and return it as base64 (no data-URL prefix) plus a data URL.
 * Phone photos are often 4000px+; shrinking keeps the Gemini request small and fast.
 * @param {File} file
 * @param {number} [maxSide]
 * @returns {Promise<{base64:string, dataUrl:string, mimeType:string}>}
 */
export async function prepareImage(file, maxSide = CONFIG.image.maxSide) {
  const bitmap = await createImageBitmap(file); // honours EXIF orientation in modern browsers
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL('image/jpeg', CONFIG.image.jpegQuality);
  return { dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
}

/** Tiny thumbnail for the history list. */
export async function makeThumbnail(dataUrl, side = 96) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = side / Math.max(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6);
}

/**
 * Try to read a barcode from the photo using the native BarcodeDetector (Chrome/Android, Safari 17+).
 * @param {File|Blob} file
 * @returns {Promise<string|null>} the barcode digits, or null if unsupported / none found
 */
export async function detectBarcode(file) {
  // 1) Native detector (fast, but missing on desktop Chrome/Windows and Firefox)
  if ('BarcodeDetector' in window) {
    try {
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      if (codes[0]?.rawValue) return codes[0].rawValue;
    } catch { /* fall through to ZXing */ }
  }
  // 2) ZXing fallback, loaded lazily from a CDN only when needed
  return detectBarcodeZxing(file);
}

async function detectBarcodeZxing(file) {
  const url = URL.createObjectURL(file);
  try {
    const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } =
      await import('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm');
    const hints = new Map([
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
      [DecodeHintType.TRY_HARDER, true],
    ]);
    const result = await new BrowserMultiFormatReader(hints).decodeFromImageUrl(url);
    return result.getText();
  } catch {
    return null; // no barcode found, or the library could not load
  } finally {
    URL.revokeObjectURL(url);
  }
}
