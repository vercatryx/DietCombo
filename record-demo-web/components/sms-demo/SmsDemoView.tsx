'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './SmsDemoView.module.css';

const BRAND = 'Demo Company';
/** Serves a real image file (200 OK, image/*) for screenshots and if the link is opened */
const PROOF_OF_DELIVERY_IMAGE_URL =
  'https://placehold.co/1200x800/f2f2f7/0a6ecc.jpeg?text=Proof+of+delivery+%28demo%29';

const MS_PER_CHAR = 38;
const PAUSE_AFTER_USER_TYPING_MS = 2000;
const PAUSE_AFTER_SYSTEM_MS = 2200;
const PAUSE_AFTER_FULL_LOOP_MS = 5000;

type OutMsg =
  | { id: string; kind: 'user'; text: string; typing: boolean; showSender?: never }
  | { id: string; kind: 'system'; text: string; showSender: boolean; typing?: never };

const SCRIPT: { role: 'user' | 'system'; text: string; showSender?: boolean }[] = [
  { role: 'user', text: 'Is my food still being delivered today?' },
  {
    role: 'system',
    showSender: true,
    text:
      "Checking the records, we see that last week your food was delivered at 7:30 p.m., so you can expect it to be a similar time this week. If it doesn't come by 8:30, I'll get you in touch with a support agent.",
  },
  { role: 'user', text: 'Can I change my order?' },
  {
    role: 'system',
    text: `You can't change this order because it's already out for delivery, but you can change next week's order. I can offer options to help you do that. — ${BRAND}`,
  },
  { role: 'user', text: 'Do you have proof of delivery for my last drop-off?' },
  {
    role: 'system',
    text: `Yes. Here's a link to the delivery photo: ${PROOF_OF_DELIVERY_IMAGE_URL} — ${BRAND}`,
  },
];

function sleep(
  ms: number,
  timersRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>,
  cancelledRef: { current: boolean },
) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      if (!cancelledRef.current) resolve();
    }, ms);
    timersRef.current.push(t);
  });
}

let idCounter = 0;
function nextMessageId() {
  idCounter += 1;
  return `sms-${idCounter}`;
}

function SmsKeyboard() {
  const r1 = 'QWERTYUIOP'.split('');
  const r2 = 'ASDFGHJKL'.split('');
  const r3 = 'ZXCVBNM'.split('');
  return (
    <div className={styles.keyboard} aria-hidden>
      <div className={styles.keyRow}>
        {r1.map((c) => (
          <span key={c} className={styles.key}>
            {c}
          </span>
        ))}
      </div>
      <div className={`${styles.keyRow} ${styles.keyRowOffset}`}>
        {r2.map((c) => (
          <span key={c} className={styles.key}>
            {c}
          </span>
        ))}
      </div>
      <div className={styles.keyRow}>
        <span className={`${styles.key} ${styles.keyWider}`}>⇧</span>
        {r3.map((c) => (
          <span key={c} className={styles.key}>
            {c}
          </span>
        ))}
        <span className={`${styles.key} ${styles.keyWider}`}>⌫</span>
      </div>
      <div className={styles.keyRow}>
        <span className={`${styles.key} ${styles.keyAction}`}>123</span>
        <span className={`${styles.key} ${styles.keyAction}`}>🌐</span>
        <span className={`${styles.key} ${styles.keySpace}`}>space</span>
        <span className={`${styles.key} ${styles.keyBlue}`}>return</span>
      </div>
    </div>
  );
}

export function SmsDemoView() {
  const [rows, setRows] = useState<OutMsg[]>([]);
  const cancelledRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [rows]);

  useEffect(() => {
    cancelledRef.current = false;
    timersRef.current = [];

    const run = async () => {
      while (!cancelledRef.current) {
        for (let s = 0; s < SCRIPT.length; s += 1) {
          if (cancelledRef.current) return;
          const step = SCRIPT[s]!;

          if (step.role === 'user') {
            const text = step.text;
            for (let i = 0; i <= text.length; i += 1) {
              if (cancelledRef.current) return;
              const typing = i < text.length;
              const piece = text.slice(0, i);
              setRows((prev) => {
                const withoutTail = prev.filter((m) => !m.id.startsWith('typing-'));
                const key = 'typing-user';
                return [
                  ...withoutTail,
                  { id: key, kind: 'user' as const, text: piece, typing } satisfies OutMsg,
                ];
              });
              if (i < text.length) {
                await sleep(MS_PER_CHAR, timersRef, cancelledRef);
              }
            }
            setRows((prev) => {
              const withoutTail = prev.filter((m) => !m.id.startsWith('typing-'));
              return [
                ...withoutTail,
                {
                  id: nextMessageId(),
                  kind: 'user' as const,
                  text,
                  typing: false,
                },
              ];
            });
            await sleep(PAUSE_AFTER_USER_TYPING_MS, timersRef, cancelledRef);
            continue;
          }

          if (step.role === 'system') {
            if (cancelledRef.current) return;
            setRows((prev) => [
              ...prev,
              {
                id: nextMessageId(),
                kind: 'system',
                text: step.text,
                showSender: step.showSender === true,
              },
            ]);
            const isLast = s === SCRIPT.length - 1;
            await sleep(isLast ? PAUSE_AFTER_FULL_LOOP_MS : PAUSE_AFTER_SYSTEM_MS, timersRef, cancelledRef);
          }
        }
        if (cancelledRef.current) return;
        setRows([]);
        await sleep(300, timersRef, cancelledRef);
      }
    };

    run();

    return () => {
      cancelledRef.current = true;
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className={styles.wrap}>
      <div className={styles.phone} aria-hidden>
        <div className={styles.screen}>
          <div className={styles.statusBar}>
            <span>9:41</span>
            <span>● LTE</span>
          </div>
          <div className={styles.appHeader}>
            <div className={styles.appHeaderLabel}>Text message</div>
            <div className={styles.appHeaderTitle}>{BRAND}</div>
          </div>
          <div className={styles.messageArea} ref={listRef}>
            {rows.map((row) => {
              if (row.kind === 'user') {
                return (
                  <div key={row.id} className={`${styles.bubbleRow} ${styles.user}`}>
                    <div className={`${styles.bubble} ${styles.user}`}>
                      {row.text}
                      {row.typing ? <span className={styles.typingCursor} /> : null}
                    </div>
                  </div>
                );
              }
              return (
                <div key={row.id} className={`${styles.bubbleRow} ${styles.system}`}>
                  {row.showSender ? <div className={styles.senderTag}>{BRAND}</div> : null}
                  <div className={`${styles.bubble} ${styles.system}`}>{row.text}</div>
                </div>
              );
            })}
          </div>
          <SmsKeyboard />
        </div>
      </div>
    </div>
  );
}
