// Display permissions come from authenticated server responses, never config email.
export async function workspacePermissions(result,{central,slug}){
 if(result?.capabilities&&typeof result.capabilities==='object')return result;
 try{
  const verified=await central('ol_manage_state',{p_slug:slug});
  if(!verified?.capabilities||typeof verified.capabilities!=='object')throw Error('School permission details are unavailable. Please contact your administrator.');
  return {...result,actualRole:verified.actualRole,capabilities:verified.capabilities};
 }catch(error){
  // Only a genuinely missing older RPC allows legacy school-membership lookup.
  if(!/could not find.*function.*ol_manage_state|function.*ol_manage_state.*does not exist/i.test(error.message))throw error;
  const account=await central('ol_me');
  const role=account?.schools?.find(s=>s.slug===slug)?.role;
  const legacy={admin:['policies','pupils','structure','staff','timetable','attendance','points','alerts','resolve','accounts','teaching'],teacher:['attendance','points','alerts','teaching']};
  return {...result,actualRole:role||'unknown',capabilities:Object.fromEntries((legacy[role]||[]).map(k=>[k,true]))};
 }
}
