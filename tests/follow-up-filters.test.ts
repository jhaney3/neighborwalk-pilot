import { expect, it } from "vitest";
import { activeFollowUpOwner, followUpsHref, taskMatchesScope } from "../lib/follow-up-filters";
import { createSeedData } from "../lib/seed";
it("distinguishes task links, person-filter links, and the exact leader exception queue", () => {
  expect(followUpsHref("task-one")).toBe("/app/followups/task-one");
  expect(followUpsHref(undefined, "person-one")).toBe("/app/followups?person=person-one");
  expect(followUpsHref(undefined, undefined, "unowned")).toBe("/app/followups?scope=unowned");
  const data = createSeedData(); const task = { ...data.followUps[0], assignedVolunteerId: "inactive-member" };
  expect(taskMatchesScope(task, "unowned", data, "me")).toBe(true);
  expect(activeFollowUpOwner(task, data)).toBeUndefined();
  expect(taskMatchesScope(task, "mine", data, "me")).toBe(false);
  expect(taskMatchesScope({ ...task, acceptance: "declined" }, "declined", data, "me")).toBe(true);
  expect(activeFollowUpOwner(data.followUps[0], data)?.active).toBe(true);
});
