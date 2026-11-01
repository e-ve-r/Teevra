export type ReportDraft = { description: string; attachmentCount: number; isUpdate: boolean; phone: string; address: string; hasLocation: boolean };

/** Check only facts the client can reliably verify; the backend validates the payload too. */
export function validateDraft(draft: ReportDraft): string | null {
  if (!draft.description.trim() && draft.attachmentCount === 0) return 'Describe what happened or add a photo or voice note.';
  if (draft.isUpdate) return null;
  const phone = draft.phone.trim();
  const digits = phone.replace(/\D/g, '').length;
  if (!/^\+?[\d\s()-]{7,22}$/.test(phone) || digits < 7 || digits > 15) return 'Enter a valid mobile number, including country code.';
  if (!draft.address.trim() && !draft.hasLocation) return 'Enter an incident address, use GPS, or choose a map pin.';
  return null;
}
