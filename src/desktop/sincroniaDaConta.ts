import { useEffect } from "react";
import { ESPERA_APOS_FOCO_MS, INTERVALO_DA_SINCRONIA_MS, useConta } from "../estado/conta";

/**
 * Dispara as sincronizações automáticas.
 *
 * Monta só na janela do sistema. A ilha, o dock e o AtalhoTouch compartilham o mesmo
 * banco: se as quatro sincronizassem, seriam quatro rodadas simultâneas disputando as
 * mesmas chaves, e o resultado dependeria de quem chegasse por último.
 *
 * Nada aqui bloqueia a interface. Sem conta, sem internet ou com o cofre fechado, a
 * rodada volta sem fazer nada e o app segue local, como sempre foi.
 */
export function usarSincroniaDaConta() {
  useEffect(() => {
    let vivo = true;
    let aposFoco = 0;

    const rodar = () => {
      if (vivo) void useConta.getState().sincronizar();
    };

    void useConta.getState().carregar().then(rodar);

    const aoFocar = () => {
      window.clearTimeout(aposFoco);
      // Pequena espera: voltar para o app costuma vir acompanhado de outras ações.
      aposFoco = window.setTimeout(rodar, ESPERA_APOS_FOCO_MS);
    };
    const aoVoltarAVista = () => {
      if (document.visibilityState === "visible") aoFocar();
    };

    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoVoltarAVista);
    const relogio = window.setInterval(rodar, INTERVALO_DA_SINCRONIA_MS);

    return () => {
      vivo = false;
      window.clearTimeout(aposFoco);
      window.clearInterval(relogio);
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoVoltarAVista);
    };
  }, []);
}
