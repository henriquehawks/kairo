/**
 * Separa a configuração em duas partes: o que é da pessoa e o que é deste computador.
 *
 * A divisão acontece só na hora de guardar. Em memória a configuração continua sendo
 * um objeto só, então nenhuma tela precisa saber que isso existe.
 *
 * Campos desta lista não devem viajar entre máquinas: apps fixados apontam para
 * caminhos que só existem aqui, nomes de monitor mudam, e iniciar com o sistema é
 * um registro feito no próprio sistema operacional.
 */
export const NOME_DA_MAQUINA = "maquina";

export const CAMPOS_DA_MAQUINA = [
  "iniciarComWindows",
  "claudeInstalado",
  "primeiraExecucaoFeita",
  "ultimaSaudacao",
  "dock.fixados",
  "dock.monitores",
  "ilha.monitor",
  "assistive.apps",
] as const;

type Objeto = Record<string, unknown>;

const ehObjeto = (v: unknown): v is Objeto => typeof v === "object" && v !== null && !Array.isArray(v);
const PERIGOSAS = ["__proto__", "constructor", "prototype"];

function ler(fonte: Objeto, caminho: string[]): { achou: boolean; valor?: unknown } {
  let atual: unknown = fonte;
  for (const parte of caminho) {
    if (!ehObjeto(atual) || !Object.hasOwn(atual, parte)) return { achou: false };
    atual = atual[parte];
  }
  return { achou: true, valor: atual };
}

function escrever(destino: Objeto, caminho: string[], valor: unknown) {
  let atual = destino;
  for (const parte of caminho.slice(0, -1)) {
    const proximo = atual[parte];
    if (!ehObjeto(proximo)) atual[parte] = {};
    atual = atual[parte] as Objeto;
  }
  atual[caminho[caminho.length - 1]] = valor;
}

function remover(destino: Objeto, caminho: string[]) {
  const pai = caminho.length === 1 ? destino : ler(destino, caminho.slice(0, -1)).valor;
  if (ehObjeto(pai)) delete pai[caminho[caminho.length - 1]];
}

/** Cópia rasa por nível, só o suficiente para não alterar o objeto que veio do estado. */
function clonar<T>(valor: T): T {
  if (Array.isArray(valor)) return valor as T;
  if (!ehObjeto(valor)) return valor;
  return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, ehObjeto(v) ? clonar(v) : v])) as T;
}

const caminhos = () => CAMPOS_DA_MAQUINA.map((campo) => campo.split(".")).filter((c) => c.every((p) => !PERIGOSAS.includes(p)));

export function dividir(estado: Objeto): { conta: Objeto; maquina: Objeto } {
  const conta = clonar(estado);
  const maquina: Objeto = {};
  for (const caminho of caminhos()) {
    const { achou, valor } = ler(conta, caminho);
    if (!achou) continue;
    escrever(maquina, caminho, valor);
    remover(conta, caminho);
  }
  return { conta, maquina };
}

/**
 * Junta de volta. Sem a parte da máquina — o caso de quem acabou de atualizar o app —
 * devolve a conta como está, porque os valores antigos ainda moram lá dentro. É assim
 * que a separação acontece sozinha, sem migração e sem perder nada.
 */
export function juntar(conta: Objeto, maquina: Objeto | null): Objeto {
  if (!ehObjeto(maquina)) return conta;
  const junto = clonar(conta);
  for (const caminho of caminhos()) {
    const { achou, valor } = ler(maquina, caminho);
    if (achou) escrever(junto, caminho, valor);
  }
  return junto;
}
