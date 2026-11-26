"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Option = { value: string; label: string };
type Field = {
  name: string;
  label: string;
  type?: string;
  options?: Option[];
  defaultValue?: string;
  required?: boolean;
};
export function AdminForm({
  action,
  title,
  fields,
  fixed = {},
  label = "Save change",
}: {
  action: string;
  title: string;
  fields: Field[];
  fixed?: Record<string, unknown>;
  label?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setError(false);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const data: Record<string, unknown> = { action, ...fixed };
      for (const field of fields) {
        const value = String(form.get(field.name) ?? "").trim();
        if (field.type === "checkbox") data[field.name] = form.has(field.name);
        else if (field.type === "number") data[field.name] = Number(value);
        else if (field.type === "boolean") data[field.name] = value === "true";
        else if (field.type === "sections") data[field.name] = JSON.parse(value);
        else if (value) data[field.name] = value;
      }
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setStatus(result.message);
      router.refresh();
    } catch (e) {
      setError(true);
      setStatus((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <details className="panel page-panel admin-form">
      <summary>{title}</summary>
      <form className="form-stack" onSubmit={submit}>
        {fields.map((field) => (
          <label className="field" key={field.name}>
            {field.label}
            {field.options ? (
              <select name={field.name} defaultValue={field.defaultValue ?? ""} required={field.required}>
                {field.defaultValue === undefined && (
                  <option value="">{field.required ? "Choose…" : "None"}</option>
                )}
                {field.options.map(({ value, label }) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : field.type === "sections" ? (
              <textarea name={field.name} defaultValue={field.defaultValue} required={field.required} />
            ) : (
              <input
                name={field.name}
                type={field.type ?? "text"}
                defaultValue={field.defaultValue}
                required={field.required}
                maxLength={field.type === "text" ? 400 : undefined}
              />
            )}
          </label>
        ))}
        <button className="button primary" disabled={pending}>
          {pending ? "Saving…" : label}
        </button>
        {status && (
          <p role={error ? "alert" : "status"} className={error ? "alert" : "form-status"}>
            {status}
          </p>
        )}
      </form>
    </details>
  );
}
