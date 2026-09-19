(function(){
  let socket=null;
  function backendUrl(){return String(window.MULTIPLAYER_URL||window.location.origin).replace(/\/$/,'');}
  function connect(token){
    if(socket){try{socket.disconnect()}catch{}};
    socket=window.io(backendUrl(),{auth:{token},transports:['websocket','polling']});
    window.GameRealtime={socket,on:(e,fn)=>socket.on(e,fn),emit:(e,p)=>socket.emit(e,p),disconnect:()=>socket.disconnect()};
    socket.on('connect',()=>window.dispatchEvent(new CustomEvent('21:socket-connected')));
    socket.on('connect_error',e=>window.dispatchEvent(new CustomEvent('21:socket-error',{detail:e?.message||'Falha no socket'})));
    return socket;
  }
  window.addEventListener('21:auth',e=>connect(e.detail.token));
})();
