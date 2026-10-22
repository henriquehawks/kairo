import type { ConfiguracaoDaConta } from "./contaSupabase.ts";

/**
 * Endereço e chave pública do projeto de contas.
 *
 * A chave publicável é feita para ficar à vista: ela vai dentro do app instalado e
 * qualquer pessoa consegue lê-la de lá. Quem protege os dados é a RLS no banco, que
 * só devolve as linhas do dono da sessão — e, por cima dela, a criptografia de ponta
 * a ponta, que faz o servidor guardar conteúdo que nem ele consegue abrir.
 *
 * A chave secreta (`sb_secret_`) ignora a RLS e nunca pode aparecer aqui nem em
 * variável de ambiente de build. Ela mora só no painel.
 */
export const CONTA: ConfiguracaoDaConta = {
  url: process.env.KAIRO_CONTA_URL ?? "https://xerqmavfotkfomwnfens.supabase.co",
  chavePublica: process.env.KAIRO_CONTA_CHAVE ?? "sb_publishable_1h8Mfzr00dE5tq8vYtR-dQ_rGws-ltp",
};

/**
 * Liga a conta. Desligada, as rotas respondem como a do Google Workspace: existem,
 * mas se declaram indisponíveis, e a seção some das Configurações.
 *
 * Ligada por padrão desde a 0.3.3. A variável continua existindo como saída de
 * emergência: KAIRO_CONTA=0 desliga a conta numa máquina só, sem precisar de versão
 * nova, caso alguém tenha problema e seja preciso tirá-la do caminho.
 *
 * No app instalado a ponte herda o ambiente do processo pai, então basta definir a
 * variável no sistema antes de abrir o Kairo.
 */
export const CONTA_LIBERADA = process.env.KAIRO_CONTA !== "0";
