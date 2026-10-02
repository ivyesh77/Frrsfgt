import type { PoolClient } from 'pg';
import { query, withDatabaseTransaction } from './database.js';

export interface DurableRoomRecord {
  id: string;
  gameKind: string;
  format: string;
  entryFee: string;
  status: string;
  state: Record<string, unknown>;
  stateVersion: number;
}

export interface DurableMatchRecord {
  id: string;
  roomId: string;
  status: string;
  result: Record<string, unknown> | null;
}

function roomFromRow(row: { id: string; format: string; entry_fee: string; status: string; state: Record<string, unknown>; state_version: string | number }): DurableRoomRecord {
  const state = row.state ?? {};
  return {
    id: row.id,
    gameKind: typeof state.gameKind === 'string' ? state.gameKind : 'unknown',
    format: row.format,
    entryFee: row.entry_fee,
    status: row.status,
    state,
    stateVersion: Number(row.state_version),
  };
}

/**
 * PostgreSQL room/match repository contract. It is deliberately separate from the current
 * synchronous RoomManager: production wiring must make the transition explicit rather than
 * quietly writing a second partial authority. Queue claims use row locks and SKIP LOCKED;
 * saves use optimistic state versions so two API instances cannot overwrite one another.
 */
export async function createDurableRoom(input: {
  id: string;
  gameKind: string;
  format: string;
  entryFee: string;
  state?: Record<string, unknown>;
}): Promise<DurableRoomRecord> {
  const state = { ...(input.state ?? {}), gameKind: input.gameKind };
  const result = await query<{ id: string; format: string; entry_fee: string; status: string; state: Record<string, unknown>; state_version: string | number }>(
    'INSERT INTO rooms (id, format, entry_fee, status, state) VALUES ($1, $2, $3, $4, $5) RETURNING id, format, entry_fee, status, state, state_version',
    [input.id, input.format, input.entryFee, 'queued', JSON.stringify(state)],
  );
  return roomFromRow(result.rows[0]!);
}

export async function claimOpenRoom(format: string, entryFee: string): Promise<DurableRoomRecord | null> {
  return withDatabaseTransaction(async (client) => {
    const result = await client.query<{ id: string; format: string; entry_fee: string; status: string; state: Record<string, unknown>; state_version: string | number }>(
      `SELECT id, format, entry_fee, status, state, state_version
       FROM rooms
       WHERE format = $1 AND entry_fee = $2 AND status IN ('queued', 'ready_check')
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [format, entryFee],
    );
    return result.rows[0] ? roomFromRow(result.rows[0]) : null;
  });
}

export async function loadDurableRoom(id: string, client?: PoolClient): Promise<DurableRoomRecord | null> {
  const sql = 'SELECT id, format, entry_fee, status, state, state_version FROM rooms WHERE id = $1';
  const result = client
    ? await client.query<{ id: string; format: string; entry_fee: string; status: string; state: Record<string, unknown>; state_version: string | number }>(sql, [id])
    : await query<{ id: string; format: string; entry_fee: string; status: string; state: Record<string, unknown>; state_version: string | number }>(sql, [id]);
  return result.rows[0] ? roomFromRow(result.rows[0]) : null;
}

export async function saveDurableRoom(input: {
  id: string;
  status: string;
  state: Record<string, unknown>;
  expectedStateVersion: number;
}): Promise<DurableRoomRecord> {
  return withDatabaseTransaction(async (client) => {
    const result = await client.query<{ id: string; format: string; entry_fee: string; status: string; state: Record<string, unknown>; state_version: string | number }>(
      `UPDATE rooms
       SET status = $2, state = $3, state_version = state_version + 1, updated_at = now()
       WHERE id = $1 AND state_version = $4
       RETURNING id, format, entry_fee, status, state, state_version`,
      [input.id, input.status, JSON.stringify(input.state), input.expectedStateVersion],
    );
    if (!result.rows[0]) throw new Error('Room state version conflict; reload before applying this command');
    return roomFromRow(result.rows[0]);
  });
}

export async function createDurableMatch(input: { id: string; roomId: string }): Promise<DurableMatchRecord> {
  const result = await query<{ id: string; room_id: string; status: string; result: Record<string, unknown> | null }>(
    "INSERT INTO matches (id, room_id, status) VALUES ($1, $2, 'created') RETURNING id, room_id, status, result",
    [input.id, input.roomId],
  );
  const row = result.rows[0]!;
  return { id: row.id, roomId: row.room_id, status: row.status, result: row.result };
}

export async function saveDurableMatchResult(input: { id: string; status: string; result: Record<string, unknown> }): Promise<void> {
  const result = await query('UPDATE matches SET status = $2, result = $3, ended_at = CASE WHEN $2 IN (\'finished\', \'cancelled\') THEN now() ELSE ended_at END WHERE id = $1', [input.id, input.status, JSON.stringify(input.result)]);
  if (result.rowCount !== 1) throw new Error('Match not found');
}
