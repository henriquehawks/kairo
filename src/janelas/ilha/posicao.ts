/** Posição da ilha na tela, guardada como fração 0..1 para sobreviver a troca de resolução. */
export interface PosicaoIlha {
  x: number;
  y: number;
}

export interface TelaDaIlha {
  largura: number;
  altura: number;
}

/** Tamanho já escalado da ilha: `altura` é a do estado atual, `repouso` a da ilha fechada. */
export interface TamanhoDaIlha {
  largura: number;
  altura: number;
  repouso: number;
}

export interface AncoraDaIlha {
  /** Centro horizontal da ilha, em px da janela. */
  centro: number;
  /** Topo da ilha, em px da janela. */
  topo: number;
  /** Distância entre o rodapé da tela e o rodapé da ilha, em px. */
  rodape: number;
  /** A ilha cresceu para cima porque não cabia para baixo. */
  acima: boolean;
  /** A ilha continua encostada na borda de cima, com as orelhas do entalhe. */
  colada: boolean;
}

export const POSICAO_PADRAO: PosicaoIlha = { x: 0.5, y: 0 };
/** Folga mínima entre a ilha solta e as bordas da tela. */
export const MARGEM = 8;
/** Até esta distância do topo a ilha ainda é tratada como entalhe colado na borda. */
export const COLADA_ATE = 12;
/** Quanto o ponteiro precisa andar para o gesto virar arrasto em vez de clique. */
export const LIMIAR_DO_ARRASTO = 5;

const limitar = (n: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(n) ? n : min, min), Math.max(min, max));

const fracao = (valor: unknown, padrao: number) => (typeof valor === "number" && Number.isFinite(valor) ? limitar(valor, 0, 1) : padrao);

export function posicaoValida(entrada: unknown): PosicaoIlha {
  const p = (entrada && typeof entrada === "object" ? entrada : {}) as Partial<PosicaoIlha>;
  return { x: fracao(p.x, POSICAO_PADRAO.x), y: fracao(p.y, POSICAO_PADRAO.y) };
}

export function noTopo(posicao: PosicaoIlha): boolean {
  return posicao.y === POSICAO_PADRAO.y && posicao.x === POSICAO_PADRAO.x;
}

/**
 * Traduz a fração guardada para px, mantendo a ilha dentro da tela e decidindo
 * se ela abre para baixo (o normal) ou para cima (quando está na parte de baixo).
 */
export function ancoraDaIlha(posicao: PosicaoIlha, tela: TelaDaIlha, ilha: TamanhoDaIlha): AncoraDaIlha {
  const p = posicaoValida(posicao);
  const meia = ilha.largura / 2;
  const centro = limitar(p.x * tela.largura, meia + MARGEM, tela.largura - meia - MARGEM);
  const colada = p.y * tela.altura <= COLADA_ATE;
  const topoFechada = colada ? 0 : limitar(p.y * tela.altura, MARGEM, tela.altura - ilha.repouso - MARGEM);
  const cabeAbaixo = topoFechada + ilha.altura + MARGEM <= tela.altura;
  const acima = !colada && !cabeAbaixo && topoFechada + ilha.repouso - ilha.altura >= MARGEM;
  const topo = limitar(acima ? topoFechada + ilha.repouso - ilha.altura : topoFechada, colada ? 0 : MARGEM, tela.altura - ilha.altura - MARGEM);
  return { centro, topo, rodape: tela.altura - topo - ilha.altura, acima, colada };
}

/** Caminho inverso: a posição em px que o arrasto deixou volta a ser fração. */
export function posicaoDoArrasto(centro: number, topo: number, tela: TelaDaIlha): PosicaoIlha {
  if (tela.largura <= 0 || tela.altura <= 0) return POSICAO_PADRAO;
  return { x: limitar(centro / tela.largura, 0, 1), y: limitar(topo <= COLADA_ATE ? 0 : topo / tela.altura, 0, 1) };
}
