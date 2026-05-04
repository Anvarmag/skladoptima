import { ReactNode, CSSProperties, useState } from 'react';

// ─── Design tokens ────────────────────────────────────────────────────────────
export const S = {
    sidebarBg:    '#0f172a',
    sidebarText:  '#94a3b8',
    sidebarHover: 'rgba(255,255,255,0.06)',
    sidebarActive:'rgba(255,255,255,0.10)',
    bg:     '#f8fafc',
    card:   '#ffffff',
    border: '#e2e8f0',
    ink:    '#0f172a',
    sub:    '#64748b',
    muted:  '#94a3b8',
    blue:   '#3b82f6',
    wb:     '#cb11ab',
    oz:     '#005bff',
    ym:     '#FF6600',
    green:  '#10b981',
    amber:  '#f59e0b',
    red:    '#ef4444',
} as const;

// ─── PageHeader ───────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
    return (
        <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 28, color: S.ink, margin: 0, letterSpacing: '-0.02em' }}>{title}</h1>
                    {subtitle && <p style={{ fontFamily: 'Inter', fontSize: 15, color: S.sub, marginTop: 4, marginBottom: 0 }}>{subtitle}</p>}
                </div>
                {children && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{children}</div>}
            </div>
        </div>
    );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, style, noPad }: { children: ReactNode; style?: CSSProperties; noPad?: boolean }) {
    return (
        <div style={{
            background: S.card,
            borderRadius: 16,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
            border: `1px solid ${S.border}`,
            padding: noPad ? 0 : '24px',
            overflow: noPad ? 'hidden' : undefined,
            ...style,
        }}>{children}</div>
    );
}

// ─── KpiCard ──────────────────────────────────────────────────────────────────
export function KpiCard({ label, value, unit, trend, trendLabel, icon: Icon, accent }: {
    label: string; value: string | number; unit?: string;
    trend?: number; trendLabel?: string; icon?: any; accent?: string;
}) {
    const up = (trend ?? 0) > 0;
    return (
        <Card style={{ flex: 1, minWidth: 180, position: 'relative', padding: 0, overflow: 'hidden' }}>
            <div style={{ height: 3, background: accent || `linear-gradient(90deg,${S.blue},#8b5cf6)` }} />
            <div style={{ padding: '20px 20px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <span style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
                    {Icon && <Icon size={22} color={S.muted} style={{ opacity: 0.4 }} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'Inter', fontWeight: 900, fontSize: 40, color: S.ink, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</span>
                    {unit && <span style={{ fontFamily: 'Inter', fontSize: 15, color: S.sub, fontWeight: 500 }}>{unit}</span>}
                </div>
                {trendLabel && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontFamily: 'Inter', fontSize: 13, color: up ? S.green : S.red, fontWeight: 600 }}>{up ? '↑' : '↓'} {trendLabel}</span>
                    </div>
                )}
            </div>
        </Card>
    );
}

// ─── Btn ──────────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'wb' | 'oz' | 'ym' | 'danger' | 'success';
type BtnSize = 'sm' | 'md';

const BTN_VARIANTS: Record<BtnVariant, CSSProperties> = {
    primary:   { background: S.ink,  color: '#fff',   border: 'none' },
    secondary: { background: '#fff', color: S.ink,    border: `1px solid ${S.border}`, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
    ghost:     { background: 'transparent', color: S.sub, border: '1px solid transparent' },
    wb:        { background: 'rgba(203,17,171,0.06)',  color: S.wb,  border: '1px solid rgba(203,17,171,0.25)' },
    oz:        { background: 'rgba(0,91,255,0.06)',    color: S.oz,  border: '1px solid rgba(0,91,255,0.25)' },
    ym:        { background: 'rgba(255,102,0,0.06)',   color: S.ym,  border: '1px solid rgba(255,102,0,0.25)' },
    danger:    { background: 'rgba(239,68,68,0.08)',   color: S.red, border: '1px solid rgba(239,68,68,0.2)' },
    success:   { background: 'rgba(16,185,129,0.08)',  color: S.green, border: '1px solid rgba(16,185,129,0.2)' },
};

export function Btn({
    children, variant = 'secondary', size = 'md', onClick, style, disabled, type = 'button', title,
}: {
    children: ReactNode; variant?: BtnVariant; size?: BtnSize;
    onClick?: () => void; style?: CSSProperties; disabled?: boolean;
    type?: 'button' | 'submit' | 'reset'; title?: string;
}) {
    const [hovered, setHovered] = useState(false);
    const base: CSSProperties = {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: 'none', borderRadius: 8,
        fontFamily: 'Inter', fontWeight: 600, transition: 'all 0.15s',
        padding: size === 'sm' ? '6px 14px' : '9px 18px',
        fontSize: size === 'sm' ? 13 : 15,
        opacity: disabled ? 0.5 : 1,
    };
    const hoverBg = variant === 'secondary' ? (hovered ? '#f8fafc' : '#fff') : undefined;
    const variantStyle = { ...BTN_VARIANTS[variant], ...(hoverBg ? { background: hoverBg } : {}) };
    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            title={title}
            style={{ ...base, ...variantStyle, ...style }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >{children}</button>
    );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
export function Badge({ label, color, bg, style }: { label: string; color: string; bg: string; style?: CSSProperties }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '3px 9px',
            borderRadius: 999, fontFamily: 'Inter', fontSize: 12, fontWeight: 600,
            background: bg, color,
            ...style,
        }}>{label}</span>
    );
}

// ─── MPBadge ──────────────────────────────────────────────────────────────────
const MP_CFG: Record<string, { bg: string; label: string }> = {
    WB:   { bg: S.wb,   label: 'WB' },
    OZON: { bg: S.oz,   label: 'OZ' },
    OZ:   { bg: S.oz,   label: 'OZ' },
    YM:   { bg: S.ym,   label: 'YM' },
};
export function MPBadge({ mp, size = 11 }: { mp: string; size?: number }) {
    const cfg = MP_CFG[mp] ?? { bg: '#888', label: mp };
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '2px 7px',
            borderRadius: 999, fontFamily: 'Montserrat, Inter, sans-serif', fontSize: size, fontWeight: 700,
            background: cfg.bg, color: '#fff', letterSpacing: '0.02em', flexShrink: 0,
        }}>{cfg.label}</span>
    );
}

// ─── Input ────────────────────────────────────────────────────────────────────
export function Input({ value, onChange, placeholder, icon: Icon, type = 'text', style, disabled, autoFocus, name, id, min, max }: {
    value?: string | number; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string; icon?: any; type?: string; style?: CSSProperties;
    disabled?: boolean; autoFocus?: boolean; name?: string; id?: string;
    min?: number; max?: number;
}) {
    return (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', ...style }}>
            {Icon && <div style={{ position: 'absolute', left: 10, pointerEvents: 'none' }}>
                <Icon size={15} color={S.muted} />
            </div>}
            <input
                id={id} name={name} value={value} onChange={onChange}
                type={type} placeholder={placeholder} disabled={disabled}
                autoFocus={autoFocus} min={min} max={max}
                style={{
                    width: '100%', padding: Icon ? '8px 12px 8px 34px' : '8px 12px',
                    borderRadius: 8, border: `1px solid ${S.border}`,
                    fontFamily: 'Inter', fontSize: 15, color: S.ink,
                    background: disabled ? '#f8fafc' : '#fff', outline: 'none',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    opacity: disabled ? 0.7 : 1,
                }}
            />
        </div>
    );
}

// ─── Textarea ─────────────────────────────────────────────────────────────────
export function Textarea({ value, onChange, placeholder, rows = 3, style }: {
    value?: string; onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    placeholder?: string; rows?: number; style?: CSSProperties;
}) {
    return (
        <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows}
            style={{
                width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${S.border}`,
                fontFamily: 'Inter', fontSize: 15, color: S.ink, background: '#fff', outline: 'none',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)', resize: 'vertical', ...style,
            }}
        />
    );
}

// ─── Select ───────────────────────────────────────────────────────────────────
export function HiSelect({ value, onChange, options, style }: {
    value: string; onChange: (v: string) => void;
    options: { value: string; label: string }[]; style?: CSSProperties;
}) {
    return (
        <select value={value} onChange={e => onChange(e.target.value)} style={{
            padding: '7px 28px 7px 10px', borderRadius: 8, border: `1px solid ${S.border}`,
            fontFamily: 'Inter', fontSize: 15, color: S.ink, background: '#fff',
            outline: 'none', cursor: 'pointer', appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
            ...style,
        }}>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <div onClick={() => onChange(!on)} style={{
            width: 36, height: 20, borderRadius: 999, background: on ? S.blue : '#e2e8f0',
            cursor: 'pointer', position: 'relative', transition: 'background 0.15s', flexShrink: 0,
        }}>
            <div style={{
                position: 'absolute', top: 2, left: on ? 18 : 2,
                width: 16, height: 16, borderRadius: '50%', background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.15)', transition: 'left 0.15s',
            }} />
        </div>
    );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, width = 480 }: {
    open: boolean; onClose: () => void; title?: string;
    children: ReactNode; width?: number;
}) {
    if (!open) return null;
    return (
        <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div style={{ background: '#fff', borderRadius: 20, padding: 28, width, maxWidth: '90vw', boxShadow: '0 25px 50px rgba(0,0,0,0.25)', maxHeight: '85vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <span style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 19, color: S.ink }}>{title}</span>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: S.muted, display: 'flex', fontSize: 20, lineHeight: 1 }}>
                        ×
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}

// ─── TH (table header cell) ───────────────────────────────────────────────────
export function TH({ children, flex, align = 'left' }: { children?: ReactNode; flex?: number; align?: 'left' | 'center' | 'right' }) {
    return (
        <div style={{ flex: flex ?? 1, fontFamily: 'Inter', fontSize: 12, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 16px', textAlign: align }}>
            {children}
        </div>
    );
}

// ─── FieldLabel ───────────────────────────────────────────────────────────────
export function FieldLabel({ children }: { children: ReactNode }) {
    return (
        <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
            {children}
        </div>
    );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, subtitle }: { icon?: any; title: string; subtitle?: string }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', gap: 12 }}>
            {Icon && (
                <div style={{ width: 56, height: 56, borderRadius: 16, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                    <Icon size={24} color={S.muted} />
                </div>
            )}
            <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 18, color: S.ink }}>{title}</div>
            {subtitle && <div style={{ fontFamily: 'Inter', fontSize: 15, color: S.sub, textAlign: 'center' }}>{subtitle}</div>}
        </div>
    );
}

// ─── SkuTag ───────────────────────────────────────────────────────────────────
export function SkuTag({ children }: { children: ReactNode }) {
    return (
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: S.sub, background: '#f1f5f9', padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' }}>
            {children}
        </span>
    );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = 16, color }: { size?: number; color?: string }) {
    return (
        <span style={{
            display: 'inline-block', width: size, height: size, borderRadius: '50%',
            border: `2px solid ${color ?? S.border}`,
            borderTopColor: color ?? S.blue,
            animation: 'spin 0.7s linear infinite',
        }} />
    );
}

// ─── Pagination ───────────────────────────────────────────────────────────────
export function Pagination({ page, totalPages, onPage, total, shown }: {
    page: number; totalPages: number; onPage: (p: number) => void;
    total?: number; shown?: number;
}) {
    return (
        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${S.border}` }}>
            <span style={{ fontFamily: 'Inter', fontSize: 14, color: S.muted }}>
                {shown !== undefined && total !== undefined
                    ? `Показано ${shown} из ${total}`
                    : `Страница ${page} из ${totalPages}`}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
                <Btn variant="secondary" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>← Назад</Btn>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const p = i + 1;
                    const isActive = p === page;
                    return (
                        <div
                            key={p}
                            onClick={() => onPage(p)}
                            style={{
                                width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: isActive ? S.ink : '#fff',
                                border: isActive ? 'none' : `1px solid ${S.border}`,
                                borderRadius: 8, fontFamily: 'Inter', fontSize: 13, fontWeight: 600,
                                color: isActive ? '#fff' : S.ink,
                                cursor: 'pointer',
                            }}
                        >{p}</div>
                    );
                })}
                <Btn variant="secondary" size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>Вперёд →</Btn>
            </div>
        </div>
    );
}
