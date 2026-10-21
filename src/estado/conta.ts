import { create } from "zustand";
import { conta as ponteDaConta, type EstadoDaConta, type ResultadoDaSincronizacao } from "../ponte/ponteLocal";
import { recarregarDaPonte } from "../ponte/armazenamento";

/**
 * Estado da conta e das sincronizações.
 *
 * Não é persistido de propósito: a sessão e a chave moram no cofre do sistema
 * operacional, e quem sabe a verdade é a ponte. Guardar uma cópia aqui só criaria
 * uma segunda versão para divergir.
 */

/** Espaço entre sincronizações automáticas enquanto o app fica aberto. */
export const INTERVALO_DA_SINCRONIA_MS = 10 * 60_000;
/** Depois de voltar para o app, espera um instante antes de sincronizar de novo. */
export const ESPERA_APOS_FOCO_MS = 2_000;

export interface UltimaSincronia {
  em: number;
  puxadas: number;
  enviadas: number;
  conflitos: string[];
  backup?: string;
}

interface EstadoDaLoja {
  carregado: boolean;
  disponivel: boolean;
  conectado: boolean;
  cofreAberto: boolean;
  email: string;
  sincronizando: boolean;
  /** Os dois lados têm dados e ninguém além da pessoa pode escolher qual vale. */
  escolhaPendente: ResultadoDaSincronizacao["resumo"] | null;
  ultima: UltimaSincronia | null;
  erro: string;
  carregar: () => Promise<void>;
  sincronizar: (escolha?: "subir" | "baixar") => Promise<void>;
  limparErro: () => void;
}

export const useConta = create<EstadoDaLoja>()((set, get) => ({
  carregado: false,
  disponivel: false,
  conectado: false,
  cofreAberto: false,
  email: "",
  sincronizando: false,
  escolhaPendente: null,
  ultima: null,
  erro: "",

  carregar: async () => {
    try {
      const estado: EstadoDaConta = await ponteDaConta.estado();
      set({
        carregado: true,
        disponivel: Boolean(estado.disponivel),
        conectado: Boolean(estado.conectado),
        cofreAberto: Boolean(estado.cofreAberto),
        email: estado.email ?? "",
      });
    } catch {
      set({ carregado: true, disponivel: false, conectado: false, cofreAberto: false, email: "" });
    }
  },

  sincronizar: async (escolha) => {
    const atual = get();
    // Sem conta, com o cofre fechado ou já sincronizando, não há o que fazer.
    if (atual.sincronizando || !atual.disponivel || !atual.conectado || !atual.cofreAberto) return;
    set({ sincronizando: true, erro: "" });
    try {
      const r = await ponteDaConta.sincronizar(escolha);
      if (r.situacao === "perguntar") {
        set({ escolhaPendente: r.resumo ?? null });
        return;
      }
      if (r.situacao !== "sincronizou") {
        set({ escolhaPendente: null });
        await get().carregar();
        return;
      }
      // Algo desceu: as telas abertas precisam ver os dados novos sem recarregar o app.
      if (r.puxadas.length > 0) await recarregarDaPonte();
      set({
        escolhaPendente: null,
        ultima: { em: Date.now(), puxadas: r.puxadas.length, enviadas: r.enviadas.length, conflitos: r.conflitos, ...(r.backup ? { backup: r.backup } : {}) },
      });
    } catch (falha) {
      set({ erro: falha instanceof Error ? falha.message : "falha_na_conta" });
    } finally {
      set({ sincronizando: false });
    }
  },

  limparErro: () => set({ erro: "" }),
}));
