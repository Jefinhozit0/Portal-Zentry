import { describe, expect, it } from "vitest";
import { getDocumentProxy } from "unpdf";
import { apagarLinhas, desenharPagina, preencheAPagina } from "./contratoOcr";
import { renderPdf } from "./pdf";

const A4 = { width: 595, height: 842 };

describe("OCR de PDF sem texto", () => {
  it("treats only a picture with the page's proportions as a scan", () => {
    expect(preencheAPagina({ width: 827, height: 1169 }, A4)).toBe(true);
    expect(preencheAPagina({ width: 3909, height: 250 }, A4)).toBe(false); // banner
    expect(preencheAPagina({ width: 1168, height: 417 }, A4)).toBe(false); // logo
    expect(preencheAPagina({ width: 189, height: 437 }, A4)).toBe(false); // barcode
  });

  it("erases long strokes and keeps the short ones of the letters", () => {
    const width = 20, height = 20;
    const data = new Uint8ClampedArray(width * height).fill(255);
    for (let x = 0; x < width; x++) data[5 * width + x] = 0; // border
    for (let y = 10; y < 14; y++) data[y * width + 3] = 0; // stem of a letter
    const limpo = apagarLinhas(data, width, height, 10);
    expect(limpo[5 * width + 7]).toBe(255);
    expect(limpo[11 * width + 3]).toBe(0);
  });

  it("draws a page on a white background", async () => {
    const bytes = await renderPdf({ pageSize: "A4", content: [{ text: "Texto de teste", fontSize: 30 }], defaultStyle: { font: "Roboto" } });
    const { data, width, height, channels } = await desenharPagina(await getDocumentProxy(new Uint8Array(bytes)), 1);
    expect(width).toBe(3300);
    expect(height).toBeGreaterThan(width);
    expect(channels).toBe(1);
    expect(data[0]).toBe(255);
    expect(data.some((value) => value < 100)).toBe(true);
  }, 30_000);
});
