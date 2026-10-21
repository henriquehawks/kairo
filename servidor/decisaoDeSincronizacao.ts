/**
 * Decide o que sobe, o que desce e o que está em conflito.
 *
 * Nenhuma linha daqui toca rede, banco ou criptografia — é só aritmética sobre
 * carimbos de tempo. Foi separada de propósito: é aqui que mora a chance de
 * alguém perder dados, e o jeito de não perder é poder testar cada caso.
 *
 * Cada chave guarda o JSON inteiro de uma área, então "o mais recente vence"
 * resolve por área, não por registro. Para quem troca de computador e usa um de
 * cada vez — o caso que esta função existe para servir — isso basta. Quando os
 * dois lados mexeram na mesma área, não há merge barato possível: a decisão vira
 * conflito, o perdedor vai para um backup e a pessoa é avisada.
 */

export interface MarcaRemota {
  atualizado: number;
  versao: number;
}

/** O que foi visto na última sincronização, para saber quem mexeu desde então. */
export interface MarcaVista {
  atualizado: number;
  versao: number;
}

export interface Plano {
  puxar: string[];
  enviar: string[];
  /** Mexeram dos dois lados. Resolvido pelo mais recente, mas com aviso e backup. */
  conflitos: string[];
}

export type PrimeiroEncontro = "subir" | "baixar" | "perguntar" | "nada";

const chavesDeTudo = (...fontes: Record<string, unknown>[]) => [...new Set(fontes.flatMap((f) => Object.keys(f)))].sort();

/**
 * O primeiro encontro entre uma máquina e uma conta.
 *
 * É o momento perigoso: a pessoa já usa o Kairo há meses e acabou de criar conta.
 * Sincronizar sem pensar faz o vazio do servidor ganhar de tudo que ela tem.
 */
export function primeiroEncontro(local: Record<string, number>, remoto: Record<string, MarcaRemota>): PrimeiroEncontro {
  const temLocal = Object.keys(local).length > 0;
  const temRemoto = Object.keys(remoto).length > 0;
  if (temLocal && !temRemoto) return "subir";
  if (!temLocal && temRemoto) return "baixar";
  if (!temLocal && !temRemoto) return "nada";
  // Os dois lados têm dados: ninguém além da pessoa pode escolher qual vale.
  return "perguntar";
}

export function decidirSincronizacao(
  local: Record<string, number>,
  remoto: Record<string, MarcaRemota>,
  vistas: Record<string, MarcaVista>,
): Plano {
  const plano: Plano = { puxar: [], enviar: [], conflitos: [] };

  for (const chave of chavesDeTudo(local, remoto)) {
    const aqui = local[chave];
    const la = remoto[chave];
    const visto = vistas[chave];

    if (aqui === undefined) {
      plano.puxar.push(chave);
      continue;
    }
    if (la === undefined) {
      plano.enviar.push(chave);
      continue;
    }

    // Sem registro da última visita, o carimbo é tudo que temos.
    const mexeuAqui = visto ? aqui !== visto.atualizado : true;
    const mexeuLa = visto ? la.versao !== visto.versao : true;

    if (mexeuAqui && mexeuLa) {
      if (aqui === la.atualizado) continue;
      plano.conflitos.push(chave);
      (aqui > la.atualizado ? plano.enviar : plano.puxar).push(chave);
      continue;
    }
    if (mexeuAqui) plano.enviar.push(chave);
    else if (mexeuLa) plano.puxar.push(chave);
  }

  return plano;
}

/** Como ficam as marcas depois de uma sincronização bem-sucedida. */
export function marcasDepois(
  local: Record<string, number>,
  remoto: Record<string, MarcaRemota>,
  vistas: Record<string, MarcaVista>,
): Record<string, MarcaVista> {
  const novas: Record<string, MarcaVista> = {};
  for (const chave of chavesDeTudo(local, remoto, vistas)) {
    const aqui = local[chave];
    const la = remoto[chave];
    if (aqui === undefined || la === undefined) continue;
    novas[chave] = { atualizado: aqui, versao: la.versao };
  }
  return novas;
}
