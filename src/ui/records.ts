import type { NationId } from '../config/nations';
import type { RoleId } from '../config/roles';
import { roleName } from '../config/roles';

/** Your record over matches, kept in this browser only (nothing leaves the device). */
interface Records { played: number; wins: number; draws: number; captures: number; rescues: number; byRole: Partial<Record<RoleId, { played: number; wins: number }>>; streak: number; best: number }

const KEY = 'sangoku.records.v1';
const empty = (): Records => ({ played: 0, wins: 0, draws: 0, captures: 0, rescues: 0, byRole: {}, streak: 0, best: 0 });

export function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch { return empty(); }
}

/** Adds one finished match; returns the updated record. */
export function recordMatch(role: RoleId, nation: NationId, winner: NationId | 'draw' | null, captures: number, rescues: number): Records {
  const r = loadRecords();
  const won = winner === nation, draw = winner === 'draw' || !winner;
  r.played++;
  if (won) r.wins++;
  if (draw) r.draws++;
  r.captures += captures;
  r.rescues += rescues;
  const br = r.byRole[role] ?? { played: 0, wins: 0 };
  br.played++;
  if (won) br.wins++;
  r.byRole[role] = br;
  r.streak = won ? r.streak + 1 : 0;
  r.best = Math.max(r.best, r.streak);
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* private mode: keep it for this screen only */ }
  return r;
}

/** One line for the result screen or the title. */
export function recordLine(r: Records, role?: RoleId): string {
  if (!r.played) return 'まだ戦績はありません';
  const pct = Math.round((r.wins / r.played) * 100);
  let s = `通算 ${r.played}戦 ${r.wins}勝（勝率${pct}%）・捕獲${r.captures}・救出${r.rescues}`;
  if (r.streak >= 2) s += `・${r.streak}連勝中`;
  if (r.best >= 2) s += `（最高${r.best}連勝）`;
  const br = role ? r.byRole[role] : undefined;
  if (role && br) s += `\n${roleName(role)}：${br.played}戦 ${br.wins}勝`;
  return s;
}
