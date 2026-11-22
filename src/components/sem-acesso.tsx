import { Card } from "@/components/ui";

/** Mostrado quando o papel de quem abriu a tela não deve ver este conteúdo. */
export function SemAcesso({ area }: { area: string }) {
  return (
    <Card className="mx-auto max-w-md">
      <p className="text-sm font-medium text-ink">{area} é uma área do familiar.</p>
      <p className="mt-1 text-sm text-subtle">
        Quem cuida no dia a dia recebe o que muda o que fazer amanhã (medicação, diário,
        alertas e a folha de cuidado). A leitura clínica fica com o familiar.
      </p>
    </Card>
  );
}
