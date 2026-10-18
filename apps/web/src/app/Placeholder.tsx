/** Temporary screen for routes owned by later batches (B12–B15 replace these in router.tsx). */
export function Placeholder({ name }: { name: string }) {
  return (
    <div className="body" style={{ alignItems: "center", justifyContent: "center" }} data-testid={`placeholder-${name}`}>
      <p className="cap">{name}</p>
    </div>
  );
}
