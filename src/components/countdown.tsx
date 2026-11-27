"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
export function Countdown({ deadline, label }: { deadline: string; label: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.floor((Date.parse(deadline) - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  if (remaining === 0)
    return (
      <span className="countdown">
        <Clock3 size={15} />
        {label}
      </span>
    );
  return (
    <span className="countdown">
      <Clock3 size={15} />
      <span>{label}</span>
      <span className="countdown-time">
        {remaining === null
          ? "—"
          : `${Math.floor(remaining / 86400)}d ${Math.floor(remaining / 3600) % 24}h ${Math.floor(remaining / 60) % 60}m`}
      </span>
    </span>
  );
}
