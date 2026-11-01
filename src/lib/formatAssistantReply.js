const labels = {
  report_id: "Report", incident_id: "Report", id: "Report",
  status: "Status", unit: "Unit", unit_name: "Unit", name: "Name",
  eta: "ETA", eta_minutes: "ETA", route_eta_minutes: "Route ETA",
  assigned_eta_minutes: "ETA at assignment", updated_at: "Last update",
  position_updated_at: "Position updated", location: "Location",
};
const statuses = {
  pending_triage: "Assessing report", triage_complete: "Awaiting assignment",
  dispatched: "Assigned", en_route: "On the way", on_scene: "On scene",
  resolved: "Resolved", cancelled: "Cancelled",
};

function readableValue(value, key) {
  if (value === null || value === "") return "Unavailable";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && /eta.*minutes|minutes.*eta/i.test(key)) return `${value} minutes`;
  if (typeof value !== "string") return String(value);
  if (key === "status" && statuses[value]) return statuses[value];
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value) && !Number.isNaN(Date.parse(value))) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }
  return value;
}

export function formatAssistantReply(text) {
  const trimmed = text.trim();
  const json = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (json.startsWith("{") && json.endsWith("}")) {
    try {
      const value = JSON.parse(json);
      const lines = [];
      function visit(item, prefix = "") {
        if (Array.isArray(item)) {
          if (!item.length) lines.push(`• ${prefix}: None`);
          else item.forEach((entry) => visit(entry, prefix));
        } else if (item && typeof item === "object") {
          for (const [key, entry] of Object.entries(item)) {
            const label = labels[key] || key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
            const next = prefix ? `${prefix} — ${label}` : label;
            if (entry && typeof entry === "object") visit(entry, next);
            else lines.push(`• ${next}: ${readableValue(entry, key)}`);
          }
        }
      }
      visit(value);
      if (lines.length) return lines.join("\n");
    } catch {
      // Keep ordinary text intact if it is not valid JSON.
    }
  }
  return trimmed.replace(/\*\*/g, "").replace(/^(\s*)[*-]\s+/gm, "$1• ");
}
