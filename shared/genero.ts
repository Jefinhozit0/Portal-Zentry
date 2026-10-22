/**
 * Grammatical gender of a Brazilian first name, so documents write "inscrito" or "inscrita". Names
 * are not a sure sign, so an ambiguous or unknown name gives null and the text keeps "inscrito(a)";
 * the form also lets the team set it by hand.
 */
export type Genero = "M" | "F";

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Used by men and women alike: never guessed. */
const AMBIGUOS = new Set(["darci", "darcy", "juraci", "juracy", "jaci", "jacy", "valdeci", "aldeci", "noeli", "noely", "andrea", "andreia", "ariel", "alexis", "dominique", "france", "francis", "eli", "elis", "cris", "chris", "sasha", "kim", "jean", "jacques", "joelma", "deni", "deny", "nilce", "iracy", "ivani", "ivany", "uiara"]);

/** Men's names that end in "a". */
const MASCULINOS_EM_A = new Set(["luca", "lucca", "joshua", "josua", "nikita", "mustafa", "issa", "isaa", "jona", "garrincha", "batista", "evangelista"]);

/** Women's names that do not end in "a" and no ending rule below catches. */
const FEMININOS = new Set([
  "beatriz", "raquel", "rachel", "isabel", "mabel", "maribel", "ester", "esther", "ingrid", "carmen", "ruth", "rute", "edith", "judith", "lourdes", "dolores", "mercedes",
  "ines", "liz", "thais", "tais", "lais", "isis", "iris", "doris", "gladys", "miriam", "mirian", "myriam", "nicole", "evelin", "evelyn", "jocelyn", "kathleen", "karen",
  "caren", "ellen", "helen", "hellen", "shirley", "lilian", "lillian", "marilyn", "rosemary", "nair", "rosemeire", "rosimeire", "cleonice", "sueli", "suely", "neli", "nely",
  "keli", "kelli", "kelly", "natali", "nathali", "nataly", "nathaly", "rosi", "lili", "mari", "gabi", "dani", "jaqueline", "jacqueline", "monique", "francine", "luzia",
  "noemi", "noemia", "eunice", "berenice", "clarice", "alice", "denise", "elise", "simone", "rose", "irene", "cleide", "neide", "aide", "zilda", "solange", "ivone", "yvone",
  "marlene", "darlene", "arlene", "jane", "joane", "rosane", "tatiane", "cristiane", "luciane", "eliane", "viviane", "josiane", "daiane", "dayane", "ariane", "aline",
  "caroline", "carolaine", "emanuele", "gabriele", "gabrielle", "daniele", "danielle", "michele", "michelle", "adriele", "kemilly", "emily", "emilly", "mirelly", "yasmin",
  "jasmin", "miriam", "lucimar", "rosimar", "edilene", "odete", "ivete", "elisete", "claudete", "bernadete", "marinete", "elizabeth", "elisabeth", "lisbeth", "socorro",
]);

/** Women's endings for names that do not end in "a" (Aline, Denise, Odete, Daniele, Beatriz, Kelly...). */
const TERMINACOES_FEMININAS = /(iane|yane|ane|ene|ine|ise|ice|ide|ete|ele|elle|iele|ielle|ely|elly|ily|illy|triz|eth)$/;
/** Men's names those endings would wrongly catch. */
const MASCULINOS = new Set(["jose", "henrique", "felipe", "filipe", "alexandre", "guilherme", "vicente", "jorge", "andre", "andrei", "rene", "irineu", "dirceu", "denis", "wellington", "ricardo", "rafael", "daniel", "gabriel", "samuel", "manoel", "manuel", "miguel", "joel", "abel", "noel", "emanuel", "ezequiel", "israel", "natanael", "maciel", "aurelio", "cleber", "gilberto", "eugene", "dione", "aquiles", "tome", "cosme", "jaime", "wilame", "fabrice", "ulisses", "eliseu", "anisio", "arlindo", "luiz", "luis", "diniz", "matheus", "davi", "levi", "luigi", "nei", "ney", "rei", "giovane", "geovane"]);

export function generoDoNome(nomeCompleto: string): Genero | null {
  const original = nomeCompleto.normalize("NFC").toLowerCase().trim().split(/\s+/)[0] ?? "";
  const primeiro = normalize(original);
  if (primeiro.length < 2 || AMBIGUOS.has(primeiro)) return null;
  // Kauã, Cauã: the tilde marks a man's name, though without it the name ends in "a".
  if (original.endsWith("ã")) return "M";
  if (MASCULINOS.has(primeiro) || MASCULINOS_EM_A.has(primeiro)) return "M";
  if (FEMININOS.has(primeiro)) return "F";
  if (/a$/.test(primeiro)) return "F";
  if (TERMINACOES_FEMININAS.test(primeiro)) return "F";
  // Other endings in -i/-y are split between men and women (Davi, Sueli): not guessed.
  if (/[iy]$/.test(primeiro)) return null;
  return "M";
}

/** "inscrito", "inscrita" or "inscrito(a)" when the gender is not known. */
export function flexiona(masculino: string, feminino: string, genero: Genero | null) {
  if (genero === "M") return masculino;
  if (genero === "F") return feminino;
  return `${masculino}(${feminino.slice(masculino.length - 1)})`;
}

export const GENERO_LABEL: Record<Genero, string> = { M: "Masculino", F: "Feminino" };
