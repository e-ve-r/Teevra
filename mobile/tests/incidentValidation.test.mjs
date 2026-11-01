import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft } from '../src/lib/incidentValidation.ts';
const valid = { description: 'Car crash', attachmentCount: 0, isUpdate: false, phone: '+91 98765 43210', address: 'Main road', hasLocation: false };
test('accepts text with manual address or captured location', () => {
  assert.equal(validateDraft(valid), null);
  assert.equal(validateDraft({ ...valid, address: '', hasLocation: true }), null);
});
test('accepts a media-only initial report and update', () => {
  assert.equal(validateDraft({ ...valid, description: '', attachmentCount: 1 }), null);
  assert.equal(validateDraft({ ...valid, description: '', attachmentCount: 1, isUpdate: true, phone: '', address: '', hasLocation: false }), null);
});
test('does not accept empty reports or updates', () => {
  assert.match(validateDraft({ ...valid, description: ' ', isUpdate: true }), /Describe/);
  assert.match(validateDraft({ ...valid, description: '', attachmentCount: 0 }), /Describe/);
});
test('requires a usable phone and address or coordinates for a new report', () => {
  assert.match(validateDraft({ ...valid, phone: '12---34' }), /mobile number/);
  assert.match(validateDraft({ ...valid, phone: '1234567890123456' }), /mobile number/);
  assert.match(validateDraft({ ...valid, address: ' ', hasLocation: false }), /address/);
});
test('updates do not ask for phone or location again', () => {
  assert.equal(validateDraft({ ...valid, isUpdate: true, phone: '', address: '', hasLocation: false }), null);
});
