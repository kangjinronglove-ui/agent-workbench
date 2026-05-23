#!/usr/bin/env node
import http from "node:http";

const PROXY = "http://127.0.0.1:11435/v1/responses";

const args = process.argv.slice(2);
const FAST = args.includes("--fast") || args.includes("-f");
const BRUTAL = args.includes("--brutal") || args.includes("-b");
const task = args.filter(a => !a.startsWith("-")).join(" ") ||
  "实现一个支持最大容量和TTL过期的内存缓存类，包含get/put/delete方法";

const MAX_ROUNDS = BRUTAL ? 5 : FAST ? 1 : 2;
const REVIEWER_THINKING = BRUTAL;
const ARCHITECT_TOKENS = BRUTAL ? 400 : 200;
const REVIEW_TIMEOUT = BRUTAL ? 300000 : 120000;

const C = {
  reset:"\x1b[0m",bold:"\x1b[1m",dim:"\x1b[2m",italic:"\x1b[3m",
  red:"\x1b[31m",green:"\x1b[32m",yellow:"\x1b[33m",blue:"\x1b[34m",
  magenta:"\x1b[35m",cyan:"\x1b[36m",white:"\x1b[37m",
  bgRed:"\x1b[41m",bgGreen:"\x1b[42m",bgYellow:"\x1b[43m",
  bgBlue:"\x1b[44m",bgMagenta:"\x1b[45m",bgCyan:"\x1b[46m",
};

function hr(c) { console.log((c||C.dim) + "─".repeat(70) + C.reset); }
function box(lines, color) {
  const w = Math.max(...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g,"").length));
  console.log(color + "  ╔" + "═".repeat(w+2) + "╗" + C.reset);
  for (const l of lines) {
    const clean = l.replace(/\x1b\[[0-9;]*m/g,"");
    console.log(color + "  ║ " + l + " ".repeat(w-clean.length) + " ║" + C.reset);
  }
  console.log(color + "  ╚" + "═".repeat(w+2) + "╝" + C.reset);
}
function label(tag, text) { console.log(C.dim + `  ${tag}:` + C.reset + ` ${text}`); }
function done(msg, meta) { console.log(C.green + "  ✓ " + msg + C.reset + (meta ? C.dim + "  " + meta + C.reset : "")); }
function fail(msg) { console.log(C.red + "  ✗ " + msg + C.reset); }
function warn(msg) { console.log(C.yellow + "  ⚡ " + msg + C.reset); }
function info(msg) { console.log(C.cyan + "  ℹ  " + msg + C.reset); }

function thinking(text, maxLen) {
  const t = text.slice(0, maxLen || (FAST ? 300 : BRUTAL ? 1200 : 500));
  for (const line of t.split("\n")) {
    if (line.trim()) console.log(C.dim + "    ◇ " + line.trim() + C.reset);
  }
  if (text.length > t.length) console.log(C.dim + "    ... (truncated)" + C.reset);
}

function codeBlock(text, maxLines) {
  const lines = text.split("\n");
  const show = maxLines ? lines.slice(0, maxLines) : lines;
  for (const line of show) console.log(C.dim + "   │" + C.reset + " " + line);
  if (maxLines && lines.length > maxLines) console.log(C.dim + "   │ ... (" + (lines.length - maxLines) + " more lines)" + C.reset);
}

function spinner(msg) {
  const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  let i = 0;
  const id = setInterval(() => { process.stderr.write("\r" + C.yellow + "  " + frames[i++ % frames.length] + " " + msg + C.reset); }, 80);
  return () => { clearInterval(id); process.stderr.write("\r\x1b[K"); };
}

async function callAI({ system, input, thinking: enableThinking, timeout = 120000 }) {
  const body = {
    input: [{ role: "developer", content: system }, ...(Array.isArray(input) ? input : [{ role: "user", content: input }])],
    stream: false,
  };
  if (enableThinking) body.thinking = { type: "enabled" };
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(PROXY, {
      method:"POST", timeout,
      headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(data)},
    }, (res) => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try {
          const r = JSON.parse(buf);
          if (r.error) return reject(new Error(r.error.message));
          resolve({
            reasoning: r.output?.find(o => o.type==="reasoning")?.content?.[0]?.text ?? "",
            text: r.output?.find(o => o.type==="message")?.content?.[0]?.text ?? "",
            usage: r.usage ?? {},
          });
        } catch(e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

const SYS = {
  architect: `You are a Senior Software Architect. Produce a CONCISE technical design. Include: data structures, algorithms, edge cases. Max ${ARCHITECT_TOKENS} words. Output ONLY the design, NO code. Respond in Chinese if the user writes in Chinese.`,
  coder: `You are a Senior Software Engineer. Implement production-ready code based on the design. Write COMPLETE code with error handling. Output the FULL implementation. Address ALL reviewer issues if any. Keep code clean and well-structured. Respond in Chinese for Chinese tasks.`,
  reviewer: BRUTAL
    ? `You are a Principal Code Reviewer. Review code against design. Check: bugs, edge cases, performance, security, style. List every issue with fix. If perfect: output EXACTLY "LGTM" alone. Be extremely strict.`
    : `You are a Code Reviewer. Quickly review the code. If it looks correct and handles edge cases: output EXACTLY "LGTM". Only flag critical issues: crashes, data loss, security holes. Ignore minor style nits. Be pragmatic.`,
};

async function main() {
  console.clear();
  console.log("");
  console.log(C.bgCyan + C.white + C.bold + "  ╔══════════════════════════════════════════════════════════╗  " + C.reset);
  console.log(C.bgCyan + C.white + C.bold + "  ║        AGENT WORKBENCH  —  Multi-Model Code Factory      ║  " + C.reset);
  console.log(C.bgCyan + C.white + C.bold + "  ╚══════════════════════════════════════════════════════════╝  " + C.reset);
  console.log("");
  const mode = FAST ? C.yellow+"FAST"+C.reset : BRUTAL ? C.red+"BRUTAL"+C.reset : C.green+"BALANCED"+C.reset;
  label("Mode", mode);
  label("Task", task);
  label("Pipeline", `${C.blue}Architect${C.reset} → ${C.magenta}Coder${C.reset} → ${C.yellow}Reviewer${C.reset} ↻ AutoFix`);
  label("Rounds", `${MAX_ROUNDS} max · Reviewer thinking: ${REVIEWER_THINKING ? "on" : "off"}`);
  hr();

  const totalStart = Date.now();
  let totalTokens = 0;
  const stats = [];

  // ═══ PHASE 1: ARCHITECT ═══
  console.log("");
  box([`${C.blue + C.bold}🧠 ARCHITECT${C.reset}`, `${C.dim}thinking=enabled · analyzing requirements${C.reset}`], C.blue);
  const s1 = spinner("Architect is thinking...");
  let design;
  try {
    const r = await callAI({ system: SYS.architect, input: `Design a solution for:\n\n${task}`, thinking: true });
    s1(); done("Design complete", `${r.usage.total_tokens} tokens · ${r.reasoning.length}c reasoning`);
    if (r.reasoning) {
      console.log(C.dim + "  ┌─ Reasoning ───────────────────────────────────" + C.reset);
      thinking(r.reasoning);
      console.log(C.dim + "  └────────────────────────────────────────────────" + C.reset);
    }
    console.log("");
    codeBlock(r.text);
    design = r.text;
    totalTokens += r.usage.total_tokens ?? 0;
    stats.push({ role: "Architect", tokens: r.usage.total_tokens ?? 0, reasoning: r.reasoning.length });
  } catch(e) { s1(); fail(e.message); process.exit(1); }
  hr(C.blue);

  // ═══ PHASE 2: CODER ═══
  console.log("");
  box([`${C.magenta + C.bold}✍️  CODER${C.reset}`, `${C.dim}implementing from design${C.reset}`], C.magenta);
  const s2 = spinner("Writing implementation...");
  let code;
  try {
    const r = await callAI({ system: SYS.coder, input: `## Task\n${task}\n\n## Design\n${design}\n\nOutput COMPLETE code now.`, timeout: 180000 });
    s2(); done("Implementation ready", `${r.usage.total_tokens} tokens · ${r.text.length} chars`);
    console.log("");
    codeBlock(r.text, FAST ? 30 : 60);
    code = r.text;
    totalTokens += r.usage.total_tokens ?? 0;
    stats.push({ role: "Coder", tokens: r.usage.total_tokens ?? 0, codeLen: r.text.length });
  } catch(e) { s2(); fail(e.message); process.exit(1); }
  hr(C.magenta);

  // ═══ PHASE 3+: REVIEW LOOP ═══
  let approved = false;
  let feedback = "";
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log("");
    const thinkingTag = REVIEWER_THINKING ? "thinking=enabled" : "thinking=off";
    box([`${C.yellow + C.bold}🔍 REVIEWER${C.reset}`, `${C.dim}Round ${round}/${MAX_ROUNDS} · ${thinkingTag}${C.reset}`], C.yellow);
    const s3 = spinner("Reviewing code...");
    try {
      const r = await callAI({ system: SYS.reviewer, input: `## Design\n${design}\n\n## Code\n${code}\n\nReview. Output LGTM if approved, or list critical issues.`, thinking: REVIEWER_THINKING, timeout: REVIEW_TIMEOUT });
      s3(); done("Review complete", `${r.usage.total_tokens} tokens`);
      totalTokens += r.usage.total_tokens ?? 0;
      stats.push({ role: `Reviewer R${round}`, tokens: r.usage.total_tokens ?? 0 });

      if (REVIEWER_THINKING && r.reasoning) {
        console.log(C.dim + "  ┌─ Reasoning ───────────────────────────────────" + C.reset);
        thinking(r.reasoning);
        console.log(C.dim + "  └────────────────────────────────────────────────" + C.reset);
      }

      console.log("");
      if (r.text.trim().toUpperCase().startsWith("LGTM")) {
        console.log(C.bgGreen + C.white + C.bold + "  ✅ APPROVED — Production-ready!  " + C.reset);
        approved = true;
        break;
      }

      feedback = r.text;
      const issues = feedback.split("\n").filter(l => l.trim());
      console.log(C.red + C.bold + `  Found ${issues.length} issue(s):` + C.reset);
      for (const line of issues.slice(0, 10)) {
        console.log(C.red + "    ✗ " + line.trim() + C.reset);
      }
      if (issues.length > 10) console.log(C.dim + `    ... and ${issues.length - 10} more` + C.reset);

      if (round < MAX_ROUNDS) {
        console.log("");
        box([`${C.magenta + C.bold}🔄 AUTO-FIX${C.reset}`, `${C.dim}incorporating reviewer feedback${C.reset}`], C.magenta);
        const sf = spinner("Fixing issues...");
        try {
          const fr = await callAI({ system: SYS.coder, input: `## Task\n${task}\n\n## Design\n${design}\n\n## Reviewer Feedback (MUST FIX ALL)\n${feedback}\n\nOutput the COMPLETE FIXED code.`, timeout: 180000 });
          sf(); done("Fix applied", `${fr.usage.total_tokens} tokens`);
          code = fr.text;
          totalTokens += fr.usage.total_tokens ?? 0;
          stats.push({ role: `AutoFix R${round}`, tokens: fr.usage.total_tokens ?? 0 });
        } catch(e) { sf(); fail(e.message); break; }
      } else {
        console.log("");
        warn(`Max rounds (${MAX_ROUNDS}) reached without LGTM`);
      }
    } catch(e) { s3(); fail(e.message); break; }
  }
  hr(C.yellow);

  // ═══ FINAL REPORT ═══
  const elapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  console.log("");
  console.log(C.bgBlue + C.white + C.bold + "  ╔══════════════════════════════════════════════════════════╗  " + C.reset);
  console.log(C.bgBlue + C.white + C.bold + "  ║                    📊  FINAL REPORT                       ║  " + C.reset);
  console.log(C.bgBlue + C.white + C.bold + "  ╚══════════════════════════════════════════════════════════╝  " + C.reset);
  console.log("");
  label("Verdict", approved ? C.bgGreen + C.white + " APPROVED ✓ " + C.reset : C.bgYellow + C.white + " NEEDS REVIEW " + C.reset);
  label("Total Time", C.bold + elapsed + "s" + C.reset);
  label("Total Tokens", C.bold + totalTokens.toLocaleString() + C.reset);
  console.log("");
  console.log(C.dim + "  Agent Breakdown:" + C.reset);
  for (const s of stats) {
    const bar = "█".repeat(Math.min(40, Math.round(s.tokens / Math.max(...stats.map(x=>x.tokens)) * 40)));
    console.log(C.dim + `    ${s.role.padEnd(14)}` + C.reset + C.cyan + bar + C.reset + ` ${s.tokens.toLocaleString()} tokens`);
  }
  console.log("");

  if (approved && code) {
    hr(C.green);
    console.log(C.green + C.bold + "  FINAL APPROVED CODE" + C.reset);
    console.log("");
    codeBlock(code);
    console.log("");
    hr(C.green);
  }

  if (!approved && code) {
    console.log(C.dim + "  (Code available but not LGTM-certified)" + C.reset);
  }
  console.log("");
}

main().catch(e => { console.error(C.red + C.bold + "FATAL: " + e.message + C.reset); process.exit(1); });
