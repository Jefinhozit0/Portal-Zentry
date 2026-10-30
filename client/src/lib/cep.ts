import { type RefObject, useRef, useState } from "react";
import type { EnderecoCep } from "@shared/cep";

const TIMEOUT_MS = 5000;

async function viaCep(cep: string): Promise<EnderecoCep | null> {
  const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 400) return null;
  if (!response.ok) throw new Error(`ViaCEP ${response.status}`);
  const data = await response.json();
  if (data.erro) return null;
  return { cep, logradouro: data.logradouro ?? "", bairro: data.bairro ?? "", cidade: data.localidade ?? "", uf: data.uf ?? "" };
}

async function brasilApi(cep: string): Promise<EnderecoCep | null> {
  const response = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`BrasilAPI ${response.status}`);
  const data = await response.json();
  return { cep, logradouro: data.street ?? "", bairro: data.neighborhood ?? "", cidade: data.city ?? "", uf: data.state ?? "" };
}

/** The address of a CEP (8 digits): ViaCEP, and BrasilAPI when ViaCEP is down. null when neither knows it. */
export async function buscarCep(cep: string): Promise<EnderecoCep | null> {
  try {
    return await viaCep(cep);
  } catch {
    return brasilApi(cep);
  }
}

export type CepStatus = "idle" | "buscando" | "nao-encontrado" | "erro";

export const CEP_STATUS_TEXT: Record<CepStatus, string> = {
  idle: "",
  buscando: "Buscando o endereço...",
  "nao-encontrado": "CEP não encontrado: confira os números ou digite o endereço.",
  erro: "Não foi possível buscar o CEP agora: digite o endereço.",
};

/**
 * Looks the CEP up as it is typed: once it has 8 digits, `onFound` gets the address. Only the latest
 * CEP counts, so a slow answer for an earlier one is dropped.
 */
export function useCep(onFound: (endereco: EnderecoCep) => void) {
  const [status, setStatus] = useState<CepStatus>("idle");
  const latest = useRef("");
  async function check(value: string) {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 8) {
      latest.current = "";
      setStatus("idle");
      return;
    }
    if (digits === latest.current) return;
    latest.current = digits;
    setStatus("buscando");
    try {
      const endereco = await buscarCep(digits);
      if (latest.current !== digits) return;
      if (!endereco) return setStatus("nao-encontrado");
      setStatus("idle");
      onFound(endereco);
    } catch {
      if (latest.current === digits) setStatus("erro");
    }
  }
  return { status, check };
}

/** Puts the caret at `position` in the input once React has rendered the new value (where the number goes). */
export function focusAt(ref: RefObject<HTMLInputElement | null>, position: number) {
  requestAnimationFrame(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(position, position);
  });
}
