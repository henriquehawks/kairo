import type { PersistStorage, StorageValue } from "zustand/middleware";
import { apagarChave, chave, gravarChave, lerChave } from "../ponte/armazenamento";
import { NOME_DA_MAQUINA, dividir, juntar } from "./divisaoDaMaquina";

type Objeto = Record<string, unknown>;

function lerEnvelope(nome: string): StorageValue<Objeto> | null {
  const bruto = lerChave(nome);
  if (bruto === null) return null;
  try {
    const salvo: unknown = JSON.parse(bruto);
    if (typeof salvo !== "object" || salvo === null || !("state" in salvo)) return null;
    return salvo as StorageValue<Objeto>;
  } catch {
    // Guardado corrompido é entrada inválida, não motivo para derrubar a abertura do app.
    return null;
  }
}

/**
 * Guarda a configuração em duas chaves: `niko:configuracoes`, que é da pessoa e um dia
 * viaja entre máquinas, e `niko:maquina`, que fica aqui. Quem lê o estado não percebe:
 * a leitura junta as duas de volta num objeto só.
 */
export function armazenamentoDaConfiguracao<T>(): PersistStorage<T> {
  return {
    getItem: (nome) => {
      const conta = lerEnvelope(nome);
      if (!conta) return null;
      const maquina = lerEnvelope(chave(NOME_DA_MAQUINA));
      const estado = maquina && typeof maquina.state === "object" && maquina.state !== null ? (maquina.state as Objeto) : null;
      return { ...conta, state: juntar(conta.state, estado) as T };
    },
    setItem: (nome, valor) => {
      const { conta, maquina } = dividir(valor.state as Objeto);
      gravarChave(nome, JSON.stringify({ ...valor, state: conta }));
      gravarChave(chave(NOME_DA_MAQUINA), JSON.stringify({ state: maquina }));
    },
    removeItem: (nome) => {
      apagarChave(nome);
      apagarChave(chave(NOME_DA_MAQUINA));
    },
  };
}
