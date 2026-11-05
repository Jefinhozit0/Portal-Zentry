/** Saves a file the server sent as base64 to the user's computer. */
export function downloadFile(name: string, base64: string, type: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Saves a PDF the server sent as base64 (laudo, procuração). */
export const downloadPdf = (name: string, base64: string) => downloadFile(name, base64, "application/pdf");

/** A file the user picked, as base64 (without the "data:...;base64," prefix), to send to the server. */
export function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Opens the file picker for several files and hands back the content of those within the size limit. */
export function pickFiles(accept: string, maxBytes: number, onTooBig: (name: string) => void): Promise<{ name: string; base64: string }[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept, multiple: true });
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      files.filter((file) => file.size > maxBytes).forEach((file) => onTooBig(file.name));
      resolve(await Promise.all(files.filter((file) => file.size <= maxBytes).map(async (file) => ({ name: file.name, base64: await readAsBase64(file) }))));
    };
    input.click();
  });
}

/** Opens the file picker for one PDF and hands back its content; null when the user cancels. */
export function pickPdf(maxBytes: number, onTooBig: (name: string) => void): Promise<{ name: string; base64: string } | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "application/pdf,.pdf" });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > maxBytes) { onTooBig(file.name); return resolve(null); }
      resolve({ name: file.name, base64: await readAsBase64(file) });
    };
    input.click();
  });
}
