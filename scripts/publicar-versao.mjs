import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validarVersao, planejarVersao, sincronizarVersao, lerVersoes, validarVersoes, verificarPublicacao } from "./versao-release.mjs";

// Faz de uma vez o que a seção "Publicar uma nova versão" do README descreve:
// confere, sincroniza a versão, commita, empurra e cria a tag — é a tag que
// dispara o workflow. Nada aqui builda nem publica arquivo: quem faz isso é o
// GitHub Actions. Pare antes de empurrar com --ensaio.
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAMO = "main";
const RASCUNHO = "<";
const NOTAS_DO_APP = "src/textos/textos.ts";

const AJUDA = `Publicar: pnpm publicar 0.2.8
Só conferir, sem empurrar nada: pnpm publicar 0.2.8 --ensaio
Pular tipos e testes (se acabou de rodar): pnpm publicar 0.2.8 --sem-testes`;

function git(...argumentos) {
  return execFileSync("git", argumentos, { cwd: raiz, encoding: "utf8" }).trim();
}

function rodar(comando) {
  console.log(`\n> ${comando}`);
  const resultado = spawnSync(comando, { cwd: raiz, stdio: "inherit", shell: true });
  if (resultado.error) throw resultado.error;
  if (resultado.status !== 0) throw new Error(`${comando} falhou. Nada foi alterado nem empurrado.`);
}

function alterados() {
  // Sem trim no conjunto: a primeira linha perderia o espaço do estado.
  const saida = execFileSync("git", ["status", "--porcelain"], { cwd: raiz, encoding: "utf8" });
  return saida
    .split(String.fromCharCode(10))
    .filter((linha) => linha.length > 2)
    .map((linha) => linha.slice(2).trim());
}

function endereco() {
  try {
    const origem = git("remote", "get-url", "origin");
    const limpo = origem.replace("git@github.com:", "https://github.com/").replace(".git", "");
    return limpo.startsWith("http") ? limpo : "https://github.com/henriquehawks/kairo";
  } catch {
    return "https://github.com/henriquehawks/kairo";
  }
}

async function publicar() {
  const argumentos = process.argv.slice(2);
  if (argumentos.includes("--ajuda") || !argumentos.length) {
    console.log(AJUDA);
    return;
  }
  const ensaio = argumentos.includes("--ensaio");
  const semTestes = argumentos.includes("--sem-testes");
  const desconhecido = argumentos.find((a) => a.startsWith("--") && !["--ensaio", "--sem-testes", "--ajuda"].includes(a));
  if (desconhecido) throw new Error(`Argumento desconhecido: ${desconhecido}`);
  const versao = validarVersao(argumentos.find((a) => !a.startsWith("--")) ?? "");

  const ramo = git("rev-parse", "--abbrev-ref", "HEAD");
  if (ramo !== RAMO) throw new Error(`Publique a partir de ${RAMO}. Você está em ${ramo}.`);

  const notas = `docs/releases/${versao}.md`;
  if (!existsSync(join(raiz, notas))) throw new Error(`Faltam as notas da versão em ${notas}. Comece o rascunho com pnpm notas ${versao}.`);
  const texto = readFileSync(join(raiz, notas), "utf8").trim();
  if (texto.length < 200) throw new Error(`${notas} está curto demais para virar a descrição da release.`);
  if (!texto.startsWith(`# Kairo ${versao}`)) throw new Error(`${notas} precisa começar com "# Kairo ${versao}".`);
  if (texto.includes(RASCUNHO)) throw new Error(`${notas} ainda tem trechos do rascunho entre "<" e ">". Escreva o texto final antes de publicar.`);

  const doApp = readFileSync(join(raiz, NOTAS_DO_APP), "utf8");
  if (!doApp.includes(`versao: "${versao}"`)) throw new Error(`${NOTAS_DO_APP} não tem a entrada da ${versao} no histórico. Use pnpm notas ${versao}.`);
  if (doApp.includes(`"${RASCUNHO}descreva a mudança>"`)) throw new Error(`${NOTAS_DO_APP} ainda está com o texto do rascunho na ${versao}.`);

  const plano = planejarVersao(raiz, versao);
  const esperados = new Set([...plano.map((a) => a.nome), notas, NOTAS_DO_APP]);
  const inesperados = alterados().filter((arquivo) => !esperados.has(arquivo));
  if (inesperados.length) throw new Error(`Commite ou guarde estes arquivos antes de publicar:\n  ${inesperados.join("\n  ")}`);

  if (git("tag", "--list", `v${versao}`)) throw new Error(`A tag v${versao} já existe aqui. Apague com git tag -d v${versao} ou escolha outra versão.`);
  if (git("ls-remote", "--tags", "origin", `refs/tags/v${versao}`)) throw new Error(`A tag v${versao} já existe no GitHub. Escolha a versão seguinte.`);
  await verificarPublicacao(versao);

  console.log(`Tudo pronto para a ${versao}:\n  notas: ${notas}\n  histórico do app: entrada da ${versao} encontrada\n  tag v${versao}: livre aqui e no GitHub`);

  if (!semTestes) {
    rodar("pnpm verificar");
    rodar("pnpm test");
  }

  if (ensaio) {
    console.log(`\nEnsaio da ${versao}. Faltaria:\n${plano.map((a) => `  ${a.nome}: ${a.antes === a.depois ? "sem mudança" : "receber a versão"}`).join("\n")}\n  git commit -am "chore: versão ${versao}"\n  git push origin ${RAMO}\n  git tag v${versao} ; git push origin v${versao}\nNada foi alterado nem empurrado.`);
    return;
  }

  sincronizarVersao(plano);
  validarVersoes(lerVersoes(raiz), versao);
  const paraCommitar = [...esperados].filter((arquivo) => existsSync(join(raiz, arquivo)));
  git("add", ...paraCommitar);
  if (git("diff", "--cached", "--name-only")) {
    git("commit", "-m", `chore: versão ${versao}`);
    console.log(`\nCommit chore: versão ${versao} criado.`);
  } else {
    console.log("\nNada novo para commitar; a versão já estava sincronizada.");
  }
  git("push", "origin", RAMO);
  git("tag", `v${versao}`);
  git("push", "origin", `v${versao}`);

  console.log(`\nTag v${versao} empurrada. O workflow Publicar versão assumiu daqui:\n  ${endereco()}/actions\nEm ~15 min a release v${versao} sai com o .exe, o .msi, o latest.json, o .deb, o .rpm e o AppImage.`);
}

const esteArquivo = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === esteArquivo) {
  try {
    await publicar();
  } catch (erro) {
    console.error(`Publicação interrompida: ${erro.message}`);
    process.exitCode = 1;
  }
}
