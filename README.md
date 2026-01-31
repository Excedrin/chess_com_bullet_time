# ♟️ Chess.com - Bullet Time

**Bullet Time** is a Tampermonkey userscript designed specifically for Bullet and Hyper-Bullet chess on Chess.com. 

In Bullet chess, **time is a piece**. Taking your eyes off the board to check the clock costs milliseconds, and milliseconds cost games. This script transforms the entire board and UI into a peripheral vision time-management system, allowing you to sense your time situation without looking away from the action.

## 🚀 Features

### 1. Dynamic Board Coloring (The "Time Advantage" Monitor)
The chessboard itself changes color based on the **Time Delta** (the difference between your time and your opponent's).
*   **🟩 Green Tint:** You are **Dominiating** (+5s) or **Ahead** (+2s). You have the initiative.
*   **🟫 Neutral/Standard:** The game is **Even** (within ±1s).
*   **🟥 Red Tint:** You are **Behind** or **Losing** on time (<-2.5s). Speed up immediately!

### 2. The HUD (Heads-Up Display)
The native clocks are hidden and replaced with a floating, high-contrast HUD fixed to the side of the board.
*   **Big Timer:** Your remaining time, massive and easy to read.
*   **Delta Indicator:** A `+2.5` or `-1.2` readout showing exactly how far ahead/behind you are.
*   **Urgency Bar:** A visual bar representing your absolute remaining time.
*   **Momentum Indicator:** An arrow (▲/▼) showing if you are currently gaining or losing time on the opponent over the last few moves.

### 3. Urgency System (Absolute Time)
As your clock ticks down, the screen reacts to simulate "pressure":
*   **> 25s:** Relaxed.
*   **15s - 25s:** Alert (Screen vignette darken slightly).
*   **< 8s:** High Urgency (HUD glows).
*   **< 4s:** **CRITICAL** (HUD pulses).
*   **< 2s:** **PREMOVE** (Intense pulsing, immediate action required).

### 4. Move Budgeting & Feedback
The script calculates a "Time Budget" for your next move based on how much time you have left. After every move, it gives instant feedback:
*   `⚡` **Instant:** Premove / near-instant response.
*   `✓` **Good:** You moved within your time budget.
*   `⏱` **Slow:** You took too long given your remaining time.
*   `⚠` **Costly:** You spent way too much time (likely blundered your time advantage).

---

## 🛠️ Installation

1.  **Install a Userscript Manager:**
    *   [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Safari, Firefox, Opera).
2.  **Install the Script:**
    *   Create a new script in Tampermonkey.
    *   Paste the contents of `bullet-time.js` into the editor.
    *   Save (Ctrl+S).
3.  **Play:**
    *   Go to [Chess.com/play](https://www.chess.com/play).
    *   Start a Bullet game (1|0 or 2|1 works best).

---

## ⚙️ Configuration

You can customize almost every aspect of the script by editing the `CONFIG` object at the top of the script file.

### Adjusting Color Thresholds
If you find the board turns red too early, adjust the `POSITION` thresholds:
```javascript
POSITION: {
    DOMINATING: 5,      // Seconds ahead to turn deep green
    AHEAD: 2,           // Seconds ahead to turn light green
    EVEN: 1,            // Buffer zone
    BEHIND: -3.0,       // Change this to -5.0 to wait longer before turning red
},
```

### Changing Colors
If you prefer Blue for winning instead of Green, edit the `BOARD` RGB values:
```javascript
BOARD: {
    // Example: Blue tint for leading
    LIGHT_AHEAD:   { r: 210, g: 230, b: 250 }, 
    DARK_AHEAD:    { r: 80,  g: 100, b: 180 },
    // ...
}
```

---

## 💡 Tips for Usage

*   **Don't look at the numbers:** The goal of this script is to let you rely on *peripheral vision*. If the board is green, play solid. If the board turns red, start throwing checks or playing "tricky" moves to flag your opponent.
*   **Trust the Pulse:** When the HUD starts pulsing, do not calculate. Move pieces.
*   **Theater Mode:** This script works exceptionally well in Chess.com's "Focus" or "Theater" modes where distractions are minimized.

---

## ⚠️ Disclaimer

**Is this cheating?**
No. This script does **not** suggest moves, analyze positions, or interact with the chess engine. It strictly visualizes the **time information** that is already available on the screen (your clock vs. opponent's clock). It is a UI/Accessibility modification for time management.

However, use at your own discretion. Terms of Service regarding UI modifications can change.

---

## 📝 License

This project is open-source. Feel free to modify, fork, or share.
