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
    if(timer>0&&!answered&&gamePhase==="playing")
      timerRef.current=setTimeout(()=>setTimer(t=>t-1),1000);
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

  const joinRoom=()=>{
    var u=username.trim();var r=roomId.trim();
    if(!u||!r)return alert("Enter username and room ID!");
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
      setTimeout(()=>{
        if(qs.length>0){
          ws.send(JSON.stringify({type:"new_question",...qs[0],question_number:1,total:qs.length,time_limit:15}));
        }
      },1500);
    }catch(e){addMsg("Error: "+e.message);}
  };

  const submitAnswer=(a)=>{
    var ws=wsRef.current;
    if(!ws||answered)return;
    var correct=a===currentQuestion?.correct_answer;
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
        if(ws)ws.send(JSON.stringify({type:"reveal_answer",leaderboard:leaderboard}));
      },600);
    }
  },[answeredPlayers,players,gamePhase,currentQuestion,showCorrect,leaderboard]);

  const sendNextQuestion=()=>{
    var ws=wsRef.current;
    var qs=questionsRef.current;
    if(!ws||qs.length===0||nextSent)return;
    setNextSent(true);
    var ni=questionNum;
    if(ni>=qs.length){
      ws.send(JSON.stringify({type:"game_finished",leaderboard:leaderboard}));return;
    }
    var q=qs[ni];
    ws.send(JSON.stringify({type:"new_question",...q,question_number:ni+1,total:qs.length,time_limit:15}));
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
    card:{background:"rgba(255,255,255,0.05)",borderRadius:16,padding:24,marginBottom:20,border:"1px solid rgba(255,255,255,0.1)"},
    input:{padding:"12px 16px",borderRadius:8,border:"1px solid rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.1)",color:"white",fontSize:16,width:200,marginBottom:12},
    btn:{padding:"12px 24px",borderRadius:8,border:"none",cursor:"pointer",fontSize:16,fontWeight:"bold",color:"white",background:"linear-gradient(135deg,#667eea,#764ba2)",width:"100%",marginBottom:8},
    btnG:{padding:"12px 24px",borderRadius:8,border:"none",cursor:"pointer",fontSize:16,fontWeight:"bold",color:"white",background:"linear-gradient(135deg,#11998e,#38ef7d)",width:"100%",marginBottom:8},
    btnD:{padding:"12px 24px",borderRadius:8,border:"none",fontSize:16,fontWeight:"bold",color:"#666",background:"rgba(255,255,255,0.1)",width:"100%",marginBottom:8,cursor:"not-allowed"},
    btnO:{padding:"12px 24px",borderRadius:8,border:"none",cursor:"pointer",fontSize:16,fontWeight:"bold",color:"white",background:"linear-gradient(135deg,#f093fb,#f5576c)",width:"100%",marginBottom:8},
  };

  if(!joined) return (
    <div style={st.container}>
      <h1 style={st.title}>Quiz Arena</h1>
      <p style={{textAlign:"center",color:"#aaa"}}>Real-Time Multiplayer Quiz Platform</p>
      <p style={{textAlign:"center",color:"#666",fontSize:13}}>AWS Free Tier | Nginx + FastAPI + RDS + ElastiCache + Lambda + Prometheus + Grafana</p>
      <div style={{...st.card,maxWidth:400,margin:"0 auto",textAlign:"center"}}>
        <h2 style={{marginTop:0}}>Join a Room</h2>
        <input style={st.input} placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} /><br/>
        <input style={st.input} placeholder="Room ID" value={roomId} onChange={e=>setRoomId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&joinRoom()} /><br/>
        <button style={st.btn} onClick={joinRoom}>Join Room</button>
      </div>
    </div>
  );

  if(gamePhase==="lobby"){
    var allReady=readyPlayers.length>=players.length&&players.length>=1;
    var voteCounts={};
    Object.values(topicVotes).forEach(function(t){voteCounts[t]=(voteCounts[t]||0)+1;});
    var allVoted=Object.keys(topicVotes).length>=players.length&&players.length>=1;
    return(
      <div style={st.container}>
        <h1 style={st.title}>Quiz Arena</h1>
        <p style={{textAlign:"center",color:"#aaa"}}>Room: {roomId}</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20,maxWidth:1000,margin:"0 auto"}}>
          <div style={st.card}>
            <h3 style={{marginTop:0}}>Players ({players.length})</h3>
            {players.map(function(p){var rdy=readyPlayers.includes(p);return(
              <div key={p} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderRadius:8,marginBottom:6,background:"rgba(255,255,255,0.05)"}}>
                <span>{p===username?"\u2b50 "+p+" (you)":p}</span>
                <span style={{display:"inline-block",padding:"2px 8px",borderRadius:12,fontSize:11,background:rdy?"rgba(107,203,119,0.3)":"rgba(255,255,255,0.1)",color:rdy?"#6bcb77":"#666"}}>{rdy?"READY":"waiting"}</span>
              </div>
            )})}
            <div style={{marginTop:16}}>
              {!readyPlayers.includes(username)?
                <button style={st.btnG} onClick={toggleReady}>I am Ready!</button>:
                <div style={{textAlign:"center",color:"#6bcb77",padding:12,fontWeight:"bold"}}>\u2705 Ready!</div>}
            </div>
          </div>
          <div style={st.card}>
            <h3 style={{marginTop:0}}>Vote Topic</h3>
            <p style={{color:"#aaa",fontSize:13,margin:"0 0 12px"}}>Everyone votes, majority wins</p>
            {topics.map(function(t){
              var count=voteCounts[t]||0;var isMy=myVote===t;
              return(
                <button key={t} onClick={function(){voteTopic(t);}} disabled={!!myVote}
                  style={{padding:"10px 16px",borderRadius:8,border:isMy?"2px solid #ffd93d":"1px solid rgba(255,255,255,0.2)",background:isMy?"rgba(255,217,61,0.2)":"rgba(255,255,255,0.05)",color:isMy?"#ffd93d":"#aaa",cursor:myVote?"default":"pointer",fontSize:14,marginBottom:6,width:"100%",textAlign:"left"}}>
                  <span style={{fontWeight:isMy?"bold":"normal"}}>{t.charAt(0).toUpperCase()+t.slice(1)}</span>
                  {count>0&&<span style={{float:"right",background:"rgba(255,217,61,0.3)",padding:"2px 8px",borderRadius:8,fontSize:12}}>{count}</span>}
                </button>
              );
            })}
            {myVote&&<p style={{color:"#6bcb77",fontSize:13,textAlign:"center",marginTop:8}}>Voted: {myVote}</p>}
            {allVoted&&<p style={{color:"#ffd93d",fontSize:14,textAlign:"center",fontWeight:"bold",marginTop:8}}>\ud83c\udfc6 {getWinningTopic().toUpperCase()}</p>}
          </div>
          <div style={st.card}>
            <h3 style={{marginTop:0}}>Start</h3>
            <div style={{padding:12,borderRadius:8,marginBottom:12,textAlign:"center",background:"rgba(255,255,255,0.03)"}}>
              <p style={{margin:0,color:allReady?"#6bcb77":"#888"}}>{readyPlayers.length}/{players.length} ready</p>
              <p style={{margin:"4px 0 0",color:allVoted?"#6bcb77":"#888"}}>{Object.keys(topicVotes).length}/{players.length} voted</p>
            </div>
            {allReady&&allVoted?
              <button style={st.btnO} onClick={startGame}>\ud83d\ude80 Start Game</button>:
              <button style={st.btnD} disabled>Waiting...</button>}
            <div style={{marginTop:16,maxHeight:180,overflowY:"auto",background:"rgba(0,0,0,0.3)",borderRadius:8,padding:8,fontSize:12}}>
              {messages.slice(-30).map(function(m,i){return <div key={i} style={{color:"#999"}}>[{m.time}] {m.text}</div>;})}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if(gamePhase==="finished") return(
    <div style={st.container}>
      <h1 style={st.title}>Quiz Arena</h1>
      <div style={{...st.card,maxWidth:600,margin:"0 auto",textAlign:"center"}}>
        <h2 style={{fontSize:36,marginTop:0}}>\ud83c\udfc6 Game Over!</h2>
        {leaderboard.map(function(e,i){return(
          <div key={e.username} style={{display:"flex",justifyContent:"space-between",padding:"16px 20px",borderRadius:12,marginBottom:8,background:i===0?"rgba(255,217,61,0.2)":i===1?"rgba(192,192,192,0.15)":"rgba(255,255,255,0.05)",fontSize:i===0?22:16}}>
            <span>{i===0?"\ud83e\udd47":i===1?"\ud83e\udd48":i===2?"\ud83e\udd49":(i+1)+"."} {e.username}{e.username===username?" (you)":""}</span>
            <span style={{fontWeight:"bold"}}>{e.score} pts</span>
          </div>
        )})}
        <button style={{...st.btn,marginTop:24}} onClick={backToLobby}>Back to Lobby</button>
      </div>
    </div>
  );

  var pct=currentQuestion?(timer/15)*100:0;
  return(
    <div style={st.container}>
      <h1 style={st.title}>Quiz Arena</h1>
      <p style={{textAlign:"center",color:"#aaa",fontSize:14}}>Room: {roomId} &nbsp;|&nbsp; Q {questionNum}/{totalQ} &nbsp;|&nbsp; {showCorrect?"\ud83d\udcca Review":"\u23f1 Playing"}</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20}}>
        <div style={st.card}>
          {!showCorrect&&currentQuestion&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:13,color:"#aaa"}}>Time</span>
                <span style={{fontSize:22,fontWeight:"bold",color:timer>10?"#6bcb77":timer>5?"#ffd93d":"#ff6b6b"}}>{timer}s</span>
              </div>
              <div style={{height:6,borderRadius:3,marginBottom:16,background:"rgba(255,255,255,0.1)",overflow:"hidden"}}>
                <div style={{height:"100%",width:pct+"%",borderRadius:3,background:pct>60?"#6bcb77":pct>30?"#ffd93d":"#ff6b6b",transition:"width 1s linear"}}/>
              </div>
            </div>
          )}
          <h3 style={{marginTop:0}}>{showCorrect?"Results":"Question "+questionNum}</h3>
          {currentQuestion?(
            <div>
              <p style={{fontSize:18,lineHeight:1.4}}>{currentQuestion.question_text}</p>
              {["A","B","C","D"].map(function(o){
                var isC=o===currentQuestion.correct_answer;
                var isM=o===myAnswer;
                var bg="rgba(255,255,255,0.05)";var bd="1px solid rgba(255,255,255,0.2)";var op=1;var lb="";
                if(showCorrect){
                  if(isC){bg="rgba(107,203,119,0.25)";bd="2px solid #6bcb77";lb=" \u2713";}
                  else if(isM&&!isC){bg="rgba(255,107,107,0.25)";bd="2px solid #ff6b6b";lb=" \u2717";}
                  else op=0.4;
                }else if(answered&&isM){bg="rgba(102,126,234,0.3)";bd="2px solid #667eea";lb=" \ud83d\udd12";}
                return(
                  <button key={o} onClick={function(){submitAnswer(o);}} disabled={answered||showCorrect}
                    style={{width:"100%",padding:12,marginBottom:8,borderRadius:8,border:bd,background:bg,color:"white",cursor:answered||showCorrect?"default":"pointer",textAlign:"left",fontSize:15,opacity:op,transition:"all 0.3s"}}>
                    <strong>{o}.</strong> {currentQuestion["option_"+o.toLowerCase()]}{lb}
                  </button>
                );
              })}
              {answered&&!showCorrect&&(
                <div style={{textAlign:"center",padding:12,marginTop:8,background:"rgba(102,126,234,0.1)",borderRadius:8,color:"#aaa",fontSize:14}}>
                  Locked! Waiting ({answeredPlayers.length}/{players.length})
                </div>
              )}
              {showCorrect&&myAnswer&&(
                <div style={{textAlign:"center",padding:12,marginTop:8,borderRadius:8,background:myAnswer===currentQuestion.correct_answer?"rgba(107,203,119,0.15)":"rgba(255,107,107,0.15)",color:myAnswer===currentQuestion.correct_answer?"#6bcb77":"#ff6b6b",fontSize:16,fontWeight:"bold"}}>
                  {myAnswer===currentQuestion.correct_answer?"\u2705 Correct!":myAnswer==="TIMEOUT"?"\u23f0 Timed out!":"\u274c Wrong! Answer: "+currentQuestion.correct_answer}
                </div>
              )}
              {showCorrect&&(
                <button style={{...st.btnG,marginTop:12}} onClick={sendNextQuestion} disabled={nextSent}>
                  {nextSent?"Sent...":questionNum>=totalQ?"\ud83c\udfc6 Final Results":"Next Question \u27a1"}
                </button>
              )}
            </div>
          ):<p style={{color:"#aaa"}}>Waiting for question...</p>}
        </div>
        <div style={st.card}>
          <h3 style={{marginTop:0}}>Leaderboard</h3>
          {leaderboard.length>0?leaderboard.map(function(e,i){return(
            <div key={e.username} style={{display:"flex",justifyContent:"space-between",padding:10,borderRadius:8,marginBottom:4,background:i===0?"rgba(255,217,61,0.2)":i===1?"rgba(192,192,192,0.15)":"rgba(255,255,255,0.05)"}}>
              <span>{i===0?"\ud83e\udd47":i===1?"\ud83e\udd48":i===2?"\ud83e\udd49":(i+1)+"."} {e.username}{e.username===username?" (you)":""}</span>
              <span style={{fontWeight:"bold"}}>{e.score}</span>
            </div>
          )}):<p style={{color:"#666",fontSize:14}}>Scores appear after Q1</p>}
          <h4 style={{marginTop:24,color:"#aaa"}}>Players</h4>
          {players.map(function(p){var done=answeredPlayers.includes(p);return(
            <div key={p} style={{display:"flex",justifyContent:"space-between",padding:"6px 8px",color:p===username?"#ffd93d":"#aaa",fontSize:14}}>
              <span>{p===username?"You":p}</span>
              {gamePhase==="playing"&&currentQuestion&&!showCorrect&&<span style={{fontSize:12,color:done?"#6bcb77":"#666"}}>{done?"\ud83d\udd12":"\ud83e\udd14"}</span>}
            </div>
          )})}
        </div>
        <div style={st.card}>
          <h3 style={{marginTop:0}}>Event Log</h3>
          <div style={{maxHeight:400,overflowY:"auto",background:"rgba(0,0,0,0.3)",borderRadius:8,padding:12}}>
            {messages.map(function(m,i){return(
              <div key={i} style={{marginBottom:4,fontSize:13}}><span style={{color:"#555"}}>[{m.time}]</span> {m.text}</div>
            )})}
          </div>
          <input style={{...st.input,width:"100%",marginTop:12,boxSizing:"border-box"}} placeholder="Chat..."
            onKeyDown={function(e){var ws=wsRef.current;if(e.key==="Enter"&&e.target.value&&ws){ws.send(JSON.stringify({type:"chat",text:e.target.value}));e.target.value="";}}} />
        </div>
      </div>
    </div>
  );
}
