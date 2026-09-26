import {
  APP_SCHEMA_VERSION,
  type Coordinates,
  type NeighborWalkData,
} from "./domain";
import { DEFAULT_MAP_STYLE_URL, MAP_STYLE_CONFIGURATION_REVISION } from "./map-config";
import { calendarDate, calendarDaysFromNow, churchDateTimeToIso, DEFAULT_CHURCH_TIMEZONE } from "./calendar";

const CHURCH_ID = "church_grace_harbor_demo";
const EVENT_ID = "event_saturday_outreach";

/** Lawrenceburg, Tennessee: inside the Lawrence County parcel service area so demo targets can load real parcels. */
export const DEMO_CENTER: Coordinates = [-87.3348, 35.2424];
const DEMO_COUNTY_FIPS = "47099";
const DEMO_PARCEL_REVISION = "neighborwalk-demo-parcels-2026-09";

function demoParcelGislink(index: number) {
  return `099DEMO${String(index + 1).padStart(3, "0")}`;
}

function dayAt(offset: number, hour: number, minute = 0) {
  // Sample schedules follow their church, even when a device is in another zone.
  // Normalize overflow minutes (used by the visit fixtures) before conversion.
  const date = new Date(`${calendarDaysFromNow(offset, DEFAULT_CHURCH_TIMEZONE)}T00:00:00Z`);
  date.setUTCHours(hour, minute, 0, 0);
  return churchDateTimeToIso(date.toISOString().slice(0, 16), DEFAULT_CHURCH_TIMEZONE);
}

const boundary = (center: Coordinates, dx = 0.0047, dy = 0.0034): Coordinates[] => [
  [center[0] - dx, center[1] + dy],
  [center[0] + dx, center[1] + dy],
  [center[0] + dx, center[1] - dy],
  [center[0] - dx, center[1] - dy],
  [center[0] - dx, center[1] + dy],
];

export function createSeedData(): NeighborWalkData {
  const now = new Date().toISOString();
  const centers: Record<string, Coordinates> = {
    east: DEMO_CENTER,
    west: [DEMO_CENTER[0] - 0.0112, DEMO_CENTER[1] - 0.0001],
    river: [DEMO_CENTER[0] + 0.0118, DEMO_CENTER[1] + 0.0058],
  };
  const territories = [
    {
      id: "territory_oakwood_east",
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      name: "Crockett Heights",
      color: "#286c59",
      center: centers.east,
      zoom: 16.2,
      boundary: boundary(centers.east),
      assignedTeamId: "team_barnabas",
    },
    {
      id: "territory_oakwood_west",
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      name: "Westside",
      color: "#6b91ad",
      center: centers.west,
      zoom: 16.1,
      boundary: boundary(centers.west),
      assignedTeamId: "team_priscilla",
    },
    {
      id: "territory_riverside",
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      name: "Shoal Creek",
      color: "#b98231",
      center: centers.river,
      zoom: 15.8,
      boundary: boundary(centers.river, 0.0052, 0.0038),
      assignedTeamId: "team_lydia",
    },
  ] satisfies NeighborWalkData["territories"];

  const offsets: Coordinates[] = [
    [-0.0034, 0.0022], [-0.0021, 0.0024], [-0.0007, 0.0021], [0.0008, 0.0023],
    [0.0023, 0.0021], [0.0035, 0.0024], [-0.0032, 0.0002], [-0.0018, 0.0001],
    [-0.0003, 0.0003], [0.0013, 0.0001], [0.0031, 0.0002], [-0.0033, -0.0020],
    [-0.0018, -0.0022], [-0.0002, -0.0019], [0.0015, -0.0022], [0.0032, -0.0019],
  ];
  const addresses = [
    "118 Crockett Street", "122 Crockett Street", "130 Crockett Street", "136 Crockett Street",
    "144 Crockett Street", "150 Crockett Street", "201 Gaines Street", "207 Gaines Street",
    "215 Gaines Street", "221 Gaines Street", "229 Gaines Street", "302 Berger Street",
    "308 Berger Street", "316 Berger Street", "324 Berger Street", "330 Berger Street",
  ];
  const outcomes: NeighborWalkData["properties"][number]["currentOutcome"][] = [
    "follow_up", "conversation", "no_answer", "declined", "unvisited", "unvisited",
    "conversation", "no_answer", "follow_up", "unvisited", "do_not_visit", "unvisited",
    "unvisited", "unvisited", "unvisited", "unvisited",
  ];
  const notes = [
    "Asked for prayer and welcomed a brief return visit.",
    "Shared information about the community dinner.",
    undefined,
    undefined,
    undefined,
    undefined,
    "Had a short conversation at the door.",
    undefined,
    "Requested details about Sunday service times.",
  ];

  const properties = offsets.map((offset, index) => {
    const visited = outcomes[index] !== "unvisited";
    return {
      id: `property_demo_${String(index + 1).padStart(2, "0")}`,
      churchId: CHURCH_ID,
      territoryId: territories[0].id,
      address: addresses[index],
      coordinates: [centers.east[0] + offset[0], centers.east[1] + offset[1]] as Coordinates,
      parcel: { countyFips: DEMO_COUNTY_FIPS, gislink: demoParcelGislink(index) },
      currentOutcome: outcomes[index],
      lastVisitedAt: visited ? dayAt(0, 10, 8 + index * 4) : undefined,
      visitCount: visited ? 1 : 0,
      createdAt: dayAt(-2, 14),
      updatedAt: visited ? dayAt(0, 10, 8 + index * 4) : dayAt(-2, 14),
      source: "seed" as const,
    };
  });

  const visits = properties
    .filter((property) => property.currentOutcome !== "unvisited")
    .map((property, index) => ({
      id: `visit_demo_${String(index + 1).padStart(2, "0")}`,
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      territoryId: territories[0].id,
      propertyId: property.id,
      targetId: properties.indexOf(property) < 6 ? "target_demo_crockett_north" : "target_demo_crockett_south",
      targetParcel: property.parcel,
      volunteerId: index % 2 === 0 ? "volunteer_maya" : "volunteer_jordan",
      outcome: property.currentOutcome as Exclude<typeof property.currentOutcome, "unvisited">,
      objectiveNote: notes[properties.indexOf(property)],
      recordedAt: property.lastVisitedAt!,
      deviceId: "demo-device",
    }));

  const followUps: NeighborWalkData["followUps"] = visits
    .filter((visit) => visit.outcome === "follow_up")
    .map((visit, index) => ({
      id: `followup_demo_${index + 1}`,
      churchId: CHURCH_ID,
      propertyId: visit.propertyId,
      sourceVisitId: visit.id,
      assignedTeamId: "team_barnabas",
      dueAt: dayAt(index === 0 ? 2 : 7, 17),
      status: "scheduled" as const,
      note: visit.objectiveNote,
      history: [{
        id: `activity_demo_${index + 1}`,
        action: "created" as const,
        note: visit.objectiveNote,
        dueAt: dayAt(index === 0 ? 2 : 7, 17),
        actorId: visit.volunteerId,
        createdAt: visit.recordedAt,
      }],
      createdAt: visit.recordedAt,
    }));

  const residents: NeighborWalkData["residents"] = [
    {
      id: "resident_demo_elena",
      churchId: CHURCH_ID,
      propertyId: properties[0].id,
      name: "Elena",
      faithStatus: "exploring",
      discipleshipStage: "exploring_faith",
      assignedVolunteerId: "volunteer_maya",
      createdByVolunteerId: "volunteer_maya",
      sharedWithVolunteerIds: [],
      sharedWithTeamIds: [],
      status: "active",
      phone: "5550100142",
      preferredContact: "text",
      lastContactAt: dayAt(-2, 18, 20),
      createdAt: dayAt(-34, 11),
      updatedAt: dayAt(-2, 18, 20),
    },
    {
      id: "resident_demo_marcus",
      churchId: CHURCH_ID,
      propertyId: properties[1].id,
      name: "Marcus",
      faithStatus: "christian",
      discipleshipStage: "growing",
      assignedVolunteerId: "volunteer_jordan",
      createdByVolunteerId: "volunteer_jordan",
      sharedWithVolunteerIds: [],
      sharedWithTeamIds: [],
      status: "active",
      phone: "5550100178",
      preferredContact: "call",
      lastContactAt: dayAt(-6, 19),
      createdAt: dayAt(-72, 10),
      updatedAt: dayAt(-6, 19),
    },
    {
      id: "resident_demo_tasha",
      churchId: CHURCH_ID,
      propertyId: properties[8].id,
      name: "Tasha",
      faithStatus: "exploring",
      discipleshipStage: "building_relationship",
      assignedVolunteerId: "volunteer_erica",
      createdByVolunteerId: "volunteer_erica",
      sharedWithVolunteerIds: [],
      sharedWithTeamIds: [],
      status: "active",
      preferredContact: "none",
      lastContactAt: dayAt(-9, 16, 30),
      createdAt: dayAt(-19, 13),
      updatedAt: dayAt(-9, 16, 30),
    },
    {
      id: "resident_demo_daniel",
      churchId: CHURCH_ID,
      propertyId: properties[6].id,
      name: "Daniel",
      faithStatus: "not_discussed",
      discipleshipStage: "new_connection",
      assignedVolunteerId: "volunteer_sam",
      createdByVolunteerId: "volunteer_sam",
      sharedWithVolunteerIds: [],
      sharedWithTeamIds: [],
      status: "paused",
      preferredContact: "none",
      lastContactAt: dayAt(-26, 12),
      createdAt: dayAt(-26, 12),
      updatedAt: dayAt(-8, 10),
    },
  ];

  followUps.push(
    {
      id: "followup_person_elena",
      churchId: CHURCH_ID,
      propertyId: properties[0].id,
      residentId: "resident_demo_elena",
      dueAt: dayAt(2, 17),
      status: "scheduled",
      note: "Bring the Spanish-language Gospel of John she requested.",
      history: [{ id: "activity_person_elena", action: "created", note: "Bring the Spanish-language Gospel of John she requested.", dueAt: dayAt(2, 17), actorId: "volunteer_maya", createdAt: dayAt(-2, 18, 20) }],
      createdAt: dayAt(-2, 18, 20),
    },
    {
      id: "followup_person_marcus",
      churchId: CHURCH_ID,
      propertyId: properties[1].id,
      residentId: "resident_demo_marcus",
      dueAt: dayAt(5, 17),
      status: "scheduled",
      note: "Invite him to the Tuesday men’s table and introduce him to Noah.",
      history: [{ id: "activity_person_marcus", action: "created", note: "Invite him to the Tuesday men’s table and introduce him to Noah.", dueAt: dayAt(5, 17), actorId: "volunteer_jordan", createdAt: dayAt(-6, 19) }],
      createdAt: dayAt(-6, 19),
    },
    {
      id: "followup_person_tasha",
      churchId: CHURCH_ID,
      propertyId: properties[8].id,
      residentId: "resident_demo_tasha",
      dueAt: dayAt(-1, 17),
      status: "scheduled",
      note: "Check in after her mother’s appointment and ask how the church can help.",
      history: [{ id: "activity_person_tasha", action: "created", note: "Check in after her mother’s appointment and ask how the church can help.", dueAt: dayAt(-1, 17), actorId: "volunteer_erica", createdAt: dayAt(-9, 16, 30) }],
      createdAt: dayAt(-9, 16, 30),
    },
  );

  const personNotes: NeighborWalkData["personNotes"] = [
    {
      id: "person_note_demo_1",
      churchId: CHURCH_ID,
      residentId: "resident_demo_elena",
      authorId: "volunteer_maya",
      kind: "conversation",
      body: "Elena shared that she has been reading the Psalms with her aunt. She would like to understand how the Gospels connect to them.",
      createdAt: dayAt(-2, 18, 20),
    },
    {
      id: "person_note_demo_2",
      churchId: CHURCH_ID,
      residentId: "resident_demo_elena",
      authorId: "volunteer_erica",
      kind: "prayer",
      body: "Asked the team to pray for patience and wisdom as she cares for her aunt.",
      createdAt: dayAt(-11, 9, 15),
    },
    {
      id: "person_note_demo_3",
      churchId: CHURCH_ID,
      residentId: "resident_demo_marcus",
      authorId: "volunteer_jordan",
      kind: "milestone",
      body: "Marcus attended the community dinner and stayed afterward to help stack chairs. He asked about finding a consistent small group.",
      createdAt: dayAt(-6, 19),
    },
    {
      id: "person_note_demo_4",
      churchId: CHURCH_ID,
      residentId: "resident_demo_marcus",
      authorId: "volunteer_noah",
      kind: "conversation",
      body: "Talked through Mark 2 together and discussed how following Jesus reshapes ordinary work and friendships.",
      createdAt: dayAt(-18, 18, 15),
    },
    {
      id: "person_note_demo_5",
      churchId: CHURCH_ID,
      residentId: "resident_demo_tasha",
      authorId: "volunteer_erica",
      kind: "prayer",
      body: "Tasha asked for prayer for her mother’s upcoming appointment. She welcomed a check-in afterward.",
      createdAt: dayAt(-9, 16, 30),
    },
  ];

  // Nightly targets with fixed parcel rosters that match the seeded properties, so
  // crews, the address list, coverage tallies and the field map all agree.
  const demoTarget = (input: { id: string; territoryId: string; name: string; color: string; center: Coordinates; parcelIndexes: number[]; dx: number; dy: number }): NeighborWalkData["walkTargets"][number] => ({
    id: input.id,
    churchId: CHURCH_ID,
    eventId: EVENT_ID,
    territoryId: input.territoryId,
    name: input.name,
    color: input.color,
    selectionKind: "rectangle",
    geometry: { type: "Polygon", coordinates: [boundary(input.center, input.dx, input.dy)] },
    parcels: input.parcelIndexes.map((parcelIndex) => ({
      countyFips: DEMO_COUNTY_FIPS,
      gislink: demoParcelGislink(parcelIndex),
      datasetRevision: DEMO_PARCEL_REVISION,
      inclusionSource: "polygon_auto" as const,
      representativePoint: properties[parcelIndex].coordinates,
    })),
    rosterState: "frozen",
    frozenAt: dayAt(-1, 18),
  });
  const walkTargets = [
    demoTarget({ id: "target_demo_crockett_north", territoryId: territories[0].id, name: "Crockett north", color: "#286c59", center: [centers.east[0], centers.east[1] + 0.0018], parcelIndexes: [0, 1, 2, 3, 4, 5], dx: 0.0044, dy: 0.0013 }),
    demoTarget({ id: "target_demo_crockett_south", territoryId: territories[0].id, name: "Crockett south", color: "#6b91ad", center: [centers.east[0], centers.east[1] - 0.0011], parcelIndexes: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15], dx: 0.0044, dy: 0.0016 }),
    demoTarget({ id: "target_demo_westside", territoryId: territories[1].id, name: "Westside loop", color: "#b98231", center: centers.west, parcelIndexes: [], dx: 0.0024, dy: 0.0017 }),
  ];
  const targetProgress = properties.flatMap((property, index) => property.currentOutcome === "unvisited" || !property.parcel
    ? []
    : [{ targetId: index < 6 ? walkTargets[0].id : walkTargets[1].id, countyFips: property.parcel.countyFips, gislink: property.parcel.gislink }]);

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    walkTargets,
    targetProgress,
    parentProgress: [],
    coverageVisibility: "complete",
    church: {
      id: CHURCH_ID,
      name: "Grace Harbor Church",
      timezone: "America/Chicago",
      retentionDays: 365,
      defaultFollowUpDays: 3,
      noteCharacterLimit: 500,
      pathwayEnabled: false,
    },
    volunteers: [
      { id: "volunteer_erica", churchId: CHURCH_ID, name: "Erica", role: "leader", active: true },
      { id: "volunteer_maya", churchId: CHURCH_ID, name: "Maya", role: "volunteer", active: true },
      { id: "volunteer_jordan", churchId: CHURCH_ID, name: "Jordan", role: "volunteer", active: true },
      { id: "volunteer_sam", churchId: CHURCH_ID, name: "Sam", role: "volunteer", active: true },
      { id: "volunteer_noah", churchId: CHURCH_ID, name: "Noah", role: "volunteer", active: true },
      { id: "volunteer_ruth", churchId: CHURCH_ID, name: "Ruth", role: "volunteer", active: true },
      { id: "volunteer_eli", churchId: CHURCH_ID, name: "Eli", role: "volunteer", active: true },
    ],
    events: [{
      id: EVENT_ID,
      churchId: CHURCH_ID,
      name: "Saturday neighborhood outreach",
      startsAt: dayAt(0, 9, 30),
      endsAt: dayAt(0, 12),
      status: "active",
      timezone: "America/Chicago",
      purpose: "Listen to neighbors and follow through on the next steps they request.",
      meetingPoint: "Church welcome table, north entrance",
      leaderContact: "Erica at the welcome table",
    }],
    outingParticipants: ["volunteer_erica", "volunteer_maya", "volunteer_jordan", "volunteer_sam", "volunteer_noah", "volunteer_ruth", "volunteer_eli"].map((volunteerId, index) => ({
      id: `participant_demo_${index}`,
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      volunteerId,
      status: "checked_in" as const,
    })),
    territories,
    assignments: [
      { id: "assignment_demo_0", churchId: CHURCH_ID, eventId: EVENT_ID, territoryId: territories[0].id, targetId: walkTargets[0].id, assignedTeamId: "team_barnabas", status: "accepted" as const },
      { id: "assignment_demo_1", churchId: CHURCH_ID, eventId: EVENT_ID, territoryId: territories[0].id, targetId: walkTargets[1].id, assignedTeamId: "team_priscilla", status: "assigned" as const },
      { id: "assignment_demo_2", churchId: CHURCH_ID, eventId: EVENT_ID, territoryId: territories[1].id, targetId: walkTargets[2].id, assignedTeamId: "team_lydia", status: "assigned" as const },
    ],
    teams: [
      { id: "team_barnabas", churchId: CHURCH_ID, eventId: EVENT_ID, name: "Team Barnabas", memberIds: ["volunteer_erica", "volunteer_maya", "volunteer_jordan"], territoryIds: [territories[0].id], status: "active" },
      { id: "team_priscilla", churchId: CHURCH_ID, eventId: EVENT_ID, name: "Team Priscilla", memberIds: ["volunteer_sam", "volunteer_ruth"], territoryIds: [territories[1].id], status: "active" },
      { id: "team_lydia", churchId: CHURCH_ID, eventId: EVENT_ID, name: "Team Lydia", memberIds: ["volunteer_noah", "volunteer_eli"], territoryIds: [territories[2].id], status: "ready" },
    ],
    properties,
    visits,
    followUps: followUps.map((task) => ({ ...task,
      assignedVolunteerId: residents.find((person) => person.id === task.residentId)?.assignedVolunteerId ?? task.history[0]?.actorId ?? "volunteer_erica",
      acceptance: "accepted", channel: "visit", eventId: EVENT_ID, dueAt: calendarDate(task.dueAt, "America/Chicago"),
    })),
    residents,
    personNotes,
    guide: [
      {
        id: "guide_listen",
        order: 1,
        eyebrow: "Make room",
        title: "Listen for their story",
        coaching: "A sincere question is often more helpful than a memorized speech.",
        sampleWords: "Thank you for sharing that. Would it be okay if I told you briefly why prayer and Jesus have become important to me?",
        reminder: "Honor a no. If they say yes, keep your story brief and personal.",
        scriptureReferences: ["James 1:19"],
      },
      {
        id: "guide_gospel",
        order: 2,
        eyebrow: "Share clearly",
        title: "Explain the good news",
        coaching: "Use your church’s approved wording and avoid pressure or argument.",
        sampleWords: "Christians believe God loves us, that our brokenness separates us from him, and that Jesus came to reconcile us to God through his death and resurrection.",
        reminder: "Ask what they think instead of assuming what they believe.",
        scriptureReferences: ["Romans 3:23", "Romans 5:8", "Ephesians 2:8–9"],
      },
      {
        id: "guide_invite",
        order: 3,
        eyebrow: "Leave a next step",
        title: "Invite, don’t corner",
        coaching: "Offer a practical next step that matches the conversation.",
        sampleWords: "Would you like prayer now, a short follow-up conversation, or information about a gathering at the church?",
        reminder: "Record only what is needed for the requested next step.",
        scriptureReferences: ["Colossians 4:5–6"],
      },
    ],
    audit: visits.map((visit) => ({
      id: `audit_${visit.id}`,
      action: "visit.recorded",
      entityType: "visit" as const,
      entityId: visit.id,
      actorId: visit.volunteerId,
      createdAt: visit.recordedAt,
      summary: `${visit.outcome.replaceAll("_", " ")} recorded`,
    })),
    preferences: {
      activeEventId: EVENT_ID,
      activeTerritoryId: territories[0].id,
      activeVolunteerId: "volunteer_erica",
      mapStyleUrl: DEFAULT_MAP_STYLE_URL,
      mapStyleRevision: MAP_STYLE_CONFIGURATION_REVISION,
      compactMapMarkers: false,
      notificationsEnabled: false,
      lastView: "map",
    },
    sync: {
      mode: "device_only",
      pending: [],
    },
    updatedAt: now,
  };
}

/** The sample church as the app shows it: the live walk started a little over
 * an hour ago, tonight's doors are spread through it, an earlier walk left
 * smaller pins behind, and walks are coming up. Tests use `createSeedData`,
 * which stays fixed to the church calendar. */
export function createLiveSample(now = new Date()): NeighborWalkData {
  const data = createSeedData();
  const minute = 60_000;
  const start = new Date(Math.floor((now.getTime() - 72 * minute) / minute) * minute);
  const at = (minutes: number) => new Date(start.getTime() + minutes * minute).toISOString();
  const walk = data.events.find((event) => event.id === EVENT_ID)!;
  walk.name = "Saturday outreach";
  walk.startsAt = start.toISOString();
  walk.endsAt = at(150);
  const east = data.territories[0];
  const west = data.territories[1];
  const north = data.walkTargets.find((target) => target.id === "target_demo_crockett_north")!;
  const center = east.center!;

  // More doors on Crockett north, knocked tonight by Erica, Maya and Jordan.
  const extra: Array<[number, number, string, Exclude<NeighborWalkData["properties"][number]["currentOutcome"], "unvisited">, string]> = [
    [-0.0033, 0.0010, "201 Perry Boulevard", "conversation", "volunteer_erica"],
    [-0.0019, 0.0011, "207 Perry Boulevard", "no_answer", "volunteer_maya"],
    [-0.0005, 0.0010, "211 Gaines Street", "conversation", "volunteer_maya"],
    [0.0010, 0.0011, "213 Gaines Street", "no_answer", "volunteer_erica"],
    [0.0024, 0.0010, "217 Gaines Street", "conversation", "volunteer_jordan"],
    [-0.0026, 0.0031, "402 Perry Boulevard", "do_not_visit", "volunteer_jordan"],
    [0.0002, 0.0030, "221 Gaines Street", "no_answer", "volunteer_erica"],
    [0.0030, 0.0031, "229 Gaines Street", "no_answer", "volunteer_jordan"],
  ];
  extra.forEach(([dx, dy, address, outcome, volunteerId], index) => {
    const id = `property_live_${index + 1}`;
    const parcel = { countyFips: DEMO_COUNTY_FIPS, gislink: `099LIVE${String(index + 1).padStart(3, "0")}` };
    const coordinates: Coordinates = [center[0] + dx, center[1] + dy];
    data.properties.push({ id, churchId: CHURCH_ID, territoryId: east.id, address, coordinates, parcel, currentOutcome: outcome, visitCount: 1, createdAt: at(0), updatedAt: at(0), source: "map", createdByVolunteerId: volunteerId });
    north.parcels.push({ ...parcel, datasetRevision: DEMO_PARCEL_REVISION, inclusionSource: "manual_add", representativePoint: coordinates });
    data.visits.push({ id: `visit_live_${index + 1}`, churchId: CHURCH_ID, eventId: EVENT_ID, territoryId: east.id, propertyId: id, targetId: north.id, targetParcel: parcel, volunteerId, outcome, recordedAt: at(0), deviceId: "demo-device" });
  });

  // Tonight's doors, oldest first, from a few minutes in until a few minutes ago.
  const tonight = data.visits.filter((visit) => visit.eventId === EVENT_ID).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
  const step = Math.max(2, Math.floor(62 / Math.max(1, tonight.length)));
  tonight.forEach((visit, index) => { visit.recordedAt = at(6 + index * step); });

  // An earlier walk: the rest of the neighborhood, and Westside.
  const earlierId = "event_late_summer";
  const earlier = (days: number, hour: number, minutes = 0) => dayAt(days, hour, minutes);
  data.events.push({ id: earlierId, churchId: CHURCH_ID, name: "Late summer walk", startsAt: earlier(-26, 9, 30), endsAt: earlier(-26, 11, 30), status: "completed", timezone: "America/Chicago", meetingPoint: "Church welcome table, north entrance", leaderContact: "Erica at the welcome table", debrief: "Start on Perry. Gaines was mostly no answer before 10." });
  const westHomes: Array<[number, number, string]> = [[-0.0012, 0.0008, "118 Westview Drive"], [0.0004, 0.0009, "124 Westview Drive"], [0.0016, -0.0006, "131 Westview Drive"]];
  westHomes.forEach(([dx, dy, address], index) => data.properties.push({ id: `property_west_${index + 1}`, churchId: CHURCH_ID, territoryId: west.id, address, coordinates: [west.center![0] + dx, west.center![1] + dy], currentOutcome: "unvisited", visitCount: 0, createdAt: earlier(-26, 9), updatedAt: earlier(-26, 9), source: "map" }));
  const earlierVisits: Array<[string, Exclude<NeighborWalkData["properties"][number]["currentOutcome"], "unvisited">, string, number]> = [
    ["property_demo_05", "no_answer", "volunteer_noah", 10], ["property_demo_06", "conversation", "volunteer_sam", 14],
    ["property_demo_10", "no_answer", "volunteer_ruth", 20], ["property_demo_12", "do_not_visit", "volunteer_noah", 25],
    ["property_demo_13", "conversation", "volunteer_sam", 31], ["property_demo_14", "no_answer", "volunteer_ruth", 36],
    ["property_demo_15", "declined", "volunteer_noah", 42], ["property_demo_16", "no_answer", "volunteer_sam", 47],
    ["property_demo_09", "conversation", "volunteer_erica", 55], ["property_demo_01", "no_answer", "volunteer_eli", 60],
    ["property_west_1", "conversation", "volunteer_erica", 70], ["property_west_2", "no_answer", "volunteer_eli", 76], ["property_west_3", "declined", "volunteer_erica", 81],
  ];
  earlierVisits.forEach(([propertyId, outcome, volunteerId, minutes], index) => {
    const home = data.properties.find((property) => property.id === propertyId)!;
    const recordedAt = earlier(-26, 9, 30 + minutes);
    data.visits.push({ id: `visit_earlier_${index + 1}`, churchId: CHURCH_ID, eventId: earlierId, territoryId: home.territoryId, propertyId, volunteerId, outcome, objectiveNote: propertyId === "property_demo_09" ? "Met Tasha" : undefined, recordedAt, deviceId: "demo-device" });
    home.visitCount += 1;
    if (home.currentOutcome === "unvisited") { home.currentOutcome = outcome; home.lastVisitedAt = recordedAt; home.updatedAt = recordedAt; }
  });
  for (const home of data.properties) {
    const latest = data.visits.filter((visit) => visit.propertyId === home.id).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    if (latest) { home.lastVisitedAt = latest.recordedAt; home.updatedAt = latest.recordedAt; }
  }

  // Walks coming up: one ready with invitations out, and a draft.
  const ready = "event_westside_prayer";
  data.events.push(
    { id: ready, churchId: CHURCH_ID, name: "Westside prayer walk", startsAt: dayAt(2, 9, 30), endsAt: dayAt(2, 11, 30), status: "ready", timezone: "America/Chicago", purpose: "Pray for the neighborhood and listen well.", meetingPoint: "Church welcome table", leaderContact: "Erica" },
    { id: "event_shoal_creek", churchId: CHURCH_ID, name: "Shoal Creek fall walk", startsAt: dayAt(9, 9, 30), endsAt: dayAt(9, 11, 30), status: "draft", timezone: "America/Chicago", purpose: "Meet our neighbors.", meetingPoint: "Church welcome table", leaderContact: "Erica" },
  );
  const westParcels = data.properties.filter((property) => property.territoryId === west.id);
  westParcels.forEach((home, index) => { home.parcel = { countyFips: DEMO_COUNTY_FIPS, gislink: `099WEST${String(index + 1).padStart(3, "0")}` }; });
  data.walkTargets.push({ id: "target_westside_prayer", churchId: CHURCH_ID, eventId: ready, territoryId: west.id, name: "Westside loop", color: "#6b91ad", selectionKind: "rectangle",
    geometry: { type: "Polygon", coordinates: [boundary(west.center!, 0.0024, 0.0017)] },
    parcels: westParcels.map((home) => ({ ...home.parcel!, datasetRevision: DEMO_PARCEL_REVISION, inclusionSource: "polygon_auto" as const, representativePoint: home.coordinates })),
    rosterState: "frozen", frozenAt: dayAt(-1, 18) });
  data.assignments = [...(data.assignments ?? []), { id: "assignment_westside_prayer", churchId: CHURCH_ID, eventId: ready, territoryId: west.id, targetId: "target_westside_prayer", assignedTeamId: "team_priscilla", status: "assigned" }];
  const replies: Array<[string, NeighborWalkData["outingParticipants"][number]["status"]]> = [["volunteer_erica", "going"], ["volunteer_maya", "invited"], ["volunteer_jordan", "going"], ["volunteer_sam", "not_going"], ["volunteer_ruth", "going"], ["volunteer_noah", "going"], ["volunteer_eli", "invited"]];
  replies.forEach(([volunteerId, status], index) => data.outingParticipants.push({ id: `participant_westside_${index}`, churchId: CHURCH_ID, eventId: ready, volunteerId, status }));
  // Tonight's crews are named for their routes; the church's saved teams are separate.
  for (const team of data.teams) {
    const assignment = data.assignments?.find((item) => item.assignedTeamId === team.id && item.targetId);
    const target = data.walkTargets.find((item) => item.id === assignment?.targetId);
    if (target) team.name = `${target.name} crew`;
  }
  data.teams.push(
    { id: "team_saved_barnabas", churchId: CHURCH_ID, name: "Team Barnabas", memberIds: ["volunteer_erica", "volunteer_maya", "volunteer_jordan"], territoryIds: [], status: "ready" },
    { id: "team_saved_priscilla", churchId: CHURCH_ID, name: "Team Priscilla", memberIds: ["volunteer_sam", "volunteer_ruth"], territoryIds: [], status: "ready" },
  );
  // Two follow-ups from the earlier walk that still need an owner (the Open queue).
  const dolores = { id: "resident_live_dolores", churchId: CHURCH_ID, name: "Dolores", faithStatus: "not_discussed" as const, discipleshipStage: "new_connection" as const, assignedVolunteerId: "volunteer_erica", createdByVolunteerId: "volunteer_erica", sharedWithVolunteerIds: [], sharedWithTeamIds: [], status: "active" as const, phone: "5550100199", preferredContact: "call" as const, contactPermission: "requested" as const, lastContactAt: earlier(-26, 10, 50), createdAt: earlier(-26, 10, 50), updatedAt: earlier(-26, 10, 50) };
  data.residents.push(dolores);
  const openTask = (id: string, fields: Partial<NeighborWalkData["followUps"][number]>, note: string, due: number) => ({ id, churchId: CHURCH_ID, eventId: earlierId, dueAt: calendarDaysFromNow(due, DEFAULT_CHURCH_TIMEZONE), status: "scheduled" as const, note, acceptance: "accepted" as const,
    history: [{ id: `${id}_created`, action: "created" as const, note, dueAt: calendarDaysFromNow(due, DEFAULT_CHURCH_TIMEZONE), actorId: "volunteer_noah", createdAt: earlier(-26, 10, 55) }], createdAt: earlier(-26, 10, 55), ...fields });
  data.followUps.push(
    openTask("followup_live_open_home", { propertyId: "property_demo_10", channel: "visit" }, "Bring the pantry schedule", 1),
    openTask("followup_live_open_dolores", { residentId: dolores.id, channel: "call" }, "Pray before her surgery", 4),
  );
  // Erica cares for the people she met; Tasha gave a cell for texts.
  for (const person of data.residents) {
    if (["resident_demo_elena", "resident_demo_marcus"].includes(person.id)) person.assignedVolunteerId = "volunteer_erica";
    if (person.id === "resident_demo_tasha") Object.assign(person, { phone: "5550142231", preferredContact: "text" });
  }
  const metTasha = data.visits.find((visit) => visit.id === "visit_earlier_9");
  if (metTasha) metTasha.residentId = "resident_demo_tasha";
  // Conversations logged with + away from doors.
  const away: Array<[string, NeighborWalkData["visits"][number]["context"], string, string | undefined, "conversation" | "follow_up", string | undefined, NeighborWalkData["visits"][number]["needs"], number]> = [
    ["visit_away_lot", "other", "Church lot", "resident_demo_marcus", "conversation", "Asked about the pantry", ["food"], -3],
    ["visit_away_drive", "service", "Food drive", dolores.id, "follow_up", "Pray before surgery", ["prayer", "health"], -5],
    ["visit_away_meal", "community_meal", "Community meal", "resident_demo_elena", "conversation", "Came with her aunt", undefined, -8],
    ["visit_away_store", "other", "Corner store", undefined, "conversation", undefined, undefined, -11],
  ];
  away.forEach(([id, context, placeLabel, residentId, outcome, objectiveNote, needs, days]) => data.visits.push({ id, churchId: CHURCH_ID, residentId, context, placeLabel, volunteerId: "volunteer_erica", outcome, objectiveNote, needs, recordedAt: dayAt(days, 12, 15), deviceId: "demo-device" }));
  data.audit = data.visits.map((visit) => ({ id: `audit_${visit.id}`, action: "visit.recorded", entityType: "visit" as const, entityId: visit.id, actorId: visit.volunteerId, createdAt: visit.recordedAt, summary: `${visit.outcome.replaceAll("_", " ")} recorded` }));
  return data;
}
