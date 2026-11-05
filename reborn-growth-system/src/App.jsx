import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, configured } from './lib/supabase.js';

const NAV = [
  ['overview','Overview'],
  ['clients','Accounts'],
  ['competitors','Market intelligence'],
  ['offers','Offer packages'],
  ['acquisition','Acquisition'],
  ['retention','Retention'],
  ['metrics','Scorecard']
];

const TABLE = {
  clients: 'clients',
  competitors: 'growth_competitor_profiles',
  offers: 'growth_offer_packages',
  acquisition: 'growth_acquisition_opportunities',
  retention: 'growth_retention_actions',
  metrics: 'growth_metrics_snapshots'
};

const FIELDS = {
 clients:[
  ['name','Client / business name','text',1],
  ['industry','Industry','text'],
  ['website','Website URL','url'],
  ['market','Market / location','text'],
  ['target_audience','Target audience','textarea'],
  ['core_offer','Core offer','textarea'],
  ['brand_voice','Brand voice','textarea'],
  ['brand_guidelines','Brand guidelines','textarea'],
  ['status','Client status','select:clientStatus']
 ],

 competitors:[['competitor_name','Competitor / brand name','text',1],['category','Category','text'],['website_url','Website URL','url'],['positioning_notes','Positioning observations','textarea'],['evidence_confidence','Evidence confidence','select:confidence'],['ethical_adaptation','What we can ethically adapt','textarea'],['next_research_action','Next research action','textarea']],
 offers:[['client_id','Client','client'],['package_name','Package name','text',1],['tier_key','Tier','select:tier'],['target_segment','Target customer','text'],['customer_problem','Customer problem','textarea'],['promised_outcome','Promised outcome','textarea'],['price_amount','Price (XCD)','number'],['billing_period','Billing period','select:billing'],['status','Status','select:offerStatus'],['validation_notes','Validation notes','textarea']],
 acquisition:[['client_id','Client','client'],['opportunity_name','Opportunity name','text',1],['channel','Channel','select:channel'],['target_segment','Target customer','text'],['offer_summary','Offer summary','textarea'],['call_to_action','Call to action','text'],['landing_destination','Landing destination','url'],['budget_amount','Budget (XCD)','number'],['status','Status','select:acqStatus'],['hypothesis','Hypothesis to test','textarea'],['success_metric','Success metric','text'],['target_value','Target value','number'],['due_date','Due date (optional)','date']],
 retention:[['client_id','Client','client'],['action_name','Retention action','text',1],['lifecycle_stage','Customer stage','select:lifecycle'],['trigger_condition','Trigger condition','textarea'],['channel','Channel','select:retChannel'],['due_date','Due date (optional)','date'],['status','Status','select:retStatus'],['outcome_notes','Outcome / notes','textarea']],
 metrics:[['client_id','Client','client'],['period_start','Period start','date',1],['period_end','Period end','date',1],['metric_key','Metric','select:metric'],['metric_value','Value','number',1],['currency','Currency (optional)','text'],['source','Data source','select:source'],['notes','Notes','textarea']]
};
const OPTIONS = {
 clientStatus:[
  ['draft','Draft'],
  ['in_progress','In progress'],
  ['pending_approval','Pending approval'],
  ['approved','Approved'],
  ['changes_requested','Changes requested'],
  ['rejected','Rejected'],
  ['archived','Archived']
 ],

 confidence:[['hypothesis','Hypothesis'],['partially_verified','Partially verified'],['verified','Verified']],
 tier:[['entry','Entry'],['core','Core'],['premium','Premium'],['custom','Custom']],
 billing:[['one_time','One-time'],['weekly','Weekly'],['monthly','Monthly'],['quarterly','Quarterly'],['annual','Annual'],['custom','Custom']],
 offerStatus:[['draft','Draft'],['pilot','Pilot'],['active','Active'],['paused','Paused'],['retired','Retired']],
 channel:[['organic_social','Organic social'],['paid_social','Paid social'],['search','Search'],['referral','Referral'],['partnership','Partnership'],['email','Email'],['whatsapp','WhatsApp'],['website','Website'],['offline','Offline'],['other','Other']],
 acqStatus:[['idea','Idea'],['ready','Ready'],['running','Running'],['measuring','Measuring'],['optimized','Optimized'],['stopped','Stopped']],
 lifecycle:[['new_lead','New lead'],['new_customer','New customer'],['active_client','Active client'],['at_risk','At risk'],['renewal','Renewal'],['former_customer','Former customer'],['referral','Referral']],
 retChannel:[['email','Email'],['whatsapp','WhatsApp'],['phone','Phone'],['in_person','In person'],['crm_task','CRM task'],['other','Other']],
 retStatus:[['planned','Planned'],['ready','Ready'],['in_progress','In progress'],['blocked','Blocked'],['completed','Completed'],['cancelled','Cancelled']],
 metric:[['qualified_leads','Qualified leads'],['new_customers','New customers'],['conversion_rate','Conversion rate (%)'],['revenue','Revenue'],['average_order_value','Average order value'],['repeat_purchase_rate','Repeat purchase rate (%)'],['retention_rate','Retention rate (%)'],['cost_per_lead','Cost per lead'],['customer_acquisition_cost','Customer acquisition cost'],['return_on_ad_spend','Return on ad spend'],['referrals','Referrals'],['other','Other']],
 source:[['manual','Manual'],['website','Website analytics'],['ad_platform','Ad platform'],['crm','CRM'],['invoice','Invoice / sales record'],['other','Other']]
};
const pretty = s => String(s ?? '').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const money = (n,c='XCD') => n == null || n === '' ? '—' : `${c} ${Number(n).toLocaleString('en-AG',{maximumFractionDigits:2})}`;

function Input({field, value, onChange, clients=[]}) {
 const [key,label,type,required] = field;
 if (type === 'client') return <label className="field"><span>{label}{required?' *':''}</span><select required={!!required} value={value ?? ''} onChange={e=>onChange(key,e.target.value)}><option value="">Unassigned</option>{clients.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>;
 if (type.startsWith('select:')) return <label className="field"><span>{label}{required?' *':''}</span><select required={!!required} value={value ?? ''} onChange={e=>onChange(key,e.target.value)}>{(OPTIONS[type.split(':')[1]]||[]).map(([v,t])=><option value={v} key={v}>{t}</option>)}</select></label>;
 if (type === 'textarea') return <label className="field wide"><span>{label}{required?' *':''}</span><textarea rows="3" required={!!required} value={value ?? ''} onChange={e=>onChange(key,e.target.value)} /></label>;
 return <label className="field"><span>{label}{required?' *':''}</span><input type={type} min={type==='number'?'0':undefined} step={type==='number'?'any':undefined} required={!!required} value={value ?? ''} onChange={e=>onChange(key,e.target.value)} /></label>;
}
function App(){
 const [session,setSession]=useState(null),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[signup,setSignup]=useState(false);
 const [orgs,setOrgs]=useState([]),[orgId,setOrgId]=useState(''),[active,setActive]=useState('overview');
 const [rows,setRows]=useState({}),[draft,setDraft]=useState({}),[editingId,setEditingId]=useState(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{if(!supabase){setLoading(false);return}supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)});const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>subscription.unsubscribe()},[]);
 const loadOrgs=useCallback(async()=>{if(!session?.user)return;setLoading(true);const {data,error:e}=await supabase.from('organization_members').select('organization_id,role,organizations(id,name,slug)').eq('user_id',session.user.id);if(e)setError('Workspace membership could not be loaded: '+e.message);else{const list=(data||[]).map(x=>({id:x.organization_id,role:x.role,name:x.organizations?.name||'ReBoRn workspace'}));setOrgs(list);if(!orgId&&list[0])setOrgId(list[0].id);if(!list.length)setError('You are signed in, but are not a member of a workspace yet. An owner/admin must add your account to organization_members. Do not create a duplicate organization.')}setLoading(false)},[session,orgId]);
 useEffect(()=>{if(session)loadOrgs()},[session,loadOrgs]);
 const loadRows=useCallback(async()=>{if(!orgId)return;setLoading(true);const entries=await Promise.all(Object.entries(TABLE).map(async([k,t])=>{const {data,error:e}=await supabase.from(t).select('*').eq('organization_id',orgId).order('created_at',{ascending:false}).limit(100);return [k,data||[],e]}));const failed=entries.find(x=>x[2]);if(failed)setError('Data could not be loaded: '+failed[2].message);setRows(Object.fromEntries(entries.map(([k,d])=>[k,d])));setLoading(false)},[orgId]);
 useEffect(()=>{if(session&&orgId)loadRows()},[session,orgId,loadRows]);
 const stats=useMemo(()=>({competitors:(rows.competitors||[]).length,offers:(rows.offers||[]).length,acquisition:(rows.acquisition||[]).length,retention:(rows.retention||[]).length,active:(rows.offers||[]).filter(x=>['active','pilot'].includes(x.status)).length,running:(rows.acquisition||[]).filter(x=>['running','measuring'].includes(x.status)).length}),[rows]);
 async function auth(e){e.preventDefault();setSaving(true);setError('');const r=signup?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});if(r.error)setError(r.error.message);else if(signup&&!r.data.session)setNotice('Account created. Confirm your email, then sign in. Account creation does not automatically grant workspace access.');setSaving(false)}
 async function save(e){e.preventDefault();setSaving(true);setError('');setNotice('');let p={...draft,organization_id:orgId};if(['offers','acquisition','retention','metrics'].includes(active)&&!p.client_id)p.client_id=null;if(!editingId){if(active==='metrics')p.recorded_by=session.user.id;else p.created_by=session.user.id;}
 Object.keys(p).forEach(k=>{if(p[k]==='')p[k]=null});if(active==='competitors'){p.audience_segments=[];p.offer_patterns=[];p.acquisition_patterns=[];p.retention_patterns=[];p.proof_points=[];p.category=p.category||'service_business';}
 if(active==='offers'){p.deliverables=[];p.exclusions=[];p.price_amount=p.price_amount==null?null:Number(p.price_amount);p.delivery_cost_estimate=null}
 if(active==='acquisition'){['budget_amount','target_value'].forEach(k=>p[k]=p[k]==null?null:Number(p[k]));p.actual_value=null}
 if(active==='metrics')p.metric_value=Number(p.metric_value);
 const wasEditing=Boolean(editingId);const query=supabase.from(TABLE[active]);const result=wasEditing?await query.update(p).eq('id',editingId).eq('organization_id',orgId).select('id').maybeSingle():await query.insert(p);if(result.error)setError((wasEditing?'Update':'Save')+' failed: '+result.error.message);else if(wasEditing&&!result.data)setError('No record was updated. Check workspace access and permissions; your changes were not confirmed.');else{setDraft({});setEditingId(null);setNotice(wasEditing?'Changes saved successfully.':'Record saved to this workspace.');await loadRows()}setSaving(false)}
 function startEdit(row){setEditingId(row.id);setDraft(Object.fromEntries((FIELDS[active]||[]).map(([key])=>[key,row[key]??''])));setError('');setNotice('');}
 function cancelEdit(){setEditingId(null);setDraft({});setError('');setNotice('')}
 async function statusChange(row,status){const {error:e}=await supabase.from(TABLE[active]).update({status}).eq('id',row.id).eq('organization_id',orgId);if(e)setError(e.message);else await loadRows()}
 if(!configured)return <div className="setup"><div className="mark">R</div><p className="eyebrow">REBORN · AGENCY INTELLIGENCE</p><h1>Connect the workspace.</h1><p>Add the existing Supabase project URL and publishable/anon key to Cloudflare Pages environment settings:</p><code>VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</code><p>Never expose a service-role key in browser code.</p></div>;
 if(loading&&!session)return <div className="setup">Preparing workspace…</div>;
 if(!session)return <div className="auth"><section className="pitch"><div className="brand"><span className="mark">R</span><b>ReBoRn<br/><small>GROWTH SYSTEM</small></b></div><p className="eyebrow">INTELLIGENCE → ACTION → GROWTH</p><h1>Build a business that earns its next stage.</h1><p>Market intelligence, offer design, acquisition, retention and measurable results in one operating system.</p><ul><li>Understand the market</li><li>Package the value</li><li>Acquire the right clients</li><li>Retain and measure</li></ul></section><form className="auth-form" onSubmit={auth}><p className="eyebrow">{signup?'CREATE YOUR LOGIN':'WELCOME BACK'}</p><h2>{signup?'Create account':'Sign in'}</h2><label className="field"><span>Email</span><input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="field"><span>Password</span><input type="password" minLength="8" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="error">{error}</p>}{notice&&<p className="notice">{notice}</p>}<button className="primary" disabled={saving}>{saving?'Working…':signup?'Create account':'Sign in securely'}</button><button className="link" type="button" onClick={()=>{setSignup(!signup);setError('');setNotice('')}}>{signup?'Already have an account? Sign in':'New here? Create an account'}</button><small>Workspace access is controlled by organization membership and Supabase RLS.</small></form></div>;
 const key=active, current=rows[key]||[], clients=rows.clients||[], clientName=id=>clients.find(c=>c.id===id)?.name||'Unassigned';
 const titles={clients:'Client directory',competitors:'Market intelligence',offers:'Offer package library',acquisition:'Acquisition pipeline',retention:'Retention playbook',metrics:'Performance scorecard'};
 return <div className="shell"><aside className="sidebar"><div className="brand"><span className="mark">R</span><b>ReBoRn<br/><small>GROWTH SYSTEM</small></b></div><p className="eyebrow">WORKSPACE</p>{orgs.length>1?<select value={orgId} onChange={e=>{setEditingId(null);setDraft({});setError('');setNotice('');setOrgId(e.target.value)}}>{orgs.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select>:<div className="org">{orgs[0]?.name||'Workspace'}</div>}<nav>{NAV.map(([id,label])=><button className={active===id?'selected':''} key={id} onClick={()=>{setActive(id);setDraft({});setError('');setNotice('')}}>{label}</button>)}</nav><div className="account"><small>{session.user.email}</small><button className="link" onClick={()=>supabase.auth.signOut()}>Sign out ↗</button></div></aside><main><header><div><p className="eyebrow">{active==='overview'?'COMMAND CENTRE':titles[active]?.toUpperCase()}</p><h1>{active==='overview'?'Growth command centre':NAV.find(x=>x[0]===active)?.[1]}</h1></div><button className="refresh" onClick={loadRows}>↻ Refresh</button></header>
 {error&&<p className="alert error">{error}</p>}{notice&&<p className="alert notice">{notice}</p>}
 {active==='overview'?<><section className="hero"><p className="eyebrow">THE GROWTH CYCLE</p><h2>Research. Position. Acquire. Retain.</h2><p>Turn market observations into testable offers, qualified opportunities and repeatable client growth.</p></section><section className="stats">{[['Competitor profiles',stats.competitors],['Offer packages',stats.offers],['Acquisition tests',stats.acquisition],['Retention actions',stats.retention]].map(([label,val])=><article className="stat" key={label}><span>{label}</span><strong>{val}</strong><small>{label==='Offer packages'?`${stats.active} active or pilot`:label==='Acquisition tests'?`${stats.running} running or measuring`:'Workspace records'}</small></article>)}</section><section className="overview-grid"><article className="panel"><p className="eyebrow">OPERATING LOOP</p><h3>From insight to revenue</h3>{[['01','Diagnose','Map customer, competitor and market gaps.'],['02','Package','Define target customer, outcome and boundaries.'],['03','Acquire','Run a channel test with a clear hypothesis.'],['04','Retain','Follow up, protect quality and build repeat value.'],['05','Measure','Record results and repeat what works.']].map(x=><div className="step" key={x[0]}><b>{x[0]}</b><span><strong>{x[1]}</strong><small>{x[2]}</small></span></div>)}</article><article className="panel"><p className="eyebrow">QUICK ACTIONS</p><h3>Build momentum</h3>{[['competitors','Record a competitor'],['offers','Create an offer package'],['acquisition','Plan an acquisition test'],['metrics','Record a result']].map(x=><button className="quick" key={x[0]} onClick={()=>setActive(x[0])}>{x[1]} <span>→</span></button>)}</article></section><section className="pilot"><b>MACARIUS INFRASTRUCTURE SERVICES</b><p>Pilot clear packages for pressure washing, exterior cleaning and vehicle detailing. Treat prices as hypotheses until costs, demand and delivery capacity are validated.</p><button className="secondary" onClick={()=>setActive('offers')}>Build service packages →</button></section></>:<section className="workspace-grid"><article className="panel"><div className="panel-head"><div><p className="eyebrow">{NAV.find(x=>x[0]===active)?.[1].toUpperCase()}</p><h3>{titles[active]}</h3></div><span className="count">{current.length} records</span></div>{loading?<p>Loading records…</p>:!current.length?<div className="empty"><b>No records yet</b><p>Add the first record using the form. Label assumptions as hypotheses; use verified evidence where available.</p></div>:<div className="records">{current.map(row=><article className="record" key={row.id}><div className="record-title"><b>{row.name||row.competitor_name||row.package_name||row.opportunity_name||row.action_name||pretty(row.metric_key)}</b><span className="tag">{pretty(row.status||row.evidence_confidence||'logged')}</span></div><p>{row.positioning_notes||row.promised_outcome||row.offer_summary||row.trigger_condition||row.next_research_action||row.notes||''}</p>{['offers','acquisition','retention','metrics'].includes(active)&&<p className="meta">Client: {clientName(row.client_id)}</p>}<div className="meta">{active==='offers'&&<span>{money(row.price_amount,row.currency)} · {pretty(row.tier_key)}</span>}{active==='acquisition'&&<><span>{pretty(row.channel)}</span>{row.due_date&&<span>Due {row.due_date}</span>}</>}{active==='retention'&&<><span>{pretty(row.lifecycle_stage)}</span><span>{pretty(row.channel)}</span></>}{active==='metrics'&&<span>{row.period_start} – {row.period_end} · {row.metric_value} {row.currency||''}</span>}{active==='competitors'&&row.website_url&&<a href={row.website_url} target="_blank" rel="noreferrer">Open website ↗</a>}</div>{['offers','acquisition','retention'].includes(active)&&<label className="status">Status <select value={row.status||'draft'} onChange={e=>statusChange(row,e.target.value)}>{(OPTIONS[active==='offers'?'offerStatus':active==='acquisition'?'acqStatus':'retStatus']).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>}{['clients','offers'].includes(active)&&<button type="button" className="secondary" onClick={()=>startEdit(row)}>{active==='clients'?'Edit client':'Edit offer'}</button>}</article>)}</div>}</article><article className="panel form-panel"><p className="eyebrow">{editingId?'EDIT WORKSPACE RECORD':'ADD TO WORKSPACE'}</p><h3>{editingId?`Edit ${({clients:'client',competitors:'competitor',offers:'offer',acquisition:'acquisition opportunity',retention:'retention action',metrics:'metric'})[active]||'record'}`:'New record'}</h3><form className="record-form" onSubmit={save}>{(FIELDS[active]||[]).map(f=><Input key={f[0]} field={f} clients={clients} value={draft[f[0]]??(f[0]==='currency'?'XCD':f[0]==='billing_period'?'monthly':f[0]==='tier_key'?'entry':f[0]==='channel'?(active==='retention'?'whatsapp':'referral'):f[0]==='status'?(active==='offers'?'draft':active==='acquisition'?'idea':'planned'):f[0]==='lifecycle_stage'?'new_customer':f[0]==='evidence_confidence'?'hypothesis':f[0]==='metric_key'?'qualified_leads':f[0]==='source'?'manual':'')} onChange={(k,v)=>setDraft(d=>({...d,[k]:v}))}/>)}
 <p className="hint">* Required. Keep customer promises realistic and performance claims evidence-based.</p><button className="primary" disabled={saving}>{saving?'Saving…':editingId?'Save changes':'Save record'}</button>{editingId&&<button type="button" className="secondary" onClick={cancelEdit} disabled={saving}>Cancel editing</button>}</form></article></section>}
 <footer>ReBoRn · Agency Intelligence <span>Strategy before spend. Evidence before claims.</span></footer></main></div>
}
export default App;
