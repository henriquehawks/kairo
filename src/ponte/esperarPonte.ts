/**
 * Espera a ponte local começar a responder.
 *
 * Na primeira abertura depois de instalar ou atualizar, o Windows verifica o
 * node.exe recém-gravado antes de deixá-lo rodar, e a ponte pode levar vários
 * segundos para ouvir. Numa máquina já aquecida ela sobe em menos de meio
 * segundo — por isso quem desenvolve nunca vê a falha. Desistir rápido aqui
 * transforma essa demora em erro na cara de quem acabou de instalar.
 */
export const ESPERA_MAXIMA_MS = 60_000;
/** Depois disso, avisa na tela que está iniciando, em vez de deixar a janela vazia. */
export const AVISAR_APOS_MS = 1_500;
const INTERVALO_INICIAL_MS = 250;
const INTERVALO_MAXIMO_MS = 2_000;

/** Rápido nas primeiras tentativas, mais calmo depois, para não martelar a porta. */
export function intervaloDaTentativa(tentativa: number): number {
  const passo = Math.max(0, Math.floor(tentativa / 2));
  return Math.min(INTERVALO_INICIAL_MS * 2 ** passo, INTERVALO_MAXIMO_MS);
}

export interface EsperaDaPonte {
  tentar: () => Promise<boolean>;
  aguardar: (ms: number) => Promise<void>;
  agora: () => number;
  avisar?: () => void;
  limiteMs?: number;
  avisarAposMs?: number;
}

export async function esperarPonte({ tentar, aguardar, agora, avisar, limiteMs = ESPERA_MAXIMA_MS, avisarAposMs = AVISAR_APOS_MS }: EsperaDaPonte): Promise<boolean> {
  const inicio = agora();
  let avisou = false;
  for (let tentativa = 0; ; tentativa++) {
    if (await tentar()) return true;
    const decorrido = agora() - inicio;
    const restante = limiteMs - decorrido;
    if (restante <= 0) return false;
    if (!avisou && decorrido >= avisarAposMs) {
      avisou = true;
      avisar?.();
    }
    await aguardar(Math.min(intervaloDaTentativa(tentativa), restante));
  }
}
