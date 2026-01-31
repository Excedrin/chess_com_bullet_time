// ==UserScript==
// @name         Chess.com - Bullet Time
// @namespace    http://tampermonkey.net/
// @version      17.0
// @description  Make running low on time much more visible by altering the color of the board, adding glow, floating the clock, showing the clock diff.
// @author       Excedrin
// @match        https://www.chess.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                     CONFIGURATION                              ║
    // ╚═══════════════════════════════════════════════════════════════╝

    const CONFIG = {
        // ─── Position Thresholds (Delta in seconds) ───
        // Controls COLOR (green → neutral → red)
        // TIGHTENED for bullet chess where every second matters
        POSITION: {
            DOMINATING: 5,      // +5s or more = clearly winning
            AHEAD: 2,           // +2s to +5s = comfortable lead
            EVEN: 1,            // ±1s = effectively even
            BEHIND: -2.5,       // -1s to -2.5s = need to speed up
            // Below -2.5s = LOSING (red)
        },

        // ─── Urgency Thresholds (Absolute seconds) ───
        // Controls INTENSITY (subtle → screaming)
        URGENCY: {
            RELAXED: 25,        // >25s = calm
            ALERT: 15,          // 15-25s = stay sharp
            HIGH: 8,            // 8-15s = move quickly
            CRITICAL: 4,        // 4-8s = very fast moves
            PREMOVE: 2,         // <2s = premove territory
        },

        // ─── Budget System ───
        BUDGET: {
            BASE_MOVES_ESTIMATE: 35,
            MIN_MOVES_ESTIMATE: 8,
            SAFETY_FACTOR: 0.85,
            SCRAMBLE_THRESHOLD: 10,
            SCRAMBLE_BUDGET: 0.5,
        },

        // ─── Move Rating (ratio of budget) ───
        MOVE_RATING: {
            PREMOVE: 0.15,
            EXCELLENT: 0.5,
            GOOD: 1.0,
            SLOW: 1.5,
            COSTLY: 2.5,
        },

        // ─── Momentum ───
        MOMENTUM: {
            WINDOW: 5,
            GAINING_THRESHOLD: 0.5,
            LOSING_THRESHOLD: 1.4,
        },

        // ─── Board Square Colors (RGB) ───
        // These define the gradient from LOSING → EVEN → WINNING
        BOARD: {
            // Light squares
            LIGHT_AHEAD:   { r: 220, g: 240, b: 210 },  // Slight green tint
            LIGHT_DEFAULT: { r: 235, g: 236, b: 208 },  // #EBECD0
            LIGHT_BEHIND:  { r: 245, g: 220, b: 210 },  // Slight red/warm tint

            // Dark squares
            DARK_AHEAD:    { r: 85,  g: 160, b: 95  },  // Green #55a05f
            DARK_DEFAULT:  { r: 115, g: 149, b: 82  },  // #739552
            DARK_BEHIND:   { r: 165, g: 100, b: 80  },  // Red-brown #a56450
        },

        // ─── Visual Settings ───
        FEEDBACK_DURATION: 2500,
        HUD_SCALE: 1.0,
        UPDATE_INTERVAL: 50,

        // ─── Board Color Settings ───
        BOARD_COLOR_ENABLED: true,
        BOARD_MAX_DELTA: 8,     // Delta at which board color is fully shifted

        DEBUG: false,
    };

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                        STATE                                   ║
    // ╚═══════════════════════════════════════════════════════════════╝

    const state = {
        prevUserSeconds: null,
        prevOppSeconds: null,
        turnStartTime: null,
        userClockWasTicking: false,
        oppClockWasTicking: false,
        moveHistory: [],
        moveCount: 0,
        lastMoveData: null,
        lastMoveTimestamp: 0,
        oppLastMoveTime: 0,
        lastMoveListLength: 0,
        currentPosition: 'EVEN',
        currentUrgency: 'RELAXED',
        boardStyleInjected: false,
    };

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                     COLOR SYSTEM                               ║
    // ╚═══════════════════════════════════════════════════════════════╝

    const POSITION_COLORS = {
        DOMINATING: {
            hud: { bg: '#152515', border: '#2a9a2a', text: '#55ff77' },
            vignette: 'rgba(0, 220, 80, ',
            delta: '#00ff55',
        },
        AHEAD: {
            hud: { bg: '#1a2a1a', border: '#2a6a2a', text: '#77dd88' },
            vignette: 'rgba(0, 180, 80, ',
            delta: '#55cc66',
        },
        EVEN: {
            hud: { bg: '#1a1a18', border: '#3a3a38', text: '#cccccc' },
            vignette: 'rgba(100, 100, 80, ',
            delta: '#888888',
        },
        BEHIND: {
            hud: { bg: '#2a2010', border: '#aa7030', text: '#ffbb55' },
            vignette: 'rgba(240, 150, 0, ',
            delta: '#ffaa33',
        },
        LOSING: {
            hud: { bg: '#2a1210', border: '#cc4030', text: '#ff8866' },
            vignette: 'rgba(240, 60, 20, ',
            delta: '#ff5533',
        },
    };

    const URGENCY_INTENSITY = {
        RELAXED:  { opacity: 0.50, vignetteAlpha: 0.00, pulseClass: '',            glowSize: 0 },
        ALERT:    { opacity: 0.70, vignetteAlpha: 0.10, pulseClass: '',            glowSize: 0 },
        HIGH:     { opacity: 0.85, vignetteAlpha: 0.18, pulseClass: 'pulse-slow',  glowSize: 12 },
        CRITICAL: { opacity: 1.00, vignetteAlpha: 0.28, pulseClass: 'pulse-medium', glowSize: 22 },
        PREMOVE:  { opacity: 1.00, vignetteAlpha: 0.42, pulseClass: 'pulse-fast',  glowSize: 35 },
    };

    const MOVE_COLORS = {
        PREMOVE:   { icon: '⚡', intensity: 1.0 },
        EXCELLENT: { icon: '✦',  intensity: 0.8 },
        GOOD:      { icon: '✓',  intensity: 0.4 },
        SLOW:      { icon: '⏱',  intensity: 0.6 },
        COSTLY:    { icon: '⚠',  intensity: 0.8 },
        CRITICAL:  { icon: '⛔', intensity: 1.0 },
    };

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                     CSS INJECTION                              ║
    // ╚═══════════════════════════════════════════════════════════════╝

    GM_addStyle(`
        /* Hide native clocks */
        #board-layout-player-top .clock-component,
        #board-layout-player-bottom .clock-component {
            position: absolute !important;
            top: -9999px !important;
            left: -9999px !important;
            width: 1px !important;
            height: 1px !important;
            overflow: hidden !important;
            pointer-events: none !important;
        }

        #board-layout-player-top,
        #board-layout-player-bottom {
            justify-content: center !important;
        }

        /* ═══════════════════════════════════════════════════════════
           THE HUD
           ═══════════════════════════════════════════════════════════ */
        #bullet-hud {
            position: fixed;
            z-index: 9001;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background-color: #1a1a18;
            border: 3px solid #3a3a38;
            border-radius: 12px;
            padding: 14px 22px;
            pointer-events: none;
            transition: all 0.3s ease;
            top: 50%;
            transform: translateY(-50%) scale(${CONFIG.HUD_SCALE});
            transform-origin: center left;
            left: 90px;
        }

        body.theatre-mode #bullet-hud { left: 30px; }

        #hud-top-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 4px;
        }

        #hud-opponent-time {
            font-family: 'JetBrains Mono', 'SF Mono', monospace;
            font-size: 1.7rem;
            font-weight: 600;
            color: #666;
            line-height: 1;
        }

        #hud-delta {
            font-family: 'JetBrains Mono', monospace;
            font-size: 1.4rem;
            font-weight: bold;
            color: #888;
            background: rgba(0,0,0,0.3);
            padding: 3px 10px;
            border-radius: 5px;
            transition: color 0.3s ease;
        }

        #hud-momentum {
            font-size: 1.3rem;
            transition: color 0.3s ease;
        }

        #hud-user-time {
            font-family: 'JetBrains Mono', 'SF Mono', monospace;
            font-size: 4.2rem;
            font-weight: 800;
            color: #ccc;
            line-height: 0.9;
            text-shadow: 2px 2px 0px rgba(0,0,0,0.4);
            transition: color 0.3s ease, text-shadow 0.3s ease;
        }

        #hud-urgency-bar {
            width: 100%;
            height: 4px;
            background: rgba(0,0,0,0.3);
            border-radius: 2px;
            margin-top: 10px;
            overflow: hidden;
        }

        #hud-urgency-fill {
            height: 100%;
            border-radius: 2px;
            transition: all 0.3s ease;
        }

        #hud-budget {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 8px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.9rem;
            color: #666;
        }

        #hud-budget-value {
            font-weight: bold;
            color: #888;
        }

        #hud-move-feedback {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 10px;
            padding: 5px 14px;
            border-radius: 6px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 1rem;
            font-weight: 600;
            background: rgba(0,0,0,0.2);
            color: #888;
            opacity: 0;
            transform: translateY(5px);
            transition: all 0.2s ease;
        }

        #hud-move-feedback.visible {
            opacity: 1;
            transform: translateY(0);
        }

        #hud-flash {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            border-radius: 10px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.1s ease-out;
        }

        #pace-vignette {
            position: fixed;
            top: 0; left: 0;
            width: 100vw; height: 100vh;
            pointer-events: none;
            z-index: 9000;
            transition: box-shadow 0.4s ease-in-out;
        }

        @keyframes pulse-slow {
            0%, 100% { transform: translateY(-50%) scale(${CONFIG.HUD_SCALE}); }
            50% { transform: translateY(-50%) scale(${CONFIG.HUD_SCALE * 1.02}); }
        }
        @keyframes pulse-medium {
            0%, 100% { transform: translateY(-50%) scale(${CONFIG.HUD_SCALE}); opacity: 1; }
            50% { transform: translateY(-50%) scale(${CONFIG.HUD_SCALE * 1.03}); opacity: 0.92; }
        }
        @keyframes pulse-fast {
            0%, 100% { transform: translateY(-50%) scale(${CONFIG.HUD_SCALE}); opacity: 1; }
            50% { transform: translateY(-50%) scale(${CONFIG.HUD_SCALE * 1.05}); opacity: 0.85; }
        }

        #bullet-hud.pulse-slow { animation: pulse-slow 2s ease-in-out infinite; }
        #bullet-hud.pulse-medium { animation: pulse-medium 0.8s ease-in-out infinite; }
        #bullet-hud.pulse-fast { animation: pulse-fast 0.4s ease-in-out infinite; }
    `);

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                     DOM SETUP                                  ║
    // ╚═══════════════════════════════════════════════════════════════╝

    const vignette = document.createElement('div');
    vignette.id = 'pace-vignette';
    document.body.appendChild(vignette);

    const hud = document.createElement('div');
    hud.id = 'bullet-hud';
    hud.innerHTML = `
        <div id="hud-flash"></div>
        <div id="hud-top-row">
            <span id="hud-opponent-time">--:--</span>
            <span id="hud-delta">+0.0</span>
            <span id="hud-momentum">●</span>
        </div>
        <div id="hud-user-time">--:--</div>
        <div id="hud-urgency-bar"><div id="hud-urgency-fill"></div></div>
        <div id="hud-budget">
            <span>budget:</span>
            <span id="hud-budget-value">--</span>
        </div>
        <div id="hud-move-feedback">
            <span class="rating-icon"></span>
            <span class="rating-text"></span>
        </div>
    `;
    document.body.appendChild(hud);

    // Create a style element for dynamic board coloring
    const boardStyleEl = document.createElement('style');
    boardStyleEl.id = 'pacer-board-style';
    document.head.appendChild(boardStyleEl);

    const els = {
        hud,
        flash: document.getElementById('hud-flash'),
        oppTime: document.getElementById('hud-opponent-time'),
        delta: document.getElementById('hud-delta'),
        momentum: document.getElementById('hud-momentum'),
        userTime: document.getElementById('hud-user-time'),
        urgencyFill: document.getElementById('hud-urgency-fill'),
        budgetValue: document.getElementById('hud-budget-value'),
        moveFeedback: document.getElementById('hud-move-feedback'),
        feedbackIcon: hud.querySelector('.rating-icon'),
        feedbackText: hud.querySelector('.rating-text'),
        vignette,
        boardStyle: boardStyleEl,
    };

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                     UTILITIES                                  ║
    // ╚═══════════════════════════════════════════════════════════════╝

    function parseTimeToSeconds(timeStr) {
        if (!timeStr) return 9999;
        timeStr = timeStr.trim();
        const parts = timeStr.split(':');
        let seconds = 0;
        if (parts.length === 3) {
            seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
        } else if (parts.length === 2) {
            seconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
        } else {
            seconds = parseFloat(parts[0]);
        }
        return isNaN(seconds) ? 9999 : seconds;
    }

    function formatDelta(seconds) {
        const sign = seconds >= 0 ? '+' : '';
        return `${sign}${seconds.toFixed(1)}`;
    }

    function formatBudget(seconds) {
        return seconds < 1 ? `${(seconds * 1000).toFixed(0)}ms` : `${seconds.toFixed(1)}s`;
    }

    function lerp(a, b, t) {
        return a + (b - a) * Math.max(0, Math.min(1, t));
    }

    function lerpColor(c1, c2, t) {
        return {
            r: Math.round(lerp(c1.r, c2.r, t)),
            g: Math.round(lerp(c1.g, c2.g, t)),
            b: Math.round(lerp(c1.b, c2.b, t)),
        };
    }

    function rgbToString(c) {
        return `rgb(${c.r}, ${c.g}, ${c.b})`;
    }

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                   POSITION & URGENCY                           ║
    // ╚═══════════════════════════════════════════════════════════════╝

    function getPosition(delta) {
        const P = CONFIG.POSITION;
        if (delta >= P.DOMINATING) return 'DOMINATING';
        if (delta >= P.AHEAD) return 'AHEAD';
        if (delta >= -P.EVEN && delta <= P.EVEN) return 'EVEN';
        if (delta >= P.BEHIND) return 'BEHIND';
        return 'LOSING';
    }

    function getUrgency(seconds) {
        const U = CONFIG.URGENCY;
        if (seconds > U.RELAXED) return 'RELAXED';
        if (seconds > U.ALERT) return 'ALERT';
        if (seconds > U.HIGH) return 'HIGH';
        if (seconds > U.CRITICAL) return 'CRITICAL';
        return 'PREMOVE';
    }

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                   BOARD SQUARE COLORING                        ║
    // ╚═══════════════════════════════════════════════════════════════╝

    function updateBoardColors(delta) {
        if (!CONFIG.BOARD_COLOR_ENABLED) return;

        const B = CONFIG.BOARD;
        const maxDelta = CONFIG.BOARD_MAX_DELTA;

        // Normalize delta to -1 (losing) to +1 (winning)
        const normalizedDelta = Math.max(-1, Math.min(1, delta / maxDelta));

        let lightColor, darkColor;

        if (normalizedDelta >= 0) {
            lightColor = lerpColor(B.LIGHT_DEFAULT, B.LIGHT_AHEAD, normalizedDelta);
            darkColor = lerpColor(B.DARK_DEFAULT, B.DARK_AHEAD, normalizedDelta);
        } else {
            const t = Math.abs(normalizedDelta);
            lightColor = lerpColor(B.LIGHT_DEFAULT, B.LIGHT_BEHIND, t);
            darkColor = lerpColor(B.DARK_DEFAULT, B.DARK_BEHIND, t);
        }

        const lightRgb = rgbToString(lightColor);
        const darkRgb = rgbToString(darkColor);

        // Generate the conic-gradient checkerboard
        // Each conic-gradient "tile" is a 2x2 block of squares
        // For 8x8 board: need 4 tiles across × 4 tiles down = 25% each
        const css = `
        #board-single,
        .board,
        wc-chess-board {
            background-image: conic-gradient(
                ${darkRgb} 90deg,
                ${lightRgb} 90deg 180deg,
                ${darkRgb} 180deg 270deg,
                ${lightRgb} 270deg
            ) !important;
            background-size: 25% 25% !important;
            background-repeat: repeat !important;
            background-position: 0 0 !important;
        }
    `;

        els.boardStyle.textContent = css;

        if (CONFIG.DEBUG) {
            console.log(`[Board] Delta: ${delta.toFixed(1)}, Light: ${lightRgb}, Dark: ${darkRgb}`);
        }
    }

    function resetBoardColors() {
        els.boardStyle.textContent = '';
    }

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                   BUDGET & MOVE RATING                         ║
    // ╚═══════════════════════════════════════════════════════════════╝

    function calculateBudget(remainingSeconds) {
        const B = CONFIG.BUDGET;
        if (remainingSeconds <= B.SCRAMBLE_THRESHOLD) {
            return B.SCRAMBLE_BUDGET;
        }
        const timeRatio = remainingSeconds / 60;
        const estimatedMoves = Math.max(B.MIN_MOVES_ESTIMATE, Math.round(B.BASE_MOVES_ESTIMATE * Math.sqrt(timeRatio)));
        return (remainingSeconds / estimatedMoves) * B.SAFETY_FACTOR;
    }

    function rateMove(timeSpent, budget) {
        const ratio = budget > 0 ? timeSpent / budget : 999;
        const R = CONFIG.MOVE_RATING;

        let rating;
        if (ratio <= R.PREMOVE) rating = 'PREMOVE';
        else if (ratio <= R.EXCELLENT) rating = 'EXCELLENT';
        else if (ratio <= R.GOOD) rating = 'GOOD';
        else if (ratio <= R.SLOW) rating = 'SLOW';
        else if (ratio <= R.COSTLY) rating = 'COSTLY';
        else rating = 'CRITICAL';

        return { rating, ratio, timeSpent, budget, ...MOVE_COLORS[rating] };
    }

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                   MOMENTUM                                     ║
    // ╚═══════════════════════════════════════════════════════════════╝

    function addMoveToHistory(moveData) {
        state.moveHistory.push({ ...moveData, timestamp: Date.now() });
        if (state.moveHistory.length > CONFIG.MOMENTUM.WINDOW) {
            state.moveHistory.shift();
        }
    }

    function getMomentum() {
        if (state.moveHistory.length < 2) return 'NEUTRAL';
        const avgRatio = state.moveHistory.reduce((sum, m) => sum + m.ratio, 0) / state.moveHistory.length;
        if (avgRatio < CONFIG.MOMENTUM.GAINING_THRESHOLD) return 'GAINING';
        if (avgRatio > CONFIG.MOMENTUM.LOSING_THRESHOLD) return 'LOSING';
        return 'NEUTRAL';
    }

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                     VISUAL UPDATES                             ║
    // ╚═══════════════════════════════════════════════════════════════╝

    function updateVisuals(position, urgency, delta, userSec) {
        const posColors = POSITION_COLORS[position];
        const urgIntensity = URGENCY_INTENSITY[urgency];

        // ─── HUD Styling ───
        els.hud.style.opacity = urgIntensity.opacity;
        els.hud.style.backgroundColor = posColors.hud.bg;
        els.hud.style.borderColor = posColors.hud.border;
        els.userTime.style.color = posColors.hud.text;
        els.delta.style.color = posColors.delta;

        // Glow
        if (urgIntensity.glowSize > 0) {
            const glowColor = posColors.vignette + '0.5)';
            els.hud.style.boxShadow = `0 8px 25px rgba(0,0,0,0.7), 0 0 ${urgIntensity.glowSize}px ${glowColor}`;
        } else {
            els.hud.style.boxShadow = '0 8px 25px rgba(0,0,0,0.7)';
        }

        // ─── Pulse Animation ───
        els.hud.classList.remove('pulse-slow', 'pulse-medium', 'pulse-fast');
        if (urgIntensity.pulseClass) {
            els.hud.classList.add(urgIntensity.pulseClass);
        }

        // ─── Vignette ───
        if (urgIntensity.vignetteAlpha > 0) {
            const vignetteColor = posColors.vignette + urgIntensity.vignetteAlpha + ')';
            const spread = 60 + urgIntensity.vignetteAlpha * 250;
            const blur = 80 + urgIntensity.vignetteAlpha * 200;
            els.vignette.style.boxShadow = `inset 0 0 ${blur}px ${spread}px ${vignetteColor}`;
        } else {
            els.vignette.style.boxShadow = 'none';
        }

        // ─── Urgency Bar ───
        const maxUrgencyTime = CONFIG.URGENCY.RELAXED;
        const urgencyPercent = Math.min(100, (userSec / maxUrgencyTime) * 100);
        els.urgencyFill.style.width = `${urgencyPercent}%`;
        els.urgencyFill.style.backgroundColor = posColors.hud.text;

        // ─── Momentum ───
        const momentum = getMomentum();
        if (momentum === 'GAINING') {
            els.momentum.innerText = '▲';
            els.momentum.style.color = posColors.delta;
        } else if (momentum === 'LOSING') {
            els.momentum.innerText = '▼';
            els.momentum.style.color = (position === 'EVEN' || position === 'BEHIND' || position === 'LOSING')
                ? '#ffaa44'
                : posColors.hud.text;
        } else {
            els.momentum.innerText = '●';
            els.momentum.style.color = '#666';
        }

        // ─── Board Colors ───
        updateBoardColors(delta);
    }

    function showMoveFeedback(moveData, position) {
        const { rating, timeSpent, budget, icon, ratio } = moveData;
        const posColors = POSITION_COLORS[position];
        const isGoodMove = ratio <= 1.0;

        let text;
        if (rating === 'PREMOVE') {
            text = 'instant';
        } else if (isGoodMove) {
            text = `${timeSpent.toFixed(1)}s (${Math.round(ratio * 100)}%)`;
        } else {
            text = `${timeSpent.toFixed(1)}s (+${(timeSpent - budget).toFixed(1)}s)`;
        }

        els.feedbackIcon.innerText = icon;
        els.feedbackText.innerText = text;

        if (isGoodMove || position === 'BEHIND' || position === 'LOSING') {
            els.moveFeedback.style.color = posColors.hud.text;
            els.moveFeedback.style.backgroundColor = posColors.vignette + '0.3)';
        } else {
            els.moveFeedback.style.color = '#dddd88';
            els.moveFeedback.style.backgroundColor = 'rgba(180, 180, 80, 0.25)';
        }

        els.moveFeedback.classList.add('visible');
        state.lastMoveTimestamp = Date.now();
    }

    function triggerMoveFlash(moveData, position) {
        const posColors = POSITION_COLORS[position];
        const alpha = 0.15 + moveData.intensity * 0.25;
        els.flash.style.backgroundColor = posColors.vignette + alpha + ')';
        els.flash.style.opacity = '1';
        setTimeout(() => { els.flash.style.opacity = '0'; }, 100);
    }

    function hideMoveFeedback() {
        els.moveFeedback.classList.remove('visible');
    }

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                     GAME DETECTION                             ║
    // ╚═══════════════════════════════════════════════════════════════╝

    function detectNewGame() {
        const moveList = document.querySelector('.move-list-wrapper');
        const currentMoves = moveList ? moveList.innerText.length : 0;
        if (state.lastMoveListLength && currentMoves < state.lastMoveListLength * 0.3) {
            return true;
        }
        state.lastMoveListLength = currentMoves;
        return false;
    }

    function resetForNewGame() {
        state.prevUserSeconds = null;
        state.prevOppSeconds = null;
        state.turnStartTime = null;
        state.userClockWasTicking = false;
        state.oppClockWasTicking = false;
        state.moveHistory = [];
        state.moveCount = 0;
        state.lastMoveData = null;
        state.lastMoveTimestamp = 0;
        resetBoardColors();
        if (CONFIG.DEBUG) console.log('[Pacer] New game detected, state reset');
    }

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                     MAIN LOOP                                  ║
    // ╚═══════════════════════════════════════════════════════════════╝

    function mainLoop() {
        if (detectNewGame()) resetForNewGame();

        const userClockEl = document.querySelector('#board-layout-player-bottom .clock-time-monospace');
        const oppClockEl = document.querySelector('#board-layout-player-top .clock-time-monospace');

        if (!userClockEl || !oppClockEl) return;

        const userText = userClockEl.textContent.trim();
        const oppText = oppClockEl.textContent.trim();
        const userSec = parseTimeToSeconds(userText);
        const oppSec = parseTimeToSeconds(oppText);

        els.userTime.innerText = userText;
        els.oppTime.innerText = oppText;

        const delta = userSec - oppSec;
        els.delta.innerText = formatDelta(delta);

        const position = getPosition(delta);
        const urgency = getUrgency(userSec);

        state.currentPosition = position;
        state.currentUrgency = urgency;

        const currentBudget = calculateBudget(userSec);
        els.budgetValue.innerText = formatBudget(currentBudget);

        // ─── Turn Detection ───
        const now = Date.now();
        const userClockTicking = state.prevUserSeconds !== null && userSec < state.prevUserSeconds - 0.01;

        if (userClockTicking && !state.userClockWasTicking) {
            state.turnStartTime = state.prevUserSeconds;
        }

        if (!userClockTicking && state.userClockWasTicking && state.turnStartTime !== null) {
            const timeSpent = state.turnStartTime - userSec;
            const budgetAtStart = calculateBudget(state.turnStartTime);
            const moveData = rateMove(timeSpent, budgetAtStart);

            if (CONFIG.DEBUG) {
                console.log(`[Move] ${timeSpent.toFixed(2)}s / ${budgetAtStart.toFixed(2)}s = ${moveData.rating}`);
            }

            state.lastMoveData = moveData;
            addMoveToHistory(moveData);
            triggerMoveFlash(moveData, position);
            showMoveFeedback(moveData, position);
            state.turnStartTime = null;
            state.moveCount++;
        }

        if (state.lastMoveTimestamp > 0 && now - state.lastMoveTimestamp > CONFIG.FEEDBACK_DURATION) {
            hideMoveFeedback();
        }

        updateVisuals(position, urgency, delta, userSec);

        state.prevUserSeconds = userSec;
        state.prevOppSeconds = oppSec;
        state.userClockWasTicking = userClockTicking;
    }

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║                     INITIALIZATION                             ║
    // ╚═══════════════════════════════════════════════════════════════╝

    setInterval(mainLoop, CONFIG.UPDATE_INTERVAL);

    window.addEventListener('beforeunload', resetBoardColors);

    if (CONFIG.DEBUG) {
        console.log('[Bullet Pacer v17] Initialized');
        window.PACER_STATE = state;
        window.PACER_CONFIG = CONFIG;
    }
})();
