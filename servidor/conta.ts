import { CONTA } from "./configuracaoDaConta.ts";
import * as servidorDaConta from "./contaSupabase.ts";
import { abrirComCodigo, abrirComSenha, criarCofre, senhaDeAutenticacao, trocarSenhaDoCofre, type Cofre } from "./cofreDeDados.ts";
import { apagarSegredo, gravarSegredo, lerSegredo } from "./segredos.ts";

/**
 * Cadastro, entrada e saída da conta.
 *
 * Junta três peças que não se conhecem: o cofre de ponta a ponta (`cofreDeDados`),
 * o servidor (`contaSupabase`) e o cofre do sistema operacional (`segredos`), onde
 * ficam a sessão e a chave mestra — nunca no banco local, que é um arquivo comum.
 *
 * Tudo que o servidor recebe já sai cifrado daqui, e a senha digitada nunca viaja:
 * o login leva um valor derivado, e a chave do cofre vem de uma derivação separada.
 */

const ID_DA_SESSAO = "conta-sessao";
const ID_DA_CHAVE = "conta-chave";
/** Renova um pouco antes de vencer, para não falhar no meio de uma sincronização. */
const FOLGA_DA_RENOVACAO_MS = 60_000;

export interface Dependencias {
  cfg: servidorDaConta.ConfiguracaoDaConta;
  buscar: servidorDaConta.Buscar;
  guardar: (id: string, valor: string) => Promise<void>;
  ler: (id: string) => Promise<string | null>;
  apagar: (id: string) => Promise<void>;
  agora: () => number;
}

export function dependenciasPadrao(): Dependencias {
  return {
    cfg: CONTA,
    buscar: (url, opcoes) => fetch(url, opcoes) as unknown as ReturnType<servidorDaConta.Buscar>,
    guardar: gravarSegredo,
    ler: lerSegredo,
    apagar: apagarSegredo,
    agora: () => Date.now(),
  };
}

export type ResultadoDeEntrada =
  | { situacao: "entrou"; email: string; codigoDeRecuperacao?: string }
  | { situacao: "confirmar_email"; email: string }
  /** Entrou no servidor, mas a senha não abre o cofre: aconteceu uma redefinição de senha. */
  | { situacao: "cofre_travado"; email: string };

const emailValido = (email: string) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email.trim()) && email.length <= 320;

async function guardarEntrada(deps: Dependencias, sessao: servidorDaConta.Sessao, chaveMestra: Buffer) {
  await deps.guardar(ID_DA_SESSAO, JSON.stringify(sessao));
  await deps.guardar(ID_DA_CHAVE, chaveMestra.toString("base64"));
}

export async function lerSessaoGuardada(deps: Dependencias): Promise<servidorDaConta.Sessao | null> {
  const bruto = await deps.ler(ID_DA_SESSAO).catch(() => null);
  if (!bruto) return null;
  try {
    const salvo: unknown = JSON.parse(bruto);
    if (typeof salvo !== "object" || salvo === null) return null;
    const s = salvo as servidorDaConta.Sessao;
    return typeof s.token === "string" && typeof s.usuarioId === "string" && s.token ? s : null;
  } catch {
    return null;
  }
}

export async function lerChaveGuardada(deps: Dependencias): Promise<Buffer | null> {
  const bruto = await deps.ler(ID_DA_CHAVE).catch(() => null);
  if (!bruto) return null;
  const chave = Buffer.from(bruto, "base64");
  return chave.length === 32 ? chave : null;
}

/** Sessão válida, renovando quando está perto de vencer. Null quando não há conta conectada. */
export async function sessaoValida(deps: Dependencias): Promise<servidorDaConta.Sessao | null> {
  const guardada = await lerSessaoGuardada(deps);
  if (!guardada) return null;
  if (guardada.expiraEm - FOLGA_DA_RENOVACAO_MS > deps.agora()) return guardada;
  if (!guardada.renovacao) return null;
  try {
    const nova = await servidorDaConta.renovar(deps.cfg, deps.buscar, guardada.renovacao, deps.agora());
    await deps.guardar(ID_DA_SESSAO, JSON.stringify(nova));
    return nova;
  } catch (erro) {
    // Sem internet a sessão guardada ainda serve; recusada de vez, é hora de sair.
    if (erro instanceof servidorDaConta.ErroDaConta && erro.codigo === "sem_conexao") return guardada;
    await esquecer(deps);
    return null;
  }
}

/**
 * Cria o cofre desta conta e devolve o código de recuperação — a única vez que ele
 * existe em texto. Sem ele e sem a senha, não há como voltar aos dados.
 */
async function nascerCofre(deps: Dependencias, sessao: servidorDaConta.Sessao, senha: string): Promise<{ chaveMestra: Buffer; codigoDeRecuperacao: string }> {
  const { cofre, chaveMestra, codigoDeRecuperacao } = await criarCofre(senha);
  await servidorDaConta.gravarCofre(deps.cfg, deps.buscar, sessao, cofre);
  return { chaveMestra, codigoDeRecuperacao };
}

export async function cadastrar(email: string, senha: string, deps = dependenciasPadrao()): Promise<ResultadoDeEntrada> {
  if (!emailValido(email)) throw new servidorDaConta.ErroDaConta("email_invalido");
  if (senha.length < 8) throw new servidorDaConta.ErroDaConta("senha_curta");
  const limpo = email.trim().toLowerCase();
  const resposta = await servidorDaConta.cadastrar(deps.cfg, deps.buscar, limpo, senhaDeAutenticacao(senha, limpo), deps.agora());

  // Com confirmação de e-mail ligada não vem sessão: o cofre nasce no primeiro login.
  if (!("sessao" in resposta)) return { situacao: "confirmar_email", email: limpo };

  const { chaveMestra, codigoDeRecuperacao } = await nascerCofre(deps, resposta.sessao, senha);
  await guardarEntrada(deps, resposta.sessao, chaveMestra);
  return { situacao: "entrou", email: limpo, codigoDeRecuperacao };
}

export async function entrar(email: string, senha: string, deps = dependenciasPadrao()): Promise<ResultadoDeEntrada> {
  if (!emailValido(email)) throw new servidorDaConta.ErroDaConta("email_invalido");
  const limpo = email.trim().toLowerCase();
  const sessao = await servidorDaConta.entrar(deps.cfg, deps.buscar, limpo, senhaDeAutenticacao(senha, limpo), deps.agora());
  const cofre = await servidorDaConta.lerCofre(deps.cfg, deps.buscar, sessao);

  // Primeiro login de quem confirmou o e-mail: a conta existe, o cofre ainda não.
  if (!cofre) {
    const { chaveMestra, codigoDeRecuperacao } = await nascerCofre(deps, sessao, senha);
    await guardarEntrada(deps, sessao, chaveMestra);
    return { situacao: "entrou", email: limpo, codigoDeRecuperacao };
  }

  try {
    const chaveMestra = await abrirComSenha(cofre, senha);
    await guardarEntrada(deps, sessao, chaveMestra);
    return { situacao: "entrou", email: limpo };
  } catch {
    // Entrou no servidor mas o cofre não abriu: a senha de login foi redefinida por
    // e-mail e a dos dados continua sendo a antiga. Só o código de recuperação resolve.
    await deps.guardar(ID_DA_SESSAO, JSON.stringify(sessao));
    await deps.apagar(ID_DA_CHAVE).catch(() => undefined);
    return { situacao: "cofre_travado", email: limpo };
  }
}

/**
 * Destrava o cofre com o código de recuperação e o reembrulha na senha de agora,
 * para as próximas entradas voltarem a funcionar só com a senha.
 */
export async function destravarComCodigo(codigo: string, senhaAtual: string, deps = dependenciasPadrao()): Promise<void> {
  const sessao = await sessaoValida(deps);
  if (!sessao) throw new servidorDaConta.ErroDaConta("sem_sessao");
  const cofre = await servidorDaConta.lerCofre(deps.cfg, deps.buscar, sessao);
  if (!cofre) throw new servidorDaConta.ErroDaConta("sem_cofre");
  const chaveMestra = await abrirComCodigo(cofre, codigo);
  const reembrulhado: Cofre = await trocarSenhaDoCofre(cofre, chaveMestra, senhaAtual);
  await servidorDaConta.gravarCofre(deps.cfg, deps.buscar, sessao, reembrulhado);
  await guardarEntrada(deps, sessao, chaveMestra);
}

export async function pedirRedefinicaoDeSenha(email: string, deps = dependenciasPadrao()): Promise<void> {
  if (!emailValido(email)) throw new servidorDaConta.ErroDaConta("email_invalido");
  await servidorDaConta.pedirRedefinicaoDeSenha(deps.cfg, deps.buscar, email.trim().toLowerCase());
}

/** Limpa o que está guardado nesta máquina. Não apaga dado local nenhum. */
async function esquecer(deps: Dependencias) {
  await deps.apagar(ID_DA_SESSAO).catch(() => undefined);
  await deps.apagar(ID_DA_CHAVE).catch(() => undefined);
}

export async function sair(deps = dependenciasPadrao()): Promise<void> {
  const sessao = await lerSessaoGuardada(deps);
  if (sessao) await servidorDaConta.sair(deps.cfg, deps.buscar, sessao);
  await esquecer(deps);
}

export async function estadoDaConta(deps = dependenciasPadrao()): Promise<{ conectado: boolean; email: string; cofreAberto: boolean; configurada: boolean; admin: boolean }> {
  const sessao = await lerSessaoGuardada(deps);
  const chave = await lerChaveGuardada(deps);
  return {
    conectado: Boolean(sessao),
    email: sessao?.email ?? "",
    cofreAberto: Boolean(sessao && chave),
    configurada: servidorDaConta.configuracaoValida(deps.cfg),
    // Só para a interface decidir se mostra a tela. A permissão real é do banco.
    admin: Boolean(sessao && ehAdministrador(sessao.email)),
  };
}

/**
 * Administração.
 *
 * O e-mail abaixo serve só para a interface saber se mostra a tela. Quem decide
 * de verdade é o banco, nas funções `e_admin()` e na Edge Function — o app roda
 * na máquina das pessoas e qualquer verificação feita aqui pode ser editada.
 */
export const EMAIL_DO_ADMIN = "henrique.coruja@grupolana.com.br";

export function ehAdministrador(email: string): boolean {
  return email.trim().toLowerCase() === EMAIL_DO_ADMIN;
}

async function comSessao(deps: Dependencias): Promise<servidorDaConta.Sessao> {
  const sessao = await sessaoValida(deps);
  if (!sessao) throw new servidorDaConta.ErroDaConta("sem_sessao");
  return sessao;
}

export async function painelDoAdmin(deps = dependenciasPadrao()): Promise<{ resumo: servidorDaConta.ResumoDoKairo | null; pessoas: servidorDaConta.PessoaDoKairo[] }> {
  const sessao = await comSessao(deps);
  const [resumo, pessoas] = await Promise.all([
    servidorDaConta.lerResumo(deps.cfg, deps.buscar, sessao),
    servidorDaConta.lerPessoas(deps.cfg, deps.buscar, sessao),
  ]);
  return { resumo, pessoas };
}

export async function apagarUsuario(usuarioId: string, deps = dependenciasPadrao()): Promise<void> {
  const sessao = await comSessao(deps);
  await servidorDaConta.administrar(deps.cfg, deps.buscar, sessao, { acao: "apagar", usuarioId });
}

/**
 * Troca a senha de login de alguém. Não reabre o cofre dessa pessoa: os dados
 * dela continuam embrulhados na senha antiga, e só o código de recuperação
 * destranca. Serve para devolver o acesso à conta, não aos dados.
 */
export async function trocarSenhaDe(usuarioId: string, senha: string, deps = dependenciasPadrao()): Promise<void> {
  if (senha.length < 8) throw new servidorDaConta.ErroDaConta("senha_curta");
  const sessao = await comSessao(deps);
  await servidorDaConta.administrar(deps.cfg, deps.buscar, sessao, { acao: "senha", usuarioId, senha });
}

export async function convidar(email: string, deps = dependenciasPadrao()): Promise<void> {
  if (!emailValido(email)) throw new servidorDaConta.ErroDaConta("email_invalido");
  const sessao = await comSessao(deps);
  await servidorDaConta.gravarConvidado(deps.cfg, deps.buscar, sessao, email.trim().toLowerCase());
}

export async function desconvidar(email: string, deps = dependenciasPadrao()): Promise<void> {
  const sessao = await comSessao(deps);
  await servidorDaConta.apagarConvidado(deps.cfg, deps.buscar, sessao, email.trim().toLowerCase());
}

export async function lerConvidados(deps = dependenciasPadrao()): Promise<string[]> {
  const sessao = await comSessao(deps);
  return servidorDaConta.lerConvidados(deps.cfg, deps.buscar, sessao);
}
