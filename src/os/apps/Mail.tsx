import { useState } from 'react';
import { profile } from '../data';
import type { AppProps } from '../types';

export default function Mail(_: AppProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const send = () => {
    const href = `mailto:${profile.email}?subject=${encodeURIComponent(subject || 'hey josh')}&body=${encodeURIComponent(body)}`;
    setSent(true);
    window.location.href = href;
    setTimeout(() => setSent(false), 2600);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(profile.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard can be blocked; the address is visible anyway */
    }
  };

  return (
    <div className={`mail ${sent ? 'is-sent' : ''}`}>
      <div className="mail-tools">
        <button className="btn btn-primary" onClick={send}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
          Send
        </button>
        <button className="btn btn-ghost" onClick={copy}>
          {copied ? 'Copied!' : 'Copy address'}
        </button>
      </div>
      <label className="mail-row">
        <span>To:</span>
        <span className="mail-to">
          Josh Koo <small>&lt;{profile.email}&gt;</small>
        </span>
      </label>
      <label className="mail-row">
        <span>Subject:</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="hey josh" />
      </label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="say hi, pitch me something, send a song…" aria-label="Message" />
      <div className="mail-plane" aria-hidden="true">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="#2b7cf6"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
        <span>opening your mail app…</span>
      </div>
    </div>
  );
}
