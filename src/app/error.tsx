"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="page">
      <div className="page-heading">
        <h1>Temporarily unavailable</h1>
        <p className="muted">The competition could not load this page.</p>
      </div>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
