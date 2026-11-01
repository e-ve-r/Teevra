import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { Attachment, ChatMessage, Incident, IncidentMap, LocalAttachment } from './types';
import { requestWithBase } from './transport';

const configuredBase = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const host = Constants.expoConfig?.hostUri?.split(':')[0];
export const defaultApiBase = configuredBase || (__DEV__ && host ? `http://${host}:8000` : Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000');
let base = defaultApiBase.replace(/\/$/, '');
export function setApiBase(value: string) {
  const parsed = new URL(value.trim());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Enter an HTTP or HTTPS server address.');
  base = parsed.toString().replace(/\/$/, '');
  return base;
}
export function getApiBase() { return base; }
export function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestWithBase<T>(base, path, options);
}

export function post<T>(path: string, data: unknown) {
  return request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}
export async function uploadAttachments(files: LocalAttachment[]): Promise<Attachment[]> {
  const uploaded: Attachment[] = [];
  for (const file of files) {
    if (file.uploaded) { uploaded.push(file.uploaded); continue; }
    const body = new FormData();
    // React Native's FormData implementation accepts a URI descriptor as a file.
    body.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    const result = await request<Attachment>('/api/upload', { method: 'POST', body });
    file.uploaded = result;
    uploaded.push(result);
  }
  return uploaded;
}
export const getIncident = (id: string) => request<Incident>(`/api/incidents/${encodeURIComponent(id)}`);
export const getIncidentMap = (id: string) => request<IncidentMap>(`/api/incidents/${encodeURIComponent(id)}/map`);
export function askAssistant(messages: ChatMessage[], report: Incident | null) {
  return post<{ reply: string }>('/api/chat', { messages: messages.slice(-8).map(m => ({ ...m, content: m.content.slice(0, 2000) })), context: { remaining_seconds: 0, tracking_started: false, has_report: !!report, attachment_count: report?.attachments?.length || 0 } });
}
