(function(){
  window.BettingUI={
    render(target, state, emit, label='Aposta'){
      if(state?.noBet) return `<div class="card"><span class="tag">SEM APOSTA</span><p class="muted">Este desafio usa somente o objetivo de vitórias.</p></div>`;
      const bal=Number(state?.balance||0);
      return `<div class="betbox"><div class="eyebrow">${label}</div><div style="display:grid;grid-template-columns:1fr 130px;gap:8px"><input id="betAmount" class="input" type="number" min="10" step="10" value="${Math.min(100,Math.max(10,bal||10))}" ${bal<10?'disabled':''}><button class="primary" id="confirmBet" ${bal<10?'disabled':''}>Confirmar</button></div><div class="preset-row"><button data-bet="10">10</button><button data-bet="25">25</button><button data-bet="50">50</button><button data-bet="100">100</button><button data-bet="250">250</button></div></div>`;
    },
    bind(prefix, emit, eventName){
      const input=document.getElementById('betAmount'); const btn=document.getElementById('confirmBet');
      document.querySelectorAll('[data-bet]').forEach(b=>b.onclick=()=>{input.value=Math.min(Number(b.dataset.bet),999999)});
      if(btn) btn.onclick=()=>emit(eventName,{amount:Number(input.value)});
    }
  };
})();
