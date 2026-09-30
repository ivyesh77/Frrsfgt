/** Support notes + tickets. Support agents get read access to a user's real history plus
 *  the ability to leave notes — deliberately no financial mutation capability is granted to
 *  this role anywhere in the permission matrix (see types.ts ROLE_PERMISSIONS.SUPPORT_AGENT). */
import { nanoid } from 'nanoid';
import { appendSupportNote, listAllSupportTickets, listSupportNotesForUser, upsertSupportTicket } from './store.js';
import type { AdminAccount, SupportNote, SupportTicket, SupportTicketStatus } from './types.js';

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
  const ticket: SupportTicket = { id: nanoid(12), userId, userName, subject: subject.slice(0, 200), status: 'open', createdAt: Date.now(), updatedAt: Date.now(), createdByAdminId: admin.id };
  upsertSupportTicket(ticket);
  return ticket;
}

export function updateTicketStatus(ticketId: string, status: SupportTicketStatus): SupportTicket {
  const ticket = listAllSupportTickets().find((t) => t.id === ticketId);
  if (!ticket) throw new Error('Ticket not found');
  const updated: SupportTicket = { ...ticket, status, updatedAt: Date.now() };
  upsertSupportTicket(updated);
  return updated;
}
