const CURRENT_KEY = "teevra.chat.current";
const ARCHIVE_PREFIX = "teevra.chat.archive.";

export function loadChatHistory(storage) {
  try {
    const messages = JSON.parse(storage.getItem(CURRENT_KEY) || "[]");
    return Array.isArray(messages)
      ? messages.filter(
          (message) =>
            message &&
            typeof message.id === "string" &&
            ["user", "assistant"].includes(message.from) &&
            typeof message.text === "string" &&
            message.text.trim(),
        )
        .map((message) => message.updateStatus === "sending" ? { ...message, updateStatus: "failed" } : message)
      : [];
  } catch {
    return [];
  }
}

export function saveChatHistory(storage, messages) {
  try {
    storage.setItem(CURRENT_KEY, JSON.stringify(messages));
    return true;
  } catch {
    return false;
  }
}

export function archiveChatHistory(storage) {
  try {
    const current = storage.getItem(CURRENT_KEY);
    if (current && current !== "[]")
      storage.setItem(`${ARCHIVE_PREFIX}${crypto.randomUUID()}`, current);
    storage.removeItem(CURRENT_KEY);
    return true;
  } catch {
    return false;
  }
}
