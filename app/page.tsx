"use client";

import {
  BarChart3,
  BookOpenText,
  CalendarClock,
  Check,
  ChevronRight,
  Church,
  CircleUserRound,
  Clock3,
  House as HouseIcon,
  Layers3,
  LocateFixed,
  LockKeyhole,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Navigation,
  Plus,
  Route,
  ShieldCheck,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Status =
  | "unvisited"
  | "no-answer"
  | "conversation"
  | "follow-up"
  | "declined"
  | "do-not-visit";

type View = "walk" | "follow-ups" | "guide" | "leader";
type MapFilter = "all" | "unvisited" | "visited" | "follow-up";

type Visit = {
  label: string;
  outcome: string;
};

type House = {
  id: string;
  address: string;
  x: number;
  y: number;
  status: Status;
  visits: number;
  note?: string;
  followUp?: string;
  history: Visit[];
};

const STORAGE_KEY = "neighborwalk-demo-houses-v1";

const statusMeta: Record<Status, { label: string; short: string }> = {
  unvisited: { label: "Not visited", short: "Open" },
  "no-answer": { label: "No answer", short: "No answer" },
  conversation: { label: "Conversation", short: "Talked" },
  "follow-up": { label: "Follow-up requested", short: "Follow-up" },
  declined: { label: "Politely declined", short: "Declined" },
  "do-not-visit": { label: "Do not revisit", short: "Do not visit" },
};

const daysFromNow = (days: number) => {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
};

const initialHouses: House[] = [
  {
    id: "h-01",
    address: "118 Maple Avenue",
    x: 15,
    y: 23,
    status: "follow-up",
    visits: 1,
    note: "Asked for prayer and welcomed a short return visit.",
    followUp: daysFromNow(2),
    history: [{ label: "Today · 10:14 AM", outcome: "Follow-up requested" }],
  },
  {
    id: "h-02",
    address: "122 Maple Avenue",
    x: 26,
    y: 21,
    status: "conversation",
    visits: 1,
    note: "Shared information about the community dinner.",
    history: [{ label: "Today · 10:18 AM", outcome: "Conversation" }],
  },
  {
    id: "h-03",
    address: "130 Maple Avenue",
    x: 39,
    y: 23,
    status: "no-answer",
    visits: 1,
    history: [{ label: "Today · 10:23 AM", outcome: "No answer" }],
  },
  {
    id: "h-04",
    address: "136 Maple Avenue",
    x: 51,
    y: 22,
    status: "declined",
    visits: 1,
    history: [{ label: "Today · 10:28 AM", outcome: "Politely declined" }],
  },
  {
    id: "h-05",
    address: "144 Maple Avenue",
    x: 64,
    y: 23,
    status: "unvisited",
    visits: 0,
    history: [],
  },
  {
    id: "h-06",
    address: "150 Maple Avenue",
    x: 77,
    y: 21,
    status: "unvisited",
    visits: 0,
    history: [],
  },
  {
    id: "h-07",
    address: "201 Cedar Street",
    x: 19,
    y: 46,
    status: "conversation",
    visits: 1,
    history: [{ label: "Today · 10:41 AM", outcome: "Conversation" }],
  },
  {
    id: "h-08",
    address: "207 Cedar Street",
    x: 32,
    y: 48,
    status: "no-answer",
    visits: 1,
    history: [{ label: "Today · 10:46 AM", outcome: "No answer" }],
  },
  {
    id: "h-09",
    address: "215 Cedar Street",
    x: 46,
    y: 46,
    status: "follow-up",
    visits: 1,
    note: "Requested details about Sunday service times.",
    followUp: daysFromNow(7),
    history: [{ label: "Today · 10:51 AM", outcome: "Follow-up requested" }],
  },
  {
    id: "h-10",
    address: "221 Cedar Street",
    x: 61,
    y: 47,
    status: "unvisited",
    visits: 0,
    history: [],
  },
  {
    id: "h-11",
    address: "229 Cedar Street",
    x: 76,
    y: 46,
    status: "do-not-visit",
    visits: 1,
    history: [{ label: "Today · 11:03 AM", outcome: "Do not revisit" }],
  },
  {
    id: "h-12",
    address: "302 Willow Lane",
    x: 16,
    y: 72,
    status: "unvisited",
    visits: 0,
    history: [],
  },
  {
    id: "h-13",
    address: "308 Willow Lane",
    x: 30,
    y: 74,
    status: "unvisited",
    visits: 0,
    history: [],
  },
  {
    id: "h-14",
    address: "316 Willow Lane",
    x: 45,
    y: 72,
    status: "unvisited",
    visits: 0,
    history: [],
  },
  {
    id: "h-15",
    address: "324 Willow Lane",
    x: 61,
    y: 74,
    status: "unvisited",
    visits: 0,
    history: [],
  },
  {
    id: "h-16",
    address: "330 Willow Lane",
    x: 78,
    y: 72,
    status: "unvisited",
    visits: 0,
    history: [],
  },
];

const guideSteps = [
  {
    eyebrow: "Start with care",
    title: "Ask permission",
    copy: "Keep the opening neighborly and give the person an easy way to decline.",
    script:
      "Hi! We’re with Grace Harbor Church nearby, checking in with our neighbors today. Is there anything we could pray about for you?",
    prompt: "Pause. Listen before deciding what to say next.",
  },
  {
    eyebrow: "Make room",
    title: "Listen for their story",
    copy: "A sincere question is often more helpful than a memorized speech.",
    script:
      "Thank you for sharing that. Would it be okay if I told you briefly why prayer and Jesus have become important to me?",
    prompt: "Honor a no. If they say yes, keep your story brief and personal.",
  },
  {
    eyebrow: "Share clearly",
    title: "Explain the good news",
    copy: "Use your church’s approved wording and avoid pressure or argument.",
    script:
      "Christians believe God loves us, that our brokenness separates us from him, and that Jesus came to reconcile us to God through his death and resurrection.",
    prompt: "Ask what they think instead of assuming what they believe.",
  },
  {
    eyebrow: "Leave a next step",
    title: "Invite, don’t corner",
    copy: "Offer a practical next step that matches the conversation.",
    script:
      "Would you like prayer now, a short follow-up conversation, or information about a gathering at the church?",
    prompt: "Record contact details only if they clearly choose to share them.",
  },
];

function formatFollowUp(value?: string) {
  if (!value) return "No date set";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

export default function Home() {
  const [view, setView] = useState<View>("walk");
  const [houses, setHouses] = useState<House[]>(initialHouses);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MapFilter>("all");
  const [walkActive, setWalkActive] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setHouses(JSON.parse(saved) as House[]);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(houses));
  }, [houses, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selectedHouse = houses.find((house) => house.id === selectedId) ?? null;
  const visitedCount = houses.filter((house) => house.status !== "unvisited").length;
  const followUps = useMemo(
    () =>
      houses
        .filter((house) => house.status === "follow-up")
        .sort((a, b) => (a.followUp ?? "").localeCompare(b.followUp ?? "")),
    [houses],
  );
  const coverage = Math.round((visitedCount / houses.length) * 100);

  const matchesFilter = (house: House) => {
    if (filter === "all") return true;
    if (filter === "visited") return house.status !== "unvisited";
    return house.status === filter;
  };

  const showToast = (message: string) => setToast(message);

  const updateHouse = (id: string, patch: Partial<House>) => {
    setHouses((current) =>
      current.map((house) => (house.id === id ? { ...house, ...patch } : house)),
    );
  };

  const recordOutcome = (status: Status) => {
    if (!selectedHouse) return;
    const now = new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    const followUp =
      status === "follow-up"
        ? selectedHouse.followUp ?? daysFromNow(3)
        : status === "do-not-visit"
          ? undefined
          : selectedHouse.followUp;

    updateHouse(selectedHouse.id, {
      status,
      visits: selectedHouse.visits + 1,
      followUp,
      history: [
        { label: `Today · ${now}`, outcome: statusMeta[status].label },
        ...selectedHouse.history,
      ],
    });
    showToast(`${statusMeta[status].label} saved`);
  };

  const completeFollowUp = (house: House) => {
    const now = new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    updateHouse(house.id, {
      status: "conversation",
      followUp: undefined,
      visits: house.visits + 1,
      history: [
        { label: `Today · ${now}`, outcome: "Follow-up completed" },
        ...house.history,
      ],
    });
    showToast("Follow-up completed");
  };

  const handleMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!addMode) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(6, Math.min(94, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.max(9, Math.min(88, ((event.clientY - bounds.top) / bounds.height) * 100));
    const id = `custom-${Date.now()}`;
    const nextHouse: House = {
      id,
      address: "New location — confirm address",
      x,
      y,
      status: "unvisited",
      visits: 0,
      history: [],
    };
    setHouses((current) => [...current, nextHouse]);
    setSelectedId(id);
    setAddMode(false);
    showToast("Location added");
  };

  const resetDemo = () => {
    setHouses(initialHouses);
    setSelectedId(null);
    window.localStorage.removeItem(STORAGE_KEY);
    showToast("Demo territory reset");
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setView("walk")} aria-label="Open NeighborWalk map">
          <span className="brand-mark" aria-hidden="true">
            <Route size={19} strokeWidth={2.4} />
          </span>
          <span>
            <strong>NeighborWalk</strong>
            <small>Grace Harbor · Pilot</small>
          </span>
        </button>

        <div className="header-actions">
          <span className="demo-chip"><ShieldCheck size={13} /> Demo data</span>
          <button className="avatar-button" aria-label="Open volunteer profile">
            <CircleUserRound size={22} />
          </button>
        </div>
      </header>

      <section className="app-body">
        <aside className="desktop-rail" aria-label="Territory summary">
          <div className="rail-intro">
            <p className="eyebrow">Saturday outreach</p>
            <h1>Oakwood East</h1>
            <p>Team Barnabas · 9:30 AM–12:00 PM</p>
          </div>

          <div className="coverage-card">
            <div className="coverage-number">
              <strong>{coverage}%</strong>
              <span>covered</span>
            </div>
            <div className="progress-track" aria-label={`${coverage}% of territory covered`}>
              <span style={{ width: `${coverage}%` }} />
            </div>
            <div className="coverage-meta">
              <span>{visitedCount} visited</span>
              <span>{houses.length - visitedCount} remaining</span>
            </div>
          </div>

          <nav className="rail-nav" aria-label="Main sections">
            <NavItem active={view === "walk"} icon={<MapIcon size={18} />} label="Walk map" onClick={() => setView("walk")} />
            <NavItem active={view === "follow-ups"} icon={<CalendarClock size={18} />} label="Follow-ups" count={followUps.length} onClick={() => setView("follow-ups")} />
            <NavItem active={view === "guide"} icon={<BookOpenText size={18} />} label="Conversation guide" onClick={() => setView("guide")} />
            <NavItem active={view === "leader"} icon={<BarChart3 size={18} />} label="Leader view" onClick={() => setView("leader")} />
          </nav>

          <div className="offline-note">
            <WifiOff size={17} />
            <span><strong>Ready offline</strong>Demo changes stay on this device.</span>
          </div>
        </aside>

        <section className="workspace">
          {view === "walk" && (
            <div className="map-screen">
              <div className="mobile-territory-bar">
                <div>
                  <p className="eyebrow">Saturday outreach</p>
                  <h1>Oakwood East</h1>
                </div>
                <div className="mobile-progress">
                  <strong>{coverage}%</strong>
                  <span>covered</span>
                </div>
              </div>

              <div className="map-toolbar">
                <div className="filter-tabs" aria-label="Filter houses">
                  {([
                    ["all", "All"],
                    ["unvisited", "Open"],
                    ["visited", "Visited"],
                    ["follow-up", "Follow-up"],
                  ] as [MapFilter, string][]).map(([value, label]) => (
                    <button
                      key={value}
                      className={filter === value ? "active" : ""}
                      onClick={() => setFilter(value)}
                      aria-pressed={filter === value}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button className="icon-button" aria-label="Map layers"><Layers3 size={18} /></button>
              </div>

              <div
                className={`map-canvas ${addMode ? "adding" : ""}`}
                onClick={handleMapClick}
                role="application"
                aria-label="Interactive demo map of Oakwood East"
              >
                <div className="park park-one"><span>Oakwood Green</span></div>
                <div className="park park-two" />
                <div className="road road-maple"><span>MAPLE AVENUE</span></div>
                <div className="road road-cedar"><span>CEDAR STREET</span></div>
                <div className="road road-willow"><span>WILLOW LANE</span></div>
                <div className="road road-eighth"><span>8TH STREET</span></div>
                <div className="road road-ninth"><span>9TH STREET</span></div>

                <div className="route-segment route-one" />
                <div className="route-segment route-two" />
                <div className="route-segment route-three" />

                {houses.map((house) => (
                  <button
                    key={house.id}
                    className={`house-marker ${selectedId === house.id ? "selected" : ""} ${matchesFilter(house) ? "" : "filtered"}`}
                    data-status={house.status}
                    style={{ left: `${house.x}%`, top: `${house.y}%` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(house.id);
                    }}
                    aria-label={`${house.address}: ${statusMeta[house.status].label}`}
                  >
                    <HouseIcon size={17} strokeWidth={2.3} />
                    <span className="marker-tooltip">{house.address}</span>
                  </button>
                ))}

                <div className="current-location" style={{ left: "45%", top: "57%" }} aria-label="Your current location">
                  <span />
                </div>

                {addMode && <div className="add-instruction"><MapPin size={16} /> Tap the house location</div>}

                <div className="map-controls">
                  <button className="map-control" aria-label="Center on my location"><LocateFixed size={19} /></button>
                  <button
                    className={`map-control add-control ${addMode ? "active" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setAddMode((current) => !current);
                    }}
                    aria-label="Add a house location"
                    aria-pressed={addMode}
                  >
                    {addMode ? <X size={20} /> : <Plus size={20} />}
                  </button>
                </div>

                <div className="map-legend" aria-label="Map legend">
                  <span><i data-color="open" /> Open</span>
                  <span><i data-color="visited" /> Visited</span>
                  <span><i data-color="follow" /> Follow-up</span>
                </div>
              </div>

              {!selectedHouse && (
                <div className="walk-dock">
                  <div>
                    <span className="walk-label">{walkActive ? "Walk in progress" : "Ready when your team is"}</span>
                    <strong>{houses.length - visitedCount} houses remaining</strong>
                  </div>
                  <button className={walkActive ? "button secondary" : "button primary"} onClick={() => setWalkActive((current) => !current)}>
                    {walkActive ? <><Clock3 size={16} /> Finish walk</> : <><Navigation size={16} /> Start walk</>}
                  </button>
                </div>
              )}

              {selectedHouse && (
                <HouseSheet
                  house={selectedHouse}
                  onClose={() => setSelectedId(null)}
                  onOutcome={recordOutcome}
                  onUpdate={(patch) => updateHouse(selectedHouse.id, patch)}
                  onSaved={() => showToast("House details saved")}
                />
              )}
            </div>
          )}

          {view === "follow-ups" && (
            <FollowUpsView
              houses={followUps}
              onOpen={(house) => {
                setSelectedId(house.id);
                setView("walk");
              }}
              onComplete={completeFollowUp}
            />
          )}

          {view === "guide" && (
            <GuideView step={guideStep} setStep={setGuideStep} />
          )}

          {view === "leader" && (
            <LeaderView houses={houses} coverage={coverage} onReset={resetDemo} />
          )}
        </section>
      </section>

      <nav className="mobile-nav" aria-label="Main navigation">
        <MobileNavItem active={view === "walk"} icon={<MapIcon size={20} />} label="Map" onClick={() => setView("walk")} />
        <MobileNavItem active={view === "follow-ups"} icon={<CalendarClock size={20} />} label="Follow-ups" count={followUps.length} onClick={() => setView("follow-ups")} />
        <MobileNavItem active={view === "guide"} icon={<BookOpenText size={20} />} label="Guide" onClick={() => setView("guide")} />
        <MobileNavItem active={view === "leader"} icon={<BarChart3 size={20} />} label="Leader" onClick={() => setView("leader")} />
      </nav>

      {toast && <div className="toast" role="status"><Check size={16} /> {toast}</div>}
    </main>
  );
}

function NavItem({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick} aria-current={active ? "page" : undefined}>
      {icon}<span>{label}</span>{count ? <b>{count}</b> : null}
    </button>
  );
}

function MobileNavItem({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick} aria-current={active ? "page" : undefined}>
      <span>{icon}{count ? <b>{count}</b> : null}</span>
      <small>{label}</small>
    </button>
  );
}

function HouseSheet({
  house,
  onClose,
  onOutcome,
  onUpdate,
  onSaved,
}: {
  house: House;
  onClose: () => void;
  onOutcome: (status: Status) => void;
  onUpdate: (patch: Partial<House>) => void;
  onSaved: () => void;
}) {
  return (
    <aside className="house-sheet" aria-label={`Details for ${house.address}`}>
      <div className="sheet-handle" />
      <div className="sheet-heading">
        <div className="address-icon"><HouseIcon size={19} /></div>
        <div>
          <span className="status-pill" data-status={house.status}>{statusMeta[house.status].label}</span>
          <h2>{house.address}</h2>
          <p>{house.visits ? `${house.visits} visit${house.visits === 1 ? "" : "s"} recorded` : "No visits yet"}</p>
        </div>
        <button className="close-button" onClick={onClose} aria-label="Close house details"><X size={19} /></button>
      </div>

      <div className="outcome-section">
        <p className="field-label">Record today’s outcome</p>
        <div className="outcome-grid">
          <button onClick={() => onOutcome("no-answer")}><span className="outcome-dot no-answer" />No answer</button>
          <button onClick={() => onOutcome("conversation")}><span className="outcome-dot conversation" />Conversation</button>
          <button onClick={() => onOutcome("follow-up")}><span className="outcome-dot follow-up" />Follow-up</button>
          <button onClick={() => onOutcome("declined")}><span className="outcome-dot declined" />Declined</button>
        </div>
      </div>

      <div className="detail-fields">
        <label>
          <span>Brief, objective note</span>
          <textarea
            value={house.note ?? ""}
            onChange={(event) => onUpdate({ note: event.target.value })}
            placeholder="Only record what the team needs for the next visit."
            rows={2}
          />
        </label>

        {house.status === "follow-up" && (
          <label>
            <span>Follow-up date</span>
            <input
              type="date"
              value={house.followUp ?? ""}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(event) => onUpdate({ followUp: event.target.value })}
            />
          </label>
        )}
      </div>

      <div className="sheet-actions">
        <button className="do-not-visit" onClick={() => onOutcome("do-not-visit")}>Mark do not revisit</button>
        <button className="button primary" onClick={onSaved}>Save details</button>
      </div>
    </aside>
  );
}

function FollowUpsView({
  houses,
  onOpen,
  onComplete,
}: {
  houses: House[];
  onOpen: (house: House) => void;
  onComplete: (house: House) => void;
}) {
  return (
    <div className="content-view follow-ups-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">Care continues</p>
          <h1>Follow-ups</h1>
          <p>Return only where someone has invited another conversation.</p>
        </div>
        <div className="heading-badge"><CalendarClock size={19} /><strong>{houses.length}</strong><span>scheduled</span></div>
      </div>

      {houses.length ? (
        <div className="follow-up-list">
          {houses.map((house, index) => (
            <article className="follow-up-card" key={house.id}>
              <div className="date-tile">
                <span>{index === 0 ? "NEXT" : "LATER"}</span>
                <strong>{formatFollowUp(house.followUp).split(",")[0]}</strong>
              </div>
              <div className="follow-up-copy">
                <h2>{house.address}</h2>
                <p>{house.note ?? "Follow-up requested."}</p>
                <div><Clock3 size={14} /> {formatFollowUp(house.followUp)} · Team Barnabas</div>
              </div>
              <div className="follow-up-actions">
                <button className="button quiet" onClick={() => onOpen(house)}>View on map</button>
                <button className="button primary" onClick={() => onComplete(house)}><Check size={16} /> Complete</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state"><Check size={24} /><h2>Follow-ups are clear</h2><p>New requests will appear here automatically.</p></div>
      )}
    </div>
  );
}

function GuideView({ step, setStep }: { step: number; setStep: (step: number) => void }) {
  const current = guideSteps[step];
  return (
    <div className="content-view guide-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">A gentle crutch, not a script to hide behind</p>
          <h1>Conversation guide</h1>
          <p>Church-approved sample language for when you need help finding the next words.</p>
        </div>
        <div className="guide-lock"><LockKeyhole size={15} /> Sample content</div>
      </div>

      <div className="guide-layout">
        <div className="guide-steps" role="tablist" aria-label="Conversation steps">
          {guideSteps.map((item, index) => (
            <button
              key={item.title}
              className={index === step ? "active" : index < step ? "complete" : ""}
              onClick={() => setStep(index)}
              role="tab"
              aria-selected={index === step}
            >
              <span>{index < step ? <Check size={15} /> : index + 1}</span>
              <div><small>{item.eyebrow}</small><strong>{item.title}</strong></div>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>

        <article className="script-card" role="tabpanel">
          <div className="script-progress"><span style={{ width: `${((step + 1) / guideSteps.length) * 100}%` }} /></div>
          <p className="eyebrow">Step {step + 1} of {guideSteps.length} · {current.eyebrow}</p>
          <h2>{current.title}</h2>
          <p className="script-copy">{current.copy}</p>
          <blockquote>
            <MessageCircle size={21} />
            <p>“{current.script}”</p>
          </blockquote>
          <div className="prompt-box"><Church size={17} /><p><strong>Remember</strong>{current.prompt}</p></div>
          <div className="script-actions">
            <button className="button quiet" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Previous</button>
            <button className="button primary" onClick={() => setStep(Math.min(guideSteps.length - 1, step + 1))} disabled={step === guideSteps.length - 1}>Next step <ChevronRight size={16} /></button>
          </div>
        </article>
      </div>
    </div>
  );
}

function LeaderView({
  houses,
  coverage,
  onReset,
}: {
  houses: House[];
  coverage: number;
  onReset: () => void;
}) {
  const statusCount = (status: Status) => houses.filter((house) => house.status === status).length;
  const visited = houses.length - statusCount("unvisited");
  return (
    <div className="content-view leader-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">Oakwood East · Live overview</p>
          <h1>Leader view</h1>
          <p>See coverage and coordination without scoring people’s responses.</p>
        </div>
        <button className="button quiet" onClick={onReset}>Reset demo</button>
      </div>

      <div className="leader-grid">
        <article className="metric-card coverage-metric">
          <div className="metric-icon"><Route size={20} /></div>
          <p>Territory coverage</p>
          <strong>{coverage}%</strong>
          <div className="progress-track"><span style={{ width: `${coverage}%` }} /></div>
          <small>{visited} of {houses.length} houses visited</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon amber"><CalendarClock size={20} /></div>
          <p>Follow-ups</p>
          <strong>{statusCount("follow-up")}</strong>
          <small>Requested return visits</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon blue"><Users size={20} /></div>
          <p>Teams walking</p>
          <strong>3</strong>
          <small>7 volunteers checked in</small>
        </article>
      </div>

      <div className="leader-panels">
        <article className="leader-panel">
          <div className="panel-heading"><div><p className="eyebrow">Today’s work</p><h2>Coverage by outcome</h2></div><BarChart3 size={20} /></div>
          <div className="status-bars">
            {([
              ["conversation", "Conversation"],
              ["no-answer", "No answer"],
              ["follow-up", "Follow-up"],
              ["declined", "Declined"],
              ["do-not-visit", "Do not revisit"],
            ] as [Status, string][]).map(([status, label]) => (
              <div className="status-row" key={status}>
                <span>{label}</span>
                <div><i data-status={status} style={{ width: `${Math.max(8, (statusCount(status) / Math.max(1, visited)) * 100)}%` }} /></div>
                <strong>{statusCount(status)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="leader-panel">
          <div className="panel-heading"><div><p className="eyebrow">In the field</p><h2>Volunteer teams</h2></div><Users size={20} /></div>
          <div className="team-list">
            <div><span className="team-avatar">B</span><p><strong>Team Barnabas</strong><small>Oakwood East · Active now</small></p><b>8 / 16</b></div>
            <div><span className="team-avatar blue">P</span><p><strong>Team Priscilla</strong><small>Oakwood West · Active now</small></p><b>11 / 18</b></div>
            <div><span className="team-avatar gold">L</span><p><strong>Team Lydia</strong><small>Riverside · Starting soon</small></p><b>0 / 21</b></div>
          </div>
        </article>
      </div>

      <div className="privacy-banner"><ShieldCheck size={20} /><p><strong>Privacy-first pilot</strong>Names and contact details are not collected in this demo. Follow-up notes should stay brief, objective, and permission-based.</p></div>
    </div>
  );
}
