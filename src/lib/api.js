export const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(
  /\/$/,
  "",
);
export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error(
      "Cannot connect to Teevra. Check your connection and try again.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : "The request could not be saved. Check the details and try again.",
    );
  return data;
}
export function post(path, data, method = "POST") {
  return api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
export async function uploadAttachments(files) {
  const uploaded = [];
  for (const file of files) {
    if (file.uploaded) {
      uploaded.push(file.uploaded);
      continue;
    }
    const body = new FormData();
    body.append("file", file.file, file.name);
    const result = await api("/api/upload", { method: "POST", body });
    file.uploaded = result;
    uploaded.push(result);
  }
  return uploaded;
}
export function mediaUrl(url) {
  return url?.startsWith("/uploads/") ? `${API_BASE}${url}` : url;
}
export const statusLabel = (status) =>
  ({
    pending_triage: "Assessing report",
    triage_complete: "Awaiting assignment",
    dispatched: "Assigned",
    en_route: "On the way",
    on_scene: "On scene",
    resolved: "Resolved",
    cancelled: "Cancelled",
  })[status] || status;
