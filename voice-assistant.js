/**
 * TCC Voice Assistant "Айша" — Complete Rewrite
 * Gemini 2.5 Flash Native Audio — Production Quality
 * Includes: Cinematic Presentation Mode
 * Self-contained IIFE: injects all CSS/HTML, handles WebSocket, audio, UI
 */
(function () {
  'use strict';

  // ─── CONFIG ───────────────────────────────────────────────────────────
  const API_KEY = 'AIzaSyBxHoUTPAWV1wWiKGD9AMZil8J9Ag5aQII';
  const MODEL = 'gemini-2.5-flash-native-audio-latest';
  const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

  const INPUT_SAMPLE_RATE = 16000;
  const OUTPUT_SAMPLE_RATE = 24000;
  const BUFFER_SIZE = 2048;
  const SILENCE_TIMEOUT = 15000;
  const WELCOME_SHOW_DELAY = 2000;
  const WELCOME_FADE_DELAY = 10000;
  const RECONNECT_DELAY = 5000;
  const TOUR_STEP_DELAY = 2500;

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
  let silenceTimer = null;
  let tourActive = false;
  let tourStep = 0;
  let hasBeenWelcomed = localStorage.getItem('tcc_welcomed') === 'true';
  let firstInteraction = !hasBeenWelcomed;
  let reconnectTimer = null;
  let welcomeBubbleTimer = null;
  let welcomeFadeTimer = null;
  let nextPlaybackTime = 0;
  let cinematicResolve = null;

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
- Когда просят рассказать О КОМПАНИИ → вызови show_cinematic type=company, затем отвечай
- Когда просят показать МАРШРУТ/КОРИДОР → вызови show_cinematic type=corridor, затем navigate corridor.html
- Когда просят КУРСЫ → вызови show_cinematic type=course
- Когда просят КОМАНДУ → вызови show_cinematic type=team
- Когда просят СТАТИСТИКУ → вызови show_cinematic type=stats
- Когда просят ЗАПИСАТЬСЯ → вызови open_external с https://tcchub.kz
- Когда просят СВЯЗАТЬСЯ → вызови open_external с https://wa.link/wrcagw
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
          description: 'Show an animated cinematic presentation. Types: company (about the company), corridor (Middle Corridor route), course (education courses), stats (key statistics), team (expert team).',
          parameters: {
            type: 'OBJECT',
            properties: {
              type: {
                type: 'STRING',
                description: 'Type of cinematic: company, corridor, course, stats, team'
              }
            },
            required: ['type']
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
      <p class="welcome-text">Привет! Я Айша \u2014 ваш голосовой гид \uD83D\uDC4B</p>
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

  // ─── SILENCE TIMER ────────────────────────────────────────────────────
  function startSilenceTimer() {
    resetSilenceTimer();
    silenceTimer = setTimeout(function () {
      if (state === 'listening') {
        setState('idle');
      }
    }, SILENCE_TIMEOUT);
  }

  function resetSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  // ─── BUTTON CLICK HANDLER ─────────────────────────────────────────────
  function onButtonClick() {
    dismissWelcome();

    if (state === 'idle' || state === 'error') {
      if (firstInteraction) {
        showPermissionDialog();
      } else {
        startSession();
      }
    } else if (state === 'listening' || state === 'speaking' || state === 'thinking') {
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
      console.error('[Aysha] Mic error:', err);
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

    if (ws && ws.readyState === WebSocket.OPEN) {
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
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          tools: TOOLS,
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_OF_SPEECH_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_OF_SPEECH_SENSITIVITY_HIGH',
              prefixPaddingMs: 200,
              silenceDurationMs: 700
            }
          }
        }
      };

      ws.send(JSON.stringify(setupMsg));
    };

    ws.onmessage = function (event) {
      handleWsMessage(event);
    };

    ws.onerror = function (err) {
      console.error('[Aysha] WS error:', err);
    };

    ws.onclose = function (event) {
      console.log('[Aysha] WS closed, code:', event.code);
      if (state !== 'idle' && state !== 'error') {
        showToast('Ошибка соединения', 4000);
        setState('error');
        cleanupAudio();
        reconnectTimer = setTimeout(function () {
          if (state === 'error') {
            startSession();
          }
        }, RECONNECT_DELAY);
      }
    };
  }

  function handleWsMessage(event) {
    if (typeof event.data === 'string') {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      if (msg.setupComplete) {
        startMicCapture();
        setState('listening');
        if (!hasBeenWelcomed) {
          hasBeenWelcomed = true;
          localStorage.setItem('tcc_welcomed', 'true');
        }
        return;
      }

      if (msg.serverContent) {
        handleServerContent(msg.serverContent);
      }

      if (msg.toolCall) {
        handleToolCall(msg.toolCall);
      }
    }
  }

  function handleServerContent(content) {
    if (content.turnComplete) {
      setTimeout(function () {
        if (state === 'speaking' || state === 'thinking') {
          setState('listening');
          startSilenceTimer();
        }
      }, 300);
      return;
    }

    if (content.interrupted) {
      stopPlayback();
      setState('listening');
      return;
    }

    if (content.modelTurn && content.modelTurn.parts) {
      content.modelTurn.parts.forEach(function (part) {
        if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.indexOf('audio') !== -1) {
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
    var validTypes = ['company', 'corridor', 'course', 'stats', 'team'];
    if (validTypes.indexOf(type) === -1) {
      return { success: false, error: 'Invalid cinematic type: ' + type };
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

    sourceNode = audioCtx.createMediaStreamSource(micStream);
    scriptNode = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);

    scriptNode.onaudioprocess = function (e) {
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

  // ─── TOUR RESUME (after page navigation) ──────────────────────────────
  function checkTourResume() {
    var tourActiveFlag = sessionStorage.getItem('aysha_tour_active');
    if (tourActiveFlag === 'true') {
      var step = parseInt(sessionStorage.getItem('aysha_tour_step') || '0', 10);
      sessionStorage.removeItem('aysha_tour_active');
      sessionStorage.removeItem('aysha_tour_step');

      tourActive = true;
      tourStep = step;

      setTimeout(function () {
        firstInteraction = false;
        hasBeenWelcomed = true;
        startSession();
      }, 1500);
    }
  }

  // ─── INITIALIZATION ───────────────────────────────────────────────────
  function init() {
    injectStyles();
    createUI();

    checkTourResume();

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
