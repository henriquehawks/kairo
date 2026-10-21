import { useEffect } from "react";
import { useConfig } from "../estado/configuracoes";
import { useAgentes } from "../estado/agentes";
import { useConquistas } from "../estado/conquistas";
import { useComunicacao } from "../estado/comunicacao";
import { useRotina } from "../estado/rotina";
import { useFinancas } from "../estado/financas";
import { usePomodoro } from "../estado/pomodoro";
import { useEstudos } from "../estado/estudos";
import { useOrganizacao } from "../estado/organizacao";
import { useEscritorioIas } from "../estado/escritorioIas";
import { aoMudarDeFora, chave } from "../ponte/armazenamento";
import { NOME_DA_MAQUINA } from "../estado/divisaoDaMaquina";

const LOJAS: Record<string, { persist: { rehydrate: () => Promise<void> | void } }> = {
  [chave("configuracoes")]: useConfig,
  // A configuração mora em duas chaves; mudar a da máquina também precisa reidratar.
  [chave(NOME_DA_MAQUINA)]: useConfig,
  [chave("agentes")]: useAgentes,
  [chave("conquistas")]: useConquistas,
  [chave("comunicacao")]: useComunicacao,
  [chave("rotina")]: useRotina,
  [chave("financas")]: useFinancas,
  [chave("pomodoro")]: usePomodoro,
  [chave("estudos")]: useEstudos,
  [chave("organizacao")]: useOrganizacao,
  [chave("escritorio-ias")]: useEscritorioIas,
};

export function usarSincronia() {
  useEffect(
    () =>
      aoMudarDeFora((nome) => {
        const loja = LOJAS[nome];
        if (loja) void loja.persist.rehydrate();
      }),
    [],
  );
}
