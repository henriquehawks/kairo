import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, LogOut, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { AvisoFaixa, Botao, Campo, ConfirmarModal, Modal } from "../../componentes/basicos";
import { GrupoAjuste, LinhaAjuste, NotaAjuste } from "./LinhaAjuste";
import { conta as ponteDaConta, type EstadoDaConta, type PainelDoAdmin, type PessoaDoKairo } from "../../ponte/ponteLocal";
import { T } from "../../textos/textos";
import { useConta } from "../../estado/conta";
import { horarioRelativo } from "../../utilitarios/datas";

const C = T.configuracoes.conta;

type Fase =
  | { nome: "carregando" }
  | { nome: "formulario" }
  | { nome: "codigo"; codigo: string }
  | { nome: "confirmar_email"; email: string }
  | { nome: "cofre_travado" }
  | { nome: "conectado" };

function mensagemDoErro(erro: unknown): string {
  const codigo = erro instanceof Error ? erro.message : "";
  return C.erros[codigo] ?? C.erros.falha_na_conta;
}

export function SecaoConta() {
  const [estado, setEstado] = useState<EstadoDaConta | null>(null);
  const [fase, setFase] = useState<Fase>({ nome: "carregando" });
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const recarregar = useCallback(async () => {
    try {
      const atual = await ponteDaConta.estado();
      // A seção não depende de nenhum gatilho ter montado para funcionar.
      await useConta.getState().carregar();
      setEstado(atual);
      if (!atual.disponivel) return setFase({ nome: "formulario" });
      if (atual.conectado && !atual.cofreAberto) return setFase({ nome: "cofre_travado" });
      setFase({ nome: atual.conectado ? "conectado" : "formulario" });
      if (atual.email) setEmail(atual.email);
    } catch {
      setEstado({ disponivel: false });
      setFase({ nome: "formulario" });
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  /** Toda ação passa por aqui: trava o botão, limpa o aviso antigo e traduz a falha. */
  const executar = async (acao: () => Promise<void>) => {
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      await acao();
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setOcupado(false);
    }
  };

  const aplicarEntrada = (r: Awaited<ReturnType<typeof ponteDaConta.entrar>>) => {
    setSenha("");
    if (r.situacao === "confirmar_email") return setFase({ nome: "confirmar_email", email: r.email });
    if (r.situacao === "cofre_travado") return setFase({ nome: "cofre_travado" });
    if (r.codigoDeRecuperacao) return setFase({ nome: "codigo", codigo: r.codigoDeRecuperacao });
    void recarregar();
  };

  if (fase.nome === "carregando") return <NotaAjuste><p className="ajuste-nota-texto">{T.geral.carregando}</p></NotaAjuste>;

  // Mesmo padrão do Google Workspace: a função existe, mas se declara indisponível.
  if (!estado?.disponivel) {
    return (
      <>
        <NotaAjuste><p className="ajuste-nota-texto">{C.explicacao}</p></NotaAjuste>
        <LinhaAjuste rotulo={C.emTestes} dica={C.emTestesDica} />
      </>
    );
  }

  if (fase.nome === "codigo") {
    return (
      <>
        <AvisoFaixa tipo="alerta"><KeyRound size={14} />{C.codigoTitulo}</AvisoFaixa>
        <NotaAjuste><p className="ajuste-nota-texto">{C.codigoDica}</p></NotaAjuste>
        <LinhaAjuste rotulo={C.codigo}>
          <code className="ajuste-valor-fixo conta-codigo">{fase.codigo}</code>
          <Botao
            pequeno
            icone={<Copy size={13} />}
            onClick={() => {
              void navigator.clipboard?.writeText(fase.codigo).then(() => setCopiado(true)).catch(() => undefined);
            }}
          >
            {copiado ? C.copiado : C.copiar}
          </Botao>
        </LinhaAjuste>
        <LinhaAjuste rotulo="">
          <Botao variante="primario" onClick={() => void recarregar()}>{C.guardei}</Botao>
        </LinhaAjuste>
      </>
    );
  }

  if (fase.nome === "confirmar_email") {
    return (
      <>
        <AvisoFaixa tipo="info">{C.confirmarEmail}</AvisoFaixa>
        <NotaAjuste><p className="ajuste-nota-texto">{C.confirmarEmailDica(fase.email)}</p></NotaAjuste>
        <LinhaAjuste rotulo="">
          <Botao onClick={() => setFase({ nome: "formulario" })}>{C.entrar}</Botao>
        </LinhaAjuste>
      </>
    );
  }

  if (fase.nome === "cofre_travado") {
    return (
      <>
        <AvisoFaixa tipo="erro"><TriangleAlert size={14} />{C.cofreTravado}</AvisoFaixa>
        <NotaAjuste><p className="ajuste-nota-texto">{C.cofreTravadoDica}</p></NotaAjuste>
        <Campo id="conta-codigo" rotulo={C.codigo} erro={erro}>
          <input id="conta-codigo" className="campo" value={codigo} maxLength={40} autoComplete="off" spellCheck={false} onChange={(e) => setCodigo(e.target.value)} />
        </Campo>
        <Campo id="conta-senha-destravar" rotulo={C.senha}>
          <input id="conta-senha-destravar" className="campo" type="password" value={senha} maxLength={200} autoComplete="current-password" onChange={(e) => setSenha(e.target.value)} />
        </Campo>
        <LinhaAjuste rotulo="">
          <Botao variante="primario" disabled={ocupado || !codigo.trim() || !senha} onClick={() => void executar(async () => {
            await ponteDaConta.destravar(codigo, senha);
            setCodigo("");
            setSenha("");
            await recarregar();
          })}>{C.destravar}</Botao>
          <Botao disabled={ocupado} onClick={() => void executar(async () => { await ponteDaConta.sair(); await recarregar(); })}>{C.sair}</Botao>
        </LinhaAjuste>
      </>
    );
  }

  if (fase.nome === "conectado") {
    return <Conectado email={estado.email ?? ""} admin={Boolean(estado.admin)} ocupado={ocupado} aoSair={() => void executar(async () => { await ponteDaConta.sair(); await recarregar(); })} />;
  }

  return (
    <>
      <NotaAjuste><p className="ajuste-nota-texto">{C.explicacao}</p></NotaAjuste>
      {aviso && <AvisoFaixa tipo="info">{aviso}</AvisoFaixa>}
      <Campo id="conta-email" rotulo={C.email} erro={erro}>
        <input id="conta-email" className="campo" type="email" value={email} maxLength={320} autoComplete="username" onChange={(e) => setEmail(e.target.value)} />
      </Campo>
      <Campo id="conta-senha" rotulo={C.senha} dica={C.senhaDica}>
        <input id="conta-senha" className="campo" type="password" value={senha} maxLength={200} autoComplete="current-password" onChange={(e) => setSenha(e.target.value)} />
      </Campo>
      <LinhaAjuste rotulo="">
        <Botao variante="primario" disabled={ocupado || !email.trim() || !senha} onClick={() => void executar(async () => aplicarEntrada(await ponteDaConta.entrar(email, senha)))}>{C.entrar}</Botao>
        <Botao disabled={ocupado || !email.trim() || !senha} onClick={() => void executar(async () => aplicarEntrada(await ponteDaConta.cadastrar(email, senha)))}>{C.cadastrar}</Botao>
      </LinhaAjuste>
      <LinhaAjuste rotulo="">
        <Botao variante="fantasma" pequeno disabled={ocupado || !email.trim()} onClick={() => void executar(async () => {
          await ponteDaConta.redefinir(email);
          setAviso(C.redefinicaoEnviada);
        })}>{C.esqueciSenha}</Botao>
      </LinhaAjuste>
    </>
  );
}

/**
 * Conta conectada: estado da última sincronização, botão para forçar uma agora e o
 * diálogo do primeiro encontro, quando os dois lados têm dados.
 */
function Conectado({ email, admin, ocupado, aoSair }: { email: string; admin: boolean; ocupado: boolean; aoSair: () => void }) {
  const sincronizando = useConta((s) => s.sincronizando);
  const ultima = useConta((s) => s.ultima);
  const escolhaPendente = useConta((s) => s.escolhaPendente);
  const sincronizar = useConta((s) => s.sincronizar);
  const erroDaSincronia = useConta((s) => s.erro);

  const quando = (carimbo: number) =>
    carimbo > 0 ? C.conflitoMexidoEm(horarioRelativo(new Date(carimbo).toISOString())) : C.conflitoSemData;

  return (
    <>
      <AvisoFaixa tipo="info"><ShieldCheck size={14} />{C.conectadoComo} {email}</AvisoFaixa>
      {erroDaSincronia && <AvisoFaixa tipo="erro">{C.erros[erroDaSincronia] ?? C.erros.falha_na_conta}</AvisoFaixa>}
      <NotaAjuste><p className="ajuste-nota-texto">{C.explicacao}</p></NotaAjuste>

      <LinhaAjuste
        rotulo={C.sincronizar}
        dica={ultima ? `${C.ultimaSincronia(horarioRelativo(new Date(ultima.em).toISOString()))} ${C.resumoDaSincronia(ultima.puxadas, ultima.enviadas)}` : C.nuncaSincronizou}
      >
        <Botao icone={<RefreshCw size={13} />} disabled={sincronizando || ocupado} onClick={() => void sincronizar()}>
          {sincronizando ? C.sincronizando : C.sincronizar}
        </Botao>
      </LinhaAjuste>

      {ultima && ultima.conflitos.length > 0 && (
        <AvisoFaixa tipo="alerta">
          <TriangleAlert size={14} />
          {C.houveConflito(ultima.conflitos.map((c) => c.replace(/^niko:/, "")).join(", "))}
        </AvisoFaixa>
      )}

      {admin && <Administracao email={email} />}

      <LinhaAjuste rotulo={C.sair} dica={C.sairDica}>
        <Botao icone={<LogOut size={13} />} disabled={ocupado || sincronizando} onClick={aoSair}>{ocupado ? C.saindo : C.sair}</Botao>
      </LinhaAjuste>

      <Modal aberto={escolhaPendente !== null} titulo={C.conflitoTitulo} aoFechar={() => useConta.setState({ escolhaPendente: null })}>
        <div className="formulario">
          <p className="ajuste-nota-texto">{C.conflitoTexto}</p>
          {escolhaPendente && (
            <div className="formulario-linha fin-duas">
              <div className="campo-grupo">
                <span className="campo-rotulo">{C.conflitoEsteComputador}</span>
                <span className="ajuste-dica">{C.conflitoAreas(escolhaPendente.local.areas)} · {quando(escolhaPendente.local.atualizado)}</span>
              </div>
              <div className="campo-grupo">
                <span className="campo-rotulo">{C.conflitoAConta}</span>
                <span className="ajuste-dica">{C.conflitoAreas(escolhaPendente.remoto.areas)} · {quando(escolhaPendente.remoto.atualizado)}</span>
              </div>
            </div>
          )}
          <div className="formulario-acoes">
            <Botao onClick={() => useConta.setState({ escolhaPendente: null })}>{C.decidirDepois}</Botao>
            <Botao disabled={sincronizando} onClick={() => void sincronizar("baixar")}>{C.usarAConta}</Botao>
            <Botao variante="primario" disabled={sincronizando} onClick={() => void sincronizar("subir")}>{C.usarEste}</Botao>
          </div>
        </div>
      </Modal>
    </>
  );
}

const A = C.admin;
const emKb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const quandoOuNunca = (iso: string | null, vazio: string) => (iso ? horarioRelativo(iso) : vazio);

/**
 * Administração. Aparece só para o e-mail do dono, mas isso é decoração: quem
 * recusa quem não tem permissão é o Postgres, nas funções do esquema, e a Edge
 * Function. Se alguém editar o app para mostrar esta tela, ela virá vazia.
 */
function Administracao({ email }: { email: string }) {
  const [painel, setPainel] = useState<PainelDoAdmin | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [convidado, setConvidado] = useState("");
  const [apagando, setApagando] = useState<PessoaDoKairo | null>(null);
  const [trocando, setTrocando] = useState<PessoaDoKairo | null>(null);
  const [senhaNova, setSenhaNova] = useState("");

  const carregar = useCallback(async () => {
    try {
      setPainel(await ponteDaConta.admin.painel());
      setErro("");
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const agir = async (acao: () => Promise<unknown>) => {
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    try {
      await acao();
      await carregar();
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setOcupado(false);
    }
  };

  const r = painel?.resumo;

  return (
    <>
      <GrupoAjuste titulo={A.titulo} dica={A.dica} acoes={<Botao pequeno icone={<RefreshCw size={13} />} disabled={ocupado} onClick={() => void carregar()}>{A.atualizar}</Botao>} />
      {erro && <AvisoFaixa tipo="erro">{erro}</AvisoFaixa>}

      {r && (
        <div className="formulario-linha fin-duas">
          <LinhaAjuste rotulo={A.pessoas}><span className="ajuste-valor-fixo numero">{r.pessoas}</span></LinhaAjuste>
          <LinhaAjuste rotulo={A.comDados}><span className="ajuste-valor-fixo numero">{r.com_dados}</span></LinhaAjuste>
          <LinhaAjuste rotulo={A.ativos}><span className="ajuste-valor-fixo numero">{r.ativos_7d}</span></LinhaAjuste>
          <LinhaAjuste rotulo={A.guardado}><span className="ajuste-valor-fixo numero">{emKb(r.bytes)}</span></LinhaAjuste>
        </div>
      )}

      {painel?.pessoas.length === 0 && <NotaAjuste><p className="ajuste-nota-texto">{A.semPessoas}</p></NotaAjuste>}
      {painel?.pessoas.map((p) => (
        <LinhaAjuste
          key={p.usuario_id}
          rotulo={p.email}
          dica={`${A.areas(p.areas)} · ${emKb(p.bytes)} · ${quandoOuNunca(p.ultima_sincronia, A.nuncaSincronizou)}${p.confirmado ? "" : ` · ${A.naoConfirmado}`}`}
        >
          <Botao pequeno disabled={ocupado} onClick={() => { setSenhaNova(""); setTrocando(p); }}>{A.trocarSenha}</Botao>
          <Botao pequeno variante="perigo" icone={<Trash2 size={13} />} disabled={ocupado || p.email === email} onClick={() => setApagando(p)}>{A.apagar}</Botao>
        </LinhaAjuste>
      ))}

      <GrupoAjuste titulo={A.convidados} dica={A.convidadosDica} />
      <Campo id="conta-convidado" rotulo={A.emailDoConvidado}>
        <input id="conta-convidado" className="campo" type="email" value={convidado} maxLength={320} onChange={(e) => setConvidado(e.target.value)} />
      </Campo>
      <LinhaAjuste rotulo="">
        <Botao variante="primario" disabled={ocupado || !convidado.trim()} onClick={() => void agir(async () => { await ponteDaConta.admin.convidar(convidado); setConvidado(""); })}>{A.convidar}</Botao>
      </LinhaAjuste>
      {painel?.convidados.map((convidadoEmail) => (
        <LinhaAjuste key={convidadoEmail} rotulo={convidadoEmail}>
          <Botao pequeno variante="fantasma" disabled={ocupado || convidadoEmail === email} onClick={() => void agir(() => ponteDaConta.admin.desconvidar(convidadoEmail))}>{A.remover}</Botao>
        </LinhaAjuste>
      ))}

      <ConfirmarModal
        aberto={apagando !== null}
        titulo={A.apagarTitulo}
        texto={apagando ? A.apagarTexto(apagando.email) : ""}
        rotuloConfirmar={A.apagar}
        aoFechar={() => setApagando(null)}
        aoConfirmar={() => {
          const alvo = apagando;
          setApagando(null);
          if (alvo) void agir(() => ponteDaConta.admin.apagar(alvo.usuario_id));
        }}
      />

      <Modal aberto={trocando !== null} titulo={A.trocarSenhaTitulo} aoFechar={() => setTrocando(null)}>
        <div className="formulario">
          <p className="ajuste-nota-texto">{A.trocarSenhaTexto}</p>
          <Campo id="conta-senha-admin" rotulo={A.novaSenha}>
            <input id="conta-senha-admin" className="campo" type="password" value={senhaNova} maxLength={200} onChange={(e) => setSenhaNova(e.target.value)} />
          </Campo>
          <div className="formulario-acoes">
            <Botao onClick={() => setTrocando(null)}>{T.geral.cancelar}</Botao>
            <Botao variante="primario" disabled={senhaNova.length < 8} onClick={() => {
              const alvo = trocando;
              setTrocando(null);
              if (alvo) void agir(() => ponteDaConta.admin.senha(alvo.usuario_id, senhaNova));
            }}>{A.trocarSenha}</Botao>
          </div>
        </div>
      </Modal>
    </>
  );
}
