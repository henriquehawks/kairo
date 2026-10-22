import { CONTA_LIBERADA } from "./configuracaoDaConta.ts";
import { ErroDaConta } from "./contaSupabase.ts";
import { apagarUsuario, cadastrar, convidar, desconvidar, destravarComCodigo, entrar, estadoDaConta, lerConvidados, painelDoAdmin, pedirRedefinicaoDeSenha, sair, trocarSenhaDe, type Dependencias } from "./conta.ts";
import { sincronizar } from "./sincronizacao.ts";

/**
 * Rotas /ponte/conta/*.
 *
 * Enquanto `CONTA_LIBERADA` for falso elas respondem como a do Google Workspace:
 * existem e se declaram indisponíveis, para a interface poder esconder a função
 * sem precisar saber se o recurso foi construído.
 *
 * Erro daqui sai como código nosso, nunca como o texto que o servidor de contas
 * mandou — mensagem de terceiro não vai parar na tela de ninguém.
 */

export interface Resposta {
  status: number;
  corpo: unknown;
}

const texto = (v: unknown) => (typeof v === "string" ? v : "");

export function ehRotaDaConta(caminho: string): boolean {
  return caminho === "/conta" || caminho.startsWith("/conta/");
}

export async function responderConta(caminho: string, metodo: string, corpo: Record<string, unknown>, deps?: Dependencias): Promise<Resposta> {
  if (!CONTA_LIBERADA) return { status: 200, corpo: { disponivel: false, emTestes: true } };

  try {
    if (caminho === "/conta" && metodo === "GET") {
      return { status: 200, corpo: { disponivel: true, ...(await estadoDaConta(deps)) } };
    }
    if (caminho === "/conta/cadastrar" && metodo === "POST") {
      return { status: 200, corpo: await cadastrar(texto(corpo.email), texto(corpo.senha), deps) };
    }
    if (caminho === "/conta/entrar" && metodo === "POST") {
      return { status: 200, corpo: await entrar(texto(corpo.email), texto(corpo.senha), deps) };
    }
    if (caminho === "/conta/destravar" && metodo === "POST") {
      await destravarComCodigo(texto(corpo.codigo), texto(corpo.senha), deps);
      return { status: 200, corpo: { ok: true } };
    }
    if (caminho === "/conta/redefinir" && metodo === "POST") {
      await pedirRedefinicaoDeSenha(texto(corpo.email), deps);
      // Responde igual com e-mail cadastrado ou não, para a rota não virar um
      // jeito de descobrir quem tem conta.
      return { status: 200, corpo: { ok: true } };
    }
    if (caminho === "/conta/sair" && metodo === "POST") {
      await sair(deps);
      return { status: 200, corpo: { ok: true } };
    }
    if (caminho === "/conta/sincronizar" && metodo === "POST") {
      const escolha = corpo.escolha === "subir" || corpo.escolha === "baixar" ? corpo.escolha : undefined;
      return { status: 200, corpo: await sincronizar({ banco: texto(corpo.banco), escolha, deps }) };
    }
    // Nenhuma destas confia no app: quem confere a permissão é o Postgres, nas
    // funções do esquema, e a Edge Function, que lê o e-mail de dentro do token.
    if (caminho === "/conta/admin" && metodo === "GET") {
      return { status: 200, corpo: { ...(await painelDoAdmin(deps)), convidados: await lerConvidados(deps) } };
    }
    if (caminho === "/conta/admin/apagar" && metodo === "POST") {
      await apagarUsuario(texto(corpo.usuarioId), deps);
      return { status: 200, corpo: { ok: true } };
    }
    if (caminho === "/conta/admin/senha" && metodo === "POST") {
      await trocarSenhaDe(texto(corpo.usuarioId), texto(corpo.senha), deps);
      return { status: 200, corpo: { ok: true } };
    }
    if (caminho === "/conta/admin/convidar" && metodo === "POST") {
      await convidar(texto(corpo.email), deps);
      return { status: 200, corpo: { ok: true } };
    }
    if (caminho === "/conta/admin/desconvidar" && metodo === "POST") {
      await desconvidar(texto(corpo.email), deps);
      return { status: 200, corpo: { ok: true } };
    }
    return { status: 404, corpo: { erro: "rota_desconhecida" } };
  } catch (erro) {
    if (erro instanceof ErroDaConta) return { status: 400, corpo: { erro: erro.codigo } };
    // A tela recebe um código curto, mas a causa precisa sobrar em algum lugar: sem
    // isto, toda falha vira "falha_na_conta" e não há por onde começar a investigar.
    process.stderr.write(`${new Date().toISOString()} conta ${caminho}: ${erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}
`);
    // Erro do cofre vem como ErroDoCofre; qualquer outro vira falha genérica.
    const codigo = erro instanceof Error && /^[a-z_]{3,40}$/.test(erro.message) ? erro.message : "falha_na_conta";
    return { status: 400, corpo: { erro: codigo } };
  }
}
