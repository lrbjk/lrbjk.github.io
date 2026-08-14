(() => {
  'use strict';
  const STORAGE_KEY = 'combat-flow-workspace-v2';
  const DB_NAME = 'combat-flow-assets';
  const DB_STORE = 'files';
  const nodeTypes = {
    root:{label:'入口',group:'控制',icon:'◎',summary:'逻辑图的唯一入口'},
    selector:{label:'选择器',group:'控制',icon:'?',summary:'从上到下选择可执行分支'},
    sequence:{label:'序列',group:'控制',icon:'⋮',summary:'按顺序执行所有子节点'},
    parallel:{label:'并行',group:'控制',icon:'≋',summary:'同时启动多个子节点'},
    condition:{label:'条件',group:'判断',icon:'◇',summary:'根据条件决定后续分支'},
    cooldown:{label:'冷却',group:'判断',icon:'◷',summary:'限制执行频率或等待时间'},
    action:{label:'动作',group:'执行',icon:'▶',summary:'执行动画、移动或技能'},
    note:{label:'备注',group:'文档',icon:'Aa',summary:'补充设计意图和说明'}
  };
  const nowId = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => { const d=document.createElement('div'); d.textContent=String(value??''); return d.innerHTML; };
  const defaultProject = () => ({
    version:2,
    name:'苍烬 · 战斗原型',
    activeFlowId:'flow_enemy',
    assets:[],
    flows:[
      {id:'flow_enemy',name:'巡猎者 · 战斗 AI',type:'behavior',description:'中距离敌人的完整战斗决策。',view:{x:55,y:55,scale:1},nodes:[
        {id:'root_1',type:'root',name:'战斗入口',description:'每 0.2 秒重新评估战场状态',x:70,y:220,tags:['入口'],params:[{key:'tick',value:'0.2s'}],assetIds:[]},
        {id:'cond_range',type:'condition',name:'攻击距离判断',description:'目标是否进入有效攻击范围',x:330,y:105,tags:['距离'],params:[{key:'distance',value:'6.5m'},{key:'stamina',value:'> 20'}],assetIds:[]},
        {id:'cond_visible',type:'condition',name:'目标可见判断',description:'检查视野角度和场景遮挡',x:330,y:330,tags:['感知'],params:[{key:'fov',value:'120°'},{key:'occlusion',value:'true'}],assetIds:[]},
        {id:'act_combo',type:'action',name:'三连斩',description:'近距离主要输出动作',x:620,y:60,tags:['近战','高优先级'],params:[{key:'skillId',value:'SKILL_08'},{key:'windup',value:'0.28s'}],assetIds:[]},
        {id:'act_dodge',type:'cooldown',name:'侧向闪避',description:'攻击不可用时进行防御位移',x:620,y:210,tags:['位移'],params:[{key:'cooldown',value:'2.4s'},{key:'invincible',value:'0.18s'}],assetIds:[]},
        {id:'act_chase',type:'action',name:'冲刺追踪',description:'目标可见但不在攻击范围时追击',x:620,y:365,tags:['追踪'],params:[{key:'maxDistance',value:'12m'}],assetIds:[]}
      ],edges:[
        {id:'e1',from:'root_1',to:'cond_range',label:'优先评估',condition:'',priority:0,weight:100},
        {id:'e2',from:'root_1',to:'cond_visible',label:'感知评估',condition:'',priority:1,weight:100},
        {id:'e3',from:'cond_range',to:'act_combo',label:'满足',condition:'distance <= 6.5 && stamina > 20',priority:0,weight:70},
        {id:'e4',from:'cond_range',to:'act_dodge',label:'技能冷却',condition:'skillOnCooldown == true',priority:1,weight:30},
        {id:'e5',from:'cond_visible',to:'act_chase',label:'可见',condition:'hasLineOfSight == true',priority:0,weight:100}
      ]},
      {id:'flow_skill',name:'玩家轻攻击连段',type:'skill',description:'输入窗口、派生与收招控制。',view:{x:60,y:80,scale:1},nodes:[
        {id:'skill_root',type:'root',name:'轻攻击输入',description:'接收到轻攻击输入',x:80,y:220,tags:['输入'],params:[{key:'input',value:'AttackLight'}],assetIds:[]},
        {id:'skill_a1',type:'action',name:'第一段 · 横斩',description:'基础起手攻击',x:360,y:100,tags:['攻击'],params:[{key:'damage',value:'18'},{key:'duration',value:'0.62s'}],assetIds:[]},
        {id:'skill_window',type:'condition',name:'派生窗口',description:'窗口内再次输入可进入第二段',x:360,y:330,tags:['输入窗口'],params:[{key:'start',value:'0.34s'},{key:'end',value:'0.62s'}],assetIds:[]},
        {id:'skill_a2',type:'action',name:'第二段 · 回旋',description:'向前位移并进行范围攻击',x:660,y:100,tags:['攻击','位移'],params:[{key:'damage',value:'24'},{key:'move',value:'1.2m'}],assetIds:[]},
        {id:'skill_end',type:'cooldown',name:'收招恢复',description:'恢复玩家控制',x:660,y:330,tags:['恢复'],params:[{key:'recovery',value:'0.32s'}],assetIds:[]}
      ],edges:[
        {id:'se1',from:'skill_root',to:'skill_a1',label:'按下',condition:'pressed == true',priority:0,weight:100},
        {id:'se2',from:'skill_a1',to:'skill_window',label:'进入窗口',condition:'normalizedTime >= 0.55',priority:0,weight:100},
        {id:'se3',from:'skill_window',to:'skill_a2',label:'再次输入',condition:'bufferedInput == true',priority:0,weight:100},
        {id:'se4',from:'skill_window',to:'skill_end',label:'超时',condition:'windowExpired == true',priority:1,weight:100},
        {id:'se5',from:'skill_a2',to:'skill_end',label:'完成',condition:'',priority:0,weight:100}
      ]}
    ]
  });

  let project = loadProject();
  let selected = {kind:'flow',id:project.activeFlowId};
  let pendingConnection = null;
  let undoStack = [], redoStack = [];
  let simulationTimer = null;
  let objectUrls = new Map();
  let dragState = null, panState = null;
  let modalAction = null;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  function loadProject(){
    try{
      const stored=localStorage.getItem(STORAGE_KEY);
      if(stored){ const value=JSON.parse(stored); if(value.version===2 && value.flows?.length) return value; }
    }catch(error){ console.warn('Could not load project',error); }
    return defaultProject();
  }
  function activeFlow(){ return project.flows.find(flow=>flow.id===project.activeFlowId) || project.flows[0]; }
  function commit(mutator,{render=true}={}){
    undoStack.push(clone(project)); if(undoStack.length>40) undoStack.shift(); redoStack=[];
    mutator(); saveProject(); if(render) renderAll();
  }
  function saveProject(){
    $('#saveState')?.classList.add('saving'); if($('#saveState span')) $('#saveState span').textContent='正在保存…';
    clearTimeout(saveProject.timer);
    saveProject.timer=setTimeout(()=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(project)); $('#saveState')?.classList.remove('saving'); if($('#saveState span')) $('#saveState span').textContent='已保存到本机';},220);
  }
  function undo(){ if(!undoStack.length) return toast('没有可撤销的操作'); redoStack.push(clone(project)); project=undoStack.pop(); selected={kind:'flow',id:project.activeFlowId}; pendingConnection=null; saveProject(); renderAll(); }
  function redo(){ if(!redoStack.length) return toast('没有可重做的操作'); undoStack.push(clone(project)); project=redoStack.pop(); selected={kind:'flow',id:project.activeFlowId}; pendingConnection=null; saveProject(); renderAll(); }

  function mount(){
    document.onpaste=null;
    window.onresize=null;
    document.querySelectorAll('link[href*="styles-v2.css"]').forEach(x=>x.remove());
    const css=document.createElement('link'); css.rel='stylesheet'; css.href='./styles-v2.css?v=4'; document.head.appendChild(css);
    document.body.innerHTML=`<div class="app-shell">
      <header class="topbar"><div class="brand"><span class="brand-mark">CF</span><span>Combat Flow</span></div><button class="project-title" id="projectTitle"></button><div class="save-state" id="saveState"><i></i><span>已保存到本机</span></div><div class="top-actions"><button class="btn ghost" id="undoBtn" title="撤销 Ctrl+Z">↶</button><button class="btn ghost" id="redoBtn" title="重做 Ctrl+Shift+Z">↷</button><button class="btn ghost" id="importBtn">导入</button><button class="btn ghost" id="exportBtn">导出</button><button class="btn primary" id="runBtn">▶ 模拟运行</button><input id="importInput" type="file" accept="application/json,.json" hidden></div></header>
      <div class="workspace"><aside class="left-panel">
        <section class="panel-section flow-section"><div class="section-heading"><div><span class="kicker">DESIGN DOCUMENT</span><h2>逻辑图</h2></div><button class="icon-btn" id="newFlowBtn">＋</button></div><div class="flow-list" id="flowList"></div></section>
        <section class="panel-section library-section"><div class="section-heading"><div><span class="kicker">NODE LIBRARY</span><h2>节点库</h2></div></div><label class="search-box"><span>⌕</span><input id="nodeSearch" placeholder="搜索节点"></label><div class="node-library" id="nodeLibrary"></div></section>
        <section class="panel-section asset-section"><div class="section-heading"><div><span class="kicker">REFERENCES</span><h2>参考素材</h2></div><button class="icon-btn" id="addUrlBtn">＋</button></div><label class="asset-drop" id="assetDrop"><input id="assetInput" type="file" multiple accept="image/*,video/*"><strong>拖入或粘贴图片 / 视频</strong><span>素材保存在当前浏览器</span></label><div class="asset-list" id="assetList"></div></section>
      </aside><main class="editor"><div class="editor-toolbar"><div class="flow-identity"><span class="flow-kind" id="flowKind"></span><strong id="flowName"></strong></div><div class="validation-summary" id="validationSummary"></div><div class="canvas-actions"><button class="btn small" id="validateBtn">检查逻辑</button><button class="btn small" id="fitBtn">适配视图</button><button class="btn small" id="zoomOutBtn">−</button><span id="zoomLabel">100%</span><button class="btn small" id="zoomInBtn">＋</button></div></div><div class="canvas-viewport" id="canvasViewport"><div class="canvas-scene" id="canvasScene"><svg class="edge-layer" id="edgeLayer"></svg><div class="node-layer" id="nodeLayer"></div></div><div class="canvas-help"><b>拖动</b>节点 · <b>拖动画布</b>平移 · <b>滚轮</b>缩放 · 点击输出点后再点击输入点完成连线</div><div class="connect-toast" id="connectToast">请选择目标节点的输入点 <button id="cancelConnect">取消</button></div><div class="minimap" id="minimap"><div id="minimapNodes"></div><i id="minimapViewport"></i></div></div></main>
      <aside class="right-panel"><button class="inspector-close" id="inspectorCloseBtn" title="关闭编辑器">×</button><div class="empty-inspector" id="emptyInspector"><div class="empty-icon">◎</div><h2>选择节点或连线</h2><p>在这里编辑参数、分支条件和引用素材。</p></div><div class="inspector" id="nodeInspector" hidden><div class="inspector-title"><div><span class="kicker" id="nodeTypeLabel"></span><h2 id="nodeInspectorTitle"></h2></div><button class="icon-btn danger-text" id="deleteNodeBtn">⌫</button></div><div class="inspector-body"><label class="field"><span>节点名称</span><input id="nodeNameInput"></label><label class="field"><span>策划说明</span><textarea id="nodeDescriptionInput"></textarea></label><label class="field"><span>节点标签</span><input id="nodeTagsInput" placeholder="近战, 高优先级"></label><div class="field"><span>参数</span><div id="parameterList" class="parameter-list"></div><button class="btn full" id="addParameterBtn">＋ 添加参数</button></div><div class="field"><span>引用素材</span><div id="attachedAssets" class="attached-assets"></div><p class="field-hint">在左侧素材卡片点击“关联”。</p></div><div class="runtime-preview"><span>运行标识</span><code id="runtimeId"></code></div></div></div><div class="inspector" id="edgeInspector" hidden><div class="inspector-title"><div><span class="kicker">TRANSITION</span><h2>分支连线</h2></div><button class="icon-btn danger-text" id="deleteEdgeBtn">⌫</button></div><div class="inspector-body"><label class="field"><span>分支名称</span><input id="edgeLabelInput"></label><label class="field"><span>条件表达式</span><textarea id="edgeConditionInput"></textarea></label><label class="field"><span>优先级</span><input id="edgePriorityInput" type="number" min="0"></label><label class="field"><span>权重</span><input id="edgeWeightInput" type="number" min="0" max="100"></label></div></div><div class="inspector" id="flowInspector" hidden><div class="inspector-title"><div><span class="kicker">FLOW SETTINGS</span><h2>逻辑图设置</h2></div></div><div class="inspector-body"><label class="field"><span>名称</span><input id="flowNameInput"></label><label class="field"><span>类型</span><select id="flowTypeInput"><option value="behavior">敌人行为树</option><option value="skill">玩家技能流</option><option value="state">状态机</option></select></label><label class="field"><span>说明</span><textarea id="flowDescriptionInput"></textarea></label><button class="btn full danger" id="deleteFlowBtn">删除当前逻辑图</button></div></div></aside></div></div>
      <div class="modal-backdrop" id="modalBackdrop" hidden><div class="modal"><header><h2 id="modalTitle"></h2><button class="icon-btn" id="modalClose">×</button></header><div class="modal-content" id="modalContent"></div><footer><button class="btn" id="modalCancel">取消</button><button class="btn primary" id="modalConfirm">确认</button></footer></div></div><div class="toast" id="toast"></div>`;
    bindStatic(); renderAll();
  }

  function renderAll(){
    $('#projectTitle').textContent=project.name;
    renderFlows(); renderLibrary(); renderCanvas(); renderAssets(); renderInspector(); validateFlow(false);
  }
  function renderFlows(){
    $('#flowList').innerHTML=project.flows.map(flow=>`<button class="flow-row ${flow.id===project.activeFlowId?'active':''}" data-flow-id="${flow.id}"><span class="flow-icon">${flow.type==='skill'?'◇':flow.type==='state'?'Ⅱ':'♞'}</span><span><b>${esc(flow.name)}</b><small>${flow.nodes.length} 节点 · ${flow.edges.length} 连线</small></span><span class="flow-menu">•••</span></button>`).join('');
    $$('.flow-row').forEach(button=>button.onclick=()=>{project.activeFlowId=button.dataset.flowId; selected={kind:'flow',id:project.activeFlowId}; pendingConnection=null; saveProject(); renderAll();});
  }
  function renderLibrary(){
    const q=($('#nodeSearch')?.value||'').trim().toLowerCase();
    const entries=Object.entries(nodeTypes).filter(([,v])=>!q||v.label.includes(q)||v.summary.toLowerCase().includes(q));
    const groups=[...new Set(entries.map(([,v])=>v.group))];
    $('#nodeLibrary').innerHTML=groups.map(group=>`<div class="library-group"><h3>${group}</h3><div class="library-items">${entries.filter(([,v])=>v.group===group).map(([type,v])=>`<button class="library-node" data-type="${type}" title="${v.summary}"><i></i>${v.label}</button>`).join('')}</div></div>`).join('');
    $$('.library-node').forEach(button=>button.onclick=()=>addNode(button.dataset.type));
  }
  function renderCanvas(){
    const flow=activeFlow(), view=flow.view||{x:0,y:0,scale:1};
    $('#flowKind').textContent=({behavior:'BEHAVIOR TREE',skill:'SKILL FLOW',state:'STATE MACHINE'})[flow.type]; $('#flowName').textContent=flow.name;
    $('#canvasScene').style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`; $('#zoomLabel').textContent=`${Math.round(view.scale*100)}%`;
    $('#nodeLayer').innerHTML=flow.nodes.map(node=>`<article class="graph-node ${node.type} ${selected.kind==='node'&&selected.id===node.id?'selected':''}" data-node-id="${node.id}" style="left:${node.x}px;top:${node.y}px"><button class="port in" aria-label="输入点"></button><div class="node-header"><span class="node-glyph">${nodeTypes[node.type]?.icon||'•'}</span><span class="node-copy"><b>${esc(node.name)}</b><small>${nodeTypes[node.type]?.label||node.type} · ${node.id}</small></span></div><div class="node-summary">${esc(node.description||nodeTypes[node.type]?.summary||'')}<div class="node-tags">${(node.tags||[]).slice(0,3).map(tag=>`<i>${esc(tag)}</i>`).join('')}</div></div><button class="port out ${pendingConnection===node.id?'pending':''}" aria-label="输出点"></button></article>`).join('');
    bindNodes(); renderEdges(); renderMinimap(); $('#connectToast').classList.toggle('show',!!pendingConnection);
  }
  function renderEdges(){
    const flow=activeFlow();
    $('#edgeLayer').setAttribute('viewBox','0 0 2600 1800');
    $('#edgeLayer').innerHTML=flow.edges.map(edge=>{
      const a=flow.nodes.find(n=>n.id===edge.from),b=flow.nodes.find(n=>n.id===edge.to); if(!a||!b)return'';
      const x1=a.x+196,y1=a.y+32,x2=b.x,y2=b.y+32,c=Math.max(60,Math.abs(x2-x1)*.48),d=`M${x1} ${y1} C${x1+c} ${y1} ${x2-c} ${y2} ${x2} ${y2}`,mx=(x1+x2)/2,my=(y1+y2)/2;
      return `<g data-edge-id="${edge.id}"><path class="edge-hit" d="${d}"></path><path class="edge-line ${selected.kind==='edge'&&selected.id===edge.id?'selected':''}" d="${d}"></path>${edge.label?`<rect class="edge-label-bg" x="${mx-34}" y="${my-11}" width="68" height="20" rx="5"></rect><text class="edge-label" x="${mx}" y="${my+3}" text-anchor="middle">${esc(edge.label).slice(0,12)}</text>`:''}</g>`;
    }).join('');
    $$('.edge-hit').forEach(path=>path.onclick=e=>{e.stopPropagation();const id=path.parentElement.dataset.edgeId;selected={kind:'edge',id};pendingConnection=null;renderCanvas();renderInspector();});
  }
  function renderMinimap(){
    const flow=activeFlow(),view=flow.view;
    $('#minimapNodes').innerHTML=flow.nodes.map(n=>`<i class="mini-node ${n.type}" style="left:${n.x*.052}px;top:${n.y*.045}px"></i>`).join('');
    const vp=$('#canvasViewport'), box=$('#minimapViewport'); box.style.left=`${Math.max(0,-view.x/view.scale*.052)}px`;box.style.top=`${Math.max(0,-view.y/view.scale*.045)}px`;box.style.width=`${Math.min(140,vp.clientWidth/view.scale*.052)}px`;box.style.height=`${Math.min(88,vp.clientHeight/view.scale*.045)}px`;
  }
  function bindNodes(){
    $$('.graph-node').forEach(el=>{
      const id=el.dataset.nodeId;
      el.querySelector('.port.out').onclick=e=>{e.stopPropagation();pendingConnection=id;renderCanvas();toast('请选择目标节点的输入点');};
      el.querySelector('.port.in').onclick=e=>{e.stopPropagation();if(!pendingConnection){toast('请先点击来源节点的输出点');return;}if(pendingConnection===id){toast('不能连接到自身');return;}const flow=activeFlow();if(flow.edges.some(x=>x.from===pendingConnection&&x.to===id)){toast('这条连线已经存在');return;}const from=pendingConnection;commit(()=>{flow.edges.push({id:nowId('edge'),from,to:id,label:'',condition:'',priority:flow.edges.filter(x=>x.from===from).length,weight:100});pendingConnection=null;});};
      el.onpointerdown=e=>{if(e.target.classList.contains('port')||simulationTimer)return;e.preventDefault();selected={kind:'node',id};renderInspector();$$('.graph-node').forEach(n=>n.classList.toggle('selected',n===el));const node=activeFlow().nodes.find(n=>n.id===id),before=clone(project),start={x:e.clientX,y:e.clientY,nx:node.x,ny:node.y},scale=activeFlow().view.scale;el.setPointerCapture(e.pointerId);dragState={};el.onpointermove=ev=>{node.x=Math.round(Math.max(0,start.nx+(ev.clientX-start.x)/scale));node.y=Math.round(Math.max(0,start.ny+(ev.clientY-start.y)/scale));el.style.left=`${node.x}px`;el.style.top=`${node.y}px`;renderEdges();renderMinimap();};const finish=()=>{el.onpointermove=null;el.onpointerup=null;el.onpointercancel=null;undoStack.push(before);redoStack=[];dragState=null;saveProject();};el.onpointerup=finish;el.onpointercancel=finish;};
    });
  }
  function renderInspector(){
    $('.right-panel').classList.toggle('open',selected.kind==='node'||selected.kind==='edge'||selected.open===true);
    ['emptyInspector','nodeInspector','edgeInspector','flowInspector'].forEach(id=>$('#'+id).hidden=true);
    const flow=activeFlow();
    if(selected.kind==='node'){
      const node=flow.nodes.find(n=>n.id===selected.id); if(!node){selected={kind:'flow',id:flow.id};return renderInspector();}
      $('#nodeInspector').hidden=false;$('#nodeTypeLabel').textContent=nodeTypes[node.type]?.label||node.type;$('#nodeInspectorTitle').textContent=node.name;$('#nodeNameInput').value=node.name;$('#nodeDescriptionInput').value=node.description||'';$('#nodeTagsInput').value=(node.tags||[]).join(', ');$('#runtimeId').textContent=node.id;renderParameters(node);renderAttachedAssets(node);return;
    }
    if(selected.kind==='edge'){
      const edge=flow.edges.find(e=>e.id===selected.id);if(!edge){selected={kind:'flow',id:flow.id};return renderInspector();}
      $('#edgeInspector').hidden=false;$('#edgeLabelInput').value=edge.label||'';$('#edgeConditionInput').value=edge.condition||'';$('#edgePriorityInput').value=edge.priority??0;$('#edgeWeightInput').value=edge.weight??100;return;
    }
    $('#flowInspector').hidden=false;$('#flowNameInput').value=flow.name;$('#flowTypeInput').value=flow.type;$('#flowDescriptionInput').value=flow.description||'';
  }
  function renderParameters(node){
    $('#parameterList').innerHTML=(node.params||[]).map((p,i)=>`<div class="parameter-row" data-index="${i}"><input class="param-key" value="${esc(p.key)}" placeholder="参数名"><input class="param-value" value="${esc(p.value)}" placeholder="值"><button class="remove-param">×</button></div>`).join('')||'<p class="field-hint">暂无参数。</p>';
    $$('.parameter-row').forEach(row=>{const i=+row.dataset.index;row.querySelector('.param-key').onchange=e=>commit(()=>node.params[i].key=e.target.value);row.querySelector('.param-value').onchange=e=>commit(()=>node.params[i].value=e.target.value);row.querySelector('.remove-param').onclick=()=>commit(()=>node.params.splice(i,1));});
  }
  async function renderAttachedAssets(node){
    const items=(node.assetIds||[]).map(id=>project.assets.find(a=>a.id===id)).filter(Boolean);$('#attachedAssets').innerHTML=items.length?items.map(a=>`<div class="attached-chip" data-asset-id="${a.id}"><div class="asset-fallback">◉</div><span>${esc(a.name)}</span><button>×</button></div>`).join(''):'<p class="field-hint">尚未关联素材。</p>';
    $$('.attached-chip').forEach(chip=>{chip.querySelector('button').onclick=()=>commit(()=>node.assetIds=node.assetIds.filter(id=>id!==chip.dataset.assetId));hydrateMedia(chip,project.assets.find(a=>a.id===chip.dataset.assetId),true);});
  }
  function validateFlow(showToast=true){
    const flow=activeFlow(),issues=[];const roots=flow.nodes.filter(n=>n.type==='root');if(roots.length!==1)issues.push(`需要 1 个入口（当前 ${roots.length}）`);const ids=new Set(flow.nodes.map(n=>n.id));const dangling=flow.edges.filter(e=>!ids.has(e.from)||!ids.has(e.to));if(dangling.length)issues.push(`${dangling.length} 条失效连线`);if(roots.length===1){const reached=new Set([roots[0].id]),queue=[roots[0].id];while(queue.length){const id=queue.shift();flow.edges.filter(e=>e.from===id).forEach(e=>{if(!reached.has(e.to)){reached.add(e.to);queue.push(e.to);}});}const unreachable=flow.nodes.filter(n=>!reached.has(n.id));if(unreachable.length)issues.push(`${unreachable.length} 个节点不可达`);}$('#validationSummary').innerHTML=issues.length?issues.slice(0,2).map(i=>`<span class="validation-pill error">${esc(i)}</span>`).join(''):'<span class="validation-pill ok">逻辑结构正常</span>';if(showToast)toast(issues.length?`发现 ${issues.length} 个问题`:'逻辑检查通过');return issues;
  }
  function addNode(type){
    const flow=activeFlow(),vp=$('#canvasViewport'),view=flow.view,id=nowId(type),x=Math.round((vp.clientWidth/2-view.x)/view.scale-98),y=Math.round((vp.clientHeight/2-view.y)/view.scale-45);
    commit(()=>{flow.nodes.push({id,type,name:`新${nodeTypes[type].label}`,description:nodeTypes[type].summary,x:Math.max(0,x),y:Math.max(0,y),tags:[],params:[],assetIds:[]});selected={kind:'node',id};});
  }
  function deleteSelectedNode(){const flow=activeFlow(),id=selected.id;commit(()=>{flow.nodes=flow.nodes.filter(n=>n.id!==id);flow.edges=flow.edges.filter(e=>e.from!==id&&e.to!==id);selected={kind:'flow',id:flow.id};});}
  function zoomBy(multiplier,clientX,clientY){const flow=activeFlow(),view=flow.view,vp=$('#canvasViewport').getBoundingClientRect(),px=(clientX??vp.left+vp.width/2)-vp.left,py=(clientY??vp.top+vp.height/2)-vp.top,old=view.scale,next=Math.min(1.8,Math.max(.35,old*multiplier)),wx=(px-view.x)/old,wy=(py-view.y)/old;view.x=px-wx*next;view.y=py-wy*next;view.scale=next;saveProject();renderCanvas();}
  function fitView(){const flow=activeFlow();if(!flow.nodes.length)return;const vp=$('#canvasViewport'),minX=Math.min(...flow.nodes.map(n=>n.x)),minY=Math.min(...flow.nodes.map(n=>n.y)),maxX=Math.max(...flow.nodes.map(n=>n.x+196)),maxY=Math.max(...flow.nodes.map(n=>n.y+90)),scale=Math.min(1.2,Math.max(.35,Math.min((vp.clientWidth-100)/(maxX-minX),(vp.clientHeight-100)/(maxY-minY))));flow.view={scale,x:(vp.clientWidth-(maxX-minX)*scale)/2-minX*scale,y:(vp.clientHeight-(maxY-minY)*scale)/2-minY*scale};saveProject();renderCanvas();}
  function runSimulation(){
    if(simulationTimer){clearInterval(simulationTimer);simulationTimer=null;$$('.graph-node').forEach(n=>n.classList.remove('running'));$('#runBtn').textContent='▶ 模拟运行';return;}
    if(validateFlow(true).some(i=>i.includes('入口')))return;const flow=activeFlow(),root=flow.nodes.find(n=>n.type==='root'),order=[],seen=new Set(),queue=[root.id];while(queue.length){const id=queue.shift();if(seen.has(id))continue;seen.add(id);order.push(id);flow.edges.filter(e=>e.from===id).sort((a,b)=>(a.priority||0)-(b.priority||0)).forEach(e=>queue.push(e.to));}let i=0;$('#runBtn').textContent='■ 停止模拟';const step=()=>{$$('.graph-node').forEach(n=>n.classList.toggle('running',n.dataset.nodeId===order[i]));i=(i+1)%order.length;};step();simulationTimer=setInterval(step,700);
  }
  function renderAssets(){
    $('#assetList').innerHTML=project.assets.length?project.assets.map(a=>`<div class="asset-card" data-asset-id="${a.id}"><div class="asset-fallback">${a.mediaType==='video'?'▶':'▧'}</div><footer><b>${esc(a.name)}</b><button class="attach-asset">关联</button><button class="delete-asset">×</button></footer></div>`).join(''):'<div class="asset-empty">暂无参考素材</div>';
    $$('.asset-card').forEach(card=>{const asset=project.assets.find(a=>a.id===card.dataset.assetId);hydrateMedia(card,asset,false);card.querySelector('.attach-asset').onclick=e=>{e.stopPropagation();if(selected.kind!=='node')return toast('请先选择一个节点');const node=activeFlow().nodes.find(n=>n.id===selected.id);if(node.assetIds.includes(asset.id))return toast('该节点已关联此素材');commit(()=>node.assetIds.push(asset.id));};card.querySelector('.delete-asset').onclick=e=>{e.stopPropagation();commit(()=>{project.assets=project.assets.filter(a=>a.id!==asset.id);project.flows.forEach(f=>f.nodes.forEach(n=>n.assetIds=(n.assetIds||[]).filter(id=>id!==asset.id)));});deleteAssetBlob(asset.id);};});
  }
  async function hydrateMedia(container,asset,attached){if(!asset)return;let src=asset.url;if(asset.source==='blob'){if(objectUrls.has(asset.id))src=objectUrls.get(asset.id);else{const blob=await getAssetBlob(asset.id);if(blob){src=URL.createObjectURL(blob);objectUrls.set(asset.id,src);}}}if(!src)return;const old=container.querySelector('.asset-fallback');if(!old)return;const media=document.createElement(asset.mediaType==='video'?'video':'img');media.src=src;if(media.tagName==='VIDEO'){media.muted=true;media.loop=true;media.onmouseenter=()=>media.play();media.onmouseleave=()=>media.pause();}if(attached)media.style.height='55px';old.replaceWith(media);}
  function openDb(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(DB_STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function putAssetBlob(id,blob){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(blob,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
  async function getAssetBlob(id){try{const db=await openDb();return await new Promise((resolve,reject)=>{const r=db.transaction(DB_STORE).objectStore(DB_STORE).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch{return null;}}
  async function deleteAssetBlob(id){try{const db=await openDb();db.transaction(DB_STORE,'readwrite').objectStore(DB_STORE).delete(id);}catch{}}
  async function addFiles(files){for(const file of files){if(!file.type.startsWith('image')&&!file.type.startsWith('video'))continue;const id=nowId('asset');await putAssetBlob(id,file);project.assets.push({id,name:file.name,mediaType:file.type.startsWith('video')?'video':'image',source:'blob',createdAt:new Date().toISOString()});}saveProject();renderAssets();toast('参考素材已保存到浏览器');}
  function openModal(title,html,onConfirm){$('#modalTitle').textContent=title;$('#modalContent').innerHTML=html;$('#modalBackdrop').hidden=false;modalAction=onConfirm;setTimeout(()=>$('#modalContent input')?.focus(),0);}
  function closeModal(){$('#modalBackdrop').hidden=true;modalAction=null;}
  function newFlowModal(){openModal('新建逻辑图',`<label class="field"><span>名称</span><input id="newFlowName" value="新战斗逻辑"></label><label class="field"><span>类型</span><select id="newFlowType"><option value="behavior">敌人行为树</option><option value="skill">玩家技能流</option><option value="state">状态机</option></select></label>`,()=>{const id=nowId('flow'),type=$('#newFlowType').value,name=$('#newFlowName').value.trim()||'未命名逻辑图';commit(()=>{project.flows.push({id,name,type,description:'',view:{x:80,y:80,scale:1},nodes:[{id:nowId('root'),type:'root',name:'逻辑入口',description:'从这里开始执行',x:120,y:180,tags:[],params:[],assetIds:[]}],edges:[]});project.activeFlowId=id;selected={kind:'flow',id};});closeModal();});}
  function addUrlModal(){openModal('添加网络素材',`<label class="field"><span>图片或视频 URL</span><input id="assetUrl" placeholder="https://..."></label><label class="field"><span>素材名称</span><input id="assetName" placeholder="例如：闪避后摇参考"></label><label class="field"><span>类型</span><select id="assetMediaType"><option value="image">图片</option><option value="video">视频</option></select></label>`,()=>{const url=$('#assetUrl').value.trim();if(!url)return toast('请输入素材 URL');commit(()=>project.assets.push({id:nowId('asset'),name:$('#assetName').value.trim()||'网络参考',mediaType:$('#assetMediaType').value,source:'url',url,createdAt:new Date().toISOString()}));closeModal();});}
  function exportProject(){const payload=clone(project);payload.exportedAt=new Date().toISOString();payload.notice='本地上传的图片和视频保存在浏览器 IndexedDB 中，不包含在 JSON 内；URL 素材可正常迁移。';const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));a.download=`${project.name.replace(/[^\w\u4e00-\u9fa5-]+/g,'-')}.combat-flow.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('项目 JSON 已导出');}
  async function importProject(file){try{const data=JSON.parse(await file.text());if(data.version!==2||!Array.isArray(data.flows)||!data.flows.length)throw new Error('格式不支持');commit(()=>{project=data;delete project.exportedAt;delete project.notice;project.activeFlowId=project.activeFlowId||project.flows[0].id;selected={kind:'flow',id:project.activeFlowId};});toast('项目已导入');}catch(error){toast(`导入失败：${error.message}`);}}
  function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),1900);}
  function bindStatic(){
    $('#projectTitle').onclick=()=>openModal('项目设置',`<label class="field"><span>项目名称</span><input id="projectNameModal" value="${esc(project.name)}"></label>`,()=>{commit(()=>project.name=$('#projectNameModal').value.trim()||'未命名项目');closeModal();});
    $('#undoBtn').onclick=undo;$('#redoBtn').onclick=redo;$('#exportBtn').onclick=exportProject;$('#importBtn').onclick=()=>$('#importInput').click();$('#importInput').onchange=e=>{if(e.target.files[0])importProject(e.target.files[0]);e.target.value='';};$('#runBtn').onclick=runSimulation;$('#newFlowBtn').onclick=newFlowModal;$('#addUrlBtn').onclick=addUrlModal;$('#nodeSearch').oninput=renderLibrary;$('#validateBtn').onclick=()=>validateFlow(true);$('#fitBtn').onclick=fitView;$('#zoomInBtn').onclick=()=>zoomBy(1.15);$('#zoomOutBtn').onclick=()=>zoomBy(.87);$('#cancelConnect').onclick=()=>{pendingConnection=null;renderCanvas();};
    $('#deleteNodeBtn').onclick=deleteSelectedNode;$('#deleteEdgeBtn').onclick=()=>{const id=selected.id;commit(()=>{activeFlow().edges=activeFlow().edges.filter(e=>e.id!==id);selected={kind:'flow',id:activeFlow().id};});};
    $('#addParameterBtn').onclick=()=>{if(selected.kind!=='node')return;const node=activeFlow().nodes.find(n=>n.id===selected.id);commit(()=>{node.params=node.params||[];node.params.push({key:'parameter',value:''});});};
    let liveBefore=null;const beginLive=()=>{if(!liveBefore)liveBefore=clone(project);};const endLive=()=>{if(liveBefore){undoStack.push(liveBefore);if(undoStack.length>40)undoStack.shift();redoStack=[];liveBefore=null;saveProject();}};
    const liveNodeUpdate=(key,value)=>{const node=activeFlow().nodes.find(n=>n.id===selected.id);if(!node)return;node[key]=value;const card=document.querySelector(`.graph-node[data-node-id="${node.id}"]`);if(key==='name'){card?.querySelector('.node-copy b')&&(card.querySelector('.node-copy b').textContent=value);$('#nodeInspectorTitle').textContent=value;}if(key==='description'){const summary=card?.querySelector('.node-summary');if(summary?.firstChild)summary.firstChild.nodeValue=value;}saveProject();};
    [['nodeNameInput','name'],['nodeDescriptionInput','description']].forEach(([id,key])=>{const field=$('#'+id);field.onfocus=beginLive;field.oninput=e=>liveNodeUpdate(key,e.target.value);field.onchange=endLive;field.onblur=endLive;});$('#nodeTagsInput').onfocus=beginLive;$('#nodeTagsInput').oninput=e=>{const node=activeFlow().nodes.find(n=>n.id===selected.id);if(!node)return;node.tags=e.target.value.split(',').map(x=>x.trim()).filter(Boolean);const tags=document.querySelector(`.graph-node[data-node-id="${node.id}"] .node-tags`);if(tags)tags.innerHTML=node.tags.slice(0,3).map(tag=>`<i>${esc(tag)}</i>`).join('');saveProject();};$('#nodeTagsInput').onchange=endLive;$('#nodeTagsInput').onblur=endLive;
    [['edgeLabelInput','label'],['edgeConditionInput','condition'],['edgePriorityInput','priority'],['edgeWeightInput','weight']].forEach(([id,key])=>$('#'+id).onchange=e=>{const edge=activeFlow().edges.find(x=>x.id===selected.id);if(edge)commit(()=>edge[key]=e.target.type==='number'?Number(e.target.value):e.target.value);});
    [['flowNameInput','name'],['flowTypeInput','type'],['flowDescriptionInput','description']].forEach(([id,key])=>$('#'+id).onchange=e=>commit(()=>activeFlow()[key]=e.target.value));$('#deleteFlowBtn').onclick=()=>{if(project.flows.length===1)return toast('至少保留一个逻辑图');const id=activeFlow().id;commit(()=>{project.flows=project.flows.filter(f=>f.id!==id);project.activeFlowId=project.flows[0].id;selected={kind:'flow',id:project.activeFlowId};});};
    $('#inspectorCloseBtn').onclick=()=>{selected={kind:'flow',id:activeFlow().id};renderInspector();};$('#modalClose').onclick=$('#modalCancel').onclick=closeModal;$('#modalConfirm').onclick=()=>modalAction?.();$('#modalBackdrop').onclick=e=>{if(e.target===$('#modalBackdrop'))closeModal();};
    $('#assetInput').onchange=e=>addFiles(e.target.files);const drop=$('#assetDrop');['dragenter','dragover'].forEach(name=>drop.addEventListener(name,e=>{e.preventDefault();drop.classList.add('drag');}));['dragleave','drop'].forEach(name=>drop.addEventListener(name,e=>{e.preventDefault();drop.classList.remove('drag');}));drop.ondrop=e=>addFiles(e.dataTransfer.files);document.addEventListener('paste',e=>{if(e.clipboardData.files.length)addFiles(e.clipboardData.files);});
    const vp=$('#canvasViewport');vp.addEventListener('wheel',e=>{e.preventDefault();zoomBy(e.deltaY<0?1.08:.92,e.clientX,e.clientY);},{passive:false});vp.onpointerdown=e=>{if(e.target.closest('.graph-node')||e.target.closest('.edge-hit')||e.button!==0)return;const flow=activeFlow(),start={x:e.clientX,y:e.clientY,vx:flow.view.x,vy:flow.view.y};vp.setPointerCapture(e.pointerId);vp.classList.add('panning');panState={};vp.onpointermove=ev=>{flow.view.x=start.vx+ev.clientX-start.x;flow.view.y=start.vy+ev.clientY-start.y;$('#canvasScene').style.transform=`translate(${flow.view.x}px,${flow.view.y}px) scale(${flow.view.scale})`;renderMinimap();};vp.onpointerup=()=>{vp.onpointermove=null;vp.classList.remove('panning');panState=null;saveProject();};selected={kind:'flow',id:flow.id};renderInspector();};
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}else if(e.key==='Escape'&&pendingConnection){pendingConnection=null;renderCanvas();}else if((e.key==='Delete'||e.key==='Backspace')&&selected.kind==='node'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){deleteSelectedNode();}});
    window.addEventListener('resize',()=>{renderEdges();renderMinimap();});
  }
  mount();
})();
