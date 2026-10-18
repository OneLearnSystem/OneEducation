import {patternBlocked} from './schedule-tools.mjs?v=27.3';
import {PERIODS,weekForDate,teacherBusy,uid,weekday,meetingInWeek} from './core.mjs?v=27.3';
import {absence} from './schedule-tools.mjs?v=27.3';
const weeks=['A','B'],label=(w,n)=>'Week '+w+' '+['Monday','Tuesday','Wednesday','Thursday','Friday'][Math.floor(n/5)]+' lesson '+(n%5+1);
const active=s=>(s.students||[]).filter(p=>!p.archived);
export function expanded(c){return (c.meetings||[]).flatMap(m=>m.week?[{...m}]:weeks.map(week=>({...m,week})))}
export function analyse(s){
 const issues=[],warnings=[],cs=s.classes||[],people=active(s);
 for(const c of cs){
  const n=Number(c.lessonsPerWeek??2),enrolled=people.filter(p=>p.classIds?.includes(c.id)).length;
  if(!Number.isInteger(n)||n<1||n>25)issues.push(c.name+': choose 1–25 whole lessons per week.');
  if(enrolled>Number(c.capacity))issues.push(c.name+': '+enrolled+' students exceed capacity '+c.capacity+'.');
  if(c.teacherId&&!(s.teachers||[]).some(t=>t.id===c.teacherId&&t.name&&t.email))issues.push(c.name+': assigned teacher needs a name and email.');
  if(c.roomId&&!(s.rooms||[]).some(r=>r.id===c.roomId&&r.teaching&&Number(r.capacity)>=enrolled&&(!c.roomType||r.type===c.roomType)))issues.push(c.name+': fixed room is missing, too small or the wrong type.');
  for(const w of weeks){const slots=Array.from({length:25},(_,i)=>i).filter(i=>!patternBlocked(s,c,w,Math.floor(i/5),i%5+1)),locks=expanded(c).filter(m=>m.week===w&&m.locked);
   if(slots.length<n)issues.push(c.name+': needs '+n+' lessons in Week '+w+' but only '+slots.length+' slots are available.');
   if(locks.length>n)issues.push(c.name+': '+locks.length+' locked lessons exceed its weekly count of '+n+' in Week '+w+'.');
   for(const m of locks)if(patternBlocked(s,c,w,m.day,m.period))issues.push(c.name+': locked '+label(w,m.day*5+m.period-1)+' conflicts with availability or a duty.');
  }
 }
 for(const [title,groups] of [['Teacher',(s.teachers||[]).map(t=>({name:t.name,classes:cs.filter(c=>c.teacherId===t.id)}))],['Student',people.map(p=>({name:p.first+' '+p.last,classes:cs.filter(c=>p.classIds?.includes(c.id))}))]]){
  for(const g of groups){const total=g.classes.reduce((n,c)=>n+Number(c.lessonsPerWeek??2),0);if(total>25)issues.push(title+' '+g.name+': '+total+' lessons need to fit into 25 weekly slots. Review '+g.classes.map(c=>c.name).join(', ')+'.');}
 }
 if(cs.some(c=>!c.teacherId))warnings.push(cs.filter(c=>!c.teacherId).length+' classes have no teacher assigned.');
 if(!(s.rooms||[]).some(r=>r.teaching))warnings.push('No teaching rooms are available. Unfixed lessons can be generated with rooms to be confirmed.');
 return {issues:[...new Set(issues)],warnings};
}
export function generateDraft(s,{milliseconds=10000,maxNodes=250000}={}){
 if(!s.school?.options?.autoTimetables)throw Error('Enable automatic timetable generation in School policies first.');
 if(!s.classes?.length)throw Error('Create classes first.');
 const report=analyse(s);if(report.issues.length)throw Error(report.issues.slice(0,12).join('\n'));
 const d=structuredClone(s),cs=d.classes,people=active(d),index=new Map(cs.map((c,i)=>[c.id,i])),conflicts=cs.map(()=>new Set());
 const connect=ids=>{for(const a of ids)for(const b of ids)if(a!==b)conflicts[a].add(b)};
 for(const t of d.teachers||[])connect(cs.map((c,i)=>c.teacherId===t.id?i:-1).filter(i=>i>=0));
 for(const p of people)connect((p.classIds||[]).map(id=>index.get(id)).filter(i=>i!==undefined));
 const old=cs.map(c=>expanded(c)),enrolment=cs.map(c=>people.filter(p=>p.classIds?.includes(c.id)).length);
 const eligible=cs.map((c,i)=>(d.rooms||[]).filter(r=>r.teaching&&Number(r.capacity)>=enrolment[i]&&(!c.roomType||r.type===c.roomType)&&(!c.roomId||r.id===c.roomId)));
 cs.forEach(c=>c.meetings=[]);
 for(const week of weeks){
  const deadline=Date.now()+milliseconds,occupied=Array.from({length:25},()=>[]),remaining=cs.map(c=>Number(c.lessonsPerWeek??2)),placed=cs.map(()=>[]),locked=cs.map(()=>new Map());
  const available=cs.map(c=>Array.from({length:25},(_,i)=>i).filter(i=>!patternBlocked(d,c,week,Math.floor(i/5),i%5+1)));
  for(let i=0;i<cs.length;i++)for(const m of old[i].filter(m=>m.week===week&&m.locked)){
   const slot=m.day*5+m.period-1;if(!Number.isInteger(slot)||m.day<0||m.day>4||m.period<1||m.period>5)throw Error(cs[i].name+': invalid locked lesson.');
   if(occupied[slot].some(j=>j===i||conflicts[i].has(j)||(m.roomId&&locked[j].get(slot)?.roomId===m.roomId)||(m.roomId&&cs[j].roomId===m.roomId)))throw Error('Locked lesson clash: '+cs[i].name+' at '+label(week,slot)+'. Unlock or move one of the conflicting lessons.');
   if(m.roomId&&!eligible[i].some(r=>r.id===m.roomId))throw Error(cs[i].name+': locked lesson has an unsuitable room.');
   occupied[slot].push(i);placed[i].push(slot);locked[i].set(slot,m);remaining[i]--;
  }
  let nodes=0,timedOut=false;
  const choices=i=>available[i].filter(slot=>!occupied[slot].some(j=>j===i||conflicts[i].has(j)||(cs[i].roomId&&(cs[j].roomId===cs[i].roomId||locked[j].get(slot)?.roomId===cs[i].roomId))));
  function solve(){
   if(++nodes>maxNodes||Date.now()>deadline){timedOut=true;return false;}
   let pick=-1,best=[],score=Infinity;
   for(let i=0;i<cs.length;i++)if(remaining[i]){
    const slots=choices(i);if(slots.length<remaining[i])return false;
    const rank=(slots.length-remaining[i])*1000-conflicts[i].size*2-remaining[i];
    if(rank<score){score=rank;pick=i;best=slots}
   }
   if(pick<0)return true;
   const i=pick;
   best.sort((a,b)=>{
    const daily=x=>placed[i].filter(y=>Math.floor(y/5)===Math.floor(x/5)).length;
    const existing=x=>old[i].some(m=>m.week===week&&m.day===Math.floor(x/5)&&m.period===x%5+1);
    return daily(a)-daily(b)||Number(existing(b))-Number(existing(a))||occupied[a].length-occupied[b].length||a-b;
   });
   for(const slot of best){occupied[slot].push(i);placed[i].push(slot);remaining[i]--;if(solve())return true;remaining[i]++;placed[i].pop();occupied[slot].pop();if(timedOut)return false;}
   return false;
  }
  if(!solve())throw Error(timedOut?'The search budget was reached for Week '+week+'. Your saved timetable is unchanged. Check diagnostics, lock a few established lessons, or try the extended search.':'These lesson counts, memberships and locked slots cannot fit Week '+week+'. Check diagnostics or unlock conflicting lessons. Your saved timetable is unchanged.');
  // Assign optional rooms after lesson slots, avoiding a room-choice explosion in the search.
  for(let slot=0;slot<25;slot++){
   const assigned=new Map(),fixed=new Set(),byClass=new Map();
   for(const i of occupied[slot]){const room=locked[i].get(slot)?.roomId||cs[i].roomId;if(room){if(assigned.has(room))throw Error('Fixed room clash at '+label(week,slot));assigned.set(room,i);fixed.add(i);byClass.set(i,room)}}
   const match=(i,seen)=>{for(const r of eligible[i]){if(seen.has(r.id))continue;seen.add(r.id);const prev=assigned.get(r.id);if(prev===undefined||!fixed.has(prev)&&match(prev,seen)){assigned.set(r.id,i);byClass.set(i,r.id);return true}}return false};
   for(const i of occupied[slot].filter(i=>!fixed.has(i)).sort((a,b)=>eligible[a].length-eligible[b].length))match(i,new Set());
   for(const i of occupied[slot])cs[i].meetings.push({...locked[i].get(slot),week,day:Math.floor(slot/5),period:slot%5+1,roomId:byClass.get(i)||'',locked:!!locked[i].get(slot)});
  }
 }
 return d;
}
const meetingKey=m=>[m.week,m.day,m.period,m.roomId||''].join(':');
export function draftChanges(before,after){
 return after.classes.map(c=>{const old=before.classes.find(x=>x.id===c.id),a=expanded(old||{}),b=expanded(c),added=b.filter(m=>!a.some(x=>meetingKey(x)===meetingKey(m))),removed=a.filter(m=>!b.some(x=>meetingKey(x)===meetingKey(m)));return {id:c.id,name:c.name,added,removed,kept:b.length-added.length}}).filter(x=>x.added.length||x.removed.length);
}
export function publishDraft(before,after){
 const d=structuredClone(after),stamp=new Date().toISOString();
 for(const c of d.classes){const old=expanded(before.classes.find(x=>x.id===c.id)||{});c.meetings=expanded(c).map(m=>{const same=old.find(x=>meetingKey(x)===meetingKey(m));return {...m,changedAt:same?.changedAt||(!same?stamp:undefined)}});}
 return d;
}
export function staffUnavailable(s,id,date,period){
 if(absence(s,'teacher',id,date,period))return true;
 const p=PERIODS.find(p=>p.id===Number(period));if(!p)return true;
 return (s.schoolLife||[]).some(x=>{const a=x.data;if(x.kind!=='duty'||a.cancelled||a.staffId!==id||a.start>=p.end||a.end<=p.start||date<a.date||date>(a.until||a.date))return false;return a.repeat==='weekly'?weekday(date)===weekday(a.date)&&(!a.week||a.week==='both'||a.week===weekForDate(s,date)):a.date===date;});
}
export function freeTeachers(s,date,period,classId=''){
 const c=s.classes.find(c=>c.id===classId);
 return s.teachers.filter(t=>t.id!==c?.teacherId&&t.name&&t.email&&!staffUnavailable(s,t.id,date,period)&&!teacherBusy(s,t.id,date,period,classId));
}
export function freeRooms(s,date,period,capacity=0,type=''){
 const p=PERIODS.find(p=>p.id===Number(period));if(!p||weekday(date)>4)return [];
 return s.rooms.filter(r=>r.teaching&&Number(r.capacity)>=capacity&&(!type||r.type===type)&&!s.classes.some(c=>(c.meetings||[]).some(m=>m.roomId===r.id&&m.day===weekday(date)&&m.period===Number(period)&&meetingInWeek(m,s,date)))&&!(s.exams||[]).some(e=>e.date===date&&e.roomId===r.id&&e.start<p.end&&minutes(e.start)+Number(e.duration)>minutes(p.start))&&!(s.schoolLife||[]).some(x=>{const a=x.data;return !a.cancelled&&a.roomId===r.id&&date>=a.date&&date<=(a.until||a.date)&&a.start<p.end&&a.end>p.start&&(a.repeat==='weekly'?weekday(date)===weekday(a.date)&&(!a.week||a.week==='both'||a.week===weekForDate(s,date)):date===a.date)}));
}
const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
export function assignCover(s,{classId,date,period,teacherId}){
 const c=s.classes.find(c=>c.id===classId);period=Number(period);
 if(!c?.meetings.some(m=>m.day===weekday(date)&&m.period===period&&meetingInWeek(m,s,date)))throw Error('Choose a class that meets in this date’s Week A/B cycle.');
 if(!freeTeachers(s,date,period,classId).some(t=>t.id===teacherId))throw Error('This teacher is unavailable, on duty, or already teaching at that time.');
 const d=structuredClone(s);d.covers=(d.covers||[]).filter(v=>!(v.classId===classId&&v.date===date&&Number(v.period)===period));d.covers.push({id:uid(),classId,date,period,teacherId,reason:'Cover arranged',changedAt:new Date().toISOString()});return d;
}

