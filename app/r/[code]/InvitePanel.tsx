'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Room code, invite link (copy), QR code, with a "hide code" mode for streaming. */
export function InvitePanel({ code }: { code: string }) {
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const url = typeof window === 'undefined' ? `/r/${code}` : `${window.location.origin}/r/${code}`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((svg) => {
        if (!cancelled) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="card invite">
      <div className="invite__head">
        <h2>Mời bạn bè</h2>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setHidden((h) => !h)}>
          {hidden ? 'Hiện mã' : 'Ẩn mã'}
        </button>
      </div>
      <div className="invite__body">
        <div>
          <p className="muted small">Mã phòng</p>
          <p className="invite__code" aria-label="Mã phòng">
            {hidden ? '•••••' : code}
          </p>
          {!hidden && <p className="invite__link small">{url}</p>}
          <button type="button" className="btn btn--accent" onClick={copy}>
            Sao chép link
          </button>
          {copied && (
            <span className="muted small invite__copied" aria-live="polite">
              Đã sao chép!
            </span>
          )}
        </div>
        {!hidden && qr && (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL generated locally
          <img className="invite__qr" src={qr} alt="Mã QR vào phòng" width={120} height={120} />
        )}
      </div>
    </section>
  );
}
