import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { defaultApiBase, getIncident, getIncidentMap, post, setApiBase } from '../lib/api';
import type { Attachment, Coordinates, Incident, IncidentMap } from '../lib/types';

type CreateReport = Partial<Coordinates> & { reporter_name: string; reporter_phone: string; location_name: string; description: string; attachments: Attachment[] };
type ReporterState = {
  ready: boolean; report: Incident | null; reportId: string | null; map: IncidentMap | null; name: string; apiBase: string; error: string; notice: string;
  setNotice: (value: string) => void; saveName: (value: string) => Promise<void>; saveApiBase: (value: string) => Promise<void>;
  createReport: (payload: CreateReport) => Promise<void>; updateReport: (payload: { description: string; attachments?: Attachment[] }) => Promise<void>; refresh: () => Promise<void>;
};
const ReporterContext = createContext<ReporterState | null>(null);
export function ReporterProvider({ children }: { children: ReactNode }) {
  const fetchSequence = useRef(0);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('Reporter');
  const [apiBase, setBase] = useState(defaultApiBase);
  const [reportId, setReportId] = useState<string | null>(null);
  const [report, setReport] = useState<Incident | null>(null);
  const [map, setMap] = useState<IncidentMap | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [savedBase, savedName, savedId] = await Promise.all(['teevra.api', 'teevra.name', 'teevra.incident'].map(k => SecureStore.getItemAsync(k)));
        if (cancelled) return;
        if (savedBase) { try { setBase(setApiBase(savedBase)); } catch { setError('The saved server address is invalid. Update it in Profile.'); } }
        if (savedName) setName(savedName);
        if (savedId) setReportId(savedId);
      } catch { if (!cancelled) setError('Could not restore your saved settings on this device.'); }
      finally { if (!cancelled) setReady(true); }
    }
    load(); return () => { cancelled = true; };
  }, []);
  const refresh = useCallback(async () => {
    if (!reportId) return;
    const sequence = ++fetchSequence.current;
    try {
      const updated = await getIncident(reportId);
      if (sequence !== fetchSequence.current) return;
      setReport(current => current && current.id === updated.id && current.revision > updated.revision ? current : updated);
      setError('');
      const nextMap = await getIncidentMap(reportId).catch(() => null);
      if (sequence === fetchSequence.current && nextMap) setMap(nextMap);
    } catch (failure) { if (sequence === fetchSequence.current) setError(failure instanceof Error ? failure.message : 'Could not refresh your report.'); }
  }, [reportId]);
  useEffect(() => {
    if (!ready || !reportId) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!cancelled) timer = setTimeout(poll, 5000); };
    poll();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const sequenceRef = fetchSequence;
    return () => { cancelled = true; sequenceRef.current++; clearTimeout(timer); subscription.remove(); };
  }, [ready, reportId, refresh, apiBase]);
  async function saveName(value: string) {
    const cleaned = value.trim(); if (!cleaned) throw new Error('Enter a name.');
    await SecureStore.setItemAsync('teevra.name', cleaned); setName(cleaned);
  }
  async function saveApiBase(value: string) {
    const previous = apiBase;
    const clean = setApiBase(value);
    try {
      if (clean !== previous) {
        fetchSequence.current++;
        await SecureStore.deleteItemAsync('teevra.incident');
      }
      await SecureStore.setItemAsync('teevra.api', clean);
    } catch (failure) {
      setApiBase(previous);
      // Restore the old report association if saving the new settings failed.
      if (reportId) await SecureStore.setItemAsync('teevra.incident', reportId).catch(() => {});
      throw failure;
    }
    if (clean !== previous) { setReportId(null); setReport(null); setMap(null); }
    setBase(clean); setError('');
  }
  async function createReport(payload: CreateReport) {
    const created = await post<Incident>('/api/incidents', payload);
    fetchSequence.current++; setReport(created); setReportId(created.id); setMap(null);
    try { await SecureStore.setItemAsync('teevra.incident', created.id); setNotice('Your report was saved. You can send updates here.'); }
    catch { setNotice(`Report ${created.id} was saved, but could not be stored on this device. Keep the report ID.`); }
  }
  async function updateReport(payload: { description: string; attachments?: Attachment[] }) {
    if (!reportId) throw new Error('Submit a report before sending an update.');
    const updated = await post<Incident>(`/api/incidents/${encodeURIComponent(reportId)}/updates`, { description: payload.description, attachments: payload.attachments || [] });
    fetchSequence.current++; setReport(updated); setNotice('Update saved and reassessed.');
  }
  const value = { ready, report, reportId, map, name, apiBase, error, notice, setNotice, saveName, saveApiBase, createReport, updateReport, refresh };
  return <ReporterContext.Provider value={value}>{children}</ReporterContext.Provider>;
}
export function useReporter() { const value = useContext(ReporterContext); if (!value) throw new Error('ReporterProvider missing'); return value; }
