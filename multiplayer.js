/* Sihirli Sayılar multiplayer MVP. Configure Supabase in the panel, then use room code. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const panel = $("#multiplayerPanel");
  const statusEl = $("#mpStatus");
  const roomInfo = $("#mpRoomInfo");
  const roomCodeEl = $("#mpRoomCode");
  const playersEl = $("#mpPlayers");
  const resultsEl = $("#mpResults");
  let supabase = null, room = null, player = null, isHost = false, poller = null;
  let lastSolvedSent = false, onChangeQueued = false, scheduledStartFor = null;
  const KEY_CONFIG = "sihiri_supabase_config_v1";
  const KEY_PLAYER = "sihiri_player_token_v1";
  const token = () => {
    let t = sessionStorage.getItem(KEY_PLAYER);
    if (!t) { t = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`); sessionStorage.setItem(KEY_PLAYER,t); }
    return t;
  };
  const playerToken = token();
  const setStatus = (text, type="") => { statusEl.textContent=text; statusEl.className="mp-status "+type; };
  const config = () => {
    const saved = JSON.parse(localStorage.getItem(KEY_CONFIG) || "{}");
    return {url:($("#mpUrl").value.trim() || saved.url || ""), key:($("#mpKey").value.trim() || saved.key || "")};
  };
  function connect() {
    if (!window.supabase?.createClient) throw new Error("Supabase istemcisi yüklenemedi. İnternet bağlantısını kontrol edin.");
    const c = config();
    if (!c.url || !c.key) throw new Error("Önce Supabase Project URL ve anon/publishable key bilgilerini girin.");
    if (!/^https:\/\/[a-zA-Z0-9.-]+\.supabase\.co\/?$/.test(c.url)) throw new Error("Project URL biçimi hatalı. Örn. https://proje-id.supabase.co");
    supabase = window.supabase.createClient(c.url.replace(/\/$/,""),c.key,{auth:{persistSession:false,autoRefreshToken:false}});
    localStorage.setItem(KEY_CONFIG,JSON.stringify(c));
    return supabase;
  }
  async function rpc(name,args) {
    if (!supabase) connect();
    const {data,error}=await supabase.rpc(name,args);
    if(error) throw new Error(error.message);
    if(data?.error) throw new Error(data.error);
    return data;
  }
  function renderRoom(data) {
    if (!data) return;
    const r=data.room || data;
    room = r;
    roomCodeEl.textContent = r.code || "------";
    roomInfo.style.display="block";
    const ps=data.players || [];
    playersEl.replaceChildren();
    ps.forEach(p=>{
      const el=document.createElement("span");el.className="mp-player"+(p.player_id===player?.player_id?" me":"");
      el.textContent=(p.display_name||"Oyuncu")+(p.is_host?" · Sunucu":"")+(p.finished_at?" · Tamamladı":"");
      playersEl.appendChild(el);
    });
    resultsEl.replaceChildren();
    const promptEl=$("#mpRoundPrompt");
    if(r.status==="playing"){
      promptEl.style.display="block";
      promptEl.textContent="Herkes için ortak tur: Boş hücrenin numarasını bul. Süre: "+Math.round((r.duration_seconds||180)/60)+" dakika.";
      if(r.starts_at && scheduledStartFor!==r.starts_at){
        scheduledStartFor=r.starts_at;
        const delay=Math.max(0,new Date(r.starts_at).getTime()-Date.now());
        const startTimer=()=>{
          if(!room || room.code!==r.code || room.status!=="playing")return;
          if(window.SihirliSayiGame?.startMultiplayerTimer)
            window.SihirliSayiGame.startMultiplayerTimer(r.duration_seconds||180,new Date(r.starts_at).getTime());
        };
        if(delay>0)setTimeout(startTimer,delay);else startTimer();
      }
    } else { promptEl.style.display="none"; }
    const winner=data.winner || r.winner_name;
    if(winner){const el=document.createElement("div");el.className="mp-result";el.textContent=`🏆 Kazanan: ${winner}`;resultsEl.appendChild(el);}
    if(r.status==="playing"){
      const el=document.createElement("div");el.className="mp-result";
      const starts=r.starts_at ? new Date(r.starts_at).toLocaleTimeString("tr-TR") : "—";
      el.textContent=`Tur başladı · ${starts}`;resultsEl.appendChild(el);
    } else if(r.status==="finished"){
      const el=document.createElement("div");el.className="mp-result";el.textContent="Tur tamamlandı.";resultsEl.appendChild(el);
    }
    $("#mpStart").disabled=!(isHost && ps.length>=2 && r.status!=="playing");
    $("#mpLeave").disabled=false;
  }
  async function refresh() {
    if(!room || !player) return;
    try {
      const data=await rpc("sihiri_room_state",{p_code:room.code,p_token:player.player_token});
      renderRoom(data);
      if(data.room?.status==="playing" && !lastSolvedSent && window.SihirliSayiGame?.isSolved()){
        lastSolvedSent=true;
        const game=window.SihirliSayiGame.getState();
        await rpc("sihiri_submit_result",{p_code:room.code,p_token:player.player_token,p_answer:window.SihirliSayiGame.getAnswer(),p_board_state:game});
        await refresh();
      }
    } catch(e) { setStatus("Oda güncellemesi alınamadı: "+e.message,"error"); }
  }
  function beginPolling(){clearInterval(poller);refresh();poller=setInterval(refresh,1800);}
  function stopRoom(){clearInterval(poller);poller=null;scheduledStartFor=null;room=null;player=null;isHost=false;lastSolvedSent=false;roomInfo.style.display="none";$("#mpStart").disabled=true;$("#mpLeave").disabled=true;}
  $("#openMultiplayer").addEventListener("click",()=>{panel.classList.add("show");const c=JSON.parse(localStorage.getItem(KEY_CONFIG)||"{}");$("#mpUrl").value=c.url||"";$("#mpKey").value=c.key||"";});
  $("#closeMultiplayer").addEventListener("click",()=>panel.classList.remove("show"));
  $("#mpSaveConfig").addEventListener("click",()=>{
    try {const c=config();if(!c.url||!c.key)throw new Error("Project URL ve key alanlarını doldurun.");connect();setStatus("Bağlantı ayarları bu tarayıcıya kaydedildi. Veritabanı SQL dosyasının Supabase SQL Editor'de çalıştırıldığından emin olun.","success");}
    catch(e){setStatus(e.message,"error");}
  });
  $("#mpCreate").addEventListener("click",async()=>{
    try{
      const name=$("#mpName").value.trim()||"Oyuncu";
      const data=await rpc("sihiri_create_room",{p_name:name,p_token:playerToken});
      room=data.room;player=data.player;isHost=true;lastSolvedSent=false;
      renderRoom(data);setStatus("Oda oluşturuldu. Kodu arkadaşlarınla paylaş. En az iki oyuncu katıldığında turu başlatabilirsin.","success");beginPolling();
    }catch(e){setStatus("Oda oluşturulamadı: "+e.message,"error");}
  });
  $("#mpJoin").addEventListener("click",async()=>{
    try{
      const code=$("#mpJoinCode").value.trim().toUpperCase();
      if(!code)throw new Error("Katılmak için oda kodunu yazın.");
      const data=await rpc("sihiri_join_room",{p_code:code,p_name:$("#mpName").value.trim()||"Oyuncu",p_token:playerToken});
      room=data.room;player=data.player;isHost=false;lastSolvedSent=false;
      renderRoom(data);setStatus("Odaya katıldınız. Oda sahibinin turu başlatmasını bekleyin.","success");beginPolling();
    }catch(e){setStatus("Odaya katılınamadı: "+e.message,"error");}
  });
  $("#mpStart").addEventListener("click",async()=>{
    try{
      if(!room||!player||!isHost)throw new Error("Turu yalnızca oda sahibi başlatabilir.");
      const seconds=Number($("#mpDuration").value);
      const challenge={method:"random",display:"Boş hücrenin numarasını bul",answer:"board-derived"};
      const data=await rpc("sihiri_start_round",{p_code:room.code,p_token:player.player_token,p_duration:seconds,p_challenge:challenge});
      lastSolvedSent=false;renderRoom(data);setStatus("Tur başlatıldı. Her oyuncu kendi tahtasında çözüm yapar.","success");beginPolling();
    }catch(e){setStatus("Tur başlatılamadı: "+e.message,"error");}
  });
  $("#mpLeave").addEventListener("click",async()=>{
    try{if(room&&player)await rpc("sihiri_leave_room",{p_code:room.code,p_token:player.player_token});stopRoom();setStatus("Odadan ayrıldınız.");}
    catch(e){setStatus("Odadan ayrılma hatası: "+e.message,"error");}
  });
  $("#mpJoinCode").addEventListener("input",e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);});
  if(window.SihirliSayiGame){
    window.SihirliSayiGame.onChange=()=>{
      if(room && player && !onChangeQueued){
        onChangeQueued=true;
        setTimeout(async()=>{
          onChangeQueued=false;
          try{await rpc("sihiri_save_board",{p_code:room.code,p_token:player.player_token,p_board_state:window.SihirliSayiGame.getState()});}
          catch(e){/* board save can be retried on next move/poll */}
        },250);
      }
    };
  }
  window.addEventListener("beforeunload",()=>clearInterval(poller));
})();
