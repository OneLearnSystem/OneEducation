import {csvParse,uid,makeCode,candidate,today} from './core.mjs?v=27.1';
import {checkTimetable,settings} from './manage-core.mjs?v=27.1';
const norm=s=>String(s||'').trim().toLowerCase();
export const fields={students:{id:'Student ID',first:'First name',last:'Last name',fullName:'Student name',year:'Year',tutor:'Tutor',classes:'Classes',parentEmail:'Parent email'},staff:{fullName:'Full name',title:'Title',surname:'Display surname',email:'Email',department:'Department',role:'Role'}};
const aliases={id:['studentid'],first:['firstname','first'],last:['lastname','surname','last'],fullName:['studentname','fullname','teacherfullname','name'],year:['year','yeargroup'],tutor:['tutor','tutorgroup'],classes:['classes','class'],parentEmail:['parentemail','parentguardianemail'],title:['title','teachertitle'],surname:['displaysurname','teachersurname','surname'],email:['email','teacheremail','staffemail'],department:['department'],role:['role']};
export function readCSV(text,kind){const rows=csvParse(text.replace(/^\uFEFF/,''));if(rows.length<2)throw Error('Include a header and at least one data row.');const headers=rows.shift();if(headers.length>30||rows.length>500)throw Error('Use no more than 30 columns and 500 rows.');return {headers,rows:rows.filter(r=>r.some(x=>String(x).trim())),mapping:Object.fromEntries(Object.keys(fields[kind]).map(k=>[k,headers.findIndex(h=>aliases[k].includes(norm(h).replace(/[^a-z0-9]/g,'')))]))}}
export const mappedRows=(csv,mapping)=>csv.rows.map(row=>Object.fromEntries(Object.entries(mapping).map(([k,i])=>[k,i<0?'':String(row[i]||'').trim()])));
function validateGroups(d){
for(const t of d.tutors){const members=d.students.filter(p=>!p.archived&&p.tutorId===t.id);if(members.length>Number(t.capacity))throw Error(t.name+': tutor capacity exceeded.');if(members.some(p=>Number(p.year)!==Number(t.year)))throw Error(t.name+': tutor year does not match.')}
for(const p of d.students.filter(p=>!p.archived))for(const id of p.classIds||[]){const c=d.classes.find(c=>c.id===id);if(!c||Number(c.year)!==Number(p.year))throw Error(p.first+' '+p.last+': invalid class or year.')}
const errors=checkTimetable(d);if(errors.length)throw Error(errors[0]);
}
export function previewStudents(state,rows,{mode='skip',defaultTutor='',defaultYear=7}={}){
if(!settings(state).massImport)throw Error('Enable mass import in Administration → School policies.');
const data=structuredClone(state),changes=[],seen=new Set(),used=new Set(data.students.map(p=>p.candidateNumber));
for(const [index,r] of rows.entries()){try{
let first=r.first,last=r.last;if(!first&&!last&&r.fullName){const parts=r.fullName.trim().split(/\s+/);first=parts.shift();last=parts.join(' ')}
const year=Number(r.year||defaultYear);
if(!first||!last||first.length>80||last.length>120||!Number.isInteger(year)||year<7||year>11)throw Error('Enter first/last names and Year 7–11.');
if(r.parentEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.parentEmail))throw Error('Invalid parent email.');
const key=r.id||norm(first+' '+last)+'|'+year;if(seen.has(key))throw Error('Duplicate student in this CSV.');seen.add(key);
const matches=data.students.filter(p=>!p.archived&&(r.id?p.id===r.id:Number(p.year)===year&&norm(p.first+' '+p.last)===norm(first+' '+last)));
if(matches.length>1)throw Error('Ambiguous name; use Student ID.');if(r.id&&!matches.length)throw Error('Student ID not found.');
const p=matches[0];if(p&&mode==='skip'){changes.push({name:first+' '+last,status:'Skipped existing student'});continue}
const tutors=r.tutor?data.tutors.filter(t=>Number(t.year)===year&&norm(t.name)===norm(r.tutor)):defaultTutor?data.tutors.filter(t=>t.id===defaultTutor&&Number(t.year)===year):[];
if((r.tutor||defaultTutor)&&tutors.length!==1)throw Error('Tutor group missing or ambiguous for this year. Create it first.');
const classIds=r.classes?r.classes.split(',').map(name=>{const cs=data.classes.filter(c=>Number(c.year)===year&&norm(c.name)===norm(name));if(cs.length!==1)throw Error('Class "'+name.trim()+'" is missing or ambiguous for Year '+year);return cs[0].id}):p?.classIds||[];
const next={...(p||{id:uid(),loginCode:makeCode(),candidateNumber:candidate(used),house:'',set:'',joined:today(),archived:false}),first,last,year,tutorId:tutors[0]?.id||p?.tutorId||'',classIds:[...new Set(classIds)],parentEmail:r.parentEmail||p?.parentEmail||''};
used.add(next.candidateNumber);if(p)data.students[data.students.indexOf(p)]=next;else data.students.push(next);
changes.push({name:first+' '+last,status:p?'Updated (login retained)':'Added',year,tutor:data.tutors.find(t=>t.id===next.tutorId)?.name||'Unassigned'});
}catch(e){throw Error('Row '+(index+2)+': '+e.message)}}
validateGroups(data);return {data,changes};
}
export function previewStaff(state,rows){
if(rows.length>200)throw Error('Import at most 200 staff at a time.');const seen=new Set();
return rows.map((r,i)=>{const email=norm(r.email),title=r.title||'',surname=r.surname||r.fullName.trim().split(/\s+/).at(-1),name=[title,surname].filter(Boolean).join(' ');
if(!r.fullName||r.fullName.length<2||!surname||!['','Mr','Mrs','Ms','Miss','Mx','Dr'].includes(title)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Row '+(i+2)+': check full name, title and email.');
if(seen.has(email))throw Error('Duplicate staff email: '+email);seen.add(email);
return {...r,email,title,name,role:r.role||'teacher',status:state.teachers.some(t=>norm(t.email)===email)?'Skip existing profile':'Add profile + invitation'}});
}
export function moveStudents(state,ids,{tutorId,classId,fromClass,mode='tutor'}){
if(!ids.length)throw Error('Select students first.');const data=structuredClone(state),target=mode==='tutor'?data.tutors.find(t=>t.id===tutorId):data.classes.find(c=>c.id===classId);if(!target)throw Error('Choose a destination.');
for(const id of ids){const p=data.students.find(p=>p.id===id&&!p.archived);if(!p||Number(p.year)!==Number(target.year))throw Error('All selected students must be current and in the destination year.');
if(mode==='tutor')p.tutorId=target.id;else if(mode==='remove')p.classIds=p.classIds.filter(id=>id!==target.id);
else {if(mode==='move'&&(!fromClass||fromClass===target.id||!p.classIds.includes(fromClass)))throw Error('Every selected student must belong to the source class.');p.classIds=[...new Set([...p.classIds.filter(id=>mode!=='move'||id!==fromClass),target.id])]}}
validateGroups(data);return data;
}
