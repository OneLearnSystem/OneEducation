import {esc,central,download,identity,school,slug,demo} from './shared.mjs';
import {uid,today,csvWrite,removeFromLesson} from './core.mjs';

export const extraRoleNames={
  head_of_year:'Head of Year',
  deputy_head_of_year:'Deputy Head of Year',
  hub:'HUB staff',
  safeguarding_lead:'Designated Safeguarding Lead',
  attendance_officer:'Attendance officer'
};

const detentionDefaults=['Late to school','Late to lesson','Behaviour follow-up','Missed homework','Uniform follow-up','Restorative meeting'];
const portalSections=[['home','Home'],['timetable','Timetable'],['classes','Classes'],['exams','Exams'],['notices','Notices']];
const portalDefault=()=>Object.fromEntries(portalSections.map(([k])=>[k,true]));
const name=p=>p?`${p.first} ${p.last}`:'Unknown pupil';
const option=(v,label,selected='')=>`<option value="${esc(v)}" ${String(v)===String(selected)?'selected':''}>${esc(label)}</option>`;
const roleHelp={
  admin:'System configuration, account roles, all school management and LockDown activation. Funding is deliberately excluded.',
  headteacher:'School leadership, pupils, structure, timetables, teaching, emergencies and confidential safeguarding. Funding access included.',
  deputy_head:'Same operational school permissions as Headteacher, without system account administration. Funding access included.',
  assistant_head:'Same operational school permissions as Headteacher, without system account administration. Funding access included.',
  head_of_year:'Year-group pastoral work: pupil moves, attendance, behaviour, detentions, teaching and On-Call.',
  deputy_head_of_year:'Pastoral support: pupil moves, attendance, behaviour, detentions, teaching and On-Call.',
  hub:'HUB workflow: attendance, behaviour, detentions, On-Call and confidential safeguarding.',
  safeguarding_lead:'On-Call, safeguarding details, emergency acknowledgement/resolution and pastoral records.',
  attendance_officer:'Attendance and pupil administration, with On-Call visibility but no confidential safeguarding details.',
  timetable_manager:'Staff directory, rooms, classes and Week A/B timetables.',
  teacher:'Attendance, behaviour/rewards, detentions, teaching and On-Call requests.',
  cover_teacher:'Attendance, detentions and emergency/On-Call requests.',
  office:'Pupil administration, attendance, detentions and emergency/On-Call requests.'
};

export function extraTabs(cap,role){
  const out=[];
  if(cap.detentions)out.push(['detentions','Detentions']);
  if(cap.oncall)out.push(['oncall','On-Call']);
  if(cap.policies)out.push(['portal','Student portal']);
  if(cap.funding)out.push(['funding','Funding']);
  // Inactive LockDown controls are visible only to administrators. Non-admin staff see LockDown only when it is active (manage.mjs forces the restricted LockDown-only view).
  if(role==='admin')out.push(['lockdown','LockDown']);
  return out;
}

export function ensureExtraState(s){
  if(!s.detentions)s.detentions=[];
  if(!s.school.detentionReasons)s.school.detentionReasons=[...detentionDefaults];
  if(!s.school.portalVisibility)s.school.portalVisibility={};
  for(const y of [7,8,9,10,11])s.school.portalVisibility[y]={...portalDefault(),...(s.school.portalVisibility[y]||{})};
  return s;
}

export function extraContent(tab,{s,cap,role}){
  ensureExtraState(s);
  if(tab==='detentions')return detentionContent(s,cap);
  if(tab==='oncall')return onCallContent(s,cap);
  if(tab==='portal')return portalContent(s,cap);
  if(tab==='funding')return fundingContent(cap);
  if(tab==='lockdown')return lockdownContent(role);
  return null;
}

function detentionContent(s,cap){
  const reasons=s.school.detentionReasons||detentionDefaults;
  return `<div class="platform-grid">
    <form id="detention" class="platform-card"><h2>Detention record</h2><p>Create a detention or select one to edit its date, location and attendance.</p>
      <label>Edit detention<select id="detention-id"><option value="">New detention</option>${s.detentions.map(d=>option(d.id,`${d.date} · ${name(s.students.find(p=>p.id===d.studentId))} · ${d.reason}`)).join('')}</select></label>
      <label>Student<select id="detention-student"><option value="">Choose a pupil</option>${s.students.filter(p=>!p.archived).sort((a,b)=>a.last.localeCompare(b.last)).map(p=>option(p.id,`${p.last}, ${p.first}`)).join('')}</select></label>
      <label>Reason<select id="detention-reason">${reasons.map(r=>option(r,r)).join('')}</select></label>
      <label>Date<input id="detention-date" type="date" value="${today()}" required></label>
      <label>Location<input id="detention-location" maxlength="120" placeholder="HUB / Room / Hall" required></label>
      <label>Attendance<select id="detention-attendance">${[['scheduled','Scheduled'],['attended','Attended'],['missed','Missed'],['authorised','Authorised absence']].map(([v,t])=>option(v,t)).join('')}</select></label>
      <label>Notes<textarea id="detention-notes" maxlength="1000"></textarea></label>
      <button ${cap.detentions?'':'disabled'}>Save detention</button><button type="button" id="delete-detention" class="secondary" ${cap.detentions?'':'disabled'}>Delete selected detention</button>
    </form>
    <form id="detention-reasons" class="platform-card"><h2>Detention reasons</h2><p>One reason per line. These become the detention dropdown.</p><textarea id="detention-reason-list">${esc(reasons.join('\n'))}</textarea><button ${cap.policies?'':'disabled'}>Save reason dropdown</button>${cap.policies?'':'<p><small>School leadership manages this dropdown.</small></p>'}</form>
  </div>
  <article class="platform-card"><div class="platform-actions"><div><h2>Detention board</h2><p>Authorised teachers, HUB staff and administrators can download this board.</p></div><label>Board date<input id="detention-board-date" type="date" value="${today()}"></label><button id="download-detentions" class="secondary" ${cap.detentions?'':'disabled'}>Download CSV</button></div><div id="detention-board" class="scroll"></div></article>`;
}

function onCallContent(s,cap){
  return `<div class="platform-grid">
    <form id="oncall-removal" class="platform-card"><h2>Removal request</h2><p>Record a lesson removal using the existing attendance/removal workflow.</p><label>Student<select id="oncall-student"><option value="">Choose a pupil</option>${s.students.filter(p=>!p.archived).sort((a,b)=>a.last.localeCompare(b.last)).map(p=>option(p.id,`${p.last}, ${p.first}`)).join('')}</select></label><label>Date<input id="oncall-date" type="date" value="${today()}"></label><label>Lesson<select id="oncall-period">${[1,2,3,4,5].map(n=>option(n,'Lesson '+n)).join('')}</select></label><label>Reason<input id="oncall-reason" value="On-Call removal" maxlength="200"></label><button ${cap.oncall?'':'disabled'}>Record removal</button></form>
    <form id="safeguarding-request" class="platform-card"><h2>Safeguarding request</h2><p>Any authorised On-Call staff member can raise a request. Confidential details are returned only to safeguarding-authorised roles.</p><label>Student<select id="safe-student"><option value="">Choose a pupil</option>${s.students.filter(p=>!p.archived).sort((a,b)=>a.last.localeCompare(b.last)).map(p=>option(p.id,`${p.last}, ${p.first}`)).join('')}</select></label><label>Location<input id="safe-location" maxlength="160"></label><label>Summary<input id="safe-summary" maxlength="240" required></label><label>Confidential details<textarea id="safe-details" maxlength="4000" required></textarea></label><button ${cap.oncall?'':'disabled'}>Submit safeguarding request</button></form>
  </div>
  <div class="platform-grid"><article class="platform-card"><div class="platform-actions"><h2>Current removals</h2></div><div class="scroll"><table><tr><th>Pupil</th><th>Date</th><th>Lessons</th><th>Reason</th></tr>${(s.removals||[]).slice(-30).reverse().map(r=>`<tr><td>${esc(name(s.students.find(p=>p.id===r.studentId)))}</td><td>${esc(r.date)}</td><td>${esc((r.periods||[]).join(', '))}</td><td>${esc(r.reason)}</td></tr>`).join('')||'<tr><td colspan="4">No removals recorded.</td></tr>'}</table></div></article>
  <article class="platform-card"><div class="platform-actions"><h2>Emergency alerts</h2><button id="open-emergency" class="secondary">Open Emergency centre</button></div>${(s.incidents||[]).filter(i=>i.status!=='resolved').slice(-12).reverse().map(i=>`<p><strong>${esc(i.type)}</strong> · ${esc(i.priority||'standard')} · ${esc(i.location||'Location not set')}<br><small>${esc(i.status)} · ${esc(i.notes||'')}</small></p>`).join('')||'<p>No active emergency alerts.</p>'}</article></div>
  <article class="platform-card"><div class="platform-actions"><div><h2>Safeguarding requests</h2><p id="safe-access-note"></p></div><button id="refresh-safeguarding" class="secondary">Refresh</button></div><div id="safeguarding-list">Loading…</div></article>`;
}

function portalContent(s,cap){
  const p=s.school.portalVisibility;
  return `<form id="portal-years" class="platform-card"><h2>Student portal visibility by year</h2><p>These settings apply to a whole year group. They do not create per-pupil exceptions. LockDown overrides all student access while active.</p><div class="scroll"><table><thead><tr><th>Year</th>${portalSections.map(([,label])=>`<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${[7,8,9,10,11].map(y=>`<tr><th>Year ${y}</th>${portalSections.map(([k])=>`<td><label><input type="checkbox" data-portal-year="${y}" data-portal-section="${k}" ${p[y]?.[k]!==false?'checked':''}> Visible</label></td>`).join('')}</tr>`).join('')}</tbody></table></div><button ${cap.policies?'':'disabled'}>Save year visibility</button></form>`;
}

function fundingContent(cap){return `<article class="platform-card"><h2>Funding</h2><p>Private leadership file area. Only Headteacher, Deputy Headteacher and Assistant Headteacher roles can list, upload or download these files.</p><form id="funding-upload"><label>Excel, PDF or PNG<input id="funding-file" type="file" accept=".xlsx,.xls,.pdf,.png,application/pdf,image/png,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></label><button ${cap.funding?'':'disabled'}>Upload private file</button></form><p><small>Files are stored in the database by this upgrade and are limited to 5 MB each. Direct table access is revoked; downloads go through a role-checked RPC.</small></p></article><article class="platform-card"><div class="platform-actions"><h2>Funding files</h2><button id="refresh-funding" class="secondary">Refresh</button></div><div id="funding-list">Loading…</div></article>`}

function lockdownContent(role){return `<article class="platform-card"><div class="platform-actions"><div><h2>LockDown</h2><p>When active, normal student access is blocked and non-administrator staff are restricted to this LockDown area.</p></div><button id="refresh-lockdown" class="secondary">Refresh</button></div><div id="lockdown-panel">Loading LockDown status…</div><p><small>Current role: ${esc(role||'staff')}. LockDown enforcement is performed by the database RPC layer as well as this interface.</small></p></article>`}

let lockdownTimer;
export async function extraBind(tab,ctx){
  const {s,cap,role,save,load}=ctx;
  ensureExtraState(s);
  if(tab==='detentions')bindDetentions(ctx);
  if(tab==='oncall')bindOnCall(ctx);
  if(tab==='portal')bindPortal(ctx);
  if(tab==='funding')bindFunding(ctx);
  if(tab==='lockdown')bindLockdown(ctx);
  if(tab==='staff')bindMemberRoles(ctx);
  if(lockdownTimer&&tab!=='lockdown'){clearInterval(lockdownTimer);lockdownTimer=null}
}

function bindDetentions({s,cap,save}){
  const by=id=>document.getElementById(id),renderBoard=()=>{const date=by('detention-board-date')?.value||today(),rows=(s.detentions||[]).filter(d=>d.date===date).sort((a,b)=>name(s.students.find(p=>p.id===a.studentId)).localeCompare(name(s.students.find(p=>p.id===b.studentId))));by('detention-board').innerHTML=`<table><tr><th>Pupil</th><th>Reason</th><th>Location</th><th>Attendance</th><th>Notes</th></tr>${rows.map(d=>`<tr><td>${esc(name(s.students.find(p=>p.id===d.studentId)))}</td><td>${esc(d.reason)}</td><td>${esc(d.location)}</td><td>${esc(d.attendance)}</td><td>${esc(d.notes||'')}</td></tr>`).join('')||'<tr><td colspan="5">No detentions on this date.</td></tr>'}</table>`};
  by('detention-board-date')?.addEventListener('change',renderBoard);renderBoard();
  by('detention-id')?.addEventListener('change',()=>{const d=s.detentions.find(x=>x.id===by('detention-id').value);if(!d)return;by('detention-student').value=d.studentId;by('detention-reason').value=d.reason;by('detention-date').value=d.date;by('detention-location').value=d.location||'';by('detention-attendance').value=d.attendance||'scheduled';by('detention-notes').value=d.notes||''});
  by('detention')?.addEventListener('submit',async e=>{e.preventDefault();try{const id=by('detention-id').value||uid(),d=structuredClone(s),row={id,studentId:by('detention-student').value,reason:by('detention-reason').value,date:by('detention-date').value,location:by('detention-location').value.trim(),attendance:by('detention-attendance').value,notes:by('detention-notes').value.trim(),createdAt:s.detentions.find(x=>x.id===id)?.createdAt||new Date().toISOString(),createdBy:s.detentions.find(x=>x.id===id)?.createdBy||identity()?.email||'Staff'};if(!row.studentId||!row.date||!row.location)throw Error('Choose a pupil, date and location.');d.detentions||=[];const i=d.detentions.findIndex(x=>x.id===id);if(i<0)d.detentions.push(row);else d.detentions[i]=row;await save(d,'Saved detention record')}catch(err){alert(err.message)}});
  by('delete-detention')?.addEventListener('click',async()=>{const id=by('detention-id').value;if(!id)return;if(!confirm('Delete this detention record?'))return;const d=structuredClone(s);d.detentions=(d.detentions||[]).filter(x=>x.id!==id);await save(d,'Deleted detention record')});
  by('detention-reasons')?.addEventListener('submit',async e=>{e.preventDefault();try{const reasons=[...new Set(by('detention-reason-list').value.split('\n').map(x=>x.trim()).filter(Boolean))];if(!reasons.length||reasons.length>60)throw Error('Add between 1 and 60 detention reasons.');const d=structuredClone(s);d.school.detentionReasons=reasons;await save(d,'Updated detention reason dropdown')}catch(err){alert(err.message)}});
  by('download-detentions')?.addEventListener('click',()=>{if(!cap.detentions)return;const date=by('detention-board-date').value,rows=(s.detentions||[]).filter(d=>d.date===date);download(`detention-board-${date}.csv`,csvWrite([['Pupil','Year','Tutor','Reason','Date','Location','Attendance','Notes'],...rows.map(d=>{const p=s.students.find(p=>p.id===d.studentId);return[name(p),p?.year,s.tutors.find(t=>t.id===p?.tutorId)?.name||'',d.reason,d.date,d.location,d.attendance,d.notes||'']})]),'text/csv')});
}

function bindOnCall({s,cap,save}){
  const by=id=>document.getElementById(id);
  by('oncall-removal')?.addEventListener('submit',async e=>{e.preventDefault();try{const d=structuredClone(s);removeFromLesson(d,by('oncall-student').value,by('oncall-date').value,Number(by('oncall-period').value),by('oncall-reason').value.trim()||'On-Call removal');await save(d,'Recorded On-Call removal')}catch(err){alert(err.message)}});
  by('open-emergency')?.addEventListener('click',()=>{location.hash='alerts'});
  by('safeguarding-request')?.addEventListener('submit',async e=>{e.preventDefault();if(demo)return alert('Safeguarding requests are not sent from demo mode.');try{await central('ol_safeguarding_create',{p_slug:slug,p_student:by('safe-student').value||null,p_location:by('safe-location').value.trim(),p_summary:by('safe-summary').value.trim(),p_details:by('safe-details').value.trim()});e.target.reset();await loadSafeguarding(s,cap)}catch(err){alert(err.message)}});
  by('refresh-safeguarding')?.addEventListener('click',()=>loadSafeguarding(s,cap));loadSafeguarding(s,cap);
}

async function loadSafeguarding(s,cap){const box=document.getElementById('safeguarding-list'),note=document.getElementById('safe-access-note');if(!box)return;if(demo){box.innerHTML='<p>Live safeguarding records are not exposed in demo mode.</p>';return}try{const rows=await central('ol_safeguarding_list',{p_slug:slug});note.textContent=cap.safeguarding?'Your role can view confidential details.':'Confidential details are hidden for your role.';box.innerHTML=rows.map(r=>`<article class="platform-notice"><strong>${esc(r.summary)}</strong><p>${esc(name(s.students.find(p=>p.id===r.student_id)))} · ${esc(r.location||'No location')} · ${esc(r.status)} · ${esc(new Date(r.created_at).toLocaleString('en-GB'))}</p>${r.details?`<p>${esc(r.details)}</p>`:'<p><em>Confidential details restricted.</em></p>'}${cap.safeguarding&&r.status!=='closed'?`<button class="secondary" data-safe-close="${r.id}">Close request</button>`:''}</article>`).join('')||'<p>No safeguarding requests.</p>';document.querySelectorAll('[data-safe-close]').forEach(b=>b.onclick=async()=>{try{await central('ol_safeguarding_update',{p_slug:slug,p_id:b.dataset.safeClose,p_status:'closed',p_details:null});await loadSafeguarding(s,cap)}catch(err){alert(err.message)}})}catch(err){box.innerHTML=`<p>${esc(err.message)}</p>`}}

function bindPortal({s,save}){document.getElementById('portal-years')?.addEventListener('submit',async e=>{e.preventDefault();const d=structuredClone(s);d.school.portalVisibility={};for(const y of [7,8,9,10,11]){d.school.portalVisibility[y]={};for(const [k] of portalSections)d.school.portalVisibility[y][k]=!!document.querySelector(`[data-portal-year="${y}"][data-portal-section="${k}"]`)?.checked}await save(d,'Updated student portal visibility by year')})}

function fileMime(file){const ext=file.name.toLowerCase().split('.').pop(),map={pdf:'application/pdf',png:'image/png',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel'};return map[ext]||file.type}
function fileBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(Error('Could not read the file.'));r.readAsDataURL(file)})}
function saveBase64(name,mime,b64){const bin=atob(b64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);const u=URL.createObjectURL(new Blob([bytes],{type:mime||'application/octet-stream'})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function bindFunding({cap}){const by=id=>document.getElementById(id);async function refresh(){const box=by('funding-list');if(!box)return;try{const rows=demo?[]:await central('ol_funding_list',{p_slug:slug});box.innerHTML=rows.map(r=>`<p><strong>${esc(r.filename)}</strong> · ${Math.ceil(Number(r.size_bytes)/1024)} KB · ${esc(new Date(r.uploaded_at).toLocaleString('en-GB'))} <button class="secondary" data-fund-download="${r.id}">Download</button><button class="secondary" data-fund-delete="${r.id}">Delete</button></p>`).join('')||'<p>No funding files uploaded.</p>';document.querySelectorAll('[data-fund-download]').forEach(b=>b.onclick=async()=>{try{const f=await central('ol_funding_download',{p_slug:slug,p_id:b.dataset.fundDownload});saveBase64(f.filename,f.mime_type,f.base64)}catch(err){alert(err.message)}});document.querySelectorAll('[data-fund-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this private funding file?'))return;try{await central('ol_funding_delete',{p_slug:slug,p_id:b.dataset.fundDelete});await refresh()}catch(err){alert(err.message)}})}catch(err){box.innerHTML=`<p>${esc(err.message)}</p>`}}by('refresh-funding')?.addEventListener('click',refresh);by('funding-upload')?.addEventListener('submit',async e=>{e.preventDefault();if(demo)return alert('Funding uploads are disabled in demo mode.');try{const f=by('funding-file').files[0];if(!f)throw Error('Choose a file.');const mime=fileMime(f);if(f.size>5*1024*1024)throw Error('Funding files are limited to 5 MB each.');if(!['application/pdf','image/png','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mime))throw Error('Use an Excel, PDF or PNG file.');await central('ol_funding_upload',{p_slug:slug,p_name:f.name,p_mime:mime,p_base64:await fileBase64(f)});e.target.reset();await refresh()}catch(err){alert(err.message)}});refresh()}

function bindLockdown({role}){const by=id=>document.getElementById(id);async function refresh(){const box=by('lockdown-panel');if(!box)return;try{const st=demo?{active:false,role:'admin',can_manage:true,messages:[]}:await central('ol_lockdown_status',{p_slug:slug});box.innerHTML=st.active?`<div class="platform-notice"><strong>LOCKDOWN ACTIVE</strong><p>${esc(st.reason||'No reason entered')} · started ${esc(st.started_at?new Date(st.started_at).toLocaleString('en-GB'):'')}</p>${st.can_manage?'<button id="end-lockdown">End LockDown</button>':''}</div><div class="platform-card"><h3>Staff chat</h3><div class="lockdown-chat">${(st.messages||[]).map(m=>`<p><strong>${esc(m.sender)}</strong> <small>${esc(new Date(m.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}))}</small><br>${esc(m.body)}</p>`).join('')||'<p>No messages yet.</p>'}</div><form id="lockdown-chat-form"><label>Message<input id="lockdown-message" maxlength="1000" required></label><button>Send</button></form></div>`:`${st.can_manage?'<form id="start-lockdown"><h3>Activate LockDown</h3><label>Reason / instruction<textarea id="lockdown-reason" maxlength="1000" required></textarea></label><button>Activate LockDown</button></form>':'<p>No active LockDown.</p>'}`;by('end-lockdown')?.addEventListener('click',async()=>{if(!confirm('End the active LockDown?'))return;await central('ol_lockdown_set',{p_slug:slug,p_active:false,p_reason:''});await refresh()});by('start-lockdown')?.addEventListener('submit',async e=>{e.preventDefault();await central('ol_lockdown_set',{p_slug:slug,p_active:true,p_reason:by('lockdown-reason').value.trim()});await refresh()});by('lockdown-chat-form')?.addEventListener('submit',async e=>{e.preventDefault();await central('ol_lockdown_chat',{p_slug:slug,p_body:by('lockdown-message').value.trim()});by('lockdown-message').value='';await refresh()})}catch(err){box.innerHTML=`<p>${esc(err.message)}</p>`}}by('refresh-lockdown')?.addEventListener('click',refresh);refresh();if(lockdownTimer)clearInterval(lockdownTimer);lockdownTimer=setInterval(()=>{if(document.getElementById('lockdown-panel'))refresh()},5000)}

async function bindMemberRoles({cap,roleNames}){const box=document.getElementById('member-roles');if(!box)return;if(!cap.accounts){box.innerHTML='<p>Only system administrators can edit account roles.</p>';return}if(demo){box.innerHTML='<p>Role editing is disabled in demo mode.</p>';return}try{const info=await school(),rows=await central('ol_staff',{p_school:info.id});box.innerHTML=`<h2>Edit existing staff roles</h2><p>Changes apply immediately to the selected school membership.</p>${rows.map(r=>`<div class="platform-actions"><span><strong>${esc(r.email)}</strong><br><small>${esc(roleNames[r.role]||r.role)}</small></span><select data-member-role="${esc(r.id)}">${Object.entries(roleNames).map(([k,v])=>option(k,v,r.role)).join('')}</select><button type="button" data-save-member="${esc(r.id)}">Save role</button></div>`).join('')}<details><summary>Role permissions</summary>${Object.entries(roleHelp).filter(([k])=>roleNames[k]).map(([k,v])=>`<p><strong>${esc(roleNames[k]||k)}</strong><br><small>${esc(v)}</small></p>`).join('')}</details>`;document.querySelectorAll('[data-save-member]').forEach(b=>b.onclick=async()=>{try{const select=document.querySelector(`[data-member-role="${CSS.escape(b.dataset.saveMember)}"]`);await central('ol_set_member_role',{p_school:info.id,p_user:b.dataset.saveMember,p_role:select.value});await bindMemberRoles({cap,roleNames})}catch(err){alert(err.message)}})}catch(err){box.innerHTML=`<p>${esc(err.message)}</p>`}}
