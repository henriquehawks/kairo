/**
 * Operações de administrador que exigem a chave secreta.
 *
 * Roda nos servidores da Supabase, não na máquina de ninguém. É isto que permite
 * usar a chave secreta sem ela entrar no app instalado — lá dentro, qualquer
 * pessoa conseguiria extraí-la e passar a ler e apagar os dados de todo mundo.
 *
 * Quem chama manda o próprio token. A função pergunta à Supabase de quem é esse
 * token e só continua se o e-mail for o do administrador. O app não decide nada.
 *
 * Publicar:  supabase functions deploy administrar
 */

const ADMIN = "henrique.coruja@grupolana.com.br";

const URL_DO_PROJETO = Deno.env.get("SUPABASE_URL") ?? "";
const CHAVE_SECRETA = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CHAVE_PUBLICA = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const responder = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

/** Pergunta à Supabase de quem é o token. Nunca confia no que o app disser. */
async function donoDoToken(token: string): Promise<{ id: string; email: string } | null> {
  const r = await fetch(`${URL_DO_PROJETO}/auth/v1/user`, {
    headers: { apikey: CHAVE_PUBLICA, authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const corpo = await r.json().catch(() => null);
  const id = typeof corpo?.id === "string" ? corpo.id : "";
  const email = typeof corpo?.email === "string" ? corpo.email : "";
  return id && email ? { id, email } : null;
}

function comoAdmin(caminho: string, opcoes: { method: string; corpo?: unknown }) {
  return fetch(`${URL_DO_PROJETO}${caminho}`, {
    method: opcoes.method,
    headers: {
      apikey: CHAVE_SECRETA,
      authorization: `Bearer ${CHAVE_SECRETA}`,
      ...(opcoes.corpo === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder(405, { erro: "metodo_invalido" });
  if (!URL_DO_PROJETO || !CHAVE_SECRETA) return responder(500, { erro: "funcao_sem_configuracao" });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return responder(401, { erro: "sem_token" });

  const quem = await donoDoToken(token);
  if (!quem) return responder(401, { erro: "token_invalido" });
  if (quem.email.toLowerCase() !== ADMIN) return responder(403, { erro: "sem_permissao" });

  const corpo = await req.json().catch(() => null);
  const acao = typeof corpo?.acao === "string" ? corpo.acao : "";
  const alvo = typeof corpo?.usuarioId === "string" ? corpo.usuarioId : "";
  if (!/^[0-9a-f-]{36}$/i.test(alvo)) return responder(400, { erro: "usuario_invalido" });

  if (acao === "apagar") {
    // O administrador não se apaga por acidente.
    if (alvo === quem.id) return responder(400, { erro: "nao_apaga_a_si" });
    // Os dados do usuário somem junto, pelo on delete cascade do esquema.
    const r = await comoAdmin(`/auth/v1/admin/users/${alvo}`, { method: "DELETE" });
    return r.ok ? responder(200, { ok: true }) : responder(400, { erro: "falha_ao_apagar" });
  }

  if (acao === "senha") {
    const senha = typeof corpo?.senha === "string" ? corpo.senha : "";
    if (senha.length < 8) return responder(400, { erro: "senha_curta" });
    const r = await comoAdmin(`/auth/v1/admin/users/${alvo}`, { method: "PUT", corpo: { password: senha } });
    // Trocar a senha de login não reabre o cofre da pessoa: os dados dela seguem
    // embrulhados na senha antiga, e só o código de recuperação destranca.
    return r.ok ? responder(200, { ok: true, avisoCofre: true }) : responder(400, { erro: "falha_na_senha" });
  }

  return responder(400, { erro: "acao_desconhecida" });
});
