// ─── All Screens ─────────────────────────────────────────────────────────────
const { useState, useMemo } = React;
const { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
        PieChart, Pie, Cell, Legend } = Recharts;

// ─── Sample Data ─────────────────────────────────────────────────────────────
const PRODUCTS = [
  { id:1, name:'Стол Офис-1',       sku:'OFF-001', warehouse:47, reserved:5,  wb:{fbs:12,fbo:8},  oz:{fbs:9,fbo:15},  ym:{fbs:6,fbo:4},  available:42, photo:null },
  { id:2, name:'Кресло CHA',         sku:'CHA-002', warehouse:3,  reserved:2,  wb:{fbs:1,fbo:0},   oz:{fbs:2,fbo:1},   ym:{fbs:0,fbo:1},  available:1,  photo:null },
  { id:3, name:'Шкаф 2-дверный',     sku:'SKF-003', warehouse:28, reserved:3,  wb:{fbs:5,fbo:3},   oz:{fbs:4,fbo:2},   ym:{fbs:3,fbo:1},  available:18, photo:null },
  { id:4, name:'Тумба прикроватная', sku:'TUM-004', warehouse:15, reserved:1,  wb:{fbs:3,fbo:2},   oz:{fbs:3,fbo:1},   ym:{fbs:2,fbo:2},  available:9,  photo:null },
  { id:5, name:'Диван угловой ДУ-5', sku:'DIV-005', warehouse:0,  reserved:0,  wb:{fbs:0,fbo:0},   oz:{fbs:0,fbo:0},   ym:{fbs:0,fbo:0},  available:0,  photo:null },
  { id:6, name:'Стеллаж СТ-6',       sku:'STL-006', warehouse:22, reserved:4,  wb:{fbs:7,fbo:5},   oz:{fbs:6,fbo:4},   ym:{fbs:4,fbo:3},  available:12, photo:null },
];

const REVENUE_DATA = Array.from({length:30},(_,i)=>{
  const d = new Date(2026,2,22+i);
  const lbl = d.toLocaleDateString('ru',{day:'numeric',month:'short'});
  return { date: lbl, wb: 6000+Math.round(Math.sin(i*0.4)*2000+Math.random()*1500), oz: 4000+Math.round(Math.sin(i*0.3+1)*1500+Math.random()*1200), ym: 2500+Math.round(Math.sin(i*0.5+2)*1000+Math.random()*800) };
});

const ORDERS = [
  { id:'7834561',   date:'20 апр, 14:22', mp:'WB', product:'Стол Офис-1', sku:'OFF-001', qty:1, sum:12490, status:'На сборке',        ship:'21 апр', urgent:2 },
  { id:'OZ-892345', date:'20 апр, 10:05', mp:'OZ', product:'Кресло CHA',  sku:'CHA-002', qty:2, sum:8780,  status:'Доставляется',     ship:'22 апр', urgent:6 },
  { id:'YM-334411', date:'20 апр, 09:10', mp:'YM', product:'Стол Офис-1', sku:'OFF-001', qty:1, sum:12490, status:'Готов к отгрузке', ship:'21 апр', urgent:7 },
  { id:'7834200',   date:'19 апр, 18:44', mp:'WB', product:'Шкаф 2-дв.',  sku:'SKF-003', qty:1, sum:18900, status:'Отгружен',         ship:'20 апр', urgent:null },
  { id:'OZ-891100', date:'19 апр, 15:30', mp:'OZ', product:'Стеллаж',     sku:'STL-006', qty:2, sum:7600,  status:'Доставлен',        ship:'19 апр', urgent:null },
];

// ─── Products Screen ──────────────────────────────────────────────────────────
function ProductsScreen({ onToast }) {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(null); // 'new' | 'adjust' | 'delete'
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [adjustDelta, setAdjustDelta] = useState(0);
  const [adjustNote, setAdjustNote] = useState('');
  const [syncing, setSyncing] = useState(null);

  const filtered = PRODUCTS.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
  );

  const handleSync = (mp) => {
    setSyncing(mp);
    setTimeout(() => { setSyncing(null); onToast('success', `Синхронизация с ${mp} завершена`); }, 1800);
  };

  const availColor = (n) => n === 0 ? { bg:'rgba(239,68,68,0.08)', color: S.red } : n <= 5 ? { bg:'rgba(245,158,11,0.08)', color: S.amber } : { bg:'rgba(16,185,129,0.08)', color: S.green };

  return (
    <div>
      <PageHeader title="Остатки товаров" subtitle="Управление запасами по всем маркетплейсам">
        <Btn variant="wb" size="sm" onClick={()=>handleSync('WB')}>
          {syncing==='WB' ? <span style={{fontFamily:'Inter',fontSize:11}}>↻ WB…</span> : <><Icon name="RefreshCw" size={13}/>WB</>}
        </Btn>
        <Btn variant="oz" size="sm" onClick={()=>handleSync('OZ')}>
          {syncing==='OZ' ? <span style={{fontFamily:'Inter',fontSize:11}}>↻ OZ…</span> : <><Icon name="RefreshCw" size={13}/>Ozon</>}
        </Btn>
        <Btn variant="ym" size="sm" onClick={()=>handleSync('YM')}>
          {syncing==='YM' ? <span style={{fontFamily:'Inter',fontSize:11}}>↻ YM…</span> : <><Icon name="RefreshCw" size={13}/>YM</>}
        </Btn>
        <Btn variant="secondary" size="sm"><Icon name="Download" size={13}/>Импорт</Btn>
        <Btn variant="primary" size="sm" onClick={()=>setShowModal('new')}><Icon name="Plus" size={13}/>Новый товар</Btn>
      </PageHeader>

      <Card noPad>
        {/* Search bar */}
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${S.border}`, display:'flex', gap:10 }}>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск по названию или SKU…" icon="Search" style={{ flex:1, maxWidth:340 }}/>
          <Btn variant="ghost" size="sm"><Icon name="Filter" size={13}/>Фильтры</Btn>
        </div>

        {/* Table header */}
        <div style={{ display:'flex', alignItems:'center', padding:'12px 0', borderBottom:`1px solid ${S.border}` }}>
          <TH flex={0.4}></TH>
          <TH flex={2.2}>Название</TH>
          <TH flex={1}>SKU</TH>
          <TH flex={0.8}>Склад</TH>
          <TH flex={0.9} align="center">WB</TH>
          <TH flex={0.9} align="center">Ozon</TH>
          <TH flex={0.9} align="center">YM</TH>
          <TH flex={0.9} align="center">Доступно</TH>
          <TH flex={0.8} align="center">Действия</TH>
        </div>

        {/* Rows */}
        {filtered.map(p => {
          const ac = availColor(p.available);
          return (
            <div key={p.id} style={{ display:'flex', alignItems:'center', padding:'0', borderBottom:`1px solid ${S.border}`, height:56, transition:'background 0.15s' }}
              onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              {/* Photo */}
              <div style={{ flex:0.4, padding:'0 16px', display:'flex', alignItems:'center' }}>
                <div style={{ width:34, height:34, borderRadius:8, background:'#f1f5f9', border:`1px solid ${S.border}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Icon name="Package" size={14} color={S.muted}/>
                </div>
              </div>
              {/* Name */}
              <div style={{ flex:2.2, padding:'0 16px' }}>
                <div style={{ fontFamily:'Inter', fontSize:13, fontWeight:600, color: S.ink }}>{p.name}</div>
              </div>
              {/* SKU */}
              <div style={{ flex:1, padding:'0 16px' }}>
                <span style={{ fontFamily:'JetBrains Mono', fontSize:11, color: S.sub, background:'#f1f5f9', padding:'2px 6px', borderRadius:4 }}>{p.sku}</span>
              </div>
              {/* Warehouse */}
              <div style={{ flex:0.8, padding:'0 16px' }}>
                <span style={{ fontFamily:'Inter', fontSize:13, color: S.ink }}>{p.warehouse}</span>
                <span style={{ fontFamily:'Inter', fontSize:11, color: S.muted }}> / р.{p.reserved}</span>
              </div>
              {/* WB */}
              <div style={{ flex:0.9, padding:'0 16px', textAlign:'center' }}>
                <span style={{ fontFamily:'Inter', fontSize:12, color: S.wb, fontWeight:500 }}>{p.wb.fbs}<span style={{ color: S.muted }}>/</span>{p.wb.fbo}</span>
              </div>
              {/* Ozon */}
              <div style={{ flex:0.9, padding:'0 16px', textAlign:'center' }}>
                <span style={{ fontFamily:'Inter', fontSize:12, color: S.oz, fontWeight:500 }}>{p.oz.fbs}<span style={{ color: S.muted }}>/</span>{p.oz.fbo}</span>
              </div>
              {/* YM */}
              <div style={{ flex:0.9, padding:'0 16px', textAlign:'center' }}>
                <span style={{ fontFamily:'Inter', fontSize:12, color: S.ym, fontWeight:500 }}>{p.ym.fbs}<span style={{ color: S.muted }}>/</span>{p.ym.fbo}</span>
              </div>
              {/* Available */}
              <div style={{ flex:0.9, padding:'0 16px', display:'flex', justifyContent:'center' }}>
                <Badge label={`${p.available} шт.`} bg={ac.bg} color={ac.color}/>
              </div>
              {/* Actions */}
              <div style={{ flex:0.8, padding:'0 12px', display:'flex', justifyContent:'center', gap:4 }}>
                <button onClick={()=>{setSelectedProduct(p);setAdjustDelta(0);setAdjustNote('');setShowModal('adjust');}} style={{ background:'transparent', border:'none', cursor:'pointer', padding:5, borderRadius:6, color: S.muted, display:'flex' }}
                  onMouseEnter={e=>{e.currentTarget.style.background='#f1f5f9';e.currentTarget.style.color=S.blue;}}
                  onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color=S.muted;}}
                  title="Корректировка остатка"><Icon name="RefreshCw" size={14}/></button>
                <button style={{ background:'transparent', border:'none', cursor:'pointer', padding:5, borderRadius:6, color: S.muted, display:'flex' }}
                  onMouseEnter={e=>{e.currentTarget.style.background='#f1f5f9';e.currentTarget.style.color=S.ink;}}
                  onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color=S.muted;}}
                  title="Редактировать"><Icon name="Edit" size={14}/></button>
                <button onClick={()=>{setSelectedProduct(p);setShowModal('delete');}} style={{ background:'transparent', border:'none', cursor:'pointer', padding:5, borderRadius:6, color: S.muted, display:'flex' }}
                  onMouseEnter={e=>{e.currentTarget.style.background='rgba(239,68,68,0.08)';e.currentTarget.style.color=S.red;}}
                  onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color=S.muted;}}
                  title="Удалить"><Icon name="Trash2" size={14}/></button>
              </div>
            </div>
          );
        })}

        {/* Pagination */}
        <div style={{ padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontFamily:'Inter', fontSize:13, color: S.muted }}>Показано 1–{filtered.length} из {filtered.length} товаров</span>
          <div style={{ display:'flex', gap:4 }}>
            <Btn variant="secondary" size="sm"><Icon name="ChevronLeft" size={14}/>Назад</Btn>
            <div style={{ width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', background: S.ink, borderRadius:8, fontFamily:'Inter', fontSize:13, fontWeight:600, color:'#fff' }}>1</div>
            <Btn variant="secondary" size="sm">Вперёд<Icon name="ChevronRight" size={14}/></Btn>
          </div>
        </div>
      </Card>

      {/* New Product Modal */}
      <Modal open={showModal==='new'} onClose={()=>setShowModal(null)} title="Новый товар">
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div><SectionLabel>Название *</SectionLabel><Input placeholder="Название товара"/></div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div><SectionLabel>SKU *</SectionLabel><Input placeholder="OFF-001" style={{ fontFamily:'JetBrains Mono' }}/></div>
            <div><SectionLabel>WB Баркод</SectionLabel><Input placeholder="2000000000000"/></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div><SectionLabel>YM SKU</SectionLabel><Input placeholder="987654321"/></div>
            <div><SectionLabel>Начальный остаток</SectionLabel><Input type="number" placeholder="0"/></div>
          </div>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
            <Btn variant="secondary" onClick={()=>setShowModal(null)}>Отмена</Btn>
            <Btn variant="primary" onClick={()=>{setShowModal(null);onToast('success','Товар создан');}}>Создать товар</Btn>
          </div>
        </div>
      </Modal>

      {/* Adjust Modal */}
      <Modal open={showModal==='adjust'} onClose={()=>setShowModal(null)} title="Корректировка остатка" width={400}>
        {selectedProduct && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontFamily:'Inter', fontSize:13, color: S.sub, marginBottom:4 }}>{selectedProduct.name} · <span style={{ fontFamily:'JetBrains Mono', fontSize:12 }}>{selectedProduct.sku}</span></div>
              <div style={{ fontFamily:'Inter', fontWeight:900, fontSize:48, color: S.ink, letterSpacing:'-0.03em' }}>{selectedProduct.available}</div>
              <div style={{ fontFamily:'Inter', fontSize:12, color: S.muted }}>текущий остаток</div>
            </div>
            <div>
              <SectionLabel>Изменение (±)</SectionLabel>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <button onClick={()=>setAdjustDelta(d=>d-1)} style={{ width:36, height:36, borderRadius:8, border:`1px solid ${S.border}`, background:'#fff', cursor:'pointer', fontFamily:'Inter', fontSize:18, fontWeight:700, color: S.ink, display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                <input type="number" value={adjustDelta} onChange={e=>setAdjustDelta(Number(e.target.value))} style={{ flex:1, padding:'8px 12px', borderRadius:8, border:`1px solid ${S.border}`, fontFamily:'Inter', fontSize:20, fontWeight:700, textAlign:'center', color: adjustDelta > 0 ? S.green : adjustDelta < 0 ? S.red : S.ink, outline:'none' }}/>
                <button onClick={()=>setAdjustDelta(d=>d+1)} style={{ width:36, height:36, borderRadius:8, border:`1px solid ${S.border}`, background:'#fff', cursor:'pointer', fontFamily:'Inter', fontSize:18, fontWeight:700, color: S.ink, display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
              </div>
            </div>
            <div style={{ background:'#f8fafc', borderRadius:10, padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontFamily:'Inter', fontSize:13, color: S.sub }}>Итоговый остаток</span>
              <span style={{ fontFamily:'Inter', fontWeight:800, fontSize:22, color: S.blue }}>{selectedProduct.available + adjustDelta}</span>
            </div>
            <div><SectionLabel>Примечание</SectionLabel><Input value={adjustNote} onChange={e=>setAdjustNote(e.target.value)} placeholder="Необязательно…"/></div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <Btn variant="secondary" onClick={()=>setShowModal(null)}>Отмена</Btn>
              <Btn variant="primary" onClick={()=>{setShowModal(null);onToast('success','Остаток обновлён');}}>Сохранить</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirm */}
      <Modal open={showModal==='delete'} onClose={()=>setShowModal(null)} title="" width={380}>
        <div style={{ textAlign:'center', padding:'8px 0' }}>
          <div style={{ width:52, height:52, borderRadius:'50%', background:'rgba(239,68,68,0.08)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
            <Icon name="AlertCircle" size={26} color={S.red}/>
          </div>
          <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:17, color: S.ink, marginBottom:8 }}>Удалить товар?</div>
          <div style={{ fontFamily:'Inter', fontSize:13, color: S.sub, marginBottom:24 }}>
            Товар <b>{selectedProduct?.name}</b> и все связанные данные будут удалены без возможности восстановления.
          </div>
          <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
            <Btn variant="secondary" onClick={()=>setShowModal(null)}>Отмена</Btn>
            <Btn variant="danger" onClick={()=>{setShowModal(null);onToast('error','Товар удалён');}}>Удалить</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Analytics Screen ─────────────────────────────────────────────────────────
function AnalyticsScreen() {
  const [period, setPeriod] = useState('30');
  const data = period==='7' ? REVENUE_DATA.slice(-7) : period==='90' ? REVENUE_DATA : REVENUE_DATA.slice(-30);
  const totalWB  = data.reduce((s,d)=>s+d.wb,0);
  const totalOZ  = data.reduce((s,d)=>s+d.oz,0);
  const totalYM  = data.reduce((s,d)=>s+d.ym,0);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background:'#0f172a', borderRadius:12, padding:'12px 16px', boxShadow:'0 20px 40px rgba(0,0,0,0.3)', minWidth:160 }}>
        <div style={{ fontFamily:'Inter', fontSize:11, color:'#94a3b8', marginBottom:8 }}>{label}</div>
        {payload.map(p=>(
          <div key={p.dataKey} style={{ display:'flex', justifyContent:'space-between', gap:16, marginBottom:4 }}>
            <span style={{ fontFamily:'Inter', fontSize:12, color: p.color, fontWeight:600 }}>{p.dataKey.toUpperCase()}</span>
            <span style={{ fontFamily:'Inter', fontSize:12, color:'#fff', fontWeight:700 }}>{p.value.toLocaleString('ru')} ₽</span>
          </div>
        ))}
      </div>
    );
  };

  const PIE_DATA = [
    { name:'A', value:15, color: S.blue },
    { name:'B', value:35, color: S.amber },
    { name:'C', value:37, color: S.red },
  ];

  return (
    <div>
      <PageHeader title="Аналитика" subtitle="ABC-анализ и динамика продаж">
        <div style={{ display:'flex', gap:4, background:'#f1f5f9', borderRadius:8, padding:3 }}>
          {[['7','7 дн'],['30','30 дн'],['90','90 дн']].map(([v,l])=>(
            <button key={v} onClick={()=>setPeriod(v)} style={{
              padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer', fontFamily:'Inter', fontSize:12, fontWeight:600,
              background: period===v ? '#fff' : 'transparent',
              color: period===v ? S.ink : S.muted,
              boxShadow: period===v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition:'all 0.15s',
            }}>{l}</button>
          ))}
        </div>
      </PageHeader>

      {/* KPI row */}
      <div style={{ display:'flex', gap:16, marginBottom:20 }}>
        <KpiCard label="Группа A (ТОП)" value="15" unit="SKU" trend={1} trendLabel="3 новых за 30 дней" icon="TrendingUp" accent={`linear-gradient(90deg,${S.blue},#8b5cf6)`}/>
        <KpiCard label="Out-of-Stock риск" value="3" unit="товара" trend={-1} trendLabel="+1 за 7 дней" icon="AlertCircle" accent={`linear-gradient(90deg,${S.red},#f97316)`}/>
        <KpiCard label="Средний рейтинг" value="4.82" trend={1} trendLabel="+0.1 за месяц" icon="Star" accent={`linear-gradient(90deg,${S.amber},#f59e0b)`}/>
        <KpiCard label="Всего SKU" value="87" trend={1} trendLabel="+5 за квартал" icon="Package" accent="linear-gradient(90deg,#94a3b8,#64748b)"/>
      </div>

      {/* Charts */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:16, marginBottom:20 }}>
        {/* Area chart */}
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
            <div>
              <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:15, color: S.ink }}>Динамика выручки</div>
              <div style={{ fontFamily:'Inter', fontSize:12, color: S.muted, marginTop:2 }}>
                Итого: {(totalWB+totalOZ+totalYM).toLocaleString('ru')} ₽
              </div>
            </div>
            <div style={{ display:'flex', gap:16 }}>
              {[['WB',totalWB,S.wb],['Ozon',totalOZ,S.oz],['YM',totalYM,S.ym]].map(([l,v,c])=>(
                <div key={l} style={{ textAlign:'right' }}>
                  <div style={{ fontFamily:'Inter', fontSize:11, color: S.muted }}>{l}</div>
                  <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:13, color: c }}>{v.toLocaleString('ru')} ₽</div>
                </div>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{top:4,right:0,left:-20,bottom:0}}>
              <defs>
                <linearGradient id="wbGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={S.wb}  stopOpacity={0.15}/>
                  <stop offset="95%" stopColor={S.wb}  stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="ozGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={S.oz}  stopOpacity={0.15}/>
                  <stop offset="95%" stopColor={S.oz}  stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="ymGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={S.ym}  stopOpacity={0.12}/>
                  <stop offset="95%" stopColor={S.ym}  stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
              <XAxis dataKey="date" tick={{ fontFamily:'Inter', fontSize:10, fill: S.muted }} axisLine={false} tickLine={false} interval={Math.floor(data.length/5)}/>
              <YAxis tick={{ fontFamily:'Inter', fontSize:10, fill: S.muted }} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
              <Tooltip content={<CustomTooltip/>}/>
              <Area type="monotone" dataKey="wb"  stroke={S.wb}  strokeWidth={2} fill="url(#wbGrad)"  dot={false}/>
              <Area type="monotone" dataKey="oz"  stroke={S.oz}  strokeWidth={2} fill="url(#ozGrad)"  dot={false}/>
              <Area type="monotone" dataKey="ym"  stroke={S.ym}  strokeWidth={2} fill="url(#ymGrad)"  dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Donut */}
        <Card>
          <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:15, color: S.ink, marginBottom:4 }}>ABC-анализ</div>
          <div style={{ fontFamily:'Inter', fontSize:12, color: S.muted, marginBottom:16 }}>87 SKU</div>
          <div style={{ position:'relative', height:160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={PIE_DATA} cx="50%" cy="50%" innerRadius={52} outerRadius={72} paddingAngle={3} dataKey="value">
                  {PIE_DATA.map((e,i)=><Cell key={i} fill={e.color}/>)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', textAlign:'center' }}>
              <div style={{ fontFamily:'Inter', fontWeight:900, fontSize:24, color: S.ink }}>87</div>
              <div style={{ fontFamily:'Inter', fontSize:10, color: S.muted }}>SKU</div>
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:16 }}>
            {PIE_DATA.map(d=>(
              <div key={d.name} style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:8, height:8, borderRadius:'50%', background:d.color, flexShrink:0 }}/>
                <span style={{ fontFamily:'Inter', fontSize:13, color: S.ink, fontWeight:600 }}>Группа {d.name}</span>
                <span style={{ fontFamily:'Inter', fontSize:13, color: S.muted, marginLeft:'auto' }}>{d.value} SKU</span>
                <span style={{ fontFamily:'Inter', fontSize:11, color: S.muted }}>{Math.round(d.value/87*100)}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Recommendations */}
      <Card noPad>
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${S.border}` }}>
          <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:15, color: S.ink }}>Рекомендации по пополнению</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 0', borderBottom:`1px solid ${S.border}` }}>
          <TH flex={0.6}>МП</TH><TH flex={2.5}>Товар</TH><TH flex={0.8}>ABC</TH><TH flex={0.9} align="center">Остаток (дн.)</TH><TH flex={2}>Рекомендация</TH><TH flex={0.8} align="center">Действие</TH>
        </div>
        {[
          {mp:'WB',name:'Стол Офис-1',sku:'OFF-001',abc:'A',days:3,rec:'Срочно пополнить',urgent:true},
          {mp:'YM',name:'Стол Офис-1',sku:'OFF-001',abc:'A',days:5,rec:'Пополнить скоро',urgent:false},
          {mp:'OZ',name:'Кресло CHA',sku:'CHA-002',abc:'B',days:14,rec:'В норме',ok:true},
        ].map((r,i)=>{
          const daysColor = r.days<=3 ? S.red : r.days<=7 ? S.amber : S.green;
          const daysBg    = r.days<=3 ? 'rgba(239,68,68,0.08)' : r.days<=7 ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)';
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', height:52, borderBottom:`1px solid ${S.border}`, transition:'background 0.15s' }}
              onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{ flex:0.6, padding:'0 16px' }}><MPBadge mp={r.mp}/></div>
              <div style={{ flex:2.5, padding:'0 16px' }}>
                <div style={{ fontFamily:'Inter', fontSize:13, fontWeight:500, color: S.ink }}>{r.name}</div>
                <div style={{ fontFamily:'JetBrains Mono', fontSize:10, color: S.muted }}>{r.sku}</div>
              </div>
              <div style={{ flex:0.8, padding:'0 16px' }}>
                <Badge label={`Группа ${r.abc}`} bg={r.abc==='A'?'rgba(59,130,246,0.08)':r.abc==='B'?'rgba(245,158,11,0.08)':'rgba(239,68,68,0.08)'} color={r.abc==='A'?S.blue:r.abc==='B'?S.amber:S.red}/>
              </div>
              <div style={{ flex:0.9, padding:'0 16px', display:'flex', justifyContent:'center' }}>
                <Badge label={`${r.days} дн.`} bg={daysBg} color={daysColor}/>
              </div>
              <div style={{ flex:2, padding:'0 16px', fontFamily:'Inter', fontSize:13, color: r.ok ? S.green : r.urgent ? S.red : S.amber, display:'flex', alignItems:'center', gap:6 }}>
                {r.ok ? <Icon name="Check" size={14} color={S.green}/> : <Icon name="AlertCircle" size={14} color={r.urgent?S.red:S.amber}/>}
                {r.rec}
              </div>
              <div style={{ flex:0.8, padding:'0 16px', display:'flex', justifyContent:'center' }}>
                <Btn variant="secondary" size="sm">В план →</Btn>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ─── Orders Screen ────────────────────────────────────────────────────────────
function OrdersScreen() {
  const [tab, setTab] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const tabs = [{id:'all',label:'Все'},{id:'WB',label:'Wildberries'},{id:'OZ',label:'Ozon'},{id:'YM',label:'Яндекс Маркет'}];
  const filtered = tab==='all' ? ORDERS : ORDERS.filter(o=>o.mp===tab);

  const statusColor = (s) => ({
    'На сборке':        {bg:'rgba(59,130,246,0.08)',  color:S.blue},
    'Доставляется':     {bg:'rgba(245,158,11,0.08)',  color:S.amber},
    'Готов к отгрузке': {bg:'rgba(16,185,129,0.08)',  color:S.green},
    'Отгружен':         {bg:'rgba(100,116,139,0.08)', color:S.sub},
    'Доставлен':        {bg:'rgba(16,185,129,0.08)',  color:S.green},
  }[s] || {bg:'#f1f5f9',color:S.muted});

  return (
    <div>
      <PageHeader title="Заказы" subtitle="Заказы со всех маркетплейсов">
        <Btn variant="secondary" size="sm"><Icon name="RefreshCw" size={13}/>Обновить</Btn>
      </PageHeader>

      <Card noPad>
        {/* Tabs + filters */}
        <div style={{ padding:'0 20px', borderBottom:`1px solid ${S.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex' }}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                padding:'12px 16px', border:'none', background:'transparent', cursor:'pointer',
                fontFamily:'Inter', fontSize:13, fontWeight: tab===t.id?600:400,
                color: tab===t.id ? S.ink : S.muted,
                borderBottom: tab===t.id ? `2px solid ${S.ink}` : '2px solid transparent',
                transition:'all 0.15s',
              }}>{t.label}</button>
            ))}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Select value="all" onChange={()=>{}} options={[{value:'all',label:'Все статусы'},{value:'assembly',label:'На сборке'},{value:'shipped',label:'Отгружен'}]}/>
          </div>
        </div>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', padding:'10px 0', borderBottom:`1px solid ${S.border}` }}>
          <TH flex={0.3}></TH>
          <TH flex={1.2}>Дата</TH>
          <TH flex={0.7}>МП</TH>
          <TH flex={1.2}>Номер</TH>
          <TH flex={2}>Товар</TH>
          <TH flex={0.5} align="center">Кол-во</TH>
          <TH flex={1} align="right">Сумма</TH>
          <TH flex={1.2} align="center">Статус</TH>
        </div>

        {filtered.map(o=>{
          const sc = statusColor(o.status);
          const isExp = expanded===o.id;
          return (
            <React.Fragment key={o.id}>
              <div style={{ display:'flex', alignItems:'center', height:56, borderBottom:`1px solid ${S.border}`, cursor:'pointer', transition:'background 0.15s' }}
                onClick={()=>setExpanded(isExp?null:o.id)}
                onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <div style={{ flex:0.3, padding:'0 16px', display:'flex', alignItems:'center' }}>
                  <Icon name={isExp?'ChevronDown':'ChevronRight'} size={15} color={S.muted}/>
                </div>
                <div style={{ flex:1.2, padding:'0 16px' }}>
                  <div style={{ fontFamily:'Inter', fontSize:13, color: S.ink }}>{o.date}</div>
                  {o.urgent && <div style={{ display:'inline-flex', alignItems:'center', gap:3, background:'rgba(16,185,129,0.08)', padding:'1px 6px', borderRadius:999, marginTop:2 }}>
                    <div style={{ width:5, height:5, borderRadius:'50%', background:S.green }}/>
                    <span style={{ fontFamily:'Inter', fontSize:10, color:S.green, fontWeight:600 }}>{o.urgent}ч до отгрузки</span>
                  </div>}
                </div>
                <div style={{ flex:0.7, padding:'0 16px' }}><MPBadge mp={o.mp}/></div>
                <div style={{ flex:1.2, padding:'0 16px' }}>
                  <span style={{ fontFamily:'JetBrains Mono', fontSize:12, color: S.sub }}>{o.id}</span>
                </div>
                <div style={{ flex:2, padding:'0 16px' }}>
                  <div style={{ fontFamily:'Inter', fontSize:13, fontWeight:500, color: S.ink }}>{o.product}</div>
                  <div style={{ fontFamily:'JetBrains Mono', fontSize:10, color: S.muted }}>{o.sku}</div>
                </div>
                <div style={{ flex:0.5, padding:'0 16px', textAlign:'center', fontFamily:'Inter', fontSize:13, color: S.ink }}>{o.qty}</div>
                <div style={{ flex:1, padding:'0 16px', textAlign:'right', fontFamily:'Inter', fontSize:13, fontWeight:600, color: S.ink }}>{o.sum.toLocaleString('ru')} ₽</div>
                <div style={{ flex:1.2, padding:'0 16px', display:'flex', justifyContent:'center' }}>
                  <Badge label={o.status} bg={sc.bg} color={sc.color}/>
                </div>
              </div>
              {isExp && (
                <div style={{ background:'#f8fafc', borderBottom:`1px solid ${S.border}`, padding:'12px 20px 12px 56px' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, maxWidth:600 }}>
                    {o.mp==='WB' && <>
                      <Detail label="Тип" value="FBS"/>
                      <Detail label="СЦ" value="Москва Южный"/>
                      <Detail label="Статус" value="Передано в WB"/>
                      <Detail label="Отгрузка до" value={o.ship}/>
                    </>}
                    {o.mp==='OZ' && <>
                      <Detail label="Тип" value="FBO"/>
                      <Detail label="Склад" value="Ozon Хоругвино"/>
                      <Detail label="Комиссия" value="−890 ₽"/>
                      <Detail label="К выплате" value="+7 890 ₽"/>
                    </>}
                    {o.mp==='YM' && <>
                      <Detail label="Тип" value="ПВЗ"/>
                      <Detail label="Пункт" value="Москва Центр"/>
                      <Detail label="Трек" value="YM3344112233" mono/>
                      <Detail label="Статус" value={o.status}/>
                    </>}
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </Card>
    </div>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontFamily:'Inter', fontSize:11, color: S.muted, marginBottom:2 }}>{label}</div>
      <div style={{ fontFamily: mono?'JetBrains Mono':'Inter', fontSize:12, fontWeight:500, color: S.ink }}>{value}</div>
    </div>
  );
}

// ─── Telegram Screen ──────────────────────────────────────────────────────────
function TelegramScreen({ onToast }) {
  const [connected, setConnected] = useState(false);
  const [toggles, setToggles] = useState({
    criticalStock:true, zeroStock:true, stockRefill:false,
    newOrder:true, cancelOrder:true, deliveredOrder:false,
    syncError:true, syncOk:false, apiError:true,
    weeklyReport:false, monthlyReport:false,
  });

  const toggle = (k) => setToggles(t=>({...t,[k]:!t[k]}));
  const sections = [
    { label:'ОСТАТКИ', items:[
      {k:'criticalStock',label:'Критически низкий остаток (< 3 дней)'},
      {k:'zeroStock',   label:'Товар закончился (0 штук)'},
      {k:'stockRefill', label:'Пополнение выполнено'},
    ]},
    { label:'ЗАКАЗЫ', items:[
      {k:'newOrder',      label:'Новый заказ получен'},
      {k:'cancelOrder',   label:'Заказ отменён покупателем'},
      {k:'deliveredOrder',label:'Заказ доставлен'},
    ]},
    { label:'СИНХРОНИЗАЦИЯ', items:[
      {k:'syncError',label:'Ошибка синхронизации с маркетплейсом'},
      {k:'syncOk',   label:'Синхронизация успешно завершена'},
      {k:'apiError', label:'Ошибка API ключа (истёк / неверный)'},
    ]},
    { label:'ФИНАНСЫ', items:[
      {k:'weeklyReport', label:'Еженедельный отчёт по выручке (пн 09:00)'},
      {k:'monthlyReport',label:'Ежемесячный отчёт по юнит-экономике'},
    ]},
  ];

  return (
    <div>
      <PageHeader title="Уведомления Telegram" subtitle="Получайте важные события прямо в мессенджер"/>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 360px', gap:20 }}>
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* Connect card */}
          <Card>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:44, height:44, borderRadius:12, background:'rgba(34,158,217,0.1)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Icon name="MessageCircle" size={22} color="#229ED9"/>
                </div>
                <div>
                  <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:15, color: S.ink }}>Telegram Bot</div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}>
                    <div style={{ width:7, height:7, borderRadius:'50%', background: connected ? S.green : S.muted }}/>
                    <span style={{ fontFamily:'Inter', fontSize:12, color: connected ? S.green : S.muted }}>
                      {connected ? '@user_name подключён' : 'Не подключён'}
                    </span>
                  </div>
                </div>
              </div>
              {connected
                ? <Btn variant="danger" size="sm" onClick={()=>setConnected(false)}>Отключить</Btn>
                : <button onClick={()=>setConnected(true)} style={{ padding:'8px 16px', borderRadius:8, border:'none', cursor:'pointer', background:'#229ED9', color:'#fff', fontFamily:'Inter', fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:6 }}>
                    <Icon name="MessageCircle" size={14} color="#fff"/>Подключить Telegram
                  </button>
              }
            </div>

            {!connected && (
              <div style={{ background:'#f8fafc', borderRadius:10, padding:'16px', border:`1px solid ${S.border}` }}>
                <div style={{ fontFamily:'Inter', fontSize:13, color: S.sub, marginBottom:12 }}>
                  Отправьте этот код боту <span style={{ fontWeight:600, color: S.ink }}>@skladoptima_bot</span>:
                </div>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(59,130,246,0.06)', border:`1px solid rgba(59,130,246,0.2)`, borderRadius:10, padding:'14px 20px', marginBottom:10 }}>
                  <span style={{ fontFamily:'JetBrains Mono', fontSize:28, fontWeight:700, color: S.blue, letterSpacing:'0.12em' }}>SK-847291</span>
                </div>
                <div style={{ fontFamily:'Inter', fontSize:12, color: S.muted, textAlign:'center' }}>⏱ Код действителен 10:00</div>
              </div>
            )}
          </Card>

          {/* Toggles */}
          {connected && (
            <Card>
              <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
                {sections.map(sec=>(
                  <div key={sec.label}>
                    <SectionLabel>{sec.label}</SectionLabel>
                    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                      {sec.items.map(it=>(
                        <div key={it.k} style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                          <span style={{ fontFamily:'Inter', fontSize:13, color: S.ink }}>{it.label}</span>
                          <Toggle on={toggles[it.k]} onChange={()=>toggle(it.k)}/>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {connected && (
            <div>
              <Btn variant="secondary" size="sm" onClick={()=>onToast('success','Тестовое сообщение отправлено ✓')}>
                <Icon name="Send" size={13}/>Отправить тестовое сообщение
              </Btn>
            </div>
          )}
        </div>

        {/* Message preview */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <Card>
            <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:13, color: S.ink, marginBottom:16 }}>Пример уведомления</div>
            <div style={{ background:'rgba(34,158,217,0.06)', border:'1px solid rgba(34,158,217,0.2)', borderRadius:16, padding:'16px', fontFamily:'Inter', fontSize:13, lineHeight:1.7 }}>
              <div style={{ fontWeight:700, color:'#229ED9', marginBottom:10, display:'flex', alignItems:'center', gap:6 }}>
                <Icon name="Package" size={15} color="#229ED9"/>SkladOptima
              </div>
              <div style={{ color: S.sub, fontSize:12, marginBottom:8 }}>⚠️ Критически низкий остаток</div>
              <div style={{ color: S.ink, marginBottom:6 }}>
                <b>Товар:</b> Стол Офис-1<br/>
                <b>SKU:</b> <span style={{ fontFamily:'JetBrains Mono', fontSize:12 }}>OFF-001</span><br/>
                <b>Остаток:</b> 3 дня продаж<br/>
                <b>Склад:</b> 5 шт.
              </div>
              <div style={{ borderTop:`1px solid rgba(34,158,217,0.15)`, paddingTop:8, display:'flex', flexDirection:'column', gap:4 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                  <MPBadge mp="WB" size={10}/><span style={{ color: S.sub }}>1 шт.</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                  <MPBadge mp="OZ" size={10}/><span style={{ color: S.sub }}>2 шт.</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                  <MPBadge mp="YM" size={10}/><span style={{ color: S.sub }}>2 шт.</span>
                </div>
              </div>
              <button style={{ marginTop:12, width:'100%', padding:'8px', background:'#229ED9', color:'#fff', border:'none', borderRadius:8, fontFamily:'Inter', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                Открыть товар →
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Screen ──────────────────────────────────────────────────────────
function SettingsScreen({ onToast }) {
  const [showTokens, setShowTokens] = useState({wb:false, oz:false, ym:false});
  const [tax, setTax] = useState('usn6');
  const [syncing, setSyncing] = useState(false);

  const doSync = () => { setSyncing(true); setTimeout(()=>{ setSyncing(false); onToast('success','Синхронизация завершена'); },2200); };

  const MPCard = ({ id, label, char, color, fields, status }) => (
    <Card>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:40, height:40, borderRadius:12, background:color, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontFamily:'Montserrat', fontWeight:700, fontSize:13 }}>{char}</div>
          <span style={{ fontFamily:'Inter', fontWeight:700, fontSize:15, color: S.ink }}>{label}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ width:7, height:7, borderRadius:'50%', background: status==='ok'?S.green:S.red }}/>
          <span style={{ fontFamily:'Inter', fontSize:12, color: status==='ok'?S.green:S.red, fontWeight:500 }}>
            {status==='ok'?'Подключено':'Ошибка токена'}
          </span>
        </div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {fields.map(f=>(
          <div key={f.label}>
            <SectionLabel>{f.label}</SectionLabel>
            <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
              <input type={f.secret&&!showTokens[id]?'password':'text'} defaultValue={f.value} placeholder={f.placeholder} style={{ width:'100%', padding:'8px 36px 8px 12px', borderRadius:8, border:`1px solid ${S.border}`, fontFamily: f.mono?'JetBrains Mono':'Inter', fontSize:13, color: S.ink, outline:'none', boxShadow:'0 1px 2px rgba(0,0,0,0.04)' }}/>
              {f.secret && <button onClick={()=>setShowTokens(s=>({...s,[id]:!s[id]}))} style={{ position:'absolute', right:10, background:'transparent', border:'none', cursor:'pointer', color: S.muted, display:'flex' }}>
                <Icon name={showTokens[id]?'EyeOff':'Eye'} size={15}/>
              </button>}
            </div>
            {f.hint && <div style={{ fontFamily:'Inter', fontSize:11, color: S.muted, marginTop:4 }}>{f.hint}</div>}
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:10, marginTop:20 }}>
        <button onClick={()=>onToast('success',`${label}: соединение OK`)} style={{ padding:'7px 14px', borderRadius:8, border:`1px solid ${color}40`, background:`${color}08`, color:color, fontFamily:'Inter', fontSize:12, fontWeight:600, cursor:'pointer' }}>
          Проверить соединение
        </button>
        <Btn variant="primary" size="sm" onClick={()=>onToast('success',`${label}: настройки сохранены`)}>Сохранить</Btn>
      </div>
    </Card>
  );

  return (
    <div>
      <PageHeader title="Настройки" subtitle="Управление магазином и интеграциями с маркетплейсами"/>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
        {/* Left column */}
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          {/* Shop settings */}
          <Card>
            <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:15, color: S.ink, marginBottom:20 }}>Ваш магазин</div>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div><SectionLabel>Название магазина</SectionLabel><Input defaultValue="Мебель СТО"/></div>
              <div>
                <SectionLabel>Система налогообложения</SectionLabel>
                <Select value={tax} onChange={setTax} options={[{value:'usn6',label:'УСН 6%'},{value:'usn15',label:'УСН 15%'},{value:'osno',label:'ОСНО'},{value:'npd',label:'НПД'}]} style={{ width:'100%' }}/>
              </div>
              <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
                <input type="checkbox" style={{ width:16, height:16, accentColor: S.blue }}/>
                <span style={{ fontFamily:'Inter', fontSize:13, color: S.ink }}>Превышен лимит 60 млн руб (НДС с 2025)</span>
              </label>
            </div>
            <div style={{ marginTop:20 }}>
              <Btn variant="primary" onClick={()=>onToast('success','Настройки обновлены')}>Обновить настройки</Btn>
            </div>
          </Card>

          {/* Sync card */}
          <div style={{ background:'linear-gradient(135deg,#1e40af,#4f46e5)', borderRadius:16, padding:'24px', display:'flex', alignItems:'center', gap:16 }}>
            <div style={{ width:44, height:44, borderRadius:12, background:'rgba(255,255,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <Icon name="RefreshCw" size={20} color="#fff"/>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:15, color:'#fff' }}>Синхронизация данных</div>
              <div style={{ fontFamily:'Inter', fontSize:12, color:'rgba(255,255,255,0.7)', marginTop:2 }}>Подтянуть актуальные остатки, заказы и цены</div>
            </div>
            <button onClick={doSync} disabled={syncing} style={{ padding:'9px 18px', borderRadius:8, border:'none', cursor: syncing?'not-allowed':'pointer', background:'#fff', color:'#1e40af', fontFamily:'Inter', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:6, opacity: syncing?0.7:1 }}>
              {syncing ? <><Icon name="RefreshCw" size={13} color="#1e40af"/>Обновление…</> : 'Запустить обновление'}
            </button>
          </div>

          <MPCard id="wb" label="Wildberries" char="WB" color={S.wb} status="ok" fields={[
            {label:'ID склада FBS', value:'123456', placeholder:'ID склада', mono:true},
            {label:'API Токен',     value:'wbv3-xxxxxxxxxxxxxxxxxxxxxxxx', placeholder:'Токен', secret:true, mono:true, hint:'ЛК WB → Настройки → Доступ к API'},
          ]}/>
        </div>

        {/* Right column */}
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          <MPCard id="oz" label="Ozon" char="OZ" color={S.oz} status="error" fields={[
            {label:'Client ID',   value:'12345678', placeholder:'Client ID', mono:true},
            {label:'ID склада FBS',value:'456789',  placeholder:'ID склада', mono:true},
            {label:'API Key',      value:'',         placeholder:'API ключ', secret:true, mono:true, hint:'ЛК Ozon → Настройки → API ключи'},
          ]}/>
          <MPCard id="ym" label="Yandex Market" char="ЯМ" color={S.ym} status="ok" fields={[
            {label:'Campaign ID', value:'987654321', placeholder:'ID кампании', mono:true, hint:'ID кампании из ЛК Яндекс Маркет'},
            {label:'Client ID',   value:'client_xxx', placeholder:'Client ID', mono:true},
            {label:'API Token',   value:'y0_xxxxxxxxxxxxx', placeholder:'OAuth токен', secret:true, mono:true, hint:'Права: Управление складом + Статистика'},
          ]}/>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ProductsScreen, AnalyticsScreen, OrdersScreen, TelegramScreen, SettingsScreen });
