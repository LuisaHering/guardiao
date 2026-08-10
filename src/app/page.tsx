export default function Home() {
  const papeis = ["Idoso", "Cuidador", "Familiar"];

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex max-w-xl flex-col items-center gap-6 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          MVP · Semana 1 · em construção
        </span>

        <span aria-hidden className="text-primary">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </span>

        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Guardião</h1>

        <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Um defensor digital para a velhice: coordenação de cuidado do idoso
          com apoio de IA, preservando dignidade, preferências e vontade.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {papeis.map((papel) => (
            <span
              key={papel}
              className="rounded-full border border-black/[.08] px-3 py-1 text-sm text-zinc-700 dark:border-white/[.12] dark:text-zinc-300"
            >
              {papel}
            </span>
          ))}
        </div>
      </div>

      <footer className="mt-16 text-sm text-zinc-500">
        Projeto de Extensão · INFNET · Eng. de Software
      </footer>
    </main>
  );
}
