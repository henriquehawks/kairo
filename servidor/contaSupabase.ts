import type { Cofre } from "./cofreDeDados.ts";

/**
 * Único lugar que conhece o formato da Supabase.
 *
 * Todo o resto da conta conversa com as funções daqui, então trocar de provedor
 * — ou corrigir um endpoint que mudou — mexe só neste arquivo. O `buscar` é
 * injetado para os testes rodarem sem encostar na rede.
 */

export interface ConfiguracaoDaConta {
  url: string;
  chavePublica: string;
}

export type Buscar = (url: string, opcoes: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

export interface Sessao {
  token: string;
  renovacao: string;
  expiraEm: number;
  usuarioId: string;
  email: string;
}

export class ErroDaConta extends Error {
  codigo: string;
  status: number;

  constructor(codigo: string, status = 0) {
    super(codigo);
    this.codigo = codigo;
    this.status = status;
  }
}

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): string => (typeof v === "string" ? v : "");

export function configuracaoValida(cfg: ConfiguracaoDaConta | null | undefined): cfg is ConfiguracaoDaConta {
  return Boolean(cfg && /^https:\/\/[a-z0-9.-]+$/i.test(cfg.url) && cfg.chavePublica.length > 20);
}

/** Traduz a falha do servidor para um código nosso, sem repassar texto de terceiro para a tela. */
function erroDaResposta(status: number, corpo: unknown): ErroDaConta {
  const mensagem = objeto(corpo) ? `${texto(corpo.error_code)} ${texto(corpo.msg)} ${texto(corpo.message)} ${texto(corpo.error_description)}`.toLowerCase() : "";
  if (status === 400 || status === 401) {
    if (mensagem.includes("already registered") || mensagem.includes("already been registered") || mensagem.includes("user_already_exists")) return new ErroDaConta("email_ja_cadastrado", status);
    if (mensagem.includes("invalid login") || mensagem.includes("invalid_credentials")) return new ErroDaConta("email_ou_senha_errados", status);
    if (mensagem.includes("email not confirmed") || mensagem.includes("email_not_confirmed")) return new ErroDaConta("email_nao_confirmado", status);
  }
  if (status === 422) return new ErroDaConta("dados_recusados", status);
  if (status === 429) return new ErroDaConta("muitas_tentativas", status);
  if (status >= 500) return new ErroDaConta("servidor_fora", status);
  return new ErroDaConta("falha_na_conta", status);
}

async function pedir(cfg: ConfiguracaoDaConta, buscar: Buscar, caminho: string, opcoes: { method: string; corpo?: unknown; token?: string; extras?: Record<string, string> }): Promise<unknown> {
  if (!configuracaoValida(cfg)) throw new ErroDaConta("conta_nao_configurada");
  const cabecalhos: Record<string, string> = {
    apikey: cfg.chavePublica,
    authorization: `Bearer ${opcoes.token ?? cfg.chavePublica}`,
    ...(opcoes.corpo === undefined ? {} : { "content-type": "application/json" }),
    ...opcoes.extras,
  };
  let resposta: Awaited<ReturnType<Buscar>>;
  try {
    resposta = await buscar(`${cfg.url}${caminho}`, { method: opcoes.method, headers: cabecalhos, ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }) });
  } catch {
    // Sem internet não é erro de conta: o app segue local e tenta de novo depois.
    throw new ErroDaConta("sem_conexao");
  }
  const corpo: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok) throw erroDaResposta(resposta.status, corpo);
  return corpo;
}

function lerSessao(corpo: unknown, agora: number): Sessao | null {
  if (!objeto(corpo) || !texto(corpo.access_token)) return null;
  const usuario = objeto(corpo.user) ? corpo.user : {};
  const segundos = typeof corpo.expires_in === "number" && Number.isFinite(corpo.expires_in) ? corpo.expires_in : 3600;
  return {
    token: texto(corpo.access_token),
    renovacao: texto(corpo.refresh_token),
    expiraEm: agora + segundos * 1000,
    usuarioId: texto(usuario.id),
    email: texto(usuario.email),
  };
}

/**
 * Cria a conta. Com confirmação de e-mail ligada no projeto, a Supabase responde
 * sem sessão — a pessoa precisa clicar no link antes de entrar.
 */
export async function cadastrar(cfg: ConfiguracaoDaConta, buscar: Buscar, email: string, senhaDerivada: string, agora = Date.now()): Promise<{ sessao: Sessao } | { precisaConfirmarEmail: true }> {
  const corpo = await pedir(cfg, buscar, "/auth/v1/signup", { method: "POST", corpo: { email, password: senhaDerivada } });
  const sessao = lerSessao(corpo, agora);
  return sessao ? { sessao } : { precisaConfirmarEmail: true };
}

export async function entrar(cfg: ConfiguracaoDaConta, buscar: Buscar, email: string, senhaDerivada: string, agora = Date.now()): Promise<Sessao> {
  const corpo = await pedir(cfg, buscar, "/auth/v1/token?grant_type=password", { method: "POST", corpo: { email, password: senhaDerivada } });
  const sessao = lerSessao(corpo, agora);
  if (!sessao) throw new ErroDaConta("resposta_sem_sessao");
  return sessao;
}

export async function renovar(cfg: ConfiguracaoDaConta, buscar: Buscar, renovacao: string, agora = Date.now()): Promise<Sessao> {
  const corpo = await pedir(cfg, buscar, "/auth/v1/token?grant_type=refresh_token", { method: "POST", corpo: { refresh_token: renovacao } });
  const sessao = lerSessao(corpo, agora);
  if (!sessao) throw new ErroDaConta("resposta_sem_sessao");
  return sessao;
}

export async function sair(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao): Promise<void> {
  await pedir(cfg, buscar, "/auth/v1/logout", { method: "POST", token: sessao.token, corpo: {} }).catch(() => undefined);
}

const CAMPOS_DO_COFRE = "custo,sal_da_senha,sal_da_recuperacao,chave_pela_senha,chave_pela_recuperacao";

export async function lerCofre(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao): Promise<Cofre | null> {
  const corpo = await pedir(cfg, buscar, `/rest/v1/cofre?select=${CAMPOS_DO_COFRE}&usuario_id=eq.${encodeURIComponent(sessao.usuarioId)}`, { method: "GET", token: sessao.token });
  const linha = Array.isArray(corpo) ? corpo[0] : null;
  if (!objeto(linha)) return null;
  const cofre: Cofre = {
    custo: typeof linha.custo === "number" ? linha.custo : 0,
    salDaSenha: texto(linha.sal_da_senha),
    salDaRecuperacao: texto(linha.sal_da_recuperacao),
    chavePelaSenha: texto(linha.chave_pela_senha),
    chavePelaRecuperacao: texto(linha.chave_pela_recuperacao),
  };
  if (!cofre.salDaSenha || !cofre.chavePelaSenha) throw new ErroDaConta("cofre_incompleto");
  return cofre;
}

export async function gravarCofre(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao, cofre: Cofre): Promise<void> {
  await pedir(cfg, buscar, "/rest/v1/cofre", {
    method: "POST",
    token: sessao.token,
    extras: { prefer: "resolution=merge-duplicates,return=minimal" },
    corpo: {
      usuario_id: sessao.usuarioId,
      custo: cofre.custo,
      sal_da_senha: cofre.salDaSenha,
      sal_da_recuperacao: cofre.salDaRecuperacao,
      chave_pela_senha: cofre.chavePelaSenha,
      chave_pela_recuperacao: cofre.chavePelaRecuperacao,
    },
  });
}

/** Pede o e-mail de redefinição. Devolve o login, não os dados: o cofre só abre com o código. */
export interface MarcaRemotaDoServidor {
  chave: string;
  atualizado: number;
  versao: number;
}

/** Só os carimbos, sem os valores: é o que decide o que precisa descer. */
export async function lerIndice(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao): Promise<MarcaRemotaDoServidor[]> {
  const corpo = await pedir(cfg, buscar, `/rest/v1/dados?select=chave,atualizado,versao&usuario_id=eq.${encodeURIComponent(sessao.usuarioId)}`, { method: "GET", token: sessao.token });
  if (!Array.isArray(corpo)) throw new ErroDaConta("indice_invalido");
  return corpo.flatMap((linha) => {
    if (!objeto(linha) || typeof linha.chave !== "string" || typeof linha.atualizado !== "number" || typeof linha.versao !== "number") return [];
    return [{ chave: linha.chave, atualizado: linha.atualizado, versao: linha.versao }];
  });
}

/** Valores ainda cifrados: quem abre é o cofre, depois, na máquina. */
export async function lerValores(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao, chaves: string[]): Promise<Record<string, string>> {
  if (chaves.length === 0) return {};
  const lista = chaves.map((c) => `"${encodeURIComponent(c)}"`).join(",");
  const corpo = await pedir(cfg, buscar, `/rest/v1/dados?select=chave,valor&usuario_id=eq.${encodeURIComponent(sessao.usuarioId)}&chave=in.(${lista})`, { method: "GET", token: sessao.token });
  if (!Array.isArray(corpo)) throw new ErroDaConta("valores_invalidos");
  const saida: Record<string, string> = {};
  for (const linha of corpo) if (objeto(linha) && typeof linha.chave === "string" && typeof linha.valor === "string") saida[linha.chave] = linha.valor;
  return saida;
}

export async function gravarValores(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao, itens: { chave: string; valor: string; atualizado: number }[]): Promise<void> {
  if (itens.length === 0) return;
  await pedir(cfg, buscar, "/rest/v1/dados", {
    method: "POST",
    token: sessao.token,
    extras: { prefer: "resolution=merge-duplicates,return=minimal" },
    corpo: itens.map((i) => ({ usuario_id: sessao.usuarioId, chave: i.chave, valor: i.valor, atualizado: i.atualizado })),
  });
}

export async function pedirRedefinicaoDeSenha(cfg: ConfiguracaoDaConta, buscar: Buscar, email: string): Promise<void> {
  await pedir(cfg, buscar, "/auth/v1/recover", { method: "POST", corpo: { email } });
}

export interface PessoaDoKairo {
  usuario_id: string;
  email: string;
  criado: string;
  ultimo_acesso: string | null;
  confirmado: boolean;
  areas: number;
  bytes: number;
  ultima_sincronia: string | null;
}

export interface ResumoDoKairo {
  pessoas: number;
  com_dados: number;
  ativos_7d: number;
  bytes: number;
}

/**
 * Chama uma função do banco. Quem confere se o chamador é administrador é a
 * própria função, no Postgres — o app manda só o token da pessoa.
 */
async function rpc(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao, nome: string): Promise<unknown> {
  return pedir(cfg, buscar, `/rest/v1/rpc/${nome}`, { method: "POST", token: sessao.token, corpo: {} });
}

export async function lerResumo(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao): Promise<ResumoDoKairo | null> {
  const corpo = await rpc(cfg, buscar, sessao, "resumo_do_kairo");
  const linha = Array.isArray(corpo) ? corpo[0] : corpo;
  return objeto(linha) ? (linha as unknown as ResumoDoKairo) : null;
}

export async function lerPessoas(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao): Promise<PessoaDoKairo[]> {
  const corpo = await rpc(cfg, buscar, sessao, "pessoas_do_kairo");
  return Array.isArray(corpo) ? (corpo.filter(objeto) as unknown as PessoaDoKairo[]) : [];
}

/**
 * Chama a Edge Function, que roda no servidor da Supabase e guarda a chave
 * secreta lá. Ela confere o e-mail do token antes de qualquer coisa.
 */
export async function administrar(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao, corpo: Record<string, unknown>): Promise<unknown> {
  return pedir(cfg, buscar, "/functions/v1/administrar", { method: "POST", token: sessao.token, corpo });
}

export async function lerConvidados(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao): Promise<string[]> {
  const corpo = await pedir(cfg, buscar, "/rest/v1/convidados?select=email&order=convidado.desc", { method: "GET", token: sessao.token });
  return Array.isArray(corpo) ? corpo.flatMap((l) => (objeto(l) && typeof l.email === "string" ? [l.email] : [])) : [];
}

export async function gravarConvidado(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao, email: string): Promise<void> {
  await pedir(cfg, buscar, "/rest/v1/convidados", {
    method: "POST",
    token: sessao.token,
    extras: { prefer: "resolution=merge-duplicates,return=minimal" },
    corpo: { email },
  });
}

export async function apagarConvidado(cfg: ConfiguracaoDaConta, buscar: Buscar, sessao: Sessao, email: string): Promise<void> {
  await pedir(cfg, buscar, `/rest/v1/convidados?email=eq.${encodeURIComponent(email)}`, { method: "DELETE", token: sessao.token });
}
