export function publicSiteConfig(env: Record<string, string | undefined> = process.env) {
  const operator = env.NEIGHBORWALK_OPERATOR_NAME?.trim() || "";
  const candidate = env.NEIGHBORWALK_SUPPORT_EMAIL?.trim() || "";
  const supportEmail = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(candidate) ? candidate : "";
  const policiesApproved = env.NEIGHBORWALK_POLICIES_APPROVED === "true" && Boolean(operator && supportEmail);
  return { operator, supportEmail, policiesApproved,
    pilotOpen: policiesApproved && env.NEIGHBORWALK_PILOT_OPEN === "true" };
}
