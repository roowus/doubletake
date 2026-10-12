/* eslint-disable */
// The public landing page. SOURCE OF TRUTH: doubletake-cloud/website/landing.html
// (sync via scripts/sync-website.mjs). Edits belong there, not here.
export const LANDING_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doubletake — save it now, get a researched answer later</title>
<meta name="description" content="Share a reel, a TikTok, a Reddit thread. Doubletake transcribes it, checks the claim, and hands you a sourced answer. Your AI agents can read all of it back as memory.">
<link rel="canonical" href="https://doubletake.gg/">
<meta property="og:title" content="Doubletake — save it now, get a researched answer later">
<meta property="og:description" content="Share a post, get a sourced answer. Everything you save becomes memory for your AI agents. Free, bring your own AI keys.">
<meta property="og:image" content="https://doubletake.gg/og-image.png">
<meta property="og:type" content="website">
<meta property="og:url" content="https://doubletake.gg/">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 120 120%22%3E%3Crect width=%22120%22 height=%22120%22 rx=%2226%22 fill=%22%23F7F3E9%22/%3E%3Crect x=%2216%22 y=%2218%22 width=%228%22 height=%2284%22 rx=%224%22 fill=%22%23C45A3C%22/%3E%3Ctext x=%2264%22 y=%2288%22 font-family=%22Georgia%22 font-size=%2268%22 fill=%22%231C1B18%22 text-anchor=%22middle%22%3ED%3C/text%3E%3C/svg%3E" type="image/svg+xml">
<script>document.documentElement.classList.add('js')</script>
<style>
:root{
  --paper:#F7F3E9; --paper-2:#F1EBDC; --paper-3:#EAE2CF;
  --ink:#1C1B18; --graphite:#6B675F; --rail:#C45A3C;
  --rail-soft:rgba(196,90,60,.12);
  --line:rgba(28,27,24,.10);
  --card:#FFFDF7;
  --shadow:0 24px 60px -24px rgba(28,27,24,.22), 0 4px 14px -6px rgba(28,27,24,.10);
  --shadow-soft:0 12px 40px -18px rgba(28,27,24,.18);
  --r-lg:24px; --r-md:16px;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{
  font-family:var(--sans); background:var(--paper); color:var(--ink);
  font-size:17px; line-height:1.6; -webkit-font-smoothing:antialiased;
  overflow-x:hidden;
}
/* faint paper texture via gradients, zero bytes */
body::before{
  content:""; position:fixed; inset:0; pointer-events:none; z-index:0;
  background:
    radial-gradient(1200px 600px at 80% -10%, rgba(196,90,60,.05), transparent 60%),
    repeating-linear-gradient(0deg, transparent 0 2px, rgba(28,27,24,.012) 2px 4px);
}
main,header,footer{position:relative;z-index:1}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
h1,h2,h3{font-family:var(--serif);font-weight:600;letter-spacing:-.01em;line-height:1.15}
h1{font-size:clamp(2.4rem,6vw,4.2rem)}
h2{font-size:clamp(1.8rem,4vw,2.6rem)}
p{max-width:65ch}
a{color:var(--rail);text-decoration:none}
:focus-visible{outline:3px solid var(--rail);outline-offset:3px;border-radius:6px}
img{display:block}

/* ---------- header ---------- */
.site-head{position:sticky;top:0;z-index:50;backdrop-filter:blur(10px);background:rgba(247,243,233,.82);border-bottom:1px solid transparent;transition:border-color .3s}
.site-head.scrolled{border-bottom-color:var(--line)}
.head-in{display:flex;align-items:center;justify-content:space-between;height:78px}
.brand{display:flex;align-items:center;gap:12px;color:var(--ink);font-family:var(--serif);font-size:1.55rem;font-weight:600;letter-spacing:-.01em}
.brand img,.brand svg{width:40px;height:40px;border-radius:10px;box-shadow:0 2px 6px rgba(28,27,24,.15)}
.head-nav{display:flex;align-items:center;gap:24px}
.head-nav a{color:var(--graphite);font-size:.95rem;position:relative}
.head-nav a:not(.btn)::after{content:"";position:absolute;left:0;bottom:-3px;width:100%;height:1.5px;background:var(--rail);transform:scaleX(0);transform-origin:right;transition:transform .2s ease}
.head-nav a:not(.btn):hover::after{transform:scaleX(1);transform-origin:left}
.head-nav a:not(.btn):hover{color:var(--ink)}
@media (max-width:560px){.head-nav a:not(.btn){display:none}}

/* ---------- buttons ---------- */
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--rail);color:#FFFDF7;font-weight:400;font-size:1rem;padding:10px 22px;border-radius:999px;border:none;cursor:pointer;text-decoration:none;transition:transform .18s ease,box-shadow .18s ease,filter .18s ease}
.btn:hover{transform:translateY(-2px);filter:brightness(1.06)}
.btn:active{transform:scale(.98)}
.btn-lg{padding:14px 30px;font-size:1.05rem}
.head-nav .btn{background:var(--card);color:var(--ink);border:1px solid var(--line);box-shadow:var(--shadow-soft)}
.head-nav .btn:hover{border-color:var(--rail);color:var(--rail);filter:none}
.btn-hero{box-shadow:0 8px 24px -8px rgba(196,90,60,.55);animation:ctaPulse 3.2s ease-in-out infinite}
@keyframes ctaPulse{0%,100%{box-shadow:0 8px 24px -8px rgba(196,90,60,.5)}50%{box-shadow:0 14px 38px -8px rgba(196,90,60,.7)}}
.btn-ghost{background:transparent;color:var(--graphite);padding:10px 18px;font-weight:500}
.btn-ghost:hover{color:var(--ink);transform:translateY(-2px)}
.btn-ghost:active{transform:scale(.98)}

/* ---------- hero ---------- */
.hero{padding:88px 0 40px;text-align:center}
.hero .wordmark{font-family:var(--serif);font-size:clamp(1.5rem,3vw,1.9rem);font-weight:600;letter-spacing:.01em;color:var(--ink);margin-bottom:14px}
.hero p.lede{margin:26px auto 0;font-size:clamp(1.1rem,2.2vw,1.35rem);color:var(--graphite)}
#hero-h{display:flex;align-items:center;justify-content:center;gap:.28em;flex-wrap:wrap}
.rotator{display:inline-grid;overflow:hidden;height:1.3em;text-align:center;color:var(--rail);font-weight:600}
.rotator span{grid-area:1/1;align-self:center;white-space:nowrap;transition:transform .5s ease,opacity .5s ease}
.rotator span:not(.on){transform:translateY(115%);opacity:0}
.rotator span.prev{transform:translateY(-115%)!important}
.hero-cta{margin-top:36px;display:flex;flex-direction:column;align-items:center;gap:18px}
.hero-links{display:flex;align-items:center;gap:20px;flex-wrap:wrap;justify-content:center}
.small-print{font-size:.85rem;color:var(--graphite)}
.small-print .dot{margin:0 8px;color:var(--rail)}

/* hero bullets */
.hero-bullets{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:32px}
.chip{display:inline-flex;align-items:center;gap:8px;font-size:.88rem;color:var(--graphite);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 16px;box-shadow:var(--shadow-soft);transition:transform .18s ease,box-shadow .18s ease}
.chip:hover{transform:translateY(-2px);box-shadow:var(--shadow)}
.chip svg{width:15px;height:15px;stroke:var(--rail);flex:none}

/* ---------- 3d showcase stage ---------- */
.stage{margin:64px auto 0;max-width:920px;perspective:1600px}
.showcase{position:relative;display:flex;align-items:center;justify-content:center;gap:44px;transform-style:preserve-3d;transition:transform .25s ease-out;will-change:transform}
/* phone */
.phone{transform-style:preserve-3d;width:212px;flex:none;background:#211F1B;border-radius:42px;padding:9px;box-shadow:0 40px 80px -30px rgba(28,27,24,.45), 0 8px 20px -8px rgba(28,27,24,.25), inset 0 0 0 2px #37332c;transform:rotateY(14deg) rotateX(4deg) translateZ(30px);z-index:1;position:relative}
.phone::before{content:"";position:absolute;left:-3px;top:104px;width:3px;height:34px;border-radius:2px 0 0 2px;background:#33302a;box-shadow:0 44px 0 #33302a}
.phone::after{content:"";position:absolute;right:-3px;top:140px;width:3px;height:72px;border-radius:0 2px 2px 0;background:#33302a}
.phone-screen{position:relative;background:linear-gradient(180deg,#FBF8F0,#F3EDDE);border-radius:34px;overflow:hidden;padding:0;min-height:430px;display:flex;flex-direction:column}
.phone-island{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:72px;height:20px;background:#211F1B;border-radius:99px;z-index:2}
.phone-island::after{content:"";position:absolute;right:7px;top:50%;transform:translateY(-50%);width:8px;height:8px;border-radius:50%;background:#0e0d0b;box-shadow:inset 0 0 2px 1px #1f3a4d}
.js .share-card,.js .answer-swap{transition:transform .3s ease,opacity .3s ease}
.js .leaving{transform:translateX(-22px);opacity:0}
.js .entering{transform:translateX(22px);opacity:0;transition:none}
.stage-dots{display:flex;justify-content:center;gap:8px;margin-top:26px}
.stage-dot{width:9px;height:9px;padding:0;border-radius:50%;background:var(--paper-3);border:1px solid var(--line);cursor:pointer;transition:background .3s,transform .3s}
.stage-dot:hover{transform:scale(1.35)}
.stage-dot.on{background:var(--rail);border-color:var(--rail);transform:scale(1.3)}

/* mock window chrome */
.answer-win{flex:1;max-width:480px;background:var(--card);border-radius:var(--r-lg);border:1px solid var(--line);box-shadow:var(--shadow);transform:rotateY(-10deg) rotateX(3deg) translateZ(70px);overflow:hidden;text-align:left}
.win-bar{display:flex;align-items:center;gap:6px;padding:12px 16px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#FBF8F0,#F5F0E2)}
.win-dot{width:10px;height:10px;border-radius:50%}
.win-dot:nth-child(1){background:#E5887A}.win-dot:nth-child(2){background:#EBC97E}.win-dot:nth-child(3){background:#9DC79A}
.win-title{margin-left:18px;font-family:var(--mono);font-size:.68rem;color:var(--graphite)}
.win-body{padding:20px 22px 24px}
.win-tag{display:inline-block;font-family:var(--mono);font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--rail);background:var(--rail-soft);border-radius:6px;padding:3px 8px;margin-bottom:12px}
.win-body h3{font-size:1.15rem;margin-bottom:8px}
.win-body .src{font-size:.78rem;color:var(--graphite);margin-top:14px;border-top:1px dashed var(--line);padding-top:12px;display:flex;gap:14px;flex-wrap:wrap}
.win-body .src b{color:var(--ink);font-weight:600}
.sim-line{height:9px;border-radius:99px;background:var(--paper-3);margin:7px 0}
.sim-line.w80{width:80%}.sim-line.w95{width:95%}.sim-line.w60{width:60%}
/* share-to-doubletake mini share sheet between phone and answer */
.stage-flow{flex:none;display:flex;flex-direction:column;align-items:center;gap:12px;transform:translateZ(60px);transform-style:preserve-3d}
.sf-sheet{width:172px;background:#FBF8F0;border:1px solid var(--line);border-radius:18px;padding:8px 13px 12px;box-shadow:var(--shadow)}
.sf-grab{width:36px;height:4px;border-radius:99px;background:rgba(28,27,24,.22);margin:0 auto 7px}
.sf-title{text-align:center;font-size:.56rem;font-weight:600;letter-spacing:.04em;color:var(--graphite);margin-bottom:8px}
.sf-prev{display:flex;align-items:center;gap:8px;padding-bottom:9px;border-bottom:1px solid var(--line);margin-bottom:10px}
.sf-thumb{width:28px;height:28px;border-radius:8px;flex:none;background:linear-gradient(135deg,#DD2A7B,#8134AF);display:grid;place-items:center;color:#fff}
.sf-thumb svg{width:11px;height:11px}
.sf-tline{display:block;height:5px;border-radius:99px;background:var(--paper-3)}
.sf-tline.l1{width:64px;margin-bottom:4px}
.sf-tline.l2{width:42px}
.sf-apps{display:flex;justify-content:space-between}
.sf-app{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:.5rem;color:var(--graphite);position:relative}
.sf-ic{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#fff}
.sf-ic svg{width:14px;height:14px}
.sf-ic.msg{background:linear-gradient(135deg,#45d052,#2bb83a)}
.sf-ic.mail{background:linear-gradient(135deg,#4aa3ff,#2b7de9)}
.sf-ic.dt{background:var(--rail);font-family:var(--serif);font-weight:700;box-shadow:0 0 0 1.5px var(--paper),0 0 0 3px var(--rail)}
.sf-app.on{color:var(--ink);font-weight:600}
.sf-check{position:absolute;top:-4px;right:-4px;width:13px;height:13px;border-radius:50%;background:#3E7A4E;color:#fff;display:grid;place-items:center;border:1.5px solid #FBF8F0}
.sf-check svg{width:7px;height:7px}
.sf-arrow{color:var(--rail);font-size:1.8rem;line-height:1}
.sf-arrow{color:var(--rail);font-size:1.8rem;line-height:1}
@media (max-width:760px){
  .stage{perspective:1000px}
  .showcase{flex-direction:column;gap:18px}
  .stage-flow{flex-direction:row;transform:none}
  .sf-sheet{width:150px}
  .phone{width:186px;transform:rotateY(0) rotateX(0)}
  .phone-screen{min-height:360px}
  .answer-win{transform:none;width:100%}
}

/* ---------- sections ---------- */
section{padding:110px 0}
.section-head{max-width:640px;margin-bottom:56px}
.eyebrow{font-family:var(--mono);font-size:.75rem;text-transform:uppercase;letter-spacing:.18em;color:var(--rail);margin-bottom:14px}
.section-head p{color:var(--graphite);margin-top:14px;font-size:1.05rem}

/* how it works — connected flow diagram */
.flow{display:grid;grid-template-columns:repeat(3,1fr);gap:32px;position:relative}
.flow::before{content:"";position:absolute;top:31px;left:14%;right:14%;height:2px;background:repeating-linear-gradient(90deg,rgba(196,90,60,.5) 0 10px,transparent 10px 20px)}
.flow-step{text-align:center;padding:0 8px}
.flow-node{width:62px;height:62px;margin:0 auto 14px;border-radius:50%;background:var(--card);border:2px solid var(--rail);display:grid;place-items:center;color:var(--rail);box-shadow:var(--shadow-soft);position:relative;z-index:1;transition:transform .25s ease,box-shadow .25s ease}
.flow-node svg{width:26px;height:26px}
.flow-node .n-num{position:absolute;top:-7px;right:-7px;width:21px;height:21px;border-radius:50%;background:var(--rail);color:#FFFDF7;font-family:var(--mono);font-size:.66rem;display:grid;place-items:center;box-shadow:0 2px 6px rgba(28,27,24,.25)}
.flow-step:hover .flow-node{transform:translateY(-4px) scale(1.07);box-shadow:var(--shadow)}
.flow-ui{display:flex;align-items:center;justify-content:center;gap:9px;margin:0 auto 16px;flex-wrap:wrap}
.fu-card{display:inline-flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:7px 10px;box-shadow:var(--shadow-soft);transition:transform .25s ease,box-shadow .25s ease}
.flow-step:hover .fu-card{transform:translateY(-3px);box-shadow:var(--shadow)}
.fu-thumb{width:18px;height:18px;border-radius:6px;flex:none;background:linear-gradient(135deg,#DD2A7B,#8134AF);display:grid;place-items:center;color:#fff}
.fu-thumb svg{width:9px;height:9px}
.fu-lines{display:flex;flex-direction:column;gap:3px}
.fu-lines i{display:block;width:34px;height:4px;border-radius:99px;background:var(--paper-3)}
.fu-lines i:last-child{width:22px}
.fu-app{width:20px;height:20px;border-radius:6px;background:var(--rail);color:#FFFDF7;font-family:var(--serif);font-weight:700;font-size:.62rem;display:grid;place-items:center;flex:none}
.fu-ok{width:16px;height:16px;border-radius:50%;background:#3E7A4E;color:#fff;display:grid;place-items:center;flex:none}
.fu-ok svg{width:8px;height:8px}
.fu-arrow{color:var(--rail);opacity:.6;flex:none}
.fu-arrow svg{width:13px;height:13px}
.fu-bubble{max-width:120px;border-radius:12px;padding:6px 10px;font-size:.62rem;line-height:1.35;display:flex;align-items:center;gap:5px}
.fu-bubble.q{background:var(--ink);color:var(--paper);border-bottom-right-radius:4px}
.fu-bubble.a{background:var(--card);border:1px solid var(--line);color:var(--graphite);border-bottom-left-radius:4px}
.fu-bubble svg{width:10px;height:10px;flex:none}
.fu-bubble b{color:var(--rail);font-weight:600}
.fu-bubble.a b{color:var(--ink)}
.fu-cost{font-family:var(--mono);font-size:.55rem;color:var(--graphite)}
.fu-verdict{display:inline-flex;align-items:center;gap:4px;font-size:.62rem;font-weight:600;color:#3E7A4E}
.flow-step .when{font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--graphite);margin-bottom:8px}
.flow-step h3{font-size:1.3rem;margin-bottom:10px}
.flow-step p{font-size:.95rem;color:var(--graphite);margin:0 auto}
@media (max-width:860px){
  .flow{grid-template-columns:1fr;gap:46px;max-width:460px;margin:0 auto}
  .flow::before{left:30px;right:auto;top:12px;bottom:12px;width:2px;height:auto;background:repeating-linear-gradient(180deg,rgba(196,90,60,.5) 0 10px,transparent 10px 20px)}
}

/* feature spots (alternating) */
.spot{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center;margin-top:96px}
.spot:first-of-type{margin-top:0}
.spot.flip .spot-copy{order:2}
.spot h3{font-size:clamp(1.5rem,3vw,2rem);margin-bottom:18px}
.spot ul{list-style:none;margin-top:8px}
.spot li{position:relative;padding-left:26px;margin:12px 0;color:var(--graphite);font-size:1rem}
.spot li::before{content:"";position:absolute;left:0;top:.62em;width:12px;height:2px;background:var(--rail)}
@media (max-width:860px){.spot{grid-template-columns:1fr;gap:36px}.spot.flip .spot-copy{order:0}}

/* mock windows inside spots */
.mock{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);box-shadow:var(--shadow);overflow:hidden;transition:transform .3s ease,box-shadow .3s ease;transform:perspective(1200px) rotateY(-4deg) rotateX(2deg)}
.spot.flip .mock{transform:perspective(1200px) rotateY(4deg) rotateX(2deg)}
.mock:hover{transform:perspective(1200px) rotateY(0) rotateX(0) translateY(-4px);box-shadow:0 30px 70px -24px rgba(28,27,24,.28)}
.mock-body{padding:22px}
.run-cost{display:flex;justify-content:space-between;font-family:var(--mono);font-size:.7rem;color:var(--graphite);background:var(--paper-2);border-radius:10px;padding:8px 12px;margin-top:14px}
.run-cost b{color:var(--ink)}
.verdict{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:600;color:#3E7A4E;background:rgba(62,122,78,.1);border-radius:8px;padding:4px 10px;margin-bottom:10px}
.key-cards{display:flex;flex-direction:column;gap:16px}
.key-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:18px 20px;box-shadow:var(--shadow-soft);display:flex;gap:14px;align-items:flex-start;transition:transform .22s ease,box-shadow .22s ease}
.key-card:hover{transform:translateX(6px);box-shadow:var(--shadow)}
.key-card .k-icon{width:38px;height:38px;flex:none;border-radius:11px;background:var(--rail-soft);display:grid;place-items:center;color:var(--rail);font-family:var(--serif);font-weight:700}
.key-card h4{font-size:1rem;margin-bottom:3px}
.key-card p{font-size:.85rem;color:var(--graphite)}

/* agent chat base */
.chat{display:flex;flex-direction:column;gap:12px}
.msg{max-width:85%;padding:11px 15px;border-radius:16px;font-size:.86rem;line-height:1.5}
.msg.you{align-self:flex-end;background:var(--ink);color:var(--paper);border-bottom-right-radius:4px}
.msg.agent{align-self:flex-start;background:linear-gradient(150deg,#FFFDF7 20%,#F0E9D7);border:1px solid var(--line);border-bottom-left-radius:4px;inset 0 1px 0 rgba(255,255,255,.8)}
.msg .who{display:block;font-family:var(--mono);font-size:.6rem;text-transform:uppercase;letter-spacing:.12em;margin-bottom:4px;opacity:.65}
.tool-call{font-family:var(--mono);font-size:.7rem;color:var(--rail);background:var(--rail-soft);border-radius:8px;padding:6px 10px;align-self:flex-start}
.trust-line{margin-top:44px;font-family:var(--serif);font-style:italic;font-size:clamp(1.15rem,2.4vw,1.45rem);max-width:52ch}
.trust-line em{color:var(--rail);font-style:italic}

/* faq — numbered, full width, animated fold */
.faq{max-width:none;counter-reset:faq}
.faq details{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);margin-bottom:14px;box-shadow:var(--shadow-soft);overflow:hidden;transition:box-shadow .25s ease,transform .25s ease,border-color .25s ease;position:relative}
.faq details:hover{transform:translateY(-3px);box-shadow:var(--shadow)}
.faq details[open]{box-shadow:var(--shadow);border-color:rgba(196,90,60,.35)}
.faq summary{cursor:pointer;list-style:none;padding:22px 32px;font-family:var(--serif);font-size:1.12rem;display:flex;align-items:baseline;gap:16px;user-select:none}
.faq summary::-webkit-details-marker{display:none}
.faq .q-num{counter-increment:faq;font-family:var(--mono);font-size:.72rem;color:var(--rail);letter-spacing:.08em;flex:none;transform:translateY(-2px)}
.faq .q-num::before{content:"0" counter(faq)}
.faq summary::after{content:"+";font-family:var(--serif);font-size:1.6rem;color:var(--rail);margin-left:auto;transition:transform .3s ease;flex:none;line-height:1}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{padding:0 32px 26px 70px;color:var(--graphite);font-size:.98rem;margin:0}
.faq .fold{display:grid;grid-template-rows:0fr;transition:grid-template-rows .4s ease}
.faq details.open .fold{grid-template-rows:1fr}
.faq .fold>div{overflow:hidden}

/* site skeleton page inside the phone */
.phone-app{flex:1;min-height:0;margin:0;border-radius:0;background:#fff;display:flex;overflow:hidden}
.phone-app .share-card{flex:1;border:none;border-radius:0;padding:0;display:flex}
.sk{display:flex;flex-direction:column;width:100%;font-size:.6rem;color:var(--graphite)}
.sk-bar{display:flex;align-items:center;gap:6px;padding:32px 9px 7px;border-bottom:1px solid var(--line);font-weight:700;font-size:.6rem;color:var(--ink);flex:none}
.sk-bar .grow,.sk-name .grow{flex:1;min-width:0}
.sk-dot{width:14px;height:14px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-size:.5rem;font-weight:700}
.sk-body{flex:1;padding:8px 9px;display:flex;flex-direction:column;gap:6px;min-height:0}
.sk-line{height:6px;border-radius:99px;background:var(--paper-3);flex:none}
.sk-line.w90{width:90%}.sk-line.w75{width:75%}.sk-line.w55{width:55%}.sk-line.w35{width:35%}
.sk-name{display:flex;align-items:center;gap:5px}
.sk-media{flex:1;border-radius:10px;background:linear-gradient(160deg,var(--paper-2),var(--paper-3));display:grid;place-items:center;color:var(--graphite);font-size:1rem;min-height:56px;position:relative;overflow:hidden}
.sk-rail{position:absolute;right:6px;bottom:6px;display:flex;flex-direction:column;gap:5px}
.sk-rail span{width:16px;height:16px;border-radius:50%;background:#fff;border:1px solid var(--line);display:grid;place-items:center;font-size:.5rem;color:var(--ink)}
.sk-btn{align-self:flex-start;border-radius:99px;padding:3px 10px;font-weight:700;font-size:.55rem;color:#fff;flex:none}
.sk-foot{display:flex;gap:10px;align-items:center;padding:6px 9px;border-top:1px solid var(--line);font-size:.55rem;flex:none}
.sk-tabs{display:flex;gap:12px;font-size:.6rem;color:var(--graphite);padding-top:24px}
.sk-video{width:100%;aspect-ratio:16/9;background:linear-gradient(160deg,#211F1B,#3a372f);display:grid;place-items:center;color:#fff;position:relative;flex:none}
.sk-video svg{width:16px;height:16px}
.sk-video::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.25)}
.sk-video::before{content:"";position:absolute;left:0;bottom:0;height:3px;width:38%;background:#B3261E;z-index:1}
.sk-acts{display:flex;justify-content:space-between;gap:4px}
.sk-act{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:.42rem;color:var(--graphite);flex:1}
.sk-act svg{width:10px;height:10px}
.sk-chip{display:inline-flex;align-items:center;gap:4px;background:var(--paper-2);border-radius:99px;padding:2px 7px;font-size:.48rem;font-weight:600;color:var(--ink)}
.sk-tabs b{color:var(--ink);border-bottom:2px solid var(--ink);padding-bottom:2px}
.sk-ig .sk-dot{background:linear-gradient(45deg,#F58529,#DD2A7B,#8134AF)}
.sk-ig .sk-btn{background:linear-gradient(45deg,#F58529,#DD2A7B)}
.sk-yt .sk-dot{background:#B3261E;border-radius:4px}
.sk-yt .sk-btn{background:#B3261E}
.sk-tt .sk-dot{background:#111;box-shadow:-1.5px -1.5px 0 #25F4EE,1.5px 1.5px 0 #FE2C55}
.sk-tt .sk-media{background:linear-gradient(160deg,#1c1b18,#3a372f);color:#eee}
.sk-tt .sk-rail span{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.3);color:#fff}
.sk-cap{position:absolute;left:8px;bottom:8px;right:34px;display:flex;flex-direction:column;gap:4px}
.sk-cap i{display:block;height:5px;border-radius:99px;background:rgba(255,255,255,.85)}
.sk-cap i:nth-child(2){width:55%;background:rgba(255,255,255,.45)}
.sk-cap .sk-cap-music{height:auto;display:flex;align-items:center;gap:4px;font-size:.48rem;color:rgba(255,255,255,.8);margin-top:2px}
.sk-cap .sk-cap-music svg{width:9px;height:9px}
.sk-tt .sk-btn{background:#111}
.sk-rd .sk-dot{background:#D94214}
.sk-rd .sk-btn{background:#D94214}
.sk-xx .sk-dot{background:#000}
.sk-xx .sk-btn{background:#000}
.sk-ph{width:100%;height:100%;display:grid;grid-template-columns:1.6fr 1fr;grid-template-rows:1fr 1fr;gap:5px;background:var(--paper-2);border-radius:10px;padding:6px;min-height:36px;box-sizing:border-box}
.sk-ph i{display:block;background:var(--paper-3);border-radius:6px}
.sk-ph i:first-child{grid-row:1/3}
.sk-ph .ph-dot{width:14px;height:14px;border-radius:50%;background:var(--paper-3);justify-self:end}

/* agent chat vignette */
.js .chat .msg,.js .chat .tool-call{opacity:0;transform:translateY(10px);transition:opacity .4s ease,transform .4s ease}
.js .chat .msg.agent{transform:translateY(14px)}
.js .chat .show{opacity:1;transform:none}
.chat-caret{display:inline-block;width:8px;height:.95em;background:var(--rail);margin-left:2px;vertical-align:-2px;animation:caretBlink 1s steps(1) infinite}
@keyframes caretBlink{50%{opacity:0}}

/* footer */
footer{border-top:1px solid var(--line);padding:56px 0 64px;background:linear-gradient(180deg,var(--paper),var(--paper-2))}
.foot-grid{display:flex;flex-wrap:wrap;justify-content:space-between;gap:28px;align-items:flex-start}
.foot-nav{display:flex;gap:22px;flex-wrap:wrap}
.foot-nav a{color:var(--graphite);font-size:.9rem}
.foot-nav a:hover{color:var(--rail)}
.foot-note{font-size:.85rem;color:var(--graphite);max-width:40ch}
.foot-note a{text-decoration:underline;text-underline-offset:3px}
.copyright{margin-top:36px;font-size:.82rem;color:var(--graphite)}

/* ---------- motion ---------- */
.js .reveal{opacity:0;transform:translateY(26px);transition:opacity .5s ease-out,transform .5s ease-out;transition-delay:var(--d,0ms)}
.js .reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  .js .reveal{opacity:1;transform:none;transition:none}
  .btn-hero{animation:none}
  .showcase,.mock{transform:none!important;transition:none}
  *{transition-duration:.01ms!important}
}
</style>
</head>
<body>

<header class="site-head" id="siteHead">
  <div class="wrap head-in">
    <a class="brand" href="/" aria-label="Doubletake home">
      <svg width="40" height="40" viewBox="0 0 120 120" role="img" aria-label="Doubletake logo, a cream square with a red rail and a serif D"><rect width="120" height="120" rx="26" fill="#F7F3E9"/><rect x="16" y="18" width="8" height="84" rx="4" fill="#C45A3C"/><text x="64" y="88" font-family="Georgia,serif" font-size="68" fill="#1C1B18" text-anchor="middle">D</text></svg>
    </a>
    <nav class="head-nav" aria-label="Primary">
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a class="btn" href="/login">Sign in</a>
    </nav>
  </div>
</header>

<main>

  <!-- HERO -->
  <section class="hero" aria-labelledby="hero-h">
    <div class="wrap">
      <p class="wordmark reveal">Doubletake</p>
      <h1 id="hero-h" class="reveal" style="--d:60ms">Send <span class="rotator" id="rotor"><span class="on">reels</span><span>videos</span><span>posts</span><span>threads</span><span>links</span></span> to your agent.</h1>
      <p class="lede reveal" style="--d:140ms">Save it now. Get a researched answer for when you need.</p>

      <div class="hero-cta reveal" style="--d:220ms">
        <div class="hero-links">
          <a class="btn btn-lg btn-hero" href="/login">Sign in</a>
          <a class="btn btn-ghost" href="#how">How it works ↓</a>
        </div>
        <p class="small-print">Free<span class="dot">·</span>Bring your own AI keys<span class="dot">·</span>Your library, deletable anytime</p>
      </div>

      <div class="hero-bullets reveal" style="--d:300ms">
        <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>Free</span>
        <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Your keys, your limits</span>
        <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>Deletable anytime</span>
      </div>

      <!-- 3D showcase: phone share sheet -> answer window -->
      <div class="stage reveal" style="--d:380ms">
        <div class="showcase" id="tilt" data-tilt>
          <div class="phone" aria-hidden="true">
            <div class="phone-screen">
              <div class="phone-island"></div>
              <div class="phone-app">
                <div class="share-card sk-ig" id="shareCard"><div class="sk"><div class="sk-bar"><span class="sk-dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></svg></span>Reels<span class="grow"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:11px;height:11px"><path d="M4 6h16M4 12h16M4 18h16"/></svg></div><div class="sk-body"><div class="sk-line w90"></div><div class="sk-media"><svg viewBox="0 0 24 24" fill="currentColor" style="width:15px;height:15px"><path d="M8 5v14l11-7z"/></svg></div><div class="sk-name"><span class="sk-dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></svg></span><span class="grow"><div class="sk-line w55"></div></span><span class="sk-btn">Follow</span></div></div></div></div>
              </div>
            </div>
          </div>
          <div class="stage-flow" aria-hidden="true">
            <div class="sf-sheet">
              <div class="sf-grab"></div>
              <div class="sf-title">Share to</div>
              <div class="sf-prev"><span class="sf-thumb"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><span><span class="sf-tline l1"></span><span class="sf-tline l2"></span></span></div>
              <div class="sf-apps">
                <span class="sf-app"><span class="sf-ic msg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg></span>Message</span>
                <span class="sf-app"><span class="sf-ic mail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></span>Mail</span>
                <span class="sf-app on"><span class="sf-ic dt">D<span class="sf-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span></span>Doubletake</span>
              </div>
            </div>
            <span class="sf-arrow">→</span>
          </div>
          <div class="answer-win" role="img" aria-label="Mock answer card showing a sourced verdict for a saved video">
            <div class="win-bar"><span class="win-dot"></span><span class="win-dot"></span><span class="win-dot"></span><span class="win-title">doubletake · saved post</span></div>
            <div class="win-body">
              <div class="answer-swap" id="answerSwap">
                <span class="win-tag">Researched answer</span>
                <h3 id="ansH">Mostly true, with a catch.</h3>
                <div class="sim-line w95"></div>
                <div class="sim-line w80"></div>
                <div class="sim-line w60"></div>
                <p id="ansClaim" style="font-size:.85rem;color:var(--graphite);margin-top:10px">The tool is real and free for small projects. The claim about "replacing your stack" skips the paid tier.</p>
                <div class="src"><span>Sources <b id="ansSrc">4</b></span><span>Transcript <b id="ansTr">12:04</b></span><span>Run cost <b id="ansCost">$0.008</b></span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="stage-dots" id="stageDots" aria-hidden="true"></div>
      </div>
    </div>
  </section>

  <!-- HOW IT WORKS -->
  <section id="how" aria-labelledby="how-h">
    <div class="wrap">
      <div class="section-head reveal">
        <p class="eyebrow">How it works</p>
        <h2 id="how-h">While you scroll. Minutes later. Weeks later.</h2>
      </div>
      <div class="flow">
        <article class="flow-step reveal" style="--d:0ms">
          <div class="flow-node"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v13"/><path d="M7 8l5-5 5 5"/></svg><span class="n-num">1</span></div>
          <div class="flow-ui" aria-hidden="true"><span class="fu-card"><span class="fu-thumb"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><span class="fu-lines"><i></i><i></i></span></span><span class="fu-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></span><span class="fu-card"><span class="fu-app">D</span><span class="fu-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span></span></div>
          <p class="when">While you scroll</p>
          <h3>Share</h3>
          <p>Send any post to Doubletake from your phone's share sheet, or paste a URL. Optionally add a question, or just say nothing and let it figure the post out.</p>
        </article>
        <article class="flow-step reveal" style="--d:120ms">
          <div class="flow-node"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><span class="n-num">2</span></div>
          <div class="flow-ui" aria-hidden="true"><span class="fu-card"><span class="fu-lines"><i></i><i></i><i></i></span></span><span class="fu-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></span><span class="fu-card"><span class="fu-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span><span><span class="fu-verdict">Verdict</span><br><span class="fu-cost">$0.008 · 4 sources</span></span></span></div>
          <p class="when">A few minutes later</p>
          <h3>Research</h3>
          <p>The video gets transcribed, the frames read, the claim checked against the web. You get a sourced answer. Verdicts, not vibes, with the cost of the run shown.</p>
        </article>
        <article class="flow-step reveal" style="--d:240ms">
          <div class="flow-node"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/><path d="M8 11h8"/><path d="M8 15h5"/></svg><span class="n-num">3</span></div>
          <div class="flow-ui" aria-hidden="true"><span class="fu-bubble q"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>what was that tool?</span><span class="fu-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></span><span class="fu-bubble a"><span class="fu-app" style="width:16px;height:16px;font-size:.5rem">D</span><span><b>Brushline</b>, free · <span class="fu-cost">saved 3w ago</span></span></span></div>
          <p class="when">Weeks later, ask your agent</p>
          <h3>Remember</h3>
          <p>Every save becomes searchable memory. Connect Claude Code or any MCP agent and ask it what you saved, weeks later. It knows.</p>
        </article>
      </div>
    </div>
  </section>

  <!-- BYOK TRUST -->
  <section aria-labelledby="keys-h">
    <div class="wrap">
      <div class="section-head reveal">
        <p class="eyebrow">Your keys</p>
        <h2 id="keys-h">We can't run up your bill. We never hold the keys you don't give us.</h2>
      </div>
      <div class="spot">
        <div class="spot-copy reveal">
          <h3>Why bring your own keys</h3>
          <ul>
            <li>Connect OpenRouter, one click. The key is yours, capped and revocable in one place.</li>
            <li>Or paste a key. Encrypted at rest, spend limits you set, wiped the moment you revoke.</li>
            <li>Or run your own agent. Point Doubletake at your own harness and we never hold a credential at all.</li>
          </ul>
        </div>
        <div class="reveal" style="--d:120ms">
          <div class="mock" role="img" aria-label="Mock settings window showing three ways to connect an AI key">
            <div class="win-bar"><span class="win-dot"></span><span class="win-dot"></span><span class="win-dot"></span><span class="win-title">settings · ai keys</span></div>
            <div class="mock-body key-cards">
              <div class="key-card"><span class="k-icon">◉</span><div><h4>Connect OpenRouter</h4><p>One click. Capped, revocable in one place.</p></div></div>
              <div class="key-card"><span class="k-icon">⌘</span><div><h4>Paste a key</h4><p>Encrypted at rest. Your spend limit: $5 / month.</p></div></div>
              <div class="key-card"><span class="k-icon">⇄</span><div><h4>Your own harness</h4><p>We hold no credential at all.</p></div></div>
            </div>
          </div>
        </div>
      </div>
      <p class="trust-line reveal">We don't run models and we don't bill you for AI. <em>Your tokens, your limits, your receipts</em>, shown on every single run.</p>
    </div>
  </section>

  <!-- AGENTS -->
  <section aria-labelledby="agents-h">
    <div class="wrap">
      <div class="spot flip">
        <div class="spot-copy reveal">
          <p class="eyebrow">For your agents</p>
          <h2 id="agents-h">Doubletake isn't a bookmark folder. It's a memory your AI can read.</h2>
          <ul>
            <li>Every account gets a personal token for its agent.</li>
            <li>The agent can search your library, read your answers, and queue new saves.</li>
            <li>Works with Claude Code and Truss out of the box.</li>
          </ul>
        </div>
        <div class="reveal" style="--d:120ms">
          <div class="mock" id="chatMock" data-tilt role="img" aria-label="Mock chat window where an agent answers from saved research">
            <div class="win-bar"><span class="win-dot"></span><span class="win-dot"></span><span class="win-dot"></span><span class="win-title">claude code · your library</span></div>
            <div class="mock-body chat" id="chat">
              <div class="msg you" id="mYou"><span class="who">You</span><span class="txt">What was that tool from the reel I saved last week?</span></div>
              <div class="tool-call" id="mTool">search_library("tool from reel") → 1 hit</div>
              <div class="msg agent" id="mAgent"><span class="who">Agent</span><span class="txt">It was Brushline, a free color-grading tool. Your saved answer notes it's web-only and the $9 tier unlocks 4K export. Want the link?</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- RUN RECEIPT SPOT -->
  <section aria-labelledby="runs-h">
    <div class="wrap">
      <div class="spot">
        <div class="spot-copy reveal">
          <p class="eyebrow">Every run</p>
          <h2 id="runs-h">A receipt on every answer</h2>
          <ul>
            <li>See what a run cost before you ask a follow-up.</li>
            <li>Verdicts cite their sources, transcripts, and frames.</li>
            <li>Nothing is hidden in a black box.</li>
          </ul>
        </div>
        <div class="reveal" style="--d:120ms">
          <div class="mock" role="img" aria-label="Mock run receipt window with cost and sources">
            <div class="win-bar"><span class="win-dot"></span><span class="win-dot"></span><span class="win-dot"></span><span class="win-title">run · receipt</span></div>
            <div class="mock-body">
              <span class="verdict">✓ Claim checked · 4 sources</span>
              <div class="sim-line w95"></div>
              <div class="sim-line w80"></div>
              <div class="sim-line w60"></div>
              <div class="run-cost"><span>Transcription</span><b>$0.004</b></div>
              <div class="run-cost"><span>Web checks</span><b>$0.003</b></div>
              <div class="run-cost"><span>Total</span><b>$0.007</b></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section aria-labelledby="faq-h">
    <div class="wrap">
      <div class="section-head reveal">
        <p class="eyebrow">FAQ</p>
        <h2 id="faq-h">Plain answers</h2>
        <p>Asked often, answered once. Tap a question.</p>
      </div>
      <div class="faq reveal">
        <details>
          <summary><span class="q-num" aria-hidden="true"></span>Is it free?</summary>
          <p>Yes. You pay your AI provider directly, at your own caps.</p>
        </details>
        <details>
          <summary><span class="q-num" aria-hidden="true"></span>Do you see my API keys?</summary>
          <p>They're encrypted at rest, decrypted only in memory while your run executes, and never logged or displayed. Prefer zero custody? Use your own harness.</p>
        </details>
        <details>
          <summary><span class="q-num" aria-hidden="true"></span>What platforms work?</summary>
          <p>Instagram, TikTok, YouTube and Shorts, Reddit, X, plain links, raw text.</p>
        </details>
        <details>
          <summary><span class="q-num" aria-hidden="true"></span>What do you store?</summary>
          <p>Your library: links, transcripts, answers. Deletion is self-serve, immediate, and total. See the <a href="/privacy">privacy policy</a>.</p>
        </details>
        <details>
          <summary><span class="q-num" aria-hidden="true"></span>Self-hosting?</summary>
          <p>The core is open source (AGPL). Run your own instance; the hosted service adds accounts, BYOK and push.</p>
        </details>
      </div>
    </div>
  </section>

</main>

<footer>
  <div class="wrap">
    <div class="foot-grid">
      <nav class="foot-nav" aria-label="Footer">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/delete">Delete account</a>
        <a href="/contact">Contact</a>
      </nav>
      <p class="foot-note">Self-hosted? The core is open source. <a href="https://github.com/roowus/doubletake" rel="noopener">github.com/roowus/doubletake</a></p>
    </div>
    <p class="copyright">© 2026 Doubletake</p>
  </div>
</footer>

<script>
(function(){
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* sticky header hairline */
  var head = document.getElementById('siteHead');
  window.addEventListener('scroll', function(){
    head.classList.toggle('scrolled', window.scrollY > 8);
  }, {passive:true});

  /* scroll reveals */
  var els = document.querySelectorAll('.reveal');
  if (reduced || !('IntersectionObserver' in window)) {
    els.forEach ? els.forEach(function(e){e.classList.add('in')}) : null;
  } else {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if (en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, {threshold:.12, rootMargin:'0px 0px -40px 0px'});
    els.forEach(function(e){ io.observe(e); });
  }

  /* cursor effect: 3d tilt on every [data-tilt] showcase (hero, agent chat window) */
  if (!reduced && matchMedia('(pointer:fine)').matches) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-tilt]'), function(tilt){
      var stage = tilt.parentElement, raf = null;
      stage.addEventListener('pointermove', function(e){
        if (raf) return;
        raf = requestAnimationFrame(function(){
          var r = stage.getBoundingClientRect();
          var x = (e.clientX - r.left) / r.width - .5;
          var y = (e.clientY - r.top) / r.height - .5;
          tilt.style.transform = 'rotateY(' + (x*6) + 'deg) rotateX(' + (-y*4) + 'deg)';
          raf = null;
        });
      });
      stage.addEventListener('pointerleave', function(){ tilt.style.transform = ''; });
    });
  }

  /* hero word rotator */
  (function(){
    var rotor = document.getElementById('rotor');
    if (!rotor || reduced) return;
    var words = rotor.children, k = 0;
    setInterval(function(){
      var prev = k;
      k = (k + 1) % words.length;
      words[prev].classList.add('prev');
      words[prev].classList.remove('on');
      words[k].classList.add('on');
      setTimeout(function(){ words[prev].classList.remove('prev'); }, 520);
    }, 3200);
  })();

  /* hero showcase: platform feed — faster, draggable, clickable dots */
  (function(){
    var card = document.getElementById('shareCard');
    if (!card || reduced) return; // no-JS and reduced-motion keep the static Reel scene
var IC = function(paths, fill){
      return '<svg viewBox="0 0 24 24" fill="' + (fill ? 'currentColor' : 'none') + '" stroke="' + (fill ? 'none' : 'currentColor') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px">' + paths + '</svg>';
    };
    var feed = [
      {cls:'sk-ig', h:'Mostly true, with a catch.',
       claim:'The tool is real and free for small projects. The claim about "replacing your stack" skips the paid tier.',
       src:'4', tr:'0:43', cost:'$0.008',
       html:'<div class="sk"><div class="sk-bar"><span class="sk-dot">' + IC('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>') + '</span>Reels<span class="grow"></span>' + IC('<path d="M4 6h16M4 12h16M4 18h16"/>') + '</div><div class="sk-body"><div class="sk-line w90"></div><div class="sk-media"><svg viewBox="0 0 24 24" fill="currentColor" style="width:15px;height:15px"><path d="M8 5v14l11-7z"/></svg><div class="sk-rail"><span>' + IC('<path d="M12 21C7 16.5 3 13.3 3 9.5 3 7 5 5 7.5 5c1.7 0 3.3.9 4.5 2.4C13.2 5.9 14.8 5 16.5 5 19 5 21 7 21 9.5c0 3.8-4 7-9 11.5z"/>') + '</span><span>' + IC('<path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>') + '</span><span>' + IC('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v13"/><path d="M7 8l5-5 5 5"/>') + '</span></div></div><div class="sk-name"><span class="sk-dot">' + IC('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>') + '</span><span class="grow"><div class="sk-line w55"></div></span><span class="sk-btn">Follow</span></div></div></div>'},
      {cls:'sk-yt', h:'One method holds up.',
       claim:'Deep work blocks are the only one with solid evidence behind them. The rest is mostly packaging.',
       src:'6', tr:'18:41', cost:'$0.011',
       html:'<div class="sk"><div class="sk-video"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div><div class="sk-bar" style="padding-top:7px"><span class="sk-dot">' + IC('<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>') + '</span>YouTube<span class="grow"></span>' + IC('<path d="M15 10l4.5-2.5v9L15 14"/>') + ' ' + IC('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>') + '</div><div class="sk-body" style="padding-top:7px"><div class="sk-line w90"></div><div class="sk-line w55"></div><div class="sk-line w35"></div><div class="sk-acts"><span class="sk-act">' + IC('<path d="M7 10v12"/><path d="M15 5.9L14 10h5.5a2 2 0 0 1 1.9 2.6l-2.2 7A2 2 0 0 1 17.3 21H7V10l4-7z"/>') + 'Like</span><span class="sk-act">' + IC('<path d="M17 14v7"/><path d="M9 18.1L10 14H4.5a2 2 0 0 1-1.9-2.6l2.2-7A2 2 0 0 1 6.7 3H17v11l-4 7z"/>') + 'Dislike</span><span class="sk-act">' + IC('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v13"/><path d="M7 8l5-5 5 5"/>') + 'Share</span><span class="sk-act">' + IC('<path d="M12 17v5"/><path d="M8 17h8"/><path d="M6 17V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12"/>') + 'Save</span></div><div class="sk-name"><span class="sk-dot">' + IC('<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>') + '</span><span class="grow"><div class="sk-line w35"></div></span><span class="sk-btn">Subscribe</span></div><div class="sk-foot">' + IC('<path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>') + ' 214 comments · Top: "actually true"</div></div></div>'},
            {cls:'sk-tt', h:'Overhyped, but not useless.',
       claim:'It does one job well and one badly. The viral demo skips the cleanup step entirely.',
       src:'3', tr:'0:58', cost:'$0.004',
       html:'<div class="sk"><div class="sk-bar"><span class="sk-tabs"><span>Following</span><b>For You</b></span><span class="grow"></span>' + IC('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>') + '</div><div class="sk-body"><div class="sk-line w75"></div><div class="sk-media"><svg viewBox="0 0 24 24" fill="currentColor" style="width:15px;height:15px"><path d="M8 5v14l11-7z"/></svg><div class="sk-rail"><span>' + IC('<path d="M12 21C7 16.5 3 13.3 3 9.5 3 7 5 5 7.5 5c1.7 0 3.3.9 4.5 2.4C13.2 5.9 14.8 5 16.5 5 19 5 21 7 21 9.5c0 3.8-4 7-9 11.5z"/>') + '</span><span>' + IC('<path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>') + '</span><span>' + IC('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v13"/><path d="M7 8l5-5 5 5"/>') + '</span></div><div class="sk-cap"><i></i><i></i><span class="sk-cap-music">' + IC('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>') + ' original sound</span></div></div><div class="sk-name"><span class="grow"><div class="sk-line w55"></div><div class="sk-line w35" style="margin-top:4px"></div></span><span class="sk-btn">Follow</span></div><div class="sk-foot">' + IC('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>') + ' 4.1M likes</div></div></div>'},
      {cls:'sk-rd', h:'Yes, with caveats.',
       claim:'The thread lands on small local models for drafts, cloud for serious work. The cost math in comment 2 checks out.',
       src:'9', tr:'—', cost:'$0.006',
       html:'<div class="sk"><div class="sk-bar"><span class="sk-dot">' + IC('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>') + '</span>r/selfhosted<span class="grow"></span>' + IC('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>') + '</div><div class="sk-body"><div class="sk-line w90"></div><div class="sk-media" style="min-height:44px;padding:0"><span class="sk-ph"><i></i><i></i><i></i></span></div><div class="sk-line w75"></div><div class="sk-line w55"></div></div><div class="sk-foot">' + IC('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>') + ' ' + IC('<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>') + '<span class="grow"></span>' + IC('<path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>') + ' 318 <span>' + IC('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v13"/><path d="M7 8l5-5 5 5"/>') + ' share</span></div></div></div>'},
      {cls:'sk-xx', h:'Someone did. It is this.',
       claim:'Doubletake transcribes, checks the claim, and remembers. The quote-reposts want a link.',
       src:'5', tr:'—', cost:'$0.005',
       html:'<div class="sk"><div class="sk-bar"><span class="sk-dot" style="font-family:var(--serif)">x</span>Posts<span class="grow"></span>' + IC('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>') + '</div><div class="sk-body"><div class="sk-name"><span class="sk-dot" style="font-family:var(--serif)">x</span><span class="grow"><div class="sk-line w35"></div></span></div><div class="sk-line w90"></div><div class="sk-line w75"></div><div class="sk-line w90"></div><div class="sk-line w55"></div><div class="sk-media" style="min-height:34px;padding:0"><span class="sk-ph"><i></i><i></i><i></i></span></div></div><div class="sk-foot">' + IC('<path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>') + ' 214 ' + IC('<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>') + ' 1.2k ' + IC('<path d="M12 21C7 16.5 3 13.3 3 9.5 3 7 5 5 7.5 5c1.7 0 3.3.9 4.5 2.4C13.2 5.9 14.8 5 16.5 5 19 5 21 7 21 9.5c0 3.8-4 7-9 11.5z"/>') + ' 4.5k<span class="grow"></span>' + IC('<path d="M4 22V4"/><path d="M4 12h13a3 3 0 0 1 3 3v7"/>') + '</div></div></div>'}
    ];
    var swap  = document.getElementById('answerSwap'),
        aH = document.getElementById('ansH'), aC = document.getElementById('ansClaim'),
        aS = document.getElementById('ansSrc'), aT = document.getElementById('ansTr'),
        aM = document.getElementById('ansCost'),
        dotsBox = document.getElementById('stageDots'),
        stageEl = document.getElementById('tilt');
    var i = 0, timer = null, hovering = false, busy = false;
    var dots = feed.map(function(_, n){
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'stage-dot' + (n ? '' : ' on');
      d.setAttribute('aria-label', 'Show saved post ' + (n + 1) + ' of ' + feed.length);
      d.addEventListener('click', function(){ goTo(n); });
      dotsBox.appendChild(d);
      return d;
    });
    function apply(f){
      card.className = 'share-card ' + f.cls;
      card.innerHTML = f.html;
      aH.textContent = f.h; aC.textContent = f.claim;
      aS.textContent = f.src; aT.textContent = f.tr; aM.textContent = f.cost;
      dots.forEach(function(d, k){ d.classList.toggle('on', k === i); });
    }
    function goTo(n){
      n = (n + feed.length) % feed.length;
      if (busy || n === i) return;
      busy = true;
      i = n;
      var f = feed[i];
      card.classList.add('leaving'); swap.classList.add('leaving');
      setTimeout(function(){
        apply(f);
        card.classList.remove('leaving'); swap.classList.remove('leaving');
        card.classList.add('entering'); swap.classList.add('entering');
        void card.offsetWidth; // reflow so the enter transition plays
        card.classList.remove('entering'); swap.classList.remove('entering');
        setTimeout(function(){ busy = false; }, 320);
      }, 300);
    }
    function play(){ apply(feed[i]); if (!timer) timer = setInterval(function(){ if (!hovering) goTo(i + 1); }, 2100); }
    /* drag / swipe to flip through the feed */
    var downX = null;
    stageEl.addEventListener('pointerdown', function(e){ downX = e.clientX; });
    stageEl.addEventListener('pointerup', function(e){
      if (downX === null) return;
      var dx = e.clientX - downX;
      downX = null;
      if (Math.abs(dx) > 36) goTo(i + (dx < 0 ? 1 : -1));
    });
    stageEl.addEventListener('pointercancel', function(){ downX = null; });
    stageEl.addEventListener('pointerenter', function(){ hovering = true; });
    stageEl.addEventListener('pointerleave', function(){ hovering = false; });
    stageEl.style.touchAction = 'pan-y';
    play();
  })();

  /* FAQ: animated open/close (native details still works without JS) */
  (function(){
    if (reduced) return;
    document.querySelectorAll('.faq details').forEach(function(d){
      var p = d.querySelector('p');
      if (!p) return;
      var fold = document.createElement('div');
      fold.className = 'fold';
      var inner = document.createElement('div');
      p.parentNode.insertBefore(fold, p);
      fold.appendChild(inner);
      inner.appendChild(p);
      d.querySelector('summary').addEventListener('click', function(e){
        e.preventDefault();
        if (!d.open){
          d.open = true;
          requestAnimationFrame(function(){ requestAnimationFrame(function(){ d.classList.add('open'); }); });
        } else {
          d.classList.remove('open');
          var done = function(){ d.removeEventListener('transitionend', done); d.open = false; };
          fold.addEventListener('transitionend', done);
          setTimeout(function(){ if (d.classList.contains('open') === false && d.open) d.open = false; }, 450);
        }
      });
    });
  })();

  /* agent chat vignette: self-typing conversation, clickable to advance */
  (function(){
    var chat = document.getElementById('chat');
    if (!chat) return;
    var scenes = [
      {you:'What was that tool from the reel I saved last week?',
       tool:'search_library("tool from reel") → 1 hit',
       agent:'It was Brushline, a free color-grading tool. Your saved answer notes it\'s web-only and the $9 tier unlocks 4K export. Want the link?'},
      {you:'Did I ever check that cold plunge claim?',
       tool:'search_library("cold plunge study") → 1 hit',
       agent:'Yes. Verdict: overstated. The answer cites two reviews finding modest effects at best. Receipts are in the saved run.'},
      {you:'Queue that salmon recipe from yesterday for tonight.',
       tool:'queue_save("hot honey salmon · tiktok") → queued',
       agent:'Queued. It\'ll be transcribed and checked before dinner, and your library will have the answer waiting.'},
      {you:'Save this ramen place for my Tokyo trip.',
       tool:'save("ramen kurosawa · maps") → place saved',
       agent:'Saved to Places, tagged Tokyo. Want it on the trip list next to your hotel?'},
      {you:'Research this password manager. If it\'s safe, get me the download.',
       tool:'web_search × 4 · verdict: safe, open source',
       agent:'Checked: open source, audited, no telemetry. Download page saved to your tools list.'},
      {you:'Find a B&B near the conference and see if it\'s any good.',
       tool:'save("harbor view b&b") + verdict: solid',
       agent:'Solid reviews, free cancellation. Saved with the booking link — say the word and I\'ll queue the details.'}
    ];
    var yEl = document.getElementById('mYou'), tEl = document.getElementById('mTool'),
        aEl = document.getElementById('mAgent'),
        yTxt = yEl.querySelector('.txt'), aTxt = aEl.querySelector('.txt'), tTxt = tEl;
    var si = 0, playing = false, timers = [];
    function later(fn, ms){ timers.push(setTimeout(fn, ms)); }
    function type(el, text, done, ms){
      var n = 0;
      (function tick(){
        n++;
        el.textContent = text.slice(0, n);
        if (n < text.length) later(tick, ms);
        else { el.textContent = text; if (done) done(); }
      })();
    }
    function clearScene(){
      yEl.classList.remove('show'); tEl.classList.remove('show'); aEl.classList.remove('show');
    }
    function play(){
      if (playing) return;
      playing = true;
      timers.forEach(clearTimeout); timers = [];
      var s = scenes[si];
      clearScene();
      yTxt.textContent = ''; tTxt.textContent = ''; aTxt.textContent = '';
      later(function(){
        yEl.classList.add('show');
        type(yTxt, s.you, function(){
          later(function(){
            tEl.classList.add('show');
            type(tTxt, s.tool, function(){
              later(function(){
                aEl.classList.add('show');
                aTxt.insertAdjacentHTML('beforeend', '<span class="chat-caret" aria-hidden="true"></span>');
                type(aTxt, s.agent, function(){
                  var c = aTxt.querySelector('.chat-caret'); if (c) c.remove();
                  playing = false;
                  later(function(){          // settle, then the next conversation
                    si = (si + 1) % scenes.length;
                    clearScene();
                    later(play, 450);
                  }, 4200);
                }, 16);
              }, 550);
            }, 24);
          }, 500);
        }, 26);
      }, 350);
    }
    if (reduced || !('IntersectionObserver' in window)) return; // static scene 1 stays visible
    new IntersectionObserver(function(entries, io){
      entries.forEach(function(en){
        if (en.isIntersecting){ io.disconnect(); play(); }
      });
    }, {threshold:.3}).observe(chat);
    chat.style.cursor = 'pointer';
    chat.addEventListener('click', function(){ if (!playing){ si = (si + 1) % scenes.length; play(); } });
  })();
})();
</script>
</body>
</html>
`;
