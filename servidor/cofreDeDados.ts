import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Cofre de ponta a ponta dos dados da conta.
 *
 * O servidor guarda só o que está aqui dentro em forma cifrada: ele nunca recebe a
 * senha usada para abrir o cofre nem a chave mestra. Duas regras explicam o desenho:
 *
 * 1. Os dados são cifrados por uma chave mestra sorteada, não pela senha. Trocar a
 *    senha re-embrulha a chave mestra e pronto, sem re-cifrar dado nenhum.
 * 2. A mesma chave mestra é guardada duas vezes: embrulhada pela senha e embrulhada
 *    por um código de recuperação. Sem as duas, não há como voltar — é o preço de o
 *    servidor não conseguir ler nada.
 */

/** Custo do scrypt. Fica guardado em cada cofre para poder subir sem quebrar os antigos. */
export const CUSTO_PADRAO = 16;
const BLOCO = 8;
const PARALELO = 1;
const TAMANHO_DA_CHAVE = 32;
const TAMANHO_DO_SAL = 16;
const TAMANHO_DO_NONCE = 12;
const TAMANHO_DA_ETIQUETA = 16;
const VERSAO_DO_PACOTE = 1;
/** Sem I, L, O e U: o código é lido e digitado por gente. */
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GRUPOS_DO_CODIGO = 5;
const LETRAS_POR_GRUPO = 5;

export interface Cofre {
  custo: number;
  salDaSenha: string;
  salDaRecuperacao: string;
  chavePelaSenha: string;
  chavePelaRecuperacao: string;
}

export class ErroDoCofre extends Error {}

function derivar(segredo: string, sal: Buffer, custo: number): Promise<Buffer> {
  const N = 2 ** custo;
  return new Promise((aceitar, recusar) => {
    scrypt(segredo.normalize("NFKC"), sal, TAMANHO_DA_CHAVE, { N, r: BLOCO, p: PARALELO, maxmem: N * BLOCO * 256 }, (erro, chave) => {
      if (erro) recusar(new ErroDoCofre("derivacao_falhou"));
      else aceitar(chave);
    });
  });
}

/**
 * A senha digitada nunca viaja. O servidor de contas recebe este valor derivado, e a
 * derivação do cofre usa um caminho separado — assim quem guarda a senha de login não
 * fica com o material que abre os dados.
 */
export function senhaDeAutenticacao(senha: string, email: string): string {
  const sal = Buffer.from(`kairo:autenticacao:${email.trim().toLowerCase()}`);
  return Buffer.from(hkdfSync("sha256", Buffer.from(senha.normalize("NFKC")), sal, Buffer.from("autenticacao"), 32)).toString("base64");
}

function segredoDoCofre(senha: string): string {
  return Buffer.from(hkdfSync("sha256", Buffer.from(senha.normalize("NFKC")), Buffer.from("kairo:cofre"), Buffer.from("cofre"), 32)).toString("base64");
}

function embrulhar(chaveMestra: Buffer, chaveDeEmbrulho: Buffer): string {
  return cifrarBytes(chaveDeEmbrulho, chaveMestra);
}

function desembrulhar(pacote: string, chaveDeEmbrulho: Buffer): Buffer {
  return decifrarBytes(chaveDeEmbrulho, pacote);
}

function cifrarBytes(chave: Buffer, conteudo: Buffer): string {
  const nonce = randomBytes(TAMANHO_DO_NONCE);
  const cifra = createCipheriv("aes-256-gcm", chave, nonce);
  const corpo = Buffer.concat([cifra.update(conteudo), cifra.final()]);
  return Buffer.concat([Buffer.from([VERSAO_DO_PACOTE]), nonce, cifra.getAuthTag(), corpo]).toString("base64");
}

function decifrarBytes(chave: Buffer, pacote: string): Buffer {
  let bruto: Buffer;
  try {
    bruto = Buffer.from(pacote, "base64");
  } catch {
    throw new ErroDoCofre("pacote_invalido");
  }
  if (bruto.length < 1 + TAMANHO_DO_NONCE + TAMANHO_DA_ETIQUETA || bruto[0] !== VERSAO_DO_PACOTE) throw new ErroDoCofre("pacote_invalido");
  const nonce = bruto.subarray(1, 1 + TAMANHO_DO_NONCE);
  const etiqueta = bruto.subarray(1 + TAMANHO_DO_NONCE, 1 + TAMANHO_DO_NONCE + TAMANHO_DA_ETIQUETA);
  const corpo = bruto.subarray(1 + TAMANHO_DO_NONCE + TAMANHO_DA_ETIQUETA);
  const decifra = createDecipheriv("aes-256-gcm", chave, nonce);
  decifra.setAuthTag(etiqueta);
  try {
    return Buffer.concat([decifra.update(corpo), decifra.final()]);
  } catch {
    // Senha errada, código errado ou conteúdo adulterado chegam todos aqui.
    throw new ErroDoCofre("nao_abriu");
  }
}

export function gerarCodigoDeRecuperacao(): string {
  const grupos: string[] = [];
  for (let g = 0; g < GRUPOS_DO_CODIGO; g++) {
    let grupo = "";
    for (const byte of randomBytes(LETRAS_POR_GRUPO)) grupo += ALFABETO[byte % ALFABETO.length];
    grupos.push(grupo);
  }
  return grupos.join("-");
}

/** Aceita o código com espaços, minúsculas ou sem os hifens. */
export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export async function criarCofre(senha: string, custo = CUSTO_PADRAO): Promise<{ cofre: Cofre; chaveMestra: Buffer; codigoDeRecuperacao: string }> {
  if (senha.length < 8) throw new ErroDoCofre("senha_curta");
  const chaveMestra = randomBytes(TAMANHO_DA_CHAVE);
  const codigoDeRecuperacao = gerarCodigoDeRecuperacao();
  const salDaSenha = randomBytes(TAMANHO_DO_SAL);
  const salDaRecuperacao = randomBytes(TAMANHO_DO_SAL);
  const [porSenha, porCodigo] = await Promise.all([
    derivar(segredoDoCofre(senha), salDaSenha, custo),
    derivar(normalizarCodigo(codigoDeRecuperacao), salDaRecuperacao, custo),
  ]);
  return {
    chaveMestra,
    codigoDeRecuperacao,
    cofre: {
      custo,
      salDaSenha: salDaSenha.toString("base64"),
      salDaRecuperacao: salDaRecuperacao.toString("base64"),
      chavePelaSenha: embrulhar(chaveMestra, porSenha),
      chavePelaRecuperacao: embrulhar(chaveMestra, porCodigo),
    },
  };
}

function conferirCofre(cofre: Cofre) {
  const inteiro = Number.isInteger(cofre?.custo) && cofre.custo >= 12 && cofre.custo <= 22;
  if (!inteiro || typeof cofre.salDaSenha !== "string" || typeof cofre.salDaRecuperacao !== "string") throw new ErroDoCofre("cofre_invalido");
  if (typeof cofre.chavePelaSenha !== "string" || typeof cofre.chavePelaRecuperacao !== "string") throw new ErroDoCofre("cofre_invalido");
}

export async function abrirComSenha(cofre: Cofre, senha: string): Promise<Buffer> {
  conferirCofre(cofre);
  const chave = await derivar(segredoDoCofre(senha), Buffer.from(cofre.salDaSenha, "base64"), cofre.custo);
  return desembrulhar(cofre.chavePelaSenha, chave);
}

export async function abrirComCodigo(cofre: Cofre, codigo: string): Promise<Buffer> {
  conferirCofre(cofre);
  const chave = await derivar(normalizarCodigo(codigo), Buffer.from(cofre.salDaRecuperacao, "base64"), cofre.custo);
  return desembrulhar(cofre.chavePelaRecuperacao, chave);
}

/** Troca a senha re-embrulhando a chave mestra: nenhum dado precisa ser cifrado de novo. */
export async function trocarSenhaDoCofre(cofre: Cofre, chaveMestra: Buffer, senhaNova: string, custo = CUSTO_PADRAO): Promise<Cofre> {
  if (senhaNova.length < 8) throw new ErroDoCofre("senha_curta");
  const sal = randomBytes(TAMANHO_DO_SAL);
  const chave = await derivar(segredoDoCofre(senhaNova), sal, custo);
  return { ...cofre, custo, salDaSenha: sal.toString("base64"), chavePelaSenha: embrulhar(chaveMestra, chave) };
}

export function cifrarValor(chaveMestra: Buffer, valor: string): string {
  return cifrarBytes(chaveMestra, Buffer.from(valor, "utf8"));
}

export function decifrarValor(chaveMestra: Buffer, pacote: string): string {
  return decifrarBytes(chaveMestra, pacote).toString("utf8");
}

/** Só para conferir que duas máquinas abriram o mesmo cofre, sem expor a chave. */
export function mesmaChave(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
