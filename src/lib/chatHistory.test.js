import test from "node:test";
import assert from "node:assert/strict";
import { archiveChatHistory, loadChatHistory, saveChatHistory } from "./chatHistory.js";

test("history survives reload and is archived when starting a new report", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
  const history = [{ id: "1", from: "user", text: "I fell" }, { id: "2", from: "assistant", text: "Where are you?" }];
  assert.equal(saveChatHistory(storage, history), true);
  assert.deepEqual(loadChatHistory(storage), history);
  assert.equal(archiveChatHistory(storage), true);
  assert.deepEqual(loadChatHistory(storage), []);
  assert.deepEqual(JSON.parse([...data.values()][0]), history);
});

test("storage failures are reported without throwing", () => {
  const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(loadChatHistory(storage), []);
  assert.equal(saveChatHistory(storage, []), false);
  assert.equal(archiveChatHistory(storage), false);
});
