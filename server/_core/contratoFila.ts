import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LeituraContrato } from "./laudoContrato";

/**
 * Contracts the reader could not vouch for, kept on this machine so their layouts can be taught to it in a
 * batch, instead of the team bringing them one by one. Each one is a folder with the PDF and what was
 * missing; nothing leaves the notebook (.cache is outside git). Only the newest MAX_ITENS are kept.
 */

const PASTA = path.resolve(process.cwd(), ".cache", "contratos-revisar");
const MAX_ITENS = 100;

export type ItemFila = { id: string; quando: string; nome: string; ocr: boolean; banco: string; avisos: string[]; encontrados: string[] };

/** Keeps the contract when its main numbers were not confirmed. Never fails the reading it comes from. */
export async function guardarSeIncompleto(bytes: Uint8Array, nome: string, leitura: LeituraContrato & { ocr: boolean }) {
  if (leitura.conferencia.conferido && leitura.conferencia.avisos.length === 0) return;
  try {
    const quando = new Date().toISOString();
    const id = `${quando.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const pasta = path.join(PASTA, id);
    await mkdir(pasta, { recursive: true });
    await writeFile(path.join(pasta, "contrato.pdf"), bytes);
    const item: ItemFila = { id, quando, nome, ocr: leitura.ocr, banco: leitura.dados.instituicao, avisos: leitura.conferencia.avisos, encontrados: leitura.encontrados };
    await writeFile(path.join(pasta, "leitura.json"), JSON.stringify(item, null, 1));
    const antigos = (await readdir(PASTA)).sort().reverse().slice(MAX_ITENS);
    await Promise.all(antigos.map((old) => rm(path.join(PASTA, old), { recursive: true, force: true })));
  } catch (error) {
    console.warn("[contratos] Could not keep the contract for review:", error instanceof Error ? error.message : error);
  }
}

/** Newest first. */
export async function listarFila(): Promise<ItemFila[]> {
  let pastas: string[];
  try {
    pastas = (await readdir(PASTA)).sort().reverse();
  } catch {
    return [];
  }
  const itens = await Promise.all(pastas.map(async (pasta) => {
    try {
      return JSON.parse(await readFile(path.join(PASTA, pasta, "leitura.json"), "utf8")) as ItemFila;
    } catch {
      return null;
    }
  }));
  return itens.filter((item): item is ItemFila => item !== null);
}

/** Removes one item (once its layout is handled), or all of them. */
export async function removerDaFila(id?: string) {
  if (id !== undefined && !/^[\w-]+$/.test(id)) return;
  await rm(id === undefined ? PASTA : path.join(PASTA, id), { recursive: true, force: true });
}
