import { backupManual, gravar, gravarMeta, lerDatas, lerMeta, lerTudo } from "./banco.ts";
import { cifrarValor, decifrarValor } from "./cofreDeDados.ts";
import * as servidorDaConta from "./contaSupabase.ts";
import { lerChaveGuardada, sessaoValida, type Dependencias } from "./conta.ts";
import { dependenciasPadrao } from "./conta.ts";
import { decidirSincronizacao, marcasDepois, primeiroEncontro, type MarcaRemota, type MarcaVista } from "./decisaoDeSincronizacao.ts";

/**
 * Leva e traz as chaves entre esta máquina e a conta.
 *
 * Três cuidados moram aqui, e são eles que separam sincronizar de perder dados:
 *
 * 1. Nada vindo de fora é gravado sem passar pela validação do app. O servidor é
 *    tão não confiável quanto um arquivo de backup importado.
 * 2. Antes de qualquer gravação vinda de fora, uma cópia do banco é feita.
 * 3. O primeiro encontro entre uma máquina com dados e uma conta com dados não é
 *    decidido aqui: vira uma pergunta para a pessoa.
 */

const CHAVE_DAS_MARCAS = "sincronizacao:marcas";
const CHAVE_DO_DONO = "sincronizacao:usuario";

export interface LadoDoConflito {
  areas: number;
  /** Carimbo da área mexida mais recentemente, ou 0 quando não há nada. */
  atualizado: number;
}

export interface Resultado {
  situacao: "sincronizou" | "perguntar" | "sem_conta" | "cofre_fechado";
  puxadas: string[];
  enviadas: string[];
  conflitos: string[];
  /** Com "perguntar": o que cada lado tem, para a pessoa poder comparar. */
  resumo?: { local: LadoDoConflito; remoto: LadoDoConflito };
  /** Caminho da pasta de backups, quando algo vindo de fora foi gravado. */
  backup?: string;
}

/**
 * Conferência do que chega de fora.
 *
 * A ponte confere a forma: JSON válido, com `state` objeto e dentro do tamanho. A
 * conferência profunda, campo a campo, continua acontecendo onde já acontecia — no
 * `merge` de cada store, que valida tudo que vem do disco porque o projeto nunca
 * confiou no próprio banco. Chave sincronizada entra pela mesma porta e passa pela
 * mesma peneira; duplicar os esquemas aqui só criaria duas verdades para manter.
 */
export type Validar = (chave: string, valor: string) => string;

const LIMITE_DO_VALOR = 20_000_000;

export function conferirForma(chave: string, valor: string): string {
  if (!/^niko:[a-z0-9_-]{1,60}$/i.test(chave)) throw new Error("chave_invalida");
  if (valor.length > LIMITE_DO_VALOR) throw new Error("valor_grande");
  // Nem toda chave guarda o envelope de um store: há marcas simples, como a data da
  // limpeza dos exemplos, que são texto puro. Exigir JSON aqui recusaria dado legítimo.
  // O que garante que isso veio da própria pessoa é a decifragem: só quem tem a chave
  // mestra consegue produzir um pacote que abre. O sentido do conteúdo continua sendo
  // conferido no merge de cada store, como já era com o disco.
  return valor;
}

function lerMarcas(banco: string, usuarioId: string): Record<string, MarcaVista> {
  // Trocou de conta nesta máquina: as marcas da anterior não valem mais.
  if (lerMeta(CHAVE_DO_DONO, banco) !== usuarioId) return {};
  try {
    const salvo: unknown = JSON.parse(lerMeta(CHAVE_DAS_MARCAS, banco) ?? "{}");
    if (typeof salvo !== "object" || salvo === null) return {};
    const marcas: Record<string, MarcaVista> = {};
    for (const [chave, valor] of Object.entries(salvo as Record<string, unknown>)) {
      if (typeof valor !== "object" || valor === null) continue;
      const m = valor as MarcaVista;
      if (Number.isFinite(m.atualizado) && Number.isFinite(m.versao)) marcas[chave] = { atualizado: m.atualizado, versao: m.versao };
    }
    return marcas;
  } catch {
    return {};
  }
}

function indiceComoMapa(linhas: servidorDaConta.MarcaRemotaDoServidor[]): Record<string, MarcaRemota> {
  const mapa: Record<string, MarcaRemota> = {};
  for (const l of linhas) mapa[l.chave] = { atualizado: l.atualizado, versao: l.versao };
  return mapa;
}

const lado = (carimbos: number[]): LadoDoConflito => ({ areas: carimbos.length, atualizado: carimbos.length ? Math.max(...carimbos) : 0 });

const semMudanca = (situacao: Resultado["situacao"]): Resultado => ({ situacao, puxadas: [], enviadas: [], conflitos: [] });

/**
 * Uma rodada de sincronização.
 *
 * `escolha` só é usada no primeiro encontro com os dois lados cheios: "subir" manda
 * o que está nesta máquina, "baixar" aceita o que está na conta.
 */
export async function sincronizar(
  opcoes: { banco?: string; escolha?: "subir" | "baixar"; deps?: Dependencias; validar?: Validar } = {},
): Promise<Resultado> {
  const banco = opcoes.banco ?? "";
  const validar = opcoes.validar ?? conferirForma;
  const deps = opcoes.deps ?? dependenciasPadrao();
  const sessao = await sessaoValida(deps);
  if (!sessao) return semMudanca("sem_conta");
  const chaveMestra = await lerChaveGuardada(deps);
  if (!chaveMestra) return semMudanca("cofre_fechado");

  const local = lerDatas(banco);
  const remoto = indiceComoMapa(await servidorDaConta.lerIndice(deps.cfg, deps.buscar, sessao));
  const marcas = lerMarcas(banco, sessao.usuarioId);

  const primeiraVez = Object.keys(marcas).length === 0;
  let plano = decidirSincronizacao(local, remoto, marcas);

  if (primeiraVez) {
    const encontro = primeiroEncontro(local, remoto);
    if (encontro === "perguntar" && !opcoes.escolha) {
      return {
        ...semMudanca("perguntar"),
        conflitos: plano.conflitos,
        resumo: { local: lado(Object.values(local)), remoto: lado(Object.values(remoto).map((m) => m.atualizado)) },
      };
    }
    if (encontro === "perguntar") {
      // A pessoa escolheu: um lado inteiro vale, e o outro vira backup.
      plano = opcoes.escolha === "subir"
        ? { puxar: [], enviar: Object.keys(local), conflitos: [] }
        : { puxar: Object.keys(remoto), enviar: [], conflitos: [] };
    }
  }

  let backup: string | undefined;
  const puxadas: string[] = [];

  if (plano.puxar.length > 0) {
    const cifrados = await servidorDaConta.lerValores(deps.cfg, deps.buscar, sessao, plano.puxar);
    const paraGravar: Record<string, string> = {};
    for (const chave of plano.puxar) {
      const pacote = cifrados[chave];
      if (!pacote) continue;
      // Decifrar e validar antes de gravar: conteúdo de fora não entra sem conferência.
      const texto = decifrarValor(chaveMestra, pacote);
      paraGravar[chave] = validar(chave, texto);
      puxadas.push(chave);
    }
    if (Object.keys(paraGravar).length > 0) {
      backup = backupManual(banco);
      gravar(paraGravar, banco);
    }
  }

  if (plano.enviar.length > 0) {
    const valores = lerTudo(banco);
    const itens = plano.enviar.flatMap((chave) => {
      const valor = valores[chave];
      return valor === undefined ? [] : [{ chave, valor: cifrarValor(chaveMestra, valor), atualizado: local[chave] ?? Date.now() }];
    });
    await servidorDaConta.gravarValores(deps.cfg, deps.buscar, sessao, itens);
  }

  // Relê os dois lados para gravar marcas que refletem o que realmente ficou.
  const depoisLocal = lerDatas(banco);
  const depoisRemoto = indiceComoMapa(await servidorDaConta.lerIndice(deps.cfg, deps.buscar, sessao));
  gravarMeta(CHAVE_DO_DONO, sessao.usuarioId, banco);
  gravarMeta(CHAVE_DAS_MARCAS, JSON.stringify(marcasDepois(depoisLocal, depoisRemoto, marcas)), banco);

  return { situacao: "sincronizou", puxadas, enviadas: plano.enviar, conflitos: plano.conflitos, ...(backup ? { backup } : {}) };
}
