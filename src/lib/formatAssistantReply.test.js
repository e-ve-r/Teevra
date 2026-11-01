import test from "node:test";
import assert from "node:assert/strict";
import { formatAssistantReply } from "./formatAssistantReply.js";

test("formats a JSON status reply without exposing raw JSON", () => {
  const result = formatAssistantReply('{"incident_id":"TVR-123","status":"en_route","unit":{"name":"Ambulance"},"route_eta_minutes":null}');
  assert.match(result, /Report: TVR-123/);
  assert.match(result, /Status: On the way/);
  assert.match(result, /Unit — Name: Ambulance/);
  assert.match(result, /Route ETA: Unavailable/);
  assert.doesNotMatch(result, /[{}]/);
});

test("formats natural replies and leaves ordinary text alone", () => {
  assert.equal(formatAssistantReply('Status:\n* **Unit:** Ambulance'), 'Status:\n• Unit: Ambulance');
  assert.equal(formatAssistantReply('How are you feeling?'), 'How are you feeling?');
});
