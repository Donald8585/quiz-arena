"use client";
import { useState, useEffect, useRef } from "react";
export default function Home() {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const [ws, setWs] = useState(null);
  const [messages, setMessages] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [myAnswer, setMyAnswer] = useState(null);
  const [players, setPlayers] = useState([]);
  const [topics] = useState(["cloud","devops","security","distributed"]);
  const [questionIdx, setQuestionIdx] = useState(0);
  const [fetchedQuestions, setFetchedQuestions] = useState([]);
  const [gamePhase, setGamePhase] = useState("lobby");
  const [readyPlayers, setReadyPlayers] = useState([]);
  const [answeredPlayers, setAnsweredPlayers] = useState([]);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef(null);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [showCorrect, setShowCorrect] = useState(false);
  const sentRevealRef = useRef(false);
  const [topicVotes, setTopicVotes] = useState({});
  const [myVote, setMyVote] = useState(null);
  const [nextRequested, setNextRequested] = useState(false);

  useEffect(()=>{
    if(timer>0&&!answered&&gamePhase==="playing")
      timerRef.current=setTimeout(()=>setTimer(timer-1),1000);
    if(timer===0&&currentQuestion&&!answered&&gamePhase==="playing")
      handleTimeout();
    return()=>clearTimeout(timerRef.current);
  },[timer,answered,gamePhase]);

  const handleTimeout=()=>{
    if(!ws||answered)return;
    ws.send(JSON.stringify({type:"answer",answer:"TIMEOUT",points:0,correct:false}));
    ws.send(JSON.stringify({type:"player_answered"}));
    setAnswered(true);setMyAnswer("TIMEOUT");
  };

  const joinRoom=()=>{
    var u=document.getElementById("uid")?.value||username;
    var r=document.getElementById("rid")?.value||roomId;
    if(!u||!r)return alert("Enter username and room ID!");
    setUsername(u);setRoomId(r);
    var s=new WebSocket("ws://"+window.location.hostname+":80/ws/"+r+"/"+u);
    s.onopen=()=>{setJoined(true);setWs(s);setGamePhase("lobby");addMsg("Connected");};
    s.onmessage=e=>handleMessage(JSON.parse(e.data));
    s.onclose=()=>{addMsg("Disconnected");setJoined(false);};
    s.onerror=()=>addMsg("Error");
  };

  const handleMessage=(d)=>{
    switch(d.type){
      case "player_joined":
        addMsg(d.username+" joined");
        setPlayers(p=>[...new Set([...p,d.username])]);break;
      case "player_left":
        addMsg(d.username+" left");
        setPlayers(p=>p.filter(x=>x!==d.username));
        setReadyPlayers(p=>p.filter(x=>x!==d.username));break;
      case "player_ready":
        addMsg(d.username+" ready!");
        setReadyPlayers(p=>[...new Set([...p,d.username])]);break;
      case "vote_topic":
        addMsg(d.username+" voted for "+d.topic);
        setTopicVotes(prev=>{var nv={...prev};nv[d.username]=d.topic;return nv;});break;
      case "game_start":
        addMsg("Game: "+d.topic);
        setGamePhase("playing");setTotalQuestions(d.total_questions);
        setQuestionIdx(0);setLeaderboard([]);setShowCorrect(false);
        if(d.questions)setFetchedQuestions(d.questions);break;
      case "new_question":
        setCurrentQuestion(d);setAnswered(false);setMyAnswer(null);
        setAnsweredPlayers([]);setShowCorrect(false);
        setTimer(d.time_limit||15);setGamePhase("playing");
        sentRevealRef.current=false;setNextRequested(false);
        addMsg("Q"+(d.question_number||"?"));break;
      case "player_answered":
        addMsg(d.username+" locked in!");
        setAnsweredPlayers(p=>[...new Set([...p,d.username])]);break;
      case "answer":
        if(d.leaderboard)setLeaderboard(d.leaderboard);break;
      case "reveal_answer":
        setShowCorrect(true);setGamePhase("reviewing");setTimer(0);
        if(d.leaderboard)setLeaderboard(d.leaderboard);break;
      case "request_next":
        addMsg(d.username+" wants next question");break;
      case "game_finished":
        setGamePhase("finished");
        if(d.leaderboard)setLeaderboard(d.leaderboard);break;
      case "chat":
        addMsg(d.username+": "+d.text);break;
    }
  };

  const addMsg=(t)=>setMessages(p=>[...p.slice(-80),{text:t,time:new Date().toLocaleTimeString()}]);

  const voteTopic=(topic)=>{
    if(ws&&!myVote){
      ws.send(JSON.stringify({type:"vote_topic",topic:topic}));
      setMyVote(topic);
      setTopicVotes(prev=>{var nv={...prev};nv[username]=topic;return nv;});
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
    if(ws){
      ws.send(JSON.stringify({type:"player_ready"}));
      setReadyPlayers(p=>[...new Set([...p,username])]);
    }
  };

  const startGame=async()=>{
    if(!ws)return;
    var topic=getWinningTopic();
    try{
      var r=await fetch("http://"+window.location.hostname+":80/api/generate-questions?topic="+topic+"&count=5");
      var data=await r.json();
      setFetchedQuestions(data.questions);
      ws.send(JSON.stringify({type:"game_start",topic:topic,total_questions:data.questions.length,questions:data.questions}));
      setTimeout(()=>{
        if(data.questions.length>0){
          var q=data.questions[0];
          ws.send(JSON.stringify({type:"new_question",...q,question_number:1,total:data.questions.length}));
          setQuestionIdx(0);
        }
      },1500);
    }catch(e){addMsg("Error: "+e.message);}
  };

  const submitAnswer=(a)=>{
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
      setTimeout(()=>{if(ws)ws.send(JSON.stringify({type:"reveal_answer",leaderboard:leaderboard}));},600);
    }
  },[answeredPlayers,players,gamePhase,currentQuestion,showCorrect]);

  const sendNextQuestion=()=>{
    if(!ws||fetchedQuestions.length===0||nextRequested)return;
    setNextRequested(true);
    var ni=questionIdx+1;
    if(ni>=fetchedQuestions.length){
      ws.send(JSON.stringify({type:"game_finished",leaderboard:leaderboard}));return;
    }
    setQuestionIdx(ni);
    var q=fetchedQuestions[ni];
    ws.send(JSON.stringify({type:"new_question",...q,question_number:ni+1,total:fetchedQuestions.length}));
  };

  const backToLobby=()=>{
    setGamePhase("lobby");setReadyPlayers([]);setAnsweredPlayers([]);
    setCurrentQuestion(null);setFetchedQuestions([]);setLeaderboard([]);
    setQuestionIdx(0);setShowCorrect(false);setMyAnswer(null);
    setTopicVotes({});setMyVote(null);setNextRequested(false);
  };

  var st={
    container:{maxWidth:1200,margin:"0 auto",padding:20},
    title:{textAlign:"center",fontSize:48,marginBottom:10,background:"linear-gradient(90deg,#ff6b6b,#ffd93d,#6bcb77,#4d96ff)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"},
    card:{background:"rgba(255,255,255,0.05)",borderRadius:16,padding:24,marginBottom:20,border:"1px solid rgba(255,255,255,0.1)"},
    input:{padding:"12px 16px",borderRadius:8,border:"1px solid rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.1)",color:"white",fontSize:16,width:200,marginBottom:12},
    btn:{padding:"12px 24px",borderRadius:8,border:"none",cursor:"pointer",fontSize:16,fontWeight:"bold",color:"white",background:"linear-gradient(135deg,#667eea,#764ba2)",width:"100%",marginBottom:8},
    btnGreen:{padding:"12px 24px",borderRadius:8,border:"none",cursor:"pointer",fontSize:16,fontWeight:"bold",color:"white",background:"linear-gradient(135deg,#11998e,#38ef7d)",width:"100%",marginBottom:8},
    btnDis:{padding:"12px 24px",borderRadius:8,border:"none",fontSize:16,fontWeight:"bold",color:"#666",background:"rgba(255,255,255,0.1)",width:"100%",marginBottom:8,cursor:"not-allowed"},
    btnOrange:{padding:"12px 24px",borderRadius:8,border:"none",cursor:"pointer",fontSize:16,fontWeight:"bold",color:"white",background:"linear-gradient(135deg,#f093fb,#f5576c)",width:"100%",marginBottom:8},
    badge:function(r){return{display:"inline-block",padding:"2px 8px",borderRadius:12,fontSize:11,marginLeft:8,background:r?"rgba(107,203,119,0.3)":"rgba(255,255,255,0.1)",color:r?"#6bcb77":"#666"}},
    voteBtn:function(active,voted){return{padding:"10px 16px",borderRadius:8,border:active?"2px solid #ffd93d":"1px solid rgba(255,255,255,0.2)",background:active?"rgba(255,217,61,0.2)":"rgba(255,255,255,0.05)",color:active?"#ffd93d":"#aaa",cursor:voted?"default":"pointer",fontSize:14,marginBottom:6,width:"100%",textAlign:"left"}},
  };

  if(!joined) return (
    <div style={st.container}>
      <h1 style={st.title}>Quiz Arena</h1>
      <p style={{textAlign:"center",color:"#aaa"}}>Real-Time Multiplayer Quiz Platform</p>
      <p style={{textAlign:"center",color:"#666",fontSize:13}}>AWS Free Tier | Nginx + FastAPI x2 + RDS + ElastiCache + Lambda + Prometheus + Grafana</p>
      <div style={{...st.card,maxWidth:400,margin:"0 auto",textAlign:"center"}}>
        <h2>Join a Room</h2>
        <input id="uid" style={st.input} placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} /><br/>
        <input id="rid" style={st.input} placeholder="Room ID" value={roomId} onChange={e=>setRoomId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&joinRoom()} /><br/>
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
            <h3 style={{marginTop:0}}>Players</h3>
            <p style={{color:"#aaa",fontSize:14}}>{players.length} player{players.length!==1?"s":""}</p>
            {players.map(function(p){return(
              <div key={p} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderRadius:8,marginBottom:6,background:"rgba(255,255,255,0.05)"}}>
                <span>{p===username?"You ("+p+")":p}</span>
                <span style={st.badge(readyPlayers.includes(p))}>{readyPlayers.includes(p)?"READY":"waiting"}</span>
              </div>
            )})}
            <div style={{marginTop:20}}>
              {!readyPlayers.includes(username)?
                <button style={st.btnGreen} onClick={toggleReady}>I am Ready!</button>:
                <div style={{textAlign:"center",color:"#6bcb77",padding:12}}>Ready!</div>}
            </div>
          </div>
          <div style={st.card}>
            <h3 style={{marginTop:0}}>Vote for Topic</h3>
            <p style={{color:"#aaa",fontSize:13}}>Everyone votes, majority wins!</p>
            {topics.map(function(t){
              var count=voteCounts[t]||0;
              var isMyVote=myVote===t;
              return(
                <button key={t} onClick={function(){voteTopic(t);}} disabled={!!myVote}
                  style={st.voteBtn(isMyVote,!!myVote)}>
                  <span style={{fontWeight:isMyVote?"bold":"normal"}}>{t.charAt(0).toUpperCase()+t.slice(1)}</span>
                  {count>0&&<span style={{float:"right",background:"rgba(255,217,61,0.3)",padding:"2px 8px",borderRadius:8,fontSize:12}}>{count} vote{count>1?"s":""}</span>}
                </button>
              );
            })}
            {myVote&&<p style={{color:"#6bcb77",fontSize:13,textAlign:"center",marginTop:8}}>You voted: {myVote}</p>}
            {!myVote&&<p style={{color:"#666",fontSize:13,textAlign:"center",marginTop:8}}>Pick a topic!</p>}
            {allVoted&&<p style={{color:"#ffd93d",fontSize:14,textAlign:"center",fontWeight:"bold",marginTop:8}}>Winner: {getWinningTopic().toUpperCase()}</p>}
          </div>
          <div style={st.card}>
            <h3 style={{marginTop:0}}>Game</h3>
            <div style={{padding:16,borderRadius:8,marginBottom:16,textAlign:"center"}}>
              <p style={{color:allReady?"#6bcb77":"#666",margin:0}}>{allReady?"All ready!":readyPlayers.length+"/"+players.length+" ready"}</p>
              {allVoted&&<p style={{color:"#ffd93d",margin:"8px 0 0"}}>Topic votes in!</p>}
            </div>
            {allReady&&allVoted?
              <button style={st.btnOrange} onClick={startGame}>Start Game</button>:
              <button style={st.btnDis} disabled>
                {!allReady&&!allVoted?"Need ready + votes":!allReady?"Waiting for ready...":"Waiting for votes..."}
              </button>}
            <div style={{marginTop:16}}>
              <h4 style={{color:"#aaa"}}>Log</h4>
              <div style={{maxHeight:150,overflowY:"auto",background:"rgba(0,0,0,0.3)",borderRadius:8,padding:8,fontSize:12}}>
                {messages.slice(-20).map(function(m,i){return(
                  <div key={i} style={{color:"#999"}}>[{m.time}] {m.text}</div>
                )})}
              </div>
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
        <h2 style={{fontSize:36}}>Game Over!</h2>
        {leaderboard.map(function(e,i){return(
          <div key={e.username} style={{display:"flex",justifyContent:"space-between",padding:"16px 20px",borderRadius:12,marginBottom:8,background:i===0?"rgba(255,217,61,0.2)":i===1?"rgba(192,192,192,0.15)":"rgba(255,255,255,0.05)",fontSize:i===0?20:16}}>
            <span>{i===0?"\ud83e\udd47":i===1?"\ud83e\udd48":i===2?"\ud83e\udd49":(i+1)+"."} {e.username}{e.username===username?" (you)":""}</span>
            <span style={{fontWeight:"bold"}}>{e.score} pts</span>
          </div>
        )})}
        <button style={{...st.btn,marginTop:24}} onClick={backToLobby}>Back to Lobby</button>
      </div>
    </div>
  );

  var pct=(timer/15)*100;
  return(
    <div style={st.container}>
      <h1 style={st.title}>Quiz Arena</h1>
      <p style={{textAlign:"center",color:"#aaa"}}>Room: {roomId} | Q{questionIdx+1}/{fetchedQuestions.length||totalQuestions||"?"} | {showCorrect?"Review":"Playing"}</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20}}>
        <div style={st.card}>
          {!showCorrect&&currentQuestion&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:13,color:"#aaa"}}>Time</span>
                <span style={{fontSize:22,fontWeight:"bold",color:timer>10?"#6bcb77":timer>5?"#ffd93d":"#ff6b6b"}}>{timer}s</span>
              </div>
              <div style={{height:6,borderRadius:3,marginBottom:16,background:"rgba(255,255,255,0.1)",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",top:0,left:0,height:"100%",width:pct+"%",borderRadius:3,background:pct>60?"#6bcb77":pct>30?"#ffd93d":"#ff6b6b",transition:"width 1s linear"}}/>
              </div>
            </div>
          )}
          <h3>{showCorrect?"Results":"Question"}</h3>
          {currentQuestion?(
            <div>
              <p style={{fontSize:18}}>{currentQuestion.question_text}</p>
              {["A","B","C","D"].map(function(o){
                var isC=o===currentQuestion.correct_answer;
                var isM=o===myAnswer;
                var bg="rgba(255,255,255,0.05)";
                var bd="1px solid rgba(255,255,255,0.2)";
                var op=1;var lb="";
                if(showCorrect){
                  if(isC){bg="rgba(107,203,119,0.25)";bd="2px solid #6bcb77";lb=" \u2713";}
                  else if(isM){bg="rgba(255,107,107,0.25)";bd="2px solid #ff6b6b";lb=" \u2717";}
                  else{op=0.4;}
                }else if(answered&&isM){bg="rgba(102,126,234,0.3)";bd="2px solid #667eea";lb=" [locked]";}
                return(
                  <button key={o} onClick={function(){submitAnswer(o);}} disabled={answered||showCorrect}
                    style={{width:"100%",padding:12,marginBottom:8,borderRadius:8,border:bd,background:bg,color:"white",cursor:(answered||showCorrect)?"default":"pointer",textAlign:"left",fontSize:15,opacity:op,transition:"all 0.3s"}}>
                    <strong>{o}.</strong> {currentQuestion["option_"+o.toLowerCase()]}{lb}
                  </button>
                );
              })}
              {answered&&!showCorrect&&(
                <div style={{textAlign:"center",padding:12,marginTop:8,background:"rgba(102,126,234,0.1)",borderRadius:8,border:"1px solid rgba(102,126,234,0.3)",color:"#aaa",fontSize:14}}>
                  Locked! Waiting ({answeredPlayers.length}/{players.length})
                </div>
              )}
              {showCorrect&&myAnswer&&(
                <div style={{textAlign:"center",padding:12,marginTop:8,borderRadius:8,background:myAnswer===currentQuestion.correct_answer?"rgba(107,203,119,0.15)":"rgba(255,107,107,0.15)",color:myAnswer===currentQuestion.correct_answer?"#6bcb77":"#ff6b6b",fontSize:16,fontWeight:"bold"}}>
                  {myAnswer===currentQuestion.correct_answer?"Correct!":myAnswer==="TIMEOUT"?"Timed out!":"Wrong! Answer: "+currentQuestion.correct_answer}
                </div>
              )}
              {showCorrect&&(
                <button style={{...st.btnGreen,marginTop:12}} onClick={sendNextQuestion} disabled={nextRequested}>
                  {nextRequested?"Loading...":questionIdx+1>=(fetchedQuestions.length||totalQuestions)?"Final Results":"Next Question \u27a1"}
                </button>
              )}
            </div>
          ):<p style={{color:"#aaa"}}>Waiting...</p>}
        </div>
        <div style={st.card}>
          <h3>Leaderboard</h3>
          {leaderboard.length>0?leaderboard.map(function(e,i){return(
            <div key={e.username} style={{display:"flex",justifyContent:"space-between",padding:10,borderRadius:8,marginBottom:4,background:i===0?"rgba(255,217,61,0.2)":i===1?"rgba(192,192,192,0.15)":"rgba(255,255,255,0.05)"}}>
              <span>{i===0?"\ud83e\udd47":i===1?"\ud83e\udd48":i===2?"\ud83e\udd49":(i+1)+"."} {e.username}{e.username===username?" (you)":""}</span>
              <span style={{fontWeight:"bold"}}>{e.score}</span>
            </div>
          )}):<p style={{color:"#aaa"}}>Scores after Q1</p>}
          <h3 style={{marginTop:24}}>Players</h3>
          {players.map(function(p){
            var done=answeredPlayers.includes(p);
            return(
              <div key={p} style={{display:"flex",justifyContent:"space-between",padding:"6px 8px",color:p===username?"#ffd93d":"#aaa"}}>
                <span>{p===username?"You":p}</span>
                {!showCorrect&&currentQuestion&&<span style={{fontSize:12,color:done?"#6bcb77":"#666"}}>{done?"locked":"thinking..."}</span>}
                {showCorrect&&<span style={{fontSize:12,color:"#6bcb77"}}>done</span>}
              </div>
            );
          })}
        </div>
        <div style={st.card}>
          <h3>Event Log</h3>
          <div style={{maxHeight:400,overflowY:"auto",background:"rgba(0,0,0,0.3)",borderRadius:8,padding:12}}>
            {messages.map(function(m,i){return(
              <div key={i} style={{marginBottom:4,fontSize:13}}>
                <span style={{color:"#666"}}>[{m.time}]</span> {m.text}
              </div>
            )})}
          </div>
          <input style={{...st.input,width:"100%",marginTop:12}} placeholder="Chat..."
            onKeyDown={function(e){if(e.key==="Enter"&&e.target.value){ws?.send(JSON.stringify({type:"chat",text:e.target.value}));e.target.value="";}}} />
        </div>
      </div>
    </div>
  );
}
