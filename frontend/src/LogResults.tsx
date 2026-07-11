import {useEffect, useMemo, useState} from 'react';
import './log-results.css';

export type LogEntry = {time:string;level:string;message:string;fields:Record<string,string>};

const levelClass=(level:string)=>`level-${level.toLowerCase().replace('warning','warn').replace('critical','fatal')}`;

type Props={entries:LogEntry[];total:number;locale:'zh-CN'|'en-US';page:number;pageSize:number;onPageChange:(page:number)=>void;onPageSizeChange:(size:number)=>void};

function parsed(value:string):unknown{try{return JSON.parse(value)}catch{return value}}

function JsonNode({name,value,depth=0}:{name:string;value:unknown;depth?:number}){
  const [open,setOpen]=useState(depth<1);
  const complex=value!==null&&typeof value==='object';
  if(complex){const entries=Object.entries(value as Record<string,unknown>);return <div className="json-node" style={{paddingLeft:depth*12}}><button type="button" onClick={()=>setOpen(v=>!v)}>{open?'▾':'▸'}</button><span className="json-key">{name}:</span><span className="json-brace">{'{'}</span>{open&&<div>{entries.map(([key,item])=><JsonNode key={key} name={key} value={item} depth={depth+1}/>)}</div>}<span className="json-brace">{'}'}</span></div>}
  return <div className="json-leaf" style={{paddingLeft:depth*12+18}}><span className="json-key">{name}:</span><span className={typeof value==='number'?'json-number':'json-value'}>{typeof value==='string'?`"${value}"`:String(value)}</span></div>
}

export default function LogResults({entries,total,locale,page,pageSize,onPageChange,onPageSizeChange}:Props){
  const zh=locale==='zh-CN';
  const [view,setView]=useState<'raw'|'table'>('raw');
  const [ascending,setAscending]=useState(false);
  const [fieldSearch,setFieldSearch]=useState('');
  const [pageSizeOpen,setPageSizeOpen]=useState(false);
  const [jumpPage,setJumpPage]=useState('');
  const [fieldsCollapsed,setFieldsCollapsed]=useState(false);
  const [expanded,setExpanded]=useState<Set<number>>(()=>new Set(entries.map((_,i)=>i)));
  useEffect(()=>setExpanded(new Set(entries.map((_,index)=>index))),[entries]);
  const fields=useMemo(()=>Array.from(new Set(entries.flatMap(entry=>Object.keys(entry.fields)))).filter(field=>field.toLowerCase().includes(fieldSearch.toLowerCase())),[entries,fieldSearch]);
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
  const labels={search:zh?'搜索字段名称':'Search fields',display:zh?'显示字段':'Display fields',indexed:zh?'索引字段':'Indexed fields',other:zh?'其他字段':'Other fields',all:zh?'显示全部字段':'Show all fields',view:zh?'视图':'View',collapse:zh?'收起字段栏':'Collapse fields',expand:zh?'展开字段栏':'Expand fields',table:zh?'表格':'Table',original:zh?'原始':'Raw',time:zh?'时间':'Time',perPage:zh?'每页显示':'Per page',total:zh?'总数':'Total',jump:zh?'到第':'Go to',pageUnit:zh?'页':'page',confirm:zh?'确认':'Go',empty:zh?'暂无日志，请先运行查询':'No logs. Run a query first.'};

  return <section className="log-results-panel">
    <div className={fieldsCollapsed?'log-result-body fields-collapsed':'log-result-body'}>
      <aside className="field-sidebar"><div className="field-search"><input value={fieldSearch} onChange={e=>setFieldSearch(e.target.value)} placeholder={labels.search}/><span>⌕</span></div><div className="field-heading"><b>⌄</b>{labels.display}<em>☆</em></div><button className="show-all">{labels.all}</button><div className="field-heading"><b>⌄</b>{labels.indexed}<small>{fields.length}</small></div>{fields.slice(0,12).map(field=><button className="field-item" key={field}><span>J</span><strong>{field}</strong><small>{entries.filter(entry=>field in entry.fields).length}</small></button>)}<div className="field-heading"><b>›</b>{labels.other}<small>3</small></div></aside>
      <div className="log-main">
        <div className="log-toolbar"><button className={fieldsCollapsed?'field-toggle collapsed':'field-toggle'} title={fieldsCollapsed?labels.expand:labels.collapse} aria-label={fieldsCollapsed?labels.expand:labels.collapse} aria-expanded={!fieldsCollapsed} onClick={()=>setFieldsCollapsed(value=>!value)}>☷</button><div className="view-switch"><button className={view==='table'?'active':''} onClick={()=>setView('table')}>{labels.table}</button><button className={view==='raw'?'active':''} onClick={()=>setView('raw')}>{labels.original}</button></div><button className="time-sort" onClick={()=>setAscending(value=>!value)} title={ascending?(zh?'当前正序，点击切换倒序':'Ascending; click for descending'):(zh?'当前倒序，点击切换正序':'Descending; click for ascending')} aria-label={ascending?(zh?'时间正序':'Time ascending'):(zh?'时间倒序':'Time descending')}>{labels.time}<svg className="sort-arrows" viewBox="0 0 16 16" aria-hidden="true"><path className={!ascending?'active':''} d="M4.5 6.5 8 3l3.5 3.5"/><path className={ascending?'active':''} d="m4.5 9.5 3.5 3.5 3.5-3.5"/></svg></button><div className="pagination"><span>{labels.perPage}：</span><div className="page-size-select" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setPageSizeOpen(false)}}><button type="button" className={pageSizeOpen?'page-size-trigger open':'page-size-trigger'} aria-haspopup="listbox" aria-expanded={pageSizeOpen} onClick={()=>setPageSizeOpen(open=>!open)}><strong>{pageSize}</strong><span>⌄</span></button>{pageSizeOpen&&<div className="page-size-options" role="listbox">{[20,50,100].map(size=><button type="button" role="option" aria-selected={pageSize===size} className={pageSize===size?'selected':''} key={size} onClick={()=>{onPageSizeChange(size);setPageSizeOpen(false)}}><span>{size}</span>{pageSize===size&&<b>✓</b>}</button>)}</div>}</div><span>{labels.total}：{total.toLocaleString(locale)} {zh?'条':''}</span><button type="button" className="page-nav" disabled={page<=1} onClick={()=>goToPage(page-1)}>‹</button>{pageItems.map(item=>typeof item==='number'?<button type="button" key={item} className={item===page?'page-number active':'page-number'} aria-current={item===page?'page':undefined} onClick={()=>goToPage(item)}>{item}</button>:<span className="pagination-ellipsis" key={item}>…</span>)}<button type="button" className="page-nav" disabled={page>=totalPages} onClick={()=>goToPage(page+1)}>›</button><span className="pagination-jump"><label htmlFor="pagination-jump">{labels.jump}</label><input id="pagination-jump" inputMode="numeric" value={jumpPage} onChange={e=>setJumpPage(e.target.value.replace(/\D/g,''))} onKeyDown={e=>{if(e.key==='Enter')confirmJump()}} aria-label={`${labels.jump}${labels.pageUnit}`}/><span>{labels.pageUnit}</span><button type="button" className="jump-confirm" disabled={!jumpPage} onClick={confirmJump}>{labels.confirm}</button></span></div></div>
        {view==='raw'?<div className="raw-log-list">{sorted.length?sorted.map((entry,index)=>{const data={message:entry.message,level:entry.level,...Object.fromEntries(Object.entries(entry.fields).map(([key,value])=>[key,parsed(value)]))};return <article className="raw-log" key={`${entry.time}-${index}`}><button className="row-toggle" onClick={()=>toggle(index)}>{expanded.has(index)?'▾':'▸'}</button><span className="row-index">{(page-1)*pageSize+index+1}</span><time>{new Date(entry.time).toLocaleDateString(locale)}<b>{new Date(entry.time).toLocaleTimeString(locale,{hour12:false})}</b></time><div className="raw-content"><div className="log-tags"><span className={`log-level ${levelClass(entry.level)}`}>{entry.level}</span>{Object.entries(entry.fields).slice(0,3).map(([key,value])=><span className="platform-tag" key={key}>{value}</span>)}</div>{expanded.has(index)&&<div className="json-tree"><JsonNode name="content" value={data}/></div>}</div></article>}):<div className="logs-empty">{labels.empty}</div>}</div>:<div className="results-table"><table><thead><tr><th>#</th><th>{labels.time}</th><th>LEVEL</th><th>MESSAGE</th>{fields.slice(0,4).map(field=><th key={field}>{field}</th>)}</tr></thead><tbody>{sorted.map((entry,index)=><tr key={`${entry.time}-${index}`}><td>{(page-1)*pageSize+index+1}</td><td>{new Date(entry.time).toLocaleString(locale)}</td><td><span className={`log-level ${levelClass(entry.level)}`}>{entry.level}</span></td><td>{entry.message}</td>{fields.slice(0,4).map(field=><td key={field}>{entry.fields[field]||'—'}</td>)}</tr>)}</tbody></table></div>}
      </div>
    </div>
  </section>
}
