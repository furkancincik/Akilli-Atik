import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card empty-state">
      <div className="icon-box">
        <Icon size={28} aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      <span className="status">Sonraki aşamada</span>
    </section>
  );
}
