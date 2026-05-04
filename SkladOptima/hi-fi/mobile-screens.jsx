// ─── Mobile screens for SkladOptima ──────────────────────────────────────────
const { useState: useStateM } = React;

const PRODUCTS_M = [
  { id:1, name:'Стол Офис-1',       sku:'OFF-001', warehouse:47, available:42, wb:20, oz:24, ym:10, color:'#3b82f6' },
  { id:2, name:'Кресло CHA',         sku:'CHA-002', warehouse:3,  available:1,  wb:1,  oz:3,  ym:1,  color:'#f59e0b' },
  { id:3, name:'Шкаф 2-дверный',     sku:'SKF-003', warehouse:28, available:18, wb:8,  oz:6,  ym:4,  color:'#10b981' },
  { id:4, name:'Тумба прикроватная', sku:'TUM-004', warehouse:15, available:9,  wb:5,  oz:4,  ym:4,  color:'#8b5cf6' },
  { id:5, name:'Диван угловой ДУ-5', sku:'DIV-005', warehouse:0,  available:0,  wb:0,  oz:0,  ym:0,  color:'#ef4444' },
  { id:6, name:'Стеллаж СТ-6',       sku:'STL-006', warehouse:22, available:12, wb:12, oz:10, ym:7,  color:'#06b6d4' },
];

const ORDERS_M = [
  { id:'7834561',   date:'14:22', mp:'WB', name:'Стол Офис-1',  qty:1, sum:12490, status:'На сборке',     urgent:2 },
  { id:'OZ-892345', date:'10:05', mp:'OZ', name:'Кресло CHA',   qty:2, sum:8780,  status:'Доставляется',  urgent:6 },
  { id:'YM-334411', date:'09:10', mp:'YM', name:'Стол Офис-1',  qty:1, sum:12490, status:'К отгрузке',    urgent:7 },
  { id:'7834200',   date:'вчера', mp:'WB', name:'Шкаф 2-дв.',   qty:1, sum:18900, status:'Отгружен' },
  { id:'OZ-891100', date:'вчера', mp:'OZ', name:'Стеллаж СТ-6', qty:2, sum:7600,  status:'Доставлен' },
];

const M_REVENUE = Array.from({length:14},(_,i)=>({d:i+1, v:6000+Math.round(Math.sin(i*0.5)*2000+Math.random()*1500)}));

// ─── Top header for mobile pages ────────────────────────────────────────────
function MTop({ title, subtitle, action }) {
  return (
    <div style={{ padding:'8px 20px 12px' }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
        <div>
          <div style={{ fontFamily:'Inter', fontWeight:800, fontSize:26, color: S.ink, letterSpacing:'-0.02em', lineHeight:1.1 }}>{title}</div>
          {subtitle && <div style={{ fontFamily:'Inter', fontSize:12, color: S.sub, marginTop:4 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}

// ─── ОСТАТКИ — Card list ────────────────────────────────────────────────────
function MProductsScreen({ onToast }) {
  const [search, setSearch] = useStateM('');
  const filtered = PRODUCTS_M.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
  );
  const totalSku = PRODUCTS_M.length;
  const lowStock = PRODUCTS_M.filter(p=>p.available<=5).length;

  return (
    <div>
      <MTop title="Остатки" subtitle={`${totalSku} SKU • ${lowStock} низкий остаток`}
        action={<button onClick={()=>onToast('info','Новый товар')} style={{ width:36, height:36, borderRadius:10, background:S.ink, border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
          <Icon name="Plus" size={16} color="#fff" strokeWidth={2.5}/>
        </button>}
      />

      {/* Search */}
      <div style={{ padding:'4px 20px 12px' }}>
        <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск товара…" icon="Search"/>
      </div>

      {/* Sync chips */}
      <div style={{ padding:'0 20px 16px', display:'flex', gap:8, overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
        {[['WB',S.wb],['Ozon',S.oz],['YM',S.ym]].map(([l,c])=>(
          <button key={l} onClick={()=>onToast('success',`Синхр. ${l} ✓`)} style={{
            padding:'6px 12px', borderRadius:999, border:`1px solid ${c}40`,
            background:`${c}0d`, color:c, fontFamily:'Inter', fontSize:12, fontWeight:600,
            display:'inline-flex', alignItems:'center', gap:5, cursor:'pointer', flexShrink:0,
          }}>
            <Icon name="RefreshCw" size={11}/>Синхронизировать {l}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div style={{ padding:'0 20px', display:'flex', flexDirection:'column', gap:10 }}>
        {filtered.map(p => {
          const ac = p.available===0 ? {bg:'rgba(239,68,68,0.08)',color:S.red} : p.available<=5 ? {bg:'rgba(245,158,11,0.1)',color:S.amber} : {bg:'rgba(16,185,129,0.08)',color:S.green};
          return (
            <div key={p.id} style={{
              background:'#fff', borderRadius:16, padding:'14px 14px 12px',
              border:`1px solid ${S.border}`, boxShadow:'0 1px 2px rgba(0,0,0,0.04)',
            }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                <div style={{ width:46, height:46, borderRadius:10, background:`${p.color}1a`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <Icon name="Package" size={20} color={p.color}/>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:'Inter', fontWeight:600, fontSize:14, color:S.ink, lineHeight:1.3 }}>{p.name}</div>
                  <div style={{ fontFamily:'JetBrains Mono', fontSize:10, color:S.muted, marginTop:2 }}>{p.sku}</div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontFamily:'Inter', fontWeight:800, fontSize:22, color:S.ink, letterSpacing:'-0.02em', lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{p.available}</div>
                  <div style={{ fontFamily:'Inter', fontSize:10, color:S.muted, marginTop:2 }}>доступно</div>
                </div>
              </div>
              {/* footer row */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:12, paddingTop:10, borderTop:`1px solid ${S.border}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontFamily:'Inter', fontSize:11, color:S.wb, fontWeight:600 }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:S.wb }}/>{p.wb}
                  </span>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontFamily:'Inter', fontSize:11, color:S.oz, fontWeight:600 }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:S.oz }}/>{p.oz}
                  </span>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontFamily:'Inter', fontSize:11, color:S.ym, fontWeight:600 }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:S.ym }}/>{p.ym}
                  </span>
                </div>
                <Badge label={p.available===0?'Нет':p.available<=5?'Мало':'В наличии'} bg={ac.bg} color={ac.color}/>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ height:24 }}/>
    </div>
  );
}

// ─── АНАЛИТИКА ──────────────────────────────────────────────────────────────
function MAnalyticsScreen() {
  const total = M_REVENUE.reduce((s,d)=>s+d.v,0);
  return (
    <div>
      <MTop title="Аналитика" subtitle="14 дней"/>

      {/* KPI 2x2 grid */}
      <div style={{ padding:'0 20px 16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        {[
          {label:'Группа A', value:'15', unit:'SKU', icon:'TrendingUp', accent:S.blue, trend:'+3 за 30 дн', up:true},
          {label:'Out-of-stock', value:'3', unit:'риск', icon:'AlertCircle', accent:S.red, trend:'+1 за 7 дн', up:false},
          {label:'Рейтинг', value:'4.82', icon:'Star', accent:S.amber, trend:'+0.1 за мес', up:true},
          {label:'Всего SKU', value:'87', icon:'Package', accent:'#94a3b8', trend:'+5 за квартал', up:true},
        ].map(k=>(
          <div key={k.label} style={{ background:'#fff', borderRadius:14, overflow:'hidden', border:`1px solid ${S.border}`, boxShadow:'0 1px 2px rgba(0,0,0,0.04)' }}>
            <div style={{ height:3, background:`linear-gradient(90deg,${k.accent},${k.accent}aa)` }}/>
            <div style={{ padding:'12px 14px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
                <span style={{ fontFamily:'Inter', fontSize:9, fontWeight:700, color:S.muted, textTransform:'uppercase', letterSpacing:'0.08em' }}>{k.label}</span>
                <Icon name={k.icon} size={14} color={S.muted} style={{ opacity:0.2 }}/>
              </div>
              <div style={{ display:'flex', alignItems:'baseline', gap:4 }}>
                <span style={{ fontFamily:'Inter', fontWeight:900, fontSize:26, color:S.ink, letterSpacing:'-0.03em', lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{k.value}</span>
                {k.unit && <span style={{ fontFamily:'Inter', fontSize:10, color:S.sub, fontWeight:500 }}>{k.unit}</span>}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:3, marginTop:6 }}>
                <Icon name={k.up?'ArrowUp':'ArrowDown'} size={10} color={k.up?S.green:S.red}/>
                <span style={{ fontFamily:'Inter', fontSize:10, fontWeight:600, color:k.up?S.green:S.red }}>{k.trend}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Revenue card */}
      <div style={{ padding:'0 20px 16px' }}>
        <div style={{ background:'#fff', borderRadius:16, padding:'16px', border:`1px solid ${S.border}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
            <div>
              <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:13, color:S.ink }}>Выручка</div>
              <div style={{ fontFamily:'Inter', fontSize:11, color:S.muted, marginTop:2 }}>14 дней</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontFamily:'Inter', fontWeight:800, fontSize:18, color:S.ink, letterSpacing:'-0.02em', fontVariantNumeric:'tabular-nums' }}>{total.toLocaleString('ru')} ₽</div>
              <div style={{ display:'inline-flex', alignItems:'center', gap:3, marginTop:2 }}>
                <Icon name="ArrowUp" size={10} color={S.green}/>
                <span style={{ fontFamily:'Inter', fontSize:10, color:S.green, fontWeight:600 }}>+12.4%</span>
              </div>
            </div>
          </div>
          <div style={{ height:130 }}>
            <Recharts.ResponsiveContainer width="100%" height="100%">
              <Recharts.AreaChart data={M_REVENUE} margin={{top:4,right:0,left:-30,bottom:0}}>
                <defs>
                  <linearGradient id="mGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={S.blue} stopOpacity={0.25}/>
                    <stop offset="95%" stopColor={S.blue} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Recharts.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                <Recharts.XAxis dataKey="d" tick={{fontSize:9,fill:S.muted}} axisLine={false} tickLine={false}/>
                <Recharts.YAxis tick={{fontSize:9,fill:S.muted}} axisLine={false} tickLine={false} tickFormatter={v=>(v/1000).toFixed(0)+'k'}/>
                <Recharts.Area type="monotone" dataKey="v" stroke={S.blue} strokeWidth={2} fill="url(#mGrad)" dot={false}/>
              </Recharts.AreaChart>
            </Recharts.ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ABC */}
      <div style={{ padding:'0 20px 24px' }}>
        <div style={{ background:'#fff', borderRadius:16, padding:'16px', border:`1px solid ${S.border}` }}>
          <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:13, color:S.ink, marginBottom:14 }}>ABC-анализ</div>
          {[
            {l:'A', n:15, pct:17, c:S.blue},
            {l:'B', n:35, pct:40, c:S.amber},
            {l:'C', n:37, pct:43, c:S.red},
          ].map(g=>(
            <div key={g.l} style={{ marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:5 }}>
                <span style={{ fontFamily:'Inter', fontSize:12, color:S.ink, fontWeight:600 }}>Группа {g.l}</span>
                <span style={{ fontFamily:'Inter', fontSize:11, color:S.muted }}>{g.n} SKU • {g.pct}%</span>
              </div>
              <div style={{ height:6, background:'#f1f5f9', borderRadius:999, overflow:'hidden' }}>
                <div style={{ width:`${g.pct}%`, height:'100%', background:g.c, borderRadius:999, transition:'width 0.4s' }}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ЮНИТ-ЭКОНОМИКА ─────────────────────────────────────────────────────────
function MFinanceScreen() {
  const items = [
    { mp:'WB', name:'Стол Офис-1', sku:'OFF-001', revenue:12490, cost:6200, commission:1873, ads:480, profit:3937, margin:31 },
    { mp:'OZ', name:'Кресло CHA', sku:'CHA-002', revenue:4390, cost:2100, commission:702, ads:200, profit:1388, margin:32 },
    { mp:'YM', name:'Шкаф 2-дв.', sku:'SKF-003', revenue:18900, cost:11200, commission:2268, ads:800, profit:4632, margin:25 },
    { mp:'WB', name:'Тумба прикр.', sku:'TUM-004', revenue:5290, cost:3100, commission:794, ads:300, profit:1096, margin:21 },
  ];
  const totalRev = items.reduce((s,i)=>s+i.revenue,0);
  const totalProfit = items.reduce((s,i)=>s+i.profit,0);
  const avgMargin = Math.round(items.reduce((s,i)=>s+i.margin,0)/items.length);

  return (
    <div>
      <MTop title="Юнит-экономика" subtitle="Прибыль по товарам"/>

      {/* Hero KPI */}
      <div style={{ padding:'0 20px 14px' }}>
        <div style={{
          background:'linear-gradient(135deg,#1e40af,#4f46e5)', borderRadius:18, padding:'18px 18px 16px',
          color:'#fff', boxShadow:'0 4px 16px rgba(30,64,175,0.25)',
        }}>
          <div style={{ fontFamily:'Inter', fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.65)', textTransform:'uppercase', letterSpacing:'0.1em' }}>Чистая прибыль · 30 дней</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:6, marginTop:8 }}>
            <span style={{ fontFamily:'Inter', fontWeight:900, fontSize:34, letterSpacing:'-0.03em', lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{totalProfit.toLocaleString('ru')}</span>
            <span style={{ fontFamily:'Inter', fontSize:14, opacity:0.7, fontWeight:500 }}>₽</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:14, paddingTop:14, borderTop:'1px solid rgba(255,255,255,0.15)' }}>
            <div>
              <div style={{ fontFamily:'Inter', fontSize:10, color:'rgba(255,255,255,0.6)', textTransform:'uppercase', letterSpacing:'0.08em' }}>Выручка</div>
              <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:14, marginTop:3 }}>{totalRev.toLocaleString('ru')} ₽</div>
            </div>
            <div>
              <div style={{ fontFamily:'Inter', fontSize:10, color:'rgba(255,255,255,0.6)', textTransform:'uppercase', letterSpacing:'0.08em' }}>Маржа</div>
              <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:14, marginTop:3 }}>{avgMargin}%</div>
            </div>
            <div>
              <div style={{ fontFamily:'Inter', fontSize:10, color:'rgba(255,255,255,0.6)', textTransform:'uppercase', letterSpacing:'0.08em' }}>Заказов</div>
              <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:14, marginTop:3 }}>147</div>
            </div>
          </div>
        </div>
      </div>

      {/* Items */}
      <div style={{ padding:'0 20px 24px', display:'flex', flexDirection:'column', gap:10 }}>
        {items.map((it,i)=>(
          <div key={i} style={{ background:'#fff', borderRadius:14, padding:'14px', border:`1px solid ${S.border}`, boxShadow:'0 1px 2px rgba(0,0,0,0.04)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0, flex:1 }}>
                <MPBadge mp={it.mp} size={10}/>
                <span style={{ fontFamily:'Inter', fontWeight:600, fontSize:13, color:S.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.name}</span>
              </div>
              <Badge label={`${it.margin}%`} bg={it.margin>=30?'rgba(16,185,129,0.1)':it.margin>=20?'rgba(245,158,11,0.1)':'rgba(239,68,68,0.1)'} color={it.margin>=30?S.green:it.margin>=20?S.amber:S.red}/>
            </div>
            {/* Breakdown */}
            <div style={{ display:'flex', flexDirection:'column', gap:5, fontFamily:'Inter', fontSize:11 }}>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:S.muted }}>Выручка</span>
                <span style={{ color:S.ink, fontWeight:600, fontVariantNumeric:'tabular-nums' }}>+{it.revenue.toLocaleString('ru')} ₽</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:S.muted }}>Себестоимость</span>
                <span style={{ color:S.red, fontWeight:500, fontVariantNumeric:'tabular-nums' }}>−{it.cost.toLocaleString('ru')} ₽</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:S.muted }}>Комиссия МП</span>
                <span style={{ color:S.red, fontWeight:500, fontVariantNumeric:'tabular-nums' }}>−{it.commission.toLocaleString('ru')} ₽</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:S.muted }}>Реклама</span>
                <span style={{ color:S.red, fontWeight:500, fontVariantNumeric:'tabular-nums' }}>−{it.ads.toLocaleString('ru')} ₽</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', paddingTop:7, marginTop:3, borderTop:`1px solid ${S.border}` }}>
                <span style={{ color:S.ink, fontWeight:700 }}>Прибыль</span>
                <span style={{ color:S.green, fontWeight:800, fontVariantNumeric:'tabular-nums' }}>+{it.profit.toLocaleString('ru')} ₽</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ЗАКАЗЫ ─────────────────────────────────────────────────────────────────
function MOrdersScreen() {
  const [tab, setTab] = useStateM('all');
  const tabs = [['all','Все'],['WB','WB'],['OZ','OZ'],['YM','YM']];
  const filtered = tab==='all' ? ORDERS_M : ORDERS_M.filter(o=>o.mp===tab);
  const statusColor = (s) => ({
    'На сборке':       {bg:'rgba(59,130,246,0.1)', color:S.blue},
    'Доставляется':    {bg:'rgba(245,158,11,0.1)', color:S.amber},
    'К отгрузке':      {bg:'rgba(16,185,129,0.1)', color:S.green},
    'Отгружен':        {bg:'rgba(100,116,139,0.1)',color:S.sub},
    'Доставлен':       {bg:'rgba(16,185,129,0.1)', color:S.green},
  }[s] || {bg:'#f1f5f9',color:S.muted});

  return (
    <div>
      <MTop title="Заказы" subtitle={`${ORDERS_M.length} заказов сегодня`}/>

      {/* Tabs */}
      <div style={{ padding:'0 20px 14px', display:'flex', gap:6 }}>
        {tabs.map(([v,l])=>(
          <button key={v} onClick={()=>setTab(v)} style={{
            padding:'7px 14px', borderRadius:999, border:'none',
            background: tab===v ? S.ink : '#f1f5f9',
            color: tab===v ? '#fff' : S.sub,
            fontFamily:'Inter', fontSize:12, fontWeight:600, cursor:'pointer',
            transition:'all 0.15s',
          }}>{l}</button>
        ))}
      </div>

      {/* Cards */}
      <div style={{ padding:'0 20px 24px', display:'flex', flexDirection:'column', gap:10 }}>
        {filtered.map(o=>{
          const sc = statusColor(o.status);
          return (
            <div key={o.id} style={{ background:'#fff', borderRadius:14, padding:'14px', border:`1px solid ${S.border}`, boxShadow:'0 1px 2px rgba(0,0,0,0.04)' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <MPBadge mp={o.mp} size={10}/>
                  <span style={{ fontFamily:'JetBrains Mono', fontSize:11, color:S.sub }}>{o.id}</span>
                </div>
                <span style={{ fontFamily:'Inter', fontSize:11, color:S.muted }}>{o.date}</span>
              </div>
              <div style={{ fontFamily:'Inter', fontWeight:600, fontSize:14, color:S.ink, marginBottom:6 }}>
                {o.name} <span style={{ color:S.muted, fontWeight:400 }}>×{o.qty}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:8 }}>
                <Badge label={o.status} bg={sc.bg} color={sc.color}/>
                <span style={{ fontFamily:'Inter', fontWeight:700, fontSize:14, color:S.ink, fontVariantNumeric:'tabular-nums' }}>{o.sum.toLocaleString('ru')} ₽</span>
              </div>
              {o.urgent && (
                <div style={{ display:'inline-flex', alignItems:'center', gap:4, marginTop:8, background:'rgba(239,68,68,0.08)', padding:'3px 8px', borderRadius:999 }}>
                  <Icon name="Clock" size={10} color={S.red}/>
                  <span style={{ fontFamily:'Inter', fontSize:10, fontWeight:600, color:S.red }}>До отгрузки {o.urgent}ч</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ЕЩЁ ────────────────────────────────────────────────────────────────────
function MMoreScreen({ onNav, onToast }) {
  const sections = [
    { label:'УПРАВЛЕНИЕ', items:[
      { id:'history',   icon:'Clock',         label:'История изменений',  hint:'12 событий за неделю' },
      { id:'telegram',  icon:'Bell',          label:'Уведомления',        hint:'Telegram • активно',  status:'ok' },
      { id:'settings',  icon:'Settings',      label:'Настройки',          hint:'Магазин и API ключи' },
    ]},
    { label:'ИНТЕГРАЦИИ', items:[
      { id:'wb',        icon:'Store',         label:'Wildberries',        hint:'Подключено',          status:'ok' },
      { id:'oz',        icon:'Store',         label:'Ozon',               hint:'Ошибка токена',       status:'error' },
      { id:'ym',        icon:'Store',         label:'Яндекс Маркет',      hint:'Подключено',          status:'ok' },
    ]},
    { label:'ДРУГОЕ', items:[
      { id:'export',    icon:'Download',      label:'Экспорт данных',     hint:'CSV / Excel' },
      { id:'support',   icon:'MessageCircle', label:'Поддержка',          hint:'Чат в Telegram' },
      { id:'logout',    icon:'LogOut',        label:'Выйти',              hint:'user@mail.ru', danger:true },
    ]},
  ];

  return (
    <div>
      <MTop title="Ещё"/>

      {/* User card */}
      <div style={{ padding:'0 20px 16px' }}>
        <div style={{ background:'#fff', borderRadius:16, padding:'14px', border:`1px solid ${S.border}`, display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:46, height:46, borderRadius:'50%', background:'linear-gradient(135deg,#3b82f6,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <span style={{ fontFamily:'Inter', fontWeight:700, fontSize:14, color:'#fff' }}>МС</span>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:14, color:S.ink }}>Мебель СТО</div>
            <div style={{ fontFamily:'Inter', fontSize:11, color:S.muted, marginTop:2 }}>user@mail.ru · УСН 6%</div>
          </div>
          <Icon name="ChevronRight" size={16} color={S.muted}/>
        </div>
      </div>

      {/* Sections */}
      <div style={{ padding:'0 20px 24px', display:'flex', flexDirection:'column', gap:18 }}>
        {sections.map(sec=>(
          <div key={sec.label}>
            <div style={{ fontFamily:'Inter', fontSize:10, fontWeight:700, color:S.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8, paddingLeft:4 }}>{sec.label}</div>
            <div style={{ background:'#fff', borderRadius:14, border:`1px solid ${S.border}`, overflow:'hidden' }}>
              {sec.items.map((it,i)=>{
                const isLast = i===sec.items.length-1;
                const c = it.danger ? S.red : it.status==='error' ? S.red : it.status==='ok' ? S.green : S.ink;
                return (
                  <button key={it.id} onClick={()=>onToast('info',it.label)} style={{
                    width:'100%', display:'flex', alignItems:'center', gap:12,
                    padding:'13px 14px', border:'none', background:'transparent', cursor:'pointer',
                    borderBottom: isLast ? 'none' : `1px solid ${S.border}`, textAlign:'left',
                  }}>
                    <div style={{ width:32, height:32, borderRadius:8, background: it.danger ? 'rgba(239,68,68,0.08)' : '#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <Icon name={it.icon} size={15} color={c}/>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontFamily:'Inter', fontWeight:500, fontSize:13, color: it.danger ? S.red : S.ink }}>{it.label}</div>
                      {it.hint && <div style={{ fontFamily:'Inter', fontSize:11, color: it.status==='error'?S.red:S.muted, marginTop:1 }}>{it.hint}</div>}
                    </div>
                    {it.status==='ok' && <div style={{ width:7, height:7, borderRadius:'50%', background:S.green, flexShrink:0, marginRight:4 }}/>}
                    {it.status==='error' && <div style={{ width:7, height:7, borderRadius:'50%', background:S.red, flexShrink:0, marginRight:4 }}/>}
                    {!it.danger && <Icon name="ChevronRight" size={14} color={S.muted}/>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div style={{ fontFamily:'Inter', fontSize:10, color:S.muted, textAlign:'center', marginTop:8 }}>SkladOptima v2.4.1</div>
      </div>
    </div>
  );
}

// ─── BOTTOM TAB BAR ─────────────────────────────────────────────────────────
function MTabBar({ active, onNav }) {
  const tabs = [
    { id:'products',  label:'Остатки',      icon:'Package' },
    { id:'analytics', label:'Аналитика',    icon:'BarChart2' },
    { id:'finance',   label:'Юнит',         icon:'DollarSign' },
    { id:'orders',    label:'Заказы',       icon:'ShoppingCart', badge:3 },
    { id:'more',      label:'Ещё',          icon:'Settings' },
  ];
  return (
    <div style={{
      position:'absolute', bottom:0, left:0, right:0, zIndex:30,
      background:'rgba(255,255,255,0.92)',
      backdropFilter:'blur(20px) saturate(180%)',
      WebkitBackdropFilter:'blur(20px) saturate(180%)',
      borderTop:`1px solid ${S.border}`,
      paddingBottom:34, // home indicator zone
    }}>
      <div style={{ display:'flex', padding:'8px 4px 4px' }}>
        {tabs.map(t=>{
          const isActive = t.id===active;
          return (
            <button key={t.id} onClick={()=>onNav(t.id)} style={{
              flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3,
              padding:'6px 4px', border:'none', background:'transparent', cursor:'pointer',
              position:'relative',
            }}>
              <div style={{ position:'relative' }}>
                <Icon name={t.icon} size={22} color={isActive ? S.ink : S.muted} strokeWidth={isActive ? 2.2 : 1.75}/>
                {t.badge && (
                  <span style={{
                    position:'absolute', top:-4, right:-7, minWidth:16, height:16, padding:'0 4px',
                    borderRadius:999, background:S.red, color:'#fff',
                    fontFamily:'Inter', fontSize:10, fontWeight:700,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    border:'2px solid #fff', boxSizing:'content-box',
                  }}>{t.badge}</span>
                )}
              </div>
              <span style={{ fontFamily:'Inter', fontSize:10, fontWeight: isActive?700:500, color: isActive ? S.ink : S.muted, letterSpacing:'-0.01em' }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, {
  MProductsScreen, MAnalyticsScreen, MFinanceScreen, MOrdersScreen, MMoreScreen, MTabBar,
});
