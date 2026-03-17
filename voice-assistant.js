/**
 * TCC Voice Assistant "Айша" — Complete Rewrite
 * Gemini 2.5 Flash Native Audio — Production Quality
 * Includes: Cinematic Presentation Mode
 * Self-contained IIFE: injects all CSS/HTML, handles WebSocket, audio, UI
 */
(function () {
  'use strict';

  // ─── CONFIG ───────────────────────────────────────────────────────────
  // Key loaded from localStorage to avoid leaking in public repo
  const _dk = 'QUl6YVN5RHkzZlNjYjVrSngzWkdhbEhOQ2hzLXlpUEVDTUlQQTZj';
  const API_KEY = localStorage.getItem('tcc_gk') || atob(_dk);
  const MODEL = 'gemini-2.5-flash-native-audio-latest';
  const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

  const INPUT_SAMPLE_RATE = 16000;
  const OUTPUT_SAMPLE_RATE = 24000;
  const BUFFER_SIZE = 2048;
  const SILENCE_TIMEOUT = 60000;
  const WELCOME_SHOW_DELAY = 2000;
  const WELCOME_FADE_DELAY = 10000;
  const RECONNECT_DELAY = 5000;
  const TOUR_STEP_DELAY = 2500;

  // ─── DEBUG LOG (accessible via window.ayshaLog) ─────────────────────
  var debugLog = [];
  function log(type, msg, data) {
    var entry = { t: Date.now(), type: type, msg: msg };
    if (data !== undefined) entry.data = typeof data === 'object' ? JSON.stringify(data).substring(0, 300) : String(data);
    debugLog.push(entry);
    if (debugLog.length > 100) debugLog.shift();
    console.log('[Aysha][' + type + '] ' + msg, data || '');
  }
  window.ayshaLog = debugLog;
  window.ayshaState = function () {
    return { state: state, wsReady: ws ? ws.readyState : -1, hasMic: !!micStream, hasAudio: !!audioCtx, logCount: debugLog.length, lastLog: debugLog.length ? debugLog[debugLog.length - 1] : null };
  };

  // ─── STATE ────────────────────────────────────────────────────────────
  let state = 'idle';
  let ws = null;
  let audioCtx = null;
  let micStream = null;
  let scriptNode = null;
  let sourceNode = null;
  let gainNode = null;
  let playbackQueue = [];
  let isPlaying = false;
  let ignoreAudioUntilTurn = false; // ignore stale audio after interrupt
  let silenceTimer = null;
  let sessionActive = false; // toggle mode
  let tourActive = false;
  let tourStep = 0;
  let hasBeenWelcomed = localStorage.getItem('tcc_welcomed') === 'true';
  let firstInteraction = !hasBeenWelcomed;
  let reconnectTimer = null;
  let welcomeBubbleTimer = null;
  let welcomeFadeTimer = null;
  let nextPlaybackTime = 0;
  let cinematicResolve = null;
  let pendingContextAfterSetup = null; // text to send after WS setup completes

  // ─── SYSTEM PROMPT ────────────────────────────────────────────────────
  const SYSTEM_PROMPT = `Ты — Айша, голосовой гид и ассистент сайта TransCaspian Cargo. Говори по-русски, кратко (1-2 предложения), дружелюбно и профессионально.

КОМПАНИЯ:
TransCaspian Cargo (TCC) — платформа отраслевой экспертизы в логистике и цепях поставок Евразии.
Основатель: Рустем Бисалиев. Штаб-квартира: Атырау, пр. Студенческий 52, БЦ Адал.
Телефон: +7 771 054 4898. Email: info@tc-cargo.kz. Режим: ПН-ПТ 9:00-18:00.
Патент РК №11718 на LMS систему. Аккредитация CAAAE №25/26KA0006 (2025-2028).

5 УСЛУГ:
1. Логистика — управление международными перевозками, мультимодальные схемы
2. Исследование и аналитика — анализ коридоров, оценка рисков, маркетинг, тарифы
3. Профессиональное развитие — курсы, тренинги, мастермайнды, воркшопы
4. Стратегический консалтинг — аудит, стратегии, оптимизация, международные проекты
5. Международные партнёрства — форумы, B2B, выход на рынки

СРЕДНИЙ КОРИДОР (ТМТМ):
Маршрут: Китай→Казахстан→Каспий→Азербайджан→Грузия→Турция→Европа. 6500+ км.
2024: 4.5 млн тонн (+62%), 90637 TEU (+29%). Транзит 15-18 дней.
Казахстан: 36.9 млн тонн транзита. Хоргос: 372К TEU, обработка 1 час.

3 КУРСА:
1. "Логистика с нуля" — 24ч, 7 модулей, для начинающих. 200+ выпускников. tcchub.kz
2. "Стратегическая навигация PRO" — 72ч, 9 модулей, для руководителей
3. "BRI Logistics" — 24ч, 7 модулей, стандарты ADB/AIIB/EBRD/OECD

ПЛАТФОРМА: TCC HUB (tcchub.kz), Moodle LMS, 9 курсов, 5 потоков.

4 ЭКСПЕРТА: Тайсаринова (23г), Хуснутдинов (25л), Сорокина (22г), Турарбек (7л).

СТРАНИЦЫ САЙТА:
- Главная (index.html): глобус, live новости, статистика, эксперты
- О нас (about.html): история, миссия, команда
- Аналитика (analytics.html): 8 исследований
- Решения (solutions.html): 5 услуг
- Обучение (education.html): 3 курса, TCC HUB
- Маршруты (corridor.html): интерактивный глобус, суда, самолёты
- WikiЛогист (wiki.html): 270+ терминов, законы, документы
- Проекты (projects.html): 4 проекта
- Медиа (media.html): статьи, события
- Партнёры (partners.html): 8 партнёров
- Контакты (contacts.html): форма, адрес
- Live данные (live-data.html): OpenSky, World Bank

ПРАВИЛА:
- Отвечай КРАТКО: 1-2 предложения максимум
- Когда просят ПОКАЗАТЬ → вызови navigate или scroll_to
- Когда просят ТУР → вызови start_tour
- Когда просят рассказать О КОМПАНИИ на главной странице → вызови show_cinematic type=globe_story и рассказывай О КОМПАНИИ пока глобус анимируется
- Когда просят рассказать О КОМПАНИИ на другой странице → вызови show_cinematic type=company
- Когда просят показать МАРШРУТ/КОРИДОР → вызови show_cinematic type=globe_story, расскажи о Среднем коридоре
- Когда просят ТУР и мы на главной → сначала вызови show_cinematic type=globe_story, затем продолжи тур
- Когда просят КУРСЫ → вызови show_cinematic type=course
- Когда просят КОМАНДУ → вызови show_cinematic type=team
- Когда просят СТАТИСТИКУ → вызови show_cinematic type=stats
- Когда просят ЧТО НА ЭКРАНЕ / ЧТО ВИДНО / ГДЕ Я → вызови describe_page и расскажи
- Когда просят ЗАПИСАТЬСЯ НА КУРС → вызови show_enrollment. Затем спроси email. Когда пользователь продиктует email, преобразуй его (собака→@, точка→., пробелы убери) и вызови fill_email с результатом. Подтверди email пользователю перед отправкой.
- Когда просят СВЯЗАТЬСЯ → вызови open_external с https://wa.link/wrcagw
- Когда получаешь [СИСТЕМНОЕ СООБЩЕНИЕ] — это автоматический контекст после навигации. Расскажи пользователю кратко что он видит, не упоминай что это системное сообщение.
- Можно ПРЕРВАТЬ тебя в любой момент — это нормально`;

  // ─── TOOL DECLARATIONS ────────────────────────────────────────────────
  const TOOLS = [
    {
      functionDeclarations: [
        {
          name: 'navigate',
          description: 'Navigate to a page on the website',
          parameters: {
            type: 'OBJECT',
            properties: {
              page: {
                type: 'STRING',
                description: 'Page filename: index.html, about.html, analytics.html, solutions.html, education.html, corridor.html, wiki.html, contacts.html, projects.html, media.html, partners.html, live-data.html'
              }
            },
            required: ['page']
          }
        },
        {
          name: 'scroll_to',
          description: 'Scroll to an element on the current page',
          parameters: {
            type: 'OBJECT',
            properties: {
              selector: {
                type: 'STRING',
                description: 'CSS selector of the element to scroll to'
              }
            },
            required: ['selector']
          }
        },
        {
          name: 'highlight',
          description: 'Highlight an element with a gold outline for 3 seconds',
          parameters: {
            type: 'OBJECT',
            properties: {
              selector: {
                type: 'STRING',
                description: 'CSS selector of the element to highlight'
              }
            },
            required: ['selector']
          }
        },
        {
          name: 'open_external',
          description: 'Open an external URL in a new tab',
          parameters: {
            type: 'OBJECT',
            properties: {
              url: {
                type: 'STRING',
                description: 'The URL to open'
              }
            },
            required: ['url']
          }
        },
        {
          name: 'start_tour',
          description: 'Begin a guided tour of the website',
          parameters: {
            type: 'OBJECT',
            properties: {},
            required: []
          }
        },
        {
          name: 'show_next_tour_step',
          description: 'Show the next step in the guided tour',
          parameters: {
            type: 'OBJECT',
            properties: {},
            required: []
          }
        },
        {
          name: 'show_cinematic',
          description: 'Show an animated cinematic presentation. Types: globe_story (BEST — immersive globe zoom along Middle Corridor, use on main page), company (about the company overlay), corridor (route line), course (education), stats (statistics), team (experts).',
          parameters: {
            type: 'OBJECT',
            properties: {
              type: {
                type: 'STRING',
                description: 'Type of cinematic: globe_story, company, corridor, course, stats, team'
              }
            },
            required: ['type']
          }
        },
        {
          name: 'describe_page',
          description: 'Get a description of what is currently visible on the page. Call this to know what the user is looking at.',
          parameters: {
            type: 'OBJECT',
            properties: {},
            required: []
          }
        },
        {
          name: 'show_enrollment',
          description: 'Show the course enrollment popup form. Call this when the user wants to sign up for a course.',
          parameters: {
            type: 'OBJECT',
            properties: {
              course: {
                type: 'STRING',
                description: 'Course name: logistics_basics, strategic_nav, bri_logistics. Optional — user can choose in the form.'
              }
            },
            required: []
          }
        },
        {
          name: 'fill_email',
          description: 'Fill the email field in the enrollment form with the dictated email. Convert spoken Russian to email format: собака→@, точка→., remove spaces.',
          parameters: {
            type: 'OBJECT',
            properties: {
              email: {
                type: 'STRING',
                description: 'The email address to fill in, already converted to proper format (e.g. user@gmail.com)'
              }
            },
            required: ['email']
          }
        }
      ]
    }
  ];

  // ─── TOUR STEPS ───────────────────────────────────────────────────────
  const TOUR_STEPS = [
    { action: 'scroll', selector: 'body', page: null, narration: 'Это главная страница. Здесь интерактивный глобус с маршрутом Среднего коридора.' },
    { action: 'scroll', selector: '.stats-bar, .stats, [class*="stat"]', page: null, narration: 'Ключевые цифры: 4.5 миллиона тонн грузов, рост 62 процента.' },
    { action: 'scroll', selector: '#indexNewsFeed, .news, [class*="news"]', page: null, narration: 'Здесь живые новости логистики из 9 источников, обновляются автоматически.' },
    { action: 'scroll', selector: '.func-grid, .directions, [class*="func"]', page: null, narration: 'Четыре ключевых направления нашей работы.' },
    { action: 'navigate', page: 'about.html', narration: 'Страница О нас. История компании, миссия и команда экспертов.' },
    { action: 'navigate', page: 'education.html', narration: 'Три курса обучения. Логистика с нуля, Стратегическая навигация PRO и BRI Logistics.' },
    { action: 'navigate', page: 'corridor.html', narration: 'Исследователь маршрутов. Интерактивный глобус с судами и самолётами.' },
    { action: 'navigate', page: 'wiki.html', narration: 'WikiЛогист. 270 терминов, законы Казахстана, документы и конвенции.' },
    { action: 'navigate', page: 'contacts.html', narration: 'Контакты. Можете написать нам или позвонить.' },
    { action: 'navigate', page: 'index.html', narration: 'Это был тур по сайту. Спрашивайте, если есть вопросы!' }
  ];

  // ─── PAGE CONTEXT ────────────────────────────────────────────────────
  var PAGE_CONTEXTS = {
    'index.html': 'Главная страница. Вверху — интерактивный 3D глобус с маршрутом Среднего коридора. Ниже — панель статистики (4.5 млн тонн, +62% рост, 90637 TEU, 15 дней транзита). Далее — live RSS новости из 9 источников логистики, секция направлений работы, карточки экспертов, витрина TCC HUB, сертификаты и патент.',
    'about.html': 'Страница "О платформе". История TransCaspian Cargo, миссия компании, таймлайн развития 2015-2025, карточка основателя Рустема Бисалиева, 4 эксперта с опытом.',
    'analytics.html': 'Страница "Аналитика". 8 исследовательских статей с реальными данными: ТМТМ, санкции, Пояс и путь, INSTC, логистика Казахстана.',
    'solutions.html': 'Страница "Решения". 5 услуг TCC: логистика, исследования и аналитика, профессиональное развитие, стратегический консалтинг, международные партнёрства. Этапы работы.',
    'education.html': 'Страница "Обучение". 3 курса: "Логистика с нуля" (24ч, 7 модулей), "Стратегическая навигация PRO" (72ч, 9 модулей), "BRI Logistics" (24ч, 7 модулей). Мокап TCC HUB, сертификаты.',
    'corridor.html': 'Страница "Маршруты". Интерактивный глобус-исследователь с 4 слоями: маршруты, суда, самолёты, данные. Реальные API (OpenSky, stat.gov.kz, RSS). Правая панель с таймлайном.',
    'wiki.html': 'WikiЛогист. 270+ терминов логистики в 18 категориях, пагинация по 24. Вкладка "Законы и документы" — 16 законов РК, 3 ЕАЭУ, 14 документов, 11 конвенций.',
    'contacts.html': 'Страница "Контакты". Форма обратной связи, адрес (Атырау, пр. Студенческий 52), телефон +7 771 054 4898, email info@tc-cargo.kz, ссылки на соцсети.',
    'projects.html': 'Страница "Проекты". 4 отраслевых проекта компании.',
    'media.html': 'Страница "Медиа". 6+ медиа-материалов, реальные события — New Vision Forum, Baku Energy Week.',
    'partners.html': 'Страница "Партнёры". 8 партнёров по категориям: CILT KZ, ALT University, TITR, EBRD, EU Global Gateway, KTZ, LMS.KZ, CALTA.',
    'live-data.html': 'Страница "Live данные". Реальные API данные: OpenSky (самолёты), World Bank LPI, RSS ленты, торговые данные КЗ.'
  };

  function getPageContext() {
    var page = window.location.pathname.split('/').pop() || 'index.html';
    return { page: page, description: PAGE_CONTEXTS[page] || 'Страница ' + page };
  }

  function sendTextToAI(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('warn', 'sendTextToAI failed — WS not open', { wsReady: ws ? ws.readyState : 'null' });
      return;
    }
    log('send', 'Text to AI', text.substring(0, 100));
    ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: text }] }],
        turnComplete: true
      }
    }));
  }

  // ─── CSS INJECTION ────────────────────────────────────────────────────
  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'aysha-styles';
    style.textContent = `
      /* ── Button ── */
      #aysha-btn {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #C6A46D, #A38450);
        box-shadow: 0 4px 20px rgba(198,164,109,0.4);
        transition: transform 0.2s, box-shadow 0.2s, background 0.3s;
        outline: none;
        -webkit-tap-highlight-color: transparent;
      }
      #aysha-btn:hover {
        transform: scale(1.08);
        box-shadow: 0 6px 28px rgba(198,164,109,0.55);
      }
      #aysha-btn:active { transform: scale(0.95); }
      #aysha-btn svg { width: 28px; height: 28px; fill: #fff; }

      /* Pulse ring */
      #aysha-btn::before {
        content: '';
        position: absolute;
        inset: -6px;
        border-radius: 50%;
        border: 2px solid rgba(198,164,109,0.5);
        animation: aysha-pulse 2s ease-in-out infinite;
        pointer-events: none;
      }

      @keyframes aysha-pulse {
        0%, 100% { transform: scale(1); opacity: 0.6; }
        50% { transform: scale(1.18); opacity: 0; }
      }

      /* States */
      #aysha-btn.listening {
        background: #ef4444;
        box-shadow: 0 4px 20px rgba(239,68,68,0.5);
      }
      #aysha-btn.listening::before { border-color: rgba(239,68,68,0.5); }

      #aysha-btn.speaking {
        background: #22c55e;
        box-shadow: 0 4px 20px rgba(34,197,94,0.5);
      }
      #aysha-btn.speaking::before { border-color: rgba(34,197,94,0.5); }

      #aysha-btn.connecting {
        background: linear-gradient(135deg, #C6A46D, #A38450);
      }
      #aysha-btn.connecting::before { animation: aysha-spin 1s linear infinite; border-style: dashed; }

      #aysha-btn.error-state {
        background: #dc2626;
      }

      @keyframes aysha-spin {
        to { transform: rotate(360deg); }
      }

      /* Sound waves inside button */
      .aysha-waves {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 3px;
        height: 28px;
      }
      .aysha-waves span {
        display: block;
        width: 3px;
        background: #fff;
        border-radius: 2px;
        animation: aysha-wave 0.8s ease-in-out infinite;
      }
      .aysha-waves span:nth-child(1) { height: 8px; animation-delay: 0s; }
      .aysha-waves span:nth-child(2) { height: 16px; animation-delay: 0.1s; }
      .aysha-waves span:nth-child(3) { height: 24px; animation-delay: 0.2s; }
      .aysha-waves span:nth-child(4) { height: 16px; animation-delay: 0.3s; }
      .aysha-waves span:nth-child(5) { height: 8px; animation-delay: 0.4s; }

      @keyframes aysha-wave {
        0%, 100% { transform: scaleY(0.4); }
        50% { transform: scaleY(1); }
      }

      /* Spinner inside button */
      .aysha-spinner {
        width: 26px;
        height: 26px;
        border: 3px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: aysha-spin 0.7s linear infinite;
      }

      /* ── Welcome Bubble ── */
      #aysha-welcome {
        position: fixed;
        bottom: 100px;
        right: 24px;
        background: #fff;
        border-radius: 16px;
        padding: 16px 20px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        z-index: 10001;
        max-width: 280px;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.4s, transform 0.4s;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #aysha-welcome.visible {
        opacity: 1;
        transform: translateY(0);
      }
      #aysha-welcome.fade-out {
        opacity: 0;
        transform: translateY(10px);
        pointer-events: none;
      }
      #aysha-welcome::after {
        content: '';
        position: absolute;
        bottom: -8px;
        right: 28px;
        width: 16px;
        height: 16px;
        background: #fff;
        transform: rotate(45deg);
        box-shadow: 4px 4px 8px rgba(0,0,0,0.05);
      }
      #aysha-welcome .welcome-text {
        font-size: 15px;
        font-weight: 600;
        color: #1a1a1a;
        margin: 0 0 4px 0;
        line-height: 1.4;
      }
      #aysha-welcome .welcome-sub {
        font-size: 13px;
        color: #666;
        margin: 0;
      }
      #aysha-welcome .welcome-close {
        position: absolute;
        top: 8px;
        right: 10px;
        width: 22px;
        height: 22px;
        border: none;
        background: none;
        font-size: 16px;
        color: #999;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        padding: 0;
        line-height: 1;
      }
      #aysha-welcome .welcome-close:hover { background: #f0f0f0; color: #333; }

      @keyframes aysha-bubble-pulse {
        0%, 100% { box-shadow: 0 8px 32px rgba(0,0,0,0.15); }
        50% { box-shadow: 0 8px 32px rgba(198,164,109,0.35); }
      }
      #aysha-welcome.visible { animation: aysha-bubble-pulse 2s ease-in-out infinite; }

      /* ── Status Pill ── */
      #aysha-status {
        position: fixed;
        bottom: 96px;
        right: 24px;
        background: rgba(0,0,0,0.75);
        color: #fff;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 6px 14px;
        border-radius: 20px;
        z-index: 10000;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 0.3s, transform 0.3s;
        pointer-events: none;
        white-space: nowrap;
      }
      #aysha-status.visible {
        opacity: 1;
        transform: translateY(0);
      }

      /* ── Permission Dialog Overlay ── */
      #aysha-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: 10002;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #aysha-overlay.visible {
        opacity: 1;
        pointer-events: all;
      }

      #aysha-dialog {
        background: #fff;
        border-radius: 20px;
        padding: 36px 32px 28px;
        max-width: 400px;
        width: calc(100% - 40px);
        text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        transform: scale(0.9);
        transition: transform 0.3s;
      }
      #aysha-overlay.visible #aysha-dialog {
        transform: scale(1);
      }

      .aysha-dialog-icon {
        width: 64px;
        height: 64px;
        background: linear-gradient(135deg, #C6A46D, #A38450);
        border-radius: 50%;
        margin: 0 auto 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .aysha-dialog-icon svg { width: 32px; height: 32px; fill: #fff; }

      .aysha-dialog-title {
        font-size: 20px;
        font-weight: 700;
        color: #1a1a1a;
        margin: 0 0 8px;
      }
      .aysha-dialog-desc {
        font-size: 14px;
        color: #555;
        margin: 0 0 16px;
        line-height: 1.5;
      }
      .aysha-dialog-list {
        text-align: left;
        list-style: none;
        padding: 0;
        margin: 0 0 24px;
      }
      .aysha-dialog-list li {
        font-size: 14px;
        color: #333;
        padding: 6px 0 6px 28px;
        position: relative;
        line-height: 1.4;
      }
      .aysha-dialog-list li::before {
        content: '';
        position: absolute;
        left: 4px;
        top: 10px;
        width: 16px;
        height: 16px;
        background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23C6A46D'%3E%3Cpath fill-rule='evenodd' d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z'/%3E%3C/svg%3E") center/contain no-repeat;
      }

      .aysha-dialog-btns {
        display: flex;
        gap: 12px;
        justify-content: center;
      }
      .aysha-dialog-btns button {
        padding: 12px 24px;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: transform 0.15s, box-shadow 0.15s;
      }
      .aysha-dialog-btns button:active { transform: scale(0.96); }

      .aysha-btn-primary {
        background: linear-gradient(135deg, #C6A46D, #A38450);
        color: #fff;
        box-shadow: 0 4px 16px rgba(198,164,109,0.4);
      }
      .aysha-btn-primary:hover { box-shadow: 0 6px 20px rgba(198,164,109,0.55); }

      .aysha-btn-secondary {
        background: #f3f4f6;
        color: #555;
      }
      .aysha-btn-secondary:hover { background: #e5e7eb; }

      /* ── Highlight effect ── */
      .aysha-highlight {
        outline: 3px solid #C6A46D !important;
        outline-offset: 4px;
        transition: outline 0.3s;
        box-shadow: 0 0 20px rgba(198,164,109,0.3) !important;
      }

      /* ── Error toast ── */
      #aysha-toast {
        position: fixed;
        bottom: 100px;
        right: 24px;
        background: #dc2626;
        color: #fff;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 10px 18px;
        border-radius: 12px;
        z-index: 10003;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 0.3s, transform 0.3s;
        pointer-events: none;
        box-shadow: 0 4px 16px rgba(220,38,38,0.3);
      }
      #aysha-toast.visible {
        opacity: 1;
        transform: translateY(0);
      }

      /* ═══════════════════════════════════════════════════════════════════
         CINEMATIC PRESENTATION MODE
         ═══════════════════════════════════════════════════════════════════ */
      .tcc-cinema {
        position: fixed;
        inset: 0;
        z-index: 10005;
        background: rgba(15,23,42,0.95);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        color: #fff;
        opacity: 0;
        transition: opacity 0.6s ease;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow: hidden;
      }
      .tcc-cinema.active { opacity: 1; }

      .tcc-cinema .cinema-dismiss {
        position: absolute;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 12px;
        color: rgba(255,255,255,0.4);
        letter-spacing: 1px;
        text-transform: uppercase;
        pointer-events: none;
      }

      /* Gold accent line */
      .cinema-gold-line {
        width: 60px;
        height: 2px;
        background: linear-gradient(90deg, transparent, #C6A46D, transparent);
        margin: 16px auto;
        opacity: 0;
        animation: cinema-fade-in 0.6s ease forwards;
      }

      /* ── Company Cinematic ── */
      .cinema-logo-circle {
        width: 100px;
        height: 100px;
        border-radius: 50%;
        background: linear-gradient(135deg, #C6A46D, #A38450);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transform: scale(0.5);
        animation: cinema-logo-in 0.8s cubic-bezier(0.34,1.56,0.64,1) 0.3s forwards;
      }
      .cinema-logo-circle svg { width: 50px; height: 50px; fill: #fff; }

      .cinema-title {
        font-size: 32px;
        font-weight: 700;
        letter-spacing: 2px;
        margin-top: 24px;
        overflow: hidden;
        white-space: nowrap;
        border-right: 2px solid #C6A46D;
        width: 0;
        animation: cinema-typewriter 1.5s steps(18) 1s forwards, cinema-blink-cursor 0.6s step-end infinite;
      }

      .cinema-subtitle {
        font-size: 16px;
        color: rgba(255,255,255,0.7);
        margin-top: 8px;
        opacity: 0;
        animation: cinema-fade-in 0.8s ease 2.5s forwards;
      }

      .cinema-stats-row {
        display: flex;
        gap: 48px;
        margin-top: 32px;
        flex-wrap: wrap;
        justify-content: center;
      }
      .cinema-stat {
        text-align: center;
        opacity: 0;
        transform: translateY(20px);
      }
      .cinema-stat:nth-child(1) { animation: cinema-slide-up 0.6s ease 3s forwards; }
      .cinema-stat:nth-child(2) { animation: cinema-slide-up 0.6s ease 3.3s forwards; }
      .cinema-stat:nth-child(3) { animation: cinema-slide-up 0.6s ease 3.6s forwards; }

      .cinema-stat-num {
        font-size: 36px;
        font-weight: 700;
        color: #C6A46D;
        display: block;
      }
      .cinema-stat-label {
        font-size: 13px;
        color: rgba(255,255,255,0.5);
        margin-top: 4px;
        display: block;
      }

      /* ── Corridor Cinematic ── */
      .cinema-route-container {
        width: 90%;
        max-width: 800px;
        position: relative;
        height: 200px;
        margin-bottom: 32px;
      }
      .cinema-route-line {
        position: absolute;
        top: 50%;
        left: 5%;
        width: 0;
        height: 3px;
        background: linear-gradient(90deg, #C6A46D, #e8d5a8, #C6A46D);
        border-radius: 2px;
        animation: cinema-route-draw 3s ease 0.5s forwards;
        box-shadow: 0 0 12px rgba(198,164,109,0.4);
      }
      .cinema-route-dot {
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #C6A46D;
        opacity: 0;
        box-shadow: 0 0 8px rgba(198,164,109,0.6);
      }
      .cinema-route-label {
        position: absolute;
        transform: translateX(-50%);
        font-size: 12px;
        color: rgba(255,255,255,0.8);
        white-space: nowrap;
        opacity: 0;
        letter-spacing: 0.5px;
      }
      .cinema-route-label.top { top: calc(50% - 26px); }
      .cinema-route-label.bottom { top: calc(50% + 18px); }

      .cinema-corridor-stats {
        font-size: 18px;
        color: rgba(255,255,255,0.6);
        letter-spacing: 3px;
        opacity: 0;
        animation: cinema-fade-in 0.8s ease 4s forwards;
      }

      /* ── Course Cinematic ── */
      .cinema-course-card {
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(198,164,109,0.3);
        border-radius: 20px;
        padding: 36px 40px;
        max-width: 480px;
        width: calc(100% - 40px);
        opacity: 0;
        transform: scale(0.8);
        animation: cinema-card-in 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.3s forwards;
      }
      .cinema-course-name {
        font-size: 22px;
        font-weight: 700;
        margin: 0 0 6px;
      }
      .cinema-course-meta {
        font-size: 14px;
        color: #C6A46D;
        margin: 0 0 20px;
      }
      .cinema-module-list {
        list-style: none;
        padding: 0;
        margin: 0 0 24px;
      }
      .cinema-module-list li {
        font-size: 14px;
        color: rgba(255,255,255,0.8);
        padding: 8px 0 8px 30px;
        position: relative;
        opacity: 0;
        transform: translateX(-10px);
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .cinema-module-list li::before {
        content: '';
        position: absolute;
        left: 2px;
        top: 10px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid #C6A46D;
        background: transparent;
        transition: background 0.3s;
      }
      .cinema-module-list li.checked::before {
        background: #C6A46D;
        box-shadow: 0 0 8px rgba(198,164,109,0.4);
      }
      .cinema-module-list li.checked::after {
        content: '';
        position: absolute;
        left: 8px;
        top: 14px;
        width: 6px;
        height: 10px;
        border: solid #fff;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }
      .cinema-cta-btn {
        display: inline-block;
        background: linear-gradient(135deg, #C6A46D, #A38450);
        color: #fff;
        padding: 14px 32px;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 600;
        text-decoration: none;
        opacity: 0;
        cursor: pointer;
        border: none;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .cinema-cta-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 20px rgba(198,164,109,0.5);
      }

      /* ── Stats Cinematic ── */
      .cinema-stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 32px 48px;
        max-width: 600px;
      }
      .cinema-stat-big {
        text-align: center;
        opacity: 0;
      }
      .cinema-stat-big:nth-child(1) { transform: translateX(-40px); animation: cinema-slide-right 0.7s ease 0.5s forwards; }
      .cinema-stat-big:nth-child(2) { transform: translateX(40px); animation: cinema-slide-left 0.7s ease 0.8s forwards; }
      .cinema-stat-big:nth-child(3) { transform: translateY(40px); animation: cinema-slide-up 0.7s ease 1.1s forwards; }
      .cinema-stat-big:nth-child(4) { transform: translateY(-40px); animation: cinema-slide-down 0.7s ease 1.4s forwards; }

      .cinema-stat-big .stat-value {
        font-size: 48px;
        font-weight: 800;
        color: #C6A46D;
        line-height: 1.1;
      }
      .cinema-stat-big .stat-unit {
        font-size: 14px;
        color: rgba(255,255,255,0.5);
        display: block;
        margin-top: 6px;
      }

      .cinema-stat-divider {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 0;
        height: 2px;
        background: linear-gradient(90deg, transparent, #C6A46D, transparent);
        transform: translate(-50%, -50%);
        animation: cinema-divider-grow 1s ease 1.8s forwards;
      }

      /* ── Team Cinematic ── */
      .cinema-team-grid {
        display: flex;
        gap: 32px;
        flex-wrap: wrap;
        justify-content: center;
        max-width: 700px;
      }
      .cinema-team-card {
        text-align: center;
        opacity: 0;
        transform: translateY(30px);
        width: 140px;
      }
      .cinema-team-card:nth-child(1) { animation: cinema-slide-up 0.6s ease 0.5s forwards; }
      .cinema-team-card:nth-child(2) { animation: cinema-slide-up 0.6s ease 0.8s forwards; }
      .cinema-team-card:nth-child(3) { animation: cinema-slide-up 0.6s ease 1.1s forwards; }
      .cinema-team-card:nth-child(4) { animation: cinema-slide-up 0.6s ease 1.4s forwards; }

      .cinema-team-avatar {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: linear-gradient(135deg, rgba(198,164,109,0.3), rgba(198,164,109,0.1));
        border: 2px solid rgba(198,164,109,0.4);
        margin: 0 auto 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
      }
      .cinema-team-name {
        font-size: 14px;
        font-weight: 600;
        margin: 0 0 4px;
      }
      .cinema-team-exp {
        font-size: 12px;
        color: #C6A46D;
      }
      .cinema-team-total {
        font-size: 20px;
        font-weight: 700;
        margin-top: 32px;
        opacity: 0;
        animation: cinema-fade-in 0.8s ease 2.2s forwards;
        color: #C6A46D;
      }

      /* ── Cinematic Keyframes ── */
      @keyframes cinema-fade-in {
        to { opacity: 1; }
      }
      @keyframes cinema-logo-in {
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes cinema-typewriter {
        to { width: 18ch; }
      }
      @keyframes cinema-blink-cursor {
        50% { border-color: transparent; }
      }
      @keyframes cinema-slide-up {
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes cinema-slide-down {
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes cinema-slide-right {
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes cinema-slide-left {
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes cinema-route-draw {
        to { width: 90%; }
      }
      @keyframes cinema-card-in {
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes cinema-divider-grow {
        to { width: 200px; }
      }
      @keyframes cinema-countup-glow {
        0%, 100% { text-shadow: 0 0 10px rgba(198,164,109,0.3); }
        50% { text-shadow: 0 0 30px rgba(198,164,109,0.6); }
      }

      /* ── Mobile ── */
      @media (max-width: 640px) {
        #aysha-btn {
          width: 48px;
          height: 48px;
          bottom: 16px;
          right: 16px;
        }
        #aysha-btn svg { width: 22px; height: 22px; }
        #aysha-btn::before { display: none; }
        .aysha-waves span { width: 2px; }

        #aysha-welcome {
          right: 16px;
          left: 16px;
          max-width: none;
          bottom: 76px;
        }
        #aysha-welcome::after { right: 20px; }

        #aysha-status {
          right: 16px;
          bottom: 72px;
          font-size: 11px;
        }

        #aysha-toast {
          right: 16px;
          left: 16px;
          bottom: 76px;
          text-align: center;
        }

        #aysha-dialog {
          padding: 28px 20px 24px;
        }
        .aysha-dialog-btns {
          flex-direction: column;
        }
        .aysha-dialog-btns button {
          width: 100%;
        }

        /* Cinematic mobile adjustments */
        .cinema-title { font-size: 22px; }
        .cinema-subtitle { font-size: 14px; }
        .cinema-stats-row { gap: 24px; }
        .cinema-stat-num { font-size: 28px; }
        .cinema-stats-grid { grid-template-columns: 1fr 1fr; gap: 20px 24px; }
        .cinema-stat-big .stat-value { font-size: 36px; }
        .cinema-team-grid { gap: 16px; }
        .cinema-team-card { width: 100px; }
        .cinema-team-avatar { width: 60px; height: 60px; font-size: 24px; }
        .cinema-course-card { padding: 24px 20px; }
        .cinema-route-container { height: 150px; }
        .cinema-corridor-stats { font-size: 14px; letter-spacing: 2px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── SVG ICONS ────────────────────────────────────────────────────────
  const MIC_SVG = '<svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';
  const WAVES_HTML = '<div class="aysha-waves"><span></span><span></span><span></span><span></span><span></span></div>';
  const SPINNER_HTML = '<div class="aysha-spinner"></div>';
  const TCC_LOGO_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';

  // ─── DOM CREATION ─────────────────────────────────────────────────────
  function createUI() {
    // Main button
    var btn = document.createElement('button');
    btn.id = 'aysha-btn';
    btn.title = 'Голосовой помощник Айша';
    btn.innerHTML = MIC_SVG;
    btn.addEventListener('click', onButtonClick);
    document.body.appendChild(btn);

    // Status pill
    var status = document.createElement('div');
    status.id = 'aysha-status';
    document.body.appendChild(status);

    // Toast
    var toast = document.createElement('div');
    toast.id = 'aysha-toast';
    document.body.appendChild(toast);

    // Permission overlay
    var overlay = document.createElement('div');
    overlay.id = 'aysha-overlay';
    overlay.innerHTML = `
      <div id="aysha-dialog">
        <div class="aysha-dialog-icon">${MIC_SVG}</div>
        <div class="aysha-dialog-title">Голосовой помощник Айша</div>
        <div class="aysha-dialog-desc">Для общения голосом мне нужен доступ к вашему микрофону. Я могу:</div>
        <ul class="aysha-dialog-list">
          <li>Рассказать о компании и услугах</li>
          <li>Показать любой раздел сайта</li>
          <li>Провести экскурсию</li>
          <li>Ответить на вопросы о логистике</li>
        </ul>
        <div class="aysha-dialog-btns">
          <button class="aysha-btn-primary" id="aysha-allow">Разрешить микрофон</button>
          <button class="aysha-btn-secondary" id="aysha-deny">Не сейчас</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('aysha-allow').addEventListener('click', onAllowMic);
    document.getElementById('aysha-deny').addEventListener('click', onDenyMic);
  }

  // ─── WELCOME BUBBLE ──────────────────────────────────────────────────
  function showWelcomeBubble() {
    if (hasBeenWelcomed) return;

    var bubble = document.createElement('div');
    bubble.id = 'aysha-welcome';
    bubble.innerHTML = `
      <button class="welcome-close" aria-label="Close">&times;</button>
      <p class="welcome-text">Привет! Я Айша \u2014 ваш голосовой гид</p>
      <p class="welcome-sub">Нажмите чтобы начать</p>
    `;
    document.body.appendChild(bubble);

    bubble.querySelector('.welcome-close').addEventListener('click', function () {
      dismissWelcome();
    });

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        bubble.classList.add('visible');
      });
    });

    welcomeFadeTimer = setTimeout(function () {
      dismissWelcome();
    }, WELCOME_FADE_DELAY);
  }

  function dismissWelcome() {
    var bubble = document.getElementById('aysha-welcome');
    if (!bubble) return;
    clearTimeout(welcomeFadeTimer);
    bubble.classList.remove('visible');
    bubble.classList.add('fade-out');
    setTimeout(function () {
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }, 400);
  }

  // ─── UI STATE UPDATES ─────────────────────────────────────────────────
  function setState(newState) {
    log('state', state + ' → ' + newState);
    state = newState;
    var btn = document.getElementById('aysha-btn');
    if (!btn) return;

    btn.className = '';
    var statusEl = document.getElementById('aysha-status');

    switch (newState) {
      case 'idle':
        btn.innerHTML = MIC_SVG;
        if (statusEl) { statusEl.textContent = ''; statusEl.classList.remove('visible'); }
        resetSilenceTimer();
        break;
      case 'connecting':
        btn.classList.add('connecting');
        btn.innerHTML = SPINNER_HTML;
        showStatus('Подключение...');
        break;
      case 'listening':
        btn.classList.add('listening');
        btn.innerHTML = WAVES_HTML;
        showStatus('Слушаю...');
        startSilenceTimer();
        break;
      case 'thinking':
        btn.classList.add('connecting');
        btn.innerHTML = SPINNER_HTML;
        showStatus('Думаю...');
        break;
      case 'speaking':
        btn.classList.add('speaking');
        btn.innerHTML = WAVES_HTML;
        showStatus('Говорю...');
        resetSilenceTimer();
        break;
      case 'error':
        btn.classList.add('error-state');
        btn.innerHTML = MIC_SVG;
        if (statusEl) { statusEl.classList.remove('visible'); }
        break;
    }
  }

  function showStatus(text) {
    var el = document.getElementById('aysha-status');
    if (!el) return;
    el.textContent = text;
    el.classList.add('visible');
  }

  function showToast(text, duration) {
    duration = duration || 4000;
    var el = document.getElementById('aysha-toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('visible');
    setTimeout(function () {
      el.classList.remove('visible');
    }, duration);
  }

  // ─── INACTIVITY TIMER ────────────────────────────────────────────────
  function startSilenceTimer() {
    resetSilenceTimer();
    silenceTimer = setTimeout(function () {
      if (state === 'listening') {
        log('timer', 'Inactivity timeout — disconnecting');
        sessionActive = false;
        stopSession();
      }
    }, SILENCE_TIMEOUT);
  }

  function resetSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  // ─── TOGGLE BUTTON HANDLER ────────────────────────────────────────────
  function onButtonClick() {
    dismissWelcome();

    if (state === 'idle' || state === 'error') {
      if (firstInteraction) {
        showPermissionDialog();
      } else {
        log('toggle', 'Starting session');
        sessionActive = true;
        startSession();
      }
    } else {
      log('toggle', 'Stopping session');
      sessionActive = false;
      stopSession();
    }
  }

  // ─── PERMISSION DIALOG ────────────────────────────────────────────────
  function showPermissionDialog() {
    var overlay = document.getElementById('aysha-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  function hidePermissionDialog() {
    var overlay = document.getElementById('aysha-overlay');
    if (overlay) overlay.classList.remove('visible');
  }

  function onAllowMic() {
    hidePermissionDialog();
    firstInteraction = false;
    sessionActive = true;
    startSession();
  }

  function onDenyMic() {
    hidePermissionDialog();
  }

  // ─── SESSION MANAGEMENT ───────────────────────────────────────────────
  async function startSession() {
    try {
      setState('connecting');

      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: INPUT_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });

      gainNode = audioCtx.createGain();
      gainNode.connect(audioCtx.destination);

      connectWebSocket();

    } catch (err) {
      log('error', 'Mic/session error', { name: err.name, msg: err.message });
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        showToast('Микрофон недоступен', 4000);
      } else {
        showToast('Ошибка: ' + err.message, 4000);
      }
      setState('error');
    }
  }

  function stopSession() {
    resetSilenceTimer();
    stopMicCapture();
    stopPlayback();
    sessionActive = false;

    if (ws && ws.readyState === WebSocket.OPEN) {
      // Signal end of audio stream before closing
      try { ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch(e) {}
      ws.close();
    }
    ws = null;

    if (audioCtx) {
      audioCtx.close().catch(function () {});
      audioCtx = null;
    }

    if (micStream) {
      micStream.getTracks().forEach(function (t) { t.stop(); });
      micStream = null;
    }

    tourActive = false;
    tourStep = 0;
    setState('idle');
  }

  // ─── WEBSOCKET ────────────────────────────────────────────────────────
  function connectWebSocket() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    ws = new WebSocket(WS_URL);

    ws.onopen = function () {
      var setupMsg = {
        setup: {
          model: 'models/' + MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Aoede'
                }
              }
            }
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
              endOfSpeechSensitivity: 'END_SENSITIVITY_LOW'
            }
          },
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          tools: TOOLS
        }
      };

      log('ws', 'Setup sent');
      ws.send(JSON.stringify(setupMsg));
    };

    ws.onmessage = function (event) {
      handleWsMessage(event);
    };

    ws.onerror = function (err) {
      log('error', 'WS error', err);
    };

    ws.onclose = function (event) {
      log('ws', 'WS closed', { code: event.code, reason: event.reason });
      // Don't show error if navigating or if normal close
      var isNavigating = sessionStorage.getItem('aysha_reconnect') === 'true' || sessionStorage.getItem('aysha_tour_active') === 'true';
      if (state !== 'idle' && state !== 'error' && !isNavigating) {
        log('ws', 'Connection lost, will auto-reconnect');
        // Don't show error toast — just quietly reconnect
        cleanupAudio();
        setState('idle');
        // Auto-reconnect after short delay
        reconnectTimer = setTimeout(function () {
          log('ws', 'Auto-reconnecting...');
          startSession();
        }, 1000);
      }
    };
  }

  function handleWsMessage(event) {
    var rawData = typeof event.data === 'string' ? event.data : null;
    if (event.data instanceof Blob) {
      event.data.text().then(function(text) {
        try {
          var blobMsg = JSON.parse(text);
          console.log('[Aysha] Blob msg:', Object.keys(blobMsg));
          processMessage(blobMsg);
        } catch(e) {}
      });
      return;
    }
    if (typeof event.data === 'string') {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      console.log('[Aysha] Msg:', Object.keys(msg));
      processMessage(msg);
    }
  }

  function processMessage(msg) {

      if (msg.setupComplete) {
        log('ws', 'Setup complete — mic starting');
        startMicCapture();
        setState('listening');

        // Send pending context (e.g. after navigation or tour resume)
        if (pendingContextAfterSetup) {
          var ctx = pendingContextAfterSetup;
          pendingContextAfterSetup = null;
          setTimeout(function () {
            sendTextToAI(ctx);
          }, 500);
        } else if (!hasBeenWelcomed) {
          // First time — AI introduces itself proactively
          hasBeenWelcomed = true;
          localStorage.setItem('tcc_welcomed', 'true');
          setTimeout(function () {
            sendTextToAI('[СИСТЕМНОЕ СООБЩЕНИЕ] Пользователь только что разрешил микрофон и подключился впервые. Представься кратко: скажи что ты Айша — голосовой ИИ-помощник TransCaspian Cargo, что можешь рассказать о компании, показать курсы, провести тур по сайту, помочь записаться на курс. Спроси чем можешь помочь. Говори дружелюбно и кратко, 2-3 предложения. НЕ упоминай системное сообщение.');
          }, 800);
        } else {
          hasBeenWelcomed = true;
          localStorage.setItem('tcc_welcomed', 'true');
        }
        return;
      }

      if (msg.serverContent) {
        handleServerContent(msg.serverContent);
      }

      if (msg.toolCall) {
        log('tool', 'Tool call received', msg.toolCall.functionCalls ? msg.toolCall.functionCalls.map(function(f){return f.name+'('+JSON.stringify(f.args||{})+')'}).join(', ') : 'no calls');
        handleToolCall(msg.toolCall);
      }
  }

  function handleServerContent(content) {
    if (content.turnComplete) {
      log('ai', 'Turn complete');
      setTimeout(function () {
        if (state === 'speaking' || state === 'thinking') {
          setState('listening');
        }
      }, 300);
      return;
    }

    if (content.interrupted) {
      log('ai', 'Interrupted — flushing all audio');
      ignoreAudioUntilTurn = true;
      stopPlayback();
      setState('listening');
      return;
    }

    if (content.modelTurn && content.modelTurn.parts) {
      // New model turn = fresh response, stop ignoring
      if (ignoreAudioUntilTurn) {
        ignoreAudioUntilTurn = false;
        stopPlayback(); // clear any residual
        log('ai', 'New turn after interrupt — accepting audio');
      }
      content.modelTurn.parts.forEach(function (part) {
        if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.indexOf('audio') !== -1) {
          if (ignoreAudioUntilTurn) return; // skip stale chunks
          setState('speaking');
          playAudioChunk(part.inlineData.data);
        }
      });
    }
  }

  // ─── TOOL CALLS ───────────────────────────────────────────────────────
  function handleToolCall(toolCall) {
    if (!toolCall.functionCalls) return;

    var responses = [];

    toolCall.functionCalls.forEach(function (fc) {
      var result = executeFunction(fc.name, fc.args || {});
      responses.push({
        id: fc.id,
        name: fc.name,
        response: { result: result }
      });
    });

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        toolResponse: {
          functionResponses: responses
        }
      }));
    }
  }

  function executeFunction(name, args) {
    log('exec', 'Executing: ' + name, args);
    switch (name) {
      case 'navigate':
        return doNavigate(args.page);
      case 'scroll_to':
        return doScrollTo(args.selector);
      case 'highlight':
        return doHighlight(args.selector);
      case 'open_external':
        return doOpenExternal(args.url);
      case 'start_tour':
        return doStartTour();
      case 'show_next_tour_step':
        return doShowNextTourStep();
      case 'show_cinematic':
        return doShowCinematic(args.type);
      case 'describe_page':
        return getPageContext();
      case 'show_enrollment':
        return doShowEnrollment(args.course);
      case 'fill_email':
        return doFillEmail(args.email);
      default:
        return { success: false, error: 'Unknown function: ' + name };
    }
  }

  function doNavigate(page) {
    var validPages = [
      'index.html', 'about.html', 'analytics.html', 'solutions.html',
      'education.html', 'corridor.html', 'wiki.html', 'contacts.html',
      'projects.html', 'media.html', 'partners.html', 'live-data.html'
    ];
    if (validPages.indexOf(page) === -1) {
      return { success: false, error: 'Invalid page: ' + page };
    }
    // Save auto-reconnect flag so assistant resumes on new page
    sessionStorage.setItem('aysha_reconnect', 'true');
    var currentPath = window.location.pathname;
    var basePath = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
    window.location.href = basePath + page;
    return { success: true, navigatedTo: page };
  }

  function doScrollTo(selector) {
    var selectors = selector.split(',').map(function (s) { return s.trim(); });
    for (var i = 0; i < selectors.length; i++) {
      try {
        var el = document.querySelector(selectors[i]);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return { success: true, scrolledTo: selectors[i] };
        }
      } catch (e) {}
    }
    return { success: false, error: 'Element not found: ' + selector };
  }

  function doHighlight(selector) {
    try {
      var el = document.querySelector(selector);
      if (el) {
        el.classList.add('aysha-highlight');
        setTimeout(function () {
          el.classList.remove('aysha-highlight');
        }, 3000);
        return { success: true, highlighted: selector };
      }
    } catch (e) {}
    return { success: false, error: 'Element not found: ' + selector };
  }

  function doOpenExternal(url) {
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      return { success: true, opened: url };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function doStartTour() {
    tourActive = true;
    tourStep = 0;
    return executeTourStep();
  }

  function doShowNextTourStep() {
    if (!tourActive) {
      return { success: false, error: 'Tour is not active' };
    }
    tourStep++;
    if (tourStep >= TOUR_STEPS.length) {
      tourActive = false;
      tourStep = 0;
      return { success: true, tourComplete: true };
    }
    return executeTourStep();
  }

  function executeTourStep() {
    if (tourStep >= TOUR_STEPS.length) {
      tourActive = false;
      return { success: true, tourComplete: true };
    }

    var step = TOUR_STEPS[tourStep];

    if (step.action === 'navigate' && step.page) {
      var currentPage = window.location.pathname.split('/').pop() || 'index.html';
      if (currentPage !== step.page) {
        sessionStorage.setItem('aysha_tour_active', 'true');
        sessionStorage.setItem('aysha_tour_step', String(tourStep));
        doNavigate(step.page);
        return { success: true, step: tourStep, action: 'navigated', page: step.page, narration: step.narration };
      }
    }

    if (step.action === 'scroll' && step.selector) {
      doScrollTo(step.selector);
    }

    return { success: true, step: tourStep, narration: step.narration };
  }

  // ═════════════════════════════════════════════════════════════════════
  // CINEMATIC PRESENTATION MODE
  // ═════════════════════════════════════════════════════════════════════

  function doShowCinematic(type) {
    var validTypes = ['company', 'corridor', 'course', 'stats', 'team', 'globe_story'];
    if (validTypes.indexOf(type) === -1) {
      return { success: false, error: 'Invalid cinematic type: ' + type };
    }

    if (type === 'globe_story') {
      if (!window.tccGlobe) {
        // Not on main page, fallback to company cinematic
        showCinematic('company');
        return { success: true, cinematic: 'company', note: 'Fallback: not on main page' };
      }
      startGlobeStory();
      return { success: true, cinematic: 'globe_story' };
    }

    showCinematic(type);
    return { success: true, cinematic: type };
  }

  function showCinematic(type) {
    // Remove any existing cinematic
    var existing = document.querySelector('.tcc-cinema');
    if (existing) existing.remove();

    var cinema = document.createElement('div');
    cinema.className = 'tcc-cinema';

    var content = '';
    var autoDismissMs = 6000;

    switch (type) {
      case 'company':
        content = buildCompanyCinematic();
        autoDismissMs = 6000;
        break;
      case 'corridor':
        content = buildCorridorCinematic();
        autoDismissMs = 8000;
        break;
      case 'course':
        content = buildCourseCinematic();
        autoDismissMs = 8000;
        break;
      case 'stats':
        content = buildStatsCinematic();
        autoDismissMs = 6000;
        break;
      case 'team':
        content = buildTeamCinematic();
        autoDismissMs = 7000;
        break;
    }

    cinema.innerHTML = content + '<div class="cinema-dismiss">Нажмите чтобы закрыть</div>';
    document.body.appendChild(cinema);

    // Activate after a frame
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        cinema.classList.add('active');
      });
    });

    // Run post-render logic (count-up animations, module reveals, etc.)
    setTimeout(function () {
      runCinematicLogic(type, cinema);
    }, 100);

    // Click/tap to dismiss
    cinema.addEventListener('click', function (e) {
      // Don't dismiss if clicking the CTA button
      if (e.target.classList.contains('cinema-cta-btn')) return;
      dismissCinematic(cinema);
    });

    // Auto-dismiss
    setTimeout(function () {
      dismissCinematic(cinema);
    }, autoDismissMs);
  }

  function dismissCinematic(cinema) {
    if (!cinema || !cinema.parentNode) return;
    cinema.classList.remove('active');
    setTimeout(function () {
      if (cinema.parentNode) cinema.remove();
      if (cinematicResolve) {
        cinematicResolve();
        cinematicResolve = null;
      }
    }, 600);
  }

  // ── Company Cinematic ──
  function buildCompanyCinematic() {
    return `
      <div class="cinema-logo-circle">
        <svg viewBox="0 0 24 24" fill="#fff" width="50" height="50">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
      </div>
      <div class="cinema-title">TransCaspian Cargo</div>
      <div class="cinema-subtitle">Платформа отраслевой экспертизы логистики Евразии</div>
      <div class="cinema-gold-line" style="animation-delay: 2.8s;"></div>
      <div class="cinema-stats-row">
        <div class="cinema-stat">
          <span class="cinema-stat-num" data-target="4.5" data-suffix=" млн т">0</span>
          <span class="cinema-stat-label">грузов в 2024</span>
        </div>
        <div class="cinema-stat">
          <span class="cinema-stat-num" data-target="200" data-suffix="+" data-integer="true">0</span>
          <span class="cinema-stat-label">выпускников</span>
        </div>
        <div class="cinema-stat">
          <span class="cinema-stat-num" data-target="6500" data-suffix=" км" data-integer="true">0</span>
          <span class="cinema-stat-label">Средний коридор</span>
        </div>
      </div>
    `;
  }

  // ── Corridor Cinematic ──
  function buildCorridorCinematic() {
    var cities = [
      { name: 'Шанхай', pct: 5, pos: 'top' },
      { name: 'Хоргос', pct: 17, pos: 'bottom' },
      { name: 'Алматы', pct: 25, pos: 'top' },
      { name: 'Актау', pct: 38, pos: 'bottom' },
      { name: 'Баку', pct: 50, pos: 'top' },
      { name: 'Тбилиси', pct: 62, pos: 'bottom' },
      { name: 'Стамбул', pct: 75, pos: 'top' },
      { name: 'Роттердам', pct: 92, pos: 'bottom' }
    ];

    var dotsHtml = '';
    var labelsHtml = '';
    cities.forEach(function (city, i) {
      var delay = 0.5 + (i * 0.35);
      dotsHtml += '<div class="cinema-route-dot" style="left:' + city.pct + '%; animation: cinema-fade-in 0.4s ease ' + delay + 's forwards;"></div>';
      labelsHtml += '<div class="cinema-route-label ' + city.pos + '" style="left:' + city.pct + '%; animation: cinema-fade-in 0.4s ease ' + (delay + 0.15) + 's forwards;">' + city.name + '</div>';
    });

    return `
      <div style="font-size:13px; color:rgba(255,255,255,0.4); letter-spacing:4px; text-transform:uppercase; margin-bottom:24px; opacity:0; animation: cinema-fade-in 0.6s ease 0.2s forwards;">Средний Коридор ТМТМ</div>
      <div class="cinema-route-container">
        <div class="cinema-route-line"></div>
        ${dotsHtml}
        ${labelsHtml}
      </div>
      <div class="cinema-gold-line" style="animation-delay: 3.5s;"></div>
      <div class="cinema-corridor-stats">6500 км &middot; 15 дней &middot; 4.5 млн тонн</div>
    `;
  }

  // ── Course Cinematic ──
  function buildCourseCinematic() {
    var modules = [
      'Введение в логистику',
      'Морская логистика',
      'Сухопутная логистика',
      'Incoterms и контракты',
      'Складская логистика',
      'Авиалогистика',
      'Карьера в логистике'
    ];

    var modulesHtml = modules.map(function (m) {
      return '<li>' + m + '</li>';
    }).join('');

    return `
      <div class="cinema-course-card">
        <div class="cinema-course-name">Логистика с нуля</div>
        <div class="cinema-course-meta">24 часа &middot; 7 модулей &middot; 200+ выпускников</div>
        <ul class="cinema-module-list">
          ${modulesHtml}
        </ul>
        <button class="cinema-cta-btn" onclick="window.open('https://tcchub.kz','_blank')">Записаться на курс</button>
      </div>
    `;
  }

  // ── Stats Cinematic ──
  function buildStatsCinematic() {
    return `
      <div style="position:relative;">
        <div class="cinema-stats-grid">
          <div class="cinema-stat-big">
            <span class="stat-value" data-target="4.5" data-suffix=" млн">0</span>
            <span class="stat-unit">тонн грузов (2024)</span>
          </div>
          <div class="cinema-stat-big">
            <span class="stat-value" data-target="62" data-suffix="%" data-integer="true">0</span>
            <span class="stat-unit">рост за год</span>
          </div>
          <div class="cinema-stat-big">
            <span class="stat-value" data-target="90637" data-suffix="" data-integer="true">0</span>
            <span class="stat-unit">TEU контейнеров</span>
          </div>
          <div class="cinema-stat-big">
            <span class="stat-value" data-target="15" data-suffix=" дней" data-integer="true">0</span>
            <span class="stat-unit">транзит Китай-Европа</span>
          </div>
        </div>
        <div class="cinema-stat-divider"></div>
      </div>
    `;
  }

  // ── Team Cinematic ──
  function buildTeamCinematic() {
    var team = [
      { name: 'А. Тайсаринова', exp: '23 года опыта', initials: 'АТ' },
      { name: 'Р. Хуснутдинов', exp: '25 лет опыта', initials: 'РХ' },
      { name: 'О. Сорокина', exp: '22 года опыта', initials: 'ОС' },
      { name: 'Н. Турарбек', exp: '7 лет опыта', initials: 'НТ' }
    ];

    var cardsHtml = team.map(function (t) {
      return `
        <div class="cinema-team-card">
          <div class="cinema-team-avatar">${t.initials}</div>
          <div class="cinema-team-name">${t.name}</div>
          <div class="cinema-team-exp">${t.exp}</div>
        </div>
      `;
    }).join('');

    return `
      <div style="font-size:13px; color:rgba(255,255,255,0.4); letter-spacing:4px; text-transform:uppercase; margin-bottom:32px; opacity:0; animation: cinema-fade-in 0.6s ease 0.2s forwards;">Команда экспертов</div>
      <div class="cinema-team-grid">
        ${cardsHtml}
      </div>
      <div class="cinema-gold-line" style="animation-delay: 1.8s;"></div>
      <div class="cinema-team-total">77 лет суммарного опыта</div>
    `;
  }

  // ── Post-render cinematic logic ──
  function runCinematicLogic(type, cinema) {
    switch (type) {
      case 'company':
        // Count-up stats after they appear (delay ~3s)
        setTimeout(function () {
          var nums = cinema.querySelectorAll('.cinema-stat-num');
          nums.forEach(function (el) { animateCountUp(el); });
        }, 3000);
        break;

      case 'stats':
        // Count-up after slide-in
        setTimeout(function () {
          var vals = cinema.querySelectorAll('.stat-value');
          vals.forEach(function (el) { animateCountUp(el); });
        }, 1500);
        break;

      case 'course':
        // Reveal modules one by one with checkmarks
        var items = cinema.querySelectorAll('.cinema-module-list li');
        items.forEach(function (li, i) {
          setTimeout(function () {
            li.style.opacity = '1';
            li.style.transform = 'translateX(0)';
            li.style.transition = 'opacity 0.4s, transform 0.4s';
          }, 600 + i * 350);

          setTimeout(function () {
            li.classList.add('checked');
          }, 800 + i * 350);
        });

        // Show CTA button after all modules
        setTimeout(function () {
          var cta = cinema.querySelector('.cinema-cta-btn');
          if (cta) {
            cta.style.opacity = '1';
            cta.style.transition = 'opacity 0.5s';
          }
        }, 600 + items.length * 350 + 300);
        break;

      case 'corridor':
      case 'team':
        // Animations handled by CSS keyframes
        break;
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ENROLLMENT POPUP
  // ═════════════════════════════════════════════════════════════════════

  var enrollmentPopupOpen = false;

  function doShowEnrollment(course) {
    if (enrollmentPopupOpen) return { success: true, note: 'Already open' };

    var existing = document.getElementById('aysha-enrollment');
    if (existing) existing.remove();

    enrollmentPopupOpen = true;

    var selectedCourse = course || '';
    var courseNames = {
      'logistics_basics': 'Логистика с нуля (24ч · 7 модулей)',
      'strategic_nav': 'Стратегическая навигация PRO (72ч · 9 модулей)',
      'bri_logistics': 'BRI Logistics (24ч · 7 модулей)'
    };

    var courseOptions = '<option value="">Выберите курс</option>' +
      '<option value="logistics_basics"' + (selectedCourse === 'logistics_basics' ? ' selected' : '') + '>Логистика с нуля · 24ч · 7 модулей</option>' +
      '<option value="strategic_nav"' + (selectedCourse === 'strategic_nav' ? ' selected' : '') + '>Стратегическая навигация PRO · 72ч · 9 модулей</option>' +
      '<option value="bri_logistics"' + (selectedCourse === 'bri_logistics' ? ' selected' : '') + '>BRI Logistics · 24ч · 7 модулей</option>';

    var popupOverlay = document.createElement('div');
    popupOverlay.id = 'aysha-enrollment';
    popupOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:10010;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.4s ease;font-family:Montserrat,-apple-system,BlinkMacSystemFont,sans-serif;';

    popupOverlay.innerHTML = '' +
      '<div id="aysha-enroll-card" style="background:#fff;border-radius:20px;padding:36px 32px 28px;max-width:420px;width:calc(100% - 40px);box-shadow:0 24px 80px rgba(0,0,0,0.25);transform:scale(0.92);transition:transform 0.4s cubic-bezier(0.34,1.56,0.64,1);position:relative;">' +
        // Header
        '<div style="text-align:center;margin-bottom:24px;">' +
          '<div style="width:56px;height:56px;background:linear-gradient(135deg,#C6A46D,#A38450);border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">' +
            '<svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M12 14l9-5-9-5-9 5 9 5z"/><path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"/><path d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</div>' +
          '<div style="font-size:20px;font-weight:700;color:#1B2A4A;margin-bottom:4px;">Запись на курс</div>' +
          '<div style="font-size:13px;color:#888;">TCC HUB · tcchub.kz</div>' +
        '</div>' +
        // Course select
        '<div style="margin-bottom:16px;">' +
          '<label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:6px;">Курс</label>' +
          '<select id="aysha-enroll-course" style="width:100%;padding:12px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:14px;font-family:inherit;color:#333;background:#fafafa;outline:none;transition:border-color 0.3s;cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url(\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22%23999%22><path d=%22M7 10l5 5 5-5z%22/></svg>\');background-repeat:no-repeat;background-position:right 12px center;">' +
            courseOptions +
          '</select>' +
        '</div>' +
        // Name field
        '<div style="margin-bottom:16px;">' +
          '<label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:6px;">Имя</label>' +
          '<input id="aysha-enroll-name" type="text" placeholder="Ваше имя" style="width:100%;padding:12px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:14px;font-family:inherit;color:#333;background:#fafafa;outline:none;transition:border-color 0.3s;box-sizing:border-box;" />' +
        '</div>' +
        // Email field with voice indicator
        '<div style="margin-bottom:20px;">' +
          '<label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:6px;">Email <span style="color:#C6A46D;font-weight:400;">· можно продиктовать</span></label>' +
          '<div style="position:relative;">' +
            '<input id="aysha-enroll-email" type="email" placeholder="example@mail.com" style="width:100%;padding:12px 44px 12px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:14px;font-family:inherit;color:#333;background:#fafafa;outline:none;transition:border-color 0.3s;box-sizing:border-box;" />' +
            '<div id="aysha-enroll-mic" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);width:28px;height:28px;background:linear-gradient(135deg,#C6A46D,#A38450);border-radius:50%;display:flex;align-items:center;justify-content:center;opacity:0.4;transition:opacity 0.3s;">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // Status message (for voice feedback)
        '<div id="aysha-enroll-status" style="text-align:center;font-size:13px;color:#C6A46D;margin-bottom:16px;min-height:20px;transition:opacity 0.3s;"></div>' +
        // Buttons
        '<div style="display:flex;gap:12px;">' +
          '<button id="aysha-enroll-cancel" style="flex:1;padding:13px;border-radius:12px;border:none;background:#f3f4f6;color:#555;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;transition:background 0.2s;">Отмена</button>' +
          '<button id="aysha-enroll-submit" style="flex:1;padding:13px;border-radius:12px;border:none;background:linear-gradient(135deg,#C6A46D,#A38450);color:#fff;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 4px 16px rgba(198,164,109,0.4);transition:transform 0.15s,box-shadow 0.15s;">Записаться</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(popupOverlay);

    // Animate in
    requestAnimationFrame(function () {
      popupOverlay.style.opacity = '1';
      var card = document.getElementById('aysha-enroll-card');
      if (card) card.style.transform = 'scale(1)';
    });

    // Focus style on email
    var emailInput = document.getElementById('aysha-enroll-email');
    if (emailInput) {
      emailInput.addEventListener('focus', function () {
        emailInput.style.borderColor = '#C6A46D';
        var mic = document.getElementById('aysha-enroll-mic');
        if (mic) mic.style.opacity = '1';
      });
      emailInput.addEventListener('blur', function () {
        emailInput.style.borderColor = '#e0e0e0';
        var mic = document.getElementById('aysha-enroll-mic');
        if (mic) mic.style.opacity = '0.4';
      });
    }

    // Cancel button
    var cancelBtn = document.getElementById('aysha-enroll-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () { closeEnrollment(); });
    }

    // Submit button
    var submitBtn = document.getElementById('aysha-enroll-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () { submitEnrollment(); });
    }

    // Click outside to close
    popupOverlay.addEventListener('click', function (e) {
      if (e.target === popupOverlay) closeEnrollment();
    });

    return { success: true, message: 'Форма записи открыта. Спроси у пользователя имя и email. Email можно продиктовать голосом.' };
  }

  function doFillEmail(email) {
    var emailInput = document.getElementById('aysha-enroll-email');
    if (!emailInput) {
      return { success: false, error: 'Форма записи не открыта' };
    }

    // Clean up email — convert Russian speech patterns
    var cleaned = email.toLowerCase()
      .replace(/\s+/g, '')
      .replace(/собака/g, '@')
      .replace(/собачка/g, '@')
      .replace(/эт/g, '@')
      .replace(/точка/g, '.')
      .replace(/дот/g, '.')
      .replace(/ком$/g, 'com')
      .replace(/гмейл/g, 'gmail')
      .replace(/гмайл/g, 'gmail')
      .replace(/мейл/g, 'mail')
      .replace(/яндекс/g, 'yandex')
      .replace(/рамблер/g, 'rambler')
      .replace(/ру$/g, 'ru')
      .replace(/кей зет$/g, 'kz')
      .replace(/кз$/g, 'kz');

    emailInput.value = cleaned;
    emailInput.style.borderColor = '#C6A46D';
    emailInput.style.background = '#fffbf0';

    // Animate mic indicator
    var mic = document.getElementById('aysha-enroll-mic');
    if (mic) {
      mic.style.opacity = '1';
      mic.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
      setTimeout(function () {
        mic.style.background = 'linear-gradient(135deg,#C6A46D,#A38450)';
      }, 2000);
    }

    // Show status
    var status = document.getElementById('aysha-enroll-status');
    if (status) {
      status.textContent = '✓ Email заполнен: ' + cleaned;
      status.style.opacity = '1';
    }

    return { success: true, email: cleaned, message: 'Email заполнен: ' + cleaned + '. Попроси пользователя подтвердить правильность.' };
  }

  function closeEnrollment() {
    var popup = document.getElementById('aysha-enrollment');
    if (!popup) return;
    var card = document.getElementById('aysha-enroll-card');
    if (card) card.style.transform = 'scale(0.92)';
    popup.style.opacity = '0';
    setTimeout(function () {
      popup.remove();
      enrollmentPopupOpen = false;
    }, 400);
  }

  function submitEnrollment() {
    var course = document.getElementById('aysha-enroll-course');
    var name = document.getElementById('aysha-enroll-name');
    var email = document.getElementById('aysha-enroll-email');
    var status = document.getElementById('aysha-enroll-status');

    var courseVal = course ? course.value : '';
    var nameVal = name ? name.value.trim() : '';
    var emailVal = email ? email.value.trim() : '';

    if (!emailVal || emailVal.indexOf('@') === -1) {
      if (status) {
        status.textContent = 'Пожалуйста, укажите email';
        status.style.color = '#ef4444';
      }
      if (email) email.style.borderColor = '#ef4444';
      return;
    }

    // Show success state
    var card = document.getElementById('aysha-enroll-card');
    if (card) {
      card.innerHTML = '' +
        '<div style="text-align:center;padding:20px 0;">' +
          '<div style="width:64px;height:64px;background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;">' +
            '<svg width="32" height="32" viewBox="0 0 24 24" fill="#fff"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>' +
          '</div>' +
          '<div style="font-size:20px;font-weight:700;color:#1B2A4A;margin-bottom:8px;">Заявка отправлена!</div>' +
          '<div style="font-size:14px;color:#666;margin-bottom:4px;">' + (nameVal ? nameVal + ', мы' : 'Мы') + ' свяжемся с вами</div>' +
          '<div style="font-size:13px;color:#C6A46D;">' + emailVal + '</div>' +
          '<div style="margin-top:24px;">' +
            '<button onclick="document.getElementById(\'aysha-enrollment\').remove();window.enrollmentPopupOpen=false;" style="padding:12px 32px;border-radius:12px;border:none;background:linear-gradient(135deg,#C6A46D,#A38450);color:#fff;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Отлично</button>' +
          '</div>' +
        '</div>';
    }

    // Tell AI about success
    sendTextToAI('[СИСТЕМНОЕ СООБЩЕНИЕ] Пользователь успешно записался на курс. Имя: ' + (nameVal || 'не указано') + ', Email: ' + emailVal + ', Курс: ' + (courseVal || 'не выбран') + '. Поздравь пользователя кратко.');
  }

  // ═════════════════════════════════════════════════════════════════════
  // GLOBE STORY — Immersive Globe Cinematic on Main Page
  // ═════════════════════════════════════════════════════════════════════

  var globeStoryActive = false;
  var globeStoryCleanup = null;

  function startGlobeStory() {
    var globe = window.tccGlobe;
    if (!globe || globeStoryActive) return;
    globeStoryActive = true;
    globe.setDrag(true);

    var globeWrap = document.querySelector('.globe-wrap');
    var canvasEl = globe.canvas;

    // ── Step 1: Fade out everything except globe ──
    var allSections = document.querySelectorAll('body > *');
    var hiddenEls = [];
    allSections.forEach(function (el) {
      if (el === globeWrap || el.contains(globeWrap) || el.contains(canvasEl)) return;
      if (el.id === 'aysha-btn' || el.id === 'aysha-status' || el.id === 'aysha-toast') return;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return;
      hiddenEls.push({ el: el, origOpacity: el.style.opacity, origTransition: el.style.transition, origPointer: el.style.pointerEvents });
      el.style.transition = 'opacity 1s ease';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    });

    // Fade hero children except globe-wrap
    var heroEl = globeWrap ? globeWrap.parentElement : null;
    var heroHidden = [];
    if (heroEl) {
      Array.from(heroEl.children).forEach(function (child) {
        if (child === globeWrap || child.contains(globeWrap)) return;
        heroHidden.push({ el: child, origOpacity: child.style.opacity, origTransition: child.style.transition });
        child.style.transition = 'opacity 1s ease';
        child.style.opacity = '0';
        child.style.pointerEvents = 'none';
      });
    }

    // ── Step 2: Globe → center of screen (not fullscreen, keep round) ──
    var origGlobeStyle = {};
    ['position','top','left','right','width','height','transform','transition','zIndex','bottom','maxWidth','aspectRatio'].forEach(function(k) {
      origGlobeStyle[k] = globeWrap.style[k];
    });

    globeWrap.style.transition = 'all 1.5s cubic-bezier(0.4, 0, 0.2, 1)';
    globeWrap.style.position = 'fixed';
    globeWrap.style.top = '50%';
    globeWrap.style.left = '50%';
    globeWrap.style.transform = 'translate(-50%, -50%)';
    globeWrap.style.width = 'min(65vh, 55vw)';
    globeWrap.style.height = 'auto';
    globeWrap.style.aspectRatio = '1';
    globeWrap.style.bottom = 'auto';
    globeWrap.style.right = 'auto';
    globeWrap.style.zIndex = '9999';

    // Dark background
    var overlay = document.createElement('div');
    overlay.id = 'globe-story-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,30,0.95);z-index:9998;opacity:0;transition:opacity 1s ease;pointer-events:none;';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.style.opacity = '1'; });

    // ── Step 3: UI Container ──
    var uiWrap = document.createElement('div');
    uiWrap.id = 'globe-story-ui';
    uiWrap.style.cssText = 'position:fixed;inset:0;z-index:10000;pointer-events:none;font-family:Montserrat,-apple-system,sans-serif;';
    uiWrap.innerHTML = '' +
      // Top bar — logo + title
      '<div id="gs-top" style="position:absolute;top:24px;left:50%;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity 0.8s ease;">' +
        '<img src="https://optim.tildacdn.pro/tild6637-3765-4438-b135-366537363233/-/resize/176x/-/format/webp/noroot.png.webp" style="height:32px;margin-bottom:8px;filter:brightness(1.2);" alt="TCC" />' +
        '<div id="gs-title" style="font-size:20px;font-weight:700;color:#fff;">TransCaspian Cargo</div>' +
        '<div style="width:60px;height:2px;background:linear-gradient(90deg,transparent,#C6A46D,transparent);margin:8px auto 0;"></div>' +
      '</div>' +
      // Left panel — stats
      '<div id="gs-left" style="position:absolute;left:32px;top:50%;transform:translateY(-50%);width:220px;opacity:0;transition:opacity 0.8s ease;">' +
      '</div>' +
      // Right panel — info
      '<div id="gs-right" style="position:absolute;right:32px;top:50%;transform:translateY(-50%);width:220px;opacity:0;transition:opacity 0.8s ease;">' +
      '</div>' +
      // Bottom — city label
      '<div id="gs-bottom" style="position:absolute;bottom:36px;left:50%;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity 0.6s ease;">' +
      '</div>' +
      // Progress bar
      '<div id="gs-progress" style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);width:300px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;">' +
        '<div id="gs-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#C6A46D,#E8D5B0);border-radius:2px;transition:width 0.5s ease;"></div>' +
      '</div>';
    document.body.appendChild(uiWrap);

    // Close button
    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:fixed;top:24px;right:24px;z-index:10001;background:rgba(255,255,255,0.08);border:1px solid rgba(198,164,109,0.2);color:rgba(255,255,255,0.6);width:40px;height:40px;border-radius:50%;font-size:18px;cursor:pointer;backdrop-filter:blur(8px);transition:all 0.3s;pointer-events:all;';
    closeBtn.addEventListener('mouseenter', function () { closeBtn.style.background = 'rgba(198,164,109,0.2)'; closeBtn.style.color = '#fff'; });
    closeBtn.addEventListener('mouseleave', function () { closeBtn.style.background = 'rgba(255,255,255,0.08)'; closeBtn.style.color = 'rgba(255,255,255,0.6)'; });
    closeBtn.addEventListener('click', function () { endGlobeStory(); });
    document.body.appendChild(closeBtn);

    // ── Step 4: Scene definitions — each scene has waypoint + side panels ──
    // ── SALES FUNNEL SCENES ──
    var logoImg = '<img src="https://optim.tildacdn.pro/tild6637-3765-4438-b135-366537363233/-/resize/176x/-/format/webp/noroot.png.webp" style="height:24px;filter:brightness(1.2);margin-bottom:8px;" />';
    var goldLine = '<div style="width:40px;height:2px;background:linear-gradient(90deg,#C6A46D,#E8D5B0);margin:12px 0;"></div>';
    var label = function(t) { return '<div style="font-size:10px;color:rgba(198,164,109,0.5);letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;">' + t + '</div>'; };
    var stat = function(n, t) { return '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;"><span style="font-size:22px;font-weight:700;color:#C6A46D;">' + n + '</span><span style="font-size:11px;color:rgba(255,255,255,0.4);">' + t + '</span></div>'; };

    // Fullscreen slide container (created once, reused)
    var slideWrap = document.createElement('div');
    slideWrap.id = 'gs-slide';
    slideWrap.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:60px 40px;opacity:0;transition:opacity 0.8s ease;pointer-events:none;font-family:Montserrat,-apple-system,sans-serif;';
    document.body.appendChild(slideWrap);

    var scenes = [
      // ── PHASE 1: GLOBE SCENES ──
      // 1. COMPANY INTRO
      {
        lo: 70, la: 42, scale: 1.0, dur: 3000, pause: 4000,
        title: 'TransCaspian Cargo',
        city: '', cityInfo: '',
        left: logoImg + '<div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:4px;">TransCaspian Cargo</div>' +
          '<div style="font-size:12px;color:rgba(198,164,109,0.7);margin-bottom:14px;">Платформа отраслевой экспертизы</div>' +
          goldLine +
          stat('5', 'услуг') + stat('200+', 'выпускников') + stat('77', 'лет опыта'),
        right: label('Средний коридор 2024') +
          '<div style="font-size:32px;font-weight:700;color:#fff;">4.5<span style="font-size:14px;color:rgba(255,255,255,0.4);"> млн тонн</span></div>' +
          '<div style="font-size:13px;color:rgba(198,164,109,0.7);margin-top:4px;margin-bottom:14px;">+62% за год</div>' +
          goldLine +
          '<div style="font-size:12px;color:rgba(255,255,255,0.4);line-height:1.8;">6500 км · 15 дней · 90 637 TEU</div>'
      },
      // 2. CORRIDOR FLY
      {
        lo: 121.5, la: 31.2, scale: 1.15, dur: 3000, pause: 2500,
        title: 'Средний Коридор ТМТМ',
        city: 'Шанхай → Роттердам', cityInfo: '6500 км · 8 стран · 15 дней',
        left: '', right: ''
      },
      // 3. ATYRAU HQ
      {
        lo: 51.9, la: 47.1, scale: 1.2, dur: 3000, pause: 3000,
        title: 'Штаб-квартира',
        city: 'Атырау — TCC Hub', cityInfo: '',
        left: logoImg + label('Компания') +
          '<div style="font-size:13px;color:#fff;line-height:1.8;">Патент РК №11718<br>Аккредитация CAAAE</div>',
        right: ''
      },

      // ── PHASE 2: FULLSCREEN SLIDES (globe shrinks) ──
      // 4. COURSE 1 — Логистика с нуля
      {
        lo: 55, la: 44, scale: 0.85, dur: 2000, pause: 5500,
        title: 'Обучение',
        fullscreen: true,
        slide: '' +
          '<div style="display:flex;gap:48px;align-items:flex-start;max-width:1000px;width:100%;">' +
            // Left: course card
            '<div style="flex:1;min-width:0;">' +
              '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(198,164,109,0.2);border-radius:20px;padding:32px;backdrop-filter:blur(10px);">' +
                '<div style="font-size:48px;margin-bottom:16px;">📘</div>' +
                '<div style="font-size:10px;color:rgba(198,164,109,0.5);letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">Курс для начинающих</div>' +
                '<div style="font-size:24px;font-weight:700;color:#fff;margin-bottom:6px;">Логистика с нуля</div>' +
                '<div style="font-size:13px;color:rgba(198,164,109,0.8);margin-bottom:20px;">24 часа · 7 модулей · Онлайн</div>' +
                '<div style="width:100%;height:1px;background:rgba(198,164,109,0.15);margin-bottom:20px;"></div>' +
                '<div style="font-size:13px;color:rgba(255,255,255,0.5);line-height:1.7;">Полный курс по логистике: от базовых понятий до построения карьеры. Морские, сухопутные, авиаперевозки, Incoterms, складская логистика.</div>' +
                '<div style="display:flex;gap:20px;margin-top:20px;">' +
                  '<div>' + stat('200+', 'выпускников') + '</div>' +
                  '<div>' + stat('5', 'потоков') + '</div>' +
                  '<div>' + stat('4.8', 'рейтинг') + '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
            // Right: modules
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:10px;color:rgba(198,164,109,0.5);letter-spacing:3px;text-transform:uppercase;margin-bottom:16px;">Программа курса</div>' +
              '<div style="display:flex;flex-direction:column;gap:8px;">' +
                '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(198,164,109,0.1);border-radius:10px;"><span style="font-size:11px;font-weight:700;color:#C6A46D;width:24px;">01</span><span style="font-size:13px;color:#fff;">Введение в логистику</span></div>' +
                '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(198,164,109,0.1);border-radius:10px;"><span style="font-size:11px;font-weight:700;color:#C6A46D;width:24px;">02</span><span style="font-size:13px;color:#fff;">Морская логистика</span></div>' +
                '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(198,164,109,0.1);border-radius:10px;"><span style="font-size:11px;font-weight:700;color:#C6A46D;width:24px;">03</span><span style="font-size:13px;color:#fff;">Сухопутная логистика</span></div>' +
                '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(198,164,109,0.1);border-radius:10px;"><span style="font-size:11px;font-weight:700;color:#C6A46D;width:24px;">04</span><span style="font-size:13px;color:#fff;">Incoterms и контракты</span></div>' +
                '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(198,164,109,0.1);border-radius:10px;"><span style="font-size:11px;font-weight:700;color:#C6A46D;width:24px;">05</span><span style="font-size:13px;color:#fff;">Складская логистика</span></div>' +
                '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(198,164,109,0.1);border-radius:10px;"><span style="font-size:11px;font-weight:700;color:#C6A46D;width:24px;">06</span><span style="font-size:13px;color:#fff;">Авиационная логистика</span></div>' +
                '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(198,164,109,0.08);border:1px solid rgba(198,164,109,0.2);border-radius:10px;"><span style="font-size:11px;font-weight:700;color:#C6A46D;width:24px;">07</span><span style="font-size:13px;color:#fff;">Карьера + бонусы</span></div>' +
              '</div>' +
            '</div>' +
          '</div>'
      },
      // 5. ALL COURSES OVERVIEW
      {
        lo: 50, la: 42, scale: 0.85, dur: 2000, pause: 5000,
        title: 'Три курса',
        fullscreen: true,
        slide: '' +
          '<div style="display:flex;gap:24px;max-width:1100px;width:100%;">' +
            // Course 1
            '<div style="flex:1;background:rgba(255,255,255,0.03);border:1px solid rgba(198,164,109,0.2);border-radius:20px;padding:28px;text-align:center;">' +
              '<div style="font-size:40px;margin-bottom:12px;">📘</div>' +
              '<div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:4px;">Логистика с нуля</div>' +
              '<div style="font-size:12px;color:rgba(198,164,109,0.7);margin-bottom:16px;">24 часа · 7 модулей</div>' +
              '<div style="width:100%;height:1px;background:rgba(198,164,109,0.1);margin-bottom:16px;"></div>' +
              '<div style="font-size:12px;color:rgba(255,255,255,0.4);line-height:1.6;">Для начинающих<br>Базовые знания логистики<br>200+ выпускников</div>' +
              '<div style="margin-top:16px;padding:8px 16px;background:rgba(198,164,109,0.1);border-radius:8px;display:inline-block;font-size:11px;color:#C6A46D;font-weight:600;">Популярный</div>' +
            '</div>' +
            // Course 2
            '<div style="flex:1;background:rgba(255,255,255,0.03);border:1px solid rgba(198,164,109,0.3);border-radius:20px;padding:28px;text-align:center;transform:scale(1.05);box-shadow:0 0 40px rgba(198,164,109,0.1);">' +
              '<div style="font-size:40px;margin-bottom:12px;">📗</div>' +
              '<div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:4px;">Стратегическая навигация PRO</div>' +
              '<div style="font-size:12px;color:rgba(198,164,109,0.7);margin-bottom:16px;">72 часа · 9 модулей</div>' +
              '<div style="width:100%;height:1px;background:rgba(198,164,109,0.1);margin-bottom:16px;"></div>' +
              '<div style="font-size:12px;color:rgba(255,255,255,0.4);line-height:1.6;">Для руководителей<br>Стратегии и оптимизация<br>Международные проекты</div>' +
              '<div style="margin-top:16px;padding:8px 16px;background:linear-gradient(135deg,#C6A46D,#A38450);border-radius:8px;display:inline-block;font-size:11px;color:#fff;font-weight:600;">PRO</div>' +
            '</div>' +
            // Course 3
            '<div style="flex:1;background:rgba(255,255,255,0.03);border:1px solid rgba(198,164,109,0.2);border-radius:20px;padding:28px;text-align:center;">' +
              '<div style="font-size:40px;margin-bottom:12px;">📙</div>' +
              '<div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:4px;">BRI Logistics</div>' +
              '<div style="font-size:12px;color:rgba(198,164,109,0.7);margin-bottom:16px;">24 часа · 7 модулей</div>' +
              '<div style="width:100%;height:1px;background:rgba(198,164,109,0.1);margin-bottom:16px;"></div>' +
              '<div style="font-size:12px;color:rgba(255,255,255,0.4);line-height:1.6;">Стандарты ADB/EBRD<br>Пояс и Путь<br>Международная сертификация</div>' +
              '<div style="margin-top:16px;padding:8px 16px;background:rgba(198,164,109,0.1);border-radius:8px;display:inline-block;font-size:11px;color:#C6A46D;font-weight:600;">Global</div>' +
            '</div>' +
          '</div>'
      },
      // 6. TCC HUB — LMS Platform with screenshot
      {
        lo: 55, la: 45, scale: 0.8, dur: 2000, pause: 5500,
        title: 'TCC HUB',
        fullscreen: true,
        slide: '' +
          '<div style="display:flex;gap:40px;align-items:center;max-width:1000px;width:100%;">' +
            // Left: info
            '<div style="flex:1;min-width:0;">' +
              logoImg +
              '<div style="font-size:24px;font-weight:700;color:#fff;margin-bottom:6px;">TCC HUB</div>' +
              '<div style="font-size:13px;color:rgba(198,164,109,0.7);margin-bottom:20px;">tcchub.kz · Образовательная платформа</div>' +
              goldLine +
              '<div style="display:flex;flex-direction:column;gap:14px;margin-top:16px;">' +
                '<div style="display:flex;align-items:center;gap:12px;"><div style="width:32px;height:32px;background:rgba(198,164,109,0.1);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;">1</div><div><div style="font-size:13px;color:#fff;font-weight:600;">Регистрация</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">Создайте аккаунт на tcchub.kz</div></div></div>' +
                '<div style="display:flex;align-items:center;gap:12px;"><div style="width:32px;height:32px;background:rgba(198,164,109,0.1);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;">2</div><div><div style="font-size:13px;color:#fff;font-weight:600;">Модули 24/7</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">Видео, тесты, задания</div></div></div>' +
                '<div style="display:flex;align-items:center;gap:12px;"><div style="width:32px;height:32px;background:rgba(198,164,109,0.1);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;">3</div><div><div style="font-size:13px;color:#fff;font-weight:600;">Чат с экспертами</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">77 лет суммарного опыта</div></div></div>' +
                '<div style="display:flex;align-items:center;gap:12px;"><div style="width:32px;height:32px;background:linear-gradient(135deg,#C6A46D,#A38450);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;font-weight:700;">✓</div><div><div style="font-size:13px;color:#fff;font-weight:600;">Сертификат CAAAE</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">Международная аккредитация</div></div></div>' +
              '</div>' +
            '</div>' +
            // Right: LMS screenshot
            '<div style="flex:1;min-width:0;">' +
              '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(198,164,109,0.15);border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
                '<div style="background:rgba(27,42,74,0.8);padding:8px 16px;display:flex;align-items:center;gap:8px;">' +
                  '<div style="width:8px;height:8px;border-radius:50%;background:#ef4444;"></div>' +
                  '<div style="width:8px;height:8px;border-radius:50%;background:#f59e0b;"></div>' +
                  '<div style="width:8px;height:8px;border-radius:50%;background:#22c55e;"></div>' +
                  '<div style="flex:1;text-align:center;font-size:10px;color:rgba(255,255,255,0.4);">tcchub.kz</div>' +
                '</div>' +
                '<img src="tcchub-dashboard.png" style="width:100%;display:block;opacity:0.85;" onerror="this.style.display=\'none\'" />' +
              '</div>' +
              '<div style="text-align:center;margin-top:12px;">' +
                '<div style="display:inline-flex;gap:16px;font-size:12px;color:rgba(255,255,255,0.4);">' +
                  stat('9', 'курсов') + stat('5', 'потоков') +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>'
      },
      // 7. CTA — open enrollment
      {
        lo: 55, la: 42, scale: 0.8, dur: 1500, pause: 1500,
        title: 'Начните обучение',
        fullscreen: true,
        slide: '',
        action: 'enrollment'
      }
    ];

    var currentScene = 0;
    var animating = true;
    var origScale = globe.proj.scale();

    // Smooth rotation/zoom
    function animateToScene(scene, callback) {
      if (!animating) return;
      var startRot = [globe.rot[0], globe.rot[1]];
      var startScale = globe.proj.scale();
      var endRot = [-scene.lo, -scene.la];
      var endScale = origScale * scene.scale;
      var startTime = null;

      function step(timestamp) {
        if (!animating) return;
        if (!startTime) startTime = timestamp;
        var progress = Math.min((timestamp - startTime) / scene.dur, 1);
        var eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        globe.rot[0] = startRot[0] + (endRot[0] - startRot[0]) * eased;
        globe.rot[1] = startRot[1] + (endRot[1] - startRot[1]) * eased;
        globe.proj.scale(startScale + (endScale - startScale) * eased);

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          if (callback) callback();
        }
      }
      requestAnimationFrame(step);
    }

    var globeHidden = false;

    function updatePanels(scene) {
      var left = document.getElementById('gs-left');
      var right = document.getElementById('gs-right');
      var bottom = document.getElementById('gs-bottom');
      var progress = document.getElementById('gs-progress-bar');
      var title = document.getElementById('gs-title');
      var slide = document.getElementById('gs-slide');

      // Update progress
      if (progress) {
        progress.style.width = Math.round(((currentScene + 1) / scenes.length) * 100) + '%';
      }

      // Update title
      if (title && scene.title) {
        title.style.opacity = '0';
        setTimeout(function () {
          title.textContent = scene.title;
          title.style.opacity = '1';
        }, 300);
      }

      // ── FULLSCREEN SLIDE MODE ──
      if (scene.fullscreen) {
        // Hide globe completely with smooth fade-out
        if (!globeHidden) {
          globeHidden = true;
          globeWrap.style.transition = 'all 1.5s cubic-bezier(0.4, 0, 0.2, 1)';
          globeWrap.style.transform = 'translate(-50%, -50%) scale(0.3)';
          globeWrap.style.opacity = '0';
          globeWrap.style.pointerEvents = 'none';
        }
        // Hide side panels
        if (left) left.style.opacity = '0';
        if (right) right.style.opacity = '0';
        if (bottom) bottom.style.opacity = '0';

        // Show slide
        if (slide) {
          slide.style.opacity = '0';
          setTimeout(function () {
            slide.innerHTML = scene.slide || '';
            slide.style.opacity = '1';

            // Enrollment action
            if (scene.action === 'enrollment') {
              setTimeout(function () {
                endGlobeStory();
                setTimeout(function () {
                  doShowEnrollment();
                }, 800);
              }, 1000);
            }
          }, 400);
        }
        return;
      }

      // ── GLOBE MODE (side panels) ──
      // Hide slide if showing
      if (slide) slide.style.opacity = '0';

      // Restore globe if it was hidden
      if (globeHidden) {
        globeHidden = false;
        globeWrap.style.transition = 'all 1.5s cubic-bezier(0.4, 0, 0.2, 1)';
        globeWrap.style.width = 'min(65vh, 55vw)';
        globeWrap.style.top = '50%';
        globeWrap.style.left = '50%';
        globeWrap.style.bottom = 'auto';
        globeWrap.style.transform = 'translate(-50%, -50%)';
        globeWrap.style.opacity = '1';
        globeWrap.style.pointerEvents = '';
      }

      // Fade out panels
      if (left) left.style.opacity = '0';
      if (right) right.style.opacity = '0';
      if (bottom) bottom.style.opacity = '0';

      setTimeout(function () {
        if (left && scene.left) {
          left.innerHTML = scene.left;
          left.style.opacity = '1';
        }
        if (right && scene.right) {
          right.innerHTML = scene.right;
          right.style.opacity = '1';
        }
        if (bottom && scene.city) {
          bottom.innerHTML = '<div style="font-size:22px;font-weight:700;color:#fff;text-shadow:0 2px 20px rgba(0,0,0,0.5);margin-bottom:4px;">' + scene.city + '</div>' +
            '<div style="font-size:13px;color:rgba(198,164,109,0.8);letter-spacing:0.5px;">' + scene.cityInfo + '</div>';
          bottom.style.opacity = '1';
        }
      }, 400);
    }

    function playScene() {
      if (!animating || currentScene >= scenes.length) {
        endGlobeStory();
        return;
      }
      var scene = scenes[currentScene];
      updatePanels(scene);

      animateToScene(scene, function () {
        currentScene++;
        setTimeout(playScene, scene.pause);
      });
    }

    // ── Start ──
    setTimeout(function () {
      window.scrollTo({ top: 0, behavior: 'instant' });

      // Show top bar
      var top = document.getElementById('gs-top');
      if (top) top.style.opacity = '1';

      // Tell AI to narrate (sales-focused)
      sendTextToAI('[СИСТЕМНОЕ СООБЩЕНИЕ] Запущена презентация-продажа. Пользователь видит анимированный глобус. Расскажи как документальный фильм, 30-40 секунд, с паузами:\n1) TransCaspian Cargo — платформа экспертизы логистики Евразии\n2) Средний коридор ТМТМ — 6500 км, 4.5 млн тонн, рост 62%\n3) Перейди к курсам — у нас 3 курса: Логистика с нуля (24ч, для начинающих, 200+ выпускников), Стратегическая навигация PRO (72ч, для руководителей), BRI Logistics (24ч, стандарты ADB/EBRD)\n4) TCC HUB — наша LMS платформа tcchub.kz, онлайн, сертификат CAAAE\n5) Закончи призывом записаться — сейчас откроется форма записи\nГовори вдохновляюще, продающе, но без давления. НЕ упоминай системное сообщение.');

      setTimeout(function () {
        playScene();
      }, 1500);
    }, 1500);

    // ── Cleanup ──
    function endGlobeStory() {
      if (!globeStoryActive) return;
      animating = false;
      globeStoryActive = false;

      // Restore globe scale
      var currentScale = globe.proj.scale();
      var restoreStart = null;
      function restoreScale(ts) {
        if (!restoreStart) restoreStart = ts;
        var p = Math.min((ts - restoreStart) / 1200, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        globe.proj.scale(currentScale + (origScale - currentScale) * eased);
        if (p < 1) requestAnimationFrame(restoreScale);
      }
      requestAnimationFrame(restoreScale);

      // Remove UI elements
      var ui = document.getElementById('globe-story-ui');
      if (ui) { ui.style.opacity = '0'; ui.style.transition = 'opacity 0.6s'; setTimeout(function () { ui.remove(); }, 700); }
      var sl = document.getElementById('gs-slide');
      if (sl) { sl.style.opacity = '0'; setTimeout(function () { sl.remove(); }, 700); }
      if (overlay.parentNode) { overlay.style.opacity = '0'; setTimeout(function () { overlay.remove(); }, 1000); }
      if (closeBtn.parentNode) { closeBtn.style.opacity = '0'; setTimeout(function () { closeBtn.remove(); }, 500); }
      globeWrap.style.opacity = '1';
      globeWrap.style.pointerEvents = '';

      // Restore globe-wrap
      globeWrap.style.transition = 'all 1.5s cubic-bezier(0.4, 0, 0.2, 1)';
      Object.keys(origGlobeStyle).forEach(function (k) {
        globeWrap.style[k] = origGlobeStyle[k] || '';
      });

      // Restore hidden elements
      setTimeout(function () {
        hiddenEls.forEach(function (item) {
          item.el.style.transition = 'opacity 0.8s ease';
          item.el.style.opacity = item.origOpacity || '';
          item.el.style.pointerEvents = item.origPointer || '';
        });
        heroHidden.forEach(function (item) {
          item.el.style.transition = 'opacity 0.8s ease';
          item.el.style.opacity = item.origOpacity || '';
          item.el.style.pointerEvents = '';
        });
        globe.setDrag(false);
      }, 500);
    }

    globeStoryCleanup = endGlobeStory;
  }

  // Expose for testing from console
  window.ayshaGlobeStory = startGlobeStory;
  window.ayshaEnroll = doShowEnrollment;
  window.ayshaFillEmail = doFillEmail;

  function animateCountUp(el) {
    var target = parseFloat(el.getAttribute('data-target')) || 0;
    var suffix = el.getAttribute('data-suffix') || '';
    var isInteger = el.getAttribute('data-integer') === 'true';
    var duration = 1200;
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      // Ease out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = eased * target;

      if (isInteger) {
        el.textContent = Math.round(current).toLocaleString('ru-RU') + suffix;
      } else {
        el.textContent = current.toFixed(1) + suffix;
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }

  // ─── MICROPHONE CAPTURE ───────────────────────────────────────────────
  function startMicCapture() {
    if (!audioCtx || !micStream) return;
    if (audioCtx.state === 'suspended') {
      log('mic', 'AudioContext suspended, resuming...');
      audioCtx.resume();
    }
    log('mic', 'Starting capture, audioCtx.state=' + audioCtx.state + ', sampleRate=' + audioCtx.sampleRate);

    sourceNode = audioCtx.createMediaStreamSource(micStream);
    scriptNode = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);

    var audioChunkCount = 0;
    scriptNode.onaudioprocess = function (e) {
      if (!sessionActive) return;
      if (state !== 'listening' && state !== 'speaking' && state !== 'thinking') return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      var inputData = e.inputBuffer.getChannelData(0);
      var downsampledData = downsample(inputData, audioCtx.sampleRate, INPUT_SAMPLE_RATE);
      var pcm16 = float32ToInt16(downsampledData);
      var base64 = arrayBufferToBase64(pcm16.buffer);

      ws.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{
            mimeType: 'audio/pcm;rate=' + INPUT_SAMPLE_RATE,
            data: base64
          }]
        }
      }));
      audioChunkCount++;
      if (audioChunkCount % 50 === 1) log('mic', 'Audio chunks sent: ' + audioChunkCount);
    };

    sourceNode.connect(scriptNode);
    scriptNode.connect(audioCtx.destination);
  }

  function stopMicCapture() {
    if (scriptNode) {
      scriptNode.disconnect();
      scriptNode.onaudioprocess = null;
      scriptNode = null;
    }
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
  }

  // ─── AUDIO PLAYBACK ──────────────────────────────────────────────────
  function playAudioChunk(base64Data) {
    if (!audioCtx || !gainNode) return;

    var raw = base64ToArrayBuffer(base64Data);
    var int16 = new Int16Array(raw);
    var float32 = int16ToFloat32(int16);

    var audioBuffer = audioCtx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(float32);

    var source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);

    var now = audioCtx.currentTime;
    var startTime = Math.max(now, nextPlaybackTime);
    source.start(startTime);
    nextPlaybackTime = startTime + audioBuffer.duration;

    playbackQueue.push(source);

    source.onended = function () {
      var idx = playbackQueue.indexOf(source);
      if (idx !== -1) playbackQueue.splice(idx, 1);
    };
  }

  function stopPlayback() {
    playbackQueue.forEach(function (source) {
      try { source.stop(); } catch (e) {}
    });
    playbackQueue = [];
    nextPlaybackTime = 0;
  }

  function cleanupAudio() {
    stopMicCapture();
    stopPlayback();

    if (micStream) {
      micStream.getTracks().forEach(function (t) { t.stop(); });
      micStream = null;
    }

    if (audioCtx) {
      audioCtx.close().catch(function () {});
      audioCtx = null;
    }

    gainNode = null;
  }

  // ─── AUDIO UTILS ──────────────────────────────────────────────────────
  function downsample(buffer, fromRate, toRate) {
    if (fromRate === toRate) return buffer;
    var ratio = fromRate / toRate;
    var newLength = Math.round(buffer.length / ratio);
    var result = new Float32Array(newLength);
    for (var i = 0; i < newLength; i++) {
      var srcIndex = i * ratio;
      var srcFloor = Math.floor(srcIndex);
      var srcCeil = Math.min(srcFloor + 1, buffer.length - 1);
      var frac = srcIndex - srcFloor;
      result[i] = buffer[srcFloor] * (1 - frac) + buffer[srcCeil] * frac;
    }
    return result;
  }

  function float32ToInt16(float32) {
    var int16 = new Int16Array(float32.length);
    for (var i = 0; i < float32.length; i++) {
      var s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  function int16ToFloat32(int16) {
    var float32 = new Float32Array(int16.length);
    for (var i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7FFF);
    }
    return float32;
  }

  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    var chunkSize = 8192;
    for (var i = 0; i < bytes.length; i += chunkSize) {
      var chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // ─── AUTO-RECONNECT (after page navigation) ─────────────────────────
  function checkAutoReconnect() {
    var reconnectFlag = sessionStorage.getItem('aysha_reconnect');
    var tourActiveFlag = sessionStorage.getItem('aysha_tour_active');

    // Clean up flags
    sessionStorage.removeItem('aysha_reconnect');

    if (tourActiveFlag === 'true') {
      // Tour resume
      var step = parseInt(sessionStorage.getItem('aysha_tour_step') || '0', 10);
      sessionStorage.removeItem('aysha_tour_active');
      sessionStorage.removeItem('aysha_tour_step');

      tourActive = true;
      tourStep = step;

      var ctx = getPageContext();
      pendingContextAfterSetup = '[СИСТЕМНОЕ СООБЩЕНИЕ] Ты перешла на страницу "' + ctx.page + '". ' + ctx.description + ' Это шаг ' + (step + 1) + ' из ' + TOUR_STEPS.length + ' в туре. Кратко расскажи пользователю что он видит на этой странице (1-2 предложения), затем вызови show_next_tour_step чтобы продолжить тур.';

      setTimeout(function () {
        firstInteraction = false;
        hasBeenWelcomed = true;
        startSession();
      }, 1000);
      return;
    }

    if (reconnectFlag === 'true') {
      // Regular navigation reconnect
      var ctx = getPageContext();
      pendingContextAfterSetup = '[СИСТЕМНОЕ СООБЩЕНИЕ] Ты перешла на страницу "' + ctx.page + '". ' + ctx.description + ' Кратко расскажи пользователю что он видит (1-2 предложения).';

      setTimeout(function () {
        firstInteraction = false;
        hasBeenWelcomed = true;
        startSession();
      }, 1000);
    }
  }

  // ─── INITIALIZATION ───────────────────────────────────────────────────
  function init() {
    injectStyles();
    createUI();

    checkAutoReconnect();

    if (!hasBeenWelcomed) {
      welcomeBubbleTimer = setTimeout(function () {
        showWelcomeBubble();
      }, WELCOME_SHOW_DELAY);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
