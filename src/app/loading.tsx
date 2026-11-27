export default function Loading() {
  return (
    <div className="page" role="status" aria-label="Loading competition">
      <div className="panel skeleton-banner" />
      <div className="metrics-grid chart-group">
        {[0, 1, 2, 3].map((key) => (
          <div className="panel skeleton-metric" key={key} />
        ))}
      </div>
    </div>
  );
}
