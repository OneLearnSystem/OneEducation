import {appRPC,login,signOut,identity,demo,cfg,central,slug} from './shared.mjs';
export {signOut,identity};export const logout=signOut;export const rpc=appRPC;
export async function signIn(email,password){if(!demo)await login(email,password);return appRPC(cfg.product==='OneEducation'?'oe_get_state':cfg.product==='OneHome'?'oh_staff':'ss_staff')}
export async function signInWithLockdown(email,password){if(!demo)await login(email,password);if(cfg.product==='OneEducation'&&!demo){const lock=await lockdownStatus();if(lock?.active&&lock.role!=='admin')return {lockdown:lock}}return appRPC(cfg.product==='OneEducation'?'oe_get_state':cfg.product==='OneHome'?'oh_staff':'ss_staff')}
export const signin=signIn;
export const portal=code=>appRPC('oe_student_portal',{p_code:code});
export const studentAction=(code,kind,data,item=null)=>appRPC('oe_hub_student_action',{p_code:code,p_kind:kind,p_data:data,p_item:item});
export const lockdownStatus=()=>demo?Promise.resolve({active:false,role:'admin',can_manage:true,messages:[]}):central('ol_lockdown_status',{p_slug:slug});
export const publicLockdownStatus=()=>demo?Promise.resolve({active:false}):central('ol_lockdown_public',{p_slug:slug},false);
export const lockdownChat=body=>central('ol_lockdown_chat',{p_slug:slug,p_body:body});
export const lockdownSet=(active,reason='')=>central('ol_lockdown_set',{p_slug:slug,p_active:!!active,p_reason:reason});
