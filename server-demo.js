#!/usr/bin/env node
import http from "node:http";

const PROXY = "http://127.0.0.1:11435/v1/responses";
const PORT = 3030;
const FAST = process.argv.includes("--fast");

async function callAI({ system, input, thinking: t, timeout = 120000 }) {
  const body = {
    input: [{ role: "developer", content: system }, { role: "user", content: input }],
    stream: false,
  };
  if (t) body.thinking = { type: "enabled" };

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = { method: "POST", timeout, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } };
    const req = http.request(PROXY, opts, (res) => {
      let buf = ""; res.on("data", c => buf += c);
      res.on("end", () => {
        try {
          const r = JSON.parse(buf);
          if (r.error) return reject(new Error(r.error.message));
          resolve({
            reasoning: r.output?.find(o => o.type === "reasoning")?.content?.[0]?.text ?? "",
            text: r.output?.find(o => o.type === "message")?.content?.[0]?.text ?? "",
            usage: r.usage ?? {},
          });
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(data); req.end();
  });
}

async function runPipeline(task, emit) {
  const start = Date.now();
  let totalTokens = 0;

  emit({ type: "phase", phase: "architect", status: "running" });
  let design;
  try {
    const r = await callAI({
      system: "You are a Senior Software Architect. Produce a CONCISE technical design. Include data structures, algorithms, edge cases. Under 200 words. Output ONLY the design, NO code. Respond in Chinese if user writes in Chinese.",
      input: `Design a solution for:\n\n${task}`,
      thinking: true,
      timeout: 180000,
    });
    design = r.text; totalTokens += r.usage.total_tokens ?? 0;
    emit({ type: "phase", phase: "architect", status: "done", reasoning: r.reasoning, output: r.text, tokens: r.usage.total_tokens });
  } catch (e) { emit({ type: "error", message: "Architect: " + e.message }); return; }

  emit({ type: "phase", phase: "coder", status: "running" });
  let code;
  try {
    const r = await callAI({
      system: "You are a Senior Software Engineer. Implement production-ready code based on the architecture design. Write COMPLETE code with error handling. Output the FULL implementation. Respond in Chinese for Chinese tasks.",
      input: `## Task\n${task}\n\n## Architecture Design\n${design}\n\nOutput COMPLETE code now.`,
      timeout: 180000,
    });
    code = r.text; totalTokens += r.usage.total_tokens ?? 0;
    emit({ type: "phase", phase: "coder", status: "done", output: r.text, tokens: r.usage.total_tokens });
  } catch (e) { emit({ type: "error", message: "Coder: " + e.message }); return; }

  const MAX_ROUNDS = FAST ? 1 : 2;
  let approved = false;
  let feedback = "";

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    emit({ type: "phase", phase: "reviewer", status: "running", round, max: MAX_ROUNDS });
    try {
      const sys = FAST
        ? "You are a Code Reviewer. Quickly review code. If it looks correct and handles edge cases: output EXACTLY 'LGTM'. Only flag critical issues (crashes, data loss, security holes). Be pragmatic, not pedantic."
        : "You are a Principal Code Reviewer. Review code against design. If critical issues found: list each with exact fix location. If production-ready: output EXACTLY 'LGTM' on its own line. Be strict but fair.";
      const r = await callAI({ system: sys, input: `## Design\n${design}\n\n## Code\n${code}\n\nReview. If approved, output only LGTM. If issues, list them.`, thinking: !FAST, timeout: 120000 });
      totalTokens += r.usage.total_tokens ?? 0;

      if (r.text.trim().toUpperCase().startsWith("LGTM")) {
        approved = true;
        emit({ type: "phase", phase: "reviewer", status: "done", approved: true, reasoning: r.reasoning, tokens: r.usage.total_tokens, round });
        break;
      }

      feedback = r.text;
      emit({ type: "phase", phase: "reviewer", status: "done", approved: false, reasoning: r.reasoning, output: r.text, tokens: r.usage.total_tokens, round });

      if (round < MAX_ROUNDS) {
        emit({ type: "phase", phase: "fix", status: "running", round });
        const fr = await callAI({
          system: "Fix ALL reviewer issues in the code. Output the COMPLETE fixed code.",
          input: `## Original Code\n${code}\n\n## Issues to Fix\n${feedback}\n\nOutput COMPLETE fixed code.`,
          timeout: 180000,
        });
        code = fr.text; totalTokens += fr.usage.total_tokens ?? 0;
        emit({ type: "phase", phase: "fix", status: "done", tokens: fr.usage.total_tokens, round });
      }
    } catch (e) { emit({ type: "error", message: "Reviewer: " + e.message }); return; }
  }

  emit({ type: "done", approved, code, tokens: totalTokens, time: ((Date.now() - start) / 1000).toFixed(1) });
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Workbench — Multi-Model Code Factory</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'SF Mono',Menlo,monospace;min-height:100vh}
.bg-grid{position:fixed;top:0;left:0;width:100%;height:100%;background-image:linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}
.container{max-width:1000px;margin:0 auto;padding:40px 24px;position:relative;z-index:1}
.header{text-align:center;margin-bottom:40px}
.header h1{font-size:30px;background:linear-gradient(135deg,#06b6d4,#a855f7,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:8px}
.header p{color:#555;font-size:14px;letter-spacing:.5px}
.input-group{display:flex;gap:12px;margin-bottom:36px}
.input-group input{flex:1;background:#12121f;border:1px solid #2a2a4a;color:#e0e0e0;padding:16px 20px;border-radius:10px;font-size:15px;font-family:inherit;outline:none;transition:border-color .3s}
.input-group input:focus{border-color:#06b6d4;box-shadow:0 0 0 3px rgba(6,182,212,.1)}
.input-group button{padding:16px 36px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s;text-transform:uppercase;letter-spacing:1px}
.btn-go{background:linear-gradient(135deg,#06b6d4,#8b5cf6);color:#fff}
.btn-go:hover{transform:translateY(-2px);box-shadow:0 6px 30px rgba(6,182,212,.35)}
.btn-go:disabled{opacity:.3;cursor:not-allowed;transform:none;box-shadow:none}
.pipeline{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:36px}
.stage{text-align:center;padding:24px 16px;border-radius:12px;background:#12121f;border:1px solid #1e1e3a;transition:all .4s;position:relative;overflow:hidden}
.stage .icon{font-size:32px;margin-bottom:10px;display:block}
.stage .name{font-size:14px;color:#777;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px}
.stage .status{font-size:12px;color:#444;min-height:18px}
.stage.active{border-color:#06b6d4;background:#0a1628;box-shadow:0 0 24px rgba(6,182,212,.1)}
.stage.active .name{color:#06b6d4}
.stage.done{border-color:#22c55e;background:#0a1a10}
.stage.done .name{color:#22c55e}
.stage.done .status{color:#22c55e}
.stage .pulse{position:absolute;inset:0;border-radius:12px;animation:stagePulse 2s infinite;pointer-events:none}
@keyframes stagePulse{0%,100%{box-shadow:inset 0 0 0 0 rgba(6,182,212,0)}50%{box-shadow:inset 0 0 0 2px rgba(6,182,212,.3)}}
.output-area{display:none}
.output-area.show{display:block}
.panel{background:#12121f;border:1px solid #1e1e3a;border-radius:14px;margin-bottom:20px;overflow:hidden;animation:fadeIn .4s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.panel-header{padding:16px 22px;background:rgba(255,255,255,.02);border-bottom:1px solid #1e1e3a;font-size:14px;font-weight:700;display:flex;justify-content:space-between;align-items:center;letter-spacing:.5px}
.panel-body{padding:18px 22px}
.code-block{background:#0a0a14;border-radius:10px;padding:18px;overflow-x:auto;font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;max-height:500px;overflow-y:auto;color:#a8b8c8}
.code-block::-webkit-scrollbar{width:6px;height:6px}
.code-block::-webkit-scrollbar-track{background:transparent}
.code-block::-webkit-scrollbar-thumb{background:#2a2a4a;border-radius:3px}
.reasoning-box{color:#a78bfa;font-size:13px;line-height:1.6;border-left:3px solid #7c3aed;padding:8px 0 8px 16px;margin:0 0 14px 0;max-height:200px;overflow-y:auto}
.reasoning-box::-webkit-scrollbar{width:4px}
.reasoning-box::-webkit-scrollbar-track{background:transparent}
.reasoning-box::-webkit-scrollbar-thumb{background:#3a1a6a;border-radius:2px}
.issue-item{color:#f87171;padding:6px 0 6px 14px;border-left:2px solid #ef4444;margin:6px 0;font-size:13px;line-height:1.5}
.lgtm-banner{text-align:center;padding:36px;font-size:28px;font-weight:700;color:#22c55e;animation:glow 1.5s infinite alternate;letter-spacing:2px}
@keyframes glow{from{text-shadow:0 0 8px rgba(34,197,94,.3)}to{text-shadow:0 0 28px rgba(34,197,94,.7)}}
.report{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px}
.report-card{background:#12121f;border:1px solid #1e1e3a;border-radius:14px;padding:24px;text-align:center;animation:fadeIn .5s ease}
.report-card .val{font-size:34px;font-weight:700;margin-bottom:6px}
.report-card .lbl{font-size:12px;color:#555;text-transform:uppercase;letter-spacing:1.5px}
.val.green{color:#22c55e}
.val.cyan{color:#06b6d4}
.val.yellow{color:#f59e0b}
.spinner-inline{display:inline-block;width:14px;height:14px;border:2px solid #1e1e3a;border-top-color:#06b6d4;border-radius:50%;animation:spin .6s linear infinite;margin-right:8px;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
.token-badge{font-size:11px;color:#555;margin-left:8px}
@media(max-width:640px){.pipeline{grid-template-columns:1fr}.report{grid-template-columns:1fr}.input-group{flex-direction:column}}
</style>
</head>
<body>
<div class="bg-grid"></div>
<div class="container">
  <div class="header">
    <h1>AGENT WORKBENCH</h1>
    <p>Architect → Coder → Reviewer &nbsp;↻&nbsp; Auto-Fix Loop</p>
  </div>
  <div class="input-group">
    <input id="task" placeholder="输入编程任务，例如：实现一个带 TTL 过期的 LRU 缓存..." value="用Python实现一个支持最大容量和TTL的异步缓存类">
    <button class="btn-go" id="btn" onclick="run()">▶&nbsp; Execute</button>
  </div>
  <div class="pipeline">
    <div class="stage" id="s-architect"><span class="icon">🧠</span><div class="name">Architect</div><div class="status">Waiting</div></div>
    <div class="stage" id="s-coder"><span class="icon">✍️</span><div class="name">Coder</div><div class="status">Waiting</div></div>
    <div class="stage" id="s-reviewer"><span class="icon">🔍</span><div class="name">Reviewer</div><div class="status">Waiting</div></div>
  </div>
  <div class="output-area" id="output">
    <div id="panels"></div>
    <div class="report" id="report" style="display:none"></div>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
function setStage(p,s){const e=$('s-'+p);e.className='stage '+s;if(s==='active'){e.querySelector('.status').innerHTML='<span class="spinner-inline"></span>Running'}else if(s==='done'){e.querySelector('.status').textContent='✓ Done'}}
['architect','coder','reviewer'].forEach(p=>{const e=$('s-'+p);if(e)e.querySelector('.status').textContent='Waiting'});

let busy=false;
async function run(){
  if(busy)return;busy=true;$('btn').disabled=true;
  $('output').classList.add('show');$('panels').innerHTML='';$('report').style.display='none';
  ['architect','coder','reviewer'].forEach(p=>{const e=$('s-'+p);e.className='stage';e.querySelector('.status').textContent='Waiting'});
  try{
    const res=await fetch('/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:$('task').value.trim()})});
    const reader=res.body.getReader(),decoder=new TextDecoder();let buf='';
    while(true){const{value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});
    const lines=buf.split('\\n');buf=lines.pop();
    for(const l of lines){if(!l.trim())continue;try{handle(JSON.parse(l))}catch(e){}}}
  }catch(e){$('panels').insertAdjacentHTML('beforeend','<div class="panel"><div class="panel-body" style="color:#f87171">Error: '+esc(e.message)+'</div></div>')}
  busy=false;$('btn').disabled=false;
}

function handle(e){
  if(e.type==='phase'&&e.status==='running'){setStage(e.phase,'active');return}
  if(e.type==='phase'&&e.status==='done'){
    setStage(e.phase,'done');
    if(e.phase==='architect'){
      let h='<div class="panel"><div class="panel-header">🧠 Architect — Design<span class="token-badge">'+e.tokens+' tokens</span></div><div class="panel-body">';
      if(e.reasoning)h+='<div class="reasoning-box">'+esc(e.reasoning.slice(0,800))+'</div>';
      h+='<div class="code-block">'+esc(e.output)+'</div></div></div>';$('panels').insertAdjacentHTML('beforeend',h);
    }
    if(e.phase==='coder'){
      $('panels').insertAdjacentHTML('beforeend','<div class="panel"><div class="panel-header">✍️ Coder — Implementation<span class="token-badge">'+e.tokens+' tokens</span></div><div class="panel-body"><div class="code-block">'+esc(e.output)+'</div></div></div>');
    }
    if(e.phase==='reviewer'){
      if(e.approved){$('panels').insertAdjacentHTML('beforeend','<div class="panel"><div class="panel-body"><div class="lgtm-banner">✅ APPROVED — LGTM</div></div></div>')}
      else{
        let h='<div class="panel"><div class="panel-header">🔍 Reviewer — Round '+e.round+'<span class="token-badge">'+e.tokens+' tokens</span></div><div class="panel-body">';
        if(e.reasoning)h+='<div class="reasoning-box">'+esc(e.reasoning.slice(0,500))+'</div>';
        const issues=(e.output||'').split('\\n').filter(l=>l.trim());
        for(const i of issues.slice(0,10))h+='<div class="issue-item">✗ '+esc(i)+'</div>';
        h+='</div></div>';$('panels').insertAdjacentHTML('beforeend',h);
      }
    }
    if(e.phase==='fix'){$('panels').insertAdjacentHTML('beforeend','<div class="panel"><div class="panel-header">🔄 Auto-Fix — Coder<span class="token-badge">'+e.tokens+' tokens</span></div></div>')}
    return;
  }
  if(e.type==='done'){
    const r=$('report');r.style.display='grid';
    r.innerHTML='<div class="report-card"><div class="val '+(e.approved?'green':'yellow')+'">'+(e.approved?'✓ APPROVED':'⚠ REVIEW')+'</div><div class="lbl">Verdict</div></div><div class="report-card"><div class="val cyan">'+e.tokens.toLocaleString()+'</div><div class="lbl">Tokens</div></div><div class="report-card"><div class="val yellow">'+e.time+'s</div><div class="lbl">Time</div></div>';
  }
  if(e.type==='error'){$('panels').insertAdjacentHTML('beforeend','<div class="panel"><div class="panel-body" style="color:#f87171">⚠ '+esc(e.message)+'</div></div>')}
}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!busy)run()});
</script>
</body></html>`;

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, "http://" + req.headers.host);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(HTML);
  }

  if (req.method === "POST" && url.pathname === "/run") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const { task } = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        await runPipeline(task, (evt) => { res.write(JSON.stringify(evt) + "\n"); });
        res.end();
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("\x1b[46m\x1b[37m\x1b[1m  AGENT WORKBENCH DEMO  \x1b[0m");
  console.log("  Open: \x1b[1m\x1b[36mhttp://localhost:" + PORT + "\x1b[0m");
  console.log("");
});
