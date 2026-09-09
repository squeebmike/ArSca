// Roles & Tasks: a store-defined daily checklist, grouped by role
// (operational roles like "Opener"/"Closer"/"Whatnot Host" -- NOT the
// owner/admin/manager/employee permission roles used for sign-in access
// elsewhere in this app). Any staff member can check a task off for today;
// only owner/admin/manager can add/edit/remove roles and tasks themselves.
//
// Kept as its own file/IIFE, mirroring foc-dashboard.js and
// card-intake-dashboard.js -- every function an onclick/onchange HTML
// attribute needs must be re-exposed on window at the bottom (see
// tests/daily-tasks-window-exposure.test.mjs).
(function(){
var DOW_LABELS=['S','M','T','W','T','F','S'];
var state={ date:todayLocalDateStr(), data:null, editing:false, loading:false };

function todayLocalDateStr(){
  var d=new Date();
  var tz=d.getTimezoneOffset();
  var local=new Date(d.getTime()-tz*60000);
  return local.toISOString().slice(0,10);
}
function shiftDateStr(dateStr,deltaDays){
  var d=new Date(dateStr+'T00:00:00');
  d.setDate(d.getDate()+deltaDays);
  var tz=d.getTimezoneOffset();
  var local=new Date(d.getTime()-tz*60000);
  return local.toISOString().slice(0,10);
}
function formatDateLabel(dateStr){
  var d=new Date(dateStr+'T00:00:00');
  return d.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});
}
async function api(path,opts){
  var res=await storeWorkerFetch(path,opts||{});var type=res.headers.get('content-type')||'';
  if(type.indexOf('application/json')<0)return res;
  var data=await res.json().catch(function(){return{};});
  if(!res.ok||data.ok===false)throw new Error(data.error||('Daily tasks request failed '+res.status));
  return data;
}
function panel(){return document.getElementById('daily-tasks-panel');}
function canManageTasks(){return typeof currentRole==='function'&&['owner','admin','manager'].includes(currentRole());}

function ensureDailyTasksPanel(){
  if(!panel())return;
  loadDailyTasks(state.date);
}

async function loadDailyTasks(dateStr){
  var host=panel();if(!host)return;
  state.loading=true;
  host.innerHTML='<div class="panel" style="padding:36px;text-align:center;font-family:var(--font-mono);color:var(--dim)">Loading…</div>';
  try{
    var d=await api('/daily-tasks?date='+encodeURIComponent(dateStr));
    state.date=d.date;
    state.data=d;
  }catch(e){
    host.innerHTML='<div class="panel" style="padding:20px"><div class="empty-t" style="color:var(--red)">Could not load tasks: '+esc(e.message)+'</div></div>';
    state.loading=false;
    return;
  }
  state.loading=false;
  state.editing?renderManageRolesTasks():renderDailyTasksHome();
}

function goToDate(dateStr){ loadDailyTasks(dateStr); }
function shiftDay(delta){ loadDailyTasks(shiftDateStr(state.date,delta)); }
function jumpToToday(){ loadDailyTasks(todayLocalDateStr()); }

function renderDailyTasksHome(){
  var host=panel();if(!host||!state.data)return;
  var roles=state.data.roles||[];
  var isToday=state.date===todayLocalDateStr();
  var dueRoles=roles.map(function(r){return {role:r,tasks:(r.tasks||[]).filter(function(t){return t.dueToday&&t.active!==false;})};});
  var totalDue=dueRoles.reduce(function(n,r){return n+r.tasks.length;},0);
  var totalDone=dueRoles.reduce(function(n,r){return n+r.tasks.filter(function(t){return t.completed;}).length;},0);
  host.innerHTML=
    '<div class="panel" style="padding:14px;margin-bottom:12px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'+
        '<div>'+
          '<div class="ph" style="margin:0 0 4px">'+esc(formatDateLabel(state.date))+(isToday?' <span style="color:var(--g);font-size:9px">TODAY</span>':'')+'</div>'+
          '<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim)">'+totalDone+' / '+totalDue+' task'+(totalDue===1?'':'s')+' done'+(totalDue?'':' -- nothing scheduled for this day')+'</div>'+
        '</div>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
          '<button class="hbtn" onclick="shiftDailyTasksDay(-1)">← PREV DAY</button>'+
          (isToday?'':'<button class="hbtn" onclick="jumpToTodayDailyTasks()">TODAY</button>')+
          '<button class="hbtn" onclick="shiftDailyTasksDay(1)">NEXT DAY →</button>'+
          (canManageTasks()?'<button class="hbtn" style="color:var(--gold)" onclick="openManageRolesTasks()">MANAGE ROLES &amp; TASKS</button>':'')+
        '</div>'+
      '</div>'+
    '</div>'+
    (roles.length?dueRoles.map(function(r){return renderRoleCard(r.role,r.tasks);}).join(''):
      '<div class="panel" style="padding:28px;text-align:center"><div class="empty-t">No roles set up yet</div>'+
      '<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim);margin-top:8px">Add your shop\'s roles (Opener, Closer, Whatnot Host, whatever fits) and the tasks each one covers.</div>'+
      (canManageTasks()?'<button class="hbtn" style="margin-top:12px;color:var(--g)" onclick="openManageRolesTasks()">SET UP ROLES &amp; TASKS</button>':'')+
      '</div>');
}

function renderRoleCard(role,tasks){
  var done=tasks.filter(function(t){return t.completed;}).length;
  return '<div class="panel" style="padding:14px;margin-bottom:10px">'+
    '<div class="ph" style="margin:0 0 8px">'+esc(role.name)+' <span style="font-size:9px;color:var(--dim)">'+done+'/'+tasks.length+'</span></div>'+
    (tasks.length?tasks.map(function(t){return renderTaskRow(t);}).join(''):
      '<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim);padding:6px 0">Nothing scheduled for this role today.</div>')+
    '</div>';
}

function renderTaskRow(t){
  return '<label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">'+
    '<input type="checkbox" style="margin-top:3px;width:18px;height:18px;flex-shrink:0" '+(t.completed?'checked':'')+' onchange="toggleDailyTask(\''+esc(t.id)+'\',this.checked)">'+
    '<span style="flex:1;min-width:0">'+
      '<div style="font-weight:700;color:var(--text);font-size:12px;'+(t.completed?'text-decoration:line-through;color:var(--dim)':'')+'">'+esc(t.title)+'</div>'+
      (t.detail?'<div style="font-family:var(--font-mono);font-size:9px;color:var(--dim);margin-top:2px">'+esc(t.detail)+'</div>':'')+
      (t.completed&&t.completedBy?'<div style="font-family:var(--font-mono);font-size:8px;color:var(--dim);margin-top:2px">checked off by '+esc(t.completedBy)+'</div>':'')+
    '</span>'+
  '</label>';
}

async function toggleDailyTask(taskId,checked){
  try{
    await api('/daily-tasks/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:taskId,date:state.date,completed:checked})});
    var role=(state.data.roles||[]).find(function(r){return (r.tasks||[]).some(function(t){return t.id===taskId;});});
    var task=role&&role.tasks.find(function(t){return t.id===taskId;});
    if(task){task.completed=checked;}
    renderDailyTasksHome();
  }catch(e){toast_dash('Could not update task: '+e.message);}
}

// ── MANAGE ROLES & TASKS (owner/admin/manager) ──────────────────────────
function openManageRolesTasks(){
  if(!canManageTasks())return;
  state.editing=true;
  renderManageRolesTasks();
}
function closeManageRolesTasks(){
  state.editing=false;
  renderDailyTasksHome();
}

function renderManageRolesTasks(){
  var host=panel();if(!host||!state.data)return;
  var roles=state.data.roles||[];
  host.innerHTML=
    '<div class="panel" style="padding:14px;margin-bottom:12px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'+
        '<div class="ph" style="margin:0">MANAGE ROLES &amp; TASKS</div>'+
        '<div style="display:flex;gap:8px">'+
          '<button class="hbtn" style="color:var(--g)" onclick="addDailyTaskRole()">+ ADD ROLE</button>'+
          '<button class="hbtn" onclick="closeManageRolesTasks()">← BACK TO CHECKLIST</button>'+
        '</div>'+
      '</div>'+
    '</div>'+
    (roles.length?roles.map(function(r){return renderManageRoleCard(r);}).join(''):
      '<div class="panel" style="padding:28px;text-align:center"><div class="empty-t">No roles yet</div><button class="hbtn" style="margin-top:12px;color:var(--g)" onclick="addDailyTaskRole()">+ ADD YOUR FIRST ROLE</button></div>');
}

function renderManageRoleCard(role){
  var tasks=role.tasks||[];
  return '<div class="panel" style="padding:14px;margin-bottom:10px">'+
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">'+
      '<input type="text" value="'+esc(role.name)+'" style="flex:1" class="tsi" onchange="renameDailyTaskRole(\''+esc(role.id)+'\',this.value)">'+
      '<button class="hbtn" style="color:var(--red)" onclick="removeDailyTaskRole(\''+esc(role.id)+'\',\''+esc(role.name.replace(/'/g,"\\'"))+'\')">DELETE ROLE</button>'+
    '</div>'+
    (tasks.length?tasks.map(function(t){return renderManageTaskRow(t);}).join(''):'<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim);padding:4px 0 10px">No tasks yet for this role.</div>')+
    '<button class="hbtn" style="width:100%;margin-top:4px" onclick="addDailyTaskItem(\''+esc(role.id)+'\')">+ ADD TASK</button>'+
    '</div>';
}

function dowChipsHtml(taskId,daysOfWeek){
  return DOW_LABELS.map(function(label,i){
    var on=(daysOfWeek||[]).includes(i);
    return '<button type="button" class="hbtn" style="min-width:26px;padding:4px 0;font-size:9px;'+(on?'color:var(--g);border-color:rgba(0,255,179,.4)':'color:var(--dim)')+'" onclick="toggleDailyTaskDay(\''+esc(taskId)+'\','+i+')" title="'+['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]+'">'+label+'</button>';
  }).join('');
}

function renderManageTaskRow(t){
  return '<div style="padding:8px 0;border-bottom:1px solid var(--border)">'+
    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">'+
      '<input type="text" value="'+esc(t.title)+'" style="flex:1" class="tsi" placeholder="Task title" onchange="renameDailyTaskItem(\''+esc(t.id)+'\',this.value)">'+
      '<button class="hbtn" style="color:var(--red);padding:6px 10px" onclick="removeDailyTaskItem(\''+esc(t.id)+'\',\''+esc(t.title.replace(/'/g,"\\'"))+'\')">✕</button>'+
    '</div>'+
    '<input type="text" value="'+esc(t.detail||'')+'" style="width:100%;margin-bottom:6px" class="tsi" placeholder="Optional detail/note" onchange="setDailyTaskDetail(\''+esc(t.id)+'\',this.value)">'+
    '<div style="display:flex;gap:4px;align-items:center">'+
      '<span style="font-family:var(--font-mono);font-size:8px;color:var(--dim);margin-right:4px">DAYS:</span>'+
      dowChipsHtml(t.id,t.daysOfWeek)+
    '</div>'+
  '</div>';
}

function findTaskAndRole(taskId){
  var roles=state.data.roles||[];
  for(var i=0;i<roles.length;i++){
    var t=(roles[i].tasks||[]).find(function(x){return x.id===taskId;});
    if(t)return {role:roles[i],task:t};
  }
  return null;
}

async function addDailyTaskRole(){
  var name=(prompt('Role name (e.g. Opener, Closer, Whatnot Host):')||'').trim();
  if(!name)return;
  try{
    var d=await api('/daily-tasks/roles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,sortOrder:(state.data.roles||[]).length})});
    state.data.roles=(state.data.roles||[]).concat([{id:d.role.id,name:d.role.name,sortOrder:d.role.sort_order,tasks:[]}]);
    renderManageRolesTasks();
  }catch(e){toast_dash('Could not add role: '+e.message);}
}
async function renameDailyTaskRole(roleId,name){
  name=(name||'').trim();
  if(!name){toast_dash('Role name cannot be blank');renderManageRolesTasks();return;}
  try{
    await api('/daily-tasks/roles',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:roleId,name:name})});
    var role=(state.data.roles||[]).find(function(r){return r.id===roleId;});
    if(role)role.name=name;
  }catch(e){toast_dash('Could not rename role: '+e.message);renderManageRolesTasks();}
}
async function removeDailyTaskRole(roleId,name){
  if(!confirm('Delete "'+name+'" and every task under it? This also removes its checklist history.'))return;
  try{
    await api('/daily-tasks/roles?id='+encodeURIComponent(roleId),{method:'DELETE'});
    state.data.roles=(state.data.roles||[]).filter(function(r){return r.id!==roleId;});
    renderManageRolesTasks();
  }catch(e){toast_dash('Could not delete role: '+e.message);}
}

async function addDailyTaskItem(roleId){
  var title=(prompt('Task title:')||'').trim();
  if(!title)return;
  try{
    var role=(state.data.roles||[]).find(function(r){return r.id===roleId;});
    var d=await api('/daily-tasks/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roleId:roleId,title:title,sortOrder:role?(role.tasks||[]).length:0})});
    if(role)role.tasks=(role.tasks||[]).concat([{id:d.item.id,roleId:roleId,title:d.item.title,detail:'',daysOfWeek:d.item.days_of_week,active:true,completed:false}]);
    renderManageRolesTasks();
  }catch(e){toast_dash('Could not add task: '+e.message);}
}
async function renameDailyTaskItem(taskId,title){
  title=(title||'').trim();
  if(!title){toast_dash('Task title cannot be blank');renderManageRolesTasks();return;}
  try{
    await api('/daily-tasks/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:taskId,title:title})});
    var found=findTaskAndRole(taskId);
    if(found)found.task.title=title;
  }catch(e){toast_dash('Could not rename task: '+e.message);renderManageRolesTasks();}
}
async function setDailyTaskDetail(taskId,detail){
  try{
    await api('/daily-tasks/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:taskId,detail:detail||''})});
    var found=findTaskAndRole(taskId);
    if(found)found.task.detail=detail||'';
  }catch(e){toast_dash('Could not update task: '+e.message);renderManageRolesTasks();}
}
async function toggleDailyTaskDay(taskId,dayIndex){
  var found=findTaskAndRole(taskId);if(!found)return;
  var days=(found.task.daysOfWeek||[]).slice();
  var idx=days.indexOf(dayIndex);
  if(idx===-1)days.push(dayIndex);else days.splice(idx,1);
  try{
    await api('/daily-tasks/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:taskId,daysOfWeek:days})});
    found.task.daysOfWeek=days.slice().sort(function(a,b){return a-b;});
    renderManageRolesTasks();
  }catch(e){toast_dash('Could not update days: '+e.message);}
}
async function removeDailyTaskItem(taskId,title){
  if(!confirm('Delete task "'+title+'"?'))return;
  try{
    await api('/daily-tasks/items?id='+encodeURIComponent(taskId),{method:'DELETE'});
    var found=findTaskAndRole(taskId);
    if(found)found.role.tasks=(found.role.tasks||[]).filter(function(t){return t.id!==taskId;});
    renderManageRolesTasks();
  }catch(e){toast_dash('Could not delete task: '+e.message);}
}

window.ensureDailyTasksPanel=ensureDailyTasksPanel;
window.toggleDailyTask=toggleDailyTask;
window.shiftDailyTasksDay=shiftDay;
window.jumpToTodayDailyTasks=jumpToToday;
window.openManageRolesTasks=openManageRolesTasks;
window.closeManageRolesTasks=closeManageRolesTasks;
window.addDailyTaskRole=addDailyTaskRole;
window.renameDailyTaskRole=renameDailyTaskRole;
window.removeDailyTaskRole=removeDailyTaskRole;
window.addDailyTaskItem=addDailyTaskItem;
window.renameDailyTaskItem=renameDailyTaskItem;
window.setDailyTaskDetail=setDailyTaskDetail;
window.toggleDailyTaskDay=toggleDailyTaskDay;
window.removeDailyTaskItem=removeDailyTaskItem;
})();
