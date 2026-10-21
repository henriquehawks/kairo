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
 * O padrão é desligada, e ligar exige a variável de ambiente KAIRO_CONTA=1. Isso é
 * de propósito: nenhum build de release pode sair com a conta ligada por descuido,
 * e ao mesmo tempo dá para testar numa máquina de verdade sem mexer no código.
 *
 *   KAIRO_CONTA=1 pnpm dev
 *
 * No app instalado, a ponte herda o ambiente do processo pai, então basta definir a
 * variável no sistema antes de abrir o Kairo.
 *
 * Quando a conta estiver testada em duas máquinas, trocar o padrão para true.
 */
export const CONTA_LIBERADA = process.env.KAIRO_CONTA === "1";
