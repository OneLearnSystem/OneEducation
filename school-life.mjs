import {central,slug,esc,download} from './shared.mjs?v=29.0';
import {rpc} from './api.mjs?v=29.0';
import {today,csvWrite} from './core.mjs?v=29.0';
import {icon} from './icons.mjs?v=29.0';
import {fields,readCSV,mappedRows,previewStudents,previewStaff,moveStudents} from './bulk-tools.mjs?v=29.0';
import {weekCalendar,eventRows,monday,plusDay,bindCalendar,legend} from './calendar.mjs?v=29.0';
export const life=(action='read',data={},id=null,revision=0)=>central('oe26_staff',{p_slug:slug,p_action:action,p_data:data,p_id:id,p_revision:revision});
export const busCall=(action='read',code=null,bus=null,student=null)=>central('oe26_bus',{p_slug:slug,p_action:action,p_code:code,p_bus:bus,p_student:student},code===null);
const opt=(items,fn=x=>x.name)=>items.map(x=>'<option value="'+esc(x.id)+'">'+esc(fn(x))+'</option>').join('');
const select=(name,label,values)=>'<label>'+label+'<select name="'+name+'">'+values.map(v=>'<option value="'+esc(Array.isArray(v)?v[0]:v)+'">'+esc(Array.isArray(v)?v[1]:v)+'</option>').join('')+'</select></label>';
const input=(name,label,type='text',value='',attrs='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+attrs+'></label>';
const full=p=>p.first+' '+p.last;
const table=(rows,keys)=>'<div class="csv-preview"><table><thead><tr>'+keys.map(k=>'<th>'+esc(k)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+keys.map(k=>'<td>'+esc(r[k]??'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
export function adminLinks(cap={}){
return '<div class="admin-launch">'+[
['school-life','settings','School-life settings','Duties, durations and scheduling options',cap.policies],
['school-life','people','Bulk imports & moves','Staff and student CSV tools',cap.pupils||cap.accounts],
['manage-policies','settings','School policies','Automation and Week A/B',cap.policies],
['manage-classes','book','Classes & tutor groups','Create groups and set capacities',cap.structure],
['manage-rooms','building','Rooms & buildings','Optional, strongly recommended',cap.structure],
['manage-houses','trophy','Houses & points','Rewards and school houses',cap.policies],
['staff-accounts','shield','Staff access','Account permissions and roles',cap.accounts],
['manage-sats','chart','SATs & sets','Review scores and set placement',cap.pupils]
].filter(x=>x[4]).map(([r,i,t,d])=>'<a href="#'+r+'">'+icon(i)+'<span><strong>'+t+'</strong><small>'+d+'</small></span></a>').join('')+'</div>';
}
export async function mountLife(route,ctx){
const host=document.getElementById('operations-area');if(!host)return;
if(ctx.isDemo()){host.innerHTML='<article class="card"><h1>School life</h1><p>These tools need a signed-in school account and the October SQL update. The student preview uses sample data.</p></article>';return}
host.innerHTML='<p>Loading school life…</p>';
try{const store=await life();if(!host.isConnected)return;let tab={'staff-duties':'duty',isolation:'isolation','late-bus':'bus','school-life':'imports'}[route]||'duty';
const cap=store.capabilities,s=ctx.getState(),can={duty:true,isolation:cap.isolation,schedule:cap.schedule,bus:cap.bus,imports:ctx.getCapabilities().pupils||ctx.getCapabilities().accounts,settings:cap.settings};
if(!can[tab])tab=Object.keys(can).find(k=>can[k]);
const tabs={duty:'Staff duties',isolation:'Isolation log',schedule:'Out of lessons',bus:'Late buses',imports:'Imports & moves',settings:'Options'};
const run=fn=>async e=>{e?.preventDefault();const b=e?.submitter||e?.currentTarget;if(b?.tagName==='BUTTON')b.disabled=true;try{await fn(e)}catch(err){const status=host.querySelector('.life-error');if(status)status.textContent=err.message;ctx.toast(err.message,'bad')}finally{if(b?.isConnected)b.disabled=false}};
const refresh=()=>ctx.reload();
const rooms=()=>'<label>Room — optional, strongly recommended<select name="roomId"><option value="">Room to be confirmed</option>'+opt(s.rooms)+'</select></label>';
const when=(repeat=true)=>input('date','Date','date',today(),'required')+input('start','Start time','time','08:40','required')+input('end','End time','time','09:40','required')+(repeat?select('repeat','Repeat',['once','weekly'])+input('until','Until (weekly only)','date',today())+select('week','Week cycle',[['both','Both weeks'],['A','Week A'],['B','Week B']]):'');
const people=()=>'<label>Student<select name="studentId">'+opt(s.students.filter(p=>!p.archived),p=>full(p)+' · Year '+p.year)+'</select></label>';
const saveForm=(kind,body)=>'<form id="life-add" class="card life-form">'+body+'<p class="life-error" role="status"></p><button class="btn primary">Save '+(kind==='bus'?'departure':kind)+'</button></form>';
function render(){
host.innerHTML='<div class="page-head"><div><p>ONE EDUCATE</p><h1>'+tabs[tab]+'</h1><span>School life, connected.</span></div></div><div class="life-tabs">'+Object.entries(tabs).filter(([k])=>can[k]).map(([k,t])=>'<button data-life-tab="'+k+'" class="'+(tab===k?'active':'')+'">'+t+'</button>').join('')+'</div><div id="life-content"></div>';
host.querySelectorAll('[data-life-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.lifeTab;render()});
const area=host.querySelector('#life-content'),items=store.items.filter(x=>x.kind===tab&&!x.data.cancelled);
if(tab==='imports'){renderImports(area);return}
if(tab==='settings'){
area.innerHTML=saveForm('settings','<h2>School options</h2><p>One option per line. Keep Isolation, Teaching assistant, N/A, Booster Session and Exam.</p>'+['duties','durations','scheduleTypes'].map(k=>'<label>'+({duties:'Staff duty types',durations:'Isolation durations',scheduleTypes:'Out-of-lesson options'}[k])+'<textarea name="'+k+'">'+esc(store.settings[k].join('\n'))+'</textarea></label>').join('')+'<label class="check"><input type="checkbox" name="busEnabled" '+(store.settings.busEnabled?'checked':'')+'>Allow student bus bookings</label>');
area.querySelector('form').onsubmit=run(async e=>{const f=e.target,d=Object.fromEntries(['duties','durations','scheduleTypes'].map(k=>[k,[...new Set(f.elements[k].value.split('\n').map(x=>x.trim()).filter(Boolean))]]));d.busEnabled=f.elements.busEnabled.checked;await life('settings',d,null,store.items.find(x=>x.kind==='settings')?.revision||0);await refresh()});return;
}
let form='';
if(tab==='duty'&&cap.duties)form=saveForm('duty','<h2>Assign a staff duty</h2><label>Staff member<select name="staffId">'+opt(s.teachers)+'</select></label>'+select('type','Duty',store.settings.duties)+when()+rooms()+'<fieldset id="ta-fields" hidden><legend>Teaching assistant support</legend>'+select('scope','Support scope',[['classroom','Classroom'],['student','Individual student'],['class','Whole class']])+'<label>Support target<select name="targetId"></select></label></fieldset>');
if(tab==='schedule')form=saveForm('schedule','<h2>Schedule time out</h2>'+people()+select('type','Type',store.settings.scheduleTypes)+input('title','Student-facing title (optional)')+when()+rooms()+'<label>Staff notes<textarea name="notes" maxlength="2000"></textarea></label>');
if(tab==='isolation')form=saveForm('isolation','<h2>Add an isolation record</h2>'+people()+when(false)+rooms()+select('duration','Duration',store.settings.durations)+'<small>Set the actual start and end times to match the selected duration.</small><label>Reason (staff only)<textarea name="reason" required maxlength="2000"></textarea></label><label>Work set (staff only)<textarea name="work" maxlength="2000"></textarea></label>');
if(tab==='bus'&&cap.busManage)form=saveForm('bus','<h2>Publish a bus departure</h2>'+input('name','Route / bus name','text','','required maxlength="120"')+input('location','Pickup point','text','','required maxlength="160"')+when(false)+input('cutoff','Booking cutoff (same day)','time','14:00','required')+input('capacity','Seats','number','30','required min="1" max="200"')+'<small>Each departure is dated. Publish separate departures for advance booking.</small>');
let list='<article class="card"><h2>'+({duty:'Scheduled duties',schedule:'Current arrangements',isolation:'Isolation register',bus:'Published departures'}[tab])+'</h2><label>Filter by date<input id="life-date" type="date"></label><div id="life-records"></div><p class="life-error" role="status"></p></article>';
area.innerHTML='<div class="life-grid">'+(form||'<article class="card"><h2>Your duty calendar</h2><p>Duty assignments are managed by your timetable team.</p><div id="duty-calendar"></div></article>')+list+'</div>';
if(tab==='duty'){
const cal=area.querySelector('#duty-calendar');if(cal){const start=monday(today());cal.innerHTML=weekCalendar([0,1,2,3,4].map(i=>eventRows(items,plusDay(start,i),s)),start)+legend();bindCalendar(cal)}
const f=area.querySelector('form');if(f){const drawTA=()=>{f.querySelector('#ta-fields').hidden=f.elements.type.value!=='Teaching assistant';f.elements.targetId.innerHTML=opt(f.elements.scope.value==='classroom'?s.rooms:f.elements.scope.value==='student'?s.students.filter(p=>!p.archived):s.classes,x=>x.name||full(x))};f.elements.type.onchange=drawTA;f.elements.scope.onchange=drawTA;drawTA()}
}
const f=area.querySelector('#life-add');if(f)f.onsubmit=run(async e=>{const d=Object.fromEntries(new FormData(e.target));if(d.capacity)d.capacity=Number(d.capacity);await life(tab,d);await refresh()});
const draw=()=>{
const day=area.querySelector('#life-date').value,filtered=items.filter(x=>!day||day>=x.data.date&&day<=(x.data.until||x.data.date));
area.querySelector('#life-records').innerHTML=filtered.map(x=>{const d=x.data,p=s.students.find(p=>p.id===d.studentId),staff=s.teachers.find(t=>t.id===d.staffId),canCancel=tab==='duty'?cap.duties:tab==='bus'?cap.busManage:true;
return '<section class="life-record"><h3>'+esc(tab==='bus'?d.name:p?full(p)+' · Year '+p.year:staff?.name||'Staff')+'</h3><p>'+esc(d.date)+' · '+esc(d.start)+'–'+esc(d.end)+(d.repeat==='weekly'?' · Weekly until '+esc(d.until)+' · '+esc(d.week):'')+'</p><p>'+esc(d.type||d.duration||d.location||'')+' · '+esc(s.rooms.find(r=>r.id===d.roomId)?.name||'Room to be confirmed')+'</p>'+(tab==='isolation'?'<p>'+esc(d.reason)+'</p><p>Work: '+esc(d.work||'Not set')+'</p><p>Follow-up: '+esc(d.followUp||'None')+'</p><label>Status <select data-isolation-status="'+x.id+'">'+['Expected','Arrived','Completed','Absent'].map(v=>'<option '+(d.status===v?'selected':'')+'>'+v+'</option>').join('')+'</select></label>':'')+(tab==='duty'&&d.type==='Teaching assistant'?'<p>Supporting '+esc(d.scope)+' · '+esc((d.scope==='classroom'?s.rooms:d.scope==='student'?s.students:s.classes).find(t=>t.id===d.targetId)?.name||(d.scope==='student'?full(s.students.find(t=>t.id===d.targetId)||{first:'',last:''}):d.targetId))+'</p>':'')+(tab==='bus'?'<p>'+store.bookings.filter(b=>b.bus_id===x.id&&b.status==='booked').length+' / '+d.capacity+' seats · Cutoff '+esc(d.cutoff)+'</p><button class="btn soft" data-passengers="'+x.id+'">Passenger list</button> <button class="btn primary" data-book-student="'+x.id+'">Book for student</button>':'')+(canCancel?' <button class="btn soft" data-life-cancel="'+x.id+'">Cancel</button>':'')+'</section>';
}).join('')||'<p>No records for this date.</p>';
area.querySelectorAll('[data-life-cancel]').forEach(b=>b.onclick=run(async()=>{const x=items.find(x=>x.id===b.dataset.lifeCancel);if(!confirm('Cancel this '+tab+'?'+(tab==='bus'?' All passenger bookings will be cancelled.':'')))return;await life('cancel',{},x.id,x.revision);await refresh()}));
area.querySelectorAll('[data-isolation-status]').forEach(el=>el.onchange=run(async()=>{const x=items.find(x=>x.id===el.dataset.isolationStatus),note=prompt('Follow-up note (staff only)',x.data.followUp||'');if(note===null){el.value=x.data.status;return}await life('isolation_status',{status:el.value,followUp:note},x.id,x.revision);await refresh()}));
area.querySelectorAll('[data-passengers]').forEach(b=>b.onclick=()=>{const x=items.find(x=>x.id===b.dataset.passengers),rows=store.bookings.filter(b=>b.bus_id===x.id&&b.status==='booked').map(b=>{const p=s.students.find(p=>p.id===b.student_id);return [p?full(p):'Former student',p?.year||'',x.data.date,x.data.start,x.data.location]});download('late-bus-passengers.csv',csvWrite([['Student','Year','Date','Departure','Pickup'],...rows]),'text/csv')});
area.querySelectorAll('[data-book-student]').forEach(b=>b.onclick=()=>{const x=items.find(x=>x.id===b.dataset.bookStudent),d=document.createElement('dialog');d.className='life-dialog';d.innerHTML='<form method="dialog"><button class="close" aria-label="Close">×</button></form><form class="life-form"><h2>'+esc(x.data.name)+'</h2>'+people()+select('action','Booking action',[['book','Book seat'],['cancel','Cancel seat']])+'<p role="status"></p><button class="btn primary">Confirm</button></form>';document.body.append(d);d.onclose=()=>d.remove();d.showModal();d.querySelector('.life-form').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{await busCall(e.target.elements.action.value,null,x.id,e.target.elements.studentId.value);d.close();await refresh()}catch(err){d.querySelector('[role=status]').textContent=err.message;e.submitter.disabled=false}}});
};area.querySelector('#life-date').onchange=draw;draw();
}
function renderImports(area){
const access=ctx.getCapabilities();
area.innerHTML='<div class="life-tabs"><button id="import-students" '+(!access.pupils?'disabled':'')+'>Student CSV</button><button id="import-staff" '+(!access.accounts?'disabled':'')+'>Staff CSV</button><button id="bulk-move" '+(!access.pupils?'disabled':'')+'>Move selected students</button></div><div id="bulk-area"></div>';
area.querySelector('#import-students').onclick=()=>csvScreen('students');area.querySelector('#import-staff').onclick=()=>csvScreen('staff');area.querySelector('#bulk-move').onclick=()=>moveScreen();
if(access.pupils)csvScreen('students');else csvScreen('staff');
}
function csvScreen(kind){
const out=host.querySelector('#bulk-area');let csv,preview;
out.innerHTML='<article class="card life-form"><h2>'+ (kind==='staff'?'Import teachers':'Import students')+'</h2><p>'+ (kind==='staff'?'Creates profiles and private invitations. Existing email addresses are skipped. Teachers verify their email, redeem their invitation and set a password.':'Match your columns, choose how to handle existing students, then review. Repeated tutor/class names use the existing group in that year. Quote comma-separated classes in CSV.')+'</p><button type="button" id="bulk-template" class="btn soft">Download template</button><label>CSV file<input id="bulk-file" type="file" accept=".csv"></label><label>Or paste CSV<textarea id="bulk-csv"></textarea></label><button class="btn soft" id="bulk-map">Match columns</button><div id="bulk-mapping"></div><p class="life-error" role="status"></p><div id="bulk-preview"></div></article>';
out.querySelector('#bulk-template').onclick=()=>download(kind+'-import-template.csv',kind==='staff'?'Full name,Title,Display surname,Email,Department,Role\n':'Student ID,First name,Last name,Year,Tutor,Classes,Parent email\n','text/csv');
out.querySelector('#bulk-file').onchange=run(async e=>{if(e.target.files[0]?.size>1000000)throw Error('Use a CSV smaller than 1 MB.');out.querySelector('#bulk-csv').value=await e.target.files[0].text()});
out.querySelector('#bulk-csv').oninput=()=>{preview=null;out.querySelector('#bulk-mapping').innerHTML='';out.querySelector('#bulk-preview').innerHTML=''};
out.querySelector('#bulk-map').onclick=run(async()=>{
csv=readCSV(out.querySelector('#bulk-csv').value,kind);
out.querySelector('#bulk-mapping').innerHTML=Object.entries(fields[kind]).map(([key,label])=>'<label>'+label+'<select data-map="'+key+'"><option value="-1">Not included</option>'+csv.headers.map((h,i)=>'<option value="'+i+'" '+(csv.mapping[key]===i?'selected':'')+'>'+esc(h)+'</option>').join('')+'</select></label>').join('')+(kind==='students'?select('duplicate','Existing students',[['skip','Skip duplicates'],['update','Update matched students; keep login codes']])+select('year','Default year',[7,8,9,10,11])+'<label>Default tutor (used when CSV tutor is blank)<select name="defaultTutor"><option value="">Leave as is / unassigned</option></select></label>':'')+'<button class="btn primary" id="bulk-review">Preview import</button>';
if(kind==='students'){const y=out.querySelector('[name=year]'),draw=()=>{out.querySelector('[name=defaultTutor]').innerHTML='<option value="">Leave as is / unassigned</option>'+opt(s.tutors.filter(t=>Number(t.year)===Number(y.value)))};y.onchange=()=>{draw();out.querySelector('#bulk-preview').innerHTML=''};draw()}
out.querySelectorAll('#bulk-mapping select').forEach(el=>el.addEventListener('change',()=>{preview=null;out.querySelector('#bulk-preview').innerHTML=''}));
out.querySelector('#bulk-review').onclick=run(async()=>{
const mapping=Object.fromEntries([...out.querySelectorAll('[data-map]')].map(el=>[el.dataset.map,Number(el.value)])),rows=mappedRows(csv,mapping);
preview=kind==='students'?previewStudents(s,rows,{mode:out.querySelector('[name=duplicate]').value,defaultYear:Number(out.querySelector('[name=year]').value),defaultTutor:out.querySelector('[name=defaultTutor]').value}):previewStaff(s,rows);
out.querySelector('#bulk-preview').innerHTML='<h3>Review '+rows.length+' rows</h3>'+table(kind==='students'?preview.changes:preview,kind==='students'?['name','year','tutor','status']:['fullName','name','email','role','status'])+'<button class="btn primary" id="bulk-save">Confirm import</button>';
out.querySelector('#bulk-save').onclick=run(async()=>{
if(kind==='students'){await rpc('oe_save_state',{p_data:preview.data,p_revision:ctx.getRevision(),p_action:'Reviewed CSV student import'});await refresh()}
else{const result=await central('oe26_import_staff',{p_slug:slug,p_rows:preview,p_revision:ctx.getRevision()});const rows=result.rows.map(x=>({...x,url:x.code?new URL('staff-welcome.html?school='+encodeURIComponent(slug)+'#invite='+encodeURIComponent(x.code),location.href).href:''}));out.querySelector('#bulk-preview').innerHTML='<h3>Import saved</h3><p>Download invitations now and share each link privately with its intended teacher. No email has been sent by this import.</p>'+table(rows,['email','status'])+'<button id="invite-download" class="btn primary">Download private invitations</button>';out.querySelector('#invite-download').onclick=()=>download('private-staff-invitations.csv',csvWrite([['Email','Status','Private invitation URL'],...rows.map(r=>[r.email,r.status,r.url])]),'text/csv');out.querySelector('#bulk-map').disabled=true}
});
});
});
}
function moveScreen(){
const out=host.querySelector('#bulk-area'),selected=new Set();let proposed;
out.innerHTML='<article class="card life-form"><h2>Move selected students</h2><div class="life-filter">'+select('year','Year',[7,8,9,10,11])+'<label>Current tutor<select name="sourceTutor"></select></label>'+input('search','Search name')+'</div><div><button id="move-all" class="btn soft">Select visible</button> <button id="move-clear" class="btn soft">Clear selection</button></div><div class="life-pupils"></div><strong id="move-count"></strong>'+select('mode','Change',[['tutor','Move tutor group'],['add','Add class'],['move','Move between classes'],['remove','Remove from class']])+'<label>Destination / class<select name="destination"></select></label><label>Source class (class moves only)<select name="fromClass"></select></label><button class="btn primary" id="move-review">Review move</button><div id="move-preview"></div><p class="life-error" role="status"></p></article>';
const get=n=>out.querySelector('[name="'+n+'"]'),visible=()=>s.students.filter(p=>!p.archived&&Number(p.year)===Number(get('year').value)&&(!get('sourceTutor').value||p.tutorId===get('sourceTutor').value)&&full(p).toLowerCase().includes(get('search').value.toLowerCase()));
const reset=()=>{proposed=null;out.querySelector('#move-preview').innerHTML=''};
const draw=()=>{out.querySelector('.life-pupils').innerHTML=visible().map(p=>'<label><input type="checkbox" data-move-id="'+p.id+'" '+(selected.has(p.id)?'checked':'')+'>'+esc(full(p))+'</label>').join('');out.querySelector('#move-count').textContent=selected.size+' students selected';out.querySelectorAll('[data-move-id]').forEach(el=>el.onchange=()=>{el.checked?selected.add(el.dataset.moveId):selected.delete(el.dataset.moveId);reset();draw()})};
const groups=()=>{selected.clear();reset();const year=Number(get('year').value);get('sourceTutor').innerHTML='<option value="">All tutor groups</option>'+opt(s.tutors.filter(t=>Number(t.year)===year));get('destination').innerHTML=opt((get('mode').value==='tutor'?s.tutors:s.classes).filter(t=>Number(t.year)===year));get('fromClass').innerHTML=opt(s.classes.filter(t=>Number(t.year)===year));draw()};
get('year').onchange=groups;get('mode').onchange=groups;get('sourceTutor').onchange=draw;get('search').oninput=draw;get('destination').onchange=reset;get('fromClass').onchange=reset;
out.querySelector('#move-all').onclick=()=>{visible().forEach(p=>selected.add(p.id));reset();draw()};out.querySelector('#move-clear').onclick=()=>{selected.clear();reset();draw()};groups();
out.querySelector('#move-review').onclick=run(async()=>{proposed=moveStudents(s,[...selected],{mode:get('mode').value,tutorId:get('destination').value,classId:get('destination').value,fromClass:get('fromClass').value});out.querySelector('#move-preview').innerHTML='<p>'+selected.size+' students → '+esc(get('destination').selectedOptions[0].textContent)+'</p><p>'+esc(s.students.filter(p=>selected.has(p.id)).map(full).join(', '))+'</p><button id="move-save" class="btn primary">Confirm move</button>';out.querySelector('#move-save').onclick=run(async()=>{await rpc('oe_save_state',{p_data:proposed,p_revision:ctx.getRevision(),p_action:'Reviewed bulk tutor/class move'});await refresh()})});
}
render();
}catch(e){if(host.isConnected)host.innerHTML='<article class="card"><h1>School life</h1><p>'+esc(e.message)+'</p><p>Install the October SQL files in order before using these tools.</p></article>'}
}
