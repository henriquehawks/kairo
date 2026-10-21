import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lerVersoes, validarVersoes, validarVersao, planejarVersao, sincronizarVersao } from "./versao-release.mjs";

// Só escreve o número da versão nos arquivos que precisam concordar. Não builda,
// não assina e não publica — quem faz isso é o workflow Publicar versão, a partir
// da tag. Use pnpm lancar quando quiser o build assinado aqui no seu computador.
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

const AJUDA = `Sincronizar a versão: pnpm versao 0.2.7
Prévia, sem alterar arquivo: pnpm versao 0.2.7 --verificar
Conferir a versão atual: pnpm versao`;

function lerArgumentos(argumentos) {
  const opcoes = { versao: undefined, verificar: false, ajuda: false };
  for (const argumento of argumentos) {
    if (argumento === "--verificar") opcoes.verificar = true;
    else if (argumento === "--ajuda") opcoes.ajuda = true;
    else if (argumento.startsWith("--")) throw new Error(`Argumento desconhecido: ${argumento}`);
    else if (opcoes.versao) throw new Error("Informe a versão apenas uma vez.");
    else opcoes.versao = validarVersao(argumento);
  }
  return opcoes;
}

function sincronizar() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  if (opcoes.ajuda) {
    console.log(AJUDA);
    return;
  }
  if (!opcoes.versao) {
    const arquivos = lerVersoes(raiz);
    const versao = validarVersoes(arquivos);
    console.log(`Versões sincronizadas em ${versao}:\n${arquivos.map((a) => `  ${a.nome}: ${a.versao}`).join("\n")}`);
    return;
  }
  const versao = opcoes.versao;
  const plano = planejarVersao(raiz, versao);
  const resumo = plano.map((a) => `  ${a.nome}: ${a.antes === a.depois ? "sem mudança" : "será atualizado"}`).join("\n");
  if (opcoes.verificar) {
    console.log(`Prévia da versão ${versao}:\n${resumo}\nNenhum arquivo foi alterado.`);
    return;
  }
  sincronizarVersao(plano);
  validarVersoes(lerVersoes(raiz), versao);
  console.log(`Versão ${versao} sincronizada:\n${resumo}`);
  const notas = `docs/releases/${versao}.md`;
  if (!existsSync(join(raiz, notas))) {
    console.log(`\nAtenção: falta ${notas}. Sem esse arquivo o workflow Publicar versão para antes de buildar.`);
  }
  console.log(`\nPara publicar:\n  git commit -am "chore: versão ${versao}"\n  git push origin main\n  git tag v${versao} ; git push origin v${versao}`);
}

try {
  sincronizar();
} catch (erro) {
  console.error(`Sincronização interrompida: ${erro.message}`);
  process.exitCode = 1;
}
