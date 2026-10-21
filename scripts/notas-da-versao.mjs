import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validarVersao } from "./versao-release.mjs";

// Monta o rascunho das notas de uma versão a partir dos commits desde a última
// tag: grava docs/releases/<versao>.md e insere a mesma lista no histórico de
// src/textos/textos.ts, para os dois nascerem iguais. O texto sai cru, com o
// assunto do commit — reescreva cada linha pensando em quem usa o app.
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

const AJUDA = `Rascunho das notas: pnpm notas 0.2.8
Refazer por cima do rascunho atual: pnpm notas 0.2.8 --refazer`;

const SECOES = [
  { tipo: "novo", titulo: "Novidades", prefixos: ["feat"] },
  { tipo: "melhoria", titulo: "Melhorias", prefixos: ["perf", "refactor", "style"] },
  { tipo: "correcao", titulo: "Correções", prefixos: ["fix"] },
];

const PENDENTE = "<descreva a mudança>";

const ANTES_DE_INSTALAR = [
  "No Windows, use o instalador .exe. O .msi fica só para quem já instalou por ele. Quem já tem o Kairo recebe a atualização pelo próprio app.",
  "No Linux, use o .deb no Ubuntu, o .rpm no Fedora ou o AppImage em outras distribuições. A atualização no Linux é manual: instale o pacote novo por cima.",
  "Um aviso de aplicativo não reconhecido pelo SmartScreen não é o mesmo que uma detecção de ameaça pelo Defender. Mantenha o antivírus ativo e baixe somente das releases oficiais.",
];

function git(...argumentos) {
  return execFileSync("git", argumentos, { cwd: raiz, encoding: "utf8" }).trim();
}

function ultimaTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*");
  } catch {
    return "";
  }
}

export function separarPorTipo(assuntos) {
  const porTipo = new Map(SECOES.map((s) => [s.tipo, []]));
  for (const assunto of assuntos) {
    const separador = assunto.indexOf(":");
    if (separador < 0) continue;
    const cru = assunto.slice(0, separador).replace(/\(.*\)$/, "").trim().toLowerCase();
    const prefixo = cru.endsWith("!") ? cru.slice(0, -1) : cru;
    const secao = SECOES.find((s) => s.prefixos.includes(prefixo));
    if (!secao) continue;
    const texto = assunto.slice(separador + 1).trim();
    if (texto) porTipo.get(secao.tipo).push(texto[0].toUpperCase() + texto.slice(1) + (texto.endsWith(".") ? "" : "."));
  }
  return porTipo;
}

function hoje() {
  const agora = new Date();
  const doisDigitos = (n) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}`;
}

function montarMarkdown(versao, porTipo, fim) {
  const linhas = [`# Kairo ${versao}: <resuma a versão em uma linha>`, "", "<Um parágrafo contando o que mudou para quem usa o app.>", ""];
  for (const secao of SECOES) {
    const itens = porTipo.get(secao.tipo);
    if (!itens.length) continue;
    linhas.push(`## ${secao.titulo}`, "");
    for (const item of itens) linhas.push(`- ${item}`);
    linhas.push("");
  }
  if (SECOES.every((s) => !porTipo.get(s.tipo).length)) linhas.push("## Novidades", "", `- ${PENDENTE}`, "");
  linhas.push("## Antes de instalar", "");
  for (const item of ANTES_DE_INSTALAR) linhas.push(`- ${item}`);
  linhas.push("");
  return { texto: linhas.join(fim), vazio: SECOES.every((s) => !porTipo.get(s.tipo).length) };
}

function montarHistorico(versao, porTipo, fim) {
  const escapar = (texto) => JSON.stringify(texto).slice(1, -1);
  const linhas = ["      {", `        versao: "${versao}",`, `        data: "${hoje()}",`, "        mudancas: ["];
  for (const secao of SECOES) {
    for (const item of porTipo.get(secao.tipo)) linhas.push(`          ["${secao.tipo}", "${escapar(item)}"],`);
  }
  if (linhas.length === 4) linhas.push(`          ["novo", "${PENDENTE}"],`);
  linhas.push("        ],", "      },", "");
  return linhas.join(fim);
}

function inserirNoHistorico(versao, porTipo) {
  const caminho = join(raiz, "src/textos/textos.ts");
  const conteudo = readFileSync(caminho, "utf8");
  const fim = conteudo.includes("\r\n") ? "\r\n" : "\n";
  if (conteudo.includes(`versao: "${versao}"`)) return "já tinha entrada";
  const marca = `    historico: [${fim}`;
  if (!conteudo.includes(marca)) throw new Error("Não encontrei o início do histórico em src/textos/textos.ts.");
  writeFileSync(caminho, conteudo.replace(marca, marca + montarHistorico(versao, porTipo, fim)), "utf8");
  return "entrada criada";
}

function rascunhar() {
  const argumentos = process.argv.slice(2);
  if (argumentos.includes("--ajuda") || !argumentos.length) {
    console.log(AJUDA);
    return;
  }
  const refazer = argumentos.includes("--refazer");
  const desconhecido = argumentos.find((a) => a.startsWith("--") && a !== "--refazer" && a !== "--ajuda");
  if (desconhecido) throw new Error(`Argumento desconhecido: ${desconhecido}`);
  const versao = validarVersao(argumentos.find((a) => !a.startsWith("--")) ?? "");

  const tag = ultimaTag();
  const intervalo = tag ? `${tag}..HEAD` : "HEAD";
  const assuntos = git("log", intervalo, "--no-merges", "--format=%s").split("\n").filter(Boolean);
  const porTipo = separarPorTipo(assuntos);

  const caminho = join(raiz, "docs/releases", `${versao}.md`);
  const relativo = `docs/releases/${versao}.md`;
  if (existsSync(caminho) && !refazer) throw new Error(`${relativo} já existe. Edite o arquivo, ou use --refazer para sobrescrever o rascunho.`);
  const fim = existsSync(caminho) && readFileSync(caminho, "utf8").includes("\r\n") ? "\r\n" : "\n";
  const { texto, vazio } = montarMarkdown(versao, porTipo, fim);
  writeFileSync(caminho, texto, "utf8");
  const historico = inserirNoHistorico(versao, porTipo);

  const contagem = SECOES.map((s) => `${porTipo.get(s.tipo).length} ${s.titulo.toLowerCase()}`).join(", ");
  console.log(`Rascunho da ${versao} a partir de ${assuntos.length} commits desde ${tag || "o início"} (${contagem}):\n  ${relativo}: ${refazer ? "sobrescrito" : "criado"}\n  src/textos/textos.ts: ${historico}`);
  if (vazio) console.log("\nNenhum commit feat/fix/perf desde a última tag. O rascunho saiu só com o esqueleto.");
  console.log("\nAgora reescreva os dois com as frases que o usuário vai ler — o texto acima é o assunto cru dos commits.\nQuando estiver bom: pnpm publicar " + versao);
}

const esteArquivo = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === esteArquivo) {
  try {
    rascunhar();
  } catch (erro) {
    console.error(`Rascunho interrompido: ${erro.message}`);
    process.exitCode = 1;
  }
}
