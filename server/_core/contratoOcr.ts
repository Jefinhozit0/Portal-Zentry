import { mkdirSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { createScheduler, createWorker } from "tesseract.js";
import { extractImages, type getDocumentProxy, renderPageAsImage } from "unpdf";
import type { Line } from "./laudoContrato";

/**
 * OCR for a scanned contract (each page is only a picture, so the PDF has no text). Tesseract runs on
 * this machine, free; the Portuguese model is downloaded once into .cache/tesseract.
 * Bank scans come at ~100 dpi, too little for Tesseract: the picture is enlarged (in gray, which also
 * fades the bank's light watermark) to about BODY_WIDTH pixels wide before reading, up to 4 times; a
 * photo or a 300 dpi scan is already that wide and is read nearly as it is. Even so a digit can come out wrong, so the
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
/**
 * The width pages are enlarged to (a 100 dpi A4 enlarged 4 times). Enlarging a large picture as much
 * runs Tesseract out of memory ("pixdata_malloc fail") or makes it crawl for many minutes.
 */
const BODY_WIDTH = 3300;
const FOOTER_WIDTH = 5000;
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

type Pdf = Awaited<ReturnType<typeof getDocumentProxy>>;

/** Whether a picture fills a page of these proportions, as a scan does; a banner, logo or barcode does not. */
export function preencheAPagina(image: { width: number; height: number }, page: { width: number; height: number }) {
  if (image.width < 300) return false;
  return Math.abs(image.height / image.width - page.height / page.width) <= 0.25 * (page.height / page.width);
}

/** Width a page with no picture of itself is drawn at. At 2480 (300 dpi) a contract's e-mail, in small print, was lost. */
export const DRAWN_WIDTH = BODY_WIDTH;
/** Dark strokes at least this long (at DRAWN_WIDTH) are table borders and barcode bars: no letter is that long. */
const MIN_LINE = 90;
const DARK = 140;

/** White over long straight strokes, which make Tesseract lose the rows of a table. */
export function apagarLinhas(data: Uint8ClampedArray, width: number, height: number, minimo = MIN_LINE) {
  const out = new Uint8ClampedArray(data);
  const scan = (count: number, length: number, at: (line: number, position: number) => number) => {
    for (let line = 0; line < count; line++) {
      let start = -1;
      for (let position = 0; position <= length; position++) {
        const dark = position < length && data[at(line, position)] < DARK;
        if (dark && start < 0) start = position;
        if (!dark && start >= 0) {
          if (position - start >= minimo) for (let i = start; i < position; i++) out[at(line, i)] = 255;
          start = -1;
        }
      }
    }
  };
  scan(height, width, (y, x) => y * width + x);
  scan(width, height, (x, y) => y * width + x);
  return out;
}

/**
 * The whole page drawn as a picture, in gray on white, without table borders. Some PDFs have no text and no scan: each
 * letter is a vector shape (a Santander contract signed on a tablet), and the only pictures are barcodes and logos.
 */
export async function desenharPagina(pdf: Pdf, pageNumber: number): Promise<PageImage> {
  const png = await renderPageAsImage(await pdf.getData(), pageNumber, { canvasImport: () => import("@napi-rs/canvas"), width: DRAWN_WIDTH });
  const { data, width, height } = PNG.sync.read(Buffer.from(png));
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    const at = i * 4, alpha = data[at + 3] / 255;
    gray[i] = (0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2]) * alpha + 255 * (1 - alpha);
  }
  return { data: apagarLinhas(gray, width, height), width, height, channels: 1 };
}

type OcrWord = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
type OcrLine = { words: OcrWord[]; bbox: { y0: number; y1: number } };

/** Reads a photo or scanned image (JPEG, PNG) as page 1; empty when it cannot be read. */
export async function ocrImagem(image: Buffer): Promise<Line[]> {
  mkdirSync(CACHE, { recursive: true });
  const worker = await createWorker("por", 1, { cachePath: CACHE, errorHandler: (error: unknown) => console.warn("[ocr] Tesseract could not read an image:", error) });
  try {
    const { data } = await worker.recognize(image) as unknown as { data: { lines: OcrLine[] } };
    return data.lines
      .map((line): Line => {
        const items = line.words.map((word) => ({ x: word.bbox.x0, y: -line.bbox.y1, text: word.text.normalize("NFC").trim() })).filter((item) => item.text);
        return { page: 1, y: -line.bbox.y1, items, text: items.map((item) => item.text).join(" ") };
      })
      .filter((line) => line.items.length > 0);
  } catch (error) {
    console.warn("[ocr] Image could not be read:", error);
    return [];
  } finally {
    await worker.terminate();
  }
}

/** A rectangle of a picture, in shares of its width and height, read as one line. Only these characters, when given. */
export type CampoFixo = { x0: number; y0: number; x1: number; y1: number; caracteres?: string };

/** After stretching, what is darker than this is print. Thin gray print on a pale card: lower, its strokes break and digits change. */
const LIMIAR_CAMPO = 190;
const MARGEM_CAMPO = 20;

/** The rectangle in black and white, enlarged, with a white margin. */
function recortar(image: PageImage, { x0, y0, x1, y1 }: CampoFixo) {
  const left = Math.round(x0 * image.width), top = Math.round(y0 * image.height);
  const width = Math.round((x1 - x0) * image.width), height = Math.round((y1 - y0) * image.height);
  const gray = new Uint8ClampedArray(width * height);
  let min = 255, max = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = ((top + y) * image.width + left + x) * image.channels;
    const value = image.channels >= 3 ? 0.299 * image.data[at] + 0.587 * image.data[at + 1] + 0.114 * image.data[at + 2] : image.data[at];
    gray[y * width + x] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const range = Math.max(max - min, 1);
  for (let i = 0; i < gray.length; i++) gray[i] = ((gray[i] - min) / range) * 255;
  const grande = PNG.sync.read(enlarge({ data: gray, width, height, channels: 1 }, SCALE));
  const saida = new PNG({ width: grande.width + 2 * MARGEM_CAMPO, height: grande.height + 2 * MARGEM_CAMPO });
  saida.data.fill(255);
  for (let y = 0; y < grande.height; y++) for (let x = 0; x < grande.width; x++) {
    const value = grande.data[(y * grande.width + x) * 4] < LIMIAR_CAMPO ? 0 : 255;
    const at = ((y + MARGEM_CAMPO) * saida.width + x + MARGEM_CAMPO) * 4;
    saida.data[at] = saida.data[at + 1] = saida.data[at + 2] = value;
  }
  return PNG.sync.write(saida);
}

/** Reads fields at known places of a picture, for documents whose layout never changes. */
export async function lerCamposFixos<K extends string>(image: PageImage, campos: Record<K, CampoFixo>): Promise<Record<K, string>> {
  mkdirSync(CACHE, { recursive: true });
  const worker = await createWorker("por", 1, { cachePath: CACHE, errorHandler: (error: unknown) => console.warn("[ocr] Tesseract could not read a field:", error) });
  const lidos = {} as Record<K, string>;
  try {
    for (const nome of Object.keys(campos) as K[]) {
      await worker.setParameters({ tessedit_pageseg_mode: "7" as never, tessedit_char_whitelist: campos[nome].caracteres ?? "" });
      const { data } = await worker.recognize(recortar(image, campos[nome]));
      lidos[nome] = data.text.replace(/\s+/g, " ").trim();
    }
    return lidos;
  } finally {
    await worker.terminate();
  }
}

/** Reads every page's picture; a page without one comes back empty. Same shape as the lines of a text PDF, one item per word. */
export async function ocrPages(pdf: Pdf, maxPages: number): Promise<Line[][]> {
  const pageCount = Math.min(pdf.numPages, maxPages);
  // tesseract.js does not create the folder: without it the model is downloaded again on every reading.
  mkdirSync(CACHE, { recursive: true });
  const scheduler = createScheduler();
  // Without errorHandler a failed reading is thrown inside tesseract.js where nothing can catch it, and
  // takes the whole server down; with it, the job just fails and its page comes back empty.
  const errorHandler = (error: unknown) => console.warn("[ocr] Tesseract could not read a page:", error);
  for (let i = 0; i < Math.min(WORKERS, pageCount); i++) scheduler.addWorker(await createWorker("por", 1, { cachePath: CACHE, errorHandler }));
  let fila: Promise<unknown> = Promise.resolve();
  const desenharEmFila = (pageNumber: number) => {
    const desenho = fila.catch(() => undefined).then(() => desenharPagina(pdf, pageNumber));
    fila = desenho;
    return desenho;
  };
  try {
    return await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
      const pageNumber = index + 1;
      const images = await extractImages(pdf, pageNumber);
      // The scan is the page's largest picture; small ones are logos and QR codes.
      const largest = images.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      try {
        const { width, height } = (await pdf.getPage(pageNumber)).getViewport({ scale: 1 });
        // One page at a time: a drawn page is large in memory.
        const image = largest && preencheAPagina(largest, { width, height }) ? largest : await desenharEmFila(pageNumber);
        const scale = Math.max(1, Math.min(SCALE, BODY_WIDTH / image.width));
        const footerScale = Math.max(1, Math.min(FOOTER_SCALE, FOOTER_WIDTH / image.width));
        const { data } = await scheduler.addJob("recognize", enlarge(image, scale)) as unknown as { data: { lines: OcrLine[] } };
        const footerRow = Math.floor(image.height * (1 - FOOTER_SHARE));
        const { data: footer } = pageNumber <= FOOTER_PAGES
          ? await scheduler.addJob("recognize", enlarge(image, footerScale, footerRow)) as unknown as { data: { lines: OcrLine[] } }
          : { data: { lines: [] as OcrLine[] } };
        const unit = PAGE_WIDTH / image.width / scale;
        const pageHeight = image.height * scale;
        const footerUnit = PAGE_WIDTH / image.width / footerScale;
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
      } catch (error) {
        console.warn(`[ocr] Page ${pageNumber} could not be read:`, error);
        return [];
      }
    }));
  } finally {
    await scheduler.terminate();
  }
}
