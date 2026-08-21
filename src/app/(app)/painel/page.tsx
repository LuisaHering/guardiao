import { Badge, Button, Card } from "@/components/ui";

const stats = [
  { label: "Adesão (7 dias)", value: "92%", tone: "success" as const, hint: "sem registro há 0 dias" },
  { label: "Humor da semana", value: "estável", tone: "primary" as const, hint: "3 registros" },
  { label: "Próxima consulta", value: "12 ago", tone: "neutral" as const, hint: "cardiologista" },
];

export default function PainelPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Painel</h1>
          <p className="text-sm text-subtle">Visão geral do cuidado do idoso</p>
        </div>
        <Button variant="primary">Nova entrada</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="flex flex-col gap-2">
            <span className="text-xs text-subtle">{s.label}</span>
            <span className="text-2xl font-semibold text-ink">{s.value}</span>
            <Badge tone={s.tone}>{s.hint}</Badge>
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-medium text-ink">Design system</h2>
          <p className="text-xs text-subtle">
            Base visual do projeto. As telas dos próximos cards reaproveitam
            estes componentes e tokens.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primário</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">neutro</Badge>
          <Badge tone="primary">primário</Badge>
          <Badge tone="success">ok</Badge>
          <Badge tone="warn">atenção</Badge>
        </div>
      </Card>
    </div>
  );
}
