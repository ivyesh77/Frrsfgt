import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { createSupportTicket, fetchSupportTicket, fetchSupportTickets } from '../api';
import { SUPPORT_CATEGORY_LABELS, SUPPORT_STATUS_LABELS, type SupportTicket, type SupportTicketCategory } from '../types';

interface SupportScreenProps {
  onBack: () => void;
}

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  { q: 'Is this real money?', a: 'No. Every balance in this app is ArenaCoin (ARC), a practice/demo currency. No real payment processor, bank, UPI network, or cryptocurrency is ever involved, regardless of what a deposit/withdraw screen looks like.' },
  { q: 'How does matchmaking decide who I play against?', a: 'You never pick an opponent or a room. You join a server-side queue for a stake + mode (1v1 Duel or 1v1v1v1 Squad); the server seats you the moment enough real players are waiting, and starts the match once everyone has readied up.' },
  { q: 'How is scoring decided?', a: 'The server alone tracks your score: +1 for a correct answer, -1 for a wrong answer or a timeout. The app you see only renders what the server already decided — it never computes or asserts your score itself.' },
  { q: 'What happens if I disconnect mid-match?', a: 'Your seat is held for a short grace period while the match keeps running; if you reconnect in time you resume seamlessly. If the grace period expires you forfeit that match, and the result reflects that honestly.' },
  { q: 'Why is a payment method shown as disabled?', a: 'If UPI or a crypto asset is shown as disabled, the platform operator has not turned it on. None of them are ever faked as available — what you see always matches the server\u2019s real configuration.' },
  { q: 'Can I get my deposited coins back as real money?', a: 'No — ArenaCoin never converts to real currency in either direction. Withdrawals here only move the practice balance within this app\u2019s own ledger.' },
];

type SupportView = 'faq' | 'tickets' | 'new' | 'detail';

/** Help & Support: a real FAQ plus a genuine ticket system backed by the same support-ticket
 *  store the admin Operations Center reads (see server/src/admin/support.ts
 *  createPlayerTicket) — a player can only ever see their own tickets. */
export function SupportScreen({ onBack }: SupportScreenProps) {
  const [view, setView] = useState<SupportView>('faq');
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  function loadTickets() {
    setError(null);
    fetchSupportTickets()
      .then(setTickets)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your tickets'));
  }

  useEffect(() => {
    if (view === 'tickets') loadTickets();
  }, [view]);

  async function openTicket(id: string) {
    setError(null);
    try {
      const ticket = await fetchSupportTicket(id);
      setSelected(ticket);
      setView('detail');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that ticket');
    }
  }

  return (
    <div className="support-screen no-select">
      <button type="button" className="profile-back" onClick={onBack}>
        ← Back
      </button>
      <h1 className="arena-title arena-title--sm">Help &amp; Support</h1>

      <nav className="wallet-tabs" role="tablist" aria-label="Support sections">
        <button type="button" role="tab" aria-selected={view === 'faq'} className={`wallet-modal__tab ${view === 'faq' ? 'wallet-modal__tab--active' : ''}`} onClick={() => setView('faq')}>
          FAQ
        </button>
        <button type="button" role="tab" aria-selected={view === 'tickets' || view === 'detail'} className={`wallet-modal__tab ${view === 'tickets' || view === 'detail' ? 'wallet-modal__tab--active' : ''}`} onClick={() => setView('tickets')}>
          My Tickets
        </button>
        <button type="button" role="tab" aria-selected={view === 'new'} className={`wallet-modal__tab ${view === 'new' ? 'wallet-modal__tab--active' : ''}`} onClick={() => setView('new')}>
          New Ticket
        </button>
      </nav>

      {error && <p className="arena-fineprint arena-fineprint--warn">{error}</p>}

      {view === 'faq' && (
        <ul className="faq-list">
          {FAQ_ITEMS.map((item, i) => (
            <li key={item.q} className="faq-item glass-panel">
              <button type="button" className="faq-item__question" aria-expanded={openFaq === i} onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                {item.q}
                <span aria-hidden="true">{openFaq === i ? '−' : '+'}</span>
              </button>
              {openFaq === i && (
                <motion.p className="faq-item__answer" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.2 }}>
                  {item.a}
                </motion.p>
              )}
            </li>
          ))}
        </ul>
      )}

      {view === 'tickets' && (
        <>
          {tickets === null && !error && <p className="arena-empty">Loading…</p>}
          {tickets !== null && tickets.length === 0 && <p className="arena-empty">You haven&rsquo;t opened any support tickets yet.</p>}
          {tickets !== null && tickets.length > 0 && (
            <ul className="ticket-list">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button type="button" className="ticket-row glass-panel" onClick={() => void openTicket(t.id)}>
                    <span className={`ticket-row__status ticket-row__status--${t.status}`}>{SUPPORT_STATUS_LABELS[t.status]}</span>
                    <span className="ticket-row__subject">{t.subject}</span>
                    <span className="ticket-row__category">{SUPPORT_CATEGORY_LABELS[t.category]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {view === 'detail' && selected && (
        <div className="ticket-detail glass-panel">
          <button type="button" className="profile-back" onClick={() => setView('tickets')}>
            ← All tickets
          </button>
          <span className={`ticket-row__status ticket-row__status--${selected.status}`}>{SUPPORT_STATUS_LABELS[selected.status]}</span>
          <h2 className="arena-section__title">{selected.subject}</h2>
          <p className="arena-fineprint">
            {SUPPORT_CATEGORY_LABELS[selected.category]} · Opened {new Date(selected.createdAt).toLocaleString()}
          </p>
          <p className="ticket-detail__message">{selected.message}</p>
        </div>
      )}

      {view === 'new' && (
        <NewTicketForm
          onCreated={(t) => {
            setSelected(t);
            setView('detail');
          }}
        />
      )}
    </div>
  );
}

function NewTicketForm({ onCreated }: { onCreated: (ticket: SupportTicket) => void }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<SupportTicketCategory>('other');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (subject.trim().length < 3) {
      setError('Please enter a short subject (at least 3 characters).');
      return;
    }
    if (message.trim().length < 10) {
      setError('Please describe the issue in a bit more detail (at least 10 characters).');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const ticket = await createSupportTicket(subject.trim(), message.trim(), category);
      onCreated(ticket);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your ticket');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="arena-form ticket-form glass-panel" onSubmit={(e) => void submit(e)}>
      <label className="arena-label" htmlFor="ticket-category">
        Category
      </label>
      <select id="ticket-category" className="arena-input" value={category} onChange={(e) => setCategory(e.target.value as SupportTicketCategory)}>
        {Object.entries(SUPPORT_CATEGORY_LABELS).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>

      <label className="arena-label" htmlFor="ticket-subject">
        Subject
      </label>
      <input id="ticket-subject" className="arena-input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required />

      <label className="arena-label" htmlFor="ticket-message">
        Describe the issue
      </label>
      <textarea id="ticket-message" className="arena-input ticket-form__textarea" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} rows={6} required />

      {error && <p className="arena-fineprint arena-fineprint--warn">{error}</p>}

      <Button type="submit" variant="primary" size="lg" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit Ticket'}
      </Button>
    </form>
  );
}
