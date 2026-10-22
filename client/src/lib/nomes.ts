const normalize = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * True when the client picked in the form is not the person named in the document (e.g. the contract
 * read belongs to someone else): attaching would put the document in the wrong client's record.
 */
export function clienteDiferente(clienteEscolhido: string | undefined, nomeNoDocumento: string) {
  if (!clienteEscolhido || !nomeNoDocumento.trim()) return false;
  return normalize(clienteEscolhido) !== normalize(nomeNoDocumento);
}
