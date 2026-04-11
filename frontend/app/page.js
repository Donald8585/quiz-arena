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
  const roomIdRef = useRef("");

  useEffect(() => { usernameRef.current = username; }, [username]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  useEffect(() => {
    if (timer > 0 && !answered && gamePhase === "playing")
      timerRef.current = setTimeout(() => setTimer(t => t - 1), 1000);
    if (timer === 0 && currentQuestion && !answered && gamePhase === "playing")
      handleTimeout();
    return () => clearTimeout(timerRef.current);
  }, [timer, answered, gamePhase, currentQuestion]);

  const handleTimeout = () => {
    var ws = wsRef.current;
    if (!ws || answered) return;
    ws.send(JSON.stringify({ type: "answer", answer: "TIMEOUT", points: 0, correct: false }));
    ws.send(JSON.stringify({ type: "player_answered" }));
    setAnswered(true);
    setMyAnswer("TIMEOUT");
  };

  const addMsg = useCallback((t) => {
    setMessages(p => [...p.slice(-80), { text: t, time: new Date().toLocaleTimeString() }]);
  }, []);

  /* ========================================================================
   * FIX: Register/upsert user via REST API before connecting WebSocket.
   * This ensures the `users` table has a row for this player.
   * If the user already exists (400), we just ignore it and proceed.
   * ======================================================================== */
  const joinRoom = async () => {
    var u = username.trim();
    var r = roomId.trim();
    if (!u || !r) return alert("Enter username and room ID!");

    // Ensure user exists in PostgreSQL via REST endpoint
    try {
      await fetch("http://" + window.location.hostname + ":80/api/users/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: "guest_" + u + "_" + Date.now() })
      });
      // 400 "Exists" is fine — user already registered
    } catch (e) {
      console.log("User register skipped (server-side WS handler also upserts):", e);
    }

    var host = window.location.hostname;
    var s = new WebSocket("ws://" + host + ":80/ws/" + r + "/" + u);
    s.onopen = () => {
      wsRef.current = s;
      setJoined(true);
      setGamePhase("lobby");
      addMsg("Connected!");
    };
    s.onmessage = (e) => {
      try { var d = JSON.parse(e.data); handleMessage(d); } catch (err) { console.error(err); }
    };
    s.onclose = () => { addMsg("Disconnected"); setJoined(false); wsRef.current = null; };
    s.onerror = () => addMsg("Connection error");
  };

  const handleMessage = (d) => {
    var t = d.type;
    if (t === "player_joined") {
      setPlayers(p => { var s = new Set(p); s.add(d.username); return [...s]; });
      if (d.source !== "history") addMsg(d.username + " joined");
    } else if (t === "player_left") {
      setPlayers(p => p.filter(x => x !== d.username));
      setReadyPlayers(p => p.filter(x => x !== d.username));
      addMsg(d.username + " left");
    } else if (t === "player_ready") {
      setReadyPlayers(p => { var s = new Set(p); s.add(d.username); return [...s]; });
      if (d.source !== "history") addMsg(d.username + " ready!");
    } else if (t === "vote_topic") {
      setTopicVotes(prev => ({ ...prev, [d.username]: d.topic }));
      if (d.source !== "history") addMsg(d.username + " voted " + d.topic);
    } else if (t === "state_snapshot") {
      setGamePhase(d.phase || "lobby");
      setTotalQ(d.total_questions || 5);
      if (d.current_question) {
        setCurrentQuestion(d.current_question);
        setQuestionNum(d.question_number || 1);
        setTotalQ(d.total || d.total_questions || 5);
        setTimer(d.time_limit || 15);
        if (d.phase === "reviewing") { setShowCorrect(true); setTimer(0); }
      }
      if (d.leaderboard) setLeaderboard(d.leaderboard);
    } else if (t === "game_start") {
      addMsg("Game starting: " + d.topic);
      setGamePhase("playing");
      setTotalQ(d.total_questions || 5);
      setQuestionNum(0); setLeaderboard([]); setShowCorrect(false);
      if (d.questions && d.questions.length > 0)
        questionsRef.current = d.questions;
    } else if (t === "new_question") {
      var qn = d.question_number || 1;
      setQuestionNum(qn); setTotalQ(d.total || totalQ);
      setCurrentQuestion(d); setAnswered(false); setMyAnswer(null);
      setAnsweredPlayers([]); setShowCorrect(false);
      setTimer(d.time_limit || 15); setGamePhase("playing");
      sentRevealRef.current = false; setNextSent(false);
      addMsg("Question " + qn);
    } else if (t === "player_answered") {
      setAnsweredPlayers(p => { var s = new Set(p); s.add(d.username); return [...s]; });
      if (d.username !== usernameRef.current) addMsg(d.username + " locked in");
    } else if (t === "answer") {
      if (d.leaderboard) setLeaderboard(d.leaderboard);
    } else if (t === "reveal_answer") {
      setShowCorrect(true); setGamePhase("reviewing"); setTimer(0);
      if (d.leaderboard) setLeaderboard(d.leaderboard);
    } else if (t === "game_finished") {
      setGamePhase("finished");
      if (d.leaderboard) setLeaderboard(d.leaderboard);
      addMsg("Game over!");
    } else if (t === "back_to_lobby") {
      setGamePhase("lobby"); setReadyPlayers([]); setAnsweredPlayers([]);
      setCurrentQuestion(null); questionsRef.current = []; setLeaderboard([]);
      setQuestionNum(0); setShowCorrect(false); setMyAnswer(null);
      setTopicVotes({}); setMyVote(null); setNextSent(false);
      addMsg("Back to lobby");
    } else if (t === "chat") {
      addMsg(d.username + ": " + d.text);
    }
  };

  /* --- compute voteCounts and allVoted properly --- */
  var voteCounts = {};
  topics.forEach(function (t) { voteCounts[t] = 0; });
  Object.values(topicVotes).forEach(function (t) { voteCounts[t] = (voteCounts[t] || 0) + 1; });
  var allVoted = players.length > 0 && Object.keys(topicVotes).length >= players.length;

  const voteTopic = (topic) => {
    var ws = wsRef.current;
    if (ws && !myVote) {
      ws.send(JSON.stringify({ type: "vote_topic", topic: topic }));
      setMyVote(topic);
      setTopicVotes(prev => ({ ...prev, [username]: topic }));
    }
  };

  const getWinningTopic = () => {
    var counts = {};
    Object.values(topicVotes).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    var winner = "cloud", max = 0;
    Object.entries(counts).forEach(([t, c]) => { if (c > max) { max = c; winner = t; } });
    return winner;
  };

  const toggleReady = () => {
    var ws = wsRef.current;
    if (ws) {
      ws.send(JSON.stringify({ type: "player_ready" }));
      setReadyPlayers(p => { var s = new Set(p); s.add(username); return [...s]; });
    }
  };

  const startGame = async () => {
    var ws = wsRef.current;
    if (!ws) return;
    var topic = getWinningTopic();
    try {
      var r = await fetch("http://" + window.location.hostname + ":80/api/generate-questions?topic=" + topic + "&count=5");
      var data = await r.json();
      var qs = data.questions || [];
      questionsRef.current = qs;
      ws.send(JSON.stringify({ type: "game_start", topic: topic, total_questions: qs.length, questions: qs }));
      setTimeout(() => {
        if (qs.length > 0) {
          ws.send(JSON.stringify({ type: "new_question" }));
        }
      }, 1500);
    } catch (e) { addMsg("Error: " + e.message); }
  };

  const submitAnswer = (a) => {
    var ws = wsRef.current;
    if (!ws || answered) return;
    var correct = a === (currentQuestion ? currentQuestion.correct_answer : null);
    var pts = correct ? 50 + Math.round((timer / 15) * 50) : 0;
    ws.send(JSON.stringify({ type: "answer", answer: a, points: pts, correct: correct }));
    ws.send(JSON.stringify({ type: "player_answered" }));
    setAnswered(true);
    setMyAnswer(a);
  };

  useEffect(() => {
    if (answeredPlayers.length >= players.length && players.length > 0 && gamePhase === "playing" && currentQuestion && !showCorrect && !sentRevealRef.current) {
      sentRevealRef.current = true;
      setTimeout(() => {
        var ws = wsRef.current;
        if (ws) ws.send(JSON.stringify({ type: "reveal_answer" }));
      }, 600);
    }
  }, [answeredPlayers, players, gamePhase, currentQuestion, showCorrect]);

  const sendNextQuestion = () => {
    var ws = wsRef.current;
    if (!ws || nextSent) return;
    setNextSent(true);
    ws.send(JSON.stringify({ type: "new_question" }));
  };

  const backToLobby = () => {
    var ws = wsRef.current;
    if (ws) ws.send(JSON.stringify({ type: "back_to_lobby" }));
    setGamePhase("lobby"); setReadyPlayers([]); setAnsweredPlayers([]);
    setCurrentQuestion(null); questionsRef.current = []; setLeaderboard([]);
    setQuestionNum(0); setShowCorrect(false); setMyAnswer(null);
    setTopicVotes({}); setMyVote(null); setNextSent(false);
  };

  var st = {
    container: { maxWidth: 1200, margin: "0 auto", padding: 20 },
    title: { textAlign: "center", fontSize: 48, marginBottom: 10, background: "linear-gradient(90deg,#ff6b6b,#ffd93d,#6bcb77,#4d96ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
    subtitle: { textAlign: "center", color: "#888", marginBottom: 30, fontSize: 14 },
    card: { background: "rgba(255,255,255,0.05)", borderRadius: 16, padding: 24, marginBottom: 20, border: "1px solid rgba(255,255,255,0.1)" },
    input: { padding: "12px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", color: "white", fontSize: 16, width: 200, marginBottom: 12 },
    btn: { padding: "12px 24px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 16, fontWeight: "bold", color: "white", background: "linear-gradient(135deg,#667eea,#764ba2)", width: "100%", marginBottom: 8 },
    btnG: { padding: "12px 24px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 16, fontWeight: "bold", color: "white", background: "linear-gradient(135deg,#11998e,#38ef7d)", width: "100%", marginBottom: 8 },
    btnD: { padding: "12px 24px", borderRadius: 8, border: "none", fontSize: 16, fontWeight: "bold", color: "#666", background: "rgba(255,255,255,0.1)", width: "100%", marginBottom: 8, cursor: "not-allowed" },
    btnO: { padding: "12px 24px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 16, fontWeight: "bold", color: "white", background: "linear-gradient(135deg,#f093fb,#f5576c)", width: "100%", marginBottom: 8 },
  };

  /* ========================= LOGIN SCREEN ========================= */
  if (!joined) return (
    <div style={{ ...st.container, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <h1 style={st.title}>Quiz Arena</h1>
      <p style={st.subtitle}>AWS Free Tier | Nginx + FastAPI + RDS + ElastiCache + Lambda + Prometheus + Grafana</p>
      <div style={st.card}>
        <h2 style={{ textAlign: "center", marginBottom: 16, color: "white" }}>Real-Time Multiplayer Quiz Platform</h2>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <input style={st.input} placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input style={st.input} placeholder="Room ID" value={roomId} onChange={e => setRoomId(e.target.value)} />
          <button style={{ ...st.btn, width: 200 }} onClick={joinRoom}>Join Room</button>
        </div>
      </div>
    </div>
  );

  /* ========================= LOBBY ========================= */
  if (gamePhase === "lobby") return (
    <div style={st.container}>
      <h1 style={st.title}>Quiz Arena</h1>
      <div style={st.card}>
        <h3 style={{ color: "white", marginBottom: 8 }}>Room: {roomId}</h3>
        <p style={{ color: "#aaa", marginBottom: 12 }}>{readyPlayers.length}/{players.length} ready</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {players.map(p => (
            <span key={p} style={{ padding: "4px 12px", borderRadius: 20, background: readyPlayers.includes(p) ? "#38ef7d33" : "rgba(255,255,255,0.1)", color: readyPlayers.includes(p) ? "#38ef7d" : "#aaa", border: "1px solid " + (readyPlayers.includes(p) ? "#38ef7d55" : "rgba(255,255,255,0.1)") }}>{p} {readyPlayers.includes(p) ? "✓" : ""}</span>
          ))}
        </div>
        {!readyPlayers.includes(username) && <button style={st.btnG} onClick={toggleReady}>Ready Up</button>}
        <h4 style={{ color: "white", marginTop: 16, marginBottom: 8 }}>Everyone votes, majority wins</h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {topics.map(function (t) {
            var count = voteCounts[t] || 0;
            var isMy = myVote === t;
            return <button key={t} style={{ ...st.btn, width: "auto", background: isMy ? "linear-gradient(135deg,#f093fb,#f5576c)" : "linear-gradient(135deg,#667eea,#764ba2)", opacity: myVote && !isMy ? 0.5 : 1 }} onClick={() => voteTopic(t)} disabled={!!myVote}>{t} ({count})</button>;
          })}
        </div>
        {myVote && <p style={{ color: "#aaa", marginTop: 8 }}>Voted: {myVote}</p>}
        {allVoted && <p style={{ color: "#38ef7d", marginTop: 8 }}>{Object.keys(topicVotes).length}/{players.length} voted</p>}
        {readyPlayers.length === players.length && players.length >= 1 && allVoted && (
          <button style={{ ...st.btnG, marginTop: 16 }} onClick={startGame}>Start Game</button>
        )}
      </div>
      <div style={st.card}>
        <h3 style={{ color: "white", marginBottom: 8 }}>Chat</h3>
        <div style={{ maxHeight: 200, overflow: "auto", marginBottom: 8 }}>
          {messages.map((m, i) => <p key={i} style={{ color: "#ccc", fontSize: 13 }}><span style={{ color: "#666" }}>{m.time}</span> {m.text}</p>)}
        </div>
      </div>
    </div>
  );

  /* ========================= PLAYING / REVIEWING ========================= */
  if (gamePhase === "playing" || gamePhase === "reviewing") return (
    <div style={st.container}>
      <h1 style={st.title}>Quiz Arena</h1>
      {currentQuestion ? (
        <div style={st.card}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ color: "#aaa" }}>Q{questionNum}/{totalQ}</span>
            <span style={{ color: timer <= 5 ? "#ff6b6b" : "#ffd93d", fontWeight: "bold", fontSize: 20 }}>{timer}s</span>
          </div>
          <h2 style={{ color: "white", marginBottom: 20 }}>{currentQuestion.question_text}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {["A", "B", "C", "D"].map(letter => {
              var optKey = "option_" + letter.toLowerCase();
              var optText = currentQuestion[optKey];
              var isCorrect = letter === currentQuestion.correct_answer;
              var isMyAnswer = myAnswer === letter;
              var bg = st.btn.background;
              if (showCorrect && isCorrect) bg = "linear-gradient(135deg,#11998e,#38ef7d)";
              else if (showCorrect && isMyAnswer && !isCorrect) bg = "linear-gradient(135deg,#f5576c,#f093fb)";
              else if (isMyAnswer) bg = "linear-gradient(135deg,#764ba2,#667eea)";
              return <button key={letter} style={{ ...st.btn, background: bg, opacity: answered && !isMyAnswer && !(showCorrect && isCorrect) ? 0.4 : 1 }} onClick={() => submitAnswer(letter)} disabled={answered}>{letter}. {optText}</button>;
            })}
          </div>
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {answeredPlayers.map(p => <span key={p} style={{ padding: "2px 8px", borderRadius: 10, background: "#667eea33", color: "#667eea", fontSize: 12 }}>{p} ✓</span>)}
          </div>
          {showCorrect && questionNum < totalQ && (
            <button style={{ ...st.btnO, marginTop: 16 }} onClick={sendNextQuestion} disabled={nextSent}>
              {nextSent ? "⏳ Waiting..." : "Next Question →"}
            </button>
          )}
          {showCorrect && questionNum >= totalQ && (
            <p style={{ color: "#ffd93d", textAlign: "center", marginTop: 16, fontSize: 18 }}>⏳ Waiting for final results...</p>
          )}
        </div>
      ) : (
        <div style={st.card}><p style={{ color: "#aaa", textAlign: "center" }}>⏳ Waiting for question...</p></div>
      )}
      <div style={st.card}>
        <h3 style={{ color: "white", marginBottom: 8 }}>Leaderboard</h3>
        {leaderboard.length > 0 ? leaderboard.map((e, i) => (
          <div key={e.username} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ color: i === 0 ? "#ffd93d" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#aaa" }}>#{i + 1} {e.username}</span>
            <span style={{ color: "white", fontWeight: "bold" }}>{e.score}</span>
          </div>
        )) : <p style={{ color: "#666" }}>Scores appear after Q1</p>}
      </div>
    </div>
  );

  /* ========================= FINISHED ========================= */
  if (gamePhase === "finished") return (
    <div style={st.container}>
      <h1 style={st.title}>Quiz Arena</h1>
      <div style={st.card}>
        <h2 style={{ color: "#ffd93d", textAlign: "center", marginBottom: 16 }}>🏆 Game Over!</h2>
        {leaderboard.map((e, i) => (
          <div key={e.username} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ color: i === 0 ? "#ffd93d" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#aaa", fontSize: 18 }}>#{i + 1} {e.username}</span>
            <span style={{ color: "white", fontWeight: "bold", fontSize: 18 }}>{e.score}</span>
          </div>
        ))}
        <button style={{ ...st.btnG, marginTop: 20 }} onClick={backToLobby}>Back to Lobby</button>
      </div>
    </div>
  );

  return (
    <div style={st.container}>
      <h1 style={st.title}>Quiz Arena</h1>
      <p style={{ color: "#aaa" }}>Loading...</p>
    </div>
  );
}
