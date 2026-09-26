"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Printer, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { calendarDate, formatCalendarDate } from "../lib/calendar";
import { outcomeMeta, type NeighborWalkData, type Property, type Territory } from "../lib/domain";
import { reviewedEncounter } from "../lib/encounter-history";
import { houseLabel, neighborhoodPins, shortStreet, streetOf } from "../lib/pin-counts";
import { outcomeWord } from "./OutcomeGrid";

type ReviewedVisit = ReturnType<typeof reviewedEncounter>;

function byStreet<T>(items: T[], address: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const street = shortStreet(streetOf(address(item)));
    groups.set(street, [...(groups.get(street) ?? []), item]);
  }
  return [...groups.entries()];
}

/** What you and your team logged tonight on this route, grouped by street,
 * newest first. A row flies to its pin. */
export function WalkLog({ data, visits, routeName, walkers, doors, onBack, onOpen }: {
  data: NeighborWalkData; visits: ReviewedVisit[]; routeName: string; walkers: string[]; doors: number;
  onBack: () => void; onOpen: (propertyId: string) => void;
}) {
  const timezone = data.church.timezone;
  const homes = new Map(data.properties.map((home) => [home.id, home]));
  const me = data.preferences.activeVolunteerId;
  const time = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(iso)).replace(/\s?[AP]M$/, "");
  const rows = visits.filter((visit) => visit.propertyId && homes.has(visit.propertyId));
  const groups = byStreet(rows, (visit) => homes.get(visit.propertyId!)!.address);
  return <section className="walk-log screen-page" aria-labelledby="walk-log-title">
    <div className="screen-top"><button type="button" className="round-button float" aria-label="Back to the map" onClick={onBack}><ChevronLeft size={22} aria-hidden="true" /></button><span className="mono-meta">{doors} {doors === 1 ? "door" : "doors"}</span></div>
    <h1 id="walk-log-title" className="screen-title">Logged tonight</h1>
    <p className="mono-meta screen-kicker">{[routeName, walkers.join(", ")].filter(Boolean).join(" · ")}</p>
    {groups.map(([street, streetVisits]) => <section key={street} className="list-section" aria-label={street}>
      <div className="list-section-head"><h2>{street}</h2><span className="mono-meta">{streetVisits.length}</span></div>
      <div className="grouped-rows">{streetVisits.map((visit) => {
        const home = homes.get(visit.propertyId!)!;
        const who = visit.volunteerId === me ? "You" : data.volunteers.find((volunteer) => volunteer.id === visit.volunteerId)?.name ?? "Someone";
        return <button type="button" key={visit.id} className="grouped-row log-row" onClick={() => onOpen(home.id)}>
          <time className="mono-meta" dateTime={visit.recordedAt}>{time(visit.recordedAt)}</time>
          <i className="outcome-dot" style={{ background: outcomeMeta[visit.outcome].color }} aria-hidden="true" />
          <span className="grouped-row-text"><strong>{houseLabel(home.address, home.unit)}</strong><small>{outcomeWord[visit.outcome]} · {who}</small></span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>;
      })}</div>
    </section>)}
    {!groups.length && <p className="home-empty">Nothing logged on this route yet. Tap a house on the map to drop a pin.</p>}
  </section>;
}

/** Walks → List: every pinned home in the neighborhood, by street, with its
 * last outcome and date. Rows open the home sheet. */
export function PinnedList({ data, territory, switcher, onNeighborhoods, onOpen }: {
  data: NeighborWalkData; territory: Territory; switcher: React.ReactNode;
  onNeighborhoods: () => void; onOpen: (propertyId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const timezone = data.church.timezone;
  const pins = neighborhoodPins(data, territory.id).pins;
  const lastVisit = useMemo(() => {
    const latest = new Map<string, ReviewedVisit>();
    for (const original of data.visits) {
      if (!original.propertyId) continue;
      const visit = reviewedEncounter(original);
      if (visit.voided) continue;
      const current = latest.get(original.propertyId);
      if (!current || visit.recordedAt > current.recordedAt) latest.set(original.propertyId, visit);
    }
    return latest;
  }, [data.visits]);
  const people = useMemo(() => {
    const names = new Map<string, string>();
    for (const resident of data.residents) if (resident.propertyId && resident.name && !resident.mergedIntoId && !names.has(resident.propertyId)) names.set(resident.propertyId, resident.name);
    return names;
  }, [data.residents]);
  const needle = query.trim().toLowerCase();
  const homes = data.properties.filter((home) => !home.mergedIntoId && home.territoryId === territory.id)
    .filter((home) => !needle || `${home.address} ${home.unit ?? ""} ${people.get(home.id) ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }));
  const groups = byStreet(homes, (home) => home.address);
  const line = (home: Property) => {
    const visit = lastVisit.get(home.id);
    if (!visit) return "Pinned · not logged yet";
    return [outcomeWord[visit.outcome], formatCalendarDate(calendarDate(visit.recordedAt, timezone), { month: "short", day: "numeric" }), people.get(home.id)].filter(Boolean).join(" · ");
  };
  return <section className="pinned-list address-list screen-page" aria-label={`Pinned homes in ${territory.name}`}>
    <div className="map-top in-page">
      {switcher}
      <div className="map-top-row">
        <button type="button" className="capsule-button" aria-label={`${territory.name}, ${pins} pins. Choose a neighborhood`} onClick={onNeighborhoods}><strong>{territory.name}</strong><span className="mono-meta">{pins}</span><ChevronDown size={14} aria-hidden="true" /></button>
        <button type="button" className="round-button float" aria-label="Print the address list" onClick={() => window.print()}><Printer size={19} aria-hidden="true" /></button>
      </div>
      <label className="search-box"><Search size={17} aria-hidden="true" /><span className="visually-hidden">Search pinned homes</span><input type="search" value={query} enterKeyHint="search" placeholder="Street or name" onChange={(event) => setQuery(event.target.value)} /></label>
    </div>
    <div className="print-heading"><h2>{data.church.name} — {territory.name}</h2><p>Check the app for “Don’t knock” homes before you go. No names or phone numbers are printed.</p></div>
    {groups.map(([street, streetHomes]) => <section key={street} className="list-section" aria-label={street}>
      <div className="list-section-head"><h2>{street}</h2><span className="mono-meta">{streetHomes.length}</span></div>
      <div className="grouped-rows">{streetHomes.map((home) => <button type="button" key={home.id} className="grouped-row" onClick={() => onOpen(home.id)}>
        <i className="outcome-dot" style={{ background: outcomeMeta[lastVisit.get(home.id)?.outcome ?? home.currentOutcome].color }} aria-hidden="true" />
        <span className="grouped-row-text"><strong>{houseLabel(home.address, home.unit)}</strong><small>{line(home)}</small></span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>)}</div>
    </section>)}
    {!groups.length && <p className="home-empty">{needle ? "No pinned homes match." : "No pins here yet. Walkers drop a pin on each home they visit."}</p>}
  </section>;
}

