export function movimentoDaVisibilidade(oculta: boolean, reduzirAnimacoes: boolean, paraCima = true) {
  const recuo = paraCima ? -12 : 12;
  return {
    animate: { opacity: oculta ? 0 : 1, y: oculta && !reduzirAnimacoes ? recuo : 0 },
    transition: { duration: reduzirAnimacoes ? 0.1 : 0.34, ease: [0.45, 0, 0.2, 1] as [number, number, number, number] },
  };
}
