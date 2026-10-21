# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O projeto

Kairo é um app desktop (Tauri 2 + Rust + React 19 + TypeScript) para Windows 10/11 e Linux (GNOME). Ele substitui a barra de tarefas por um **dock**, adiciona uma **ilha** no topo da tela e tem uma **janela de sistema** com as áreas do app (journal, estudos, finanças, metas, calendário, conexões, chat). Quatro agentes com personalidade (`organizador` = Rubi, `tutor` = Nanquim, `operador` = Sol, `java` = Java) são a camada de apresentação do que o app já faz. O projeto é um fork renomeado do Niko — leia a seção "Renomeação Niko → Kairo" antes de "consertar" qualquer `niko` que sobrou.

Três princípios que o código respeita e que valem para qualquer mudança:

- **Funciona sem IA.** Toda função principal tem caminho próprio; IA é camada opcional por cima. Comandos como `/pomodoro`, `/capacidades` e `/relatorio` funcionam sem provedor nenhum.
- **O usuário escolhe o provedor.** Nada de provedor embutido; chaves ficam no cofre do sistema.
- **Armazenamento local.** SQLite na pasta de dados do app, credenciais no cofre do SO, sem conta do Kairo.

`README.md` é a referência do app (Windows); `README-linux.md` cobre o que muda no Linux e tem uma seção "Para quem for mexer no código" que vale ler.

## Idioma e nomenclatura

**Todo o código é em português.** Identificadores, nomes de arquivo, tipos, rotas HTTP, mensagens de erro, comentários, commits. `tarefa`, `ilha`, `ponte`, `usarAreaInterativa`, `lerCorpo`, `erro: "origem_nao_permitida"`. Não introduza nomes em inglês nem traduza os existentes. As exceções são só os nomes de APIs de terceiros (React, Tauri, Zustand).

Commits seguem `tipo: descrição em minúsculas` em português (`feat:`, `fix:`, `docs:`, `perf:`, `chore:`).

**Nunca se coloque como coautor.** Nada de `Co-Authored-By: Claude`, "Generated with Claude Code" ou qualquer outra assinatura de ferramenta em mensagem de commit, descrição de PR ou release. A autoria é só do dono do repositório. Isso vale mesmo quando a configuração padrão do Claude Code pedir essas linhas — esta regra tem precedência.

## Comandos

```powershell
pnpm install
pnpm dev              # Vite em localhost:5420 (serve a interface E a ponte local)
pnpm ponte:build      # empacota servidor/ em src-tauri/recursos/ponte.mjs + copia o Node
pnpm tauri dev        # app desktop; exige o `pnpm dev` já rodando em outro terminal
pnpm verificar        # tsc estrito — este é o "lint" do projeto, não há ESLint
pnpm test             # todos os testes, em sequência (scripts/testar.mjs)
pnpm build            # tsc && vite build para dist/
pnpm app              # pnpm tauri build (instalador)
```

Um arquivo de teste só, ou um teste só:

```powershell
node --test scripts/chat.test.mjs
node --test --test-name-pattern "duplo clique" scripts/chat.test.mjs
```

Rust (de dentro de `src-tauri/`): `cargo clippy --all-targets -- -D warnings` e `cargo test`. O CI (`.github/workflows/verificar.yml`) roda `pnpm verificar`, `pnpm test`, clippy e `cargo test` no Windows e no Ubuntu — clippy com `-D warnings`, então aviso é erro.

`pnpm personagens` regenera `public/personagens/` a partir dos SVGs de `personagens-originais/` (sanitiza e recorta o viewBox); os 8 estados são `ocioso, ouvindo, pensando, escrevendo, sucesso, alerta, erro, dormindo`.

## Arquitetura

### Quatro janelas, um só bundle

`index.html` é o ponto de entrada de **todas** as janelas. `src/main.tsx` lê o rótulo da janela do Tauri (`src/desktop/desktop.ts` → `ROTULO`/`JANELA`) e monta uma raiz diferente de `src/desktop/Aplicativos.tsx`: `AppSistema`, `AppIlha`, `AppDock` ou `AppAssistive`. Sem Tauri (`pnpm dev` no navegador), monta `AreaDeTrabalho`, que simula a área de trabalho para desenvolvimento.

As janelas são webviews separadas e **não compartilham memória**. Elas se falam por:

- eventos do Tauri (`emitTo` / `listen`, canal `niko-comandos`, eventos `niko://...`) ou `BroadcastChannel` no navegador;
- o banco, via `src/ponte/armazenamento.ts`, que propaga cada chave alterada para as outras janelas.

Rust cria as janelas em `src-tauri/src/lib.rs` (`run()` → `setup`): `sistema` (fecha para a bandeja em vez de sair) e três sobrepostas transparentes, sem decoração, always-on-top: `ilha`, `dock` (mais `dock-<n>` por monitor, em `docks.rs`) e `assistive`.

### Cliques atravessando as janelas sobrepostas

A ilha, o dock e o AtalhoTouch cobrem faixas grandes da tela, mas precisam deixar o clique passar onde estão transparentes. O mecanismo: o React mede os retângulos dos elementos realmente interativos (`usarAreaInterativa([...seletores])` em `desktop.ts`) e manda para o Rust (`area_interativa`); um laço no Rust (`vigiar_cursor`, 45 ms) compara a posição do cursor com esses retângulos, chama `set_ignore_cursor_events` e emite `niko://cursor-fora` / `niko://clique-fora`. Ao mexer no layout dessas janelas, atualize os seletores — um elemento fora da lista fica visível mas não clicável.

### A ponte local

Toda função que precisa do sistema operacional, de rede ou do banco passa por um servidor HTTP Node em `servidor/`, com as rotas `/ponte/*` definidas em `servidor/ponte.ts`. Ele roda em dois modos:

- **Desenvolvimento:** plugin do Vite (`ponteLocal()`, no fim de `servidor/ponte.ts`), como middleware do `pnpm dev`. O token vai para o HTML numa `<meta name="niko-token">`. O Rust **não** sobe a ponte em debug (`iniciar_ponte` retorna cedo com `debug_assertions`).
- **Produção:** `servidor/producao.ts` empacotado por `pnpm ponte:build` em `src-tauri/recursos/ponte.mjs`, rodando no `node.exe`/`node` copiado para dentro do instalador. O Rust gera um token, sobe o processo filho em `127.0.0.1:47831`, vigia e reinicia (`vigiar_ponte`), e mata no encerramento. O filho também se mata se o pai morrer (`NIKO_PAI`).

O front não sabe de nada disso: `prepararPonte()` embrulha `window.fetch` e reescreve `/ponte/...` para a base certa com os cabeçalhos `x-niko: 1` e `x-niko-token`. Toda requisição é recusada sem host local, sem o cabeçalho `x-niko` ou sem o token (403); as rotas de gancho das ferramentas de código são exceção e usam um segredo próprio.

Se a ponte não sobe no app instalado, `main.tsx` falha de propósito (`ponte_indisponivel`) e mostra o painel de erro — não há degradação silenciosa para `localStorage` no modo nativo.

### Estado e persistência

Zustand com `persist` em `src/estado/*.ts`, um store por área. O storage é o do projeto (`src/ponte/armazenamento.ts`), não o `localStorage` direto: ele escreve por `POST /ponte/dados` num SQLite key-value (`servidor/banco.ts`, `node:sqlite`), com chaves no formato `niko:<nome>`, envio agrupado, fila de pendências, backup diário e na migração de esquema, e eco para as outras janelas. `localStorage` só é usado como modo degradado no navegador.

Ao criar um store, siga o padrão dos existentes: `partialize` para escolher o que persiste e `merge` validando o que veio do disco (veja `estado/configuracoes.ts` com `configuracoesValidas`). Dado persistido é entrada não confiável.

### Camadas de plataforma (Windows × Linux)

Há três contratos de plataforma e **nada fora deles fala direto com o sistema**:

| Camada | Contrato | Implementações |
| --- | --- | --- |
| Ponte (Node) | `servidor/plataforma/tipos.ts` | `servidor/plataforma/windows/`, `.../linux/` — escolhidas em tempo de execução por `plataforma/index.ts` |
| Nativo (Rust) | `src-tauri/src/plataforma/mod.rs` | `plataforma/windows/`, `plataforma/linux/` — escolhidas na compilação |
| Interface | `src/desktop/plataforma.ts` (`NO_LINUX`, `TECLA_SUPER`) | só muda texto e opções visíveis |

Precisa de algo novo do sistema? Acrescente no contrato e implemente nos **dois** lados. O tipo `Plataforma` faz o `pnpm verificar` acusar quando um lado fica para trás. No `Cargo.toml` o crate `windows` só existe em `[target.'cfg(windows)'.dependencies]`.

No Windows, a implementação é um processo PowerShell de vida longa com C# inline (COM/Win32 para áudio, janelas, bandeja, mídia), falando JSON por linha no stdin/stdout (`servidor/plataforma/windows/processoPowerShell.ts`). No Linux são utilitários do sistema (`playerctl`, `wpctl`, NetworkManager, MPRIS, Secret Service, `gsettings`, `tesseract`, extensão Window Calls).

### IA, chat e ferramentas

`servidor/ia.ts` fala com dois tipos de provedor (`anthropic` e `openai_compativel`), configurados pelo usuário em `provedores.json` na pasta de dados, com a chave no cofre do SO (`servidor/segredos.ts`). `POST /ponte/ia` devolve NDJSON de eventos; o cliente é `src/ponte/ponteLocal.ts` (`conversarIa`).

As ferramentas que o modelo pode chamar estão em `src/utilitarios/ferramentasIa.ts` (ler tarefas, lançar transação, criar evento…). Elas **executam no front**, sobre os stores, e ações que mudam dados devolvem `{ tipo: "confirmar", cartao }` — um cartão que o usuário aprova, não uma escrita direta. `reservarConfirmacao` em `servidor/banco.ts` garante que a mesma aprovação não execute duas vezes.

`src/utilitarios/funcoes.ts` é o mapa de desligamento: cada função (`journal`, `estudos`, `financas`, `metas`, `calendario`) lista suas rotas, abas da ilha, blocos do início, ferramentas de IA, áreas do banco, comandos e cartões. Ao adicionar qualquer uma dessas peças, registre-a em `PARTES` — senão ela continua aparecendo com a função desligada.

### Ferramentas de código (aba Código / Escritório de IAs)

`servidor/claude.ts` e `servidor/agentesDeCodigo.ts` instalam ganchos nas configurações de Claude Code, Codex, Copilot CLI, OpenCode, Antigravity, Kimi, Gemini CLI e Amp (`FERRAMENTAS_DE_CODIGO`). Os ganchos são comandos `curl` que postam em `/ponte/agentes/evento/<ferramenta>` com um segredo próprio; o Kairo acompanha sessões, mostra alterações e responde pedidos de aprovação. A instalação edita arquivos do usuário (`~/.claude/settings.json` e equivalentes) marcando os blocos como gerados pelo Kairo (marcador literal `# niko:inicio`, mantido), para poder removê-los depois — mexa aí com cuidado e sempre pelos caminhos de `instalarAgente` / `removerAgente`.

### Textos e estilos

**Toda string de interface fica em `src/textos/textos.ts`** (~3.200 linhas, objeto `T`). Não escreva texto solto em componente. Os textos que citam o sistema usam as constantes `SISTEMA`, `COFRE` e `OCR`, que mudam conforme `NO_LINUX`.

CSS é CSS puro, importado todo em `main.tsx`: `src/estilos/tokens.css` tem as variáveis (espaçamento, raios, cores, cores dos agentes) e `src/estilos/telas/<area>.css` o resto. Use os tokens em vez de valores crus.

A CSP tem **uma única fonte de verdade**: `app.security.csp` em `src-tauri/tauri.conf.json`. O `vite.config.ts` lê de lá e injeta no HTML no build; um teste confere que as duas batem.

## Regras que o projeto impõe

- **Imports relativos em `servidor/` terminam em `.ts`** (`./banco.ts`). O `tsc` aceita sem extensão, o Node não. Um teste em `scripts/concorrencia.test.mjs` verifica.
- `tsconfig.json` é estrito, com `noUnusedLocals` e `noUnusedParameters`; `pnpm verificar` cobre `src`, `servidor` e `vite.config.ts`.
- Módulos de rota (`src/modulos/<area>/<Area>.tsx`) precisam de `export default`, porque `src/janelas/sistema/rotas.tsx` carrega todos com `lazy()`.
- No Linux, `set_ignore_cursor_events` falha em janela escondida — use `plataforma::ignorar_cursor`.
- Google Workspace está **desativado de propósito** (`/ponte/google/login-direto` devolve `{ disponivel: false, emTestes: true }`). O código de Gmail/Agenda/Drive existe mas está bloqueado, inclusive nas ferramentas do chat, e `conexoes-em-testes.test.mjs` garante isso. Não "conserte" reativando.

## Testes

Não há Vitest, jsdom ou testing-library. Os testes são `node:test` + `node:assert/strict` em `scripts/*.test.mjs`, e carregam o TypeScript de verdade por um servidor Vite em modo SSR:

```js
const servidor = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom" });
const { usePomodoro } = await servidor.ssrLoadModule("/src/estado/pomodoro.ts");
```

`window`, `localStorage` e `BroadcastChannel` são substituídos por stubs no topo do arquivo e **`globalThis.fetch` é trocado por uma função que lança** — teste nenhum toca a rede ou o banco real. Componentes são verificados com `renderToStaticMarkup` e asserções sobre o HTML gerado. `pnpm test` roda a lista de `scripts/testar.mjs` com `--test-concurrency=1`; ao criar um arquivo de teste novo, acrescente o nome nessa lista, senão ele não roda no CI.

## Publicar versão

```powershell
pnpm notas 0.2.6                                     # rascunha as notas da versão a partir dos commits
pnpm publicar 0.2.6                                  # confere, sincroniza, commita e cria a tag
pnpm versao 0.2.6                                    # só sincroniza as versões, sem buildar
pnpm versao                                          # mostra a versão atual dos quatro arquivos
pnpm lancar 0.2.6 "Descrição"                        # sincroniza versões, builda e assina
pnpm lancar 0.2.6 --notas-arquivo docs/releases/0.2.6.md
pnpm lancar:verificar                                # só confere se as 4 versões concordam
pnpm lancar 0.2.6 --verificar                        # prévia, sem alterar arquivo nenhum
```

A versão vive em **quatro** lugares que precisam concordar: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` e `Cargo.lock` (mais o selo no README). Nunca edite à mão — `pnpm versao <versao>` (`scripts/sincronizar-versao.mjs`) grava os cinco de uma vez ou nenhum, e recusa downgrade; é o passo normal antes da tag, porque o job do Linux confere a versão dos arquivos contra a tag. `scripts/lancar-versao.mjs` faz a mesma sincronização e ainda consulta o GitHub para impedir release duplicada e valida os artefatos assinados antes de escrever `latest.json`. O script **não publica nada**; os pacotes do Linux saem do workflow `pacotes-linux.yml` quando a release é publicada. A chave de atualização (`TAURI_SIGNING_PRIVATE_KEY` ou `~/.tauri/kairo-atualizacao.key`) é sempre a mesma das versões anteriores.

As notas de cada versão ficam em `docs/releases/<versao>.md`, em português e voltadas ao usuário.

### Quando o usuário pedir uma release nova

Frases como **"lança a 0.2.9"**, **"posta a release nova"**, **"publica a próxima versão"** ou **"sobe uma versão nova"** significam o procedimento inteiro desta seção, com autorização permanente para publicar — não pergunte se pode. Se ele não disser o número, use o próximo patch (`pnpm versao` mostra o atual).

Faça, nesta ordem, sem parar no meio:

1. `pnpm notas <versao>` — gera o rascunho nos dois arquivos.
2. **Reescreva os dois textos** em português, voltados a quem usa o app, não ao desenvolvedor: o que mudou na tela, não o nome da função. Se os commits forem só de ferramenta ou documentação, diga isso com todas as letras nas notas ("nada muda no app"), em vez de inventar novidade. Os dois arquivos precisam contar a mesma coisa.
3. `pnpm publicar <versao>` — ele faz as checagens, roda tipos e testes, sincroniza, commita, empurra e cria a tag.
4. Acompanhe o run (`gh run watch <id>`) e confirme no fim que a release tem os seis arquivos.
5. Responda com o texto das notas publicadas e o link da release.

Pare e pergunte só se: o número pedido for menor que o atual, a árvore tiver mudanças alheias à versão que você não deveria commitar, ou o build falhar. Um `pnpm publicar` que para sozinho já explica o motivo — corrija o que ele apontou e rode de novo, não force nada.

### Publicar a release no GitHub

Quem já tem o app recebe a atualização sozinho pelo próprio Kairo — é para isso que o `latest.json` existe. Por isso toda release leva **os três arquivos juntos**: o `.exe`, o `.msi` e o `latest.json`. Publicar sem o `latest.json`, ou com um gerado em outro build, deixa o updater sem o que ler ou com assinatura que não bate. E só versão **nova** atualiza alguém: o app compara o número, então republicar a mesma versão não chega a ninguém.

O caminho normal é a tag; commitar não publica nada. São dois comandos, com a 0.2.8 de exemplo:

```powershell
pnpm notas 0.2.8       # rascunha docs/releases/0.2.8.md e a entrada do histórico em textos.ts
# reescrever os dois textos pensando em quem usa o app
pnpm publicar 0.2.8    # confere, roda tipos e testes, sincroniza, commita, empurra e cria a tag
```

`pnpm notas` separa os commits desde a última tag por `feat:`/`fix:`/`perf:` e escreve os **dois** lugares de uma vez, para nascerem iguais; `--refazer` sobrescreve. `pnpm publicar` recusa fora da `main`, com arquivos não commitados que não sejam os da versão, sem notas, com `<...>` de rascunho no texto, sem entrada no histórico, ou com a tag já existente aqui ou no GitHub; `--ensaio` faz as checagens sem empurrar e `--sem-testes` pula tipos e testes. Um teste em `scripts/interface.test.mjs` garante que a versão de `package.json` tem notas em `docs/releases/` e entrada no histórico, e que o histórico está em ordem decrescente — a entrada da próxima versão pode ser escrita antes de o número subir, que é como o `pnpm notas` deixa o repositório.

Na mão, se precisar: `pnpm verificar` e `pnpm test`, `pnpm versao 0.2.8`, `git commit -am "chore: versão 0.2.8"`, `git push origin main`, `git tag v0.2.8 ; git push origin v0.2.8`.

Para repetir a mesma versão depois de um erro, apague antes a release e a tag (`gh release delete v0.2.8 --repo henriquehawks/kairo --yes`, `git push origin :v0.2.8`, `git tag -d v0.2.8`) — senão a trava contra release duplicada derruba o build. Se alguém já baixou, prefira pular para a versão seguinte.

O workflow `publicar.yml` tem quatro jobs: `preparar` (versão e notas), `windows` e `linux` em paralelo, e `publicar`, que baixa os artefatos dos dois e cria a release com os seis arquivos. Falhou um dos buildes, nada é publicado. O job do Windows roda só `pnpm verificar` — os testes já passaram no `pnpm publicar` e no workflow Verificar. A chave de assinatura vem do secret `TAURI_SIGNING_PRIVATE_KEY` do repositório, que é a mesma de `~/.tauri/kairo-atualizacao.key`. Dá para disparar sem tag pelo `workflow_dispatch`, informando a versão.

O `pacotes-linux.yml` é chamado como workflow reutilizável de propósito: release criada pelo token do Actions **não dispara** outros workflows, então pelo evento `release` ele nunca rodaria. Chamado sem o input `tag`, ele só guarda o artefato; com `tag`, anexa direto na release — é como o evento `release` ainda funciona para uma publicação manual.

Para publicar à mão (sem tag), o `gh` está em `%LOCALAPPDATA%\Programs\gh\gh.exe`, fora do PATH, autenticado como `henriquehawks`:

```powershell
gh release create v0.2.6 `
  "src-tauri/target/release/bundle/nsis/Kairo_0.2.6_x64-setup.exe" `
  "src-tauri/target/release/bundle/msi/Kairo_0.2.6_x64_pt-BR.msi" `
  "src-tauri/target/release/bundle/nsis/latest.json" `
  --repo henriquehawks/kairo --title "Kairo 0.2.6" --notes-file docs/releases/0.2.6.md
```

O usuário baixa só o `.exe`; o `.msi` é para quem instala por MSI e o `latest.json` não é para humanos.

## Avisos

- Este arquivo é versionado junto com o código, para acompanhar quem clonar o repositório. `AGENTS.md`, `GEMINI.md` e `.claude/` continuam no `.gitignore`.
- O projeto é **proprietário**, não open source. O `README.md` ainda aponta para um `LICENSE.md` que foi removido da árvore.
- O remote `origin` é `github.com/henriquehawks/kairo`, o mesmo endereço que o código usa no updater (`src-tauri/tauri.conf.json`), na checagem de versão (`servidor/atualizacoes.ts`) e na página Atualização (`src/modulos/atualizacao/Atualizacao.tsx`).

## Renomeação Niko → Kairo

Este fork renomeou o produto, **mas só o que o usuário vê**. Os identificadores internos continuam `niko` **de propósito** — não os "conserte".

Renomeado (identidade do produto e texto visível):

- `productName`, `identifier` (`com.kairo.desktop`), `publisher`, `shortDescription` e `wix.upgradeCode` (GUID novo) em `tauri.conf.json`
- crate e lib em `Cargo.toml` (`kairo` / `kairo_lib`), `Cargo.lock`, `main.rs`, e o nome do processo em `windows/ganchos.nsh` (`kairo.exe`) — **esses quatro andam juntos**: o gancho do instalador mata o app pelo nome do executável, que vem do nome do crate
- `updater.pubkey` (par novo em `~/.tauri/kairo-atualizacao.key`) e `updater.endpoints` → `henriquehawks/kairo`
- títulos de janela, tooltip e menu da bandeja em `lib.rs`; `<title>` do `index.html`
- `src/textos/textos.ts`, READMEs e `docs/releases/*.md`

Mantido como `niko` (backend):

| O que | Por quê |
| --- | --- |
| `x-niko`, `x-niko-token`, `x-niko-banco` | contrato front ↔ ponte |
| `NIKO_TOKEN`, `NIKO_PORTA`, `NIKO_PAI`, `NIKO_PASTA` | contrato Rust ↔ ponte ↔ instalador |
| eventos `niko://*` | contrato Rust ↔ webviews |
| canais `niko-comandos`, `niko-dados` | contrato entre janelas |
| prefixo de chave `niko:` + regex em `banco.ts` e `armazenamento.ts` | renomear esconderia todo dado salvo |
| `PREFIXO = "Niko/"` nos dois `segredos.ts` | é o nome das entradas no cofre do SO; renomear exige recadastrar chaves de IA e tokens |
| `niko.db`, `niko.log`, backups `niko-*` | nomes de arquivo no disco |
| `tipo: "niko-backup"` | formato dos backups `.json` |
| `# niko:inicio`, `ehGanchoDoNiko`, `id: "niko"` | identificam os ganchos já instalados em `~/.claude/settings.json` e afins; renomear tornaria irremovíveis pelo app |
| `estilo: "niko"` no Escritório | valor salvo na configuração |
| `MonitorDoNiko`, `NikoCredencial`, `trocaNiko`, `LogoNiko` e ~33 outros | identificadores de código |
| `.vite-niko`, plugins `niko-ponte-local`, classes CSS `carregando-niko` | internos de build e estilo |

Consequências aceitas na renomeação:

- **Instalação nova e limpa.** Com `identifier` novo, a pasta de dados passa a ser `com.kairo.desktop`: o banco, `provedores.json` e `conexoes.json` do Niko não são lidos. As **credenciais no cofre do SO são compartilhadas** (prefixo `Niko/` mantido), então a chave de IA volta sozinha ao recadastrar o provedor com o mesmo id.
- **Backups `.json` do Niko não importam no Kairo** — o `tipo` segue `niko-backup`, mas as chaves exportadas têm o prefixo `niko:` e o importador as aceita; o que muda é a pasta de dados, não o formato. Confirme num backup de teste antes de confiar.
- Os links de crédito em `docs/releases/*.md` (issue #5, PR #8…) continuam apontando para `vitorcgo/Niko`, porque referenciam issues reais do projeto original. Um teste em `scripts/interface.test.mjs` depende disso.
- As notas de release exibidas no app vêm de `textos.ts` e um teste exige que batam **literalmente** com `docs/releases/*.md`. Mexeu em uma, mexa na outra.
