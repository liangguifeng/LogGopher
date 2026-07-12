import {useEffect, useMemo, useState} from 'react';
import './date-time-field.css';

/** Props accepted by the controlled date-time picker. */
type Props={label:string;value:string;locale:'zh-CN'|'en-US';onChange:(value:string)=>void};

/** Pads a numeric date part to two characters. */
const pad=(value:number)=>String(value).padStart(2,'0');
/** Reports whether two Date values represent the same local calendar day. */
const sameDay=(left:Date,right:Date)=>left.getFullYear()===right.getFullYear()&&left.getMonth()===right.getMonth()&&left.getDate()===right.getDate();

/** Renders the theme-aware calendar and time controls used by the query range picker. */
export default function DateTimeField({label,value,locale,onChange}:Props){
  const selected=useMemo(()=>new Date(value),[value]);
  const [open,setOpen]=useState(false);
  const [month,setMonth]=useState(()=>new Date(selected.getFullYear(),selected.getMonth(),1));
  useEffect(()=>setMonth(new Date(selected.getFullYear(),selected.getMonth(),1)),[value]);
  const zh=locale==='zh-CN';
  const weekdays=zh?['一','二','三','四','五','六','日']:['Mo','Tu','We','Th','Fr','Sa','Su'];
  const days=useMemo(()=>{const first=new Date(month.getFullYear(),month.getMonth(),1);const offset=(first.getDay()+6)%7;return Array.from({length:42},(_,index)=>new Date(month.getFullYear(),month.getMonth(),index-offset+1))},[month]);
  const update=(date:Date)=>onChange(date.toISOString());
  const selectDay=(day:Date)=>{const next=new Date(selected);next.setFullYear(day.getFullYear(),day.getMonth(),day.getDate());update(next)};
  const setTime=(part:'hour'|'minute',raw:string)=>{const next=new Date(selected);part==='hour'?next.setHours(Number(raw)):next.setMinutes(Number(raw));next.setSeconds(0,0);update(next)};
  const chooseToday=()=>{const now=new Date();const next=new Date(selected);next.setFullYear(now.getFullYear(),now.getMonth(),now.getDate());setMonth(new Date(now.getFullYear(),now.getMonth(),1));update(next)};
  const display=`${selected.getFullYear()}-${pad(selected.getMonth()+1)}-${pad(selected.getDate())} ${pad(selected.getHours())}:${pad(selected.getMinutes())}`;
  return <div className="date-time-field" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false)}}>
    <span className="date-time-label">{label}</span>
    <button type="button" className={open?'date-time-trigger open':'date-time-trigger'} onClick={()=>setOpen(current=>!current)} aria-expanded={open} aria-haspopup="dialog"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="1"/><path d="M6.5 2.5v4M13.5 2.5v4M3 8h14"/></svg><span>{display}</span><svg className="date-time-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6"/></svg></button>
    {open&&<section className="date-time-panel" role="dialog" aria-label={label}>
      <header><button type="button" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))} aria-label={zh?'上个月':'Previous month'}>‹</button><strong>{month.toLocaleDateString(locale,{year:'numeric',month:'long'})}</strong><button type="button" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))} aria-label={zh?'下个月':'Next month'}>›</button></header>
      <div className="date-time-weekdays">{weekdays.map(day=><span key={day}>{day}</span>)}</div>
      <div className="date-time-days">{days.map(day=>{const outside=day.getMonth()!==month.getMonth();const today=sameDay(day,new Date());const active=sameDay(day,selected);return <button type="button" key={day.toISOString()} className={`${outside?'outside ':''}${today?'today ':''}${active?'selected':''}`} onClick={()=>selectDay(day)}>{day.getDate()}</button>})}</div>
      <footer><button type="button" className="date-today" onClick={chooseToday}>{zh?'今天':'Today'}</button><div className="date-time-clock"><select aria-label={zh?'小时':'Hour'} value={selected.getHours()} onChange={event=>setTime('hour',event.target.value)}>{Array.from({length:24},(_,hour)=><option key={hour} value={hour}>{pad(hour)}</option>)}</select><b>:</b><select aria-label={zh?'分钟':'Minute'} value={selected.getMinutes()} onChange={event=>setTime('minute',event.target.value)}>{Array.from({length:60},(_,minute)=><option key={minute} value={minute}>{pad(minute)}</option>)}</select></div></footer>
    </section>}
  </div>
}
