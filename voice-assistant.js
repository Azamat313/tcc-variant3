/**
 * TCC Voice Assistant "Айша" — Gemini 2.5 Flash Native Audio
 * Optimized for speed: streaming playback, short prompt, fast VAD
 */
(function() {
  'use strict';

  const API_KEY = 'AIzaSyBxHoUTPAWV1wWiKGD9AMZil8J9Ag5aQII';
  const MODEL = 'gemini-2.5-flash-native-audio-latest';
  const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

  // Short, dense system prompt = faster inference
  const SYSTEM = `Ты Айша — голосовой гид и ассистент сайта TransCaspian Cargo. Русский язык. КРАТКО: 1-2 предложения.

КОМПАНИЯ:
• TCC — платформа экспертизы логистики Евразии. Атырау, Студенческий 52. Тел +77710544898. info@tc-cargo.kz. ПН-ПТ 9-18.
• Основатель: Рустем Бисалиев. Патент РК №11718 на LMS. Аккредитация CAAAE №25/26KA0006.
• 5 услуг: логистика, исследование и аналитика, профессиональное развитие, стратегический консалтинг, международные партнёрства.

СРЕДНИЙ КОРИДОР:
• ТМТМ: Китай→КЗ→Каспий→Азербайджан→Грузия→Европа. 6500км. 4.5млн т в 2024(+62%). 90637 TEU(+29%). 15-18 дней.
• Казахстан: 36.9млн т транзита 2025. Хоргос 372К TEU, обработка 1 час. Цель 2030: 74млн т.

КУРСЫ (3 штуки):
• "Логистика с нуля": онлайн, 7 модулей (введение, морская, сухопутная, Incoterms, склады, авиа, карьера), 24ч, 2мес. 200+ выпускников. tcchub.kz
• "Стратегическая навигация PRO": 72ч, 9 модулей, для руководителей. Управление рисками, цифровизация, международные стандарты.
• "BRI Logistics": 24ч, 7 модулей. Стандарты ADB, AIIB, EBRD, OECD. Для аналитиков, госструктур, доноров.
• Платформа TCC HUB: tcchub.kz, Moodle LMS, 9 курсов, 5 потоков.

СТРАНИЦЫ САЙТА (для навигации):
• index.html — Главная: глобус, live новости, статистика, эксперты
• about.html — О платформе: история TCC, миссия, команда, timeline
• analytics.html — Аналитика: 8 статей (ТМТМ, санкции, BRI, INSTC, Казахстан)
• solutions.html — Решения: 5 услуг (логистика, аналитика, развитие, консалтинг, партнёрства)
• education.html — Обучение: 3 курса, модули, эксперты, TCC HUB, сертификаты
• projects.html — Проекты: ТМТМ, CILT KZ, TCC HUB, исследования
• media.html — Медиа: статьи, интервью, события (New Vision Forum, Baku Energy Week)
• partners.html — Партнёры: CILT KZ, ALT University, TITR, EBRD
• contacts.html — Контакты: форма, адрес, телефон, соцсети
• wiki.html — WikiЛогист: 270+ терминов, законы РК, документы (CMR, SMGS, AWB), конвенции, ресурсы
• corridor.html — Исследователь маршрутов: интерактивный глобус, суда, самолёты, данные
• live-data.html — Live данные: OpenSky авиатрафик, World Bank LPI, RSS новости

ФУНКЦИИ:
• Когда просят ПОКАЗАТЬ раздел → вызови navigate с нужной страницей
• Когда просят ТУР или ЭКСКУРСИЮ → вызови start_tour
• Когда просят ЗАПИСАТЬСЯ на курс → open_link https://tcchub.kz
• Когда просят НАПИСАТЬ или СВЯЗАТЬСЯ → open_link https://wa.link/wrcagw
• Когда просят НАЙТИ ТЕРМИН → open_link wiki.html
• Когда говорят МАРШРУТЫ или КОРИДОР → open_link corridor.html

ТУР: Если просят тур — вызови start_tour. Ты будешь рассказывать о каждом разделе по очереди, а функция будет переключать страницы. Порядок тура: главная → о нас → аналитика → решения → обучение → маршруты → вики → контакты.`;

  const TOOLS = [{
    functionDeclarations: [
      {
        name: 'navigate',
        description: 'Перейти к разделу сайта. Вызывай когда говорят: покажи, перейди, открой, где найти.',
        parameters: {
          type: 'OBJECT',
          properties: {
            section: {
              type: 'STRING',
              enum: ['main','about','analytics','solutions','education','platform','projects','media','resources','partners','contacts'],
              description: 'ID секции'
            }
          },
          required: ['section']
        }
      },
      {
        name: 'open_link',
        description: 'Открыть внешнюю ссылку: WhatsApp, tcchub.kz, соцсети, 2gis.',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'URL' }
          },
          required: ['url']
        }
      },
      {
        name: 'scroll_to_top',
        description: 'Прокрутить страницу наверх. Когда говорят: наверх, в начало, домой.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'highlight_element',
        description: 'Подсветить элемент на странице по CSS селектору.',
        parameters: {
          type: 'OBJECT',
          properties: {
            selector: { type: 'STRING', description: 'CSS selector' }
          },
          required: ['selector']
        }
      },
      {
        name: 'start_tour',
        description: 'Начать экскурсию/тур по сайту. Вызывай когда говорят: тур, экскурсия, покажи всё, проведи по сайту.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'go_to_page',
        description: 'Перейти на другую страницу сайта.',
        parameters: {
          type: 'OBJECT',
          properties: {
            page: { type: 'STRING', description: 'Filename: index.html, about.html, analytics.html, solutions.html, education.html, corridor.html, wiki.html, contacts.html, projects.html, media.html, partners.html, live-data.html' }
          },
          required: ['page']
        }
      }
    ]
  }];

  // ===== STATE =====
  let ws = null, micStream = null, micCtx = null, playCtx = null, scriptNode = null;
  let isConnected = false, state = 'idle';
  let playQueue = [], isPlaying = false, currentSource = null;

  // ===== AUDIO HELPERS =====
  function pcm16b64ToF32(b64) {
    const raw = atob(b64);
    const len = raw.length / 2;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let v = raw.charCodeAt(i*2) | (raw.charCodeAt(i*2+1) << 8);
      if (v >= 0x8000) v -= 0x10000;
      out[i] = v / 32768;
    }
    return out;
  }

  function f32ToPcm16b64(f32) {
    const buf = new ArrayBuffer(f32.length * 2);
    const dv = new DataView(buf);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      dv.setInt16(i*2, s * (s < 0 ? 0x8000 : 0x7FFF), true);
    }
    const u8 = new Uint8Array(buf);
    let b = '';
    for (let i = 0; i < u8.length; i += 8192)
      b += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(b);
  }

  function downsample(f32, from, to) {
    if (from === to) return f32;
    const r = from / to;
    const out = new Float32Array(Math.floor(f32.length / r));
    for (let i = 0; i < out.length; i++) out[i] = f32[Math.floor(i * r)];
    return out;
  }

  // ===== STREAMING PLAYBACK — play chunks immediately =====
  function ensurePlayCtx() {
    if (!playCtx || playCtx.state === 'closed') playCtx = new AudioContext({ sampleRate: 24000 });
    if (playCtx.state === 'suspended') playCtx.resume();
    return playCtx;
  }

  let nextPlayTime = 0;

  function playChunkImmediate(b64) {
    const ctx = ensurePlayCtx();
    const f32 = pcm16b64ToF32(b64);
    if (f32.length === 0) return;

    const ab = ctx.createBuffer(1, f32.length, 24000);
    ab.getChannelData(0).set(f32);
    const src = ctx.createBufferSource();
    src.buffer = ab;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    src.start(nextPlayTime);
    nextPlayTime += ab.duration;
    currentSource = src;

    if (state !== 'speaking') setState('speaking');
  }

  function stopPlayback() {
    nextPlayTime = 0;
    if (playCtx) {
      playCtx.close().catch(()=>{});
      playCtx = null;
    }
    currentSource = null;
  }

  // ===== WEBSOCKET =====
  async function connect() {
    setState('connecting');

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch(e) {
      setState('error'); showStatus('Микрофон недоступен', 4000); return;
    }

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: `models/${MODEL}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } }
          },
          systemInstruction: { parts: [{ text: SYSTEM }] },
          tools: TOOLS,
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_OF_SPEECH_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_OF_SPEECH_SENSITIVITY_HIGH',
              prefixPaddingMs: 200,
              silenceDurationMs: 500
            }
          }
        }
      }));
    };

    ws.onmessage = async (evt) => {
      let msg;
      try {
        const text = evt.data instanceof Blob ? await evt.data.text() : evt.data;
        msg = JSON.parse(text);
      } catch(e) { return; }

      if (msg.setupComplete) {
        isConnected = true;
        startMic();
        setState('ready');
        // Quick greeting
        setTimeout(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              clientContent: {
                turns: [{ role: 'user', parts: [{ text: 'Поприветствуй одним коротким предложением' }] }],
                turnComplete: true
              }
            }));
          }
        }, 300);
        return;
      }

      // Audio response — STREAM immediately, don't buffer
      if (msg.serverContent) {
        const parts = msg.serverContent.modelTurn?.parts || [];
        for (const p of parts) {
          if (p.inlineData?.data) {
            playChunkImmediate(p.inlineData.data);
          }
        }
        if (msg.serverContent.turnComplete) {
          // Schedule state change after audio finishes
          const ctx = playCtx;
          if (ctx && nextPlayTime > ctx.currentTime) {
            const delay = (nextPlayTime - ctx.currentTime) * 1000 + 200;
            setTimeout(() => { if (state === 'speaking') setState('ready'); }, delay);
          } else {
            setState('ready');
          }
        }
        if (msg.serverContent.interrupted) {
          stopPlayback();
          setState('listening');
        }
      }

      // Tool calls
      if (msg.toolCall) {
        for (const call of (msg.toolCall.functionCalls || [])) {
          const a = call.args || {};

          if (call.name === 'navigate' && a.section) {
            const el = document.querySelector('#' + a.section.replace('#',''));
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              el.style.transition = 'box-shadow .5s';
              el.style.boxShadow = '0 0 0 4px rgba(198,164,109,.3)';
              setTimeout(() => el.style.boxShadow = '', 2500);
            }
          }
          if (call.name === 'open_link' && a.url) {
            setTimeout(() => window.open(a.url, '_blank'), 500);
          }
          if (call.name === 'scroll_to_top') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
          if (call.name === 'highlight_element' && a.selector) {
            const el = document.querySelector(a.selector);
            if (el) {
              el.style.transition = 'outline .3s';
              el.style.outline = '3px solid #C6A46D';
              el.style.outlineOffset = '4px';
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 3000);
            }
          }
          if (call.name === 'go_to_page' && a.page) {
            setTimeout(() => { window.location.href = a.page; }, 1500);
          }
          if (call.name === 'start_tour') {
            startGuidedTour();
          }

          ws.send(JSON.stringify({
            toolResponse: { functionResponses: [{ id: call.id, name: call.name, response: { result: { success: true } } }] }
          }));
        }
      }
    };

    ws.onerror = () => { setState('error'); showStatus('Ошибка соединения', 4000); };
    ws.onclose = (e) => {
      console.log('[Айша] closed', e.code, e.reason);
      isConnected = false; stopMic();
      if (state !== 'idle') setState('idle');
    };
  }

  // ===== MICROPHONE =====
  function startMic() {
    if (!micStream || !ws) return;
    micCtx = new AudioContext();
    const src = micCtx.createMediaStreamSource(micStream);
    const buf = 2048; // smaller buffer = lower latency
    scriptNode = micCtx.createScriptProcessor(buf, 1, 1);

    scriptNode.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || !isConnected) return;
      const raw = e.inputBuffer.getChannelData(0);
      const down = downsample(new Float32Array(raw), micCtx.sampleRate, 16000);
      try {
        ws.send(JSON.stringify({
          realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: f32ToPcm16b64(down) }] }
        }));
      } catch(e) {}
    };

    src.connect(scriptNode);
    const mute = micCtx.createGain();
    mute.gain.value = 0;
    scriptNode.connect(mute);
    mute.connect(micCtx.destination);
  }

  function stopMic() {
    if (scriptNode) { scriptNode.disconnect(); scriptNode = null; }
    if (micCtx) { micCtx.close().catch(()=>{}); micCtx = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  }

  // ===== UI =====
  function injectCSS() {
    const s = document.createElement('style');
    s.textContent = `
      #tcc-va{position:fixed;bottom:28px;right:28px;z-index:9999;font-family:'Montserrat',system-ui,sans-serif;display:flex;flex-direction:column;align-items:flex-end;gap:12px}
      #tcc-va-btn{width:68px;height:68px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .35s;position:relative;outline:none}
      #tcc-va-btn:hover{transform:scale(1.06)}
      #tcc-va-btn.idle{background:linear-gradient(135deg,#C6A46D,#A38450);box-shadow:0 4px 24px rgba(198,164,109,.4)}
      #tcc-va-btn.connecting{background:linear-gradient(135deg,#C6A46D,#A38450);box-shadow:0 4px 24px rgba(198,164,109,.4)}
      #tcc-va-btn.ready{background:linear-gradient(135deg,#C6A46D,#A38450);box-shadow:0 6px 28px rgba(198,164,109,.5)}
      #tcc-va-btn.listening{background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 4px 28px rgba(239,68,68,.4)}
      #tcc-va-btn.processing{background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 4px 28px rgba(245,158,11,.4)}
      #tcc-va-btn.speaking{background:linear-gradient(135deg,#22c55e,#16a34a);box-shadow:0 4px 28px rgba(34,197,94,.4)}
      #tcc-va-btn.error{background:linear-gradient(135deg,#888,#666);box-shadow:0 4px 20px rgba(0,0,0,.15)}
      #tcc-va-btn .rng{position:absolute;inset:-6px;border-radius:50%;opacity:0;transition:opacity .3s}
      #tcc-va-btn.ready .rng{border:2px solid rgba(198,164,109,.15);animation:tR 3s infinite;opacity:1}
      #tcc-va-btn.listening .rng{border:2px solid rgba(239,68,68,.2);animation:tR 1.5s infinite;opacity:1}
      #tcc-va-btn.speaking .rng{border:2px solid rgba(34,197,94,.2);animation:tR 2s infinite;opacity:1}
      @keyframes tR{0%{transform:scale(1);opacity:.5}100%{transform:scale(1.6);opacity:0}}
      #tcc-va-btn svg.mic{width:28px;height:28px;color:#fff;transition:all .3s}
      #tcc-va-btn.listening svg.mic,#tcc-va-btn.speaking svg.mic,#tcc-va-btn.connecting svg.mic{display:none}
      #tcc-wv{display:none;align-items:center;gap:3px;height:32px}
      #tcc-va-btn.listening #tcc-wv,#tcc-va-btn.speaking #tcc-wv{display:flex}
      #tcc-wv span{width:3.5px;border-radius:2px;background:#fff}
      #tcc-wv span:nth-child(1){height:8px;animation:tW 1s infinite 0s}
      #tcc-wv span:nth-child(2){height:14px;animation:tW 1s infinite .12s}
      #tcc-wv span:nth-child(3){height:22px;animation:tW 1s infinite .24s}
      #tcc-wv span:nth-child(4){height:14px;animation:tW 1s infinite .36s}
      #tcc-wv span:nth-child(5){height:8px;animation:tW 1s infinite .48s}
      @keyframes tW{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
      #tcc-sp{display:none;width:28px;height:28px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:tSp .7s linear infinite}
      #tcc-va-btn.connecting #tcc-sp{display:block}
      @keyframes tSp{to{transform:rotate(360deg)}}
      #tcc-st{background:#fff;border:1px solid rgba(0,0,0,.07);border-radius:14px;padding:12px 18px;box-shadow:0 4px 24px rgba(0,0,0,.07);max-width:340px;font-size:13px;color:#333;line-height:1.5;opacity:0;transform:translateY(8px) scale(.95);transition:all .3s;pointer-events:none}
      #tcc-st.show{opacity:1;transform:translateY(0) scale(1)}
      #tcc-st .lb{font-size:10px;font-weight:700;color:#C6A46D;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}
      #tcc-tp{position:absolute;right:76px;bottom:20px;background:#1a1a1a;color:#fff;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:500;white-space:nowrap;opacity:0;transform:translateX(8px);transition:all .3s;pointer-events:none}
      #tcc-tp::after{content:'';position:absolute;right:-6px;top:50%;transform:translateY(-50%);border:6px solid transparent;border-left-color:#1a1a1a}
      #tcc-va-btn.idle:hover #tcc-tp{opacity:1;transform:translateX(0)}
      #tcc-pm{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center}
      #tcc-pm.show{display:flex}
      #tcc-pm>div{background:#fff;border-radius:20px;padding:40px;text-align:center;max-width:400px;box-shadow:0 24px 64px rgba(0,0,0,.15)}
      #tcc-pm .ic{width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,rgba(198,164,109,.12),rgba(198,164,109,.04));display:flex;align-items:center;justify-content:center;margin:0 auto 20px;color:#C6A46D}
      #tcc-pm .ic svg{width:32px;height:32px}
      #tcc-pm h3{font-size:20px;font-weight:800;margin-bottom:8px}
      #tcc-pm p{font-size:14px;color:#666;line-height:1.6;margin-bottom:24px}
      #tcc-pm .nm{font-size:12px;color:#C6A46D;font-weight:600;margin-bottom:4px}
      .tb{padding:14px 36px;border-radius:24px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;border:none;transition:all .25s}
      .tb-y{background:#C6A46D;color:#fff;margin-right:10px}.tb-y:hover{background:#A38450;transform:translateY(-1px);box-shadow:0 4px 16px rgba(198,164,109,.3)}
      .tb-n{background:#f3f3f3;color:#888}.tb-n:hover{background:#eee}
      @media(max-width:640px){#tcc-va{bottom:12px;right:12px}#tcc-va-btn{width:48px;height:48px}#tcc-va-btn svg{width:22px;height:22px}#tcc-st{max-width:220px;font-size:11px;right:12px}#tcc-pm>div{margin:0 12px;padding:24px}#tcc-va .rng{display:none}}
    `;
    document.head.appendChild(s);
  }

  const MIC_SVG = '<svg class="mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';

  function createUI() {
    const d = document.createElement('div'); d.id = 'tcc-va';
    d.innerHTML = `<div id="tcc-st"><div class="lb">Айша · TCC</div><div id="tcc-tx"></div></div><button id="tcc-va-btn" class="idle"><div class="rng"></div><div id="tcc-sp"></div><div id="tcc-wv"><span></span><span></span><span></span><span></span><span></span></div>${MIC_SVG}<div id="tcc-tp">Голосовой помощник Айша</div></button>`;
    document.body.appendChild(d);
    const p = document.createElement('div'); p.id = 'tcc-pm';
    p.innerHTML = `<div><div class="ic">${MIC_SVG.replace('class="mic"','')}</div><div class="nm">АЙША</div><h3>Голосовой помощник TCC</h3><p>Разрешите микрофон для голосового общения. Айша расскажет о компании, курсах и покажет нужный раздел.</p><button class="tb tb-y" id="tcc-y">Начать разговор</button><button class="tb tb-n" id="tcc-n">Не сейчас</button></div>`;
    document.body.appendChild(p);
  }

  function setState(s) {
    state = s;
    document.getElementById('tcc-va-btn').className = s;
    const st = document.getElementById('tcc-st');
    const tx = document.getElementById('tcc-tx');
    const m = {idle:'',connecting:'Подключаюсь...',ready:'Говорите — слушаю',listening:'Слушаю...',processing:'Думаю...',speaking:'Отвечаю...',error:'Ошибка'};
    tx.textContent = m[s]||'';
    s === 'idle' ? st.classList.remove('show') : st.classList.add('show');
  }

  function showStatus(t, d) {
    document.getElementById('tcc-tx').textContent = t;
    document.getElementById('tcc-st').classList.add('show');
    if (d) setTimeout(() => document.getElementById('tcc-st').classList.remove('show'), d);
  }

  let started = false;
  function handleClick() {
    if (state === 'speaking') { stopPlayback(); setState('ready'); return; }
    if (isConnected && state === 'ready') { showStatus('Говорите, Айша слушает', 2500); return; }
    if (!started) {
      started = true;
      document.getElementById('tcc-pm').classList.add('show');
      document.getElementById('tcc-y').onclick = () => { document.getElementById('tcc-pm').classList.remove('show'); connect(); };
      document.getElementById('tcc-n').onclick = () => { document.getElementById('tcc-pm').classList.remove('show'); started = false; };
      return;
    }
    if (!isConnected) connect();
  }

  function init() { injectCSS(); createUI(); document.getElementById('tcc-va-btn').addEventListener('click', handleClick); }
  // ===== GUIDED TOUR =====
  const tourSteps = [
    { page: 'index.html', text: 'Это главная страница TransCaspian Cargo. Здесь глобус с маршрутом Среднего коридора, живые новости логистики и ключевая статистика.' },
    { page: 'about.html', text: 'Страница О нас. Здесь история компании, миссия, наша команда экспертов и timeline развития TCC.' },
    { page: 'analytics.html', text: 'Аналитика и исследования. 8 экспертных статей с реальными данными: Средний коридор, санкции, BRI, контейнерный рынок.' },
    { page: 'solutions.html', text: 'Решения для бизнеса. 5 услуг: логистика, исследования, профессиональное развитие, стратегический консалтинг, международные партнёрства.' },
    { page: 'education.html', text: 'Образование. 3 курса: Логистика с нуля, Стратегическая навигация PRO на 72 часа, и BRI Logistics. Платформа TCC HUB.' },
    { page: 'corridor.html', text: 'Исследователь маршрутов. Интерактивный глобус с реальными данными: самолёты, суда, маршруты Среднего коридора.' },
    { page: 'wiki.html', text: 'WikiЛогист. Энциклопедия с 270 терминами, законами Казахстана, документами, международными конвенциями.' },
    { page: 'contacts.html', text: 'Контакты. Форма обратной связи, адрес в Атырау, телефон и социальные сети.' },
  ];
  let tourActive = false;
  let tourStep = 0;

  function startGuidedTour() {
    tourActive = true;
    tourStep = 0;
    // Find current page
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const currentIdx = tourSteps.findIndex(s => s.page === currentPage);
    if (currentIdx >= 0) tourStep = currentIdx;
    showStatus('Тур начался! Айша проведёт вас по сайту.', 3000);
  }

  // Tour can be continued by AI calling go_to_page for each step

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
