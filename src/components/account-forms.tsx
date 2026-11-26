"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Eye, EyeOff, LockKeyhole, Search } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { money } from "@/lib/format";
import { TurnstileWidget } from "./turnstile";

type Providers = { discord: boolean; twitter: boolean };
type Mode = "sign-up" | "sign-in" | "forgot" | "reset" | "resend";

export function AuthForm({
  initial,
  providers,
  token,
  oauthError,
  siteKey,
  nonce,
}: {
  initial: Mode;
  providers: Providers;
  token?: string;
  oauthError?: boolean;
  siteKey: string;
  nonce?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(initial);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(
    oauthError ? "The provider could not sign you in. Try again or use email." : "",
  );
  const [error, setError] = useState(Boolean(oauthError));
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [challenge, setChallenge] = useState(0);
  const needsCaptcha = mode !== "reset";
  const captchaOptions = { headers: { "x-captcha-response": captchaToken } };
  function restartChallenge() {
    setCaptchaToken("");
    setChallenge((count) => count + 1);
  }
  const labels: Record<Mode, string> = {
    "sign-up": "Create your account",
    "sign-in": "Sign in",
    forgot: "Recover your account",
    reset: "Set a new password",
    resend: "Resend verification",
  };

  function show(next: Mode) {
    setMode(next);
    setStatus("");
    setError(false);
    setShowPassword(false);
    restartChallenge();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (needsCaptcha && !captchaToken) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    setPending(true);
    setStatus("");
    setError(false);
    try {
      if (mode === "sign-up") {
        const result = await authClient.signUp.email({
          email,
          password,
          name: String(form.get("name")),
          callbackURL: "/account",
          fetchOptions: captchaOptions,
        });
        if (result.error) throw new Error(result.error.message || "Could not create an account.");
        setStatus("Check your email for a link to verify your account.");
      } else if (mode === "sign-in") {
        const result = await authClient.signIn.email({
          email,
          password,
          callbackURL: "/account",
          fetchOptions: captchaOptions,
        });
        if (result.error) throw new Error(result.error.message || "Sign-in failed.");
        router.push("/account");
        router.refresh();
      } else if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: "/reset-password",
          fetchOptions: captchaOptions,
        });
        if (result.error) throw new Error(result.error.message || "Could not request a reset.");
        setStatus("If that address has an account, you’ll receive a password reset link.");
      } else if (mode === "resend") {
        const result = await authClient.sendVerificationEmail({
          email,
          callbackURL: "/account",
          fetchOptions: captchaOptions,
        });
        if (result.error && result.error.status !== 400)
          throw new Error(result.error.message || "Could not send verification.");
        setStatus("If verification is pending, you’ll receive a new link.");
      } else {
        if (!token) throw new Error("This reset link is unavailable. Request a new one.");
        const result = await authClient.resetPassword({ token, newPassword: password });
        if (result.error) throw new Error(result.error.message || "Could not reset the password.");
        setMode("sign-in");
        setStatus("Password updated. You can sign in.");
      }
    } catch (caught) {
      setError(true);
      setStatus(caught instanceof Error ? caught.message : "Try again shortly.");
    } finally {
      setPending(false);
      if (needsCaptcha) restartChallenge();
    }
  }
  async function social(provider: "discord" | "twitter") {
    if (!captchaToken) return;
    setPending(true);
    setStatus("");
    setError(false);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: "/account",
        errorCallbackURL: "/join?oauth=error",
        fetchOptions: captchaOptions,
      });
      if (result.error) throw new Error(result.error.message || "Provider sign-in failed.");
    } catch (caught) {
      setError(true);
      setStatus((caught as Error).message);
      setPending(false);
      restartChallenge();
    }
  }
  return (
    <div className="panel form-panel form-stack">
      <h2>{labels[mode]}</h2>
      <form className="form-stack" onSubmit={submit} key={mode}>
        {mode === "sign-up" && (
          <label className="field">
            Display name
            <input
              name="name"
              placeholder="Your display name"
              autoComplete="name"
              required
              minLength={2}
              maxLength={60}
            />
          </label>
        )}
        {mode !== "reset" && (
          <label className="field">
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              name="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="you@example.com"
            />
          </label>
        )}
        {["sign-in", "sign-up", "reset"].includes(mode) && (
          <div className="field">
            <label htmlFor="account-password">Password</label>
            <div className="password-field">
              <input
                id="account-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                minLength={mode === "sign-in" ? undefined : 12}
                maxLength={128}
                required
                placeholder={mode === "sign-in" ? "Your password" : "At least 12 characters"}
              />
              <button
                className="password-toggle"
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-controls="account-password"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        )}
        {needsCaptcha && (
          <TurnstileWidget
            key={`${mode}-${challenge}`}
            siteKey={siteKey}
            nonce={nonce}
            action={mode}
            onToken={setCaptchaToken}
          />
        )}
        <button
          disabled={pending || (needsCaptcha && !captchaToken)}
          className="button primary"
          type="submit"
        >
          {pending ? "Working…" : labels[mode]}
          <ArrowUpRight size={16} />
        </button>
      </form>
      {status && (
        <p role={error ? "alert" : "status"} className={error ? "alert" : "form-status"}>
          {status}
        </p>
      )}
      {["sign-in", "sign-up"].includes(mode) && (providers.discord || providers.twitter) && (
        <div className="form-actions">
          {providers.discord && (
            <button
              type="button"
              className="button"
              disabled={pending || !captchaToken}
              onClick={() => social("discord")}
            >
              Continue with Discord
            </button>
          )}
          {providers.twitter && (
            <button
              type="button"
              className="button"
              disabled={pending || !captchaToken}
              onClick={() => social("twitter")}
            >
              Continue with X
            </button>
          )}
        </div>
      )}
      <div className="form-actions">
        {mode !== "sign-in" && (
          <button type="button" className="link-button" onClick={() => show("sign-in")}>
            Sign in
          </button>
        )}
        {mode !== "sign-up" && (
          <button type="button" className="link-button" onClick={() => show("sign-up")}>
            Create account
          </button>
        )}
        {mode === "sign-in" && (
          <>
            <button type="button" className="link-button" onClick={() => show("forgot")}>
              Forgot password
            </button>
            <button type="button" className="link-button" onClick={() => show("resend")}>
              Resend verification
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type PublicProfile = {
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar: string | null;
  x_handle: string | null;
  discord_handle: string | null;
};
export function ProfileForm({
  profile,
  defaultName,
  defaultAvatar,
}: {
  profile?: PublicProfile;
  defaultName: string;
  defaultAvatar: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setError(false);
    setPending(true);
    try {
      const result = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error);
      setStatus("Profile saved.");
      router.refresh();
    } catch (e) {
      setError(true);
      setStatus((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="panel form-panel form-stack" onSubmit={save}>
      <div>
        <h2>{profile ? "Edit public profile" : "Set up your player profile"}</h2>
        <p className="muted">These details can appear on your public profile.</p>
      </div>
      <label className="field">
        Username
        <input
          name="username"
          defaultValue={profile?.username}
          pattern="[A-Za-z0-9_]{3,24}"
          required
          minLength={3}
          maxLength={24}
          autoComplete="username"
          placeholder="biotech_picker"
        />
      </label>
      <label className="field">
        Display name
        <input name="displayName" defaultValue={profile?.display_name ?? defaultName} maxLength={60} />
      </label>
      <label className="field">
        Bio
        <textarea name="bio" defaultValue={profile?.bio ?? ""} maxLength={300} />
      </label>
      <label className="field">
        Avatar image URL
        <input
          name="avatar"
          type="url"
          defaultValue={profile?.avatar ?? defaultAvatar}
          maxLength={512}
          placeholder="https://…"
        />
      </label>
      <label className="field">
        X username
        <input name="x" defaultValue={profile?.x_handle ?? ""} maxLength={15} />
      </label>
      <label className="field">
        Discord username
        <input name="discord" defaultValue={profile?.discord_handle ?? ""} maxLength={32} />
      </label>
      <button type="submit" className="button primary" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
        <Check size={16} />
      </button>
      {status && (
        <p role={error ? "alert" : "status"} className={error ? "alert" : "form-status"}>
          {status}
        </p>
      )}
    </form>
  );
}

type Stock = {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  industry: string | null;
  market_cap: string | null;
  eligible: boolean;
  price: string | null;
};
export function PickForm({
  year,
  entry,
  official,
}: {
  year: number;
  entry: { symbol: string; company: string } | null;
  official: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Stock[]>([]);
  const [stock, setStock] = useState<Stock | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState("");
  const [searched, setSearched] = useState(false);
  useEffect(() => {
    const query = search.trim();
    if (query.length < 1) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setSearched(false);
      try {
        const response = await fetch(`/api/securities?q=${encodeURIComponent(query)}`, {
          signal: abort.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setResults(data.securities);
        setSearched(true);
      } catch (e) {
        if (!abort.signal.aborted) {
          setError(true);
          setStatus((e as Error).message);
        }
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [search]);
  async function submit(securityId: string | null) {
    setSaving(true);
    setStatus("");
    setError(false);
    try {
      const response = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, securityId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStatus(
        securityId === null ? "Your entry was withdrawn." : `Your pick is saved: ${data.entry.symbol}.`,
      );
      setSearch("");
      setStock(null);
      setResults([]);
      router.refresh();
    } catch (e) {
      setError(true);
      setStatus((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel form-panel form-stack">
      <h2>Choose your {year} stock</h2>
      <p className="muted">
        <LockKeyhole size={14} /> Only you can see your selection until picks lock.
      </p>
      {entry && (
        <div className="notice">
          Current pick <strong>{entry.symbol}</strong> · {entry.company}
        </div>
      )}
      <label className="field">
        Search by ticker or company
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSearched(false);
            setResults([]);
            setStock(null);
            setStatus("");
            setLoading(Boolean(e.target.value));
          }}
          placeholder="Search stocks"
          maxLength={60}
        />
      </label>
      {search && loading && (
        <p className="muted" role="status">
          <Search size={14} /> Searching securities…
        </p>
      )}
      {search && searched && !results.length && (
        <p className="muted">No verified securities match this search.</p>
      )}
      {search && results.length > 0 && (
        <div className="results-list" aria-label="Search results">
          {results.map((result) => (
            <button
              type="button"
              className="security-option"
              key={result.id}
              disabled={!result.eligible}
              aria-pressed={stock?.id === result.id}
              onClick={() => setStock(result)}
            >
              <span>
                <strong>{result.symbol}</strong> · {result.name}
                <small>
                  {result.exchange} · {result.industry ?? "Industry not available"}
                </small>
                {result.market_cap && <small>Market cap {money(result.market_cap)}</small>}
              </span>
              <span>
                {result.eligible
                  ? official && result.price
                    ? money(result.price)
                    : "Eligible"
                  : "Ineligible"}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="button primary"
          disabled={!stock || saving}
          onClick={() => stock && submit(stock.id)}
        >
          {saving ? "Saving…" : "Save pick"}
        </button>
        {entry && (
          <button type="button" className="button" disabled={saving} onClick={() => submit(null)}>
            Withdraw pick
          </button>
        )}
      </div>
      {status && (
        <p role={error ? "alert" : "status"} className={error ? "alert" : "form-status"}>
          {status}
        </p>
      )}
    </section>
  );
}
export function AccountActions({
  providers,
  email,
  canVerify,
  siteKey,
  nonce,
}: {
  providers: Providers;
  email: string;
  canVerify: boolean;
  siteKey: string;
  nonce?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [verifyToken, setVerifyToken] = useState("");
  const [verifyChallenge, setVerifyChallenge] = useState(0);
  const [pending, setPending] = useState(false);
  async function action(mode: "logout" | "discord" | "twitter" | "verify" | "delete") {
    setPending(true);
    setStatus("");
    try {
      if (mode === "logout") {
        const result = await authClient.signOut();
        if (result.error) throw new Error(result.error.message);
        router.push("/");
        router.refresh();
      } else if (mode === "discord" || mode === "twitter") {
        const result = await authClient.linkSocial({
          provider: mode,
          callbackURL: "/account",
          errorCallbackURL: "/account",
        });
        if (result.error) throw new Error(result.error.message);
      } else if (mode === "verify") {
        const result = await authClient.sendVerificationEmail({
          email,
          callbackURL: "/account",
          fetchOptions: { headers: { "x-captcha-response": verifyToken } },
        });
        if (result.error) throw new Error(result.error.message);
        setStatus("Check your email for a verification link.");
      } else {
        const result = await authClient.deleteUser({ callbackURL: "/" });
        if (result.error) throw new Error(result.error.message);
        setStatus("Check your email to confirm account deletion.");
      }
    } catch (e) {
      setStatus((e as Error).message || "This action could not be completed.");
    } finally {
      setPending(false);
      if (mode === "verify") {
        setVerifyToken("");
        setVerifyChallenge((count) => count + 1);
      }
    }
  }
  return (
    <div className="panel form-panel form-stack">
      <h2>Account settings</h2>
      <p className="muted">{email}</p>
      {canVerify && (
        <TurnstileWidget
          key={verifyChallenge}
          siteKey={siteKey}
          nonce={nonce}
          action="resend"
          onToken={setVerifyToken}
        />
      )}
      <div className="form-actions">
        {canVerify && (
          <button
            className="button primary"
            disabled={pending || !verifyToken}
            onClick={() => action("verify")}
          >
            Verify email
          </button>
        )}
        {providers.discord && (
          <button className="button" disabled={pending} onClick={() => action("discord")}>
            Link Discord
          </button>
        )}
        {providers.twitter && (
          <button className="button" disabled={pending} onClick={() => action("twitter")}>
            Link X
          </button>
        )}
        <button className="button" disabled={pending} onClick={() => action("logout")}>
          Sign out
        </button>
        <button className="button" disabled={pending} onClick={() => setConfirm(!confirm)}>
          Delete account
        </button>
      </div>
      {confirm && (
        <div className="notice">
          <p>Your profile will be removed and historical picks will be anonymized.</p>
          <button className="link-button negative" disabled={pending} onClick={() => action("delete")}>
            Send deletion confirmation
          </button>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      <Link className="text-link" href="/rules">
        Competition rules
      </Link>
    </div>
  );
}
