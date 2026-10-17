const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
import {DAYS,PERIODS,mins,weekForDate,meetingInWeek,weekday,timeAfter} from './core.mjs?v=27.1';
import {occurs as availabilityOccurs,extras,absence} from './schedule-tools.mjs?v=27.1';
export const plusDay=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
export const monday=date=>plusDay(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7));
export const occurs=(d,date,state)=>!d.cancelled&&date>=d.date&&date<=(d.until||d.date)&&(d.repeat!=='weekly'?date===d.date:new Date(date+'T12:00:00Z').getUTCDay()===new Date(d.date+'T12:00:00Z').getUTCDay()&&(!d.week||d.week==='both'||d.week===weekForDate(state,date)));
export const tone=x=>x.kind==='bus'?'bus':x.type==='Booster Session'?'booster':x.type==='Exam'||x.exam?'exam':x.removed||x.kind==='schedule'||x.kind==='isolation'||x.kind==='availability'?'out':x.kind==='duty'?'duty':['break','lunch'].includes(x.id)?'break':'lesson';
export const legend=()=>'<div class="calendar-legend">'+[['lesson','Lesson'],['out','Out of lesson'],['booster','Booster'],['exam','Exam'],['bus','Late bus'],['duty','Staff duty']].map(([k,t])=>'<span><i class="tone-'+k+'"></i>'+t+'</span>').join('')+'</div>';
const formatTime=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
export function overlayLessons(base,extra){
 let rows=base.map(x=>({...x,end:x.end||formatTime(mins(x.start)+30)}));
 for(const e of extra.filter(x=>x.kind!=='bus')){
  rows=rows.flatMap(x=>{const a=mins(x.start),b=mins(x.end),c=mins(e.start),d=mins(e.end);if(d<=a||c>=b)return[x];return [...(a<c?[{...x,end:formatTime(c)}]:[]),...(b>d?[{...x,start:formatTime(d)}]:[])]});
 }
 return [...rows,...extra].sort((a,b)=>a.start.localeCompare(b.start));
}
export function eventRows(items,date,state,studentId=''){
 return items.filter(x=>occurs(x.data,date,state)&&(!studentId||x.data.studentId===studentId||!x.data.studentId)).map(x=>({...x.data,kind:x.kind,subject:x.kind==='isolation'?'Scheduled time out of lesson':x.data.title||x.data.type||x.data.name||'Scheduled event',room:state.rooms?.find(r=>r.id===x.data.roomId)?.name||x.data.location||'',teacher:state.teachers?.find(t=>t.id===x.data.staffId)?.name||'',removed:x.kind==='isolation'||x.kind==='schedule'&&!['Exam','Booster Session'].includes(x.data.type)}));
}
export function examRows(s,date,classIds=null){
 return (s.exams||[]).filter(e=>e.date===date&&!e.cancelled&&(!classIds||classIds.includes(e.classId))).map(e=>({kind:'exam',exam:true,subject:e.paper||'Exam',start:e.start,end:timeAfter(e.start,Number(e.duration)||60),room:s.rooms?.find(r=>r.id===e.roomId)?.name||'',className:s.classes?.find(c=>c.id===e.classId)?.name||'',classId:e.classId}));
}
export function availabilityRows(s,type,id,date){
 return (s.availability||[]).filter(a=>a.personType===type&&a.personId===id).flatMap(a=>PERIODS.filter(p=>p.id>0&&availabilityOccurs(a,date,p.id,s)).map(p=>({...p,kind:'availability',removed:true,subject:type==='student'?'Scheduled time out of lesson':a.reason||'Unavailable',className:'Scheduled arrangement'})));
}
export function studentDay(s,student,date,extra=[]){
 const day=weekday(date),ids=student.classIds||s.classes.map(c=>c.id);
 const base=day>4?[]:PERIODS.map(p=>{
  if(p.id===0)return {...p,subject:s.tutors?.find(t=>t.id===student.tutorId)?.name||'Tutor time',room:'Tutor base'};
  if(typeof p.id!=='number')return {...p,subject:p.name};
  const c=s.classes.find(c=>ids.includes(c.id)&&(c.meetings||[]).some(m=>m.day===day&&m.period===p.id&&meetingInWeek(m,s,date))),m=c?.meetings.find(m=>m.day===day&&m.period===p.id&&meetingInWeek(m,s,date)),cover=s.covers?.find(v=>v.date===date&&v.classId===c?.id&&Number(v.period)===p.id);
  return {...p,classId:c?.id,subject:c?.subject||'Independent study',className:c?.name,room:s.rooms?.find(r=>r.id===m?.roomId)?.name||'',teacher:s.teachers?.find(t=>t.id===(cover?.teacherId||c?.teacherId))?.name||'',cover:!!cover,locked:!!m?.locked,changedAt:cover?.changedAt||m?.changedAt,teacherOut:absence(s,'teacher',cover?.teacherId||c?.teacherId,date,p.id)};
 });
 const removals=(s.removals||[]).filter(r=>r.date===date&&(!r.studentId||r.studentId===student.id)).flatMap(r=>PERIODS.filter(p=>r.periods?.includes(p.id)).map(p=>({...p,kind:'schedule',subject:'Scheduled time out of lesson',removed:true})));
 const scheduled=eventRows((s.schoolLife||[]).filter(x=>['schedule','isolation','bus'].includes(x.kind)),date,s,student.id);
 const other=[...availabilityRows(s,'student',student.id,date),...removals,...scheduled,...examRows(s,date,ids),...extra];
 // Explicit arrangements provide the title in preference to a generic availability marker.
 const clean=other.filter((e,i)=>!(e.kind==='availability'&&other.some((x,j)=>j!==i&&['schedule','isolation'].includes(x.kind)&&x.start<=e.start&&x.end>=e.end)));
 return overlayLessons(base,clean).concat(extras(s,student.id,date).map(x=>({...x,end:timeAfter(x.start,Number.parseInt(x.className)||30)}))).sort((a,b)=>a.start.localeCompare(b.start));
}
export function layoutDay(events){
 const sorted=events.filter(e=>Number.isFinite(mins(e.start))).map(x=>({...x,_start:mins(x.start),_end:Math.max(mins(x.start)+1,mins(x.end||formatTime(mins(x.start)+30)))})).sort((a,b)=>a._start-b._start||a._end-b._end);
 let group=[],finish=-1;const groups=[];
 for(const e of sorted){if(e._start>=finish){if(group.length)groups.push(group);group=[];finish=-1}group.push(e);finish=Math.max(finish,e._end)}if(group.length)groups.push(group);
 for(const g of groups){const lanes=[];for(const e of g){let n=lanes.findIndex(end=>end<=e._start);if(n<0)n=lanes.length;lanes[n]=e._end;e._lane=n}g.forEach(e=>e._width=lanes.length);}
 return sorted;
}
function agendaHTML(days,date){return '<div class="cal-agenda">'+days.map((events,i)=>'<section><h3>'+DAYS[i]+' '+esc(plusDay(date,i))+'</h3>'+(events.length?'<table><thead><tr><th>Time</th><th>Event</th><th>Room / staff</th></tr></thead><tbody>'+events.map(e=>'<tr><td>'+esc(e.start)+'–'+esc(e.end||'')+'</td><td>'+esc(e.subject||e.type||'Event')+(e.cover?' (cover)':'')+'</td><td>'+esc([e.room,e.teacher].filter(Boolean).join(' · ')||'To be confirmed')+'</td></tr>').join('')+'</tbody></table>':'<p>No events.</p>')+'</section>').join('')+'</div>'}
function gridHTML(days,date,spacious=false){
 const laid=days.map(layoutDay),all=laid.flat(),start=Math.min(480,...all.map(e=>Math.floor(e._start/60)*60)),end=Math.max(1020,...all.map(e=>Math.ceil(e._end/60)*60));
 const bounds=[...new Set([start,end,...all.flatMap(e=>[e._start,e._end]),...Array.from({length:Math.ceil((end-start)/60)+1},(_,i)=>start+i*60)])].sort((a,b)=>a-b),positions=[0];
 for(let i=1;i<bounds.length;i++)positions[i]=positions[i-1]+Math.max(spacious?95:70,(bounds[i]-bounds[i-1])*(spacious?2.8:2));
 const y=t=>{let i=bounds.findIndex(b=>b>=t);if(i<=0)return 0;return positions[i-1]+(t-bounds[i-1])/(bounds[i]-bounds[i-1])*(positions[i]-positions[i-1]);};
 const widths=laid.map(es=>Math.max(210,...es.map(e=>e._width*175))),columns='66px '+widths.map(w=>w+'px').join(' '),total=66+widths.reduce((a,b)=>a+b,0);
 const ticks=bounds.filter(b=>b%60===0);
 return '<div class="calendar-scroll" tabindex="0" aria-label="Weekly timetable. Scroll down for later events or sideways for other days."><div class="school-calendar" style="width:'+total+'px;--cal-columns:'+columns+'"><div class="cal-heading"><span>Time</span>'+DAYS.map((d,i)=>'<strong>'+d+' <small>'+esc(plusDay(date,i).slice(5))+'</small></strong>').join('')+'</div><div class="cal-body" style="height:'+positions.at(-1)+'px"><div class="cal-times">'+ticks.map(t=>'<span style="top:'+y(t)+'px">'+formatTime(t)+'</span>').join('')+'</div>'+laid.map((es,i)=>'<div class="cal-day" aria-label="'+DAYS[i]+'">'+ticks.map(t=>'<i class="cal-line" style="top:'+y(t)+'px"></i>').join('')+es.map(e=>{
 const title=e.subject||e.type||e.name||'Event',recent=e.changedAt&&Date.now()-Date.parse(e.changedAt)<14*86400000;
 const details={title,date:plusDay(date,i),start:e.start,end:e.end,room:e.room||'Room to be confirmed',teacher:e.teacher||'',detail:e.className||e.location||'',cover:!!e.cover,locked:!!e.locked};
 return '<button type="button" class="cal-event tone-'+tone(e)+'" style="top:'+y(e._start)+'px;height:'+(y(e._end)-y(e._start)-5)+'px;left:calc('+e._lane/e._width*100+'% + 3px);width:calc('+100/e._width+'% - 6px)" data-calendar-event="'+esc(JSON.stringify(details))+'"><time>'+esc(e.start)+'–'+esc(e.end||'')+'</time><strong>'+esc(title)+'</strong><small>'+esc([e.room,e.teacher,e.cover?'Cover teacher':'',recent?'Updated':'',e.locked?'Locked':''].filter(Boolean).join(' · '))+'</small></button>';
 }).join('')+'</div>').join('')+'</div></div></div>';
}
export function weekCalendar(days,startDate,opts={}){
 const payload=esc(JSON.stringify({days,startDate}));
 return '<section class="calendar-widget" data-calendar="'+payload+'"><div class="cal-tools"><button type="button" data-cal-view="week" aria-pressed="true">Week view</button><button type="button" data-cal-view="agenda" aria-pressed="false">Agenda</button><label>Spacing <select data-cal-spacing><option value="normal">Comfortable</option><option value="large">Extra space</option></select></label><button type="button" data-cal-print>Print timetable</button><button type="button" data-cal-export>Save calendar file</button></div><p class="cal-scroll-hint">Scroll down for the whole day. Events at the same time appear side by side. Select an event for details.</p><div class="cal-view">'+gridHTML(days,startDate)+'</div></section>';
}
export function bindCalendar(root=document){
 root.querySelectorAll('[data-calendar]').forEach(widget=>{
  if(widget.dataset.bound)return;widget.dataset.bound='1';
  const {days,startDate}=JSON.parse(widget.dataset.calendar);let mode='week';
  const draw=()=>{widget.querySelector('.cal-view').innerHTML=mode==='agenda'?agendaHTML(days,startDate):gridHTML(days,startDate,widget.querySelector('[data-cal-spacing]').value==='large');bindEvents(widget);widget.querySelectorAll('[data-cal-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.calView===mode)));};
  widget.querySelectorAll('[data-cal-view]').forEach(b=>b.onclick=()=>{mode=b.dataset.calView;draw()});
  widget.querySelector('[data-cal-spacing]').onchange=draw;
  widget.querySelector('[data-cal-print]').onclick=()=>{const win=window.open('','_blank');if(!win)return;win.document.write('<!doctype html><html><head><title>School timetable</title><style>body{font:12pt Arial;margin:22px;color:#173b2b}h1{font-size:22pt}h3{margin:22px 0 10px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #bbb;text-align:left}tr{break-inside:avoid}th{background:#eef5ee}button{padding:12px}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print / save PDF</button><h1>Timetable</h1><p>Week beginning '+esc(startDate)+'</p>'+agendaHTML(days,startDate)+'</body></html>');win.document.close();};
  widget.querySelector('[data-cal-export]').onclick=()=>{const escape=t=>String(t||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//OneEducate//Timetable//EN'];days.forEach((es,i)=>es.forEach((e,j)=>lines.push('BEGIN:VEVENT','UID:'+startDate+'-'+i+'-'+j+'@oneeducate','DTSTAMP:'+stamp,'DTSTART:'+plusDay(startDate,i).replaceAll('-','')+'T'+e.start.replace(':','')+'00','DTEND:'+plusDay(startDate,i).replaceAll('-','')+'T'+(e.end||formatTime(mins(e.start)+30)).replace(':','')+'00','SUMMARY:'+escape(e.subject||e.type),'LOCATION:'+escape(e.room),'DESCRIPTION:'+escape([e.teacher,e.className].filter(Boolean).join(' / ')),'END:VEVENT')));lines.push('END:VCALENDAR');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([lines.join('\r\n')+'\r\n'],{type:'text/calendar'}));a.download='school-week-'+startDate+'.ics';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
  bindEvents(widget);
 });
}
function bindEvents(root){root.querySelectorAll('[data-calendar-event]').forEach(b=>b.onclick=()=>{const e=JSON.parse(b.dataset.calendarEvent),d=document.createElement('dialog');d.className='life-dialog';d.innerHTML='<form method="dialog"><button class="close" aria-label="Close">×</button></form><h2>'+esc(e.title)+'</h2><p>'+esc(e.date)+' · '+esc(e.start)+'–'+esc(e.end)+'</p><p>'+esc(e.room)+'</p><p>'+esc(e.teacher)+'</p><p>'+esc(e.detail)+'</p>'+(e.cover?'<p>Cover teacher assigned.</p>':'')+(e.locked?'<p>This lesson stays in place during generation.</p>':'');document.body.append(d);d.onclose=()=>d.remove();d.showModal()})}
export function staffCalendar(s,week,date,kind,id){
 const start=monday(date);
 const days=DAYS.map((_,day)=>{
  const date=plusDay(start,day);
  if(kind==='student'&&id){const p=s.students.find(p=>p.id===id);return p?studentDay(s,p,date):[];}
  const lessons=s.classes.flatMap(c=>(c.meetings||[]).filter(m=>(!m.week||m.week===week)&&m.day===day).map(m=>{
   const cover=s.covers?.find(v=>v.date===date&&v.classId===c.id&&Number(v.period)===m.period),teacherId=cover?.teacherId||c.teacherId;
   return {...PERIODS.find(p=>p.id===m.period),subject:c.subject,classId:c.id,className:c.name,roomId:m.roomId,teacherId,room:s.rooms.find(r=>r.id===m.roomId)?.name||'',teacher:s.teachers.find(t=>t.id===teacherId)?.name||'',cover:!!cover,locked:m.locked,changedAt:cover?.changedAt||m.changedAt};
  })).filter(e=>!id||kind==='all'||kind==='teacher'&&e.teacherId===id||kind==='room'&&e.roomId===id||kind==='class'&&e.classId===id);
  const selected=(s.schoolLife||[]).filter(x=>kind==='teacher'&&id?x.kind==='duty'&&x.data.staffId===id:kind==='room'&&id?x.data.roomId===id:kind==='class'&&id?x.data.classId===id:true);
  const exams=(s.exams||[]).filter(e=>!id||kind==='all'||kind==='room'&&e.roomId===id||kind==='class'&&e.classId===id||kind==='teacher'&&(e.teacherId===id||e.invigilatorIds?.includes(id)));
  const extra=eventRows(selected,date,s);
  return [...lessons,...extra,...examRows({...s,exams},date),...(kind==='teacher'&&id?availabilityRows(s,'teacher',id,date):[])];
 });
 return weekCalendar(days,start)+legend();
}


