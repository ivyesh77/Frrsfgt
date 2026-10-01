/** Support notes + tickets. Support agents get read access to a user's real history plus
 *  the ability to leave notes — deliberately no financial mutation capability is granted to
 *  this role anywhere in the permission matrix (see types.ts ROLE_PERMISSIONS.SUPPORT_AGENT). */
import { nanoid } from 'nanoid';
import { appendSupportNote, listAllSupportTickets, listSupportNotesForUser, upsertSupportTicket } from './store.js';
import type { AdminAccount, SupportNote, SupportTicket, SupportTicketCategory, SupportTicketStatus } from './types.js';

export function addSupportNote(userId: string, note: string, admin: AdminAccount): SupportNote {
  const entry: SupportNote = { id: nanoid(12), userId, authorAdminId: admin.id, authorName: admin.name, note: note.slice(0, 2000), createdAt: Date.now() };
  appendSupportNote(entry);
  return entry;
}

export function notesForUser(userId: string): SupportNote[] {
  return listSupportNotesForUser(userId).slice().reverse();
}

export function allTickets(): SupportTicket[] {
  return listAllSupportTickets().slice().reverse();
}

export function createTicket(userId: string, userName: string, subject: string, admin: AdminAccount): SupportTicket {
  const ticket: SupportTicket = {
    id: nanoid(12),
    userId,
    userName,
    subject: subject.slice(0, 200),
    message: null,
    category: 'other',
    status: 'open',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdByAdminId: admin.id,
  };
  upsertSupportTicket(ticket);
  return ticket;
}

/** The player-initiated path — no admin account involved at all, exactly like any other
 *  authenticated player action. Writes into the exact same ticket store an admin's Support
 *  screen reads, so a real player ticket is immediately visible there; this function itself
 *  has zero admin privileges and cannot do anything an admin route can (change status,
 *  leave an internal note, etc). */
export function createPlayerTicket(userId: string, userName: string, subject: string, message: string, category: SupportTicketCategory): SupportTicket {
  const ticket: SupportTicket = {
    id: nanoid(12),
    userId,
    userName,
    subject: subject.slice(0, 200),
    message: message.slice(0, 4000),
    category,
    status: 'open',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdByAdminId: null,
  };
  upsertSupportTicket(ticket);
  return ticket;
}

/** A player's own tickets only — never another user's, regardless of id guessing, since
 *  this always filters by the authenticated caller's own userId. */
export function ticketsForUser(userId: string): SupportTicket[] {
  return listAllSupportTickets()
    .filter((t) => t.userId === userId)
    .slice()
    .reverse();
}

export function ticketForUser(userId: string, ticketId: string): SupportTicket | null {
  const ticket = listAllSupportTickets().find((t) => t.id === ticketId && t.userId === userId);
  return ticket ?? null;
}

export function updateTicketStatus(ticketId: string, status: SupportTicketStatus): SupportTicket {
  const ticket = listAllSupportTickets().find((t) => t.id === ticketId);
  if (!ticket) throw new Error('Ticket not found');
  const updated: SupportTicket = { ...ticket, status, updatedAt: Date.now() };
  upsertSupportTicket(updated);
  return updated;
}
