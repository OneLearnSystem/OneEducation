import {esc} from './shared.mjs';
import {DAYS,PERIODS,mins,weekForDate,timetable} from './core.mjs';
export const plusDay=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
export const monday=date=>plusDay(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7));
export const occurs=(d,date,state)=>!d.cancelled&&date>=d.date&&date<=(d.until||d.date)&&(d.repeat!=='weekly'?date===d.date:new Date(date+'T12:00:00Z').getUTCDay()===new Date(d.date+'T12:00:00Z').getUTCDay()&&(!d.week||d.week==='both'||d.week===weekForDate(state,date)));
export const tone=x=>x.kind==='bus'?'bus':x.type==='Booster Session'?'booster':x.type==='Exam'||x.exam?'exam':x.removed||x.kind==='schedule'||x.kind==='isolation'?'out':x.kind==='duty'?'duty':typeof x.id==='string'&&['break','lunch'].includes(x.id)?'break':'lesson';
export const legend=()=>'<div class="calendar-legend">'+[['lesson','Lesson'],['out','Out of lesson'],['booster','Booster'],['exam','Exam'],['bus','Late bus'],['duty','Staff duty']].map(([k,t])=>'<span><i class="tone-'+k+'"></i>'+t+'</span>').join('')+'</div>';
export function overlayLessons(base,extras){
 let rows=base.map(x=>({...x,end:x.end||formatTime(mins(x.start)+30)}));
 for(const e of extras.filter(x=>x.kind!=='bus')){
 rows=rows.flatMap(x=>{const a=mins(x.start),b=mins(x.end),c=mins(e.start),d=mins(e.end);if(d<=a||c>=b)return[x];return [...(a<c?[{...x,end:formatTime(c)}]:[]),...(b>d?[{...x,start:formatTime(d)}]:[])]});
 }
 return [...rows,...extras].sort((a,b)=>a.start.localeCompare(b.start));
}
const formatTime=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
export function eventRows(items,date,state,studentId=''){
 return items.filter(x=>occurs(x.data,date,state)&&(!studentId||x.data.studentId===studentId||!x.data.studentId)).map(x=>({...x.data,kind:x.kind,subject:x.data.title||x.data.type||x.data.name||'Scheduled event',room:state.rooms?.find(r=>r.id===x.data.roomId)?.name||'',teacher:state.teachers?.find(t=>t.id===x.data.staffId)?.name||'',removed:x.kind==='isolation'||x.kind==='schedule'&&!['Exam','Booster Session'].includes(x.data.type)}));
}
export function weekCalendar(days,startDate,{compact=false}={}){
 const all=days.flat(),start=Math.min(480,...all.map(e=>Math.floor(mins(e.start)/60)*60)),end=Math.max(1020,...all.map(e=>Math.ceil(mins(e.end||formatTime(mins(e.start)+30))/60)*60)),scale=compact?1:1.12,height=(end-start)*scale;
 const ticks=Array.from({length:Math.ceil((end-start)/60)+1},(_,i)=>start+i*60);
 return '<div class="calendar-scroll" tabindex="0" aria-label="Weekly timetable, scroll horizontally on smaller screens"><div class="school-calendar"><div class="cal-heading"><span>Time</span>'+DAYS.map((d,i)=>'<strong>'+d.slice(0,3)+' <small>'+esc(plusDay(startDate,i).slice(8))+'</small></strong>').join('')+'</div><div class="cal-body" style="height:'+height+'px"><div class="cal-times">'+ticks.map(t=>'<span style="top:'+((t-start)*scale)+'px">'+formatTime(t)+'</span>').join('')+'</div>'+days.map((events,i)=>{
 const sorted=events.map(x=>({...x,_start:mins(x.start),_end:mins(x.end||formatTime(mins(x.start)+30))})).sort((a,b)=>a._start-b._start||a._end-b._end),lanes=[];
 for(const e of sorted){let n=lanes.findIndex(end=>end<=e._start);if(n<0)n=lanes.length;lanes[n]=e._end;e._lane=n;}
 let group=[],finish=-1;const groups=[];for(const e of sorted){if(e._start>=finish){if(group.length)groups.push(group);group=[];finish=-1}group.push(e);finish=Math.max(finish,e._end)}if(group.length)groups.push(group);
 for(const g of groups){const count=Math.max(...g.map(x=>x._lane))+1;g.forEach(x=>x._width=count)}
 return '<div class="cal-day" aria-label="'+DAYS[i]+'">'+ticks.map(t=>'<i class="cal-line" style="top:'+((t-start)*scale)+'px"></i>').join('')+sorted.map(e=>{
 const title=e.removed&&!e.kind?'Out of lesson · '+(e.subject||''):(e.subject||e.name||e.type);
 return '<button type="button" class="cal-event tone-'+tone(e)+'" style="top:'+((e._start-start)*scale)+'px;height:'+Math.max(18,(e._end-e._start)*scale-3)+'px;left:calc('+e._lane/e._width*100+'% + 2px);width:calc('+100/e._width+'% - 4px)" data-calendar-event="'+esc(JSON.stringify({title,date:plusDay(startDate,i),start:e.start,end:e.end,room:e.room||'Room to be confirmed',teacher:e.teacher||'',detail:e.className||e.location||''}))+'"><time>'+esc(e.start)+'–'+esc(e.end||'')+'</time><strong>'+esc(title)+'</strong><small>'+esc([e.room,e.teacher].filter(Boolean).join(' · '))+'</small></button>';
 }).join('')+'</div>';
 }).join('')+'</div></div></div>';
}
export function bindCalendar(root=document){
 root.querySelectorAll('[data-calendar-event]').forEach(b=>b.onclick=()=>{const e=JSON.parse(b.dataset.calendarEvent);const d=document.createElement('dialog');d.className='life-dialog';d.innerHTML='<form method="dialog"><button class="close" aria-label="Close">×</button></form><h2>'+esc(e.title)+'</h2><p>'+esc(e.date)+' · '+esc(e.start)+'–'+esc(e.end)+'</p><p>'+esc(e.room)+'</p>'+(e.teacher?'<p>'+esc(e.teacher)+'</p>':'')+'<p>'+esc(e.detail)+'</p>';document.body.append(d);d.onclose=()=>d.remove();d.showModal()});
}
export function staffCalendar(s,week,date,kind,id){
 const start=monday(date),classes=s.classes.filter(c=>!id||kind==='all'||kind==='teacher'&&c.teacherId===id||kind==='student'&&s.students.find(p=>p.id===id)?.classIds.includes(c.id)||kind==='room'&&c.meetings.some(m=>m.roomId===id));
 return weekCalendar(DAYS.map((_,day)=>{
 const date=plusDay(start,day),lessons=classes.flatMap(c=>(c.meetings||[]).filter(m=>(!m.week||m.week===week)&&m.day===day&&(!(kind==='room'&&id)||m.roomId===id)).map(m=>({...PERIODS.find(p=>p.id===m.period),subject:c.subject,className:c.name,room:s.rooms.find(r=>r.id===m.roomId)?.name||'',teacher:s.teachers.find(t=>t.id===c.teacherId)?.name||''})));
 const extra=eventRows((s.schoolLife||[]).filter(x=>kind==='teacher'&&id?x.kind==='duty'&&x.data.staffId===id:kind==='student'&&id?['schedule','isolation','bus'].includes(x.kind)&&x.data.studentId===id:kind==='room'&&id?x.data.roomId===id:true),date,s);
 return kind==='student'&&id?overlayLessons(timetable(s,s.students.find(p=>p.id===id),date),extra):[...lessons,...extra];
 }),start)+legend();
}
