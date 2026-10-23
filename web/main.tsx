import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Phone,
  Inbox,
  Settings as SettingsIcon,
  ShieldCheck,
  ArrowUpRight,
  ChevronRight,
  ChevronDown,
  Check,
  CheckCheck,
  AlertTriangle,
  X,
  Search,
  LogOut,
  Plus,
  Clock,
  MapPin,
  Building2,
  User,
  FlaskConical,
  LoaderCircle,
  PhoneIncoming,
  LockKeyhole,
  CheckCircle2,
  MinusCircle,
  SlidersHorizontal,
} from "lucide-react";
import type { Settings } from "../src/config.js";
import type { Intake } from "../src/db.js";
import "./styles.css";
type Delivery = {
  recipient: number;
  kind: string;
  state: string;
  error: string | null;
  segments: number;
  attempts: number;
};
type Call = {
  id: string;
  caller: string | null;
  created: number;
  status: "New" | "Contacted" | "Closed";
  outcome: string;
  consent: string;
  intake: Intake;
  summary: string;
  finalized: number;
  deliveries: Delivery[];
};
type Session = {
  user: { email: string } | null;
  csrf: string;
  mode: "demo" | "live";
};
type Health = {
  mode: string;
  credentials: { name: string; status: string; present: boolean }[];
  database: string;
  recipients: { name: string; configured: boolean; optedIn: boolean }[];
  fallback: string;
  registration: string;
  lastTest: string | null;
  notificationIssues: number;
  budgetAvailable: boolean;
  reconciliation: string | null;
  backup: string | null;
  backupConfigured: boolean;
};
let csrf = "";
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Unable to connect. Please retry.");
  return data as T;
}
const localTime = (date: number) =>
  new Date(date).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
const localDate = (date: number) =>
  new Date(date).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  });
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
function App() {
  const [demoOpen, setDemoOpen] = useState(false),
    [session, setSession] = useState<Session | null>(null),
    [page, setPage] = useState("Inbox"),
    [calls, setCalls] = useState<Call[]>([]),
    [settings, setSettings] = useState<Settings | null>(null),
    [health, setHealth] = useState<Health | null>(null),
    [selected, setSelected] = useState<Call | null>(null),
    [filter, setFilter] = useState("New"),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  async function refresh() {
    const [c, s, h] = await Promise.all([
      api<{ calls: Call[] }>("calls"),
      api<Settings>("settings"),
      api<Health>("health"),
    ]);
    setCalls(c.calls);
    setSettings(s);
    setHealth(h);
    setSelected((old) =>
      old ? c.calls.find((x) => x.id === old.id) || null : null,
    );
    return c.calls;
  }
  useEffect(() => {
    void api<Session>("session")
      .then(async (s) => {
        csrf = s.csrf;
        setSession(s);
        if (s.user) {
          const c = await refresh();
          const id = new URLSearchParams(location.search).get("call");
          if (id) setSelected(c.find((x) => x.id === id) || null);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!session?.user) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [session?.user]);
  async function run(action: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function login(demo = false) {
    await run(async () => {
      const s = await api<{ user: { email: string }; csrf: string }>(
        demo ? "demo-login" : "login",
        "POST",
        demo ? {} : { email, password },
      );
      csrf = s.csrf;
      setSession((old) => ({ ...old!, user: s.user, csrf: s.csrf }));
      await refresh();
    });
  }
  async function status(call: Call, value: Call["status"]) {
    await run(async () => {
      await api("calls/" + call.id, "PATCH", { status: value });
      await refresh();
      setNotice(`Call marked ${value.toLowerCase()}.`);
    });
  }
  async function demo(scenario = "complete") {
    await run(async () => {
      const r = await api<{ id: string }>("demo-intake", "POST", { scenario });
      const c = await refresh();
      setFilter("New");
      setPage("Inbox");
      setSelected(c.find((x) => x.id === r.id) || null);
      setNotice(
        "Demo intake captured. Both notification results are simulated.",
      );
    });
  }
  if (loading)
    return (
      <div className="splash">
        <LoaderCircle className="spin" />
        <p>Opening your call desk…</p>
      </div>
    );
  if (!session?.user)
    return (
      <main className="login">
        <div className="login-brand">
          <Brand />
          <span>LEADING PLUMBING SERVICES LLC</span>
        </div>
        <div className="login-card">
          <div className="eyebrow">A CLEARER DAY STARTS HERE</div>
          <h1>
            Your calls.
            <br />
            Taken care of.
          </h1>
          <p>
            One quiet place to see who called,
            <br />
            what they need, and who to call back.
          </p>
          {error && (
            <div role="alert" className="message error">
              {error}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void login();
            }}
          >
            <label>
              Email address
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="primary full" disabled={busy}>
              Sign in <ArrowUpRight size={17} />
            </button>
          </form>
          {session?.mode === "demo" && (
            <>
              <div className="or">FREE LOCAL DEMO</div>
              <button
                className="secondary full"
                disabled={busy}
                onClick={() => void login(true)}
              >
                <FlaskConical size={17} />
                Explore demo workspace
              </button>
              <small>
                Fictional calls. Simulated SMS. No credentials needed.
              </small>
            </>
          )}
          <div className="login-lock">
            <LockKeyhole size={14} /> Private access for your two owners
          </div>
        </div>
        <footer>Good service begins with listening.</footer>
      </main>
    );
  const visible = calls.filter(
    (c) =>
      (filter === "All" || c.status === filter) &&
      `${c.intake.name || ""} ${c.intake.city || ""} ${c.intake.problem || ""} ${c.intake.callback || c.caller || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {[
            { name: "Inbox", icon: Inbox },
            { name: "Settings", icon: SettingsIcon },
            { name: "Setup & Health", icon: ShieldCheck },
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={page === name ? "nav-item active" : "nav-item"}
              onClick={() => {
                setPage(name);
                setError("");
                setNotice("");
              }}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === "Inbox" && (
                <span className="nav-count">
                  {calls.filter((c) => c.status === "New").length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-icon">
            <PhoneIncoming size={20} />
          </div>
          <strong>A little peace of mind.</strong>
          <p>
            Every captured call has a place.
            <br />
            One callback at a time.
          </p>
        </div>
        <div className="sidebar-bottom">
          <div className="avatar">LP</div>
          <div>
            <strong>Leading Plumbing</strong>
            <span>South Florida</span>
          </div>
          <button
            aria-label="Sign out"
            title="Sign out"
            onClick={() =>
              void run(async () => {
                await api("logout", "POST", {});
                location.reload();
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span
              className={
                "mode-dot " +
                (session.mode === "demo" ? "demo-dot" : "live-dot")
              }
            />
            <strong>
              {session.mode === "demo" ? "Demo workspace" : "Live workspace"}
            </strong>
            <span className="topbar-divider" />
            <span>Eastern time</span>
            <div className="avatar small">LP</div>
          </div>
        </header>
        {session.mode === "demo" && (
          <div className="demo-banner">
            <FlaskConical size={16} />
            <span>
              <strong>You’re in demo mode.</strong> Calls and text deliveries
              are simulated. No real messages are sent.
            </span>
            <span className="demo-pill">NO PAID SERVICES</span>
          </div>
        )}
        <main className="main-content">
          {error && (
            <div role="alert" className="message error">
              <AlertTriangle size={18} />
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="message success">
              <CheckCircle2 size={18} />
              {notice}
              <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {page === "Inbox" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    YOUR NEXT CONVERSATION STARTS HERE
                  </div>
                  <h1>
                    Call inbox<span className="heading-dot">.</span>
                  </h1>
                  <p>The details you need. The people to call back.</p>
                </div>
                {session.mode === "demo" && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => setDemoOpen(true)}
                  >
                    <Plus size={17} /> Try a demo call
                  </button>
                )}
              </div>
              <div className="inbox-summary">
                <div className="summary-icon">
                  <PhoneIncoming size={22} />
                </div>
                <div>
                  <strong>
                    {calls.filter((c) => c.status === "New").length} calls need
                    a follow-up
                  </strong>
                  <span>
                    Start with urgent requests, then work your way down.
                  </span>
                </div>
                <span className="quiet-label">
                  <LockKeyhole size={13} /> ONLY YOUR TEAM
                </span>
              </div>
              <section className="inbox-card" aria-label="Calls">
                <div className="list-toolbar">
                  <div className="tabs" aria-label="Callback status">
                    {["New", "Contacted", "Closed", "All"].map((f) => (
                      <button
                        key={f}
                        className={f === filter ? "tab selected" : "tab"}
                        aria-pressed={f === filter}
                        onClick={() => setFilter(f)}
                      >
                        {f}
                        {f === "New" && (
                          <span>
                            {calls.filter((c) => c.status === "New").length}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="Search calls"
                      placeholder="Search calls…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
                <div className="list-labels">
                  <span>CALLER & REQUEST</span>
                  <span>RECEIVED</span>
                  <span>STATUS</span>
                </div>
                {visible.length ? (
                  visible.map((c) => (
                    <button
                      className="call-row"
                      key={c.id}
                      onClick={() => setSelected(c)}
                    >
                      <div
                        className={
                          "caller-icon " +
                          (c.intake.urgency === "Urgent" ||
                          c.intake.urgency === "Immediate danger"
                            ? "urgent-icon"
                            : "")
                        }
                      >
                        <Phone size={18} />
                      </div>
                      <div className="call-main">
                        <div className="caller-title">
                          <strong>{c.intake.name || "Unknown caller"}</strong>
                          {["Urgent", "Immediate danger"].includes(
                            c.intake.urgency || "",
                          ) && (
                            <Badge tone="urgent">
                              <AlertTriangle size={11} />
                              {c.intake.urgency}
                            </Badge>
                          )}
                          {c.outcome.includes("abandoned") || !c.intake.name ? (
                            <Badge tone="partial">Partial intake</Badge>
                          ) : null}
                        </div>
                        <div className="call-subline">
                          {c.intake.callbackConfirmed
                            ? c.intake.callback
                            : c.caller || "Number unavailable"}
                          <span>·</span>
                          {c.intake.city || "City not captured"}
                        </div>
                        <p>
                          {c.intake.problem ||
                            "No problem details captured. A callback may still be needed."}
                        </p>
                        <span className="call-property">
                          {c.intake.property || "Property unknown"}
                          {c.intake.preferredTime && (
                            <>
                              {" "}
                              <span>·</span> Callback: {c.intake.preferredTime}
                            </>
                          )}
                        </span>
                      </div>
                      <div className="call-time">
                        <strong>{localTime(c.created)}</strong>
                        <span>{localDate(c.created)}</span>
                      </div>
                      <div className="call-status">
                        <Badge
                          tone={
                            c.status === "New"
                              ? "new"
                              : c.status === "Closed"
                                ? "closed"
                                : "contacted"
                          }
                        >
                          {c.status === "Contacted" && <Check size={11} />}{" "}
                          {c.status}
                        </Badge>
                        <ChevronRight size={17} />
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="empty">
                    <Inbox size={30} />
                    <h3>{query ? "No matching calls" : "All clear here"}</h3>
                    <p>
                      {query
                        ? "Try a name, phone number, or city."
                        : "Calls in this state will appear here."}
                    </p>
                  </div>
                )}
                <div className="list-footer">
                  <span>
                    {visible.length} {visible.length === 1 ? "call" : "calls"}
                    {filter !== "All" ? ` · ${filter.toLowerCase()}` : ""}
                  </span>
                  <span>
                    Captured details stay private <ShieldCheck size={14} />
                  </span>
                </div>
              </section>
              <div className="below-note">
                <CheckCircle2 size={16} />
                <p>
                  Make the call. Mark it contacted. Get back to what you do
                  best.
                </p>
              </div>
              <div className="inbox-foot">
                <span>LEADING PLUMBING SERVICES LLC</span>
                <span>Thoughtful follow-up. Better service.</span>
              </div>
            </>
          )}
          {page === "Settings" && settings && (
            <SettingsPage
              value={settings}
              busy={busy}
              live={session.mode === "live"}
              onSave={(value) =>
                void run(async () => {
                  const s = await api<Settings>("settings", "PUT", value);
                  setSettings(s);
                  await refresh();
                  setNotice(
                    "Settings saved. Carrier forwarding must be changed with your carrier.",
                  );
                })
              }
            />
          )}
          {page === "Setup & Health" && health && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">A FEW THINGS, WORKING TOGETHER</div>
                  <h1>
                    Setup & health<span className="heading-dot">.</span>
                  </h1>
                  <p>
                    Know what’s configured, what’s tested, and what needs a
                    look.
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await refresh();
                      setNotice("Health checks refreshed.");
                    })
                  }
                >
                  Refresh checks
                </button>
              </div>
              <div className="section-card">
                <div className="section-heading">
                  <ShieldCheck size={20} />
                  <div>
                    <h2>Readiness checklist</h2>
                    <p>Configured does not mean tested.</p>
                  </div>
                  <Badge tone={session.mode === "demo" ? "partial" : "new"}>
                    {session.mode === "demo"
                      ? "Simulation only"
                      : "Live verification required"}
                  </Badge>
                </div>
                <HealthRow
                  title="Call database"
                  detail={health.database}
                  ok={health.database.startsWith("Writable")}
                />
                <HealthRow
                  title="Two internal alert recipients"
                  detail={
                    health.recipients.every((r) => r.configured && r.optedIn)
                      ? "Both configured with recorded opt-in"
                      : "Add two numbers and record each recipient’s opt-in in Settings"
                  }
                  ok={health.recipients.every((r) => r.configured && r.optedIn)}
                />
                <HealthRow
                  title="Independent call fallback"
                  detail={health.fallback}
                />
                <HealthRow
                  title="SMS sender registration"
                  detail={health.registration}
                />
                <HealthRow
                  title="AI minute threshold"
                  detail={
                    health.budgetAvailable
                      ? "Within the configured monthly ConversationRelay minute threshold"
                      : "New AI calls route to fallback; alerts remain active"
                  }
                  ok={health.budgetAvailable}
                />
                <HealthRow
                  title="Notification attention"
                  detail={
                    health.notificationIssues
                      ? `${health.notificationIssues} failed, blocked or ambiguous notification(s). Open call details.`
                      : "No blocked or failed notifications"
                  }
                  ok={!health.notificationIssues}
                />
                <HealthRow
                  title="Last intake / alert test"
                  detail={
                    health.lastTest
                      ? formatTest(health.lastTest)
                      : "No test recorded yet"
                  }
                />
                <details className="technical">
                  <summary>
                    Developer details <ChevronDown size={15} />
                  </summary>
                  {health.credentials.map((c) => (
                    <HealthRow key={c.name} title={c.name} detail={c.status} />
                  ))}
                  <p>
                    Off-host backup:{" "}
                    {health.backup
                      ? `Last successful upload ${new Date(Number(health.backup)).toLocaleString()}`
                      : health.backupConfigured
                        ? "Configured; successful upload not recorded"
                        : "Not configured"}
                    . A restore test is still required.
                  </p>
                  <p>
                    Provider reconciliation:{" "}
                    {health.reconciliation
                      ? new Date(Number(health.reconciliation)).toLocaleString()
                      : "Not verified"}
                    . Review DEPLOY.md before routing live callers.
                  </p>
                </details>
              </div>
              <div className="section-card test-card">
                <div>
                  <div className="eyebrow">TEST BEFORE YOU RELY ON IT</div>
                  <h2>
                    {session.mode === "demo"
                      ? "Take a practice call"
                      : "Send test alerts"}
                  </h2>
                  <p>
                    {session.mode === "demo"
                      ? "See how a complete, urgent, or abandoned call appears in your inbox. All calls and delivery results are simulated."
                      : "This sends real SMS to both opted-in numbers and costs money. Acceptance is not proof of delivery; inspect each recipient’s status."}
                  </p>
                </div>
                <div className="test-buttons">
                  {session.mode === "demo" ? (
                    <>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void demo("complete")}
                      >
                        Complete intake
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void demo("urgent")}
                      >
                        Urgent request
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void demo("abandoned")}
                      >
                        Abandoned call
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Send two REAL SMS test alerts? Carrier charges apply.",
                          )
                        )
                          void run(async () => {
                            await api("test-alerts", "POST", {
                              confirm: "SEND TWO REAL SMS",
                            });
                            await refresh();
                            setNotice(
                              "Live tests enqueued. Check each recipient’s status in the inbox.",
                            );
                          });
                      }}
                    >
                      Send two real test texts
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      {demoOpen && (
        <DemoCall
          onClose={() => {
            setDemoOpen(false);
            void refresh();
          }}
          onDone={(id) => {
            setDemoOpen(false);
            void refresh().then((c) => {
              setFilter("New");
              setPage("Inbox");
              setSelected(c.find((x) => x.id === id) || null);
            });
          }}
        />
      )}
      {selected && (
        <CallDetail
          call={selected}
          recipients={
            settings?.recipients.map((r) => r.name) || ["Owner", "Son"]
          }
          demo={session.mode === "demo"}
          busy={busy}
          onClose={() => {
            setSelected(null);
            history.replaceState(null, "", location.pathname);
          }}
          onStatus={(s) => void status(selected, s)}
          onDelete={() => {
            if (
              confirm(
                "Delete this call and its delivery records permanently? Backups retain data until expiration.",
              )
            )
              void run(async () => {
                await api("calls/" + selected.id, "DELETE");
                setSelected(null);
                await refresh();
                setNotice("Call record deleted.");
              });
          }}
        />
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Phone size={23} strokeWidth={2.3} />
        <span />
      </div>
      <div>
        <strong>
          Leading<span>Call Desk</span>
        </strong>
        <small>BY LEADING PLUMBING</small>
      </div>
    </div>
  );
}
function formatTest(raw: string) {
  try {
    const t = JSON.parse(raw);
    return `${t.mode === "demo" ? "Simulated" : "Live"} · ${new Date(t.at).toLocaleString("en-US", { timeZone: "America/New_York" })} · ${t.result}`;
  } catch {
    return "Unknown result";
  }
}
function HealthRow({
  title,
  detail,
  ok,
}: {
  title: string;
  detail: string;
  ok?: boolean;
}) {
  return (
    <div className="health-row">
      {ok ? (
        <CheckCircle2 size={19} className="green" />
      ) : (
        <MinusCircle size={19} className="muted" />
      )}
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <Badge tone={ok ? "closed" : "neutral"}>
        {ok ? "Checked" : "Review"}
      </Badge>
    </div>
  );
}
function SettingsPage({
  value,
  busy,
  live,
  onSave,
}: {
  value: Settings;
  busy: boolean;
  live: boolean;
  onSave: (s: Settings) => void;
}) {
  const [draft, setDraft] = useState<Settings>(value);
  const [fallbackText, setFallbackText] = useState(
    value.fallbackNumbers.join("\n"),
  );
  useEffect(() => {
    setDraft(value);
    setFallbackText(value.fallbackNumbers.join("\n"));
  }, [value]);
  const patch = (p: Partial<Settings>) => setDraft((s) => ({ ...s, ...p }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...draft,
          fallbackNumbers: fallbackText
            .split(/\n|,/)
            .map((x) => x.trim())
            .filter(Boolean),
        });
      }}
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">SET IT UP. KEEP IT SIMPLE.</div>
          <h1>
            Desk settings<span className="heading-dot">.</span>
          </h1>
          <p>Only the essentials for a helpful first conversation.</p>
        </div>
        <button className="primary" disabled={busy} type="submit">
          <Check size={16} />
          Save settings
        </button>
      </div>
      <section className="section-card">
        <div className="section-heading">
          <Phone size={19} />
          <div>
            <h2>Your two alert recipients</h2>
            <p>Only these two opted-in phones receive call alerts.</p>
          </div>
          <Badge tone="new">INTERNAL ONLY</Badge>
        </div>
        <div className="settings-grid">
          {draft.recipients.map((r, index) => (
            <div key={index} className="recipient-form">
              <h3>{index === 0 ? "01 / Owner" : "02 / Son"}</h3>
              <label>
                Display name
                <input
                  required
                  maxLength={40}
                  value={r.name}
                  onChange={(e) => {
                    const next = structuredClone(draft.recipients);
                    next[index].name = e.target.value;
                    patch({ recipients: next });
                  }}
                />
              </label>
              <label>
                Alert phone number
                <input
                  type="tel"
                  placeholder="+1…"
                  value={r.phone}
                  onChange={(e) => {
                    const next = structuredClone(draft.recipients);
                    next[index].phone = e.target.value;
                    next[index].optedIn = false;
                    patch({ recipients: next });
                  }}
                />
                <small>Use the full number with country code.</small>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={r.optedIn}
                  onChange={(e) => {
                    const next = structuredClone(draft.recipients);
                    next[index].optedIn = e.target.checked;
                    patch({ recipients: next });
                  }}
                />
                <span>
                  {live
                    ? "This person has agreed to receive internal call alerts."
                    : "Simulate this person’s opt-in (demo only)."}
                </span>
              </label>
            </div>
          ))}
        </div>
        <label className="narrow-field">
          Optional backup email (owner only)
          <input
            type="email"
            placeholder="owner@example.com"
            value={draft.backupEmail}
            onChange={(e) => patch({ backupEmail: e.target.value })}
          />
          <small>
            Terminal SMS failures or stuck recovery only. Requires SMTP
            deployment configuration.
          </small>
        </label>
      </section>
      <section className="section-card">
        <div className="section-heading">
          <User size={19} />
          <div>
            <h2>The first conversation</h2>
            <p>
              AI disclosure and caller consent come before conversational
              processing.
            </p>
          </div>
        </div>
        <label>
          Greeting & processing disclosure
          <textarea
            required
            rows={4}
            maxLength={600}
            value={draft.greeting}
            onChange={(e) => patch({ greeting: e.target.value })}
          />
          <small>
            Include “press 1 to agree, or 2 for a callback without AI.” Have
            qualified counsel review before launch.
          </small>
        </label>
        <label>
          Service area
          <input
            value={draft.serviceArea}
            maxLength={300}
            onChange={(e) => patch({ serviceArea: e.target.value })}
          />
        </label>
        <div className="settings-grid">
          <label>
            Direct human fallback numbers
            <textarea
              rows={2}
              placeholder="One direct E.164 number per line"
              value={fallbackText}
              onChange={(e) => setFallbackText(e.target.value)}
            />
            <small>
              Never use the public number that forwards here. Update the
              independent TwiML Bin separately.
            </small>
          </label>
          <label>
            Keep call records for (days)
            <input
              type="number"
              min={1}
              max={365}
              required
              value={draft.retentionDays}
              onChange={(e) => patch({ retentionDays: Number(e.target.value) })}
            />
            <small>
              Default: 90 days. Deleted records expire separately from backups.
            </small>
          </label>
        </div>
      </section>
      <section className="section-card">
        <div className="section-heading">
          <SlidersHorizontal size={19} />
          <div>
            <h2>Simple usage limits</h2>
            <p>
              When the AI minute threshold is reached, new calls go to fallback.
              Alerts remain active.
            </p>
          </div>
        </div>
        <div className="settings-grid">
          <label>
            Text model
            <select value={draft.model} onChange={() => {}}>
              <option>gpt-4.1-mini</option>
            </select>
            <small>
              Verify model access in your API account before live use.
            </small>
          </label>
          <label>
            Monthly AI / relay minutes
            <input
              type="number"
              min={0}
              max={100000}
              required
              value={draft.monthlyAiMinutes}
              onChange={(e) =>
                patch({ monthlyAiMinutes: Number(e.target.value) })
              }
            />
            <small>
              Minute threshold, not a total dollar cap. Set provider spending
              alerts too.
            </small>
          </label>
          <label>
            Maximum call duration (seconds)
            <input
              type="number"
              min={60}
              max={600}
              value={draft.maxCallSeconds}
              onChange={(e) =>
                patch({ maxCallSeconds: Number(e.target.value) })
              }
            />
          </label>
        </div>
      </section>
      <div className="routing-note">
        <ShieldCheck size={21} />
        <div>
          <h3>Your existing number stays yours.</h3>
          <p>
            Arrange unanswered, busy, and unavailable forwarding with your
            carrier. This page does not change carrier routing. Test caller ID
            and voicemail timing before launch.
          </p>
        </div>
      </div>
      <button className="primary" disabled={busy} type="submit">
        Save settings
      </button>
    </form>
  );
}
function CallDetail({
  call,
  recipients,
  demo,
  busy,
  onClose,
  onStatus,
  onDelete,
}: {
  call: Call;
  recipients: string[];
  demo: boolean;
  busy: boolean;
  onClose: () => void;
  onStatus: (s: Call["status"]) => void;
  onDelete: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    panel.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, []);
  const i = call.intake;
  const callback = i.callbackConfirmed ? i.callback : call.caller;
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        tabIndex={-1}
        ref={panel}
      >
        <div className="detail-top">
          <span>
            <PhoneIncoming size={16} /> CALL DETAILS
          </span>
          <button
            className="icon-button"
            aria-label="Close call details"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        <div className="detail-body">
          <div className="detail-badges">
            <Badge tone="new">{call.status}</Badge>
            {["Urgent", "Immediate danger"].includes(i.urgency || "") && (
              <Badge tone="urgent">
                <AlertTriangle size={12} />
                {i.urgency}
              </Badge>
            )}
            {demo && <Badge tone="partial">SIMULATED CALL</Badge>}
          </div>
          <h2 id="detail-title">{i.name || "Unknown caller"}</h2>
          <div className="detail-number">
            {callback || "Callback number unknown"}
          </div>
          <p className="muted small-copy">
            {i.callbackConfirmed
              ? "Confirmed by caller"
              : call.caller
                ? "Caller ID only · unconfirmed"
                : "Blocked or unavailable caller ID"}{" "}
            · {localDate(call.created)}, {localTime(call.created)} ET
          </p>
          <div className="detail-actions">
            {callback ? (
              <a className="primary" href={"tel:" + callback}>
                <Phone size={16} />
                Call back
                <ArrowUpRight size={16} />
              </a>
            ) : (
              <span className="disabled-action">
                No callback number captured
              </span>
            )}
            <button
              className="secondary"
              disabled={busy || call.status === "Contacted"}
              onClick={() => onStatus("Contacted")}
            >
              <Check size={16} />
              Mark contacted
            </button>
          </div>
          <section className="detail-section">
            <div className="eyebrow">WHAT THEY NEED</div>
            <p className="problem-text">
              {i.problem ||
                "No problem details captured. The caller may still need a callback."}
            </p>
            {!i.name && (
              <div className="partial-note">
                <AlertTriangle size={15} />
                Partial intake. Unknown details have been left blank.
              </div>
            )}
            <dl>
              <div>
                <dt>
                  <MapPin size={15} />
                  Service address
                </dt>
                <dd>
                  {i.address || "Not captured"}
                  {i.city && <span>{i.city}</span>}
                </dd>
              </div>
              <div>
                <dt>
                  <Building2 size={15} />
                  Property
                </dt>
                <dd>{i.property || "Not captured"}</dd>
              </div>
              <div>
                <dt>
                  <Clock size={15} />
                  Callback preference
                </dt>
                <dd>{i.preferredTime || "Not specified"}</dd>
              </div>
              <div>
                <dt>
                  <AlertTriangle size={15} />
                  Urgency
                </dt>
                <dd>
                  {i.urgency || "Unknown"}
                  <span>
                    {i.urgencyBasis === "caller-reported"
                      ? "Caller reported"
                      : i.urgencyBasis === "safety-rule"
                        ? "Safety keyword flag — verify"
                        : i.urgencyBasis === "assistant-inferred"
                          ? "Assistant assessment — verify"
                          : "Basis not established"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>
                  <AlertTriangle size={15} />
                  Active leak
                </dt>
                <dd>
                  {i.activeLeak === undefined
                    ? "Not established"
                    : i.activeLeak
                      ? "Reported by caller"
                      : "Not reported"}
                </dd>
              </div>
            </dl>
            {i.uncertainty && (
              <p className="partial-note">Uncertainty: {i.uncertainty}</p>
            )}
          </section>
          <section className="detail-section">
            <div className="eyebrow">ALERT DELIVERY</div>
            <p className="small-copy muted">
              {demo
                ? "These delivery states are simulated."
                : "Only a provider delivery callback confirms delivered status."}
            </p>
            {recipients.map((name, index) => (
              <div className="delivery-recipient" key={name}>
                <div className="delivery-avatar">{name[0]}</div>
                <div>
                  <strong>{name}</strong>
                  {call.deliveries
                    .filter((d) => d.recipient === index)
                    .map((d, n) => (
                      <div className="delivery-state" key={n}>
                        <span>
                          {d.kind === "urgent"
                            ? "Urgent alert"
                            : "Final summary"}
                        </span>
                        <Badge
                          tone={
                            d.state === "delivered"
                              ? "closed"
                              : [
                                    "failed",
                                    "undelivered",
                                    "blocked",
                                    "ambiguous",
                                  ].includes(d.state)
                                ? "urgent"
                                : "neutral"
                          }
                        >
                          {d.state === "delivered" && <CheckCheck size={12} />}{" "}
                          {d.state}
                        </Badge>
                        {d.error && (
                          <small className="delivery-error">{d.error}</small>
                        )}
                        <small>
                          {d.segments} SMS segment{d.segments !== 1 ? "s" : ""}{" "}
                          · {d.attempts} attempt{d.attempts !== 1 ? "s" : ""}
                        </small>
                      </div>
                    ))}
                  {!call.deliveries.some((d) => d.recipient === index) && (
                    <p>Not queued yet</p>
                  )}
                </div>
              </div>
            ))}
          </section>
          <details className="technical">
            <summary>
              Call information <ChevronDown size={15} />
            </summary>
            <p>Outcome: {call.outcome}</p>
            <p>AI consent: {call.consent}</p>
            <p>Reference: {call.id}</p>
            <p>Full transcript and audio recording are off.</p>
          </details>
          <div className="detail-bottom">
            <button
              className="secondary"
              disabled={busy || call.status === "Closed"}
              onClick={() => onStatus("Closed")}
            >
              <CheckCheck size={16} />
              Close request
            </button>
            {call.status !== "New" && (
              <button
                className="text-button"
                onClick={() => onStatus("New")}
                disabled={busy}
              >
                Reopen
              </button>
            )}
            <button
              className="text-button danger-text"
              disabled={busy || !call.finalized}
              onClick={onDelete}
            >
              Delete record
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoCall({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [id, setId] = useState(""),
    [messages, setMessages] = useState<{ role: string; text: string }[]>([]),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [ended, setEnded] = useState(false),
    [error, setError] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void api<{ id: string; reply: string }>("demo-call", "POST", {})
      .then((r) => {
        setId(r.id);
        setMessages([{ role: "Assistant", text: r.reply }]);
        field.current?.focus();
      })
      .catch((e) => setError(e.message));
  }, []);
  async function send(hangup = false) {
    setBusy(true);
    setError("");
    const text = input;
    setInput("");
    if (!hangup) setMessages((m) => [...m, { role: "You", text }]);
    try {
      const r = await api<{ reply: string; ended: boolean }>(
        "demo-call/" + id,
        "POST",
        hangup ? { hangup: true } : { text },
      );
      setMessages((m) => [...m, { role: "Assistant", text: r.reply }]);
      setEnded(r.ended);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      field.current?.focus();
    }
  }
  return (
    <div className="modal-backdrop">
      <div
        className="detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-title"
      >
        <div className="detail-top">
          <span>
            <FlaskConical size={16} /> SIMULATED TEXT CALL
          </span>
          <button
            aria-label="Close demo"
            className="icon-button"
            onClick={() => {
              if (id && !ended)
                void api("demo-call/" + id, "POST", { hangup: true }).finally(
                  onClose,
                );
              else onClose();
            }}
          >
            <X size={22} />
          </button>
        </div>
        <div className="detail-body">
          <h2 id="demo-title">Try a conversation.</h2>
          <p className="muted small-copy">
            Type as a fictional caller. No microphone, model API, or real SMS.
            This deterministic simulator asks one question at a time. For the
            address, separate the city with a comma.
          </p>
          <div className="chat-history" aria-live="polite">
            {messages.map((m, i) => (
              <div className={"chat-message " + m.role.toLowerCase()} key={i}>
                <strong>{m.role}</strong>
                <p>{m.text}</p>
              </div>
            ))}
          </div>
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          {ended ? (
            <button className="primary full" onClick={() => onDone(id)}>
              View captured call <ArrowUpRight size={16} />
            </button>
          ) : (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label>
                  Your reply
                  <input
                    ref={field}
                    aria-label="Your reply"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    maxLength={1000}
                    placeholder="Type your response…"
                    disabled={!id || busy}
                  />
                </label>
                <button
                  className="primary full"
                  disabled={!id || busy || !input.trim()}
                >
                  Send reply
                </button>
              </form>
              <button
                className="text-button"
                disabled={!id || busy}
                onClick={() => void send(true)}
              >
                Hang up & save partial request
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
