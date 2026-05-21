import crypto from 'crypto';
import { redis } from './memory';

export interface Incident {
  id: string;
  service: string;
  symptom: string;
  evidence: string;
  actionTaken: string;
  result: string;
  timestamp: number;
}

const KEY = 'veronica:incidents';
const MAX = 50;

export async function logIncident(
  data: Omit<Incident, 'id' | 'timestamp'>
): Promise<void> {
  const incident: Incident = {
    ...data,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  await redis.lpush(KEY, JSON.stringify(incident));
  await redis.ltrim(KEY, 0, MAX - 1);
}

export async function getRecentIncidents(count = 10): Promise<Incident[]> {
  const raw = await redis.lrange(KEY, 0, count - 1);
  return raw
    .map(r => { try { return JSON.parse(r); } catch { return null; } })
    .filter(Boolean);
}

export async function getIncidentsSince(sinceMs: number): Promise<Incident[]> {
  const all = await getRecentIncidents(MAX);
  return all.filter(i => i.timestamp >= sinceMs);
}

export async function getIncidentsForService(
  service: string,
  count = 5
): Promise<Incident[]> {
  const all = await getRecentIncidents(MAX);
  return all
    .filter(i => i.service.toLowerCase() === service.toLowerCase())
    .slice(0, count);
}

export function formatIncidents(incidents: Incident[]): string {
  if (!incidents.length) return 'None';
  return incidents.map(i => {
    const ts = new Date(i.timestamp).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
    return `[${ts}] ${i.service}: ${i.symptom} → ${i.actionTaken} → ${i.result}`;
  }).join('\n');
}
