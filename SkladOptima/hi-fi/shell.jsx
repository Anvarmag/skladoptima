// ─── App Shell: Sidebar + Layout ────────────────────────────────────────────

const S = {
  // sidebar
  sidebarBg:   '#0f172a',
  sidebarText: '#94a3b8',
  sidebarHover:'rgba(255,255,255,0.06)',
  sidebarActive:'rgba(255,255,255,0.10)',
  // surfaces
  bg:    '#f8fafc',
  card:  '#ffffff',
  border:'#e2e8f0',
  // text
  ink:   '#0f172a',
  sub:   '#64748b',
  muted: '#94a3b8',
  // brand
  blue:  '#3b82f6',
  wb:    '#cb11ab',
  oz:    '#005bff',
  ym:    '#FF6600',
  green: '#10b981',
  amber: '#f59e0b',
  red:   '#ef4444',
};
window.S = S;

// ─── Sidebar ────────────────────────────────────────────────────────────────
const NAV = [
  { id:'products',   label:'Остатки',        icon:'Package'        },
  { id:'analytics',  label:'Аналитика',       icon:'BarChart2'      },
  { id:'finance',    label:'Юнит-экономика',  icon:'DollarSign'     },
  { id:'history',    label:'История',         icon:'Clock'          },
  { id:'orders',     label:'Заказы',          icon:'ShoppingCart'   },
  { id:'telegram',   label:'Уведомления',     icon:'Bell'           },
  { id:'settings',   label:'Настройки',       icon:'Settings'       },
];

function Sidebar({ active, onNav }) {
  return (
    <div style={{
      width: 240, flexShrink: 0, height: '100vh', position: 'sticky', top: 0,
      background: S.sidebarBg, display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 20px 8px', display:'flex', alignItems:'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          display:'flex', alignItems:'center', justifyContent:'center', flexShrink: 0,
        }}>
          <Icon name="Package" size={16} color="#fff" strokeWidth={2}/>
        </div>
        <span style={{ fontFamily:'Inter', fontWeight: 700, fontSize: 15, color:'#fff', letterSpacing:'-0.01em' }}>
          Sklad Optima
        </span>
      </div>

      {/* Shop selector */}
      <div style={{ padding: '0 12px 16px' }}>
        <div style={{
          padding: '6px 10px', borderRadius: 8, cursor:'pointer',
          background: S.sidebarHover, display:'flex', alignItems:'center', gap: 8,
        }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background:'linear-gradient(135deg,#f59e0b,#ef4444)', flexShrink:0 }}/>
          <span style={{ fontFamily:'Inter', fontSize: 13, color:'#e2e8f0', fontWeight: 500, flex:1 }}>Мебель СТО</span>
          <Icon name="ChevronDown" size={14} color={S.sidebarText}/>
        </div>
      </div>

      <div style={{ height: 1, background:'rgba(255,255,255,0.06)', margin:'0 16px 12px' }}/>

      {/* Nav items */}
      <nav style={{ flex:1, padding: '0 8px', display:'flex', flexDirection:'column', gap:1 }}>
        {NAV.map(item => {
          const isActive = item.id === active;
          return (
            <button key={item.id} onClick={() => onNav(item.id)} style={{
              display:'flex', alignItems:'center', gap:10, padding:'8px 12px',
              borderRadius: 8, border:'none', cursor:'pointer', width:'100%', textAlign:'left',
              background: isActive ? S.sidebarActive : 'transparent',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = S.sidebarHover; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon name={item.icon} size={16}
                color={isActive ? '#fff' : S.sidebarText}
                strokeWidth={isActive ? 2 : 1.75}
              />
              <span style={{
                fontFamily:'Inter', fontSize:13, fontWeight: isActive ? 600 : 400,
                color: isActive ? '#fff' : S.sidebarText,
              }}>{item.label}</span>
              {item.id === 'orders' && (
                <span style={{ marginLeft:'auto', background:'#ef4444', color:'#fff', fontSize:10, fontWeight:700, fontFamily:'Inter', padding:'1px 6px', borderRadius:999 }}>3</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* User footer */}
      <div style={{ padding: '12px 8px', borderTop:'1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:8 }}>
          <div style={{ width:28, height:28, borderRadius:'50%', background:'linear-gradient(135deg,#3b82f6,#8b5cf6)', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <span style={{ fontFamily:'Inter', fontSize:11, fontWeight:700, color:'#fff' }}>МС</span>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:'Inter', fontSize:12, fontWeight:600, color:'#e2e8f0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>user@mail.ru</div>
            <div style={{ fontFamily:'Inter', fontSize:11, color: S.sidebarText }}>Администратор</div>
          </div>
          <button onClick={() => {}} style={{ background:'transparent', border:'none', cursor:'pointer', padding:4, borderRadius:6 }}
            onMouseEnter={e => e.currentTarget.style.background = S.sidebarHover}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="LogOut" size={15} color={S.sidebarText}/>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page layout helpers ─────────────────────────────────────────────────────

function PageHeader({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16 }}>
        <div>
          <h1 style={{ fontFamily:'Inter', fontWeight:800, fontSize:24, color: S.ink, margin:0, letterSpacing:'-0.02em' }}>{title}</h1>
          {subtitle && <p style={{ fontFamily:'Inter', fontSize:14, color: S.sub, marginTop:4 }}>{subtitle}</p>}
        </div>
        {children && <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>{children}</div>}
      </div>
    </div>
  );
}

function Card({ children, style, noPad }) {
  return (
    <div style={{
      background: S.card, borderRadius: 16,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
      border: `1px solid ${S.border}`,
      padding: noPad ? 0 : '24px',
      overflow: noPad ? 'hidden' : undefined,
      ...style,
    }}>{children}</div>
  );
}

// KPI widget card
function KpiCard({ label, value, unit, trend, trendLabel, icon, accent }) {
  const up = trend > 0;
  return (
    <Card style={{ flex:1, minWidth: 180, position:'relative', padding:0, overflow:'hidden' }}>
      {/* Accent strip */}
      <div style={{ height: 3, background: accent || 'linear-gradient(90deg,#3b82f6,#8b5cf6)' }}/>
      <div style={{ padding:'24px 24px 20px' }}>
        {/* Header row */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
          <span style={{ fontFamily:'Inter', fontSize:11, fontWeight:700, color: S.muted, textTransform:'uppercase', letterSpacing:'0.1em' }}>{label}</span>
          <Icon name={icon} size={22} color={S.muted} style={{ opacity:0.18 }}/>
        </div>
        {/* Value */}
        <div style={{ display:'flex', alignItems:'baseline', gap:6, marginBottom:8 }}>
          <span style={{ fontFamily:'Inter', fontWeight:900, fontSize:40, color: S.ink, letterSpacing:'-0.03em', lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{value}</span>
          {unit && <span style={{ fontFamily:'Inter', fontSize:15, color: S.sub, fontWeight:500 }}>{unit}</span>}
        </div>
        {/* Trend */}
        {trendLabel && (
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <Icon name={up ? 'ArrowUp' : 'ArrowDown'} size={13} color={up ? S.green : S.red}/>
            <span style={{ fontFamily:'Inter', fontSize:12, color: up ? S.green : S.red, fontWeight:600 }}>{trendLabel}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

// Button components
function Btn({ children, variant='secondary', size='md', onClick, style, disabled }) {
  const base = {
    display:'inline-flex', alignItems:'center', gap:6, cursor: disabled ? 'not-allowed' : 'pointer',
    border:'none', borderRadius:8, fontFamily:'Inter', fontWeight:600, transition:'all 0.15s',
    padding: size==='sm' ? '5px 12px' : '8px 16px',
    fontSize: size==='sm' ? 12 : 13,
    opacity: disabled ? 0.5 : 1,
  };
  const variants = {
    primary:   { background: S.ink,   color:'#fff',    border:'none' },
    secondary: { background:'#fff',   color: S.ink,    border:`1px solid ${S.border}`, boxShadow:'0 1px 2px rgba(0,0,0,0.05)' },
    ghost:     { background:'transparent', color: S.sub, border:'1px solid transparent' },
    wb:        { background:'rgba(203,17,171,0.06)', color: S.wb, border:`1px solid rgba(203,17,171,0.25)` },
    oz:        { background:'rgba(0,91,255,0.06)',   color: S.oz, border:`1px solid rgba(0,91,255,0.25)` },
    ym:        { background:'rgba(255,102,0,0.06)',  color: S.ym, border:`1px solid rgba(255,102,0,0.25)` },
    danger:    { background:'rgba(239,68,68,0.08)',  color: S.red, border:`1px solid rgba(239,68,68,0.2)` },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={e => { if (!disabled && variant==='secondary') e.currentTarget.style.background='#f8fafc'; }}
      onMouseLeave={e => { if (!disabled && variant==='secondary') e.currentTarget.style.background='#fff'; }}
    >{children}</button>
  );
}

// Badge/pill
function Badge({ label, color, bg, style }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', padding:'2px 8px',
      borderRadius:999, fontFamily:'Inter', fontSize:11, fontWeight:600,
      background: bg, color: color,
      ...style,
    }}>{label}</span>
  );
}

// Marketplace pill
function MPBadge({ mp, size=11 }) {
  const cfg = {
    WB: { bg: S.wb,  label:'WB' },
    OZ: { bg: S.oz,  label:'OZ' },
    YM: { bg: S.ym,  label:'YM' },
  }[mp] || { bg:'#888', label: mp };
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', padding:'2px 7px',
      borderRadius:999, fontFamily:'Montserrat', fontSize:size, fontWeight:700,
      background: cfg.bg, color:'#fff', letterSpacing:'0.02em', flexShrink:0,
    }}>{cfg.label}</span>
  );
}

// Input
function Input({ value, onChange, placeholder, icon, type='text', style }) {
  return (
    <div style={{ position:'relative', display:'flex', alignItems:'center', ...style }}>
      {icon && <div style={{ position:'absolute', left:10, pointerEvents:'none' }}>
        <Icon name={icon} size={15} color={S.muted}/>
      </div>}
      <input value={value} onChange={onChange} type={type} placeholder={placeholder} style={{
        width:'100%', padding: icon ? '8px 12px 8px 34px' : '8px 12px',
        borderRadius:8, border:`1px solid ${S.border}`,
        fontFamily:'Inter', fontSize:13, color: S.ink,
        background:'#fff', outline:'none',
        boxShadow:'0 1px 2px rgba(0,0,0,0.04)',
      }}/>
    </div>
  );
}

// Modal overlay
function Modal({ open, onClose, title, children, width=480 }) {
  if (!open) return null;
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.5)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:'#fff', borderRadius:20, padding:28, width, maxWidth:'90vw', boxShadow:'0 25px 50px rgba(0,0,0,0.25)', maxHeight:'85vh', overflowY:'auto' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
          <span style={{ fontFamily:'Inter', fontWeight:700, fontSize:17, color: S.ink }}>{title}</span>
          <button onClick={onClose} style={{ background:'transparent', border:'none', cursor:'pointer', padding:4, borderRadius:6, color: S.muted, display:'flex' }}>
            <Icon name="X" size={18}/>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Toast
function Toast({ toasts }) {
  return (
    <div style={{ position:'fixed', bottom:24, right:24, display:'flex', flexDirection:'column', gap:8, zIndex:2000 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background:'#fff', borderRadius:12, padding:'12px 16px',
          boxShadow:'0 10px 40px rgba(0,0,0,0.15)', display:'flex', alignItems:'center', gap:10,
          borderLeft:`4px solid ${t.type==='success'?S.green:t.type==='error'?S.red:S.blue}`,
          animation:'slideIn 0.2s ease', fontFamily:'Inter', fontSize:13, color: S.ink,
        }}>
          <Icon name={t.type==='success'?'Check':t.type==='error'?'AlertCircle':'Zap'} size={16} color={t.type==='success'?S.green:t.type==='error'?S.red:S.blue}/>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// Table header label
function TH({ children, flex, align='left' }) {
  return (
    <div style={{ flex: flex||1, fontFamily:'Inter', fontSize:11, fontWeight:700, color: S.muted,
      textTransform:'uppercase', letterSpacing:'0.1em', padding:'0 16px', textAlign:align }}>
      {children}
    </div>
  );
}

// Section label
function SectionLabel({ children }) {
  return <div style={{ fontFamily:'Inter', fontSize:11, fontWeight:700, color: S.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>{children}</div>;
}

// Select
function Select({ value, onChange, options, style }) {
  return (
    <select value={value} onChange={e=>onChange(e.target.value)} style={{
      padding:'7px 28px 7px 10px', borderRadius:8, border:`1px solid ${S.border}`,
      fontFamily:'Inter', fontSize:13, color: S.ink, background:'#fff',
      outline:'none', cursor:'pointer', appearance:'none',
      backgroundImage:`url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
      backgroundRepeat:'no-repeat', backgroundPosition:'right 10px center',
      ...style
    }}>
      {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// Toggle
function Toggle({ on, onChange }) {
  return (
    <div onClick={() => onChange(!on)} style={{
      width:36, height:20, borderRadius:999, background: on ? S.blue : '#e2e8f0',
      cursor:'pointer', position:'relative', transition:'background 0.15s', flexShrink:0,
    }}>
      <div style={{
        position:'absolute', top:2, left: on ? 18 : 2,
        width:16, height:16, borderRadius:'50%', background:'#fff',
        boxShadow:'0 1px 3px rgba(0,0,0,0.15)', transition:'left 0.15s',
      }}/>
    </div>
  );
}

Object.assign(window, {
  S, Sidebar, PageHeader, Card, KpiCard, Btn, Badge, MPBadge,
  Input, Modal, Toast, TH, SectionLabel, Select, Toggle, NAV,
});
