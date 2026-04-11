"use client";
import { useState, useEffect, useRef, useCallback } from "react";

export default function Home() {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const wsRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [myAnswer, setMyAnswer] = useState(null);
  const [players, setPlayers] = useState([]);
  const [topics] = useState(["cloud","devops","security","distributed"]);
  const [questionNum, setQuestionNum] = useState(0);
  const [totalQ, setTotalQ] = useState(5);
  const questionsRef = useRef([]);
  const [gamePhase, setGamePhase] = useState("lobby");
  const [readyPlayers, setReadyPlayers] = useState([]);
  const [answeredPlayers, setAnsweredPlayers] = useState([]);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef(null);
  const [showCorrect, setShowCorrect] = useState(false);
  const sentRevealRef = useRef(false);
  const [topicVotes, setTopicVotes] = useState({});
  const [myVote, setMyVote] = useState(null);
  const [nextSent, setNextSent] = useState(false);
  const usernameRef = useRef("");
  useEffect(()=>{usernameRef.current=username;},[username]);

  useEffect(()=>{
    if(timer>0&&!answered&&gamePhase==="playing") timerRef.current=setTimeout(()=>setTimer(t=>t-1),1000);
    if(timer===0&&currentQuestion&&!answered&&gamePhase==="playing") handleTimeout();
    return()=>clearTimeout(timerRef.current);
  },[timer,answered,gamePhase,currentQuestion]);

  const handleTimeout=()=>{
    var ws=wsRef.current;
    if(!ws||answered)return;
    ws.send(JSON.stringify({type:"answer",answer:"TIMEOUT",points:0,correct:false}));
    ws.send(JSON.stringify({type:"player_answered"}));
    setAnswered(true);setMyAnswer("TIMEOUT");
  };

  const addMsg=useCallback((t)=>{
    setMessages(p=>[...p.slice(-80),{text:t,time:new Date().toLocaleTimeString()}]);
  },[]);

  /* FIX: async + register user in PostgreSQL before WS connect */
  const joinRoom=async()=>{
    var u=username.trim();var r=roomId.trim();
    if(!u||!r)return alert("Enter username and room ID!");
    try{
      await fetch("http://"+window.location.hostname+":80/api/users/register",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({username:u,password:"guest_"+u+"_"+Date.now()})
      });
    }catch(e){/* 400 "Exists" is fine — server WS handler also upserts */}
    var host=window.location.hostname;
    var s=new WebSocket("ws://"+host+":80/ws/"+r+"/"+u);
    s.onopen=()=>{wsRef.current=s;setJoined(true);setGamePhase("lobby");addMsg("Connected!");};
    s.onmessage=(e)=>{
      try{var d=JSON.parse(e.data);handleMessage(d);}catch(err){console.error(err);}
    };
    s.onclose=()=>{addMsg("Disconnected");setJoined(false);wsRef.current=null;};
    s.onerror=()=>addMsg("Connection error");
  };

  const handleMessage=(d)=>{
    var t=d.type;
    if(t==="player_joined"){
      setPlayers(p=>{var s=new Set(p);s.add(d.username);return[...s];});
      if(d.source!=="history")addMsg(d.username+" joined");
    }else if(t==="player_left"){
      setPlayers(p=>p.filter(x=>x!==d.username));
      setReadyPlayers(p=>p.filter(x=>x!==d.username));
      addMsg(d.username+" left");
    }else if(t==="player_ready"){
      setReadyPlayers(p=>{var s=new Set(p);s.add(d.username);return[...s];});
      if(d.source!=="history")addMsg(d.username+" ready!");
    }else if(t==="vote_topic"){
      setTopicVotes(prev=>({...prev,[d.username]:d.topic}));
      if(d.source!=="history")addMsg(d.username+" voted "+d.topic);
    }else if(t==="state_snapshot"){
      /* --- NEW: sync phase + question for late joiners --- */
      setGamePhase(d.phase||"lobby");
      setTotalQ(d.total_questions||5);
      if(d.current_question){
        setCurrentQuestion(d.current_question);
        setQuestionNum(d.question_number||1);
        setTotalQ(d.total||d.total_questions||5);
        setTimer(d.time_limit||15);
        if(d.phase==="reviewing"){setShowCorrect(true);setTimer(0);}
      }
      if(d.leaderboard)setLeaderboard(d.leaderboard);
    }else if(t==="game_start"){
      addMsg("Game starting: "+d.topic);
      setGamePhase("playing");
      setTotalQ(d.total_questions||5);
      setQuestionNum(0);setLeaderboard([]);setShowCorrect(false);
      if(d.questions&&d.questions.length>0) questionsRef.current=d.questions;
    }else if(t==="new_question"){
      var qn=d.question_number||1;
      setQuestionNum(qn);setTotalQ(d.total||totalQ);
      setCurrentQuestion(d);setAnswered(false);setMyAnswer(null);
      setAnsweredPlayers([]);setShowCorrect(false);
      setTimer(d.time_limit||15);setGamePhase("playing");
      sentRevealRef.current=false;setNextSent(false);
      addMsg("Question "+qn);
    }else if(t==="player_answered"){
      setAnsweredPlayers(p=>{var s=new Set(p);s.add(d.username);return[...s];});
      if(d.username!==usernameRef.current)addMsg(d.username+" locked in");
    }else if(t==="answer"){
      if(d.leaderboard)setLeaderboard(d.leaderboard);
    }else if(t==="reveal_answer"){
      setShowCorrect(true);setGamePhase("reviewing");setTimer(0);
      if(d.leaderboard)setLeaderboard(d.leaderboard);
    }else if(t==="game_finished"){
      setGamePhase("finished");
      if(d.leaderboard)setLeaderboard(d.leaderboard);
      addMsg("Game over!");
    }else if(t==="back_to_lobby"){
      setGamePhase("lobby");setReadyPlayers([]);setAnsweredPlayers([]);
      setCurrentQuestion(null);questionsRef.current=[];setLeaderboard([]);
      setQuestionNum(0);setShowCorrect(false);setMyAnswer(null);
      setTopicVotes({});setMyVote(null);setNextSent(false);
      addMsg("Back to lobby");
    }else if(t==="chat"){
      addMsg(d.username+": "+d.text);
    }
  };

  /* --- FIX: compute voteCounts and allVoted properly --- */
  var voteCounts={};
  topics.forEach(function(t){voteCounts[t]=0;});
  Object.values(topicVotes).forEach(function(t){voteCounts[t]=(voteCounts[t]||0)+1;});
  var allVoted=players.length>0&&Object.keys(topicVotes).length>=players.length;

  const voteTopic=(topic)=>{
    var ws=wsRef.current;
    if(ws&&!myVote){
      ws.send(JSON.stringify({type:"vote_topic",topic:topic}));
      setMyVote(topic);
      setTopicVotes(prev=>({...prev,[username]:topic}));
    }
  };

  const getWinningTopic=()=>{
    var counts={};
    Object.values(topicVotes).forEach(t=>{counts[t]=(counts[t]||0)+1;});
    var winner="cloud",max=0;
    Object.entries(counts).forEach(([t,c])=>{if(c>max){max=c;winner=t;}});
    return winner;
  };

  const toggleReady=()=>{
    var ws=wsRef.current;
    if(ws){
      ws.send(JSON.stringify({type:"player_ready"}));
      setReadyPlayers(p=>{var s=new Set(p);s.add(username);return[...s];});
    }
  };

  const startGame=async()=>{
    var ws=wsRef.current;
    if(!ws)return;
    var topic=getWinningTopic();
    try{
      var r=await fetch("http://"+window.location.hostname+":80/api/generate-questions?topic="+topic+"&count=5");
      var data=await r.json();
      var qs=data.questions||[];
      questionsRef.current=qs;
      ws.send(JSON.stringify({type:"game_start",topic:topic,total_questions:qs.length,questions:qs}));
      /* After 1.5s delay, tell server to serve question 1.
         Server reads from Redis — no client payload needed. */
      setTimeout(()=>{
        if(qs.length>0){
          ws.send(JSON.stringify({type:"new_question"}));
        }
      },1500);
    }catch(e){addMsg("Error: "+e.message);}
  };

  const submitAnswer=(a)=>{
    var ws=wsRef.current;
    if(!ws||answered)return;
    var correct=a===(currentQuestion?currentQuestion.correct_answer:null);
    var pts=correct?50+Math.round((timer/15)*50):0;
    ws.send(JSON.stringify({type:"answer",answer:a,points:pts,correct:correct}));
    ws.send(JSON.stringify({type:"player_answered"}));
    setAnswered(true);setMyAnswer(a);
  };

  useEffect(()=>{
    if(answeredPlayers.length>=players.length&&players.length>0&&gamePhase==="playing"&&currentQuestion&&!showCorrect&&!sentRevealRef.current){
      sentRevealRef.current=true;
      setTimeout(()=>{
        var ws=wsRef.current;
        if(ws)ws.send(JSON.stringify({type:"reveal_answer"}));
      },600);
    }
  },[answeredPlayers,players,gamePhase,currentQuestion,showCorrect]);

  /* --- FIX: any player can send next question; server picks from Redis --- */
  const sendNextQuestion=()=>{
    var ws=wsRef.current;
    if(!ws||nextSent)return;
    setNextSent(true);
    ws.send(JSON.stringify({type:"new_question"}));
  };

  const backToLobby=()=>{
    var ws=wsRef.current;
    if(ws)ws.send(JSON.stringify({type:"back_to_lobby"}));
    setGamePhase("lobby");setReadyPlayers([]);setAnsweredPlayers([]);
    setCurrentQuestion(null);questionsRef.current=[];setLeaderboard([]);
    setQuestionNum(0);setShowCorrect(false);setMyAnswer(null);
    setTopicVotes({});setMyVote(null);setNextSent(false);
  };

  var st={
    container:{maxWidth:1200,margin:"0 auto",padding:20},
    title:{textAlign:"center",fontSize:48,marginBottom:10,background:"linear-gradient(90deg,#ff6b6b,#ffd93d,#6bcb77,#4d96ff)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"},
    subtitle:{textAlign:"center",color:"#888",marginBottom:30,fontSize:14},
    card:{background:"rgba(255,255,255,0.05)",borderRadius:16,padding:24,marginBottom:20,border:"1px solid rgba(255,255,255,0.1)"},
    input:{padding:"12px 16px",borderRadius:8,border:"1px solid rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.1)",color:"white",fontSize:16,width:200,marginBottom:12},
    btn:{padding:"12px 24px",borderRadius:8,border:"none",cursor:"pointer",fontSize:16,fontWeight:"bold",color:"white",background:"linear-gradient(135deg,#667eea,#764ba2)",width:"100%",marginBottom:8},
    btnG:{padding:"12px 24px",borderRadius:8,border:"none",cursor:"pointer",fontSize:16,fontWeight:"bold",color:"white",background:"linear-gradient(135deg,#11998e,#38ef7d)",width:"100%",marginBottom:8},
    btnD:{padding:"12px 24px",borderRadius:8,border:"none",fontSize:16,fontWeight:"bold",color:"#666",background:"rgba(255,255,255,0.1)",width:"100%",marginBottom:8,cursor:"not-allowed"},
    btnO:{padding:"12px 24px",borderRadius:8,border:"none",cursor:"pointer",fontSize:16,fontWeight:"bold",color:"white",background:"linear-gradient(135deg,#f093fb,#f5576c)",width:"100%",marginBottom:8},
  };

  /* ========================= LOGIN SCREEN ========================= */
  if(!joined) return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f0c29,#302b63,#24243e)",color:"white",fontFamily:"system-ui"}}>
      <div style={st.container}>
        <h1 style={st.title}>{"\u26A1"} Quiz Arena</h1>
        <p style={st.subtitle}>AWS Free Tier | Nginx + FastAPI + RDS + ElastiCache + Lambda + Prometheus + Grafana</p>
        <div style={{...st.card,maxWidth:400,margin:"0 auto",textAlign:"center"}}>
          <h2 style={{marginBottom:16}}>Join a Room</h2>
          <input style={st.input} placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} /><br/>
          <input style={st.input} placeholder="Room ID" value={roomId} onChange={e=>setRoomId(e.target.value)} /><br/>
          <button style={st.btn} onClick={joinRoom}>Join Room</button>
        </div>
        <p style={{textAlign:"center",marginTop:20,color:"#666",fontSize:12}}>Real-Time Multiplayer Quiz Platform</p>
      </div>
    </div>
  );

  /* ========================= LOBBY ========================= */
  if(gamePhase==="lobby") return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f0c29,#302b63,#24243e)",color:"white",fontFamily:"system-ui"}}>
      <div style={st.container}>
        <h1 style={st.title}>{"\u26A1"} Quiz Arena</h1>
        <p style={st.subtitle}>Room: {roomId}</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
          {/* LEFT COL: Players + Ready */}
          <div>
            <div style={st.card}>
              <h3 style={{marginBottom:12}}>{"\uD83D\uDC65"} Players ({players.length})</h3>
              {players.map(function(p){
                var isReady=readyPlayers.includes(p);
                return <div key={p} style={{padding:"8px 12px",marginBottom:4,borderRadius:8,background:isReady?"rgba(107,203,119,0.15)":"rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between"}}>
                  <span>{p}{p===username?" (you)":""}</span>
                  <span>{isReady?"\u2705":"\u23F3"}</span>
                </div>;
              })}
              <p style={{marginTop:12,color:"#aaa",fontSize:14}}>{readyPlayers.length}/{players.length} ready</p>
            </div>
            <div style={st.card}>
              {readyPlayers.includes(username)
                ?<button style={st.btnD} disabled>Ready {"\u2705"}</button>
                :<button style={st.btnG} onClick={toggleReady}>Ready Up</button>}
            </div>
          </div>
          {/* RIGHT COL: Vote + Start */}
          <div>
            <div style={st.card}>
              <h3 style={{marginBottom:8}}>{"\uD83D\uDDF3"} Topic Vote</h3>
              <p style={{color:"#aaa",fontSize:13,marginBottom:12}}>Everyone votes, majority wins</p>
              {topics.map(function(t){
                var count=voteCounts[t]||0;var isMy=myVote===t;
                return <button key={t} style={{...st.btn,background:isMy?"linear-gradient(135deg,#f093fb,#f5576c)":"linear-gradient(135deg,#667eea,#764ba2)",opacity:myVote&&!isMy?0.5:1,display:"flex",justifyContent:"space-between",alignItems:"center"}} onClick={()=>voteTopic(t)} disabled={!!myVote}>
                  <span>{t.toUpperCase()}</span><span>{count>0?count+" vote"+(count>1?"s":""):""}</span>
                </button>;
              })}
              {myVote&&<p style={{marginTop:8,color:"#aaa",fontSize:13}}>Voted: {myVote}</p>}
              {allVoted&&<div style={{marginTop:12,padding:12,borderRadius:8,background:"rgba(107,203,119,0.15)",textAlign:"center"}}>
                <span style={{fontSize:20}}>{"\uD83C\uDFC6"} {getWinningTopic().toUpperCase()}</span>
              </div>}
              <p style={{marginTop:8,color:"#aaa",fontSize:13}}>{Object.keys(topicVotes).length}/{players.length} voted</p>
            </div>
            <div style={st.card}>
              {readyPlayers.length>=players.length&&players.length>=1
                ?<button style={st.btnG} onClick={startGame}>{"\uD83D\uDE80"} Start Game</button>
                :<button style={st.btnD} disabled>Waiting for players...</button>}
            </div>
          </div>
        </div>
        {/* Chat log */}
        <div style={{...st.card,maxHeight:200,overflowY:"auto"}}>
          <h4 style={{marginBottom:8}}>{"\uD83D\uDCAC"} Log</h4>
          {messages.map(function(m,i){return <div key={i} style={{fontSize:13,color:"#aaa",padding:"2px 0"}}><span style={{color:"#666"}}>[{m.time}]</span> {m.text}</div>;})}
        </div>
      </div>
    </div>
  );

  /* ========================= PLAYING / REVIEWING ========================= */
  if(gamePhase==="playing"||gamePhase==="reviewing") return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f0c29,#302b63,#24243e)",color:"white",fontFamily:"system-ui"}}>
      <div style={st.container}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h2 style={{margin:0}}>Room: {roomId} | Q {questionNum}/{totalQ} | {showCorrect?"\uD83D\uDCCA Review":"\u23F1 Playing"}</h2>
          {timer>0&&!showCorrect&&<div style={{fontSize:32,fontWeight:"bold",color:timer<=5?"#ff6b6b":"#ffd93d"}}>{timer}s</div>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:20}}>
          {/* Question area */}
          <div>
            <div style={st.card}>
              {currentQuestion?<>
                <h3 style={{marginBottom:20,fontSize:22}}>{currentQuestion.question_text}</h3>
                {["A","B","C","D"].map(function(o){
                  var optKey="option_"+o.toLowerCase();
                  var optText=currentQuestion[optKey]||"";
                  var isC=o===currentQuestion.correct_answer;
                  var isM=o===myAnswer;
                  var bg="rgba(255,255,255,0.05)";var bd="1px solid rgba(255,255,255,0.2)";var op=1;var lb="";
                  if(showCorrect){
                    if(isC){bg="rgba(107,203,119,0.25)";bd="2px solid #6bcb77";lb=" \u2713";}
                    else if(isM&&!isC){bg="rgba(255,107,107,0.25)";bd="2px solid #ff6b6b";lb=" \u2717";}
                    else op=0.4;
                  }else if(answered&&isM){bg="rgba(102,126,234,0.3)";bd="2px solid #667eea";lb=" \uD83D\uDD12";}
                  return <button key={o} onClick={()=>submitAnswer(o)} disabled={answered||showCorrect}
                    style={{width:"100%",padding:"14px 18px",marginBottom:8,borderRadius:10,border:bd,background:bg,color:"white",fontSize:16,textAlign:"left",cursor:answered?"default":"pointer",opacity:op,display:"flex",justifyContent:"space-between"}}>
                    <span><b>{o}.</b> {optText}</span><span>{lb}</span>
                  </button>;
                })}
                {answered&&!showCorrect&&<p style={{textAlign:"center",color:"#aaa",marginTop:12}}>{"\u23F3"} Waiting for others...</p>}
                {/* --- FIX: ANY player can click Next Question --- */}
                {showCorrect&&questionNum<totalQ&&<button style={st.btnO} onClick={sendNextQuestion} disabled={nextSent}>{nextSent?"Waiting...":"Next Question \u27A1"}</button>}
                {showCorrect&&questionNum>=totalQ&&<button style={st.btnO} onClick={()=>{var ws=wsRef.current;if(ws)ws.send(JSON.stringify({type:"game_finished"}));}}>Finish Game {"\uD83C\uDFC1"}</button>}
              </>:<p style={{textAlign:"center",color:"#aaa"}}>Waiting for question...</p>}
            </div>
          </div>
          {/* Sidebar */}
          <div>
            <div style={st.card}>
              <h4 style={{marginBottom:8}}>{"\uD83D\uDC65"} Answers</h4>
              {players.map(function(p){
                var done=answeredPlayers.includes(p);
                return <div key={p} style={{padding:"6px 10px",marginBottom:4,borderRadius:6,background:done?"rgba(107,203,119,0.1)":"rgba(255,255,255,0.03)",display:"flex",justifyContent:"space-between",fontSize:14}}>
                  <span>{p}</span><span>{done?"\u2705":"\u23F3"}</span>
                </div>;
              })}
            </div>
            {leaderboard.length>0&&<div style={st.card}>
              <h4 style={{marginBottom:8}}>{"\uD83C\uDFC6"} Scores</h4>
              {leaderboard.map(function(e,i){
                return <div key={e.username} style={{padding:"6px 10px",marginBottom:4,borderRadius:6,background:i===0?"rgba(255,217,61,0.15)":"rgba(255,255,255,0.03)",display:"flex",justifyContent:"space-between",fontSize:14}}>
                  <span>{i===0?"\uD83E\uDD47":i===1?"\uD83E\uDD48":i===2?"\uD83E\uDD49":"  "+(i+1)+"."} {e.username}</span><span style={{fontWeight:"bold"}}>{e.score}</span>
                </div>;
              })}
            </div>}
            <div style={{...st.card,maxHeight:150,overflowY:"auto"}}>
              <h4 style={{marginBottom:8}}>{"\uD83D\uDCAC"} Log</h4>
              {messages.slice(-20).map(function(m,i){return <div key={i} style={{fontSize:12,color:"#aaa",padding:"1px 0"}}><span style={{color:"#666"}}>[{m.time}]</span> {m.text}</div>;})}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  /* ========================= FINISHED ========================= */
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f0c29,#302b63,#24243e)",color:"white",fontFamily:"system-ui"}}>
      <div style={st.container}>
        <h1 style={st.title}>{"\uD83C\uDFC6"} Game Over!</h1>
        <div style={{...st.card,maxWidth:500,margin:"20px auto"}}>
          <h3 style={{marginBottom:16,textAlign:"center"}}>Final Leaderboard</h3>
          {leaderboard.map(function(e,i){
            return <div key={e.username} style={{padding:"12px 16px",marginBottom:8,borderRadius:10,background:i===0?"rgba(255,217,61,0.2)":i===1?"rgba(192,192,192,0.15)":i===2?"rgba(205,127,50,0.15)":"rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",fontSize:18}}>
              <span>{i===0?"\uD83E\uDD47":i===1?"\uD83E\uDD48":i===2?"\uD83E\uDD49":"  "+(i+1)+"."} {e.username}</span><span style={{fontWeight:"bold"}}>{e.score}</span>
            </div>;
          })}
          {leaderboard.length===0&&<p style={{textAlign:"center",color:"#aaa"}}>Scores appear after Q1</p>}
        </div>
        <div style={{maxWidth:500,margin:"0 auto"}}>
          <button style={st.btn} onClick={backToLobby}>{"\uD83D\uDD04"} Back to Lobby</button>
        </div>
        <div style={{...st.card,maxWidth:500,margin:"20px auto",maxHeight:200,overflowY:"auto"}}>
          <h4 style={{marginBottom:8}}>{"\uD83D\uDCAC"} Log</h4>
          {messages.map(function(m,i){return <div key={i} style={{fontSize:12,color:"#aaa",padding:"1px 0"}}><span style={{color:"#666"}}>[{m.time}]</span> {m.text}</div>;})}
        </div>
      </div>
    </div>
  );
}
