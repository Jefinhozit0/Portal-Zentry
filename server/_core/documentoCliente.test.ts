import { describe, expect, it } from "vitest";
import { CLIENT_DOCUMENT_ACCEPT, tipoDoDocumentoCliente } from "@shared/processo";

const bytes = (...values: (number | string)[]) => Uint8Array.from(values.flatMap((value) => typeof value === "string" ? Array.from(Buffer.from(value)) : [value]));

describe("tipoDoDocumentoCliente", () => {
  it("recognizes the accepted files by their content", () => {
    expect(tipoDoDocumentoCliente(bytes("%PDF-1.7 resto"))).toBe("application/pdf");
    expect(tipoDoDocumentoCliente(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe("image/jpeg");
    expect(tipoDoDocumentoCliente(bytes(0x89, "PNG", 0x0d, 0x0a))).toBe("image/png");
    expect(tipoDoDocumentoCliente(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toBe("image/webp");
  });

  it("refuses anything else, whatever it is called", () => {
    expect(tipoDoDocumentoCliente(bytes("<html><script>alert(1)</script>"))).toBeNull();
    expect(tipoDoDocumentoCliente(bytes("MZ executavel"))).toBeNull();
    expect(tipoDoDocumentoCliente(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(tipoDoDocumentoCliente(bytes("RIFF", 0, 0, 0, 0, "WAVEfmt "))).toBeNull();
    expect(tipoDoDocumentoCliente(new Uint8Array())).toBeNull();
  });

  it("offers in the file picker only what the server accepts", () => {
    expect(CLIENT_DOCUMENT_ACCEPT.split(",")).toEqual(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
  });
});
