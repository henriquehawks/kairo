import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { criarServidorDeTeste } from "./vite-para-testes.mjs";

const opcoes = { configFile: false, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true } };
const vite = await criarServidorDeTeste(opcoes);
after(() => vite.close());
const { LimiteDeErro } = await vite.ssrLoadModule("/src/componentes/LimiteDeErro.tsx");
const { circuloDoTema, animarTrocaDeTema } = await vite.ssrLoadModule("/src/utilitarios/transicaoTema.ts");

test("novidades da 0.2.2 incluem o time, segurança e agradecimentos, sem antecipar a instalação", async () => {
  const { novidadesAte, temNovidadesDe } = await vite.ssrLoadModule('/src/utilitarios/novidades.ts');
  assert.equal(temNovidadesDe('0.2.2'), true);
  assert.equal(novidadesAte('0.2.1').some(v => v.versao === '0.2.2'), false);
  const novidades = novidadesAte('0.2.2');
  assert.equal(novidades[0].versao, '0.2.2');
  const textos = novidades[0].mudancas.map(([, texto]) => texto);
  const completo = textos.join('\n');
  for (const trecho of ['27 acessórios', 'Escritório de IAs', 'Tauri/Tokio', '@gustavowalkersgroup', '@landreussi', 'issue #5', 'desativado, em testes']) assert.ok(completo.includes(trecho), trecho);
  assert.doesNotMatch(completo, /Google Workspace: Gmail/);
  const descricao = readFileSync('docs/releases/0.2.2.md', 'utf8');
  for (const texto of textos.filter(t => !t.startsWith('Agradecimento'))) assert.ok(descricao.includes(texto), texto);
  assert.match(descricao, /https:\/\/github.com\/vitorcgo\/Niko\/issues\/5/);
  assert.match(descricao, /https:\/\/github.com\/vitorcgo\/Niko\/pull\/8/);
});

test("a versão atual tem notas em docs/releases e abre a página de novidades", async () => {
  const { T } = await vite.ssrLoadModule("/src/textos/textos.ts");
  const { versaoMaisNova } = await vite.ssrLoadModule("/src/utilitarios/versoes.ts");
  const versao = JSON.parse(readFileSync("package.json", "utf8")).version;
  const caminho = `docs/releases/${versao}.md`;
  assert.ok(existsSync(caminho), `faltam as notas da versão em ${caminho}; o workflow Publicar versão para sem elas`);
  const notas = readFileSync(caminho, "utf8").trim();
  assert.ok(notas.length > 200, `${caminho} está curto demais para virar a descrição da release`);
  assert.ok(notas.startsWith(`# Kairo ${versao}`), `${caminho} precisa começar com "# Kairo ${versao}"`);
  const historico = T.atualizacao.historico;
  const atual = historico.find((v) => v.versao === versao);
  assert.ok(atual, `a página Novidades não tem a entrada da ${versao}`);
  // A entrada da próxima versão pode ser escrita antes do número subir (é o que
  // pnpm notas faz), então o que se exige é a ordem, da mais nova para a mais antiga.
  for (let i = 1; i < historico.length; i++) {
    assert.ok(versaoMaisNova(historico[i - 1].versao, historico[i].versao), `${historico[i - 1].versao} precisa vir depois de ${historico[i].versao} no histórico`);
  }
  assert.match(atual.data, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(atual.mudancas.length > 0, "a versão atual não lista nenhuma mudança");
  for (const [tipo, texto] of atual.mudancas) {
    assert.ok(["novo", "melhoria", "correcao"].includes(tipo), `tipo de mudança desconhecido: ${tipo}`);
    assert.ok(texto.trim().length > 0, "mudança sem texto");
  }
});

const origemDoTema = { getBoundingClientRect: () => ({ left: 180, top: 670, width: 40, height: 40 }) };

function prepararTransicao(t, opcoes = {}) {
  const anteriores = ["window", "document"].map((nome) => Object.getOwnPropertyDescriptor(globalThis, nome));
  const eventos = new Map();
  const consulta = { matches: opcoes.reduzirSistema ?? false, addEventListener: (tipo, fn) => eventos.set(`consulta:${tipo}`, fn), removeEventListener: (tipo, fn) => { if (eventos.get(`consulta:${tipo}`) === fn) eventos.delete(`consulta:${tipo}`); } };
  const animacoes = [];
  const transicoes = [];
  const raiz = {
    dataset: { tema: "claro", reduzirAnimacoes: opcoes.reduzirApp ? "sim" : "nao" },
    animate: (quadros, configuracao) => {
      if (opcoes.falharAnimacao) throw new Error("animação indisponível");
      const animacao = { quadros, configuracao, cancelada: false, cancel() { this.cancelada = true; } };
      animacoes.push(animacao);
      return animacao;
    },
  };
  const doc = {
    documentElement: raiz, visibilityState: opcoes.oculto ? "hidden" : "visible",
    addEventListener: (tipo, fn) => eventos.set(`documento:${tipo}`, fn),
    removeEventListener: (tipo, fn) => { if (eventos.get(`documento:${tipo}`) === fn) eventos.delete(`documento:${tipo}`); },
  };
  if (!opcoes.semApi) doc.startViewTransition = (aplicar) => {
    if (opcoes.falharInicio) throw new Error("transição indisponível");
    const pronta = Promise.withResolvers();
    const final = Promise.withResolvers();
    const transicao = {
      ready: pronta.promise, finished: final.promise, aplicar,
      preparar() { aplicar(); pronta.resolve(); },
      falhar() { aplicar(); pronta.reject(new Error("transição ignorada")); final.resolve(); },
      terminar: () => final.resolve(),
      ignorada: false,
      skipTransition() { this.ignorada = true; pronta.reject(new Error("transição interrompida")); final.resolve(); },
    };
    transicoes.push(transicao);
    return transicao;
  };
  globalThis.document = doc;
  globalThis.window = {
    innerWidth: 1200, innerHeight: 800, matchMedia: () => consulta,
    addEventListener: (tipo, fn) => eventos.set(`janela:${tipo}`, fn),
    removeEventListener: (tipo, fn) => { if (eventos.get(`janela:${tipo}`) === fn) eventos.delete(`janela:${tipo}`); },
  };
  t.after(async () => {
    animarTrocaDeTema(null, () => {}, false);
    await Promise.resolve();
    await Promise.resolve();
    ["window", "document"].forEach((nome, i) => {
      if (anteriores[i]) Object.defineProperty(globalThis, nome, anteriores[i]);
      else delete globalThis[nome];
    });
  });
  return { raiz, doc, consulta, animacoes, transicoes, eventos };
}

test("a espera da ponte aguenta uma abertura lenta e avisa antes de desistir", async () => {
  const { esperarPonte, intervaloDaTentativa, ESPERA_MAXIMA_MS, AVISAR_APOS_MS } = await vite.ssrLoadModule("/src/ponte/esperarPonte.ts");
  // Numa máquina recém-instalada a ponte pode levar segundos; o orçamento precisa ser bem maior que isso.
  assert.ok(ESPERA_MAXIMA_MS >= 30_000, String(ESPERA_MAXIMA_MS));
  const relogio = { t: 0 };
  const rodar = async (sucessoNoMs, extras = {}) => {
    relogio.t = 0;
    const avisos = [];
    const esperas = [];
    const ok = await esperarPonte({
      tentar: async () => relogio.t >= sucessoNoMs,
      aguardar: async (ms) => { esperas.push(ms); relogio.t += ms; },
      agora: () => relogio.t,
      avisar: () => avisos.push(relogio.t),
      ...extras,
    });
    return { ok, avisos, esperas, fim: relogio.t };
  };
  // Ponte pronta na hora: nenhuma espera, nenhum aviso.
  assert.deepEqual(await rodar(0), { ok: true, avisos: [], esperas: [], fim: 0 });
  // Oito segundos de demora, que hoje viravam erro, agora são esperados até o fim.
  const lenta = await rodar(8_000);
  assert.equal(lenta.ok, true);
  assert.ok(lenta.fim >= 8_000 && lenta.fim < ESPERA_MAXIMA_MS, String(lenta.fim));
  assert.equal(lenta.avisos.length, 1, "o aviso aparece uma vez só");
  assert.ok(lenta.avisos[0] >= AVISAR_APOS_MS, String(lenta.avisos[0]));
  // Ponte que nunca sobe: desiste, sem estourar o limite.
  const nunca = await rodar(Infinity);
  assert.equal(nunca.ok, false);
  assert.equal(nunca.fim, ESPERA_MAXIMA_MS);
  assert.ok(nunca.esperas.every((ms) => ms > 0), "nenhuma espera de zero, que viraria laço quente");
  // O intervalo cresce mas não passa de dois segundos.
  assert.equal(intervaloDaTentativa(0), 250);
  assert.ok(intervaloDaTentativa(3) > intervaloDaTentativa(0));
  for (const t of [0, 1, 5, 20, 500]) assert.ok(intervaloDaTentativa(t) <= 2_000, String(t));
});

test("modal não refaz o foco inicial a cada tecla digitada no formulário", () => {
  const fonte = readFileSync(new URL("../src/componentes/basicos.tsx", import.meta.url), "utf8");
  // Quase toda tela passa aoFechar como função nova a cada render. Quando o efeito do foco inicial
  // dependia dela, cada tecla refazia o efeito e devolvia o cursor ao primeiro campo do formulário:
  // digitar o valor de uma conta recorrente jogava de volta para a descrição.
  assert.ok(!fonte.includes("[aberto, aoFechar]"), "o efeito de foco do modal não pode depender da identidade de aoFechar");
  assert.ok(fonte.includes("}, [aberto]);"), "o efeito de foco do modal depende só de aberto");
  assert.ok(fonte.includes("fechar.current()"), "o Escape precisa ler aoFechar por ref, para continuar fechando");
});

test("janela sobreposta não pinta painel de erro por cima da tela", () => {
  const fonte = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  // A sobreposta da ilha cobre o monitor inteiro: um painel nela viraria uma faixa sobre tudo.
  assert.ok(fonte.includes("if (JANELA_SOBREPOSTA) return;"), "o painel precisa sair cedo nas sobrepostas");
  assert.ok(fonte.includes("esperarPonte({"), "a espera paciente precisa estar ligada no início");
  assert.ok(!fonte.includes("NATIVO ? 5 : 1"), "a espera curta de 5 tentativas saiu");
});

test("círculo do tema nasce no centro do botão e cobre os quatro cantos mesmo perto da borda", () => {
  const { x, y, raio } = circuloDoTema(origemDoTema, 1200, 800);
  assert.deepEqual([x, y], [200, 690]);
  for (const [cx, cy] of [[0, 0], [1200, 0], [0, 800], [1200, 800]]) assert.ok(raio >= Math.hypot(cx - x, cy - y));
  assert.deepEqual(circuloDoTema(null, 1200, 800), { x: 600, y: 400, raio: 722 });
});

test("claro e escuro são revelados para fora sobre a imagem anterior e liberam a tela no fim", async (t) => {
  const c = prepararTransicao(t);
  for (const tema of ["escuro", "claro"]) {
    animarTrocaDeTema(origemDoTema, () => { c.raiz.dataset.tema = tema; });
    assert.notEqual(c.raiz.dataset.tema, tema);
    c.transicoes.at(-1).preparar();
    await Promise.resolve();
    assert.equal(c.raiz.dataset.tema, tema);
    const { quadros, configuracao } = c.animacoes.at(-1);
    assert.deepEqual(quadros.clipPath, ["circle(0px at 200px 690px)", "circle(1215px at 200px 690px)"]);
    assert.equal(configuracao.pseudoElement, "::view-transition-new(root)");
    assert.equal(configuracao.duration, 1000);
    assert.equal(c.raiz.dataset.transicaoTema, "sim");
    c.transicoes.at(-1).terminar();
    await Promise.resolve();
    assert.equal(c.raiz.dataset.transicaoTema, undefined);
    assert.equal(c.eventos.size, 0);
  }
});

for (const [nome, opcoes] of Object.entries({ "sem suporte": { semApi: true }, "redução do sistema": { reduzirSistema: true }, "redução do Kairo": { reduzirApp: true }, "janela oculta": { oculto: true }, "falha ao iniciar": { falharInicio: true } })) {
  test(`troca o tema imediatamente ${nome}, sem sobreposição presa`, (t) => {
    const c = prepararTransicao(t, opcoes);
    let aplicacoes = 0;
    animarTrocaDeTema(origemDoTema, () => { c.raiz.dataset.tema = "escuro"; aplicacoes++; });
    assert.equal(c.raiz.dataset.tema, "escuro");
    assert.equal(aplicacoes, 1);
    assert.equal(c.animacoes.length, 0);
    assert.equal(c.raiz.dataset.transicaoTema, undefined);
    assert.equal(c.eventos.size, 0);
  });
}

test("cliques rápidos não aplicam tema antigo nem removem os estilos da transição mais nova", async (t) => {
  const c = prepararTransicao(t);
  let antigo = 0;
  animarTrocaDeTema(origemDoTema, () => { antigo++; });
  const primeira = c.transicoes[0];
  animarTrocaDeTema(origemDoTema, () => { c.raiz.dataset.tema = "escuro"; });
  primeira.aplicar();
  await Promise.resolve();
  assert.equal(antigo, 0);
  assert.equal(c.raiz.dataset.transicaoTema, "sim");
  assert.equal(primeira.ignorada, true);
  c.transicoes[1].preparar();
  await Promise.resolve();
  assert.equal(c.animacoes.length, 1);
  c.transicoes[1].terminar();
  await Promise.resolve();
  assert.equal(c.eventos.size, 0);
});

test("transição ignorada pelo navegador mantém a troca de tema e limpa sua marcação", async (t) => {
  const c = prepararTransicao(t);
  animarTrocaDeTema(origemDoTema, () => { c.raiz.dataset.tema = "escuro"; });
  c.transicoes[0].falhar();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.raiz.dataset.tema, "escuro");
  assert.equal(c.raiz.dataset.transicaoTema, undefined);
  assert.equal(c.eventos.size, 0);
});

test("falha no efeito circular não deixa a interface congelada", async (t) => {
  const c = prepararTransicao(t, { falharAnimacao: true });
  animarTrocaDeTema(origemDoTema, () => { c.raiz.dataset.tema = "escuro"; });
  c.transicoes[0].preparar();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.raiz.dataset.tema, "escuro");
  assert.equal(c.raiz.dataset.transicaoTema, undefined);
  assert.equal(c.eventos.size, 0);
});

test("redimensionar, ocultar ou reduzir movimento interrompe o efeito sem reverter o tema", async (t) => {
  const c = prepararTransicao(t);
  for (const evento of ["janela:resize", "documento:visibilitychange", "consulta:change"]) {
    c.doc.visibilityState = "visible";
    animarTrocaDeTema(origemDoTema, () => { c.raiz.dataset.tema = "escuro"; });
    c.transicoes.at(-1).preparar();
    await Promise.resolve();
    c.doc.visibilityState = "hidden";
    c.eventos.get(evento)({ matches: true });
    await Promise.resolve();
    assert.equal(c.animacoes.at(-1).cancelada, true);
    assert.equal(c.raiz.dataset.tema, "escuro");
    assert.equal(c.raiz.dataset.transicaoTema, undefined);
    assert.equal(c.eventos.size, 0);
  }
});

test("escolher aparência equivalente cancela uma troca pendente sem aplicar estado atrasado", async (t) => {
  const c = prepararTransicao(t);
  animarTrocaDeTema(origemDoTema, () => { c.raiz.dataset.tema = "escuro"; });
  animarTrocaDeTema(origemDoTema, () => { c.raiz.dataset.tema = "claro"; }, false);
  c.transicoes[0].aplicar();
  await Promise.resolve();
  assert.equal(c.raiz.dataset.tema, "claro");
  assert.equal(c.raiz.dataset.transicaoTema, undefined);
});

test("servidores de teste usam caches distintos e nunca sobrescrevem o cache do localhost", async () => {
  const arquivos = [".vite", ".vite-niko"].map((nome) => new URL(`../node_modules/${nome}/deps/_metadata.json`, import.meta.url));
  const anteriores = arquivos.map((arquivo) => existsSync(arquivo) ? readFileSync(arquivo) : null);
  const isolado = await criarServidorDeTeste({ ...opcoes, cacheDir: vite.config.cacheDir });
  const caminho = isolado.config.cacheDir;
  try {
    assert.notEqual(caminho, vite.config.cacheDir);
    assert.match(caminho.replaceAll("\\", "/"), /\/node_modules\/\.vite-testes\/[^/]+$/);
    await isolado.ssrLoadModule("/src/utilitarios/contribuicoesGithub.ts");
  } finally {
    await isolado.close();
  }
  assert.equal(existsSync(caminho), false);
  assert.deepEqual(arquivos.map((arquivo) => existsSync(arquivo) ? readFileSync(arquivo) : null), anteriores);
});

test("barreira mantém o conteúdo enquanto não há erro", () => {
  const conteudo = createElement("p", null, "Página funcionando");
  assert.equal(new LimiteDeErro({ children: conteudo }).render(), conteudo);
});

function comFalha(props = {}) {
  const limite = new LimiteDeErro({ children: createElement("p", null, "Conteúdo que falhou"), ...props });
  limite.state = LimiteDeErro.getDerivedStateFromError(new Error("mensagem com dados privados"));
  return limite;
}

test("falha geral apresenta recuperação sem expor detalhes do erro nem recarregar automaticamente", () => {
  const html = renderToStaticMarkup(comFalha().render());
  assert.match(html, /role="alert"/);
  assert.match(html, /Não foi possível exibir o Kairo/);
  assert.match(html, /Recarregar o Kairo/);
  assert.match(html, /ainda não salvas podem ser perdidas/);
  assert.doesNotMatch(html, /dados privados|Conteúdo que falhou|Voltar ao início/);
});

test("falha de página oferece retorno ao início e mantém a navegação fora da barreira", () => {
  let voltou = false;
  const limite = comFalha({ aoVoltar: () => { voltou = true; } });
  const arvore = limite.render();
  const html = renderToStaticMarkup(arvore);
  assert.match(html, /Não foi possível abrir esta página/);
  assert.match(html, /Voltar ao início/);
  arvore.props.children[3].props.children[0].props.onClick();
  assert.equal(voltou, true);
  const janela = readFileSync(new URL("../src/janelas/sistema/JanelaSistema.tsx", import.meta.url), "utf8");
  assert.match(janela, /<BarraLateral[^]*<LimiteDeErro key=\{rota\}[^]*<Suspense[^]*<Pagina[^]*<\/LimiteDeErro>/);
  const principal = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(principal, /<LimiteDeErro>\s*<Raiz\s*\/>\s*<\/LimiteDeErro>/);
});

test("todos os testes com Vite passam pelo isolamento de cache", () => {
  for (const nome of ["validacoes", "escritorio", "personalizacao-agentes", "github", "configuracao-vite", "ilha"]) {
    const codigo = readFileSync(new URL(`./${nome}.test.mjs`, import.meta.url), "utf8");
    assert.match(codigo, /from "\.\/vite-para-testes\.mjs"/);
    assert.doesNotMatch(codigo, /import\s*\{[^}]*createServer[^}]*\}\s*from "vite"/);
  }
});

function coresDoBloco(arquivo, seletor) {
  const css = readFileSync(new URL(arquivo, import.meta.url), "utf8");
  const inicio = css.indexOf(`${seletor} {`);
  assert.ok(inicio >= 0, seletor);
  const bloco = css.slice(inicio, css.indexOf("}", inicio));
  return Object.fromEntries([...bloco.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function luminancia(cor) {
  const canais = cor.slice(1).match(/../g).map((canal) => parseInt(canal, 16) / 255);
  const [r, g, b] = canais.map((canal) => canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4);
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

test("tema claro mantém textos secundários legíveis sobre fundos suaves em todas as paletas", () => {
  const arquivo = "../src/estilos/estilo-sistema.css";
  const claro = coresDoBloco(arquivo, '[data-tema="claro"] .estilo-sistema');
  const fundos = [claro["--p-f"], claro["--p-s"]];
  for (const paleta of ["areia", "grafite", "floresta", "oceano"]) {
    const cores = coresDoBloco(arquivo, `[data-tema="claro"][data-paleta="${paleta}"] .estilo-sistema`);
    fundos.push(cores["--p-f"], cores["--p-s"]);
  }
  for (const token of ["--texto", "--texto-corpo", "--texto-2", "--texto-3", "--texto-4"]) {
    for (const fundo of fundos) {
      const contraste = (luminancia(fundo) + 0.05) / (luminancia(claro[token]) + 0.05);
      assert.ok(contraste >= 4.5, `${token} sobre ${fundo}: ${contraste}`);
    }
  }
  assert.notEqual(claro["--p-s"], "#ffffff");
  assert.equal(claro["--borda"], "color-mix(in srgb, var(--p-f), #000 18%)");
  assert.equal(claro["--borda-controle"], "color-mix(in srgb, var(--p-f), #000 22%)");
});

test("ajustes do calendário claro preservam as cores base do tema escuro", () => {
  const escuro = coresDoBloco("../src/estilos/estilo-sistema.css", '[data-tema="escuro"] .estilo-sistema');
  assert.equal(escuro["--p-f"], "#0e0e10");
  assert.equal(escuro["--p-s"], "#161618");
  assert.equal(escuro["--texto"], "#f2efe9");
  assert.equal(escuro["--texto-3"], "#6f6d69");
  const css = readFileSync(new URL("../src/estilos/telas/calendario.css", import.meta.url), "utf8");
  assert.match(css, /\[data-tema="claro"\] \.estilo-sistema \.cl-mes\s*\{\s*background: var\(--borda\)/);
  assert.match(css, /\[data-tema="claro"\] \.estilo-sistema \.cl-dia\[data-fora="sim"\] \.cl-dia-numero\s*\{\s*color: var\(--texto-4\)/);
});
