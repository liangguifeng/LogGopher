import {FormEvent, useEffect, useMemo, useState} from 'react';
import './App.css';
import './settings.css';
import './workspace-scale.css';
import './functional-theme.css';
import {Bootstrap, Connect, ConnectSaved, Query, SaveSettings} from '../wailsjs/go/main/App';
import {EventsOn} from '../wailsjs/runtime/runtime';
import LogResults from './LogResults';

type Adapter = {id:string; name:string; description:string; ready:boolean};
type Profile = {id:number; adapterId:string; name:string; endpoint:string; project:string; region:string};
type Entry = {time:string; level:string; message:string; fields:Record<string,string>};
type Result = {tookMs:number; total:number; entries:Entry[]};
type Settings = {theme:'system'|'light'|'dark'; language:'zh-CN'|'en-US'; density:'comfortable'|'compact'};
type TimeRange = {key:string; label:string; from:string; to:string};

const iso=(date:Date)=>date.toISOString();
const relativeRange=(key:string,label:string,milliseconds:number):TimeRange=>{const to=new Date();return {key,label,from:iso(new Date(to.getTime()-milliseconds)),to:iso(to)}};
const localInput=(value:string)=>{const date=new Date(value);const offset=date.getTimezoneOffset()*60000;return new Date(date.getTime()-offset).toISOString().slice(0,16)};
const inputISO=(value:string)=>new Date(value).toISOString();
const axisLabel=(date:Date,span:number,locale:'zh-CN'|'en-US')=>span<=3600000?date.toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):span<=86400000?date.toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',hour12:false}):date.toLocaleDateString(locale,{month:'2-digit',day:'2-digit'});

const defaults:Settings={theme:'system',language:'zh-CN',density:'comfortable'};
const messages={
  'zh-CN':{subtitle:'多云日志工作台',connected:'会话已连接',waiting:'等待连接',settings:'设置',saved:'已保存连接',emptyStore:'连接后在这里浏览日志库',newConnection:'新建连接',title:'连接日志平台',intro:'选择已有连接快速进入，或创建一个新连接。AK/SK 安全保存在系统凭证库中。',choose:'日志平台',available:'可用',pending:'SDK 待接入',connectionName:'连接名称',project:'项目 / 日志组',region:'地域（可选）',connecting:'正在连接…',connect:'连接并进入工作台 →',connectSaved:'连接所选配置 →',recent:'最近 15 分钟',execute:'⌘ ↵ 执行',querying:'查询中…',run:'▶ 运行查询',waitingQuery:'等待查询',limit:'显示上限 100',emptyResult:'运行查询后，日志会在这里展开。',results:'条结果',settingsTitle:'偏好设置',settingsDesc:'外观与语言会立即应用，并保存在本机。',appearance:'外观',system:'跟随系统',light:'亮色',dark:'暗色',language:'语言',chinese:'简体中文',english:'English',density:'显示密度',comfortable:'舒适',compact:'紧凑',cancel:'取消',save:'保存设置',saving:'保存中…',savedHint:'凭证由系统钥匙串安全管理',noSaved:'还没有保存过连接，请先新建连接。',logstores:'日志库',connections:'连接管理',localDemo:'本地演示',endpoint:'访问端点',projectSummary:'项目',query:'查询',time:'时间',level:'级别',message:'消息',fields:'字段',accessKey:'Access Key',secretKey:'Secret Key'},
  'en-US':{subtitle:'Multi-cloud log workspace',connected:'Session connected',waiting:'Waiting for connection',settings:'Settings',saved:'Saved connections',emptyStore:'Connect to browse logstores',newConnection:'New connection',title:'Connect a log platform',intro:'Use a saved connection or create a new one. AK/SK are protected by the system credential store.',choose:'Log platform',available:'Ready',pending:'SDK pending',connectionName:'Connection name',project:'Project / Log Group',region:'Region (optional)',connecting:'Connecting…',connect:'Connect and open workspace →',connectSaved:'Connect selected profile →',recent:'Last 15 minutes',execute:'⌘ ↵ Run',querying:'Searching…',run:'▶ Run query',waitingQuery:'Waiting for query',limit:'Limit 100',emptyResult:'Run a query to display logs here.',results:'results',settingsTitle:'Preferences',settingsDesc:'Appearance and language apply immediately and are stored locally.',appearance:'Appearance',system:'System',light:'Light',dark:'Dark',language:'Language',chinese:'简体中文',english:'English',density:'Display density',comfortable:'Comfortable',compact:'Compact',cancel:'Cancel',save:'Save settings',saving:'Saving…',savedHint:'Credentials are protected by the system keychain',noSaved:'No saved connections yet. Create one first.',logstores:'LOGSTORES',connections:'CONNECTIONS',localDemo:'Local demo',endpoint:'ENDPOINT',projectSummary:'PROJECT',query:'QUERY',time:'TIME',level:'LEVEL',message:'MESSAGE',fields:'FIELDS',accessKey:'Access Key',secretKey:'Secret Key'}
} as const;

const emptyForm = {adapterId:'demo', name:'本地演示', endpoint:'', accessKey:'', secretKey:'', project:'', region:''};

function App() {
  const [adapters,setAdapters]=useState<Adapter[]>([]);
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [connectionMode,setConnectionMode]=useState<'saved'|'new'>('new');
  const [savedProfileId,setSavedProfileId]=useState(0);
  const [savedSearch,setSavedSearch]=useState('');
  const [savedPage,setSavedPage]=useState(1);
  const [configSwitcherOpen,setConfigSwitcherOpen]=useState(false);
  const [form,setForm]=useState(emptyForm);
  const [profileId,setProfileId]=useState(0);
  const [logstores,setLogstores]=useState<string[]>([]);
  const [logstore,setLogstore]=useState('');
  const [query,setQuery]=useState('');
  const [result,setResult]=useState<Result|null>(null);
  const [currentPage,setCurrentPage]=useState(1);
  const [pageSize,setPageSize]=useState(100);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [settings,setSettings]=useState<Settings>(defaults);
  const [draftSettings,setDraftSettings]=useState<Settings>(defaults);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [savingSettings,setSavingSettings]=useState(false);
  const [timePickerOpen,setTimePickerOpen]=useState(false);
  const [customTimeOpen,setCustomTimeOpen]=useState(false);
  const [exactTime,setExactTime]=useState(false);
  const [timeRange,setTimeRange]=useState<TimeRange>(()=>relativeRange('15m','15min',15*60*1000));
  const [draftTimeRange,setDraftTimeRange]=useState<TimeRange>(()=>relativeRange('15m','15min',15*60*1000));
  const [timeHistory,setTimeHistory]=useState<TimeRange[]>([]);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [queryFavorite,setQueryFavorite]=useState(false);

  useEffect(()=>{ Bootstrap().then((data:any)=>{const saved=data.profiles||[];setAdapters(data.adapters||[]);setProfiles(saved);if(saved.length){setConnectionMode('saved');setSavedProfileId(saved[0].id)}const next=data.settings||defaults;setSettings(next);setDraftSettings(next)}).catch(e=>setError(String(e))) },[]);
  const effectiveSettings=settingsOpen?draftSettings:settings;
  useEffect(()=>{
    const media=window.matchMedia('(prefers-color-scheme: dark)');
    const apply=()=>document.documentElement.dataset.theme=effectiveSettings.theme==='system'?(media.matches?'dark':'light'):effectiveSettings.theme;
    apply(); document.documentElement.dataset.density=effectiveSettings.density; document.documentElement.lang=effectiveSettings.language;
    media.addEventListener('change',apply); return()=>media.removeEventListener('change',apply);
  },[effectiveSettings]);
  useEffect(()=>{
    const updateSetting=async (patch:Partial<Settings>)=>{
      const next={...settings,...patch};
      try{await SaveSettings(next);setSettings(next);setDraftSettings(next)}catch(e){setError(String(e))}
    };
    const off=[
      EventsOn('menu:open-settings',()=>openSettings()),
      EventsOn('menu:new-connection',()=>{resetWorkspace();setConnectionMode('new')}),
      EventsOn('menu:reconnect',()=>{if(profileId)connectSavedProfile(profileId)}),
      EventsOn('menu:set-theme',(value:string)=>updateSetting({theme:value as Settings['theme']})),
      EventsOn('menu:set-language',(value:string)=>updateSetting({language:value as Settings['language']})),
      EventsOn('menu:set-density',(value:string)=>updateSetting({density:value as Settings['density']})),
    ];
    return()=>off.forEach(fn=>fn());
  },[profileId,settings]);
  const selected=useMemo(()=>adapters.find(a=>a.id===form.adapterId),[adapters,form.adapterId]);
  const activeProfile=useMemo(()=>profiles.find(profile=>profile.id===profileId),[profiles,profileId]);
  const t=messages[effectiveSettings.language];
  const savedPageSize=6;
  const filteredProfiles=useMemo(()=>{const keyword=savedSearch.trim().toLowerCase();if(!keyword)return profiles;return profiles.filter(profile=>{const adapter=adapters.find(item=>item.id===profile.adapterId);return [profile.name,profile.endpoint,profile.project,profile.region,adapter?.name,profile.adapterId].some(value=>value?.toLowerCase().includes(keyword))})},[profiles,adapters,savedSearch]);
  const savedPageCount=Math.max(1,Math.ceil(filteredProfiles.length/savedPageSize));
  const visibleProfiles=filteredProfiles.slice((Math.min(savedPage,savedPageCount)-1)*savedPageSize,Math.min(savedPage,savedPageCount)*savedPageSize);
  const timeText=effectiveSettings.language==='zh-CN'?{select:'时间选择',calendar:'日期选择',exact:'整点时间',history:'历史记录',confirm:'确认',custom:'自定义',from:'开始时间',to:'结束时间'}:{select:'Time range',calendar:'Date picker',exact:'Exact minute',history:'History',confirm:'Apply',custom:'Custom',from:'Start time',to:'End time'};
  const queryText=effectiveSettings.language==='zh-CN'?{placeholder:'输入查询语句、SQL、SPL',run:'查询 / 分析',count:'日志条数',logs:'查询结果',chart:'结果图表',add:'新增查询',favorite:'收藏查询',options:'查询设置'}:{placeholder:'Enter query, SQL or SPL',run:'Search / Analyze',count:'Log count',logs:'Results',chart:'Chart',add:'New query',favorite:'Favorite query',options:'Query settings'};
  const adapterText=(adapter?:Adapter)=>{
    if(!adapter)return {name:'',description:''};
    const localized:Record<string,{zh:string;en:string;zhDesc:string;enDesc:string}>={
      demo:{zh:'本地演示',en:'Local demo',zhDesc:'无需凭证，验证完整查询流程',enDesc:'No credentials required; validates the complete query flow'},
      'aliyun-sls':{zh:'阿里云 SLS',en:'Alibaba Cloud SLS',zhDesc:'阿里云日志服务',enDesc:'Alibaba Cloud Simple Log Service'},
      'tencent-cls':{zh:'腾讯云 CLS',en:'Tencent Cloud CLS',zhDesc:'腾讯云日志服务',enDesc:'Tencent Cloud Log Service'},
      'aws-cloudwatch':{zh:'AWS CloudWatch',en:'AWS CloudWatch',zhDesc:'AWS 云日志服务',enDesc:'AWS CloudWatch Logs'},
    };
    const text=localized[adapter.id];
    return text?{name:effectiveSettings.language==='zh-CN'?text.zh:text.en,description:effectiveSettings.language==='zh-CN'?text.zhDesc:text.enDesc}:{name:adapter.name,description:adapter.description};
  };
  const histogram=useMemo(()=>{const bucketCount=18;const counts=Array(bucketCount).fill(0) as number[];const start=new Date(timeRange.from).getTime();const end=new Date(timeRange.to).getTime();const span=Math.max(1,end-start);for(const entry of result?.entries||[]){const timestamp=new Date(entry.time).getTime();if(timestamp<start||timestamp>end)continue;const index=Math.min(bucketCount-1,Math.floor((timestamp-start)/span*bucketCount));counts[index]++}const max=Math.max(1,...counts);const labels=counts.map((_,index)=>{if(index%3!==0&&index!==bucketCount-1)return '';return axisLabel(new Date(start+(span*index/bucketCount)),span,effectiveSettings.language)});return {counts,max,labels}},[result,timeRange,effectiveSettings.language]);

  async function connect(e:FormEvent){
    e.preventDefault(); setBusy(true); setError('');
    try { const s:any=await Connect(form); await applySession(s); const data:any=await Bootstrap();setProfiles(data.profiles||[]); }
    catch(e){setError(String(e))} finally{setBusy(false)}
  }
  async function connectSavedProfile(id=savedProfileId){
    if(!id)return;setBusy(true);setError('');
    try{await applySession(await ConnectSaved(id) as any)}catch(e){setError(String(e))}finally{setBusy(false)}
  }
  async function applySession(session:{profileId:number;logstores:string[]}){const stores=session.logstores||[];const firstStore=stores[0]||'';setProfileId(session.profileId);setLogstores(stores);setLogstore(firstStore);setQuery('');setResult(null);if(firstStore)await executeQuery(session.profileId,firstStore,'',timeRange)}
  function resetWorkspace(){setProfileId(0);setLogstores([]);setLogstore('');setResult(null);setCurrentPage(1);setError('')}
  async function executeQuery(targetProfileID:number,targetLogstore:string,queryValue:string,range:TimeRange,targetPage=1,targetPageSize=pageSize){
    if(!targetProfileID||!targetLogstore)return;setBusy(true);setError('');
    try{setResult(await Query({profileId:targetProfileID,logstore:targetLogstore,query:queryValue,from:range.from,to:range.to,page:targetPage,limit:targetPageSize}) as Result);setCurrentPage(targetPage)}
    catch(e){setError(String(e))}finally{setBusy(false)}
  }
  async function search(){await executeQuery(profileId,logstore,query,timeRange)}
  function insertQueryLineBreak(element:HTMLTextAreaElement){const start=element.selectionStart;const end=element.selectionEnd;setQuery(value=>`${value.slice(0,start)}\n${value.slice(end)}`);requestAnimationFrame(()=>{element.selectionStart=element.selectionEnd=start+1})}
  function changePage(nextPage:number){void executeQuery(profileId,logstore,query,timeRange,nextPage,pageSize)}
  function changePageSize(nextPageSize:number){setPageSize(nextPageSize);void executeQuery(profileId,logstore,query,timeRange,1,nextPageSize)}
  function selectLogstore(nextLogstore:string){setLogstore(nextLogstore);setResult(null);void executeQuery(profileId,nextLogstore,query,timeRange)}
  async function switchProfile(nextProfileID:number){setConfigSwitcherOpen(false);if(nextProfileID===profileId)return;setSavedProfileId(nextProfileID);await connectSavedProfile(nextProfileID)}
  function exitCurrentProfile(){setConfigSwitcherOpen(false);resetWorkspace();setConnectionMode('new');setForm({...emptyForm,name:t.localDemo})}
  const createPreset=(key:string,label:string,from:Date,to=new Date()):TimeRange=>({key,label,from:iso(from),to:iso(to)});
  const timePresets=()=>{const now=new Date();const dayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate());const yesterday=new Date(dayStart);yesterday.setDate(yesterday.getDate()-1);const weekStart=new Date(dayStart);weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));const monthStart=new Date(now.getFullYear(),now.getMonth(),1);const quarterStart=new Date(now.getFullYear(),Math.floor(now.getMonth()/3)*3,1);const yearStart=new Date(now.getFullYear(),0,1);const zh=effectiveSettings.language==='zh-CN';return [
    ['1m',zh?'1分钟':'1 min',()=>relativeRange('1m',zh?'1分钟':'1 min',60000)],['5m',zh?'5分钟':'5 min',()=>relativeRange('5m',zh?'5分钟':'5 min',300000)],['15m',zh?'15分钟':'15 min',()=>relativeRange('15m',zh?'15分钟':'15 min',900000)],['1h',zh?'1小时':'1 hour',()=>relativeRange('1h',zh?'1小时':'1 hour',3600000)],['4h',zh?'4小时':'4 hours',()=>relativeRange('4h',zh?'4小时':'4 hours',14400000)],['1d',zh?'1天':'1 day',()=>relativeRange('1d',zh?'1天':'1 day',86400000)],
    ['today',zh?'今天':'Today',()=>createPreset('today',zh?'今天':'Today',dayStart,now)],['yesterday',zh?'昨天':'Yesterday',()=>createPreset('yesterday',zh?'昨天':'Yesterday',yesterday,dayStart)],['beforeYesterday',zh?'前天':'Day before',()=>{const start=new Date(yesterday);start.setDate(start.getDate()-1);return createPreset('beforeYesterday',zh?'前天':'Day before',start,yesterday)}],['1w',zh?'1周':'1 week',()=>relativeRange('1w',zh?'1周':'1 week',604800000)],
    ['thisWeek',zh?'本周':'This week',()=>createPreset('thisWeek',zh?'本周':'This week',weekStart,now)],['lastWeek',zh?'上周':'Last week',()=>{const start=new Date(weekStart);start.setDate(start.getDate()-7);return createPreset('lastWeek',zh?'上周':'Last week',start,weekStart)}],['30d',zh?'30天':'30 days',()=>relativeRange('30d',zh?'30天':'30 days',2592000000)],['thisMonth',zh?'本月':'This month',()=>createPreset('thisMonth',zh?'本月':'This month',monthStart,now)],['lastMonth',zh?'上月':'Last month',()=>{const start=new Date(now.getFullYear(),now.getMonth()-1,1);return createPreset('lastMonth',zh?'上月':'Last month',start,monthStart)}],
    ['quarter',zh?'本季度':'This quarter',()=>createPreset('quarter',zh?'本季度':'This quarter',quarterStart,now)],['year',zh?'本年度':'This year',()=>createPreset('year',zh?'本年度':'This year',yearStart,now)],['custom',timeText.custom,()=>draftTimeRange]
  ] as const};
  const formatRange=(range:TimeRange)=>`${new Date(range.from).toLocaleString(effectiveSettings.language,{hour12:false})} ~ ${new Date(range.to).toLocaleString(effectiveSettings.language,{hour12:false})}`;
  function roundTimeRange(range:TimeRange){const from=new Date(range.from);const to=new Date(range.to);from.setSeconds(0,0);to.setSeconds(0,0);return {...range,from:iso(from),to:iso(to)}}
  function commitTimeRange(range:TimeRange,close=true,round=exactTime){const next=round?roundTimeRange(range):range;setDraftTimeRange(next);if(new Date(next.from)>new Date(next.to))return;setTimeRange(next);setTimeHistory(history=>[next,...history.filter(item=>item.from!==next.from||item.to!==next.to)].slice(0,5));if(profileId&&logstore)void executeQuery(profileId,logstore,query,next);if(close)setTimePickerOpen(false)}
  function histogramBucketRange(index:number){const bucketCount=histogram.counts.length;const start=new Date(timeRange.from).getTime();const end=new Date(timeRange.to).getTime();const bucketSize=(end-start)/bucketCount;return {from:new Date(start+bucketSize*index),to:new Date(index===bucketCount-1?end:start+bucketSize*(index+1))}}
  function selectHistogramBucket(index:number){const range=histogramBucketRange(index);commitTimeRange({key:'chart',label:effectiveSettings.language==='zh-CN'?'图表区间':'Chart interval',from:iso(range.from),to:iso(range.to)},false,false)}
  function histogramBucketTitle(index:number,count:number){const range=histogramBucketRange(index);return `${range.from.toLocaleString(effectiveSettings.language,{hour12:false})} ~ ${range.to.toLocaleString(effectiveSettings.language,{hour12:false})} · ${count}`}
  function openSettings(){setDraftSettings(settings);setSettingsOpen(true)}
  async function savePreferences(){
    setSavingSettings(true);setError('');
    try{await SaveSettings(draftSettings);setSettings(draftSettings);setSettingsOpen(false)}catch(e){setError(String(e))}finally{setSavingSettings(false)}
  }

  return <main className="shell">
    <section className={profileId?'workspace':'workspace connection-only'}>
      {profileId>0?<aside className="sidebar">
        <div className="section-title"><span>{t.logstores}</span><span className="count">{logstores.length}</span></div>
        {logstores.length ? <nav aria-label={t.logstores}>{logstores.map(x=><button key={x} className={x===logstore?'store active':'store'} onClick={()=>selectLogstore(x)}><span className="store-icon">▤</span>{x}</button>)}</nav> : <div className="empty"><span>⌁</span><p>{t.emptyStore}</p></div>}
        <div className="sidebar-footer"><div className="config-switcher" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setConfigSwitcherOpen(false)}}><button type="button" className={configSwitcherOpen?'sidebar-action switch open':'sidebar-action switch'} onClick={()=>setConfigSwitcherOpen(open=>!open)} aria-haspopup="listbox" aria-expanded={configSwitcherOpen}><span className="sidebar-action-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h11m0 0-3-3m3 3-3 3M16 14H5m0 0 3 3m-3-3 3-3"/></svg></span><span><strong>{effectiveSettings.language==='zh-CN'?'切换配置':'Switch profile'}</strong><small>{activeProfile?.name||t.saved}</small></span><b>⌃</b></button>{configSwitcherOpen&&<div className="config-switcher-menu" role="listbox">{profiles.map(profile=>{const adapter=adapters.find(item=>item.id===profile.adapterId);return <button type="button" role="option" aria-selected={profile.id===profileId} className={profile.id===profileId?'active':''} key={profile.id} onClick={()=>void switchProfile(profile.id)}><span className="profile-platform">{profile.adapterId==='demo'?'⌘':adapterText(adapter).name.slice(0,1)||'L'}</span><span><strong>{profile.name}</strong><small>{adapterText(adapter).name}</small></span>{profile.id===profileId&&<em>✓</em>}</button>})}</div>}</div><button type="button" className="sidebar-action exit" onClick={exitCurrentProfile}><span className="sidebar-action-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8m4-3 3-3-3-3m3 3H7"/></svg></span><span><strong>{effectiveSettings.language==='zh-CN'?'退出当前配置':'Exit profile'}</strong><small>{effectiveSettings.language==='zh-CN'?'返回首页并新建连接':'Return home to add a connection'}</small></span></button></div>
      </aside>:null}
      <div className="content">
        {!profileId ? <section className="connect-view">
          <div className="intro compact-intro"><h1>{t.connections}</h1></div>
          <form className="connect-card" onSubmit={connect}>
            <div className="connection-tabs" role="tablist"><button type="button" role="tab" aria-selected={connectionMode==='saved'} className={connectionMode==='saved'?'active':''} onClick={()=>setConnectionMode('saved')}>{t.saved}{profiles.length>0&&<span>{profiles.length}</span>}</button><button type="button" role="tab" aria-selected={connectionMode==='new'} className={connectionMode==='new'?'active':''} onClick={()=>setConnectionMode('new')}>＋ {t.newConnection}</button></div>
            {connectionMode==='saved'?<div className="saved-connection-pane">
              {profiles.length?<><div className="saved-profile-tools"><label><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.25"/><path d="m12.5 12.5 4 4"/></svg><input value={savedSearch} onChange={e=>{setSavedSearch(e.target.value);setSavedPage(1)}} placeholder={effectiveSettings.language==='zh-CN'?'搜索配置':'Search profiles'}/>{savedSearch&&<button type="button" onClick={()=>{setSavedSearch('');setSavedPage(1)}} aria-label={effectiveSettings.language==='zh-CN'?'清除搜索':'Clear search'}>×</button>}</label><span>{filteredProfiles.length}</span></div><div className="saved-profile-list" role="listbox" aria-label={t.saved}>{visibleProfiles.map(profile=>{const adapter=adapters.find(item=>item.id===profile.adapterId);return <button type="button" role="option" aria-selected={profile.id===savedProfileId} className={profile.id===savedProfileId?'selected':''} key={profile.id} onClick={()=>setSavedProfileId(profile.id)}><span className="profile-platform">{profile.adapterId==='demo'?'⌘':adapterText(adapter).name.slice(0,1)||'L'}</span><span className="saved-profile-copy"><strong>{profile.name}</strong><small>{adapterText(adapter).name||profile.adapterId}</small></span><span className="saved-profile-target" title={profile.project||profile.endpoint||t.localDemo}>{profile.project||profile.endpoint||t.localDemo}</span><i aria-hidden="true">{profile.id===savedProfileId?'●':'○'}</i></button>})}{!visibleProfiles.length&&<div className="saved-profile-empty">{effectiveSettings.language==='zh-CN'?'没有匹配的配置':'No matching profiles'}</div>}</div>{savedPageCount>1&&<div className="saved-profile-pagination"><button type="button" disabled={savedPage<=1} onClick={()=>setSavedPage(page=>Math.max(1,page-1))}>‹</button><span>{Math.min(savedPage,savedPageCount)} / {savedPageCount}</span><button type="button" disabled={savedPage>=savedPageCount} onClick={()=>setSavedPage(page=>Math.min(savedPageCount,page+1))}>›</button></div>}<button type="button" className="primary" onClick={()=>connectSavedProfile()} disabled={busy||!savedProfileId}>{busy?t.connecting:(effectiveSettings.language==='zh-CN'?'连接':'Connect')}</button></>:<div className="no-saved"><p>{t.noSaved}</p><button type="button" className="secondary" onClick={()=>setConnectionMode('new')}>{t.newConnection}</button></div>}
            </div>:<><div className="form-grid">
              <label className="wide">{t.choose}<select value={form.adapterId} onChange={e=>{const id=e.target.value;const adapter=adapters.find(a=>a.id===id);setForm({...form,adapterId:id,name:id==='demo'?t.localDemo:adapterText(adapter).name})}}>{adapters.map(a=><option key={a.id} value={a.id} disabled={!a.ready}>{adapterText(a).name}{!a.ready?` · ${t.pending}`:''}</option>)}</select></label>
              <label>{t.connectionName}<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required /></label>
              <label>{t.endpoint}<input value={form.endpoint} onChange={e=>setForm({...form,endpoint:e.target.value})} placeholder="https://cn-hangzhou.log.aliyuncs.com" disabled={form.adapterId==='demo'} /></label>
              <label>{t.accessKey}<input value={form.accessKey} onChange={e=>setForm({...form,accessKey:e.target.value})} autoComplete="off" disabled={form.adapterId==='demo'} /></label>
              <label>{t.secretKey}<input type="password" value={form.secretKey} onChange={e=>setForm({...form,secretKey:e.target.value})} autoComplete="new-password" disabled={form.adapterId==='demo'} /></label>
              <label>{t.project}<input value={form.project} onChange={e=>setForm({...form,project:e.target.value})} disabled={form.adapterId==='demo'} /></label>
              <label>{t.region}<input value={form.region} onChange={e=>setForm({...form,region:e.target.value})} disabled={form.adapterId==='demo'} /></label>
            </div>
            {error&&<div className="alert" role="alert">{error}</div>}
            <button className="primary" disabled={busy||!selected?.ready}>{busy?t.connecting:(effectiveSettings.language==='zh-CN'?'保存并连接':'Save & Connect')}</button>
            </>}
            {connectionMode==='saved'&&error&&<div className="alert" role="alert">{error}</div>}
          </form>
        </section> : <section className="query-view">
          <div className="query-head"><div className="breadcrumb-line"><span className="breadcrumb">{t.logstores}</span><span className="breadcrumb-separator">/</span><h1 title={logstore}>{logstore}</h1></div><div className="time-picker" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setTimePickerOpen(false)}}><button className={timePickerOpen?'time open':'time'} onClick={()=>{setDraftTimeRange(timeRange);setTimePickerOpen(open=>!open)}} aria-haspopup="dialog" aria-expanded={timePickerOpen}><svg className="time-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25"/><path d="M10 5.75V10l3 1.75"/></svg><span className="time-value">{timeRange.key==='15m'?t.recent:timeRange.label}</span><svg className="time-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6"/></svg></button>{timePickerOpen&&<section className="time-popover" role="dialog" aria-label={timeText.select}>
            <div className="time-summary"><span>{draftTimeRange.label}</span><strong>{formatRange(draftTimeRange)}</strong><svg className="time-chevron open" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6"/></svg></div>
            <div className="time-popover-head"><strong>{timeText.select}</strong><button type="button" onClick={()=>setCustomTimeOpen(open=>!open)}>▣ {timeText.calendar}</button><label><input type="checkbox" checked={exactTime} onChange={e=>{const checked=e.target.checked;setExactTime(checked);if(checked)commitTimeRange(roundTimeRange(draftTimeRange),false,false)}}/><span>{timeText.exact}</span></label></div>
            {customTimeOpen&&<div className="custom-time-fields"><label>{timeText.from}<input type="datetime-local" value={localInput(draftTimeRange.from)} onChange={e=>{if(e.target.value){const next={...draftTimeRange,key:'custom',label:timeText.custom,from:inputISO(e.target.value)};commitTimeRange(next,false)}}}/></label><span>→</span><label>{timeText.to}<input type="datetime-local" value={localInput(draftTimeRange.to)} onChange={e=>{if(e.target.value){const next={...draftTimeRange,key:'custom',label:timeText.custom,to:inputISO(e.target.value)};commitTimeRange(next,false)}}}/></label></div>}
            <div className="time-presets">{timePresets().map(([key,label,make])=><button type="button" key={key} className={draftTimeRange.key===key?'selected':''} onClick={()=>{if(key==='custom'){setCustomTimeOpen(true)}else{setCustomTimeOpen(false);commitTimeRange(make())}}}>{label}</button>)}</div>
            <div className="time-history"><button type="button" onClick={()=>setHistoryOpen(open=>!open)}>{timeText.history} <span>{historyOpen?'⌄':'›'}</span></button>{historyOpen&&<div>{timeHistory.length?timeHistory.map((item,index)=><button type="button" key={`${item.from}-${index}`} onClick={()=>commitTimeRange(item)}><strong>{item.label}</strong><small>{formatRange(item)}</small></button>):<small>—</small>}</div>}</div>
          </section>}</div></div>
          <section className="query-console">
            <div className="query-toolbar"><button type="button" className={queryFavorite?'query-tool favorite active':'query-tool favorite'} aria-label={queryText.favorite} onClick={()=>setQueryFavorite(value=>!value)}>★</button><span className="query-line" aria-hidden="true">{query.split('\n').slice(0,5).map((_,index)=><b key={index}>{index+1}</b>)}</span><textarea rows={Math.min(5,Math.max(1,query.split('\n').length))} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();insertQueryLineBreak(e.currentTarget)}}} placeholder={queryText.placeholder} spellCheck={false}/><button type="button" className="query-submit" onClick={search} disabled={busy}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.25"/><path d="m12.5 12.5 4 4"/></svg>{busy?t.querying:queryText.run}</button></div>
            <div className="query-stats"><strong>{queryText.count}：{result?.total.toLocaleString(effectiveSettings.language)||0}</strong>{result&&<small>{result.tookMs} ms</small>}</div>
            <div className="query-histogram"><div className="histogram-scale"><span>{histogram.max}</span><span>0</span></div><div className="histogram-plot">{histogram.counts.map((count,index)=><button type="button" className="histogram-bucket" key={index} onClick={()=>selectHistogramBucket(index)} title={histogramBucketTitle(index,count)} aria-label={`${effectiveSettings.language==='zh-CN'?'筛选时间区间':'Filter time interval'} ${index+1}, ${count}`}><span style={{height:`${count?Math.max(8,count/histogram.max*100):0}%`}}/><small>{histogram.labels[index]}</small></button>)}</div></div>
          </section>
          {error&&<div className="alert" role="alert">{error}</div>}
          <LogResults entries={result?.entries||[]} total={result?.total||0} locale={effectiveSettings.language} page={currentPage} pageSize={pageSize} onPageChange={changePage} onPageSizeChange={changePageSize}/>
        </section>}
      </div>
    </section>
    {settingsOpen&&<div className="settings-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setSettingsOpen(false)}}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={e=>{if(e.key==='Escape')setSettingsOpen(false)}}>
        <header><div><span className="eyebrow">LOGGOPHER</span><h2 id="settings-title">{t.settingsTitle}</h2><p>{t.settingsDesc}</p></div><button className="close-button" onClick={()=>setSettingsOpen(false)} aria-label={t.cancel}>×</button></header>
        <div className="setting-group"><label>{t.appearance}</label><div className="segmented">{(['system','light','dark'] as const).map(v=><button key={v} className={draftSettings.theme===v?'selected':''} onClick={()=>setDraftSettings({...draftSettings,theme:v})}><span>{v==='system'?'◐':v==='light'?'☀':'☾'}</span>{t[v]}</button>)}</div></div>
        <div className="setting-group"><label>{t.language}</label><div className="segmented two"><button className={draftSettings.language==='zh-CN'?'selected':''} onClick={()=>setDraftSettings({...draftSettings,language:'zh-CN'})}>{t.chinese}</button><button className={draftSettings.language==='en-US'?'selected':''} onClick={()=>setDraftSettings({...draftSettings,language:'en-US'})}>{t.english}</button></div></div>
        <div className="setting-group"><label>{t.density}</label><div className="segmented two"><button className={draftSettings.density==='comfortable'?'selected':''} onClick={()=>setDraftSettings({...draftSettings,density:'comfortable'})}>{t.comfortable}</button><button className={draftSettings.density==='compact'?'selected':''} onClick={()=>setDraftSettings({...draftSettings,density:'compact'})}>{t.compact}</button></div></div>
        <footer><button className="secondary" onClick={()=>setSettingsOpen(false)}>{t.cancel}</button><button className="primary save-settings" onClick={savePreferences} disabled={savingSettings}>{savingSettings?t.saving:t.save}</button></footer>
      </section>
    </div>}
  </main>
}
export default App;
