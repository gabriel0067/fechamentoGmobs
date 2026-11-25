"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error("Falha ao exibir a tela do GMOBS.", error);
  }, [error]);

  return (
    <main className="access-shell">
      <section className="access-card error" role="alert">
        <div className="access-mark">GM</div>
        <small>FECHAMENTOS GMOBS</small>
        <h1>Não foi possível abrir esta tela</h1>
        <p>Tente abrir novamente. Caso o problema continue, atualize a página e entre no sistema.</p>
        <button type="button" className="primary" onClick={reset}>Tentar novamente</button>
      </section>
    </main>
  );
}
