import PdfPrinter from "pdfmake";
import vfs from "pdfmake/build/vfs_fonts.js";
import type { TDocumentDefinitions } from "pdfmake/interfaces";

/** PDFs the team generates (laudo, procuração). Roboto comes inside pdfmake, so nothing depends on the machine's fonts. */

const fontFile = (name: string) => Buffer.from((vfs as unknown as Record<string, string>)[name], "base64");
const printer = new PdfPrinter({
  Roboto: { normal: fontFile("Roboto-Regular.ttf"), bold: fontFile("Roboto-Medium.ttf"), italics: fontFile("Roboto-Italic.ttf"), bolditalics: fontFile("Roboto-MediumItalic.ttf") },
});

export function renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = printer.createPdfKitDocument(definition);
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.end();
  });
}

/** Keeps a file name valid on Windows and in Storage. */
export const safePdfName = (name: string) => `${name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim()}.pdf`;
