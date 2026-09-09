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
// Store report: "Uncaught ReferenceError: esc is not defined" -- this file
// calls esc() throughout (matching foc-dashboard.js's own convention) but,
// unlike that file, never actually defined it. dashboard.html's own global
// helper is escHtml, not esc, and foc-dashboard.js's esc is private to its
// own IIFE, not shared across module files -- this never surfaced before
// because every render call used to fail earlier, on the storeId bug, well
// before reaching any code that calls esc().
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
var DOW_LABELS=['S','M','T','W','T','F','S'];
var DOW_NAMES=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var state={ date:todayLocalDateStr(), data:null, view:'today', loading:false, members:null, filters:{role:'',assignee:'',status:''} };

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
    var d=await api('/daily-tasks?store_id='+encodeURIComponent(getActiveStoreId())+'&date='+encodeURIComponent(dateStr));
    state.date=d.date;
    state.data=d;
  }catch(e){
    host.innerHTML='<div class="panel" style="padding:20px"><div class="empty-t" style="color:var(--red)">Could not load tasks: '+esc(e.message)+'</div></div>';
    state.loading=false;
    return;
  }
  state.loading=false;
  renderCurrentView();
  refreshDailyTasksBadge();
}

function renderCurrentView(){
  if(state.view==='manage')renderManageRolesTasks();
  else if(state.view==='all')renderAllTasksView();
  else renderDailyTasksHome();
}

function switchDailyTasksView(view){
  state.view=view;
  renderCurrentView();
}

// Home-screen alert chip (dealer status bar): a lightweight, independent
// poll so "today's tasks" stays visible no matter which tab is open, not
// just while the Tasks panel itself is mounted. Only shown once there's
// something actually outstanding -- a 0/0 chip on a day nothing's
// scheduled would just be clutter, not an alert.
function refreshDailyTasksBadge(){
  var val=document.getElementById('dsb-tasks-val');
  var chip=document.getElementById('dsb-tasks');
  if(!val||!chip)return;
  if(typeof getActiveStoreId!=='function'||!getActiveStoreId())return;
  api('/daily-tasks?store_id='+encodeURIComponent(getActiveStoreId())+'&date='+encodeURIComponent(todayLocalDateStr())).then(function(d){
    var due=0,done=0;
    (d.roles||[]).forEach(function(r){(r.tasks||[]).forEach(function(t){if(t.dueToday&&t.active!==false){due++;if(t.completed)done++;}});});
    val.textContent=done+'/'+due;
    chip.style.display=due>0?'':'none';
    chip.classList.toggle('dsb-tasks-active',due>0&&done<due);
  }).catch(function(){});
}
setInterval(function(){ if(!document.hidden) refreshDailyTasksBadge(); }, 90000);
setTimeout(refreshDailyTasksBadge, 3000);

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
          '<button class="hbtn" onclick="switchDailyTasksView(\'all\')">ALL TASKS · FILTER</button>'+
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
      (t.assignedToLabel?'<div style="font-family:var(--font-mono);font-size:8px;color:var(--dim);margin-top:2px">assigned to '+esc(t.assignedToLabel)+'</div>':'')+
      (t.completed&&t.completedBy?'<div style="font-family:var(--font-mono);font-size:8px;color:var(--dim);margin-top:2px">checked off by '+esc(t.completedBy)+'</div>':'')+
    '</span>'+
  '</label>';
}

async function toggleDailyTask(taskId,checked){
  try{
    await api('/daily-tasks/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),taskId:taskId,date:state.date,completed:checked})});
    var role=(state.data.roles||[]).find(function(r){return (r.tasks||[]).some(function(t){return t.id===taskId;});});
    var task=role&&role.tasks.find(function(t){return t.id===taskId;});
    if(task){task.completed=checked;}
    renderCurrentView();
    refreshDailyTasksBadge();
  }catch(e){toast_dash('Could not update task: '+e.message);}
}

// ── MANAGE ROLES & TASKS (owner/admin/manager) ──────────────────────────
async function openManageRolesTasks(){
  if(!canManageTasks())return;
  state.view='manage';
  if(!state.members){
    try{ state.members=typeof loadStoreMembers==='function'?await loadStoreMembers():[]; }
    catch(e){ state.members=[]; }
  }
  renderManageRolesTasks();
}
function closeManageRolesTasks(){
  switchDailyTasksView('today');
}

function renderManageRolesTasks(){
  var host=panel();if(!host||!state.data)return;
  var roles=state.data.roles||[];
  host.innerHTML=
    '<div class="panel" style="padding:14px;margin-bottom:12px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'+
        '<div class="ph" style="margin:0">MANAGE ROLES &amp; TASKS</div>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
          '<button class="hbtn" style="color:var(--g)" onclick="addDailyTaskRole()">+ ADD ROLE</button>'+
          '<button class="hbtn" onclick="switchDailyTasksView(\'all\')">ALL TASKS · FILTER</button>'+
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
    return '<button type="button" class="hbtn" style="min-width:26px;padding:4px 0;font-size:9px;'+(on?'color:var(--g);border-color:rgba(0,255,179,.4)':'color:var(--dim)')+'" onclick="toggleDailyTaskDay(\''+esc(taskId)+'\','+i+')" title="'+DOW_NAMES[i]+'">'+label+'</button>';
  }).join('');
}

// Read-only compact rendering of the same days-of-week, used in ALL TASKS
// (a real month calendar would be the wrong model here -- these tasks
// don't repeat on specific dates, they repeat on weekdays, identically
// every week, so a 7-dot weekday strip shows the actual recurrence
// pattern more directly than a monthly grid full of duplicate entries).
function dowDotsHtml(daysOfWeek){
  return '<span style="letter-spacing:2px">'+DOW_LABELS.map(function(l,i){
    var on=(daysOfWeek||[]).includes(i);
    return '<span style="'+(on?'color:var(--g);font-weight:700':'color:var(--dim);opacity:.35')+'" title="'+DOW_NAMES[i]+'">'+l+'</span>';
  }).join('')+'</span>';
}

function assigneeSelectHtml(t){
  var members=state.members||[];
  return '<select class="tsi" onchange="setDailyTaskAssignee(\''+esc(t.id)+'\',this.value,this.options[this.selectedIndex].text)">'+
    '<option value=""'+(!t.assignedToUserId?' selected':'')+'>Anyone in role</option>'+
    members.map(function(m){
      var uid=m.user_id||m.id;
      var label=m.displayName||m.email||uid;
      return '<option value="'+esc(uid)+'"'+(t.assignedToUserId===uid?' selected':'')+'>'+esc(label)+'</option>';
    }).join('')+
  '</select>';
}

function renderManageTaskRow(t){
  return '<div style="padding:8px 0;border-bottom:1px solid var(--border)">'+
    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">'+
      '<input type="text" value="'+esc(t.title)+'" style="flex:1" class="tsi" placeholder="Task title" onchange="renameDailyTaskItem(\''+esc(t.id)+'\',this.value)">'+
      '<button class="hbtn" style="color:var(--red);padding:6px 10px" onclick="removeDailyTaskItem(\''+esc(t.id)+'\',\''+esc(t.title.replace(/'/g,"\\'"))+'\')">✕</button>'+
    '</div>'+
    '<input type="text" value="'+esc(t.detail||'')+'" style="width:100%;margin-bottom:6px" class="tsi" placeholder="Optional detail/note" onchange="setDailyTaskDetail(\''+esc(t.id)+'\',this.value)">'+
    '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">'+
      '<div style="display:flex;gap:4px;align-items:center">'+
        '<span style="font-family:var(--font-mono);font-size:8px;color:var(--dim);margin-right:4px">DAYS:</span>'+
        dowChipsHtml(t.id,t.daysOfWeek)+
      '</div>'+
      '<div style="display:flex;gap:4px;align-items:center">'+
        '<span style="font-family:var(--font-mono);font-size:8px;color:var(--dim)">ASSIGNED:</span>'+
        assigneeSelectHtml(t)+
      '</div>'+
    '</div>'+
  '</div>';
}

async function setDailyTaskAssignee(taskId,userId,label){
  try{
    await api('/daily-tasks/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),id:taskId,assignedToUserId:userId||null,assignedToLabel:userId?label:''})});
    var found=findTaskAndRole(taskId);
    if(found){found.task.assignedToUserId=userId||null;found.task.assignedToLabel=userId?label:'';}
  }catch(e){toast_dash('Could not set assignee: '+e.message);renderManageRolesTasks();}
}

// ── ALL TASKS · FILTER (any staff member -- read-only across every role) ─
function uniqueAssignees(allTasks){
  var map={};
  allTasks.forEach(function(x){
    if(x.task.assignedToUserId&&!map[x.task.assignedToUserId]) map[x.task.assignedToUserId]={id:x.task.assignedToUserId,label:x.task.assignedToLabel||'Assigned'};
  });
  return Object.keys(map).map(function(k){return map[k];}).sort(function(a,b){return a.label.localeCompare(b.label);});
}

function renderAllTasksView(){
  var host=panel();if(!host||!state.data)return;
  var roles=state.data.roles||[];
  var allTasks=[];
  roles.forEach(function(r){(r.tasks||[]).forEach(function(t){if(t.active!==false)allTasks.push({task:t,role:r});});});
  var assignees=uniqueAssignees(allTasks);
  var f=state.filters;
  var filtered=allTasks.filter(function(x){
    if(f.role&&x.role.id!==f.role)return false;
    if(f.assignee==='__unassigned__'&&x.task.assignedToUserId)return false;
    if(f.assignee&&f.assignee!=='__unassigned__'&&x.task.assignedToUserId!==f.assignee)return false;
    if(f.status==='due'&&!x.task.dueToday)return false;
    if(f.status==='notdue'&&x.task.dueToday)return false;
    if(f.status==='done'&&!(x.task.dueToday&&x.task.completed))return false;
    if(f.status==='pending'&&!(x.task.dueToday&&!x.task.completed))return false;
    return true;
  });
  host.innerHTML=
    '<div class="panel" style="padding:14px;margin-bottom:12px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">'+
        '<div class="ph" style="margin:0">ALL TASKS <span style="font-size:9px;color:var(--dim)">'+esc(formatDateLabel(state.date))+(state.date===todayLocalDateStr()?' · TODAY':'')+'</span></div>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
          '<button class="hbtn" onclick="shiftDailyTasksDay(-1)">← PREV DAY</button>'+
          '<button class="hbtn" onclick="shiftDailyTasksDay(1)">NEXT DAY →</button>'+
          '<button class="hbtn" onclick="switchDailyTasksView(\'today\')">← TODAY\'S CHECKLIST</button>'+
          (canManageTasks()?'<button class="hbtn" style="color:var(--gold)" onclick="openManageRolesTasks()">MANAGE ROLES &amp; TASKS</button>':'')+
        '</div>'+
      '</div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
        '<select class="tsi" onchange="setDailyTasksFilter(\'role\',this.value)">'+
          '<option value=""'+(f.role===''?' selected':'')+'>All roles</option>'+
          roles.map(function(r){return '<option value="'+esc(r.id)+'"'+(f.role===r.id?' selected':'')+'>'+esc(r.name)+'</option>';}).join('')+
        '</select>'+
        '<select class="tsi" onchange="setDailyTasksFilter(\'assignee\',this.value)">'+
          '<option value=""'+(f.assignee===''?' selected':'')+'>All assignees</option>'+
          '<option value="__unassigned__"'+(f.assignee==='__unassigned__'?' selected':'')+'>Anyone in role (unassigned)</option>'+
          assignees.map(function(a){return '<option value="'+esc(a.id)+'"'+(f.assignee===a.id?' selected':'')+'>'+esc(a.label)+'</option>';}).join('')+
        '</select>'+
        '<select class="tsi" onchange="setDailyTasksFilter(\'status\',this.value)">'+
          '<option value=""'+(f.status===''?' selected':'')+'>All statuses</option>'+
          '<option value="due"'+(f.status==='due'?' selected':'')+'>Due this day</option>'+
          '<option value="notdue"'+(f.status==='notdue'?' selected':'')+'>Not scheduled this day</option>'+
          '<option value="done"'+(f.status==='done'?' selected':'')+'>Done</option>'+
          '<option value="pending"'+(f.status==='pending'?' selected':'')+'>Pending</option>'+
        '</select>'+
      '</div>'+
    '</div>'+
    '<div class="panel" style="padding:0;overflow-x:auto">'+
      '<table style="width:100%;border-collapse:collapse;font-family:var(--font-mono);font-size:10px">'+
      '<thead><tr style="text-align:left;border-bottom:1px solid var(--border);color:var(--dim)">'+
        '<th style="padding:8px">TASK</th><th style="padding:8px">ROLE</th><th style="padding:8px">ASSIGNED TO</th><th style="padding:8px">REPEATS</th><th style="padding:8px">STATUS</th>'+
      '</tr></thead><tbody>'+
      (filtered.length?filtered.map(function(x){return allTasksRowHtml(x.task,x.role);}).join(''):
        '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--dim)">No tasks match this filter.</td></tr>')+
      '</tbody></table>'+
    '</div>';
}

function allTasksRowHtml(t,role){
  var statusCell;
  if(!t.dueToday) statusCell='<span style="color:var(--dim)">not scheduled</span>';
  else if(t.completed) statusCell='<span style="color:var(--g)">✓ done'+(t.completedBy?' — '+esc(t.completedBy):'')+'</span>';
  else statusCell='<span style="color:var(--gold)">pending</span>';
  return '<tr style="border-bottom:1px solid var(--border)">'+
    '<td style="padding:8px;color:var(--text)">'+esc(t.title)+(t.detail?'<div style="color:var(--dim);font-size:9px;margin-top:2px">'+esc(t.detail)+'</div>':'')+'</td>'+
    '<td style="padding:8px">'+esc(role.name)+'</td>'+
    '<td style="padding:8px">'+(t.assignedToLabel?esc(t.assignedToLabel):'<span style="color:var(--dim)">anyone in role</span>')+'</td>'+
    '<td style="padding:8px">'+dowDotsHtml(t.daysOfWeek)+'</td>'+
    '<td style="padding:8px">'+statusCell+'</td>'+
  '</tr>';
}

function setDailyTasksFilter(key,val){
  state.filters[key]=val;
  renderAllTasksView();
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
    var d=await api('/daily-tasks/roles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),name:name,sortOrder:(state.data.roles||[]).length})});
    state.data.roles=(state.data.roles||[]).concat([{id:d.role.id,name:d.role.name,sortOrder:d.role.sort_order,tasks:[]}]);
    renderManageRolesTasks();
  }catch(e){toast_dash('Could not add role: '+e.message);}
}
async function renameDailyTaskRole(roleId,name){
  name=(name||'').trim();
  if(!name){toast_dash('Role name cannot be blank');renderManageRolesTasks();return;}
  try{
    await api('/daily-tasks/roles',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),id:roleId,name:name})});
    var role=(state.data.roles||[]).find(function(r){return r.id===roleId;});
    if(role)role.name=name;
  }catch(e){toast_dash('Could not rename role: '+e.message);renderManageRolesTasks();}
}
async function removeDailyTaskRole(roleId,name){
  if(!confirm('Delete "'+name+'" and every task under it? This also removes its checklist history.'))return;
  try{
    await api('/daily-tasks/roles?store_id='+encodeURIComponent(getActiveStoreId())+'&id='+encodeURIComponent(roleId),{method:'DELETE'});
    state.data.roles=(state.data.roles||[]).filter(function(r){return r.id!==roleId;});
    renderManageRolesTasks();
  }catch(e){toast_dash('Could not delete role: '+e.message);}
}

async function addDailyTaskItem(roleId){
  var title=(prompt('Task title:')||'').trim();
  if(!title)return;
  try{
    var role=(state.data.roles||[]).find(function(r){return r.id===roleId;});
    var d=await api('/daily-tasks/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),roleId:roleId,title:title,sortOrder:role?(role.tasks||[]).length:0})});
    if(role)role.tasks=(role.tasks||[]).concat([{id:d.item.id,roleId:roleId,title:d.item.title,detail:'',daysOfWeek:d.item.days_of_week,active:true,completed:false}]);
    renderManageRolesTasks();
  }catch(e){toast_dash('Could not add task: '+e.message);}
}
async function renameDailyTaskItem(taskId,title){
  title=(title||'').trim();
  if(!title){toast_dash('Task title cannot be blank');renderManageRolesTasks();return;}
  try{
    await api('/daily-tasks/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),id:taskId,title:title})});
    var found=findTaskAndRole(taskId);
    if(found)found.task.title=title;
  }catch(e){toast_dash('Could not rename task: '+e.message);renderManageRolesTasks();}
}
async function setDailyTaskDetail(taskId,detail){
  try{
    await api('/daily-tasks/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),id:taskId,detail:detail||''})});
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
    await api('/daily-tasks/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),id:taskId,daysOfWeek:days})});
    found.task.daysOfWeek=days.slice().sort(function(a,b){return a-b;});
    renderManageRolesTasks();
  }catch(e){toast_dash('Could not update days: '+e.message);}
}
async function removeDailyTaskItem(taskId,title){
  if(!confirm('Delete task "'+title+'"?'))return;
  try{
    await api('/daily-tasks/items?store_id='+encodeURIComponent(getActiveStoreId())+'&id='+encodeURIComponent(taskId),{method:'DELETE'});
    var found=findTaskAndRole(taskId);
    if(found)found.role.tasks=(found.role.tasks||[]).filter(function(t){return t.id!==taskId;});
    renderManageRolesTasks();
  }catch(e){toast_dash('Could not delete task: '+e.message);}
}

window.ensureDailyTasksPanel=ensureDailyTasksPanel;
window.toggleDailyTask=toggleDailyTask;
window.shiftDailyTasksDay=shiftDay;
window.jumpToTodayDailyTasks=jumpToToday;
window.switchDailyTasksView=switchDailyTasksView;
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
window.setDailyTaskAssignee=setDailyTaskAssignee;
window.setDailyTasksFilter=setDailyTasksFilter;
})();
