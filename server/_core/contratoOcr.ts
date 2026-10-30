import { mkdirSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { createScheduler, createWorker } from "tesseract.js";
import { extractImages, type getDocumentProxy } from "unpdf";
import type { Line } from "./laudoContrato";

/**
 * OCR for a scanned contract (each page is only a picture, so the PDF has no text). Tesseract runs on
 * this machine, free; the Portuguese model is downloaded once into .cache/tesseract.
 * Scans come at ~100 dpi, too little for Tesseract: the picture is enlarged 4 times (in gray, which
 * also fades the bank's light watermark) before reading. Even so a digit can come out wrong, so the
 * team is told to check what was read.
 */

const SCALE = 4;
/**
 * The footer's small print ("12/11/2024 17:36:34 (Horário de Brasília)" on Bradesco's pages) comes out
 * garbled at SCALE: the bottom strip of each page is read again, enlarged more, as one extra line.
 */
const FOOTER_SCALE = 6;
const FOOTER_SHARE = 0.045;
/** The footer is the same on every page: a few readings are enough to outvote a garbled one. */
const FOOTER_PAGES = 3;
/** Lines come back in the same units as a text PDF (an A4 page is 595 points wide), so the reader's distances still hold. */
const PAGE_WIDTH = 595;
const WORKERS = 3;
const CACHE = path.resolve(process.cwd(), ".cache", "tesseract");

type PageImage = { data: Uint8ClampedArray; width: number; height: number; channels: number };

/** The page's picture, from row fromRow down, enlarged scale times in gray (bilinear), as a PNG for Tesseract. */
function enlarge(image: PageImage, scale = SCALE, fromRow = 0) {
  const { data, width, channels } = image;
  const height = image.height - fromRow;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const at = (i + fromRow * width) * channels;
    gray[i] = channels >= 3 ? 0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2] : data[at];
  }
  const outWidth = width * scale, outHeight = height * scale;
  const png = new PNG({ width: outWidth, height: outHeight });
  for (let y = 0; y < outHeight; y++) {
    const fy = Math.min(Math.max((y + 0.5) / scale - 0.5, 0), height - 1);
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, height - 1), ay = fy - y0;
    for (let x = 0; x < outWidth; x++) {
      const fx = Math.min(Math.max((x + 0.5) / scale - 0.5, 0), width - 1);
      const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, width - 1), ax = fx - x0;
      const top = gray[y0 * width + x0] * (1 - ax) + gray[y0 * width + x1] * ax;
      const bottom = gray[y1 * width + x0] * (1 - ax) + gray[y1 * width + x1] * ax;
      const offset = (y * outWidth + x) * 4;
      png.data[offset] = png.data[offset + 1] = png.data[offset + 2] = top * (1 - ay) + bottom * ay;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

type OcrWord = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
type OcrLine = { words: OcrWord[]; bbox: { y0: number; y1: number } };

/** Reads every page's picture; a page without one comes back empty. Same shape as the lines of a text PDF, one item per word. */
export async function ocrPages(pdf: Awaited<ReturnType<typeof getDocumentProxy>>, maxPages: number): Promise<Line[][]> {
  const pageCount = Math.min(pdf.numPages, maxPages);
  // tesseract.js does not create the folder: without it the model is downloaded again on every reading.
  mkdirSync(CACHE, { recursive: true });
  const scheduler = createScheduler();
  for (let i = 0; i < Math.min(WORKERS, pageCount); i++) scheduler.addWorker(await createWorker("por", 1, { cachePath: CACHE }));
  try {
    return await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
      const pageNumber = index + 1;
      const images = await extractImages(pdf, pageNumber);
      // The scan is the page's largest picture; small ones are logos and QR codes.
      const image = images.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!image || image.width < 300) return [];
      const { data } = await scheduler.addJob("recognize", enlarge(image)) as unknown as { data: { lines: OcrLine[] } };
      const footerRow = Math.floor(image.height * (1 - FOOTER_SHARE));
      const { data: footer } = pageNumber <= FOOTER_PAGES
        ? await scheduler.addJob("recognize", enlarge(image, FOOTER_SCALE, footerRow)) as unknown as { data: { lines: OcrLine[] } }
        : { data: { lines: [] as OcrLine[] } };
      const unit = PAGE_WIDTH / image.width / SCALE;
      const pageHeight = image.height * SCALE;
      const footerUnit = PAGE_WIDTH / image.width / FOOTER_SCALE;
      // Below every line of the page, so nothing reads it as part of a cell.
      const footerLines = footer.lines.map((line, index): Line => {
        const items = line.words.map((word) => ({ x: word.bbox.x0 * footerUnit, y: -1 - index, text: word.text.normalize("NFC").trim() })).filter((item) => item.text);
        return { page: pageNumber, y: -1 - index, items, text: items.map((item) => item.text).join(" ") };
      });
      return [...data.lines
        .map((line): Line => {
          // PDF coordinates grow upwards; the picture's, downwards. The line's height is the middle of its
          // words' bottoms: a speck read beside a cell border can stretch the line's own box down to the next row.
          const bottoms = line.words.map((word) => word.bbox.y1).sort((a, b) => a - b);
          const y = (pageHeight - (bottoms[Math.floor(bottoms.length / 2)] ?? line.bbox.y1)) * unit;
          const items = line.words
            .map((word) => ({ x: word.bbox.x0 * unit, y, text: word.text.normalize("NFC").trim() }))
            .filter((item) => item.text);
          return { page: pageNumber, y, items, text: items.map((item) => item.text).join(" ") };
        }), ...footerLines]
        .filter((line) => line.items.length > 0)
        .sort((a, b) => b.y - a.y);
    }));
  } finally {
    await scheduler.terminate();
  }
}
