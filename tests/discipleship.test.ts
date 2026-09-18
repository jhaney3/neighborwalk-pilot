import { describe, expect, it } from "vitest";
import {
  userIdForVolunteer,
  volunteerIdForUser,
  withAuthenticatedVolunteer,
} from "../lib/discipleship";
import { createSeedData } from "../lib/seed";

describe("protected discipleship records", () => {
  it("converts authenticated users to stable volunteer identifiers", () => {
    const userId = "fc77fe56-7784-4b60-9be8-3005bb250c6b";
    expect(userIdForVolunteer(volunteerIdForUser(userId))).toBe(userId);
    expect(userIdForVolunteer("volunteer_demo")).toBeNull();
  });

  it("adds the signed-in member to older volunteer directories", () => {
    const data = createSeedData();
    const userId = "fc77fe56-7784-4b60-9be8-3005bb250c6b";
    const connected = withAuthenticatedVolunteer(data, {
      churchId: data.church.id,
      userId,
      role: "volunteer",
      email: "volunteer@example.org",
      displayName: "Current Volunteer",
    });

    expect(connected.volunteers.find((volunteer) => volunteer.id === volunteerIdForUser(userId))).toMatchObject({
      name: "Current Volunteer",
      email: "volunteer@example.org",
      active: true,
    });
  });

});
