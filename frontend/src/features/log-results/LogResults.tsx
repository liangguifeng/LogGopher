import {MouseEvent, useEffect, useMemo, useRef, useState} from 'react';
import {ClipboardSetText} from '../../../wailsjs/runtime/runtime';
import './log-results.css';

/** Normalized log record received from the Wails domain model. */
export type LogEntry = {time:string;level:string;message:string;fields:Record<string,string>};

/** Maps provider level names to stable semantic CSS classes. */
const levelClass=(level:string)=>`level-${level.toLowerCase().replace('warning','warn').replace('critical','fatal')}`;

/** Inputs and callbacks owned by the parent query workspace. */
type Props={entries:LogEntry[];total:number;locale:'zh-CN'|'en-US';page:number;pageSize:number;onPageChange:(page:number)=>void;onPageSizeChange:(size:number)=>void;onFilter:(field:string,value:unknown,exclude:boolean)=>void};
/** Identifies the clicked JSON leaf and the screen position of its action menu. */
type FilterTarget={id:string;field:string;value:unknown;left:number;top:number};

/** Parses JSON-looking field values while preserving ordinary strings. */
function parsed(value:string):unknown{try{return JSON.parse(value)}catch{return value}}

/** Recursively renders an expandable JSON tree with filterable leaf values. */
function JsonNode({name,value,nodeId,selectedId,onSelect,depth=0}:{name:string;value:unknown;nodeId:string;selectedId?:string;onSelect:(event:MouseEvent<HTMLButtonElement>,id:string,field:string,value:unknown)=>void;depth?:number}){
  const [open,setOpen]=useState(depth<1);
  const complex=value!==null&&typeof value==='object';
  if(complex){const entries=Object.entries(value as Record<string,unknown>);return <div className="json-node" style={{paddingLeft:depth*12}}><button type="button" onClick={()=>setOpen(v=>!v)}>{open?'▾':'▸'}</button><span className="json-key">{name}:</span><span className="json-brace">{'{'}</span>{open&&<div>{entries.map(([key,item])=><JsonNode key={key} name={key} value={item} nodeId={`${nodeId}.${key}`} selectedId={selectedId} onSelect={onSelect} depth={depth+1}/>)}</div>}<span className="json-brace">{'}'}</span></div>}
  return <div className="json-leaf" style={{paddingLeft:depth*12+18}}><span className="json-key">{name}:</span><button type="button" className={`${typeof value==='number'?'json-number':'json-value'} json-filter-value${selectedId===nodeId?' selected':''}`} onClick={event=>onSelect(event,nodeId,name,value)}>{typeof value==='string'?`"${value}"`:String(value)}</button></div>
}

/** Renders field controls, pagination, raw JSON records, and the table result view. */
export default function LogResults({entries,total,locale,page,pageSize,onPageChange,onPageSizeChange,onFilter}:Props){
  const zh=locale==='zh-CN';
  const [view,setView]=useState<'raw'|'table'>('raw');
  const [ascending,setAscending]=useState(false);
  const [fieldSearch,setFieldSearch]=useState('');
  const [pageSizeOpen,setPageSizeOpen]=useState(false);
  const [jumpPage,setJumpPage]=useState('');
  const [fieldsCollapsed,setFieldsCollapsed]=useState(true);
  const [hiddenFields,setHiddenFields]=useState<Set<string>>(()=>new Set());
  const [copiedLog,setCopiedLog]=useState('');
  const [filterTarget,setFilterTarget]=useState<FilterTarget|null>(null);
  const [copiedFilterValue,setCopiedFilterValue]=useState(false);
  const filterMenuRef=useRef<HTMLDivElement>(null);
  const [expanded,setExpanded]=useState<Set<number>>(()=>new Set(entries.map((_,i)=>i)));
  useEffect(()=>setExpanded(new Set(entries.map((_,index)=>index))),[entries]);
  useEffect(()=>{if(!filterTarget)return;const close=(event:PointerEvent)=>{if(!filterMenuRef.current?.contains(event.target as Node))setFilterTarget(null)};document.addEventListener('pointerdown',close,true);return()=>document.removeEventListener('pointerdown',close,true)},[filterTarget]);
  const fields=useMemo(()=>Array.from(new Set(entries.flatMap(entry=>Object.keys(entry.fields)))),[entries]);
  const listedFields=useMemo(()=>fields.filter(field=>field.toLowerCase().includes(fieldSearch.trim().toLowerCase())),[fields,fieldSearch]);
  const displayFields=useMemo(()=>fields.filter(field=>!hiddenFields.has(field)),[fields,hiddenFields]);
  const fieldCounts=useMemo(()=>Object.fromEntries(fields.map(field=>[field,entries.filter(entry=>field in entry.fields).length])),[entries,fields]);
  const allFieldsSelected=fields.length>0&&displayFields.length===fields.length;
  const sorted=useMemo(()=>[...entries].sort((a,b)=>(new Date(a.time).getTime()-new Date(b.time).getTime())*(ascending?1:-1)),[entries,ascending]);
  const totalPages=Math.max(1,Math.ceil(total/pageSize));
  const pageItems=useMemo(()=>{
    if(totalPages<=7)return Array.from({length:totalPages},(_,index)=>index+1) as (number|string)[];
    const pages=new Set<number>([1,totalPages,page-1,page,page+1]);
    if(page<=4)[2,3,4].forEach(value=>pages.add(value));
    if(page>=totalPages-3)[totalPages-3,totalPages-2,totalPages-1].forEach(value=>pages.add(value));
    const ordered=[...pages].filter(value=>value>=1&&value<=totalPages).sort((a,b)=>a-b);
    const items:(number|string)[]=[];
    ordered.forEach((value,index)=>{if(index&&value-ordered[index-1]>1)items.push(`ellipsis-${value}`);items.push(value)});
    return items;
  },[page,totalPages]);
  const goToPage=(value:number)=>onPageChange(Math.min(totalPages,Math.max(1,value)));
  const confirmJump=()=>{const value=Number.parseInt(jumpPage,10);if(Number.isFinite(value)){goToPage(value);setJumpPage('')}};
  const toggle=(index:number)=>setExpanded(current=>{const next=new Set(current);next.has(index)?next.delete(index):next.add(index);return next});
  const toggleField=(field:string)=>setHiddenFields(current=>{const next=new Set(current);next.has(field)?next.delete(field):next.add(field);return next});
  const toggleAllFields=()=>setHiddenFields(current=>{const next=new Set(current);fields.forEach(field=>allFieldsSelected?next.add(field):next.delete(field));return next});
  const visibleFieldEntries=(entry:LogEntry)=>displayFields.flatMap(field=>field in entry.fields?[[field,entry.fields[field]] as [string,string]]:[]);
  const copyLog=async (key:string,data:Record<string,unknown>)=>{if(await ClipboardSetText(JSON.stringify(data,null,2))){setCopiedLog(key);window.setTimeout(()=>setCopiedLog(current=>current===key?'':current),1200)}};
  const selectFilterValue=(event:MouseEvent<HTMLButtonElement>,id:string,field:string,value:unknown)=>{event.stopPropagation();setCopiedFilterValue(false);setFilterTarget({id,field,value,left:Math.min(event.clientX,window.innerWidth-190),top:Math.min(event.clientY+8,window.innerHeight-110)})};
  const applyFilter=(exclude:boolean)=>{if(!filterTarget)return;onFilter(filterTarget.field,filterTarget.value,exclude);setFilterTarget(null)};
  const copyFilterValue=async()=>{if(!filterTarget)return;if(await ClipboardSetText(String(filterTarget.value))){setCopiedFilterValue(true);window.setTimeout(()=>setCopiedFilterValue(false),1200)}};
  const labels={search:zh?'搜索字段名称':'Search fields',display:zh?'显示字段':'Display fields',all:zh?'全部字段':'All fields',noFields:zh?'没有匹配的字段':'No matching fields',copy:zh?'复制当前日志 JSON':'Copy log JSON',copyValue:zh?'复制':'Copy',copied:zh?'已复制':'Copied',include:zh?'加入筛选':'Add to filter',exclude:zh?'排除':'Exclude',collapse:zh?'收起字段栏':'Collapse fields',expand:zh?'展开字段栏':'Expand fields',table:zh?'表格':'Table',original:zh?'原始':'Raw',time:zh?'时间':'Time',perPage:zh?'每页显示':'Per page',total:zh?'总数':'Total',jump:zh?'到第':'Go to',pageUnit:zh?'页':'page',confirm:zh?'确认':'Go',empty:zh?'暂无日志，请先运行查询':'No logs. Run a query first.'};

  return <section className="log-results-panel">
    <div className={fieldsCollapsed?'log-result-body fields-collapsed':'log-result-body'}>
      <aside className="field-sidebar"><div className="field-search"><input value={fieldSearch} onChange={e=>setFieldSearch(e.target.value)} placeholder={labels.search}/><span>⌕</span></div><div className="field-heading"><b>⌄</b>{labels.display}<small>{displayFields.length}/{fields.length}</small></div><label className="show-all"><input type="checkbox" checked={allFieldsSelected} disabled={!fields.length} onChange={toggleAllFields}/><strong>{labels.all}</strong></label><div className="field-list">{listedFields.map(field=><label className="field-item" key={field}><input type="checkbox" checked={!hiddenFields.has(field)} onChange={()=>toggleField(field)}/><span>J</span><strong title={field}>{field}</strong><small>{fieldCounts[field]}</small></label>)}{fields.length>0&&!listedFields.length&&<div className="field-empty">{labels.noFields}</div>}</div></aside>
      <div className="log-main">
        <div className="log-toolbar"><button className={fieldsCollapsed?'field-toggle collapsed':'field-toggle'} title={fieldsCollapsed?labels.expand:labels.collapse} aria-label={fieldsCollapsed?labels.expand:labels.collapse} aria-expanded={!fieldsCollapsed} onClick={()=>setFieldsCollapsed(value=>!value)}>☷</button><div className="view-switch"><button className={view==='table'?'active':''} onClick={()=>setView('table')}>{labels.table}</button><button className={view==='raw'?'active':''} onClick={()=>setView('raw')}>{labels.original}</button></div><button className="time-sort" onClick={()=>setAscending(value=>!value)} title={ascending?(zh?'当前正序，点击切换倒序':'Ascending; click for descending'):(zh?'当前倒序，点击切换正序':'Descending; click for ascending')} aria-label={ascending?(zh?'时间正序':'Time ascending'):(zh?'时间倒序':'Time descending')}>{labels.time}<svg className="sort-arrows" viewBox="0 0 16 16" aria-hidden="true"><path className={!ascending?'active':''} d="M4.5 6.5 8 3l3.5 3.5"/><path className={ascending?'active':''} d="m4.5 9.5 3.5 3.5 3.5-3.5"/></svg></button><div className="pagination"><span>{labels.perPage}：</span><div className="page-size-select" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setPageSizeOpen(false)}}><button type="button" className={pageSizeOpen?'page-size-trigger open':'page-size-trigger'} aria-haspopup="listbox" aria-expanded={pageSizeOpen} onClick={()=>setPageSizeOpen(open=>!open)}><strong>{pageSize}</strong><span>⌄</span></button>{pageSizeOpen&&<div className="page-size-options" role="listbox">{[20,50,100].map(size=><button type="button" role="option" aria-selected={pageSize===size} className={pageSize===size?'selected':''} key={size} onClick={()=>{onPageSizeChange(size);setPageSizeOpen(false)}}><span>{size}</span>{pageSize===size&&<b>✓</b>}</button>)}</div>}</div><span>{labels.total}：{total.toLocaleString(locale)} {zh?'条':''}</span><button type="button" className="page-nav" disabled={page<=1} onClick={()=>goToPage(page-1)}>‹</button>{pageItems.map(item=>typeof item==='number'?<button type="button" key={item} className={item===page?'page-number active':'page-number'} aria-current={item===page?'page':undefined} onClick={()=>goToPage(item)}>{item}</button>:<span className="pagination-ellipsis" key={item}>…</span>)}<button type="button" className="page-nav" disabled={page>=totalPages} onClick={()=>goToPage(page+1)}>›</button><span className="pagination-jump"><label htmlFor="pagination-jump">{labels.jump}</label><input id="pagination-jump" inputMode="numeric" value={jumpPage} onChange={e=>setJumpPage(e.target.value.replace(/\D/g,''))} onKeyDown={e=>{if(e.key==='Enter')confirmJump()}} aria-label={`${labels.jump}${labels.pageUnit}`}/><span>{labels.pageUnit}</span><button type="button" className="jump-confirm" disabled={!jumpPage} onClick={confirmJump}>{labels.confirm}</button></span></div></div>
        {view==='raw'?<div className="raw-log-list">{sorted.length?sorted.map((entry,index)=>{const rowKey=`${entry.time}-${index}`;const visibleEntries=visibleFieldEntries(entry);const visibleData=Object.fromEntries(visibleEntries.map(([key,value])=>[key,parsed(value)]));const data={message:entry.message,level:entry.level,...visibleData};const clipboardData={time:entry.time,level:entry.level,message:entry.message,...visibleData};const copied=copiedLog===rowKey;return <article className="raw-log" key={rowKey}><button className="row-toggle" onClick={()=>toggle(index)}>{expanded.has(index)?'▾':'▸'}</button><span className="row-index">{(page-1)*pageSize+index+1}</span><time>{new Date(entry.time).toLocaleDateString(locale)}<b>{new Date(entry.time).toLocaleTimeString(locale,{hour12:false})}</b></time><div className="raw-content"><div className="log-tags"><button type="button" className={copied?'copy-log copied':'copy-log'} title={copied?labels.copied:labels.copy} aria-label={copied?labels.copied:labels.copy} onClick={()=>void copyLog(rowKey,clipboardData)}>{copied?<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9"/></svg>:<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="6" width="9" height="10" rx="1"/><path d="M13 6V4H4v9h3"/></svg>}</button><span className={`log-level ${levelClass(entry.level)}`}>{entry.level}</span>{visibleEntries.slice(0,3).map(([key,value])=><span className="platform-tag" key={key}>{value}</span>)}</div>{expanded.has(index)&&<div className="json-tree"><JsonNode name="content" value={data} nodeId={rowKey} selectedId={filterTarget?.id} onSelect={selectFilterValue}/></div>}</div></article>}):<div className="logs-empty">{labels.empty}</div>}</div>:<div className="results-table"><table><thead><tr><th>#</th><th>{labels.time}</th><th>LEVEL</th><th>MESSAGE</th>{displayFields.map(field=><th key={field}>{field}</th>)}</tr></thead><tbody>{sorted.map((entry,index)=><tr key={`${entry.time}-${index}`}><td>{(page-1)*pageSize+index+1}</td><td>{new Date(entry.time).toLocaleString(locale)}</td><td><span className={`log-level ${levelClass(entry.level)}`}>{entry.level}</span></td><td>{entry.message}</td>{displayFields.map(field=><td key={field}>{entry.fields[field]||'—'}</td>)}</tr>)}</tbody></table></div>}
      </div>
    </div>{filterTarget&&<div className="log-filter-menu" ref={filterMenuRef} style={{left:filterTarget.left,top:filterTarget.top}} role="menu"><header><div className="filter-menu-value"><strong title={String(filterTarget.value)}>{String(filterTarget.value)}</strong><button type="button" onClick={()=>void copyFilterValue()}>{copiedFilterValue?labels.copied:labels.copyValue}</button></div><span>{filterTarget.field}</span></header><button type="button" role="menuitem" onClick={()=>applyFilter(false)}><span>＋</span>{labels.include}</button><button type="button" role="menuitem" onClick={()=>applyFilter(true)}><span>−</span>{labels.exclude}</button></div>}
  </section>
}
