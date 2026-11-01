/* Sihirli Sayılar multiplayer — synchronized target, countdown and per-player completion. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const APP_CONFIG = {
    url: "https://gnikcxotvdjavbmpwbep.supabase.co",
    key: "sb_publishable_JFy19xvOB8Q9faUiUh-QMw_AkRFRd7h"
  };
  const panel = $("#multiplayerPanel");
  const statusEl = $("#mpStatus");
  const roomInfo = $("#mpRoomInfo");
  const roomCodeEl = $("#mpRoomCode");
  const playersEl = $("#mpPlayers");
  const resultsEl = $("#mpResults");
  const countdown = $("#mpCountdown");
  const countdownValue = $("#mpCountdownValue");
  let supabase = null, room = null, player = null, isHost = false, poller = null;
  let lastSolvedSent = false, onChangeQueued = false;
  let countdownTicker = null, activeStartKey = null, timerStartedFor = null;
  let targetNumber = null;

  const KEY_PLAYER = "sihiri_player_token_v1";
  const token = () => {
    let t = sessionStorage.getItem(KEY_PLAYER);
    if (!t) {
      t = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      sessionStorage.setItem(KEY_PLAYER, t);
    }
    return t;
  };
  const playerToken = token();
  const setStatus = (text, type="") => { statusEl.textContent = text; statusEl.className = "mp-status " + type; };
  function connect() {
    if (!window.supabase?.createClient) throw new Error("Supabase istemcisi yüklenemedi. İnternet bağlantısını kontrol edin.");
    if (!supabase) {
      supabase = window.supabase.createClient(APP_CONFIG.url, APP_CONFIG.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
    }
    return supabase;
  }
  async function rpc(name, args) {
    if (!supabase) connect();
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  }
  function setTargetFromRoom(r) {
    const ch = r?.challenge || {};
    const n = Number(ch.target_number ?? ch.answer);
    targetNumber = Number.isInteger(n) && n >= 1 && n <= 24 ? n : null;
  }
  function updateCountdown(r) {
    if (!r?.starts_at || r.status !== "playing") {
      countdown.classList.remove("show");
      if (countdownTicker) clearInterval(countdownTicker);
      countdownTicker = null;
      return;
    }
    const startKey = `${r.code}:${r.starts_at}`;
    if (activeStartKey !== startKey) {
      activeStartKey = startKey;
      timerStartedFor = null;
      if (countdownTicker) clearInterval(countdownTicker);
      const startMs = new Date(r.starts_at).getTime() + 3000;
      const tick = () => {
        const left = startMs - Date.now();
        if (left > 0) {
          const seconds = Math.ceil(left / 1000);
          countdownValue.textContent = String(Math.min(3, seconds));
          countdown.classList.add("show");
        } else if (left > -850) {
          countdownValue.textContent = "BAŞLA!";
          countdown.classList.add("show");
        } else {
          countdown.classList.remove("show");
          if (countdownTicker) clearInterval(countdownTicker);
          countdownTicker = null;
          if (timerStartedFor !== startKey) {
            timerStartedFor = startKey;
            if (window.SihirliSayiGame?.startMultiplayerTimer) {
              window.SihirliSayiGame.startMultiplayerTimer(
                r.duration_seconds || 180, startMs
              );
            }
          }
        }
      };
      tick();
      countdownTicker = setInterval(tick, 100);
    }
  }
  function renderRoom(data) {
    if (!data) return;
    const r = data.room || data;
    room = r;
    setTargetFromRoom(r);
    roomCodeEl.textContent = r.code || "------";
    roomInfo.style.display = "block";
    const ps = data.players || [];
    playersEl.replaceChildren();
    ps.forEach(p => {
      const el = document.createElement("span");
      el.className = "mp-player" + (p.player_id === player?.player_id ? " me" : "");
      el.textContent = (p.display_name || "Oyuncu") +
        (p.is_host ? " · Sunucu" : "") +
        (p.finished_at ? " · Oyunu tamamladı" : "");
      playersEl.appendChild(el);
    });
    resultsEl.replaceChildren();
    const promptEl = $("#mpRoundPrompt");
    if (r.status === "playing") {
      promptEl.style.display = "block";
      promptEl.textContent = `Hedef sayı: ${targetNumber ?? "—"}. Bu sayıyı boş hücre olarak bırak. Süre: ${Math.round((r.duration_seconds || 180) / 60)} dakika.`;
      updateCountdown(r);
    } else {
      if (r.status === "waiting" && targetNumber !== null) {
        promptEl.style.display = "block";
        promptEl.textContent = `Ortak hedef sayı: ${targetNumber}. Tur başlayınca bu sayıyı boş hücre olarak bırakmaya çalışın.`;
      } else {
        promptEl.style.display = "none";
      }
      updateCountdown(null);
    }
    if (r.status === "playing") {
      const el = document.createElement("div");
      el.className = "mp-result";
      const starts = r.starts_at ? new Date(r.starts_at).toLocaleTimeString("tr-TR") : "—";
      el.textContent = `Tur hazırlanıyor · ${starts}`;
      resultsEl.appendChild(el);
    } else if (r.status === "finished") {
      const el = document.createElement("div");
      el.className = "mp-result";
      el.textContent = "Tüm oyuncuların turu tamamlandı.";
      resultsEl.appendChild(el);
    }
    const me = ps.find(p => p.player_id === player?.player_id);
    if (me?.finished_at) setStatus("Oyunu tamamladın. Diğer oyuncular devam edebilir.", "success");
    $("#mpPickNumber").disabled = !(isHost && r.status === "waiting");
    $("#mpStart").disabled = !(isHost && ps.length >= 2 && r.status === "waiting" && targetNumber !== null);
    $("#mpLeave").disabled = false;
  }
  async function maybeSubmitCompletion() {
    if (!room || !player || room.status !== "playing" || lastSolvedSent || targetNumber == null) return;
    const empty = window.SihirliSayiGame?.getCorrectEmpty?.();
    if (empty !== String(targetNumber)) return;
    lastSolvedSent = true;
    try {
      const game = window.SihirliSayiGame.getState();
      await rpc("sihiri_submit_result", {
        p_code: room.code,
        p_token: player.player_token,
        p_answer: String(targetNumber),
        p_board_state: game
      });
      setStatus("Oyunu tamamladın! Diğer oyuncular çözmeye devam edebilir.", "success");
      await refresh();
    } catch (e) {
      lastSolvedSent = false;
      setStatus("Tamamlama kaydedilemedi: " + e.message, "error");
    }
  }
  async function refresh() {
    if (!room || !player) return;
    try {
      const data = await rpc("sihiri_room_state", { p_code: room.code, p_token: player.player_token });
      renderRoom(data);
      await maybeSubmitCompletion();
    } catch (e) {
      setStatus("Oda güncellemesi alınamadı: " + e.message, "error");
    }
  }
  function beginPolling() {
    clearInterval(poller);
    refresh();
    poller = setInterval(refresh, 1000);
  }
  function stopRoom() {
    clearInterval(poller); poller = null;
    if (countdownTicker) clearInterval(countdownTicker);
    countdownTicker = null; activeStartKey = null; timerStartedFor = null;
    countdown.classList.remove("show");
    room = null; player = null; isHost = false; lastSolvedSent = false; targetNumber = null;
    roomInfo.style.display = "none";
    $("#mpStart").disabled = true; $("#mpLeave").disabled = true;
  }
  $("#openMultiplayer").addEventListener("click", () => {
    panel.classList.add("show");
    connect();
  });
  $("#closeMultiplayer").addEventListener("click", () => panel.classList.remove("show"));

  $("#mpCreate").addEventListener("click", async () => {
    try {
      connect();
      const name = $("#mpName").value.trim() || "Oyuncu";
      const data = await rpc("sihiri_create_room", { p_name: name, p_token: playerToken });
      room = data.room; player = data.player; isHost = true;
      lastSolvedSent = false; activeStartKey = null;
      renderRoom(data);
      setStatus("Oda oluşturuldu. Kodu arkadaşlarınla paylaş. En az iki oyuncu katıldığında hedef sayıyı belirleyip turu başlatabilirsin.", "success");
      beginPolling();
    } catch (e) { setStatus("Oda oluşturulamadı: " + e.message, "error"); }
  });
  $("#mpJoin").addEventListener("click", async () => {
    try {
      connect();
      const code = $("#mpJoinCode").value.trim().toUpperCase();
      if (!code) throw new Error("Katılmak için oda kodunu yazın.");
      const data = await rpc("sihiri_join_room", {
        p_code: code, p_name: $("#mpName").value.trim() || "Oyuncu", p_token: playerToken
      });
      room = data.room; player = data.player; isHost = false;
      lastSolvedSent = false; activeStartKey = null;
      renderRoom(data);
      setStatus("Odaya katıldınız. Oda sahibinin hedef sayıyı seçip turu başlatmasını bekleyin.", "success");
      beginPolling();
    } catch (e) { setStatus("Odaya katılınamadı: " + e.message, "error"); }
  });
  $("#mpPickNumber").addEventListener("click", async () => {
    try {
      if (!room || !player || !isHost) throw new Error("Sayıyı yalnızca oda sahibi seçebilir.");
      if (room.status !== "waiting") throw new Error("Tur başladıktan sonra hedef sayı değiştirilemez.");
      const n = Math.floor(Math.random() * 24) + 1;
      const challenge = {
        method: "random", display: String(n), answer: n,
        target_number: n, instruction: "Bu sayıyı boş hücre olarak bırak."
      };
      const data = await rpc("sihiri_set_challenge", {
        p_code: room.code, p_token: player.player_token, p_challenge: challenge
      });
      renderRoom(data);
      setStatus(`Ortak hedef sayı ${n} olarak seçildi. Tüm oyuncuların ekranında görünür.`, "success");
    } catch (e) { setStatus("Sayı seçilemedi: " + e.message, "error"); }
  });
  $("#mpStart").addEventListener("click", async () => {
    try {
      if (!room || !player || !isHost) throw new Error("Turu yalnızca oda sahibi başlatabilir.");
      if (targetNumber == null) throw new Error("Önce rastgele hedef sayı seçin.");
      const seconds = Number($("#mpDuration").value);
      const challenge = room.challenge;
      const data = await rpc("sihiri_start_round", {
        p_code: room.code, p_token: player.player_token,
        p_duration: seconds, p_challenge: challenge
      });
      lastSolvedSent = false; activeStartKey = null;
      renderRoom(data);
      setStatus(`Hedef sayı ${targetNumber}. Tur tüm oyuncular için geri sayımla başlayacak.`, "success");
      beginPolling();
    } catch (e) { setStatus("Tur başlatılamadı: " + e.message, "error"); }
  });
  $("#mpLeave").addEventListener("click", async () => {
    try {
      if (room && player) await rpc("sihiri_leave_room", { p_code: room.code, p_token: player.player_token });
      stopRoom(); setStatus("Odadan ayrıldınız.");
    } catch (e) { setStatus("Odadan ayrılma hatası: " + e.message, "error"); }
  });
  $("#mpJoinCode").addEventListener("input", e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });
  if (window.SihirliSayiGame) {
    window.SihirliSayiGame.onChange = () => {
      if (room && player && !onChangeQueued) {
        onChangeQueued = true;
        setTimeout(async () => {
          onChangeQueued = false;
          try {
            await rpc("sihiri_save_board", {
              p_code: room.code, p_token: player.player_token,
              p_board_state: window.SihirliSayiGame.getState()
            });
            await maybeSubmitCompletion();
          } catch (e) {
            // A later board change or polling cycle retries.
          }
        }, 250);
      }
    };
  }
  window.addEventListener("beforeunload", () => {
    clearInterval(poller);
    if (countdownTicker) clearInterval(countdownTicker);
  });
})();