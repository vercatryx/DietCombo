'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
}

export function SmsBotTest() {
    const [phone, setPhone] = useState('');
    const [phoneSet, setPhoneSet] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const [clientName, setClientName] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    function handleSetPhone() {
        if (!phone.trim()) return;
        setPhoneSet(true);
        setMessages([{
            role: 'system',
            content: `Simulating SMS for phone: ${phone}`,
            timestamp: new Date().toLocaleTimeString(),
        }]);
    }

    function handleReset() {
        setPhoneSet(false);
        setPhone('');
        setMessages([]);
        setClientName(null);
        setInput('');
    }

    async function handleSend() {
        const text = input.trim();
        if (!text || loading) return;

        setInput('');
        setMessages(prev => [...prev, {
            role: 'user',
            content: text,
            timestamp: new Date().toLocaleTimeString(),
        }]);
        setLoading(true);

        try {
            const res = await fetch('/api/admin/sms-bot-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, message: text }),
            });
            const data = await res.json();

            if (data.clientName && !clientName) {
                setClientName(data.clientName);
            }

            setMessages(prev => [...prev, {
                role: 'assistant',
                content: data.reply || data.error || 'No response',
                timestamp: new Date().toLocaleTimeString(),
            }]);
        } catch (err: any) {
            setMessages(prev => [...prev, {
                role: 'system',
                content: `Error: ${err.message}`,
                timestamp: new Date().toLocaleTimeString(),
            }]);
        }
        setLoading(false);
    }

    if (!phoneSet) {
        return (
            <div style={styles.container}>
                <h2 style={styles.title}>SMS Bot Tester</h2>
                <p style={styles.subtitle}>
                    Test the SMS bot without sending real texts. Enter the phone number of a client to simulate a conversation.
                </p>
                <div style={styles.phoneRow}>
                    <input
                        style={styles.phoneInput}
                        type="tel"
                        placeholder="+13472150400"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSetPhone()}
                    />
                    <button style={styles.startButton} onClick={handleSetPhone}>
                        Start Chat
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={styles.container}>
            <div style={styles.headerRow}>
                <div>
                    <h2 style={styles.title}>SMS Bot Tester</h2>
                    <p style={styles.meta}>
                        Phone: {phone}
                        {clientName && <> &mdash; Client: <strong>{clientName}</strong></>}
                    </p>
                </div>
                <button style={styles.resetButton} onClick={handleReset}>Change Number</button>
            </div>

            <div style={styles.chatWindow}>
                {messages.map((msg, i) => (
                    <div
                        key={i}
                        style={{
                            ...styles.messageBubble,
                            ...(msg.role === 'user' ? styles.userBubble : msg.role === 'assistant' ? styles.botBubble : styles.systemBubble),
                        }}
                    >
                        <div style={styles.bubbleLabel}>
                            {msg.role === 'user' ? 'Client' : msg.role === 'assistant' ? 'Bot' : 'System'}
                            <span style={styles.timestamp}>{msg.timestamp}</span>
                        </div>
                        <div style={styles.bubbleContent}>{msg.content}</div>
                    </div>
                ))}
                {loading && (
                    <div style={{ ...styles.messageBubble, ...styles.botBubble }}>
                        <div style={styles.bubbleLabel}>Bot</div>
                        <div style={{ ...styles.bubbleContent, opacity: 0.6 }}>Thinking...</div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div style={styles.inputRow}>
                <input
                    style={styles.chatInput}
                    placeholder="Type a message..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                    disabled={loading}
                />
                <button style={styles.sendButton} onClick={handleSend} disabled={loading}>
                    {loading ? '...' : 'Send'}
                </button>
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        maxWidth: '48rem',
        margin: '2rem auto',
        padding: '1.5rem',
        backgroundColor: '#f9fafb',
        borderRadius: '0.75rem',
        border: '1px solid #e5e7eb',
        minHeight: '80vh',
        display: 'flex',
        flexDirection: 'column' as const,
    },
    title: {
        fontSize: '1.25rem',
        fontWeight: 600,
        color: '#111827',
        margin: 0,
    },
    subtitle: {
        fontSize: '0.875rem',
        color: '#6b7280',
        marginTop: '0.25rem',
        marginBottom: '1rem',
    },
    meta: {
        fontSize: '0.8rem',
        color: '#6b7280',
        marginTop: '0.25rem',
    },
    phoneRow: {
        display: 'flex',
        gap: '0.5rem',
        maxWidth: '28rem',
    },
    phoneInput: {
        flex: 1,
        padding: '0.625rem',
        border: '1px solid #d1d5db',
        borderRadius: '0.375rem',
        fontSize: '0.875rem',
    },
    startButton: {
        padding: '0.625rem 1.25rem',
        backgroundColor: '#6366f1',
        color: 'white',
        border: 'none',
        borderRadius: '0.375rem',
        fontWeight: 500,
        cursor: 'pointer',
        fontSize: '0.875rem',
    },
    headerRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '0.75rem',
    },
    resetButton: {
        padding: '0.375rem 0.75rem',
        backgroundColor: '#e5e7eb',
        color: '#374151',
        border: 'none',
        borderRadius: '0.375rem',
        fontSize: '0.8rem',
        cursor: 'pointer',
    },
    chatWindow: {
        backgroundColor: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '0.5rem',
        padding: '0.75rem',
        flex: 1,
        minHeight: '24rem',
        overflowY: 'auto' as const,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '0.5rem',
    },
    messageBubble: {
        maxWidth: '85%',
        padding: '0.5rem 0.75rem',
        borderRadius: '0.75rem',
        fontSize: '0.875rem',
        lineHeight: 1.5,
    },
    userBubble: {
        alignSelf: 'flex-end' as const,
        backgroundColor: '#6366f1',
        color: 'white',
    },
    botBubble: {
        alignSelf: 'flex-start' as const,
        backgroundColor: '#f3f4f6',
        color: '#111827',
    },
    systemBubble: {
        alignSelf: 'center' as const,
        backgroundColor: '#fef3c7',
        color: '#92400e',
        fontSize: '0.75rem',
        textAlign: 'center' as const,
    },
    bubbleLabel: {
        fontSize: '0.7rem',
        fontWeight: 600,
        opacity: 0.7,
        marginBottom: '0.125rem',
        display: 'flex',
        justifyContent: 'space-between',
    },
    timestamp: {
        fontWeight: 400,
        marginLeft: '0.5rem',
    },
    bubbleContent: {
        whiteSpace: 'pre-wrap' as const,
    },
    inputRow: {
        display: 'flex',
        gap: '0.5rem',
        marginTop: '0.75rem',
    },
    chatInput: {
        flex: 1,
        padding: '0.625rem',
        border: '1px solid #d1d5db',
        borderRadius: '0.375rem',
        fontSize: '0.875rem',
    },
    sendButton: {
        padding: '0.625rem 1.25rem',
        backgroundColor: '#6366f1',
        color: 'white',
        border: 'none',
        borderRadius: '0.375rem',
        fontWeight: 500,
        cursor: 'pointer',
        fontSize: '0.875rem',
        minWidth: '4rem',
    },
};
